/**
 * dsh-lite-memory —— Host 面
 *
 * DSH 简化版记忆插件（参考 @a9i5k4/dsh-auto-memory 裁剪）：
 *  - 两级记忆：全局（~/.dsh/memory/MEMORY.md）+ 项目（~/.dsh/memory/workspaces/{工作区}/MEMORY.md）
 *  - 工具：memory_recall（关键词检索）/ memory_write（append/replace，带卫生检查）
 *  - 日历：~/.dsh/memory/calendar.json + calendar_add/list/done/remove
 *  - 到点提醒：每 30 秒轮询，未完成且未提醒的事项投递到注册会话（agent.followup）；
 *    会话被移除时新建会话投递（agents.create，保留）。
 *  - 无系统提示词注入、无自动沉淀、无反思/日志、无外观设置；语言跟随 DSH 设置（Client 侧）。
 *
 * 路由（POST 均做同源保护）：
 *   GET  /dsh-lite-memory/read?scope=global|project&workspace=&sessionId=
 *   POST /dsh-lite-memory/write       { scope, workspace, action, content }
 *   GET  /dsh-lite-memory/workspace?sessionId=    当前会话的工作区名
 *   GET  /dsh-lite-memory/workspaces              全部工作区名列表
 *   GET  /dsh-lite-memory/calendar                日历条目
 *   POST /dsh-lite-memory/calendar/add             { date, time, quadrant, title, note }
 *   POST /dsh-lite-memory/calendar/done            { date, time, title }
 *   POST /dsh-lite-memory/calendar/remove          { date, time, title }
 *   GET  /dsh-lite-memory/status                  存储位置状态
 */
import { readFileSync, existsSync, mkdirSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, basename, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'

export const name = 'dsh-lite-memory'
export const inject = ['agentPresets', 'timer', 'webServer', 'tools', 'agents']

// ────────────────────────────────────────────────────────────────────────────
// 路径
// ────────────────────────────────────────────────────────────────────────────

function dshHome() {
  const env = process.env.DSH_HOME
  if (env !== undefined && String(env).trim().length > 0) return resolve(String(env).trim())
  return join(homedir(), '.dsh')
}
const memoryRoot = () => join(dshHome(), 'memory')
const globalFile = () => join(memoryRoot(), 'MEMORY.md')
const calendarFile = () => join(memoryRoot(), 'calendar.json')
const workspaceDir = (name) => join(memoryRoot(), 'workspaces', String(name || '').replace(/[\\/]/g, '_'))
const projectFile = (name) => join(workspaceDir(name), 'MEMORY.md')

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
// 文件读写（node 内置）
// ────────────────────────────────────────────────────────────────────────────

function readTextSafe(path) {
  try {
    if (!existsSync(path)) return ''
    return readFileSync(path, 'utf8')
  } catch (e) { return '' }
}
function writeTextSafe(path, content) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content, 'utf8')
}
function listDirSafe(path) {
  try {
    if (!existsSync(path) || !statSync(path).isDirectory()) return []
    return readdirSync(path).filter((n) => !n.startsWith('.'))
  } catch (e) { return [] }
}

// ────────────────────────────────────────────────────────────────────────────
// 卫生检查（简化版：乱码 / 重复行）
// ────────────────────────────────────────────────────────────────────────────

const MOJIBAKE_PATTERNS = [
  /\uFFFD/,
  /锟斤拷|烫烫烫|屯屯屯|锘挎/,
  /杩涜涓|鐨勶紝|鐨剢|镄勶紝/,
  /[\uFF00-\uFFEF]{4,}/,
]

function sanitizeForWrite(content, maxChars) {
  const text = String(content || '')
  if (!text.trim()) return { ok: false, reason: '内容为空' }
  if (text.length > (maxChars || 200000)) return { ok: false, reason: '内容超长' }
  const lines = text.split(/\r?\n/)
  let dup = 0
  let prev = ''
  for (const line of lines) {
    const t = line.trim()
    if (t && t === prev) {
      dup += 1
      if (dup >= 2) return { ok: false, reason: '存在连续重复行' }
    } else {
      dup = 0
    }
    prev = t
  }
  for (const re of MOJIBAKE_PATTERNS) {
    if (re.test(text)) return { ok: false, reason: '疑似乱码内容' }
  }
  return { ok: true }
}

