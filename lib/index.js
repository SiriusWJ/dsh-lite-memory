/**
 * dsh-lite-memory —— Host 面（SQLite 版）
 *
 * DSH 简化版记忆插件（参考 @a9i5k4/dsh-auto-memory 裁剪）：
 *  - SQLite 存储：~/.dsh/memory/memory.db（表 entries / calendar），不再读写 MEMORY.md / calendar.json
 *  - 记忆条目：标题 / 内容 / 重要程度（高/中/低）/ 来源（工作区-会话）/ 创建更新时间，按条目增删改
 *  - 工具：memory_recall（检索条目）/ memory_entry（条目增删改查）
 *  - 日历：calendar_add/list/done/remove；到点提醒投递注册会话（会话移除则新建会话投递）
 *  - 记忆标题动态注入：全局 + 当前项目条目标题经 systemPrompt.context 注入为 durable user-role
 *    快照（仅快照变化时记录进模型历史，比静态 section 省 token）；按会话缓存、CRUD 写入后清缓存自动刷新。
 *  - 无自动沉淀、无反思/日志、无外观设置；语言跟随 DSH 设置（Client 侧）。
 *
 * 路由（POST 均做同源保护）：
 *  - 定时任务：cron 表达式（5 字段）驱动的 DSH 进程内调度——到点由 agents 拉起会话执行提示词，
 *    cron_jobs / cron_runs 两张表落在同一个 memory.db；无系统 crontab、无守护进程，
 *    仅在 dsh web 进程存活期间触发，错过即丢。任务可用 provider/model/effort 指定模型路由
 *    （仅新建会话时生效）并用 agent preset 指定人格与工具集。
 *
 *   GET  /dsh-lite-memory/entries?scope=&workspace=         记忆条目列表
 *   POST /dsh-lite-memory/entries/add     { scope, workspace, title, priority, content }
 *   POST /dsh-lite-memory/entries/update  { id, title?, priority?, content? }
 *   POST /dsh-lite-memory/entries/delete  { id }
 *   GET  /dsh-lite-memory/workspace?sessionId=    当前会话的工作区名
 *   GET  /dsh-lite-memory/workspaces              全部工作区名列表
 *   GET  /dsh-lite-memory/calendar                日历条目
 *   POST /dsh-lite-memory/calendar/add             { date, time, quadrant, title, note }
 *   POST /dsh-lite-memory/calendar/done            { date, time, title }
 *   POST /dsh-lite-memory/calendar/remove          { date, time, title }
 *   GET  /dsh-lite-memory/status                  存储位置状态
 *   GET  /dsh-lite-memory/cron                    定时任务列表（含下次运行时间）
 *   POST /dsh-lite-memory/cron/add                { name, expr, prompt, cwd, preset, provider, model, effort, target, timeoutSec }
 *   POST /dsh-lite-memory/cron/update             { id, ...同上 }
 *   POST /dsh-lite-memory/cron/remove             { id }
 *   POST /dsh-lite-memory/cron/toggle             { id, enabled }
 *   POST /dsh-lite-memory/cron/run                { id } 立即运行一次
 *   GET  /dsh-lite-memory/cron/runs?jobId=&limit= 执行记录
 *   POST /dsh-lite-memory/cron/preview            { expr } 未来 5 次 + 结构化描述
 *   GET  /dsh-lite-memory/cron/workspaces         工作区候选（workspaceRegistry 真路径）+ 进程默认目录
 *   GET  /dsh-lite-memory/cron/models            部署默认选择 + 各 provider 的模型目录（缓存 5 分钟）
 *   POST /dsh-lite-memory/cron/model-info         { provider, model } 该模型支持的推理强度等
 */
import { DatabaseSync } from 'node:sqlite'
import { existsSync, mkdirSync, statSync } from 'node:fs'
import { join, dirname, basename } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'

export const name = 'dsh-lite-memory'
export const inject = ['agentPresets', 'timer', 'webServer', 'systemPrompt', 'tools', 'agents']

// ────────────────────────────────────────────────────────────────────────────
// 路径与数据库
// ────────────────────────────────────────────────────────────────────────────

function dshHome() {
  const env = process.env.DSH_HOME
  if (env !== undefined && String(env).trim().length > 0) return join(String(env).trim())
  return join(homedir(), '.dsh')
}
const memoryRoot = () => join(dshHome(), 'memory')
const dbFile = () => join(memoryRoot(), 'memory.db')

let db = null

/** 打开（或惰性创建）SQLite 数据库。 */
function openDb() {
  if (db !== null) return db
  mkdirSync(dirname(dbFile()), { recursive: true })
  db = new DatabaseSync(dbFile())
  db.exec('PRAGMA journal_mode = WAL')
  db.exec(`CREATE TABLE IF NOT EXISTS entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    scope TEXT NOT NULL DEFAULT 'global',
    workspace TEXT NOT NULL DEFAULT '',
    session_id TEXT NOT NULL DEFAULT '',
    title TEXT NOT NULL DEFAULT '',
    priority TEXT NOT NULL DEFAULT '中',
    content TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`)
  // 迁移: source_type 列（user=UI 手动输入 / agent=工具写入），旧数据默认 agent
  const cols = db.prepare('PRAGMA table_info(entries)').all().map((c) => c.name)
  if (!cols.includes('source_type')) {
    db.exec("ALTER TABLE entries ADD COLUMN source_type TEXT NOT NULL DEFAULT 'agent'")
  }
  db.exec(`CREATE TABLE IF NOT EXISTS calendar (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    time TEXT NOT NULL DEFAULT '--:--',
    quadrant TEXT NOT NULL DEFAULT '重要不紧急',
    title TEXT NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT '',
    done INTEGER NOT NULL DEFAULT 0,
    reminded INTEGER NOT NULL DEFAULT 0,
    session_id TEXT NOT NULL DEFAULT '',
    cwd TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
  )`)
  // 定时任务：cron 表达式驱动，到点由 agents 拉起会话执行 prompt（仅 dsh web 存活期间触发）
  db.exec(`CREATE TABLE IF NOT EXISTS cron_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL DEFAULT '',
    enabled INTEGER NOT NULL DEFAULT 1,
    expr TEXT NOT NULL,
    prompt TEXT NOT NULL,
    cwd TEXT NOT NULL DEFAULT '',
    agent_preset TEXT NOT NULL DEFAULT '',
    provider TEXT NOT NULL DEFAULT '',
    model TEXT NOT NULL DEFAULT '',
    effort TEXT NOT NULL DEFAULT '',
    target TEXT NOT NULL DEFAULT 'new',
    session_id TEXT NOT NULL DEFAULT '',
    timeout_sec INTEGER NOT NULL DEFAULT 600,
    last_fire_minute TEXT NOT NULL DEFAULT '',
    last_run_at INTEGER NOT NULL DEFAULT 0,
    last_status TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`)
  db.exec(`CREATE TABLE IF NOT EXISTS cron_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER NOT NULL,
    started_at INTEGER NOT NULL,
    ended_at INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT '',
    session_id TEXT NOT NULL DEFAULT '',
    summary TEXT NOT NULL DEFAULT '',
    error TEXT NOT NULL DEFAULT ''
  )`)
  db.exec('CREATE INDEX IF NOT EXISTS cron_runs_job ON cron_runs (job_id, id DESC)')
  // 迁移：早期 cron_jobs 补齐「模型路由」三列（provider / model / reasoningEffort）
  const cronCols = db.prepare('PRAGMA table_info(cron_jobs)').all().map((c) => c.name)
  for (const col of ['provider', 'model', 'effort']) {
    if (!cronCols.includes(col)) db.exec("ALTER TABLE cron_jobs ADD COLUMN " + col + " TEXT NOT NULL DEFAULT ''")
  }
  return db
}

function baseName(p) {
  const s = String(p || '').replace(/\\/g, '/')
  const parts = s.split('/').filter(Boolean)
  return parts.length ? parts[parts.length - 1] : ''
}
function workspaceOf(agent) {
  try {
    if (agent && agent.session && agent.session.header && agent.session.header.cwd) {
      return baseName(agent.session.header.cwd)
    }
  } catch (e) { /* 忽略 */ }
  return ''
}

// ────────────────────────────────────────────────────────────────────────────
// 记忆条目
// ────────────────────────────────────────────────────────────────────────────

const PRIORITIES = ['高', '中', '低']

function listEntries(scope, workspace) {
  const d = openDb()
  const isProject = scope === 'project'
  const baseSql = 'SELECT id, scope, workspace, session_id, title, priority, content, created_at, updated_at, source_type FROM entries WHERE scope = ?'
  const sql = baseSql + (isProject ? ' AND workspace = ? ORDER BY updated_at DESC' : ' ORDER BY updated_at DESC')
  const args = isProject ? ['project', workspace || ''] : ['global']
  const rows = d.prepare(sql).all(...args)
  return rows.map((r) => ({
    id: r.id,
    scope: r.scope,
    workspace: r.workspace,
    sessionId: r.session_id,
    title: r.title,
    priority: r.priority,
    content: r.content,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    sourceType: r.source_type === 'user' ? 'user' : 'agent',
  }))
}

const promptTitlesCache = new Map()

function sessionKey(agent) {
  try {
    if (agent && agent.session && agent.session.id) return String(agent.session.id)
  } catch (e) { /* 忽略 */ }
  try {
    if (agent && agent.id) return String(agent.id)
  } catch (e) { /* 忽略 */ }
  return 'ws:' + workspaceOf(agent)
}

/** 构建注入系统提示词的记忆标题摘要（全局 + 当前项目）；按会话缓存，仅新会话时重算，保证系统提示词稳定、利于 prompt 缓存命中。 */
function buildMemoryTitles(agent, limit) {
  try {
    const key = sessionKey(agent)
    if (promptTitlesCache.has(key)) return promptTitlesCache.get(key)
    const ws = workspaceOf(agent)
    const gAll = listEntries('global', '')
    const pAll = ws ? listEntries('project', ws) : []
    const fmt = (arr, label) => {
      if (!arr.length) return ''
      const n = Math.min(limit, arr.length)
      return label + '（共 ' + arr.length + ' 条，以下最近 ' + n + ' 条）\n' +
        arr.slice(0, limit).map((en) => '- [' + (en.priority || '中') + '] ' + en.title).join('\n')
    }
    const parts = []
    const g = fmt(gAll, '全局记忆')
    if (g) parts.push(g)
    const p = fmt(pAll, '项目记忆（' + (ws || '?') + '）')
    if (p) parts.push(p)
    const text = parts.length ? '可用记忆标题：\n' + parts.join('\n\n') : ''
    promptTitlesCache.set(key, text)
    return text
  } catch (e) {
    return ''
  }
}

