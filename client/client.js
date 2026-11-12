// dsh-lite-memory —— Client 面（浏览器 bundle，SQLite 版）
//
// 对话视图新增「记忆」tab：条目化记忆面板（标题/重要程度/来源/内容，增删改查）。
// 设置页「记忆」分区：二级菜单（记忆 / 日历 / 定时）；日历为月视图+当天时间轴+浮层编辑，
// 面板下方「待执行」「已完成」双 tab 纵向列表；定时为 cron 任务列表 + 详情表单 +
// 表达式实时预览（未来 5 次）+ 执行记录，支持手动新增/编辑/删除/启停/立即运行。
// 中英双语：跟随 DSH 设置的语言（locale 字典），无手动外观设置、默认字号。
// 与宿主端通过同源 HTTP 路由通信（/dsh-lite-memory/*）。
window.__ModuleLoader__.load({
  id: "dsh-lite-memory",
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" })
    var react = require("react")

    var name = "dsh-lite-memory"
    var inject = ["slots", "locale"]

    // ── 中英字典 ──────────────────────────────────────────────────────────────
    var NS = "dsh-lite-memory"
    var zhDict = {
      nav: "记忆",
      subMemory: "记忆",
      subCalendar: "日历",
      globalTab: "全局",
      projectTab: "项目",
      workspace: "工作区",
      noWorkspace: "当前会话没有工作区",
      addEntry: "添加条目",
      editEntry: "编辑条目",
      title: "标题",
      priority: "重要程度",
      pHigh: "高",
      pMid: "中",
      pLow: "低",
      content: "内容",
      source: "来源",
      save: "保存",
      cancel: "取消",
      edit: "编辑",
      del: "删除",
      refresh: "刷新",
      empty: "暂无记忆条目",
      titleRequired: "标题不能为空",
      contentRequired: "内容不能为空",
      itemTitle: "条目标题…",
      itemContent: "内容（第三人称客观陈述）…",
      saved: "已保存 ✓",
      saving: "保存中…",
      loading: "加载中…",
      calTitle: "日历",
      date: "日期",
      time: "时间",
      quadrant: "象限",
      note: "备注",
      optional: "可选",
      adding: "添加中…",
      add: "添加事项",
      today: "今天",
      done: "完成",
      pendingTab: "待执行",
      doneTab: "已完成",
      noPending: "暂无待执行事项",
      noDone: "暂无已完成事项",
      restore: "恢复",
      detail: "补充说明（可选）",
      clickAdd: "点击添加事件",
      daySchedule: "当天安排",
      sourceUser: "用户",
      sourceAgent: "工具",
      collapseAll: "全部折叠",
      expandAll: "全部展开",
      monthUnits: "个月",
      entryUnits: "条",
      totalEntries: "条目",
      highEntries: "高优先级",
      qUrgentImportant: "重要紧急",
      qImportant: "重要不紧急",
      qUrgent: "紧急不重要",
      qNone: "不重要不紧急",
      // ── 定时任务 ──
      subCron: "定时",
      cronAdd: "新增定时任务",
      cronEdit: "编辑定时任务",
      cronName: "任务名",
      cronNamePh: "如：每日代码巡检",
      cronExpr: "cron 表达式",
      cronExprPh: "分 时 日 月 周，如 0 9 * * *",
      cronPrompt: "提示词",
      cronPromptPh: "到点让 agent 做什么…",
      cronCwd: "工作目录",
      cronPreset: "Preset",
      cronProvider: "模型 provider",
      cronModel: "模型",
      cronEffort: "推理强度",
      cronTarget: "触发落点",
      cronTargetNew: "新建会话",
      cronTargetSession: "投递到当前会话",
      cronTimeout: "超时（秒）",
      cronNone: "（默认）",
      cronWorkspace: "工作区",
      cronWorkspaceDefault: "默认（dsh web 进程目录）",
      cronModelLabel: "模型",
      cronModelDefault: "默认（跟随部署）",
      cronModelLoading: "加载模型列表…",
      cronNameOptional: "任务名（可选）",
      cronNameAuto: "留空自动取提示词前 20 字",
      cronEffortLabel: "推理强度",
      cronEffortDefault: "默认",
      cronAdvanced: "高级设置",
      cronAdvancedHide: "收起高级",
      cronRefreshList: "刷新列表",
      cronProviderPh: "provider",
      cronModelPh: "model",
      cronRouteHint: "模型路由只对「新建会话」生效；投递型任务沿用目标会话自身的模型。留空即用默认路由。",
      cronNext: "下次",
      cronLast: "上次",
      cronNever: "不会触发",
      cronRunNow: "立即运行",
      cronEnable: "启用",
      cronDisable: "停用",
      cronRecords: "执行记录",
      cronNoJobs: "暂无定时任务",
      cronNoRuns: "暂无执行记录",
      cronExprRequired: "cron 表达式无效，需 5 字段（分 时 日 月 周）",
      cronPromptRequired: "提示词不能为空",
      cronHint: "仅在 dsh web 进程运行时触发；关闭期间错过的时刻不会补跑。",
      cronPresetHint: "无人值守执行：请确认所选 preset 的审批策略与工具限制，否则任务可能卡在审批上。",
      cronPreview: "接下来 5 次：",
      cronQuick: "常用",
      cronQuickDaily: "每天",
      cronQuickWeekly: "每周",
      cronQuickMonthly: "每月",
      cronQuickHourly: "每小时",
      cronQuickEveryN: "每 N 分钟",
      cronQuickCustom: "自定义",
      cronWeek: "星期",
      cronDay: "日",
      cronMinuteOfHour: "分钟",
      cronIntervalMin: "间隔（分钟）",
      cronTime: "时间",
      cronDescEveryMinute: "每分钟",
      cronDescEveryN: "每 {n} 分钟",
      cronDescHourly: "每小时第 {m} 分",
      cronDescDaily: "每天 {time}",
      cronDescWeekly: "每{week} {time}",
      cronDescMonthly: "每月 {day} 日 {time}",
      cronInvalid: "表达式无效",
      week0: "周日",
      week1: "周一",
      week2: "周二",
      week3: "周三",
      week4: "周四",
      week5: "周五",
      week6: "周六",
      stRunning: "运行中",
      stOk: "成功",
      stErr: "失败",
      stTimeout: "超时",
      stDelivered: "已投递",
      stSkipped: "已跳过",
      stNone: "未运行",
      cronElapsed: "耗时",
      cronOpenSession: "会话",
    }
    var enDict = {
      nav: "Memory",
      subMemory: "Memory",
      subCalendar: "Calendar",
      globalTab: "Global",
      projectTab: "Project",
      workspace: "Workspace",
      noWorkspace: "No workspace in this session",
      addEntry: "Add entry",
      editEntry: "Edit entry",
      title: "Title",
      priority: "Priority",
      pHigh: "High",
      pMid: "Mid",
      pLow: "Low",
      content: "Content",
      source: "Source",
      save: "Save",
      cancel: "Cancel",
      edit: "Edit",
      del: "Del",
      refresh: "Refresh",
      empty: "No memory entries",
      titleRequired: "Title required",
      contentRequired: "Content required",
      itemTitle: "Entry title…",
      itemContent: "Content…",
      saved: "Saved ✓",
      saving: "Saving…",
      loading: "Loading…",
      calTitle: "Calendar",
      date: "Date",
      time: "Time",
      quadrant: "Quadrant",
      note: "Note",
      optional: "Optional",
      adding: "Adding…",
      add: "Add",
      today: "Today",
      done: "Done",
      pendingTab: "Pending",
      doneTab: "Done",
      noPending: "No pending items",
      noDone: "No completed items",
      restore: "Undo",
      detail: "Details (optional)",
      clickAdd: "Click to add event",
      daySchedule: "Day schedule",
      sourceUser: "User",
      sourceAgent: "Agent",
      collapseAll: "Collapse all",
      expandAll: "Expand all",
      monthUnits: "mo",
      entryUnits: "entries",
      totalEntries: "Entries",
      highEntries: "High priority",
      qUrgentImportant: "Urgent & important",
      qImportant: "Important",
      qUrgent: "Urgent",
      qNone: "Neither",
      // ── scheduled tasks ──
      subCron: "Scheduled",
      cronAdd: "New task",
      cronEdit: "Edit task",
      cronName: "Name",
      cronNamePh: "e.g. Daily code review",
      cronExpr: "cron expression",
      cronExprPh: "min hour day month weekday, e.g. 0 9 * * *",
      cronPrompt: "Prompt",
      cronPromptPh: "What should the agent do at that time…",
      cronCwd: "Working dir",
      cronPreset: "Preset",
      cronProvider: "Provider",
      cronModel: "Model",
      cronEffort: "Reasoning",
      cronTarget: "Delivery",
      cronTargetNew: "New session",
      cronTargetSession: "Current session",
      cronTimeout: "Timeout (s)",
      cronNone: "(default)",
      cronWorkspace: "Workspace",
      cronWorkspaceDefault: "Default (dsh web process cwd)",
      cronModelLabel: "Model",
      cronModelDefault: "Default (follow deployment)",
      cronModelLoading: "Loading models…",
      cronNameOptional: "Name (optional)",
      cronNameAuto: "Blank = first 20 chars of the prompt",
      cronEffortLabel: "Reasoning",
      cronEffortDefault: "Default",
      cronAdvanced: "Advanced",
      cronAdvancedHide: "Hide advanced",
      cronRefreshList: "Refresh",
      cronProviderPh: "provider",
      cronModelPh: "model",
      cronRouteHint: "Model routing applies to new sessions only; delivered runs keep the target session's model. Blank = default route.",
      cronNext: "Next",
      cronLast: "Last",
      cronNever: "never",
      cronRunNow: "Run now",
      cronEnable: "Enable",
      cronDisable: "Disable",
      cronRecords: "History",
      cronNoJobs: "No scheduled tasks",
      cronNoRuns: "No runs yet",
      cronExprRequired: "Invalid cron expression: 5 fields required",
      cronPromptRequired: "Prompt required",
      cronHint: "Only fires while the dsh web process is running; missed minutes are dropped.",
      cronPresetHint: "Unattended run: check the preset's approval policy and tool limits, or the task may stall on approval.",
      cronPreview: "Next 5 runs:",
      cronQuick: "Preset",
      cronQuickDaily: "Daily",
      cronQuickWeekly: "Weekly",
      cronQuickMonthly: "Monthly",
      cronQuickHourly: "Hourly",
      cronQuickEveryN: "Every N min",
      cronQuickCustom: "Custom",
      cronWeek: "Weekday",
      cronDay: "Day",
      cronMinuteOfHour: "Minute",
      cronIntervalMin: "Interval (min)",
      cronTime: "Time",
      cronDescEveryMinute: "every minute",
      cronDescEveryN: "every {n} min",
      cronDescHourly: "hourly at :{m}",
      cronDescDaily: "daily {time}",
      cronDescWeekly: "{week} {time}",
      cronDescMonthly: "day {day} of month {time}",
      cronInvalid: "invalid expression",
      week0: "Sun",
      week1: "Mon",
      week2: "Tue",
      week3: "Wed",
      week4: "Thu",
      week5: "Fri",
      week6: "Sat",
      stRunning: "running",
      stOk: "ok",
      stErr: "failed",
      stTimeout: "timeout",
      stDelivered: "delivered",
      stSkipped: "skipped",
      stNone: "never run",
      cronElapsed: "took",
      cronOpenSession: "session",
    }

    // ── 工具 ──────────────────────────────────────────────────────────────────
    function translate(dict, key, params) {
      var tmpl = dict[key] !== undefined ? dict[key] : key
      if (params) {
        for (var k in params) {
          tmpl = String(tmpl).split("{" + k + "}").join(String(params[k]))
        }
      }
      return tmpl
    }

    function call(method, params) {
      var url = "/dsh-lite-memory/" + method
      if (params) {
        var qs = Object.keys(params).map(function (k) { return encodeURIComponent(k) + "=" + encodeURIComponent(params[k]) }).join("&")
        if (qs) url += "?" + qs
      }
      return fetch(url, { cache: "no-store", signal: AbortSignal.timeout(15000) }).then(function (r) { return r.json() })
    }
    function post(method, body) {
      return fetch("/dsh-lite-memory/" + method, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body || {}),
        cache: "no-store",
        signal: AbortSignal.timeout(15000),
      }).then(function (r) { return r.json() })
    }

    var PRIORITY_COLORS = { "高": "#d64545", "中": "#e6a23c", "低": "#8a94a6" }

    function fmtTime(ts) {
      if (!ts) return ""
      var d = new Date(ts)
      return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0") + " " + String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0")
    }

    /** 按 updatedAt 月份分组（YYYY-MM），组内按时间倒序，组间月份倒序。 */
    function groupByMonth(entries) {
      var groups = []
      var index = {}
      var sorted = (entries || []).slice().sort(function (a, b) { return (b.updatedAt || 0) - (a.updatedAt || 0) })
      for (var i = 0; i < sorted.length; i++) {
        var en = sorted[i]
        var d = en.updatedAt ? new Date(en.updatedAt) : new Date()
        var key = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0")
        if (!index[key]) {
          index[key] = { key: key, label: key, entries: [] }
          groups.push(index[key])
        }
        index[key].entries.push(en)
      }
      return groups
    }

    /** 来源显示: user=用户输入, agent=工具写入（工作区 · 会话短 id）。 */
    function sourceLabel(en, tt) {
      if (en.sourceType === "user") return tt("sourceUser")
      var ws = en.scope === "project" ? (en.workspace || "?") : tt("globalTab")
      var sid = en.sessionId ? String(en.sessionId).slice(0, 8) : "-"
      return ws + " · " + sid
    }

    /** 按标题折叠的条目列表组件：默认仅显示标题，点击标题展开内容与操作。 */
    function MemoryList(props) {
      var h = props.el
      var tt = props.t
      var entries = props.entries
      var onEdit = props.onEdit
      var onDelete = props.onDelete
      var PRIORITY_COLORS = props.PRIORITY_COLORS

      var s0 = react.useState({})
      var expanded = s0[0]
      var setExpanded = s0[1]

      if (entries.length === 0) {
        return h("div", { className: "lmem-status lmem-center" }, tt("empty"))
      }

      var isAllOpen = entries.every(function (en) { return !!expanded[en.id] })
      var toggleOne = function (id) {
        var n = Object.assign({}, expanded)
        n[id] = !n[id]
        setExpanded(n)
      }
      var toggleAll = function () {
        var next = !isAllOpen
        var map = {}
        for (var i = 0; i < entries.length; i++) map[entries[i].id] = next
        setExpanded(map)
      }

      return h("div", { className: "lmem-list" },
        h("div", { className: "lmem-row" },
          h("button", { className: "lmem-btn lmem-btn-sm", onClick: toggleAll }, isAllOpen ? tt("collapseAll") : tt("expandAll")),
          h("span", { className: "lmem-status" }, entries.length + " " + tt("entryUnits")),
        ),
        entries.map(function (en) {
          var isOpen = !!expanded[en.id]
          return h("div", { key: en.id, className: "lmem-entry", style: { "--lmem-pri-color": (PRIORITY_COLORS[en.priority] || "#8a94a6") } },
            h("div", { className: "lmem-entry-head", onClick: function () { toggleOne(en.id) } },
              h("span", { className: "lmem-month-caret" }, isOpen ? "▾" : "▸"),
              h("span", { className: "lmem-pri", style: { background: (PRIORITY_COLORS[en.priority] || "#8a94a6") } }, en.priority),
              h("div", { className: "lmem-entry-title" }, en.title),
            ),
            isOpen ? h("div", { className: "lmem-entry-body" },
              h("div", { className: "lmem-entry-content" }, en.content),
              h("div", { className: "lmem-entry-meta" }, tt("source") + ": " + sourceLabel(en, tt) + " · " + fmtTime(en.updatedAt)),
              h("div", { className: "lmem-row lmem-entry-actions" },
                h("button", { className: "lmem-btn lmem-btn-sm", onClick: function () { onEdit(en) } }, tt("edit")),
                h("button", { className: "lmem-btn lmem-btn-sm", onClick: function () { onDelete(en.id) } }, tt("del")),
              ),
            ) : null,
          )
        }),
      )
    }

    function apply(ctx) {
      var slots = ctx.get("slots")
      var locale = ctx.get("locale")
      if (slots === undefined) return

      var t = function (key, params) { return translate(zhDict, key, params) }
      if (locale !== undefined) {
        ctx.effect(function () { return locale.register(NS, { zh: zhDict, en: enDict }) }, "dsh-lite-memory: dictionaries")
        t = locale.bind(NS)
      }

      var el = react.createElement

      // ── 对话「记忆」tab：只显示当前会话工作区的条目化记忆 ──────────────────
      function MemoryView(props) {
        var sessionId = props.sessionId || ""
        var s0 = react.useState([])
        var entries = s0[0]
        var setEntries = s0[1]
        var s1 = react.useState("")
        var ws = s1[0]
        var setWs = s1[1]
        var s2 = react.useState("")
        var status = s2[0]
        var setStatus = s2[1]
        var s3 = react.useState(null)
        var editing = s3[0]   // null | {id?, title, priority, content}
        var setEditing = s3[1]

        // 工作区固定为当前会话的工作区：面板不再提供工作区选择器，全局记忆在设置页维护。
        var refresh = function (workspace) {
          var w = workspace !== undefined ? workspace : ws
          if (!w) { setEntries([]); return Promise.resolve() }
          setStatus(t("loading"))
          return call("entries", { scope: "project", workspace: w }).then(function (r) {
            if (r && r.ok) { setEntries(r.entries || []); setStatus("") }
            else setStatus((r && r.message) || t("loading"))
          })
        }

        react.useEffect(function () {
          call("workspace", { sessionId: sessionId }).then(function (r) {
            var cur = (r && r.ok && r.workspace) || ""
            setWs(cur)
            if (!cur) { setEntries([]); setStatus(t("noWorkspace")); return }
            refresh(cur)
          })
        }, [sessionId])

        var saveEntry = function () {
          if (!String(editing.title || "").trim()) { setStatus(t("titleRequired")); return }
          if (!String(editing.content || "").trim()) { setStatus(t("contentRequired")); return }
          setStatus(t("saving"))
          var payload = {
            title: String(editing.title).trim(),
            priority: editing.priority || "中",
            content: String(editing.content).trim(),
          }
          var p
          if (editing.id !== undefined && editing.id !== null) {
            payload.id = editing.id
            p = post("entries/update", payload)
          } else {
            payload.scope = "project"
            payload.workspace = ws
            payload.sourceType = "user"   // UI 手动输入 → 来源标记为「用户」
            p = post("entries/add", payload)
          }
          p.then(function (r) {
            setStatus((r && r.message) || t("saved"))
            setEditing(null)
            refresh()
          })
        }
        var deleteEntry = function (id) {
          post("entries/delete", { id: id }).then(function () { refresh() })
        }

        var formVisible = editing !== null
        return el("div", { className: "lmem-view" },
          el("div", { className: "lmem-tabs" },
            el("span", { className: "lmem-status" }, ws ? t("workspace") + " · " + ws : ""),
            el("span", { style: { flex: 1 } }),
            el("button", { className: "lmem-btn", onClick: function () { refresh() }, title: t("refresh") }, "⟳"),
            el("button", { className: "lmem-btn primary", disabled: !ws, onClick: function () { if (ws) setEditing({ title: "", priority: "中", content: "" }) } }, "+ " + t("addEntry")),
          ),
          el("div", { className: "lmem-row" },
            el("span", { className: "lmem-status" }, status),
          ),
          formVisible
            ? el("div", { className: "lmem-form" },
                el("div", { className: "lmem-row" },
                  el("div", { className: "lmem-field lmem-grow" }, t("title"),
                    el("input", { className: "lmem-input", value: editing.title, onChange: function (e) { var n = Object.assign({}, editing); n.title = e.target.value; setEditing(n) }, placeholder: t("itemTitle") })),
                  el("div", { className: "lmem-field" }, t("priority"),
                    el("select", { className: "lmem-input", value: editing.priority, onChange: function (e) { var n = Object.assign({}, editing); n.priority = e.target.value; setEditing(n) } },
                      ["高", "中", "低"].map(function (p) { return el("option", { key: p, value: p }, t(p === "高" ? "pHigh" : p === "中" ? "pMid" : "pLow")) }),
                    )),
                ),
                el("textarea", { className: "lmem-area lmem-area-sm", value: editing.content, onChange: function (e) { var n = Object.assign({}, editing); n.content = e.target.value; setEditing(n) }, placeholder: t("itemContent") }),
                el("div", { className: "lmem-row" },
                  el("button", { className: "lmem-btn primary", onClick: saveEntry }, t("save")),
                  el("button", { className: "lmem-btn", onClick: function () { setEditing(null) } }, t("cancel")),
                ),
              )
            : null,
          !formVisible
            ? el(MemoryList, { el: el, t: t, entries: entries, PRIORITY_COLORS: PRIORITY_COLORS,
                onEdit: function (en) { setEditing({ id: en.id, title: en.title, priority: en.priority, content: en.content }) },
                onDelete: function (id) { deleteEntry(id) },
              })
            : null,
        )
      }

      // ── 设置「记忆」分区：条目化管理（全局 / 项目工作区）─────────────────────
      function SettingsMemory() {
        var s1 = react.useState([])
        var entries = s1[0]
        var setEntries = s1[1]
        var s2 = react.useState("")
        var status = s2[0]
        var setStatus = s2[1]
        var s3 = react.useState(null)
        var editing = s3[0]
        var setEditing = s3[1]
        // 记忆子页: scope=global | project; workspace 为项目时的工作区名
        var s4 = react.useState("global")
        var scope = s4[0]
        var setScope = s4[1]
        var s5 = react.useState("")
        var ws = s5[0]
        var setWs = s5[1]
        var s6 = react.useState([])
        var workspaces = s6[0]
        var setWorkspaces = s6[1]
        // 统计
        var s7 = react.useState({ total: 0, high: 0 })
        var stats = s7[0]
        var setStats = s7[1]

        var refresh = function (whichScope, whichWs) {
          var sc = whichScope !== undefined ? whichScope : scope
          var w = whichWs !== undefined ? whichWs : ws
          return call("entries", { scope: sc, workspace: sc === "project" ? w : "" }).then(function (r) {
            if (r && r.ok) {
              setEntries(r.entries || [])
              var list = r.entries || []
              setStats({ total: list.length, high: list.filter(function (en) { return en.priority === "高" }).length })
            }
          })
        }
        react.useEffect(function () {
          // 初始: 全局 + 工作区列表
          call("workspaces", {}).then(function (r) {
            if (r && r.ok) setWorkspaces(r.workspaces || [])
          })
          refresh("global", "")
        }, [])

        var saveEntry = function () {
          if (!String(editing.title || "").trim()) { setStatus(t("titleRequired")); return }
          if (!String(editing.content || "").trim()) { setStatus(t("contentRequired")); return }
          setStatus(t("saving"))
          var payload = { title: String(editing.title).trim(), priority: editing.priority || "中", content: String(editing.content).trim() }
          var p
          if (editing.id !== undefined && editing.id !== null) {
            payload.id = editing.id
            p = post("entries/update", payload)
          } else {
            payload.scope = scope
            payload.workspace = scope === "project" ? ws : ""
            payload.sourceType = "user"   // UI 手动输入 → 来源标记为「用户」
            p = post("entries/add", payload)
          }
          p.then(function (r) {
            setStatus((r && r.message) || t("saved"))
            setEditing(null)
            refresh()
          })
        }
        var deleteEntry = function (id) {
          post("entries/delete", { id: id }).then(function () { refresh() })
        }

        return el("div", { className: "lmem-view" },
          // 范围选择器: 全局 / 工作区下拉
          el("div", { className: "lmem-scopebar" },
            el("button", { className: "lmem-tab" + (scope === "global" ? " active" : ""), onClick: function () { setScope("global"); setWs(""); refresh("global", "") } }, t("globalTab")),
            el("div", { className: "lmem-field lmem-grow" },
              el("select", { className: "lmem-input", value: scope === "project" ? ws : "", onChange: function (e) {
                  var v = e.target.value
                  if (v === "__global__") { setScope("global"); setWs(""); refresh("global", ""); return }
                  setScope("project"); setWs(v); refresh("project", v)
                } },
                el("option", { value: "__global__" }, t("projectTab") + " · " + t("workspace")),
                (workspaces.length ? workspaces : ["-"]).map(function (w) { return el("option", { key: w, value: w }, w) }),
              ),
            ),
          ),
          // 统计 + 操作
          el("div", { className: "lmem-row" },
            el("span", { className: "lmem-stat" }, t("totalEntries") + ": " + stats.total),
            el("span", { className: "lmem-stat lmem-stat-high" }, t("highEntries") + ": " + stats.high),
            el("span", { style: { flex: 1 } }),
            el("button", { className: "lmem-btn primary", onClick: function () { setEditing({ title: "", priority: "中", content: "" }) } }, "+ " + t("addEntry")),
            el("button", { className: "lmem-btn", onClick: function () { refresh() } }, t("refresh")),
            el("span", { className: "lmem-status" }, status),
          ),
          editing !== null
            ? el("div", { className: "lmem-form" },
                el("div", { className: "lmem-row" },
                  el("div", { className: "lmem-field lmem-grow" }, t("title"),
                    el("input", { className: "lmem-input", value: editing.title, onChange: function (e) { var n = Object.assign({}, editing); n.title = e.target.value; setEditing(n) }, placeholder: t("itemTitle") })),
                  el("div", { className: "lmem-field" }, t("priority"),
                    el("select", { className: "lmem-input", value: editing.priority, onChange: function (e) { var n = Object.assign({}, editing); n.priority = e.target.value; setEditing(n) } },
                      ["高", "中", "低"].map(function (p) { return el("option", { key: p, value: p }, t(p === "高" ? "pHigh" : p === "中" ? "pMid" : "pLow")) }),
                    )),
                ),
                el("textarea", { className: "lmem-area lmem-area-sm", value: editing.content, onChange: function (e) { var n = Object.assign({}, editing); n.content = e.target.value; setEditing(n) }, placeholder: t("itemContent") }),
                el("div", { className: "lmem-row" },
                  el("button", { className: "lmem-btn primary", onClick: saveEntry }, t("save")),
                  el("button", { className: "lmem-btn", onClick: function () { setEditing(null) } }, t("cancel")),
                ),
              )
            : null,
          el(MemoryList, { el: el, t: t, entries: entries, PRIORITY_COLORS: PRIORITY_COLORS,
            onEdit: function (en) { setEditing({ id: en.id, title: en.title, priority: en.priority, content: en.content }) },
            onDelete: function (id) { deleteEntry(id) },
          }),
        )
      }

      // ── 样式 ────────────────────────────────────────────────────────────────
      var css = "" +
        ".lmem-view{display:flex;flex-direction:column;gap:10px;padding:12px 14px;height:100%;min-height:0}" +
        ".lmem-tabs{display:flex;gap:6px;align-items:center;flex-wrap:wrap}" +
        ".lmem-subtabs{display:flex;gap:6px;border-bottom:1px solid var(--border-color,rgba(128,128,128,.25));padding-bottom:8px}" +
        ".lmem-tab{padding:4px 14px;border-radius:999px;border:1px solid transparent;background:transparent;color:inherit;cursor:pointer;opacity:.7}" +
        ".lmem-tab.active{opacity:1;border-color:currentColor}" +
        ".lmem-area{flex:1;min-height:0;width:100%;resize:none;font:inherit;line-height:1.6;padding:10px;border-radius:8px;border:1px solid var(--border-color,rgba(128,128,128,.35));background:var(--input-bg,rgba(128,128,128,.08));color:inherit;box-sizing:border-box}" +
        ".lmem-area-sm{flex:none;min-height:90px}" +
        ".lmem-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}" +
        ".lmem-btn{padding:5px 14px;border-radius:8px;border:1px solid currentColor;background:transparent;color:inherit;cursor:pointer;opacity:.85}" +
        ".lmem-btn:hover{opacity:1}" +
        ".lmem-btn.primary{background:rgba(88,101,242,.85);border-color:transparent;color:#fff}" +
        ".lmem-btn:disabled{opacity:.4;cursor:default}" +
        ".lmem-btn-sm{padding:2px 9px;font-size:12px}" +
        ".lmem-status{font-size:12px;opacity:.65}" +
        ".lmem-center{text-align:center;padding:14px 0}" +
        ".lmem-input{padding:5px 9px;border-radius:7px;border:1px solid var(--border-color,rgba(128,128,128,.35));background:var(--input-bg,rgba(128,128,128,.08));color:inherit;font:inherit}" +
        "select.lmem-input{color-scheme:inherit}" +
        "body[data-ds-dark-theme] select.lmem-input{background-color:var(--input-bg,#1e1f26);color:#dcdfe6}" +
        "body[data-ds-dark-theme] select.lmem-input option{background-color:#1e1f26;color:#dcdfe6}" +
        ".lmem-field{display:flex;flex-direction:column;gap:4px;font-size:12px;opacity:.9}" +
        ".lmem-grow{flex:1}" +
        ".lmem-form{display:flex;flex-direction:column;gap:8px;padding:10px;border-radius:10px;border:1px solid var(--border-color,rgba(128,128,128,.3));background:rgba(128,128,128,.05)}" +
        ".lmem-list{display:flex;flex-direction:column;gap:8px;overflow:auto;flex:1;min-height:0}" +
        ".lmem-entry{display:flex;gap:10px;align-items:flex-start;padding:10px 12px;border-radius:10px;background:rgba(128,128,128,.07);border:1px solid transparent}" +
        ".lmem-entry:hover{border-color:var(--border-color,rgba(128,128,128,.3))}" +
        ".lmem-pri{flex:none;width:26px;height:26px;border-radius:8px;color:#fff;font-size:12px;display:flex;align-items:center;justify-content:center;margin-top:2px}" +
        ".lmem-entry-body{flex:1;min-width:0}" +
        ".lmem-entry-title{font-weight:600;margin-bottom:3px}" +
        ".lmem-entry-content{font-size:13px;opacity:.85;line-height:1.55;white-space:pre-wrap;word-break:break-word}" +
        ".lmem-entry-meta{font-size:11px;opacity:.45;margin-top:5px}" +
        ".lmem-entry-actions{flex:none}" +
        ".lmem-month{border:1px solid var(--border-color,rgba(128,128,128,.18));border-radius:10px;overflow:hidden}" +
        ".lmem-month-head{display:flex;gap:8px;align-items:center;padding:7px 10px;cursor:pointer;background:rgba(128,128,128,.05);user-select:none}" +
        ".lmem-month-head:hover{background:rgba(128,128,128,.1)}" +
        ".lmem-month-caret{font-size:11px;opacity:.7;width:12px}" +
        ".lmem-month-title{font-weight:600;font-size:13px}" +
        ".lmem-month-count{font-size:11px;opacity:.5;margin-left:auto}" +
        ".lmem-month .lmem-entry{border-radius:0;border-top:1px solid var(--border-color,rgba(128,128,128,.12));border-left:none;border-right:none}" +
        ".lmem-cal-wrap{display:flex;flex-direction:column;gap:10px;position:relative}" +
        ".lmem-cal-card{display:flex;flex-direction:column;gap:8px;padding:12px;border-radius:14px;background:rgba(128,128,128,.05);border:1px solid var(--border-color,rgba(128,128,128,.18));box-shadow:0 1px 6px rgba(0,0,0,.04)}" +
        ".lmem-cal-month{font-weight:700;min-width:96px;text-align:center}" +
        ".lmem-legend{font-size:11px;opacity:.75}" +
        ".lmem-legend-item{margin-right:10px;display:inline-flex;align-items:center}" +
        ".lmem-cal-dow{display:grid;grid-template-columns:repeat(7,1fr);gap:3px;margin-bottom:4px}" +
        ".lmem-cal-dow-cell{text-align:center;font-size:11px;opacity:.55}" +
        ".lmem-cal-gridrow{display:grid;grid-template-columns:repeat(7,1fr);gap:3px}" +
        ".lmem-cal-day{min-height:58px;padding:4px;cursor:pointer;border-radius:8px;border:1px solid color-mix(in srgb,var(--border-color,rgba(128,128,128,.3)) 55%,transparent);background:rgba(128,128,128,.04);overflow:hidden}" +
        ".lmem-cal-day:hover{border-color:var(--dsw-alias-brand-primary,#4f7cff)}" +
        ".lmem-cal-day.today{border-color:var(--dsw-alias-brand-primary,#4f7cff);background:color-mix(in srgb,var(--dsw-alias-brand-primary,#4f7cff) 10%,transparent)}" +
        ".lmem-cal-daynum{font-size:11.5px;font-weight:500;opacity:.7;margin-bottom:3px}" +
        ".lmem-cal-day.today .lmem-cal-daynum{font-weight:700;opacity:1}" +
        ".lmem-cal-chip{font-size:10.5px;line-height:1.35;padding:1px 4px;border-radius:4px;margin-bottom:2px;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
        ".lmem-cal-chip.done{opacity:.5;text-decoration:line-through}" +
        ".lmem-cal-more{font-size:10px;opacity:.5}" +
        ".lmem-cal-modal{position:absolute;inset:0;z-index:10;overflow:auto;border-radius:12px;padding:14px;display:flex;flex-direction:column;gap:10px;background:var(--dsw-alias-bg-overlay,rgba(24,26,32,.94));backdrop-filter:blur(20px) saturate(1.4);border:1px solid var(--border-color,rgba(128,128,128,.35))}" +
        ".lmem-cal-modal-title{font-weight:700}" +
        ".lmem-cal-slot{display:flex;gap:8px;cursor:pointer;padding:2px 0}" +
        ".lmem-cal-slot:hover{background:rgba(128,128,128,.06);border-radius:6px}" +
        ".lmem-cal-slottime{flex:0 0 46px;font-size:11px;opacity:.65;padding-top:4px}" +
        ".lmem-cal-slotevents{min-height:30px;flex:1;border-left:2px solid color-mix(in srgb,var(--dsw-alias-brand-primary,#4f7cff) 24%,transparent);padding-left:9px}" +
        ".lmem-cal{display:flex;flex-direction:column;gap:6px}" +
        ".lmem-cal-item{display:flex;gap:10px;align-items:center;padding:8px 10px;border-radius:10px;background:rgba(128,128,128,.06);border:1px solid transparent;position:relative;overflow:hidden}" +
        ".lmem-cal-item::before{content:'';position:absolute;left:0;top:0;bottom:0;width:3px;background:var(--lmem-q-color,rgba(128,128,128,.4))}" +
        ".lmem-cal-item:hover{border-color:var(--border-color,rgba(128,128,128,.3))}" +
        ".lmem-cal-item.done{opacity:.55}" +
        ".lmem-cal-item-body{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}" +
        ".lmem-cal-title{font-size:13px;word-break:break-word}" +
        ".lmem-cal-meta{font-size:11px;opacity:.55}" +
        ".lmem-cal-actions{flex:none}" +
        ".lmem-cal-q{font-size:11px;padding:1px 7px;border-radius:999px;border:1px solid currentColor;opacity:.85;white-space:nowrap;flex:none}" +
        ".lmem-scopebar{display:flex;gap:8px;align-items:center;padding:8px 10px;border-radius:10px;background:rgba(128,128,128,.05);border:1px solid var(--border-color,rgba(128,128,128,.18))}" +
        ".lmem-stat{font-size:12px;padding:3px 10px;border-radius:999px;background:rgba(128,128,128,.08);opacity:.85;white-space:nowrap}" +
        ".lmem-stat-high{color:#d64545;background:rgba(214,69,69,.12)}" +
        ".lmem-entry{position:relative;overflow:hidden}" +
        ".lmem-entry::before{content:'';position:absolute;left:0;top:0;bottom:0;width:3px;background:var(--lmem-pri-color,rgba(128,128,128,.35));border-radius:3px 0 0 3px}" +
        ".lmem-month-head{transition:background .15s ease}" +
        ".lmem-month-count{background:rgba(128,128,128,.1);padding:1px 8px;border-radius:999px}" +
        ".lmem-cal-day{transition:border-color .15s ease,background .15s ease,transform .12s ease}" +
        ".lmem-cal-day:hover{transform:translateY(-1px)}" +
        ".lmem-entry-title{font-size:13.5px}" +
        ".lmem-entry{flex-direction:column;align-items:stretch;gap:0}" +
        ".lmem-entry-head{display:flex;gap:8px;align-items:center;cursor:pointer;user-select:none;min-width:0}" +
        ".lmem-entry-head:hover .lmem-entry-title{opacity:.75}" +
        ".lmem-entry-head .lmem-entry-title{flex:1;min-width:0;margin-bottom:0}" +
        ".lmem-btn{transition:opacity .15s ease,background .15s ease}" +
        ".lmem-dot{width:8px;height:8px;border-radius:50%;flex:none;display:inline-block}" +
        ".lmem-cron-expr{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px;padding:1px 7px;border-radius:6px;background:rgba(128,128,128,.14);flex:none}" +
        ".lmem-mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}" +
        ".lmem-preview{display:flex;flex-wrap:wrap;gap:6px;align-items:center;padding:8px 10px;border-radius:8px;background:rgba(128,128,128,.06)}" +
        ".lmem-err{color:#d64545}" +
        ".lmem-runs{display:flex;flex-direction:column;gap:6px;margin-top:8px;padding-top:8px;border-top:1px solid var(--border-color,rgba(128,128,128,.2))}" +
        ".lmem-form-adv{display:flex;flex-direction:column;gap:8px;padding:8px 10px;border-radius:8px;background:rgba(128,128,128,.05)}" +
        ".lmem-run{display:flex;flex-direction:column;gap:3px;padding:6px 10px;border-radius:8px;background:rgba(128,128,128,.06);position:relative;overflow:hidden;font-size:12px}" +
        ".lmem-run::before{content:'';position:absolute;left:0;top:0;bottom:0;width:3px;background:var(--lmem-pri-color,rgba(128,128,128,.4))}" +
        ".lmem-run-st{font-weight:600}" +
        ".lmem-run-sum{opacity:.8;white-space:pre-wrap;word-break:break-word;max-height:130px;overflow:auto}" +
        ""

      // ── 样式注入（bundle 无 styles builtin，挂 <style> 到 document.head，随插件卸载清理）──
      if (typeof document !== "undefined") {
        ctx.effect(function () {
          var tag = document.createElement("style")
          tag.setAttribute("data-lmem-styles", "")
          tag.textContent = css
          document.head.appendChild(tag)
          return function () {
            if (tag.parentNode) tag.parentNode.removeChild(tag)
          }
        }, "dsh-lite-memory: styles")
      }

      // ── 注册 ────────────────────────────────────────────────────────────────
      slots.inject("conversation.view", function () {
        return slots.register(
          { name: "conversation.view", id: "memory", order: 20, priority: 0, locale: NS, label: function () { return t("nav") } },
          function (props) { return el(MemoryView, { sessionId: props.sessionId || "" }) },
        )
      })

      slots.inject("settings.section", function () {
        return slots.register(
          { name: "settings.section", id: "memory", order: 25, priority: 0, locale: NS, label: function () { return t("nav") } },
          function () { return el(SettingsMemory, null) },
        )
      })
    }

    module.exports = { name: name, inject: inject, apply: apply }
    return module.exports
  },
})