// ────────────────────────────────────────────────────────────────────────────
// 记忆读写与检索
// ────────────────────────────────────────────────────────────────────────────

function resolveScopePaths(scope, workspace) {
  if (scope === 'project') {
    if (!workspace) return { error: 'project 记忆需要 workspace 名' }
    return { file: projectFile(workspace), label: '项目记忆[' + workspace + ']' }
  }
  return { file: globalFile(), label: '全局记忆' }
}

function memoryRead(scope, workspace) {
  const p = resolveScopePaths(scope, workspace)
  if (p.error) return { ok: false, message: p.error }
  const content = readTextSafe(p.file)
  return { ok: true, path: p.file, label: p.label, content }
}

function memoryWrite(scope, workspace, action, content) {
  const p = resolveScopePaths(scope, workspace)
  if (p.error) return { ok: false, message: p.error }
  const text = String(content || '').trim()
  if (!text) return { ok: false, message: '写入内容为空' }
  const maxChars = action === 'replace' ? 200000 : 8000
  const gate = sanitizeForWrite(text, maxChars)
  if (!gate.ok) return { ok: false, message: '写入被卫生检查拦截: ' + gate.reason }
  const existing = readTextSafe(p.file)
  let body
  if (action === 'replace' || !existing) {
    body = text
  } else {
    body = existing.replace(/\n?$/, '\n') + '\n## ' + todayStr() + '\n' + text + '\n'
  }
  writeTextSafe(p.file, body)
  return { ok: true, path: p.file, label: p.label }
}

