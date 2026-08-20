/**
 * dsh-lite-memory —— Host 面（SQLite 版）
 *
 * DSH 简化版记忆插件（参考 @a9i5k4/dsh-auto-memory 裁剪）：
 *  - SQLite 存储：~/.dsh/memory/memory.db（表 entries / calendar），不再读写 MEMORY.md / calendar.json
 *  - 记忆条目：标题 / 内容 / 重要程度（高/中/低）/ 来源（工作区-会话）/ 创建更新时间，按条目增删改
 *  - 工具：memory_recall（检索条目）/ memory_entry（条目增删改查）
 *  - 日历：calendar_add/list/done/remove；到点提醒投递注册会话（会话移除则新建会话投递）
 *  - 无系统提示词注入、无自动沉淀、无反思/日志、无外观设置；语言跟随 DSH 设置（Client 侧）。
 *
 * 路由（POST 均做同源保护）：
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
 */
import { DatabaseSync } from 'node:sqlite'
import { existsSync, mkdirSync, statSync } from 'node:fs'
import { join, dirname, basename } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'

export const name = 'dsh-lite-memory'
export const inject = ['agentPresets', 'timer', 'webServer', 'tools', 'agents']

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
  const rows = d.prepare(
    'SELECT id, scope, workspace, session_id, title, priority, content, created_at, updated_at, source_type FROM entries WHERE scope = ? AND workspace = ? ORDER BY updated_at DESC'
  ).all(scope === 'project' ? 'project' : 'global', workspace || '')
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
  return { ok: true, message: '已更新记忆条目「' + t + '」' }
}

function deleteEntry(id) {
  const d = openDb()
  const info = d.prepare('DELETE FROM entries WHERE id = ?').run(Number(id))
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
    const handle = await agents.create({
      sessionId: newId,
      meta: { cwd: entry.cwd || undefined, ...(presetId ? { agentPreset: presetId } : {}) },
    })
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
    const ws = args.workspace || workspaceOf(exec && exec.agent)
    const scope = args.scope === 'global' ? 'global' : 'project'
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
    lines.push('最近写入: ' + (s.latestEntryAt ? dateStrOf(s.latestEntryAt) + ' ' + new Date(s.latestEntryAt).toTimeString().slice(0, 5) : '(无)'))
    return lines.join('\n')
  })

  makeTool('memory_range', '按时间范围检索记忆条目（基于最近更新时间），返回条目的标题、时间与重要程度集合（按 高/中/低 分组）。用于回答「这段时间记了什么」「最近一周有哪些重要事项」等问题。', {
    start: { type: 'string', description: '起始时间 YYYY-MM-DD 或 YYYY-MM-DD HH:MM，缺省不限。' },
    end: { type: 'string', description: '结束时间 YYYY-MM-DD 或 YYYY-MM-DD HH:MM，缺省不限。' },
    workspace: { type: 'string', description: '限定工作区名（如 dsh）；缺省全部工作区 + 全局。' },
    limit: { type: 'integer', description: '最多返回条数，缺省 50。' },
  }, (args) => memoryRange(args.start, args.end, args.workspace, args.limit))

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
      console.log('[dsh-lite-memory] 已注册 ' + ds.length + ' 个记忆/日历工具')
    }).catch((e) => {
      console.error('[dsh-lite-memory] 工具注册失败: ' + (e && e.message ? e.message : String(e)))
    })
    return () => {
      disposers.forEach((d) => { try { d() } catch (e) { /* 忽略 */ } })
      disposers = []
    }
  }, 'dsh-lite-memory: tools')

  // 提醒轮询（每 30 秒）
  appCtx.effect(() => {
    const timer = appCtx.get('timer')
    if (timer !== undefined && typeof timer.interval === 'function') {
      return timer.interval(() => { void remindTick() }, 30000)
    }
    const id = setInterval(() => { void remindTick() }, 30000)
    return () => clearInterval(id)
  }, 'dsh-lite-memory: reminder poll')

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
      path: '/dsh-lite-memory/status',
      handler: (req, res) => {
        if (req.method !== 'GET') { res.writeHead(405, { allow: 'GET' }); res.end(); return }
        writeJson(res, 200, { ok: true, home: dshHome(), dbFile: dbFile() })
      },
    }), 'dsh-lite-memory: status route')
  })
}