function addEntry({ scope, workspace, sessionId, title, priority, content, sourceType }) {
  const d = openDb()
  const t = String(title || '').trim()
  const c = String(content || '').trim()
  if (!t) return { ok: false, message: '标题不能为空' }
  if (!c) return { ok: false, message: '内容不能为空' }
  const p = PRIORITIES.includes(priority) ? priority : '中'
  const st = sourceType === 'user' ? 'user' : 'agent'
  const now = Date.now()
  const info = d.prepare(
    'INSERT INTO entries (scope, workspace, session_id, title, priority, content, created_at, updated_at, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(scope === 'project' ? 'project' : 'global', workspace || '', sessionId || '', t, p, c, now, now, st)
  promptTitlesCache.clear() // 记忆变更 → 让注入的 context 快照下次组装时重算
  return { ok: true, id: Number(info.lastInsertRowid), message: '已添加记忆条目「' + t + '」' }
}

function updateEntry({ id, title, priority, content }) {
  const d = openDb()
  const existing = d.prepare('SELECT * FROM entries WHERE id = ?').get(Number(id))
  if (!existing) return { ok: false, message: '条目不存在' }
  const t = title !== undefined ? String(title).trim() : existing.title
  const c = content !== undefined ? String(content).trim() : existing.content
  const p = priority !== undefined ? (PRIORITIES.includes(priority) ? priority : existing.priority) : existing.priority
  if (!t) return { ok: false, message: '标题不能为空' }
  if (!c) return { ok: false, message: '内容不能为空' }
  d.prepare('UPDATE entries SET title = ?, priority = ?, content = ?, updated_at = ? WHERE id = ?').run(t, p, c, Date.now(), Number(id))
  promptTitlesCache.clear() // 记忆变更 → 让注入的 context 快照下次组装时重算
  return { ok: true, message: '已更新记忆条目「' + t + '」' }
}

function deleteEntry(id) {
  const d = openDb()
  const info = d.prepare('DELETE FROM entries WHERE id = ?').run(Number(id))
  if (info.changes > 0) promptTitlesCache.clear() // 记忆变更 → 让注入的 context 快照下次组装时重算
  return info.changes > 0 ? { ok: true, message: '已删除记忆条目' } : { ok: false, message: '条目不存在' }
}

// ────────────────────────────────────────────────────────────────────────────
// 记忆检索（OR 分词 + 相关度排序 + 历史会话检索）
// ────────────────────────────────────────────────────────────────────────────

/** 按空白/中文标点分词，任一词命中即算（OR），按命中词数排序取相关度最高。 */
function memoryRecall(query, workspace, limit) {
  const q = String(query || '').trim()
  if (!q) return 'memory_recall: query 不能为空。'
  const max = Math.min(Math.max(Number(limit) || 8, 1), 30)
  const terms = q.split(/[\s,，、;；。:：]+/).filter((t) => t.length > 0)
  if (!terms.length) return 'memory_recall: query 不能为空。'
  const d = openDb()
  const hits = []
  const scanRows = (rows) => {
    for (const r of rows) {
      const title = String(r.title || '')
      const content = String(r.content || '')
      const hay = (title + ' ' + content).toLowerCase()
      const score = terms.reduce((a, t) => a + (hay.includes(String(t).toLowerCase()) ? 1 : 0), 0)
      if (score <= 0) continue
      hits.push({
        score,
        label: (r.scope === 'project' ? '项目记忆[' + (r.workspace || '?') + ']' : '全局记忆'),
        title,
        content,
        priority: r.priority,
        updatedAt: r.updated_at,
        id: r.id,
      })
    }
  }
  if (workspace) {
    scanRows(d.prepare('SELECT * FROM entries WHERE workspace = ? ORDER BY updated_at DESC LIMIT 500').all(String(workspace)))
  } else {
    scanRows(d.prepare('SELECT * FROM entries ORDER BY updated_at DESC LIMIT 2000').all())
  }
  hits.sort((a, b) => (b.score - a.score) || ((b.updatedAt || 0) - (a.updatedAt || 0)))
  if (!hits.length) return '未在记忆中找到与「' + q + '」相关的内容。'
  const out = ['记忆检索「' + q + '」命中 ' + hits.length + ' 处（相关度降序）:']
  for (const h of hits.slice(0, max)) {
    out.push('· [' + h.label + '][' + h.priority + '] ' + h.title + (h.score > 1 ? '（命中' + h.score + '词）' : ''))
    out.push('  ↳ ' + String(h.content).slice(0, 200))
  }
  if (hits.length > max) out.push('…共 ' + hits.length + ' 处，仅显示前 ' + max + ' 处。')
  return out.join('\n')
}

/** 历史 DSH 会话检索（依赖部署的 session-query 索引；未启用时返回空串）。 */
async function recallSessions(query, limit) {
  try {
    const sq = ctx.get('sessionQuery')
    if (!sq || typeof sq.searchSessions !== 'function') return ''
    const page = await sq.searchSessions({ query: String(query || ''), limit: Math.min(limit || 5, 10) })
    const items = (page && page.items) || []
    if (!items.length) return ''
    const out = ['== 历史 DSH 会话命中 ==']
    for (const it of items.slice(0, Math.min(limit || 5, 10))) {
      const hdr = (it && it.header) || {}
      const when = hdr.createdAt ? dateStrOf(hdr.createdAt) : '?'
      const snippet = it.bestMatch && it.bestMatch.snippet ? String(it.bestMatch.snippet).slice(0, 300) : ''
      out.push('· [' + when + '] ' + (hdr.cwd || hdr.id || '?') + '\n  ' + snippet)
    }
    return out.join('\n')
  } catch (e) {
    return ''
  }
}

function dateStrOf(ts) {
  const d = new Date(ts)
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
}

/** memory_recall 主入口：本地条目 OR 检索 + 历史会话检索。 */
async function recallAll(query, workspace, limit) {
  const local = memoryRecall(query, workspace, limit)
  const session = await recallSessions(query, limit)
  if (!session) return local
  // 本地无命中时以会话结果为主体
  if (local.startsWith('未在记忆中找到')) return '未在记忆条目中找到相关内容，但历史会话有命中:\n' + session
  return local + '\n' + session
}

// ────────────────────────────────────────────────────────────────────────────
// 日历
// ────────────────────────────────────────────────────────────────────────────

function todayStr() {
  const d = new Date()
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
}
function nowTime() {
  const d = new Date()
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0')
}

const QUADRANTS = ['重要紧急', '重要不紧急', '紧急不重要', '不重要不紧急']

function readCalendar() {
  const d = openDb()
  return d.prepare('SELECT * FROM calendar ORDER BY date ASC, time ASC').all().map((r) => ({
    id: r.id,
    date: r.date,
    time: r.time,
    quadrant: r.quadrant,
    title: r.title,
    note: r.note,
    done: !!r.done,
    reminded: !!r.reminded,
    sessionId: r.session_id,
    cwd: r.cwd,
    createdAt: r.created_at,
  }))
}

function calendarAdd(item) {
  const d = openDb()
  const title = String(item.title || '').trim()
  if (!title) return 'calendar_add: title 不能为空。'
  d.prepare(
    'INSERT INTO calendar (date, time, quadrant, title, note, done, reminded, session_id, cwd, created_at) VALUES (?, ?, ?, ?, ?, 0, 0, ?, ?, ?)'
  ).run(
    item.date || todayStr(),
    item.time || '--:--',
    QUADRANTS.includes(item.quadrant) ? item.quadrant : '重要不紧急',
    title,
    String(item.note || '').trim(),
    item.sessionId || '',
    item.cwd || '',
    Date.now(),
  )
  return '已把「' + title + '」记入日历（' + (item.date || todayStr()) + ' ' + (item.time || '--:--') + '，' + (QUADRANTS.includes(item.quadrant) ? item.quadrant : '重要不紧急') + '）。'
}
function calendarList(dateFilter) {
  const entries = readCalendar()
  const target = dateFilter ? String(dateFilter) : ''
  const list = entries.filter((en) => !target || en.date === target)
  if (!list.length) return '日历为空' + (target ? ' (' + target + ')' : '') + '。'
  const lines = ['日历条目(' + list.length + ' 个):']
  for (const en of list.slice(0, 40)) {
    lines.push('· ' + (en.done ? '[完成] ' : '[待办] ') + en.date + ' ' + en.time + ' | ' + en.quadrant + ' | ' + en.title + (en.note ? ' (' + en.note + ')' : ''))
  }
  return lines.join('\n')
}
function calendarSetDone(date, time, title, done) {
  const d = openDb()
  const info = d.prepare('UPDATE calendar SET done = ? WHERE date = ? AND time = ? AND title = ?').run(done ? 1 : 0, date, time, title)
  if (info.changes === 0) return '未找到匹配的日历条目（date=' + (date || '任意') + ' time=' + (time || '任意') + ' title=' + (title || '任意') + '）。'
  return '已' + (done ? '标记完成' : '恢复待办') + ' ' + info.changes + ' 条日历条目。'
}
function calendarRemove(date, time, title) {
  const d = openDb()
  const info = d.prepare('DELETE FROM calendar WHERE date = ? AND time = ? AND title = ?').run(date, time, title)
  if (info.changes === 0) return '未找到匹配的日历条目。'
  return '已删除 ' + info.changes + ' 条日历条目。'
}

/** 记忆系统状态快照（memory_status 工具用）。 */
function memoryStatus() {
  const d = openDb()
  const entryCount = d.prepare('SELECT COUNT(*) c FROM entries').get().c
  const calCount = d.prepare('SELECT COUNT(*) c FROM calendar').get().c
  const pendingCal = d.prepare('SELECT COUNT(*) c FROM calendar WHERE done = 0').get().c
  const latest = d.prepare('SELECT MAX(updated_at) m FROM entries').get().m
  const globalCount = d.prepare("SELECT COUNT(*) c FROM entries WHERE scope = 'global'").get().c
  const projectCount = d.prepare("SELECT COUNT(*) c FROM entries WHERE scope = 'project'").get().c
  let dbBytes = 0
  try { dbBytes = statSync(dbFile()).size } catch (e) { /* 忽略 */ }
  return {
    dbFile: dbFile(),
    dbBytes,
    entries: entryCount,
    globalEntries: globalCount,
    projectEntries: projectCount,
    calendar: calCount,
    pendingCalendar: pendingCal,
    cronJobs: d.prepare('SELECT COUNT(*) c FROM cron_jobs').get().c,
    cronEnabled: d.prepare('SELECT COUNT(*) c FROM cron_jobs WHERE enabled = 1').get().c,
    cronRuns: d.prepare('SELECT COUNT(*) c FROM cron_runs').get().c,
    latestEntryAt: latest || null,
  }
}

/**
 * 按时间范围检索记忆条目（基于 updated_at），返回标题/时间/重要程度集合。
 * start/end 支持 YYYY-MM-DD 或 YYYY-MM-DD HH:MM；缺省不限。
 */
function memoryRange(start, end, workspace, limit) {
  const d = openDb()
  const parseTs = (s) => {
    const v = String(s || '').trim()
    if (!v) return null
    const m = v.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/)
    if (!m) return null
    const t = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), m[4] ? Number(m[4]) : 0, m[5] ? Number(m[5]) : 0)
    return Number.isNaN(t.getTime()) ? null : t.getTime()
  }
  const from = parseTs(start)
  const to = parseTs(end)
  if (start && from === null) return 'memory_range: start 格式无效（应为 YYYY-MM-DD 或 YYYY-MM-DD HH:MM）。'
  if (end && to === null) return 'memory_range: end 格式无效（应为 YYYY-MM-DD 或 YYYY-MM-DD HH:MM）。'
  const max = Math.min(Math.max(Number(limit) || 50, 1), 200)
  const clauses = []
  const params = []
  if (from !== null) { clauses.push('updated_at >= ?'); params.push(from) }
  if (to !== null) { clauses.push('updated_at <= ?'); params.push(to + (to % 86400000 === 0 ? 86399999 : 0)) }
  if (workspace) { clauses.push('workspace = ?'); params.push(String(workspace)) }
  const where = clauses.length ? 'WHERE ' + clauses.join(' AND ') : ''
  const rows = d.prepare('SELECT * FROM entries ' + where + ' ORDER BY updated_at DESC LIMIT ' + max).all(...params)
  if (!rows.length) {
    const span = (from !== null ? dateStrOf(from) : '不限') + ' ~ ' + (to !== null ? dateStrOf(to) : '不限')
    return '时间范围「' + span + '」内无记忆条目。'
  }
  const groups = { '高': [], '中': [], '低': [] }
  for (const r of rows) {
    const p = groups[r.priority] ? r.priority : '中'
    groups[p].push({
      title: r.title,
      time: dateStrOf(r.updated_at) + ' ' + new Date(r.updated_at).toTimeString().slice(0, 5),
      label: r.scope === 'project' ? '项目[' + (r.workspace || '?') + ']' : '全局',
    })
  }
  const out = []
  const order = ['高', '中', '低']
  for (const p of order) {
    const list = groups[p]
    if (!list.length) continue
    out.push('【' + p + '】' + list.length + ' 条:')
    for (const it of list.slice(0, max)) out.push('· ' + it.time + ' [' + it.label + '] ' + it.title)
  }
  const head = '时间范围检索 ' + (from !== null ? dateStrOf(from) : '不限') + ' ~ ' + (to !== null ? dateStrOf(to) : '不限') + '，命中 ' + rows.length + ' 条:'
  return head + '\n' + out.join('\n')
}