function memoryRecall(query, workspace, limit) {
  const q = String(query || '').trim()
  if (!q) return 'memory_recall: query 不能为空。'
  const max = Math.min(Math.max(Number(limit) || 8, 1), 30)
  const words = q.split(/\s+/).filter(Boolean)
  const hits = []
  const targets = [{ file: globalFile(), label: '全局记忆' }]
  const allWs = workspace ? [String(workspace)] : []
  if (!workspace) {
    allWs.push(...listDirSafe(join(memoryRoot(), 'workspaces')))
  }
  for (const ws of allWs) {
    if (ws) targets.push({ file: projectFile(ws), label: '项目记忆[' + ws + ']' })
  }
  for (const t of targets) {
    const content = readTextSafe(t.file)
    if (!content) continue
    const lines = content.split(/\r?\n/)
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i]
      if (!line.trim()) continue
      const lower = line.toLowerCase()
      if (words.every((w) => lower.includes(String(w).toLowerCase()))) {
        const ctxLines = lines.slice(Math.max(0, i - 1), Math.min(lines.length, i + 2)).join(' | ')
        hits.push({ label: t.label, line: line.trim(), context: ctxLines.trim().slice(0, 300) })
      }
    }
  }
  if (!hits.length) return '未在记忆中找到与「' + q + '」相关的内容（已检索: ' + targets.map((t) => t.label).join(', ') + '）。'
  const out = ['记忆检索「' + q + '」命中 ' + hits.length + ' 处（来源: ' + targets.map((t) => t.label).join(', ') + '）:']
  for (const h of hits.slice(0, max)) {
    out.push('· [' + h.label + '] ' + h.line)
    if (h.context !== h.line) out.push('  ↳ ' + h.context)
  }
  if (hits.length > max) out.push('…共 ' + hits.length + ' 处，仅显示前 ' + max + ' 处。')
  return out.join('\n')
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
function readCalendar() {
  const raw = readTextSafe(calendarFile())
  if (!raw) return []
  try {
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr : []
  } catch (e) { return [] }
}
function writeCalendar(entries) {
  writeTextSafe(calendarFile(), JSON.stringify(entries, null, 2))
}
function calId() { return 'cal-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6) }

const QUADRANTS = ['重要紧急', '重要不紧急', '紧急不重要', '不重要不紧急']

function calendarAdd(item) {
  const entries = readCalendar()
  const entry = {
    id: calId(),
    date: item.date || todayStr(),
    time: item.time || '--:--',
    quadrant: QUADRANTS.includes(item.quadrant) ? item.quadrant : '重要不紧急',
    title: String(item.title || '').trim(),
    note: String(item.note || '').trim(),
    done: false,
    reminded: false,
    sessionId: item.sessionId || '',
    cwd: item.cwd || '',
    createdAt: Date.now(),
  }
  if (!entry.title) return 'calendar_add: title 不能为空。'
  entries.push(entry)
  writeCalendar(entries)
  return '已把「' + entry.title + '」记入日历（' + entry.date + ' ' + entry.time + '，' + entry.quadrant + '）。'
}
function calendarList(dateFilter) {
  const entries = readCalendar()
  const target = dateFilter ? String(dateFilter) : ''
  const list = entries.filter((en) => !target || en.date === target)
  if (!list.length) return '日历为空' + (target ? ' (' + target + ')' : '') + '。'
  const lines = ['日历条目(' + list.length + ' 个):']
  for (const en of list.slice().sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time)).slice(0, 40)) {
    lines.push('· ' + (en.done ? '[完成] ' : '[待办] ') + en.date + ' ' + en.time + ' | ' + en.quadrant + ' | ' + en.title + (en.note ? ' (' + en.note + ')' : ''))
  }
  return lines.join('\n')
}
function calendarSetDone(date, time, title, done) {
  const entries = readCalendar()
  let hit = 0
  for (const en of entries) {
    if ((!date || en.date === date) && (!time || en.time === time) && (!title || en.title === title)) {
      en.done = !!done
      hit += 1
    }
  }
  if (!hit) return '未找到匹配的日历条目（date=' + (date || '任意') + ' time=' + (time || '任意') + ' title=' + (title || '任意') + '）。'
  writeCalendar(entries)
  return '已' + (done ? '标记完成' : '恢复待办') + ' ' + hit + ' 条日历条目。'
}
function calendarRemove(date, time, title) {
  const entries = readCalendar()
  const kept = entries.filter((en) => !((!date || en.date === date) && (!time || en.time === time) && (!title || en.title === title)))
  const removed = entries.length - kept.length
  if (!removed) return '未找到匹配的日历条目。'
  writeCalendar(kept)
  return '已删除 ' + removed + ' 条日历条目。'
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
    const entries = readCalendar()
    const now = todayStr()
    const time = nowTime()
    let changed = false
    for (const en of entries) {
      if (en.done || en.reminded) continue
      if (en.date > now) continue
      if (en.date === now && en.time !== '--:--' && en.time > time) continue
      en.reminded = true
      changed = true
      const ok = await deliverReminder(en)
      if (!ok) console.error('[dsh-lite-memory] reminder delivery failed for ' + en.id)
    }
    if (changed) writeCalendar(entries)
  } catch (e) {
    console.error('[dsh-lite-memory] remindTick error: ' + (e && e.message ? e.message : String(e)))
  }
}

// ────────────────────────────────────────────────────────────────────────────
// 工具定义（bundle 版：dsh-tools 的 defineTool，schema DSL 属性级 required）
// ────────────────────────────────────────────────────────────────────────────

let ctx // 模块级持有，供 deliverReminder 使用