// ────────────────────────────────────────────────────────────────────────────
// 提醒投递
// ────────────────────────────────────────────────────────────────────────────

function makeRemindMessage(entry) {
  const text = '日历提醒: 事项「' + entry.title + '」（' + entry.date + ' ' + entry.time + '，' + entry.quadrant + '）时间已到' + (entry.note ? '。备注: ' + entry.note : '') + '。请主动提醒用户，若已完成请用 calendar_done 标记完成，否则询问是否需要调整时间。'
  return {
    id: 'lmem-remind-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind: 'plugin', plugin: 'dsh-lite-memory', form: 'notice', summary: '日历提醒: ' + entry.title },
  }
}

async function deliverReminder(entry) {
  try {
    const agents = ctx.get('agents')
    if (agents === undefined) return false
    const message = makeRemindMessage(entry)
    const agent = agents.get(entry.sessionId)
    if (agent !== undefined) {
      agent.followup(message)
      return true
    }
    // 会话被移除 → 新建会话投递（保留）
    const newId = 'lmem-remind-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6)
    let presetId = ''
    try {
      const presets = ctx.get('agentPresets')
      if (presets !== undefined && typeof presets.resolve === 'function') {
        const p = await presets.resolve()
        if (p && p.id) presetId = p.id
      }
    } catch (e) { /* 忽略 */ }
    const selection = resolveDefaultSelection()
    const agentOptions = {}
    if (selection !== null) {
      agentOptions.provider = selection.provider
      agentOptions.model = selection.model
    }
    const createOptions = {
      sessionId: newId,
      // cwd 必须有值：部署的 persona 模板引用 {{cwd}}，缺了会让这一轮装配直接抛错
      meta: { cwd: entry.cwd || process.cwd(), ...(presetId ? { agentPreset: presetId } : {}) },
    }
    if (Object.keys(agentOptions).length > 0) createOptions.agentOptions = agentOptions
    const handle = await agents.create(createOptions)
    handle.agent.followup(message)
    return true
  } catch (e) {
    console.error('[dsh-lite-memory] deliverReminder failed: ' + (e && e.message ? e.message : String(e)))
    return false
  }
}

async function remindTick() {
  try {
    const d = openDb()
    const now = todayStr()
    const time = nowTime()
    const rows = d.prepare('SELECT * FROM calendar WHERE done = 0 AND reminded = 0').all()
    for (const r of rows) {
      if (r.date > now) continue
      if (r.date === now && r.time !== '--:--' && r.time > time) continue
      d.prepare('UPDATE calendar SET reminded = 1 WHERE id = ?').run(r.id)
      const entry = { title: r.title, date: r.date, time: r.time, quadrant: r.quadrant, note: r.note, sessionId: r.session_id, cwd: r.cwd }
      const ok = await deliverReminder(entry)
      if (!ok) console.error('[dsh-lite-memory] reminder delivery failed for id ' + r.id)
    }
  } catch (e) {
    console.error('[dsh-lite-memory] remindTick error: ' + (e && e.message ? e.message : String(e)))
  }
}

// ────────────────────────────────────────────────────────────────────────────
// 定时任务（cron 解析 + 分钟去重调度 + agents 会话执行）
// ────────────────────────────────────────────────────────────────────────────

const CRON_MAX_CONCURRENT = 2
const CRON_DEFAULT_TIMEOUT_SEC = 600
const CRON_RUN_KEEP = 500
const WEEK_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
const activeCronRuns = new Set()
let lastCronMinute = ''

function pad2(n) { return String(n).padStart(2, '0') }

/** 本地时间戳文案 YYYY-MM-DD HH:MM。 */
function fmtStamp(ts) {
  const d = new Date(ts)
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes())
}

/** 墙钟分钟键，用于「一分钟内最多触发一次」的去重。 */
function minuteKeyOf(d) {
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + 'T' + pad2(d.getHours()) + ':' + pad2(d.getMinutes())
}

/** 解析单个 cron 字段为值集合；非法返回 null。支持 * / a / a-b / 步长 / 逗号组合。 */
function parseCronField(raw, min, max) {
  const field = String(raw === undefined || raw === null ? '' : raw).trim()
  if (!field) return null
  const out = new Set()
  for (const part of field.split(',')) {
    if (!part) return null
    if (part === '*') { for (let v = min; v <= max; v += 1) out.add(v); continue }
    const step = part.match(/^(\*|\d+)(?:-(\d+))?\/(\d+)$/)
    if (step !== null) {
      const from = step[1] === '*' ? min : Number(step[1])
      const to = step[2] === undefined ? max : Number(step[2])
      const n = Number(step[3])
      if (n <= 0 || from < min || to > max || from > to) return null
      for (let v = from; v <= to; v += n) out.add(v)
      continue
    }
    const range = part.match(/^(\d+)-(\d+)$/)
    if (range !== null) {
      const from = Number(range[1])
      const to = Number(range[2])
      if (from < min || to > max || from > to) return null
      for (let v = from; v <= to; v += 1) out.add(v)
      continue
    }
    if (/^\d+$/.test(part)) {
      const v = Number(part)
      if (v < min || v > max) return null
      out.add(v)
      continue
    }
    return null
  }
  return out.size > 0 ? out : null
}

/** 解析 5 字段 cron 表达式；非法返回 null。dayStar/weekStar 供 dom/dow 语义判定。 */
function parseCronExpr(expr) {
  const parts = String(expr === undefined || expr === null ? '' : expr).trim().split(/\s+/)
  if (parts.length !== 5) return null
  const minute = parseCronField(parts[0], 0, 59)
  const hour = parseCronField(parts[1], 0, 23)
  const day = parseCronField(parts[2], 1, 31)
  const month = parseCronField(parts[3], 1, 12)
  let week = parseCronField(parts[4], 0, 7)
  if (minute === null || hour === null || day === null || month === null || week === null) return null
  if (week.has(7)) week = new Set([...week].map((v) => (v === 7 ? 0 : v)))
  return { minute, hour, day, month, week, dayStar: parts[2].trim() === '*', weekStar: parts[4].trim() === '*' }
}

/**
 * 某分钟是否命中。日/周按 Vixie 规则：两侧都受限才取「或」，否则取「与」。
 * （照抄 dayOk || weekOk 会让 `0 9 15 * *` 因 dow=* 恒真而天天触发。）
 */
function cronMatches(parsed, date) {
  if (parsed === null) return false
  if (!parsed.minute.has(date.getMinutes())) return false
  if (!parsed.hour.has(date.getHours())) return false
  if (!parsed.month.has(date.getMonth() + 1)) return false
  const domOk = parsed.day.has(date.getDate())
  const dowOk = parsed.week.has(date.getDay())
  if (parsed.dayStar || parsed.weekStar) return domOk && dowOk
  return domOk || dowOk
}

/** 从 from 之后求解接下来 count 次运行时间（epoch ms）；表达式非法返回 null。 */
function nextRuns(expr, from, count) {
  const parsed = parseCronExpr(expr)
  if (parsed === null) return null
  const n = Math.min(Math.max(Number(count) || 5, 1), 20)
  const out = []
  const cursor = new Date(from === undefined || from === null ? Date.now() : from)
  cursor.setSeconds(0, 0)
  cursor.setMinutes(cursor.getMinutes() + 1)
  let guard = 0
  while (out.length < n && guard < 366 * 24 * 60) {
    guard += 1
    if (cronMatches(parsed, cursor)) out.push(cursor.getTime())
    cursor.setMinutes(cursor.getMinutes() + 1)
  }
  return out
}

/** 把常见表达式识别成结构化描述（文案由调用方本地化，避免 host 写死语言）。 */
function describeCron(expr) {
  const raw = String(expr === undefined || expr === null ? '' : expr).trim()
  const parsed = parseCronExpr(raw)
  if (parsed === null) return { kind: 'invalid', expr: raw }
  const parts = raw.split(/\s+/)
  const m = parts[0].trim()
  const h = parts[1].trim()
  const dom = parts[2].trim()
  const mon = parts[3].trim()
  const dow = parts[4].trim()
  const base = { expr: raw, month: mon === '*' ? 0 : mon }
  if (m === '*' && h === '*' && dom === '*' && mon === '*' && dow === '*') return Object.assign(base, { kind: 'everyMinute' })
  const stepM = m.match(/^\*\/(\d+)$/)
  if (stepM !== null && h === '*') return Object.assign(base, { kind: 'everyNMinutes', n: Number(stepM[1]) })
  if (/^\d+$/.test(m) && h === '*') return Object.assign(base, { kind: 'hourly', minute: Number(m) })
  if (/^\d+$/.test(m) && /^\d+$/.test(h)) {
    const time = pad2(Number(h)) + ':' + pad2(Number(m))
    if (dom === '*' && mon === '*' && dow === '*') return Object.assign(base, { kind: 'daily', time })
    if (/^\d$/.test(dow) && dom === '*' && mon === '*') return Object.assign(base, { kind: 'weekly', week: Number(dow) % 7, time })
    if (/^\d+$/.test(dom) && dow === '*' && mon === '*') return Object.assign(base, { kind: 'monthly', day: Number(dom), time })
  }
  return Object.assign(base, { kind: 'raw' })
}

/** cron 描述的中文文案（用于工具输出；界面文案由 Client 侧字典本地化）。 */
function cronDescText(desc) {
  switch (desc.kind) {
    case 'everyMinute': return '每分钟'
    case 'everyNMinutes': return '每 ' + desc.n + ' 分钟'
    case 'hourly': return '每小时第 ' + desc.minute + ' 分'
    case 'daily': return '每天 ' + desc.time
    case 'weekly': return '每' + WEEK_NAMES[desc.week] + ' ' + desc.time
    case 'monthly': return '每月 ' + desc.day + ' 日 ' + desc.time
    case 'invalid': return '无效表达式'
    default: return desc.expr
  }
}

function clampInt(v, min, max, fallback) {
  if (v === undefined || v === null || v === '') return fallback
  const n = Number(v)
  if (!Number.isFinite(n)) return fallback
  return Math.min(Math.max(Math.floor(n), min), max)
}

// ── 面板下拉数据源：工作区（真路径）与可选模型 ──────────────────────────────

/** 工作区候选：来自 workspaceRegistry 的真实目录路径，外加进程默认目录。 */
function listWorkspaceOptions() {
  let processCwd = ''
  try { processCwd = process.cwd() } catch (e) { /* 忽略 */ }
  const workspaces = []
  try {
    const reg = ctx.get('workspaceRegistry')
    if (reg !== undefined && typeof reg.list === 'function') {
      for (const w of reg.list()) {
        if (!w || !w.path) continue
        workspaces.push({ id: String(w.id || ''), title: String(w.title || ''), path: String(w.path) })
      }
    }
  } catch (e) { /* 忽略 */ }
  return { workspaces, processCwd }
}

const MODEL_CACHE_TTL_MS = 5 * 60 * 1000
let modelCache = { at: 0, data: null }

/** 可选模型：部署默认选择 + 每个已注册 provider 的模型目录（缓存 5 分钟）。 */
async function listModelOptions(force) {
  const now = Date.now()
  if (!force && modelCache.data !== null && now - modelCache.at < MODEL_CACHE_TTL_MS) return modelCache.data
  const data = { default: null, providers: [] }
  try {
    const dm = ctx.get('agentDefaultModel')
    if (dm !== undefined && typeof dm.currentSelection === 'function') {
      const sel = dm.currentSelection()
      if (sel !== null && sel !== undefined && sel.provider && sel.model) {
        data.default = { provider: String(sel.provider), model: String(sel.model), effort: sel.reasoningEffort ? String(sel.reasoningEffort) : '' }
      }
    }
  } catch (e) { /* 忽略 */ }
  try {
    const llm = ctx.get('llm')
    if (llm !== undefined && typeof llm.listProviders === 'function') {
      for (const p of llm.listProviders()) {
        if (!p || !p.id) continue
        const entry = { id: String(p.id), name: String(p.name || p.id), models: [] }
        try {
          if (typeof llm.listModels === 'function') {
            const models = await llm.listModels(p.id)
            for (const m of models || []) {
              if (m && m.id) entry.models.push({ id: String(m.id), name: String(m.name || m.id) })
            }
          }
        } catch (e) { /* 单个 provider 取不到模型目录时，只保留 provider 本身 */ }
        data.providers.push(entry)
      }
    }
  } catch (e) { /* 忽略 */ }
  modelCache = { at: now, data }
  return data
}

/** 单个模型的细节（支持的推理强度等），用户点选某个模型后再查，避免列表接口过重。 */
async function resolveCronModelInfo(provider, model) {
  const out = { provider: String(provider || ''), model: String(model || ''), efforts: [], defaultEffort: '', contextWindow: 0, maxTokens: 0, error: '' }
  try {
    const llm = ctx.get('llm')
    if (llm !== undefined && typeof llm.resolveModelInfo === 'function' && out.provider && out.model) {
      const info = await llm.resolveModelInfo(out.provider, out.model)
      if (info) {
        if (info.context && info.context.contextWindow) out.contextWindow = info.context.contextWindow
        if (info.defaultMaxTokens) out.maxTokens = info.defaultMaxTokens
        if (info.reasoning) {
          out.efforts = (info.reasoning.efforts || []).map((e) => ({ id: String(e.id), name: String(e.name || e.id) }))
          out.defaultEffort = info.reasoning.defaultEffort ? String(info.reasoning.defaultEffort) : ''
        }
      }
    }
  } catch (e) {
    out.error = e && e.message ? e.message : String(e)
  }
  return out
}

/** 数据库行 → 对外的任务视图（含描述与下次运行时间）。 */
function jobView(r) {
  const desc = describeCron(r.expr)
  const next = r.enabled ? nextRuns(r.expr, Date.now(), 1) : null
  return {
    id: r.id,
    name: r.name,
    enabled: !!r.enabled,
    expr: r.expr,
    prompt: r.prompt,
    cwd: r.cwd,
    agentPreset: r.agent_preset,
    provider: r.provider,
    model: r.model,
    effort: r.effort,
    target: r.target === 'session' ? 'session' : 'new',
    sessionId: r.session_id,
    timeoutSec: r.timeout_sec,
    lastFireMinute: r.last_fire_minute,
    lastRunAt: r.last_run_at,
    lastStatus: r.last_status,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    description: desc,
    nextRunAt: next !== null && next.length > 0 ? next[0] : null,
  }
}

function readCronJobs() {
  return openDb().prepare('SELECT * FROM cron_jobs ORDER BY id ASC').all().map(jobView)
}

function findCronJob(id) {
  const row = openDb().prepare('SELECT * FROM cron_jobs WHERE id = ?').get(Number(id))
  return row === undefined ? null : jobView(row)
}

/** 按 id 或唯一 name 解析任务；name 有歧义返回 null。 */
function resolveCronJob(args) {
  if (args && args.id !== undefined && args.id !== null && String(args.id).trim() !== '') {
    return findCronJob(args.id)
  }
  const nm = String((args && args.name) || '').trim()
  if (!nm) return null
  const rows = openDb().prepare('SELECT * FROM cron_jobs WHERE name = ?').all(nm)
  return rows.length === 1 ? jobView(rows[0]) : null
}

function cronAdd(input) {
  const expr = String(input.expr === undefined || input.expr === null ? '' : input.expr).trim()
  const prompt = String(input.prompt === undefined || input.prompt === null ? '' : input.prompt).trim()
  const name = String(input.name || '').trim() || prompt.slice(0, 20)
  if (!prompt) return { ok: false, message: 'prompt 不能为空' }
  if (parseCronExpr(expr) === null) return { ok: false, message: 'cron 表达式无效（需 5 字段，如 0 9 * * *）' }
  const target = input.target === 'session' ? 'session' : 'new'
  const now = Date.now()
  const info = openDb().prepare(
    'INSERT INTO cron_jobs (name, enabled, expr, prompt, cwd, agent_preset, provider, model, effort, target, session_id, timeout_sec, last_fire_minute, last_run_at, last_status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)'
  ).run(
    name,
    input.enabled === false ? 0 : 1,
    expr,
    prompt,
    String(input.cwd || '').trim(),
    String(input.preset || input.agentPreset || '').trim(),
    String(input.provider || '').trim(),
    String(input.model || '').trim(),
    String(input.effort || '').trim(),
    target,
    String(input.sessionId || '').trim(),
    clampInt(input.timeoutSec, 30, 86400, CRON_DEFAULT_TIMEOUT_SEC),
    '',
    '',
    now,
    now,
  )
  const id = Number(info.lastInsertRowid)
  return { ok: true, id, message: '已创建定时任务「' + name + '」（' + expr + '，' + cronDescText(describeCron(expr)) + '）' }
}

function cronUpdate(input) {
  const existing = findCronJob(input.id)
  if (existing === null) return { ok: false, message: '定时任务不存在' }
  const expr = input.expr !== undefined ? String(input.expr).trim() : existing.expr
  const prompt = input.prompt !== undefined ? String(input.prompt).trim() : existing.prompt
  const name = input.name !== undefined ? (String(input.name).trim() || prompt.slice(0, 20)) : existing.name
  if (!prompt) return { ok: false, message: 'prompt 不能为空' }
  if (parseCronExpr(expr) === null) return { ok: false, message: 'cron 表达式无效（需 5 字段，如 0 9 * * *）' }
  const target = input.target !== undefined ? (input.target === 'session' ? 'session' : 'new') : existing.target
  openDb().prepare(
    'UPDATE cron_jobs SET name = ?, expr = ?, prompt = ?, cwd = ?, agent_preset = ?, provider = ?, model = ?, effort = ?, target = ?, session_id = ?, timeout_sec = ?, updated_at = ? WHERE id = ?'
  ).run(
    name,
    expr,
    prompt,
    input.cwd !== undefined ? String(input.cwd).trim() : existing.cwd,
    input.preset !== undefined ? String(input.preset).trim() : existing.agentPreset,
    input.provider !== undefined ? String(input.provider).trim() : existing.provider,
    input.model !== undefined ? String(input.model).trim() : existing.model,
    input.effort !== undefined ? String(input.effort).trim() : existing.effort,
    target,
    input.sessionId !== undefined ? String(input.sessionId).trim() : existing.sessionId,
    input.timeoutSec !== undefined ? clampInt(input.timeoutSec, 30, 86400, CRON_DEFAULT_TIMEOUT_SEC) : existing.timeoutSec,
    Date.now(),
    existing.id,
  )
  return { ok: true, message: '已更新定时任务「' + name + '」' }
}

function cronRemove(id) {
  const existing = findCronJob(id)
  if (existing === null) return { ok: false, message: '定时任务不存在' }
  const d = openDb()
  d.prepare('DELETE FROM cron_jobs WHERE id = ?').run(existing.id)
  d.prepare('DELETE FROM cron_runs WHERE job_id = ?').run(existing.id)
  return { ok: true, message: '已删除定时任务「' + existing.name + '」及其执行记录' }
}

function cronToggle(id, enabled) {
  const existing = findCronJob(id)
  if (existing === null) return { ok: false, message: '定时任务不存在' }
  openDb().prepare('UPDATE cron_jobs SET enabled = ?, updated_at = ? WHERE id = ?').run(enabled ? 1 : 0, Date.now(), existing.id)
  return { ok: true, message: (enabled ? '已启用' : '已停用') + '定时任务「' + existing.name + '」' }
}

function cronRuns(jobId, limit) {
  const max = clampInt(limit, 1, 200, 20)
  const d = openDb()
  const rows = jobId
    ? d.prepare('SELECT * FROM cron_runs WHERE job_id = ? ORDER BY id DESC LIMIT ' + max).all(Number(jobId))
    : d.prepare('SELECT * FROM cron_runs ORDER BY id DESC LIMIT ' + max).all()
  return rows.map((r) => ({
    id: r.id, jobId: r.job_id, startedAt: r.started_at, endedAt: r.ended_at, status: r.status,
    sessionId: r.session_id, summary: r.summary, error: r.error,
  }))
}