async function registerTools(ctx) {
  const tools = ctx.get('tools')
  if (tools === undefined) {
    console.warn('[dsh-lite-memory] tools 服务不可用，记忆工具未注册（插件 inject 应包含 tools）')
    return []
  }
  let defineTool = null
  try {
    // 与 dsh-updater-npm 相同的定位法：从 agentPresets 的 preset 路径反推 dsh 安装目录
    let installDir = null
    try {
      const presets = ctx.get('agentPresets')
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

  makeTool('memory_recall', '检索记忆文件（全局记忆 ~/.dsh/memory/MEMORY.md + 全部工作区项目记忆，可指定单个工作区）。关键词逐字匹配，返回命中行及上下文、标注来源。开发/排查中遇到不懂的、用户提到过去做法而当前上下文没有时调用。检索后应在回复正文中向用户转述检索结果。', {
    query: { type: 'string', required: true, description: '检索关键词，多个词用空格分隔（全部命中才算）。' },
    workspace: { type: 'string', description: '指定工作区名（如 dsh）；缺省检索全部工作区 + 全局。' },
    limit: { type: 'integer', description: '最多返回条数，缺省 8。' },
  }, (args) => memoryRecall(args.query, args.workspace, args.limit))

  makeTool('memory_write', '写入记忆。scope=global 写入全局记忆（~/.dsh/memory/MEMORY.md，跨所有项目）；scope=project 写入当前工作区项目记忆（~/.dsh/memory/workspaces/{工作区}/MEMORY.md）。action=append 追加一段（自动带日期标题）；action=replace 整体替换。写入内容应为第三人称客观陈述。写入成功后应在回复正文中向用户转述写了什么。', {
    scope: { type: 'string', enum: ['global', 'project'], required: true, description: '写入目标: global=全局记忆, project=当前工作区项目记忆。' },
    action: { type: 'string', enum: ['append', 'replace'], description: 'append=追加（默认）, replace=整体替换。' },
    content: { type: 'string', required: true, description: '要写入的内容（append 时单条 ≤8000 字，replace 整篇 ≤20 万字）。' },
    workspace: { type: 'string', description: '指定工作区名（仅 scope=project 时可选，缺省当前工作区）。' },
  }, (args, exec) => {
    const ws = args.workspace || workspaceOf(exec && exec.agent)
    const res = memoryWrite(args.scope, ws, args.action === 'replace' ? 'replace' : 'append', args.content)
    if (!res.ok) return 'memory_write: ' + res.message
    return '已写入' + res.label + ': ' + res.path + (args.action === 'replace' ? '（整篇替换）' : '')
  })

  makeTool('calendar_add', '向日历添加事项（存 ~/.dsh/memory/calendar.json，跨会话有效）。从对话中提取 deadline、约定时间、任务节点时主动调用。调用后必须在回复正文中向用户转述: 已把 X 记入日历。', {
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

  return disposers
}

// ────────────────────────────────────────────────────────────────────────────
// apply
// ────────────────────────────────────────────────────────────────────────────

export function apply(appCtx) {
  ctx = appCtx

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
      path: '/dsh-lite-memory/read',
      handler: (req, res) => {
        if (req.method !== 'GET') { res.writeHead(405, { allow: 'GET' }); res.end(); return }
        const q = queryOf(req)
        writeJson(res, 200, memoryRead(q.get('scope') === 'project' ? 'project' : 'global', q.get('workspace') || ''))
      },
    }), 'dsh-lite-memory: read route')

    hostCtx.effect(() => hostCtx.webServer.register({
      kind: 'exact',
      path: '/dsh-lite-memory/write',
      handler: async (req, res) => {
        if (req.method !== 'POST') { res.writeHead(405, { allow: 'POST' }); res.end(); return }
        if (!sameOrigin(req)) { writeJson(res, 403, { ok: false, message: 'cross-origin request rejected' }); return }
        const body = await readBody(req)
        if (body === null) { writeJson(res, 400, { ok: false, message: 'bad request body' }); return }
        writeJson(res, 200, memoryWrite(body.scope === 'project' ? 'project' : 'global', body.workspace || '', body.action === 'replace' ? 'replace' : 'append', body.content))
      },
    }), 'dsh-lite-memory: write route')

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
        writeJson(res, 200, { ok: true, workspaces: listDirSafe(join(memoryRoot(), 'workspaces')) })
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
        writeJson(res, 200, { ok: true, home: dshHome(), globalFile: globalFile(), calendarFile: calendarFile() })
      },
    }), 'dsh-lite-memory: status route')
  })
}