function recordCronRun(jobId, status, startedAt, sessionId, summary, error) {
  const d = openDb()
  const ended = Date.now()
  d.prepare('INSERT INTO cron_runs (job_id, started_at, ended_at, status, session_id, summary, error) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(jobId, startedAt, ended, status, sessionId || '', String(summary || '').slice(0, 2000), String(error || '').slice(0, 1000))
  d.prepare('UPDATE cron_jobs SET last_run_at = ?, last_status = ? WHERE id = ?').run(ended, status, jobId)
  d.prepare('DELETE FROM cron_runs WHERE id NOT IN (SELECT id FROM cron_runs ORDER BY id DESC LIMIT ' + CRON_RUN_KEEP + ')').run()
}

function makeCronMessage(job) {
  const text = '【定时任务】' + job.name + '（' + job.expr + '，' + cronDescText(describeCron(job.expr)) + '）已到点触发。\n\n' + job.prompt
  return {
    id: 'lmem-cron-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind: 'plugin', plugin: 'dsh-lite-memory', form: 'instructions' },
  }
}

/** 调试开关：DSH_LMEM_CRON_DEBUG=1 时打印每轮运行的调度事件。 */
function cronDebug() {
  if (String(process.env.DSH_LMEM_CRON_DEBUG || '') === '1') console.log.apply(console, ['[dsh-lite-memory][cron]'].concat([...arguments]))
}

/** 读取部署的默认模型选择；程序化建会话必须显式带上它，否则 prompt 装配会失败。 */
function resolveDefaultSelection() {
  try {
    const svc = ctx.get('agentDefaultModel')
    if (svc !== undefined && typeof svc.currentSelection === 'function') {
      const sel = svc.currentSelection()
      if (sel !== null && sel !== undefined && sel.provider && sel.model) return sel
    }
  } catch (e) { /* 忽略 */ }
  return null
}

/**
 * 观察某会话这一轮是否真的跑完。
 *
 * 不能用 whenIdle() 当唯一信号：新建 agent 在 driver 起起来之前就是 idle，
 * whenIdle() 会立刻 resolve（真机实测 124ms 就"完成"），于是记录里没有结果、
 * dispose 还可能打断还没开始的那一轮。这里以事件为准：
 *   agent/status    running → idle    （驱动起来又收敛）
 *   session/event   turn/end          （这一轮关闭）
 *   session/event   assistant/message （取最后一条文本作为摘要）
 *   agent/error                       （记录失败原因）
 */
function attachTurnWatcher(sessionId) {
  const state = { running: false, idle: false, ended: false, error: '', text: '' }
  const offs = []
  let notify = null
  const fire = () => { if (notify !== null) notify() }
  const textOf = (event) => {
    const message = event.data && event.data.message
    const blocks = (message && message.content) || []
    const texts = []
    for (const b of blocks) {
      if (b && b.type === 'text' && b.text) texts.push(String(b.text))
    }
    return texts.length > 0 ? texts.join('\n') : ''
  }
  try {
    offs.push(ctx.on('agent/status', (payload) => {
      try {
        if (!payload || !payload.agent || String(payload.agent.id) !== sessionId) return
        cronDebug('agent/status ->', payload.status)
        if (payload.status === 'running') state.running = true
        else if (payload.status === 'idle') { state.idle = true; fire() }
      } catch (e) { /* 忽略 */ }
    }))
  } catch (e) { /* 忽略 */ }
  try {
    offs.push(ctx.on('session/event', (session, event) => {
      try {
        if (!session || String(session.id) !== sessionId || !event) return
        if (event.type === 'turn/start') { cronDebug('turn/start'); return }
        if (event.type === 'turn/end') {
          state.ended = true
          const reason = event.data && event.data.reason
          if (reason && reason.kind === 'error' && reason.error) {
            state.error = reason.error.message ? reason.error.message : String(reason.error)
          }
          cronDebug('turn/end', JSON.stringify(reason))
          fire()
          return
        }
        if (event.type === 'assistant/message') {
          const t = textOf(event)
          cronDebug('assistant/message', t.length + ' chars')
          if (t) state.text = t
        }
      } catch (e) { /* 忽略 */ }
    }))
  } catch (e) { /* 忽略 */ }
  try {
    offs.push(ctx.on('agent/error', (payload) => {
      try {
        if (!payload || !payload.agent || String(payload.agent.id) !== sessionId) return
        state.error = payload.error && payload.error.message ? payload.error.message : String(payload.error)
        cronDebug('agent/error', state.error)
      } catch (e) { /* 忽略 */ }
    }))
  } catch (e) { /* 忽略 */ }
  return {
    state,
    /** 等到「这一轮关闭」或「驱动收敛」；返回是否在超时前完成。 */
    wait: (ms) => new Promise((resolve) => {
      let done = false
      const finish = (settled) => {
        if (done) return
        done = true
        notify = null
        clearTimeout(timer)
        resolve(settled)
      }
      const timer = setTimeout(() => finish(false), ms)
      notify = () => { if (state.ended || state.idle) finish(true) }
      notify()
    }),
    detach: () => {
      notify = null
      for (const off of offs) { try { off() } catch (e) { /* 忽略 */ } }
    },
  }
}

/**
 * 执行一次任务。
 *  - target=new：新建会话跑一轮，等这一轮真的关闭再取摘要，然后 dispose（会话日志保留）。
 *  - target=session：投递到指定会话（活着直接 followup，否则 resume 原会话续跑），
 *    只记录「已投递」，不等待——避免与用户正在进行的对话轮次耦合。
 */
async function fireCronJob(job, trigger) {
  if (activeCronRuns.has(job.id)) {
    recordCronRun(job.id, 'skipped', Date.now(), '', '上一次运行尚未结束，跳过本次', '')
    return { ok: false, status: 'skipped', message: '任务正在运行中，已跳过本次' }
  }
  if (activeCronRuns.size >= CRON_MAX_CONCURRENT) {
    recordCronRun(job.id, 'skipped', Date.now(), '', '并发上限 ' + CRON_MAX_CONCURRENT + ' 已达，跳过本次', '')
    return { ok: false, status: 'skipped', message: '并发已达上限，已跳过本次' }
  }
  activeCronRuns.add(job.id)
  const startedAt = Date.now()
  const agents = ctx.get('agents')
  let status = 'ok'
  let error = ''
  let summary = ''
  let sid = ''
  let handle = null
  let watcher = null
  let timeoutId = null
  let timedOut = false
  try {
    if (agents === undefined) throw new Error('agents 服务不可用')
    openDb().prepare("UPDATE cron_jobs SET last_status = 'running' WHERE id = ?").run(job.id)
    const message = makeCronMessage(job)
    if (job.target === 'session' && job.sessionId) {
      const live = agents.get(job.sessionId)
      if (live !== undefined) {
        sid = String(live.id)
        live.followup(message)
      } else {
        handle = await agents.resume({ resumeSessionId: job.sessionId })
        sid = String(handle.agent.id)
        handle.agent.followup(message)
      }
      status = 'delivered'
      summary = '已投递到会话 ' + sid + '（不等待该会话收敛；模型沿用该会话自身设置）'
    } else {
      const newId = 'lmem-cron-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6)
      // 程序化建会话必须像 dsh-headless / dsh-webhook 那样补齐两样东西，否则 prompt 装配直接抛错：
      //   1) agentOptions 里要有解析后的 provider/model（部署的 persona 模板引用 {{provider}}/{{model}}）
      //   2) session header 要有 cwd（{{cwd}}）——缺 cwd 的会话会落在 _no-cwd 并让模板取不到值
      const selection = resolveDefaultSelection()
      const meta = { cwd: job.cwd || process.cwd() }
      if (job.agentPreset) meta.agentPreset = job.agentPreset
      const agentOptions = {}
      const provider = job.provider || (selection !== null ? selection.provider : '')
      const model = job.model || (selection !== null ? selection.model : '')
      if (provider) agentOptions.provider = provider
      if (model) agentOptions.model = model
      if (job.effort) agentOptions.reasoningEffort = job.effort
      const createOptions = { sessionId: newId, meta }
      if (Object.keys(agentOptions).length > 0) createOptions.agentOptions = agentOptions
      handle = await agents.create(createOptions)
      sid = String(handle.agent.id)
      cronDebug('run', job.id, job.name, '→ 会话', sid, 'cwd', meta.cwd, agentOptions)
      watcher = attachTurnWatcher(sid)
      const timeoutMs = clampInt(job.timeoutSec, 30, 86400, CRON_DEFAULT_TIMEOUT_SEC) * 1000
      timeoutId = setTimeout(() => {
        timedOut = true
        try { handle.agent.cancel({ kind: 'hook', reason: 'cron timeout' }) } catch (e) { /* 忽略 */ }
      }, timeoutMs)
      handle.agent.followup(message)
      const settled = await watcher.wait(timeoutMs)
      cronDebug('settled =', settled, 'timedOut =', timedOut, 'running =', watcher.state.running, 'ended =', watcher.state.ended)
      if (timedOut && !settled) {
        status = 'timeout'
        error = '超过 ' + Math.round(timeoutMs / 1000) + ' 秒未完成，已取消'
      } else if (watcher.state.error && !watcher.state.text) {
        status = 'err'
        error = watcher.state.error
      } else {
        summary = watcher.state.text
      }
    }
  } catch (e) {
    status = 'err'
    error = e && e.message ? e.message : String(e)
  } finally {
    if (timeoutId !== null) clearTimeout(timeoutId)
    if (watcher !== null) watcher.detach()
    if (handle !== null) {
      try { await handle.dispose() } catch (e) { /* 忽略 */ }
    }
    activeCronRuns.delete(job.id)
    if (!summary && status === 'ok') summary = '已完成（未捕获到输出文本）'
    recordCronRun(job.id, status, startedAt, sid, summary, error)
  }
  const label = status === 'ok' ? '执行完成' : status === 'delivered' ? '已投递' : status === 'timeout' ? '超时取消' : '执行失败'
  return { ok: status === 'ok' || status === 'delivered', status, sessionId: sid, message: label + '：' + job.name + (error ? '（' + error + '）' : '') }
}

/** 每 30s 一跳；按墙钟分钟去重，保证同一分钟最多触发一次，错过的分钟直接丢弃。 */
async function cronTick() {
  try {
    const now = new Date()
    const key = minuteKeyOf(now)
    if (key === lastCronMinute) return
    lastCronMinute = key
    for (const job of readCronJobs()) {
      if (!job.enabled) continue
      if (job.lastFireMinute === key) continue
      const parsed = parseCronExpr(job.expr)
      if (parsed === null || !cronMatches(parsed, now)) continue
      try { openDb().prepare('UPDATE cron_jobs SET last_fire_minute = ? WHERE id = ?').run(key, job.id) } catch (e) { /* 忽略 */ }
      void fireCronJob(job, 'auto')
    }
  } catch (e) {
    console.error('[dsh-lite-memory] cronTick error: ' + (e && e.message ? e.message : String(e)))
  }
}

// ────────────────────────────────────────────────────────────────────────────
// 工具定义（dsh-tools defineTool，schema DSL 属性级 required）
// ────────────────────────────────────────────────────────────────────────────

let ctx // 模块级持有，供 deliverReminder 使用

async function registerTools(appCtx) {
  const tools = appCtx.get('tools')
  if (tools === undefined) {
    console.warn('[dsh-lite-memory] tools 服务不可用，记忆工具未注册（插件 inject 应包含 tools）')
    return []
  }
  let defineTool = null
  try {
    let installDir = null
    try {
      const presets = appCtx.get('agentPresets')
      if (presets !== undefined && typeof presets.list === 'function') {
        const list = await presets.list()
        const preset = list.find((p) => p.id === 'cordis') || list[0]
        if (preset !== undefined && preset !== null && preset.path) {
          const suffix = '/agent-presets/' + preset.id + '/agent.cordis.yml'
          const normalized = String(preset.path).replace(/\\/g, '/')
          if (normalized.endsWith(suffix)) {
            const configDir = normalized.slice(0, -suffix.length)
            const candidate = configDir.replace(/\/config$/, '')
            if (existsSync(join(candidate, 'package.json'))) installDir = candidate
          }
        }
      }
    } catch (e) { /* 回退 */ }
    if (installDir === null && process.argv[1]) {
      const a = String(process.argv[1]).replace(/\\/g, '/')
      if (/bin\.js$/.test(a)) {
        const candidate = dirname(dirname(process.argv[1]))
        if (existsSync(join(candidate, 'package.json'))) installDir = candidate
      }
    }
    if (installDir !== null) {
      const req = createRequire(join(installDir, 'package.json'))
      const toolsPath = req.resolve('@deepseek-ai/dsh-tools')
      const mod = await import(pathToFileURL(toolsPath).href)
      if (typeof mod.defineTool === 'function') defineTool = mod.defineTool
    }
  } catch (e) {
    console.warn('[dsh-lite-memory] 无法解析 @deepseek-ai/dsh-tools: ' + (e && e.message ? e.message : String(e)))
  }
  if (defineTool === null) {
    console.warn('[dsh-lite-memory] defineTool 不可用，记忆工具未注册')
    return []
  }

  const disposers = []
  const makeTool = (name, description, parameters, execute) => {
    const tool = defineTool({
      name,
      description,
      parameters,
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: String(value) }],
      },
      execute(args, exec) {
        try {
          return Promise.resolve(execute(args, exec))
        } catch (e) {
          return Promise.resolve(name + ' 失败: ' + (e && e.message ? e.message : String(e)))
        }
      },
    })
    disposers.push(tools.register(tool))
  }

  makeTool('memory_recall', '检索记忆（SQLite 条目 OR 分词 + 相关度排序，可指定工作区）+ 历史 DSH 会话全文检索（如部署启用索引）。返回命中条目标题/重要程度/内容摘要/来源；历史会话命中标注日期与工作区。开发/排查中遇到不懂的、用户提到过去做法而当前上下文没有时调用——跨工作区也能检索到。查询必须自包含。**检索后必须在本轮回复正文中向用户转述:检索了什么、找到什么(或没找到)**。', {
    query: { type: 'string', required: true, description: '检索关键词或自包含描述，多个词用空格/标点分隔（任一词命中即算，按命中词数排序）。' },
    workspace: { type: 'string', description: '指定工作区名（如 dsh）；缺省检索全部工作区 + 全局。' },
    limit: { type: 'integer', description: '最多返回条数，缺省 8。' },
  }, async (args) => recallAll(args.query, args.workspace, args.limit))

  makeTool('memory_entry', '记忆条目增删改查。action=list 列出条目（scope/workspace 过滤）；action=add 新增条目（标题/重要程度/内容必填，来源自动记录当前工作区与会话）；action=update 修改条目（按 id）；action=delete 删除条目（按 id）。重要程度枚举: 高/中/低。写入成功后应在回复正文中向用户转述写了什么。', {
    action: { type: 'string', enum: ['list', 'add', 'update', 'delete'], required: true, description: '操作: list=列出, add=新增, update=修改, delete=删除。' },
    scope: { type: 'string', enum: ['global', 'project'], description: '条目作用域: global=全局记忆, project=项目记忆（缺省 project）。' },
    workspace: { type: 'string', description: '工作区名（scope=project 时，缺省当前工作区）。' },
    id: { type: 'integer', description: '条目 id（update/delete 必填）。' },
    title: { type: 'string', description: '条目标题（add 必填）。' },
    priority: { type: 'string', enum: PRIORITIES, description: '重要程度: 高/中/低（缺省中）。' },
    content: { type: 'string', description: '条目内容，第三人称客观陈述（add 必填）。' },
  }, (args, exec) => {
    const scope = args.scope === 'global' ? 'global' : 'project'
    // 全局记忆与工作区无关：全局条目不绑定 workspace；项目条目才按工作区组织。
    const ws = scope === 'global' ? (args.workspace || '') : (args.workspace || workspaceOf(exec && exec.agent))
    const sid = exec && exec.agent ? exec.agent.id : ''
    const action = args.action || 'list'
    if (action === 'list') {
      const items = listEntries(scope, ws)
      if (!items.length) return '暂无' + (scope === 'global' ? '全局' : '项目[' + ws + ']') + '记忆条目。'
      return '记忆条目(' + items.length + ' 个):\n' + items.map((it) => '· [' + it.id + '][' + it.priority + '] ' + it.title + ' — ' + String(it.content).slice(0, 80)).join('\n')
    }
    if (action === 'add') {
      // 工具写入来源标记为 agent（UI 手动输入由前端传 sourceType=user）
      const res = addEntry({ scope, workspace: ws, sessionId: sid, title: args.title, priority: args.priority, content: args.content, sourceType: 'agent' })
      return res.ok ? res.message : 'memory_entry: ' + res.message
    }
    if (action === 'update') {
      const res = updateEntry({ id: args.id, title: args.title, priority: args.priority, content: args.content })
      return res.ok ? res.message : 'memory_entry: ' + res.message
    }
    const res = deleteEntry(args.id)
    return res.ok ? res.message : 'memory_entry: ' + res.message
  })

  makeTool('calendar_add', '向日历添加事项（存 SQLite，跨会话有效）。从对话中提取 deadline、约定时间、任务节点时主动调用。调用后必须在回复正文中向用户转述: 已把 X 记入日历。', {
    date: { type: 'string', description: '日期 YYYY-MM-DD，缺省今天。' },
    time: { type: 'string', description: '时间 HH:MM，缺省 --:--。' },
    quadrant: { type: 'string', enum: QUADRANTS, description: '四象限分类，缺省重要不紧急。' },
    title: { type: 'string', required: true, description: '事项标题。' },
    note: { type: 'string', description: '备注。' },
  }, (args, exec) => {
    let cwd = ''
    try {
      if (exec && exec.agent && exec.agent.session && exec.agent.session.header) cwd = exec.agent.session.header.cwd || ''
    } catch (e) { /* 忽略 */ }
    const sid = exec && exec.agent ? exec.agent.id : ''
    return calendarAdd({ date: args.date, time: args.time, quadrant: args.quadrant, title: args.title, note: args.note, sessionId: sid, cwd })
  })

  makeTool('calendar_list', '列出日历条目（可按日期过滤，含完成状态）。用于查看已有安排、回答"我最近有什么安排"等问题。', {
    date: { type: 'string', description: '过滤日期 YYYY-MM-DD，缺省全部。' },
  }, (args) => calendarList(args.date))

  makeTool('calendar_done', '标记日历条目完成。参数需与 calendar_list 结果一致。', {
    date: { type: 'string', required: true, description: '条目日期 YYYY-MM-DD。' },
    time: { type: 'string', required: true, description: '条目时间 HH:MM。' },
    title: { type: 'string', required: true, description: '条目标题。' },
  }, (args) => calendarSetDone(args.date, args.time, args.title, true))

  makeTool('calendar_remove', '删除日历条目。', {
    date: { type: 'string', required: true, description: '条目日期 YYYY-MM-DD。' },
    time: { type: 'string', required: true, description: '条目时间 HH:MM。' },
    title: { type: 'string', required: true, description: '条目标题。' },
  }, (args) => calendarRemove(args.date, args.time, args.title))

  makeTool('memory_status', '查看记忆系统当前状态:数据库位置与大小、记忆条目总数（全局/项目）、日历事项与待执行数、最近写入时间。用于确认记忆系统工作正常或排障。', {}, () => {
    const s = memoryStatus()
    const lines = []
    lines.push('数据库: ' + s.dbFile + ' (' + Math.round(s.dbBytes / 1024) + ' KB)')
    lines.push('记忆条目: ' + s.entries + ' 个（全局 ' + s.globalEntries + ' / 项目 ' + s.projectEntries + '）')
    lines.push('日历事项: ' + s.calendar + ' 个（待执行 ' + s.pendingCalendar + '）')
    lines.push('定时任务: ' + s.cronJobs + ' 个（启用 ' + s.cronEnabled + '，执行记录 ' + s.cronRuns + ' 条）')
    lines.push('最近写入: ' + (s.latestEntryAt ? dateStrOf(s.latestEntryAt) + ' ' + new Date(s.latestEntryAt).toTimeString().slice(0, 5) : '(无)'))
    return lines.join('\n')
  })

  makeTool('memory_range', '按时间范围检索记忆条目（基于最近更新时间），返回条目的标题、时间与重要程度集合（按 高/中/低 分组）。用于回答「这段时间记了什么」「最近一周有哪些重要事项」等问题。', {
    start: { type: 'string', description: '起始时间 YYYY-MM-DD 或 YYYY-MM-DD HH:MM，缺省不限。' },
    end: { type: 'string', description: '结束时间 YYYY-MM-DD 或 YYYY-MM-DD HH:MM，缺省不限。' },
    workspace: { type: 'string', description: '限定工作区名（如 dsh）；缺省全部工作区 + 全局。' },
    limit: { type: 'integer', description: '最多返回条数，缺省 50。' },
  }, (args) => memoryRange(args.start, args.end, args.workspace, args.limit))

  makeTool('cron_add', '创建定时任务：到点由 DSH 在后台拉起会话执行指定提示词。cron 为 5 字段表达式「分 时 日 月 周」，如 0 9 * * * = 每天 09:00，*/30 * * * * = 每 30 分钟，0 9 * * 1 = 每周一 09:00，0 9 15 * * = 每月 15 日 09:00。可用 provider/model/effort 指定这条任务跑哪个模型（只对新建会话生效），用 preset 指定人格与工具集。仅在 dsh web 进程运行期间触发，关闭期间错过的时刻不会补跑。创建后必须在回复正文中向用户转述任务名、表达式与下次运行时间。', {
    name: { type: 'string', description: '任务名（缺省取提示词前 20 字）。' },
    expr: { type: 'string', required: true, description: '5 字段 cron 表达式，如 0 9 * * *。' },
    prompt: { type: 'string', required: true, description: '到点投给 agent 的提示词（无人值守执行）。' },
    cwd: { type: 'string', description: '新会话的工作目录，缺省沿用当前会话。' },
    preset: { type: 'string', description: 'agent preset id，缺省用默认 preset。' },
    provider: { type: 'string', description: '模型 provider（与 model 一起给），缺省用默认路由。' },
    model: { type: 'string', description: '模型 id（与 provider 一起给），缺省用默认路由。' },
    effort: { type: 'string', description: '推理强度（如 low/medium/high，取决于模型），缺省不指定。' },
    target: { type: 'string', enum: ['new', 'session'], description: 'new=每次新建会话（缺省）；session=投递回当前会话。' },
    timeoutSec: { type: 'integer', description: '单次执行超时秒数（30-86400），缺省 600。' },
  }, (args, exec) => {
    let cwd = ''
    try {
      if (exec && exec.agent && exec.agent.session && exec.agent.session.header) cwd = exec.agent.session.header.cwd || ''
    } catch (e) { /* 忽略 */ }
    const sid = exec && exec.agent ? String(exec.agent.id) : ''
    const res = cronAdd(Object.assign({}, args, { cwd: args.cwd || cwd, sessionId: sid }))
    if (!res.ok) return 'cron_add: ' + res.message
    const job = findCronJob(res.id)
    return res.message + (job !== null && job.nextRunAt !== null ? '，下次运行：' + fmtStamp(job.nextRunAt) : '（已停用，不会触发）')
  })

  makeTool('cron_list', '列出全部定时任务：id、名称、cron 表达式（含中文描述）、启停状态、下次运行时间、最近一次执行状态、模型路由。', {}, () => {
    const jobs = readCronJobs()
    if (!jobs.length) return '暂无定时任务。'
    const lines = ['定时任务（' + jobs.length + ' 个）:']
    for (const j of jobs) {
      lines.push('· [' + j.id + '] ' + j.name + ' | ' + j.expr + '（' + cronDescText(j.description) + '） | ' + (j.enabled ? '启用' : '停用') +
        ' | 下次 ' + (j.nextRunAt !== null ? fmtStamp(j.nextRunAt) : '—') + ' | 上次 ' + (j.lastStatus || '未运行'))
      const route = []
      if (j.provider || j.model) route.push((j.provider || '?') + '/' + (j.model || '?'))
      if (j.effort) route.push('effort=' + j.effort)
      if (j.agentPreset) route.push('preset=' + j.agentPreset)
      if (j.cwd) route.push('cwd=' + j.cwd)
      if (j.target === 'session') route.push('落点=会话 ' + (j.sessionId || '?'))
      if (route.length > 0) lines.push('    ' + route.join(' · '))
    }
    return lines.join('\n')
  })

  makeTool('cron_run', '立即运行一次定时任务，不等调度、走同一条执行路径（用于建完任务先验证）。返回执行状态与会话 id。', {
    id: { type: 'integer', description: '任务 id（与 name 二选一）。' },
    name: { type: 'string', description: '任务名（唯一匹配时可用）。' },
  }, async (args) => {
    const job = resolveCronJob(args)
    if (job === null) return 'cron_run: 未找到唯一匹配的定时任务（先用 cron_list 查看 id）。'
    const res = await fireCronJob(job, 'manual')
    return res.message + (res.sessionId ? '，会话：' + res.sessionId : '')
  })

  makeTool('cron_toggle', '启用或停用定时任务（停用后不再触发，配置保留）。', {
    id: { type: 'integer', description: '任务 id（与 name 二选一）。' },
    name: { type: 'string', description: '任务名（唯一匹配时可用）。' },
    enabled: { type: 'boolean', required: true, description: 'true=启用，false=停用。' },
  }, (args) => {
    const job = resolveCronJob(args)
    if (job === null) return 'cron_toggle: 未找到唯一匹配的定时任务（先用 cron_list 查看 id）。'
    const on = !(args.enabled === false || args.enabled === 'false')
    return cronToggle(job.id, on).message
  })

  makeTool('cron_remove', '删除定时任务（连带其执行记录）。删除后必须在回复正文中向用户转述删掉了哪个任务。', {
    id: { type: 'integer', description: '任务 id（与 name 二选一）。' },
    name: { type: 'string', description: '任务名（唯一匹配时可用）。' },
  }, (args) => {
    const job = resolveCronJob(args)
    if (job === null) return 'cron_remove: 未找到唯一匹配的定时任务（先用 cron_list 查看 id）。'
    return cronRemove(job.id).message
  })

  return disposers
}

// ────────────────────────────────────────────────────────────────────────────
// apply
// ────────────────────────────────────────────────────────────────────────────

export function apply(appCtx) {
  ctx = appCtx

  // 数据库预热（确保表结构就绪）
  try { openDb() } catch (e) {
    console.error('[dsh-lite-memory] SQLite 初始化失败: ' + (e && e.message ? e.message : String(e)))
  }

  // 工具注册（异步）
  appCtx.effect(() => {
    let disposers = []
    const reg = registerTools(appCtx).then((ds) => {
      disposers = ds
      console.log('[dsh-lite-memory] 已注册 ' + ds.length + ' 个记忆/日历/定时任务工具')
    }).catch((e) => {
      console.error('[dsh-lite-memory] 工具注册失败: ' + (e && e.message ? e.message : String(e)))
    })
    return () => {
      disposers.forEach((d) => { try { d() } catch (e) { /* 忽略 */ } })
      disposers = []
    }
  }, 'dsh-lite-memory: tools')

  // 记忆标题 → 动态上下文（全局 + 当前项目；按会话缓存，CRUD 写入时清缓存，让 context 快照随变更更新。
  // context 物化为 durable user-role 快照，仅在完整快照变化或 compaction 移除时才记录进模型历史，
  // 比塞进静态系统提示词更省 token，也更符合「记忆标题是会变的上下文」的语义。）
  const sysPrompt = appCtx.get('systemPrompt')
  if (sysPrompt !== undefined && typeof sysPrompt.context === 'function') {
    const n = Number(process.env.DSH_MEMORY_PROMPT_LIMIT)
    const promptLimit = Number.isFinite(n) && n > 0 ? Math.floor(n) : 20
    appCtx.effect(() => sysPrompt.context({
      name: 'dsh-lite-memory.titles',
      order: 200,
      text: (assemblyCtx) => buildMemoryTitles(assemblyCtx && assemblyCtx.agent, promptLimit),
    }), 'dsh-lite-memory: dynamic context memory titles')
  }

  // 提醒轮询（每 30 秒）
  appCtx.effect(() => {
    const timer = appCtx.get('timer')
    if (timer !== undefined && typeof timer.interval === 'function') {
      return timer.interval(() => { void remindTick() }, 30000)
    }
    const id = setInterval(() => { void remindTick() }, 30000)
    return () => clearInterval(id)
  }, 'dsh-lite-memory: reminder poll')

  // 定时任务调度（每 30 秒一跳；按墙钟分钟去重，进程不在时错过的时刻直接丢弃）
  appCtx.effect(() => {
    const timer = appCtx.get('timer')
    if (timer !== undefined && typeof timer.interval === 'function') {
      return timer.interval(() => { void cronTick() }, 30000)
    }
    const id = setInterval(() => { void cronTick() }, 30000)
    return () => clearInterval(id)
  }, 'dsh-lite-memory: cron tick')

  // HTTP 路由
  appCtx.inject(['webServer'], (hostCtx) => {
    const writeJson = (res, status, body) => {
      const payload = JSON.stringify(body)
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      res.end(payload)
    }
    const sameOrigin = (req) => {
      const origin = req.headers.origin
      const host = req.headers.host
      if (origin === undefined || host === undefined) return false
      try { return new URL(origin).host === host } catch (e) { return false }
    }
    const readBody = (req) => new Promise((resolvePromise) => {
      const chunks = []
      let size = 0
      req.on('data', (chunk) => {
        size += chunk.length
        if (size > 512 * 1024) { resolvePromise(null); req.destroy(); return }
        chunks.push(chunk)
      })
      req.on('end', () => {
        try { resolvePromise(JSON.parse(Buffer.concat(chunks).toString('utf8'))) } catch (e) { resolvePromise(null) }
      })
      req.on('error', () => resolvePromise(null))
    })
    const queryOf = (req) => new URL(req.url, 'http://localhost').searchParams

    hostCtx.effect(() => hostCtx.webServer.register({
      kind: 'exact',
      path: '/dsh-lite-memory/entries',
      handler: (req, res) => {
        if (req.method !== 'GET') { res.writeHead(405, { allow: 'GET' }); res.end(); return }
        const q = queryOf(req)
        const scope = q.get('scope') === 'global' ? 'global' : 'project'
        writeJson(res, 200, { ok: true, entries: listEntries(scope, q.get('workspace') || '') })
      },
    }), 'dsh-lite-memory: entries route')

    hostCtx.effect(() => hostCtx.webServer.register({
      kind: 'exact',
      path: '/dsh-lite-memory/entries/add',
      handler: async (req, res) => {
        if (req.method !== 'POST') { res.writeHead(405, { allow: 'POST' }); res.end(); return }
        if (!sameOrigin(req)) { writeJson(res, 403, { ok: false, message: 'cross-origin request rejected' }); return }
        const body = await readBody(req)
        if (body === null) { writeJson(res, 400, { ok: false, message: 'bad request body' }); return }
        writeJson(res, 200, addEntry({ scope: body.scope, workspace: body.workspace || '', sessionId: body.sessionId || '', title: body.title, priority: body.priority, content: body.content, sourceType: body.sourceType }))
      },
    }), 'dsh-lite-memory: entries add route')

    hostCtx.effect(() => hostCtx.webServer.register({
      kind: 'exact',
      path: '/dsh-lite-memory/entries/update',
      handler: async (req, res) => {
        if (req.method !== 'POST') { res.writeHead(405, { allow: 'POST' }); res.end(); return }
        if (!sameOrigin(req)) { writeJson(res, 403, { ok: false, message: 'cross-origin request rejected' }); return }
        const body = await readBody(req)
        if (body === null) { writeJson(res, 400, { ok: false, message: 'bad request body' }); return }
        writeJson(res, 200, updateEntry({ id: body.id, title: body.title, priority: body.priority, content: body.content }))
      },
    }), 'dsh-lite-memory: entries update route')

    hostCtx.effect(() => hostCtx.webServer.register({
      kind: 'exact',
      path: '/dsh-lite-memory/entries/delete',
      handler: async (req, res) => {
        if (req.method !== 'POST') { res.writeHead(405, { allow: 'POST' }); res.end(); return }
        if (!sameOrigin(req)) { writeJson(res, 403, { ok: false, message: 'cross-origin request rejected' }); return }
        const body = await readBody(req)
        if (body === null) { writeJson(res, 400, { ok: false, message: 'bad request body' }); return }
        writeJson(res, 200, deleteEntry(body.id))
      },
    }), 'dsh-lite-memory: entries delete route')

    hostCtx.effect(() => hostCtx.webServer.register({
      kind: 'exact',
      path: '/dsh-lite-memory/workspace',
      handler: (req, res) => {
        if (req.method !== 'GET') { res.writeHead(405, { allow: 'GET' }); res.end(); return }
        const q = queryOf(req)
        const agents = appCtx.get('agents')
        const sid = q.get('sessionId') || ''
        if (agents !== undefined && sid) {
          const agent = agents.get(sid)
          if (agent) {
            const n = workspaceOf(agent)
            if (n) { writeJson(res, 200, { ok: true, workspace: n }); return }
          }
        }
        writeJson(res, 200, { ok: false, workspace: '' })
      },
    }), 'dsh-lite-memory: workspace route')

    hostCtx.effect(() => hostCtx.webServer.register({
      kind: 'exact',
      path: '/dsh-lite-memory/workspaces',
      handler: (req, res) => {
        if (req.method !== 'GET') { res.writeHead(405, { allow: 'GET' }); res.end(); return }
        const d = openDb()
        const rows = d.prepare("SELECT DISTINCT workspace FROM entries WHERE workspace != ''").all()
        const fromEntries = rows.map((r) => r.workspace)
        const fromCalendar = d.prepare("SELECT DISTINCT cwd FROM calendar WHERE cwd != ''").all().map((r) => baseName(r.cwd)).filter(Boolean)
        const all = [...new Set([...fromEntries, ...fromCalendar])].sort()
        writeJson(res, 200, { ok: true, workspaces: all })
      },
    }), 'dsh-lite-memory: workspaces route')

    hostCtx.effect(() => hostCtx.webServer.register({
      kind: 'exact',
      path: '/dsh-lite-memory/calendar',
      handler: (req, res) => {
        if (req.method !== 'GET') { res.writeHead(405, { allow: 'GET' }); res.end(); return }
        writeJson(res, 200, { ok: true, entries: readCalendar() })
      },
    }), 'dsh-lite-memory: calendar route')

    hostCtx.effect(() => hostCtx.webServer.register({
      kind: 'exact',
      path: '/dsh-lite-memory/calendar/add',
      handler: async (req, res) => {
        if (req.method !== 'POST') { res.writeHead(405, { allow: 'POST' }); res.end(); return }
        if (!sameOrigin(req)) { writeJson(res, 403, { ok: false, message: 'cross-origin request rejected' }); return }
        const body = await readBody(req)
        if (body === null) { writeJson(res, 400, { ok: false, message: 'bad request body' }); return }
        writeJson(res, 200, { ok: true, message: calendarAdd({ date: body.date, time: body.time, quadrant: body.quadrant, title: body.title, note: body.note, sessionId: body.sessionId || '', cwd: body.cwd || '' }) })
      },
    }), 'dsh-lite-memory: calendar add route')

    hostCtx.effect(() => hostCtx.webServer.register({
      kind: 'exact',
      path: '/dsh-lite-memory/calendar/done',
      handler: async (req, res) => {
        if (req.method !== 'POST') { res.writeHead(405, { allow: 'POST' }); res.end(); return }
        if (!sameOrigin(req)) { writeJson(res, 403, { ok: false, message: 'cross-origin request rejected' }); return }
        const body = await readBody(req)
        if (body === null) { writeJson(res, 400, { ok: false, message: 'bad request body' }); return }
        writeJson(res, 200, { ok: true, message: calendarSetDone(body.date, body.time, body.title, true) })
      },
    }), 'dsh-lite-memory: calendar done route')

    hostCtx.effect(() => hostCtx.webServer.register({
      kind: 'exact',
      path: '/dsh-lite-memory/calendar/remove',
      handler: async (req, res) => {
        if (req.method !== 'POST') { res.writeHead(405, { allow: 'POST' }); res.end(); return }
        if (!sameOrigin(req)) { writeJson(res, 403, { ok: false, message: 'cross-origin request rejected' }); return }
        const body = await readBody(req)
        if (body === null) { writeJson(res, 400, { ok: false, message: 'bad request body' }); return }
        writeJson(res, 200, { ok: true, message: calendarRemove(body.date, body.time, body.title) })
      },
    }), 'dsh-lite-memory: calendar remove route')

    hostCtx.effect(() => hostCtx.webServer.register({
      kind: 'exact',
      path: '/dsh-lite-memory/cron',
      handler: (req, res) => {
        if (req.method !== 'GET') { res.writeHead(405, { allow: 'GET' }); res.end(); return }
        writeJson(res, 200, { ok: true, jobs: readCronJobs(), running: [...activeCronRuns] })
      },
    }), 'dsh-lite-memory: cron list route')

    hostCtx.effect(() => hostCtx.webServer.register({
      kind: 'exact',
      path: '/dsh-lite-memory/cron/add',
      handler: async (req, res) => {
        if (req.method !== 'POST') { res.writeHead(405, { allow: 'POST' }); res.end(); return }
        if (!sameOrigin(req)) { writeJson(res, 403, { ok: false, message: 'cross-origin request rejected' }); return }
        const body = await readBody(req)
        if (body === null) { writeJson(res, 400, { ok: false, message: 'bad request body' }); return }
        writeJson(res, 200, cronAdd(body))
      },
    }), 'dsh-lite-memory: cron add route')

    hostCtx.effect(() => hostCtx.webServer.register({
      kind: 'exact',
      path: '/dsh-lite-memory/cron/update',
      handler: async (req, res) => {
        if (req.method !== 'POST') { res.writeHead(405, { allow: 'POST' }); res.end(); return }
        if (!sameOrigin(req)) { writeJson(res, 403, { ok: false, message: 'cross-origin request rejected' }); return }
        const body = await readBody(req)
        if (body === null) { writeJson(res, 400, { ok: false, message: 'bad request body' }); return }
        writeJson(res, 200, cronUpdate(body))
      },
    }), 'dsh-lite-memory: cron update route')

    hostCtx.effect(() => hostCtx.webServer.register({
      kind: 'exact',
      path: '/dsh-lite-memory/cron/remove',
      handler: async (req, res) => {
        if (req.method !== 'POST') { res.writeHead(405, { allow: 'POST' }); res.end(); return }
        if (!sameOrigin(req)) { writeJson(res, 403, { ok: false, message: 'cross-origin request rejected' }); return }
        const body = await readBody(req)
        if (body === null) { writeJson(res, 400, { ok: false, message: 'bad request body' }); return }
        writeJson(res, 200, cronRemove(body.id))
      },
    }), 'dsh-lite-memory: cron remove route')

    hostCtx.effect(() => hostCtx.webServer.register({
      kind: 'exact',
      path: '/dsh-lite-memory/cron/toggle',
      handler: async (req, res) => {
        if (req.method !== 'POST') { res.writeHead(405, { allow: 'POST' }); res.end(); return }
        if (!sameOrigin(req)) { writeJson(res, 403, { ok: false, message: 'cross-origin request rejected' }); return }
        const body = await readBody(req)
        if (body === null) { writeJson(res, 400, { ok: false, message: 'bad request body' }); return }
        writeJson(res, 200, cronToggle(body.id, body.enabled !== false))
      },
    }), 'dsh-lite-memory: cron toggle route')

    hostCtx.effect(() => hostCtx.webServer.register({
      kind: 'exact',
      path: '/dsh-lite-memory/cron/run',
      handler: async (req, res) => {
        if (req.method !== 'POST') { res.writeHead(405, { allow: 'POST' }); res.end(); return }
        if (!sameOrigin(req)) { writeJson(res, 403, { ok: false, message: 'cross-origin request rejected' }); return }
        const body = await readBody(req)
        if (body === null) { writeJson(res, 400, { ok: false, message: 'bad request body' }); return }
        const job = findCronJob(body.id)
        if (job === null) { writeJson(res, 200, { ok: false, message: '定时任务不存在' }); return }
        writeJson(res, 200, await fireCronJob(job, 'manual'))
      },
    }), 'dsh-lite-memory: cron run route')

    hostCtx.effect(() => hostCtx.webServer.register({
      kind: 'exact',
      path: '/dsh-lite-memory/cron/runs',
      handler: (req, res) => {
        if (req.method !== 'GET') { res.writeHead(405, { allow: 'GET' }); res.end(); return }
        const q = queryOf(req)
        const jobId = q.get('jobId')
        writeJson(res, 200, { ok: true, runs: cronRuns(jobId ? Number(jobId) : null, q.get('limit')) })
      },
    }), 'dsh-lite-memory: cron runs route')

    hostCtx.effect(() => hostCtx.webServer.register({
      kind: 'exact',
      path: '/dsh-lite-memory/cron/preview',
      handler: async (req, res) => {
        if (req.method !== 'POST') { res.writeHead(405, { allow: 'POST' }); res.end(); return }
        if (!sameOrigin(req)) { writeJson(res, 403, { ok: false, message: 'cross-origin request rejected' }); return }
        const body = await readBody(req)
        if (body === null) { writeJson(res, 400, { ok: false, message: 'bad request body' }); return }
        const expr = String(body.expr || '').trim()
        const desc = describeCron(expr)
        if (desc.kind === 'invalid') { writeJson(res, 200, { ok: true, valid: false, description: desc, next: [] }); return }
        writeJson(res, 200, { ok: true, valid: true, description: desc, next: nextRuns(expr, Date.now(), 5) || [] })
      },
    }), 'dsh-lite-memory: cron preview route')

    hostCtx.effect(() => hostCtx.webServer.register({
      kind: 'exact',
      path: '/dsh-lite-memory/cron/workspaces',
      handler: (req, res) => {
        if (req.method !== 'GET') { res.writeHead(405, { allow: 'GET' }); res.end(); return }
        writeJson(res, 200, Object.assign({ ok: true }, listWorkspaceOptions()))
      },
    }), 'dsh-lite-memory: cron workspaces route')

    hostCtx.effect(() => hostCtx.webServer.register({
      kind: 'exact',
      path: '/dsh-lite-memory/cron/models',
      handler: async (req, res) => {
        if (req.method !== 'GET') { res.writeHead(405, { allow: 'GET' }); res.end(); return }
        const q = queryOf(req)
        try {
          const data = await listModelOptions(q.get('refresh') === '1')
          writeJson(res, 200, Object.assign({ ok: true }, data))
        } catch (e) {
          writeJson(res, 200, { ok: false, message: e && e.message ? e.message : String(e), default: null, providers: [] })
        }
      },
    }), 'dsh-lite-memory: cron models route')

    hostCtx.effect(() => hostCtx.webServer.register({
      kind: 'exact',
      path: '/dsh-lite-memory/cron/model-info',
      handler: async (req, res) => {
        if (req.method !== 'POST') { res.writeHead(405, { allow: 'POST' }); res.end(); return }
        if (!sameOrigin(req)) { writeJson(res, 403, { ok: false, message: 'cross-origin request rejected' }); return }
        const body = await readBody(req)
        if (body === null) { writeJson(res, 400, { ok: false, message: 'bad request body' }); return }
        const info = await resolveCronModelInfo(body.provider, body.model)
        writeJson(res, 200, Object.assign({ ok: info.error === '' }, info))
      },
    }), 'dsh-lite-memory: cron model-info route')

    hostCtx.effect(() => hostCtx.webServer.register({
      kind: 'exact',
      path: '/dsh-lite-memory/status',
      handler: (req, res) => {
        if (req.method !== 'GET') { res.writeHead(405, { allow: 'GET' }); res.end(); return }
        writeJson(res, 200, { ok: true, home: dshHome(), dbFile: dbFile() })
      },
    }), 'dsh-lite-memory: status route')
  })
}
