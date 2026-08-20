// dsh-lite-memory —— Client 面（浏览器 bundle，SQLite 版）
//
// 对话视图新增「记忆」tab：条目化记忆面板（标题/重要程度/来源/内容，增删改查）。
// 设置页「记忆」分区：二级菜单（记忆 / 日历）；日历为月视图+当天时间轴+浮层编辑，
// 面板下方「待执行」「已完成」双 tab 纵向列表。
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
      pendingTab: "待执行",
      doneTab: "已完成",
      noPending: "暂无待执行事项",
      noDone: "暂无已完成事项",
      restore: "恢复",
      detail: "补充说明（可选）",
      clickAdd: "点击添加事件",
      daySchedule: "当天安排",
      qUrgentImportant: "重要紧急",
      qImportant: "重要不紧急",
      qUrgent: "紧急不重要",
      qNone: "不重要不紧急",
    }
    var enDict = {
      nav: "Memory",
      subMemory: "Memory",
      subCalendar: "Calendar",
      globalTab: "Global",
      projectTab: "Project",
      workspace: "Workspace",
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
      pendingTab: "Pending",
      doneTab: "Done",
      noPending: "No pending items",
      noDone: "No completed items",
      restore: "Undo",
      detail: "Details (optional)",
      clickAdd: "Click to add event",
      daySchedule: "Day schedule",
      qUrgentImportant: "Urgent & important",
      qImportant: "Important",
      qUrgent: "Urgent",
      qNone: "Neither",
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

    var QUADRANT_COLORS = {
      "重要紧急": "#d64545",
      "重要不紧急": "#4f7cff",
      "紧急不重要": "#e6a23c",
      "不重要不紧急": "#8a94a6",
    }
    var PRIORITY_COLORS = { "高": "#d64545", "中": "#e6a23c", "低": "#8a94a6" }

    function fmtTime(ts) {
      if (!ts) return ""
      var d = new Date(ts)
      return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0") + " " + String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0")
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

      // ── 对话「记忆」tab：条目化记忆面板 ────────────────────────────────────
      function MemoryView(props) {
        var sessionId = props.sessionId || ""
        var s0 = react.useState("project")
        var tab = s0[0]
        var setTab = s0[1]
        var s1 = react.useState([])
        var entries = s1[0]
        var setEntries = s1[1]
        var s2 = react.useState("")
        var ws = s2[0]
        var setWs = s2[1]
        var s3 = react.useState([])
        var workspaces = s3[0]
        var setWorkspaces = s3[1]
        var s4 = react.useState("")
        var status = s4[0]
        var setStatus = s4[1]
        var s5 = react.useState(null)
        var editing = s5[0]   // null | {id?, title, priority, content}
        var setEditing = s5[1]

        var refresh = function (which, workspace) {
          var scope = which !== undefined ? which : tab
          var w = workspace !== undefined ? workspace : ws
          setStatus(t("loading"))
          return call("entries", { scope: scope, workspace: scope === "project" ? w : "" }).then(function (r) {
            if (r && r.ok) { setEntries(r.entries || []); setStatus("") }
            else setStatus((r && r.message) || t("loading"))
          })
        }

        react.useEffect(function () {
          if (tab === "global") {
            setWs("")
            refresh("global", "")
          } else {
            Promise.all([call("workspace", { sessionId: sessionId }), call("workspaces", {})]).then(function (rs) {
              var cur = (rs[0] && rs[0].ok && rs[0].workspace) || ""
              setWs(cur)
              if (rs[1] && rs[1].ok) setWorkspaces(rs[1].workspaces || [])
              refresh("project", cur)
            })
          }
        }, [tab, sessionId])

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
            payload.scope = tab
            payload.workspace = tab === "project" ? ws : ""
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
            el("button", { className: "lmem-tab" + (tab === "global" ? " active" : ""), onClick: function () { setTab("global") } }, t("globalTab")),
            el("button", { className: "lmem-tab" + (tab === "project" ? " active" : ""), onClick: function () { setTab("project") } }, t("projectTab")),
            el("span", { style: { flex: 1 } }),
            el("button", { className: "lmem-btn primary", onClick: function () { setEditing({ title: "", priority: "中", content: "" }) } }, "+ " + t("addEntry")),
          ),
          tab === "project" && workspaces.length > 1
            ? el("div", { className: "lmem-row" },
                el("label", { className: "lmem-field" }, t("workspace"),
                  el("select", { className: "lmem-input", value: ws, onChange: function (e) { setWs(e.target.value); refresh("project", e.target.value) } },
                    workspaces.map(function (w) { return el("option", { key: w, value: w }, w) }),
                  ),
                ),
              )
            : null,
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
                  el("span", { className: "lmem-status" }, status),
                ),
              )
            : null,
          !formVisible
            ? el("div", { className: "lmem-list" },
                entries.length === 0
                  ? el("div", { className: "lmem-status lmem-center" }, t("empty"))
                  : entries.map(function (en) {
                      return el("div", { key: en.id, className: "lmem-entry" },
                        el("span", { className: "lmem-pri", style: { background: (PRIORITY_COLORS[en.priority] || "#8a94a6") } }, en.priority),
                        el("div", { className: "lmem-entry-body" },
                          el("div", { className: "lmem-entry-title" }, en.title),
                          el("div", { className: "lmem-entry-content" }, en.content),
                          el("div", { className: "lmem-entry-meta" },
                            t("source") + ": " + (en.scope === "project" ? en.workspace : t("globalTab")) + " · " + (en.sessionId ? String(en.sessionId).slice(0, 8) : "-") + " · " + fmtTime(en.updatedAt),
                          ),
                        ),
                        el("div", { className: "lmem-row lmem-entry-actions" },
                          el("button", { className: "lmem-btn lmem-btn-sm", onClick: function () { setEditing({ id: en.id, title: en.title, priority: en.priority, content: en.content }) } }, t("edit")),
                          el("button", { className: "lmem-btn lmem-btn-sm", onClick: function () { deleteEntry(en.id) } }, t("del")),
                        ),
                      )
                    }),
              )
            : null,
          !formVisible ? el("div", { className: "lmem-row" },
            el("button", { className: "lmem-btn", onClick: function () { refresh() } }, t("refresh")),
            el("span", { className: "lmem-status" }, status),
          ) : null,
        )
      }

      // ── 设置「记忆」分区：二级菜单（记忆 / 日历）────────────────────────────
      function SettingsMemory() {
        var s0 = react.useState("calendar")
        var sub = s0[0]
        var setSub = s0[1]
        var s1 = react.useState([])
        var entries = s1[0]
        var setEntries = s1[1]
        var s2 = react.useState("")
        var status = s2[0]
        var setStatus = s2[1]
        var s3 = react.useState(null)
        var editing = s3[0]
        var setEditing = s3[1]

        var refresh = function () {
          return call("entries", { scope: "global", workspace: "" }).then(function (r) {
            if (r && r.ok) setEntries(r.entries || [])
          })
        }
        react.useEffect(function () { refresh() }, [])

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
            payload.scope = "global"
            payload.workspace = ""
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

        var subBody = null
        if (sub === "memory") {
          subBody = el("div", { className: "lmem-view" },
            el("div", { className: "lmem-row" },
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
            el("div", { className: "lmem-list" },
              entries.length === 0
                ? el("div", { className: "lmem-status lmem-center" }, t("empty"))
                : entries.map(function (en) {
                    return el("div", { key: en.id, className: "lmem-entry" },
                      el("span", { className: "lmem-pri", style: { background: (PRIORITY_COLORS[en.priority] || "#8a94a6") } }, en.priority),
                      el("div", { className: "lmem-entry-body" },
                        el("div", { className: "lmem-entry-title" }, en.title),
                        el("div", { className: "lmem-entry-content" }, en.content),
                        el("div", { className: "lmem-entry-meta" }, t("source") + ": " + t("globalTab") + " · " + (en.sessionId ? String(en.sessionId).slice(0, 8) : "-") + " · " + fmtTime(en.updatedAt)),
                      ),
                      el("div", { className: "lmem-row lmem-entry-actions" },
                        el("button", { className: "lmem-btn lmem-btn-sm", onClick: function () { setEditing({ id: en.id, title: en.title, priority: en.priority, content: en.content }) } }, t("edit")),
                        el("button", { className: "lmem-btn lmem-btn-sm", onClick: function () { deleteEntry(en.id) } }, t("del")),
                      ),
                    )
                  }),
            ),
          )
        } else {
          subBody = el(CalendarPanel, { t: t, el: el, call: call, post: post, QUADRANT_COLORS: QUADRANT_COLORS })
        }

        return el("div", { className: "lmem-view" },
          el("div", { className: "lmem-subtabs" },
            el("button", { className: "lmem-tab" + (sub === "memory" ? " active" : ""), onClick: function () { setSub("memory") } }, t("subMemory")),
            el("button", { className: "lmem-tab" + (sub === "calendar" ? " active" : ""), onClick: function () { setSub("calendar") } }, t("subCalendar")),
          ),
          subBody,
        )
      }

      // ── 日历面板（月视图 + 当天时间轴 + 待执行/已完成双 tab）────────────────
      function CalendarPanel(props) {
        var tt = props.t
        var h = props.el
        var apiGet = props.call
        var apiPost = props.post
        var QC = props.QUADRANT_COLORS

        var s0 = react.useState([])
        var entries = s0[0]
        var setEntries = s0[1]
        var s1 = react.useState(null)
        var month = s1[0]
        var setMonth = s1[1]
        var s2 = react.useState(null)
        var dayView = s2[0]
        var setDayView = s2[1]
        var s3 = react.useState(null)
        var draft = s3[0]
        var setDraft = s3[1]
        var s4 = react.useState("pending")
        var listTab = s4[0]
        var setListTab = s4[1]
        var s5 = react.useState("")
        var msg = s5[0]
        var setMsg = s5[1]
        var s6 = react.useState(false)
        var saving = s6[0]
        var setSaving = s6[1]

        function load() {
          apiGet("calendar", {}).then(function (r) {
            if (r && r.ok) setEntries(r.entries || [])
          })
        }
        react.useEffect(function () {
          load()
          var now = new Date()
          setMonth({ year: now.getFullYear(), mon: now.getMonth() + 1 })
        }, [])

        if (!month) return null
        function dayEntries(date) {
          return (entries || []).filter(function (en) { return en.date === date })
        }
        function moveMonth(delta) {
          var y = month.year
          var m = month.mon + delta
          if (m < 1) { m = 12; y -= 1 }
          if (m > 12) { m = 1; y += 1 }
          setMonth({ year: y, mon: m })
        }
        function fmtDate(y, m, d) { return y + "-" + String(m).padStart(2, "0") + "-" + String(d).padStart(2, "0") }

        var firstDay = new Date(month.year, month.mon - 1, 1)
        var startDow = firstDay.getDay()
        var daysInMonth = new Date(month.year, month.mon, 0).getDate()
        var now = new Date()
        var today = fmtDate(now.getFullYear(), now.getMonth() + 1, now.getDate())
        var cells = []
        for (var i = 0; i < startDow; i++) cells.push(null)
        for (var d = 1; d <= daysInMonth; d++) cells.push(fmtDate(month.year, month.mon, d))
        var dowLabels = ["日", "一", "二", "三", "四", "五", "六"]

        var rows = []
        rows.push(h("div", { className: "lmem-row" },
          h("button", { className: "lmem-btn lmem-btn-sm", onClick: function () { moveMonth(-1) } }, "◀"),
          h("span", { className: "lmem-cal-month" }, month.year + " / " + String(month.mon).padStart(2, "0")),
          h("button", { className: "lmem-btn lmem-btn-sm", onClick: function () { moveMonth(1) } }, "▶"),
          h("button", { className: "lmem-btn lmem-btn-sm", onClick: function () { var n = new Date(); setMonth({ year: n.getFullYear(), mon: n.getMonth() + 1 }) } }, tt("today")),
          h("span", { style: { flex: 1 } }),
          h("button", { className: "lmem-btn primary", onClick: function () { setDraft({ date: today, time: "09:00", quadrant: "重要不紧急", title: "", note: "" }) } }, "+ " + tt("add")),
        ))
        // 图例
        rows.push(h("div", { className: "lmem-row lmem-legend" },
          Object.keys(QC).map(function (q) {
            return h("span", { key: q, className: "lmem-legend-item" },
              h("span", { style: { display: "inline-block", width: 8, height: 8, borderRadius: 2, background: QC[q], marginRight: 4 } }), tt(q === "重要紧急" ? "qUrgentImportant" : q === "重要不紧急" ? "qImportant" : q === "紧急不重要" ? "qUrgent" : "qNone"))
          }),
        ))
        // 星期表头
        rows.push(h("div", { className: "lmem-cal-dow" },
          dowLabels.map(function (dl) { return h("div", { key: dl, className: "lmem-cal-dow-cell" }, dl) }),
        ))
        // 月网格
        var gridRows = []
        for (var ci = 0; ci < cells.length; ci += 7) {
          var week = []
          for (var cj = 0; cj < 7; cj++) {
            (function (cell) {
              if (!cell) { week.push(h("div", { key: "empty" + cj })); return }
              var es = dayEntries(cell)
              var isToday = cell === today
              week.push(h("div", {
                key: cell,
                className: "lmem-cal-day" + (isToday ? " today" : ""),
                onClick: function () { setDayView(cell) },
              },
                h("div", { className: "lmem-cal-daynum" }, Number(cell.slice(8))),
                es.slice(0, 3).map(function (en) {
                  return h("div", {
                    key: en.id,
                    className: "lmem-cal-chip" + (en.done ? " done" : ""),
                    title: en.time + " " + en.title,
                    onClick: function (ev) { ev.stopPropagation(); toggleDone(en) },
                    style: { background: "color-mix(in srgb, " + (QC[en.quadrant] || "#8a94a6") + " 18%, transparent)", color: (QC[en.quadrant] || "#8a94a6") },
                  }, (en.time && en.time !== "--:--" ? en.time + " " : "") + en.title)
                }),
                es.length > 3 ? h("div", { className: "lmem-cal-more" }, "+" + (es.length - 3)) : null,
              ))
            })(cells[ci + cj])
          }
          gridRows.push(h("div", { key: "w" + ci, className: "lmem-cal-gridrow" }, week))
        }
        rows.push(h("div", null, gridRows))

        function toggleDone(en) {
          if (saving) return
          setSaving(true)
          apiPost("calendar/done", { date: en.date, time: en.time, title: en.title }).then(function (r) {
            setMsg((r && r.message) || ""); setSaving(false); load()
          })
        }
        function saveDraft() {
          if (!draft || !String(draft.title || "").trim()) { setMsg(tt("titleRequired")); return }
          if (saving) return
          setSaving(true)
          apiPost("calendar/add", { date: draft.date, time: draft.time, quadrant: draft.quadrant, title: String(draft.title).trim(), note: String(draft.note || "").trim() }).then(function (r) {
            setMsg((r && r.message) || ""); setSaving(false); setDraft(null); load()
          })
        }

        // 当天时间轴浮层
        if (dayView) {
          var timeline = []
          for (var hourSlot = 7; hourSlot <= 22; hourSlot++) {
            (function (hourValue) {
              var hourText = String(hourValue).padStart(2, "0") + ":00"
              var hourEvents = dayEntries(dayView).filter(function (en) { return String(en.time || "").slice(0, 2) === String(hourValue).padStart(2, "0") })
              timeline.push(h("div", { key: hourText, className: "lmem-cal-slot", onClick: function () { setDayView(null); setDraft({ date: dayView, time: hourText, quadrant: "重要不紧急", title: "", note: "" }) } },
                h("div", { className: "lmem-cal-slottime" }, hourText),
                h("div", { className: "lmem-cal-slotevents" }, hourEvents.length
                  ? hourEvents.map(function (en) {
                      return h("div", {
                        key: en.id,
                        className: "lmem-cal-chip" + (en.done ? " done" : ""),
                        onClick: function (ev) { ev.stopPropagation(); toggleDone(en) },
                        style: { background: "color-mix(in srgb, " + (QC[en.quadrant] || "#8a94a6") + " 18%, transparent)", color: (QC[en.quadrant] || "#8a94a6") },
                      }, (en.time || "") + "  " + en.title + (en.note ? " · " + en.note : ""))
                    })
                  : h("span", { className: "lmem-status" }, tt("clickAdd"))),
              ))
            })(hourSlot)
          }
          rows.push(h("div", { className: "lmem-cal-modal" },
            h("div", { className: "lmem-row" },
              h("div", { className: "lmem-cal-modal-title" }, dayView + " · " + tt("daySchedule")),
              h("button", { className: "lmem-btn lmem-btn-sm", onClick: function () { setDayView(null) } }, "✕"),
            ),
            timeline,
          ))
        }
        // 添加/编辑浮层
        if (draft) {
          rows.push(h("div", { className: "lmem-cal-modal" },
            h("div", { className: "lmem-cal-modal-title" }, tt("add") + " · " + draft.date),
            h("input", { className: "lmem-input", placeholder: tt("itemTitle"), value: draft.title, autoFocus: true, onChange: function (e) { var n = Object.assign({}, draft); n.title = e.target.value; setDraft(n) } }),
            h("div", { className: "lmem-row" },
              h("input", { className: "lmem-input", type: "time", value: draft.time, onChange: function (e) { var n = Object.assign({}, draft); n.time = e.target.value || "09:00"; setDraft(n) } }),
              h("select", { className: "lmem-input", value: draft.quadrant, onChange: function (e) { var n = Object.assign({}, draft); n.quadrant = e.target.value; setDraft(n) } },
                ["重要紧急", "重要不紧急", "紧急不重要", "不重要不紧急"].map(function (q) { return h("option", { key: q, value: q }, tt(q === "重要紧急" ? "qUrgentImportant" : q === "重要不紧急" ? "qImportant" : q === "紧急不重要" ? "qUrgent" : "qNone")) }),
              ),
            ),
            h("input", { className: "lmem-input", placeholder: tt("note") + "（" + tt("optional") + "）", value: draft.note || "", onChange: function (e) { var n = Object.assign({}, draft); n.note = e.target.value; setDraft(n) } }),
            h("div", { className: "lmem-row" },
              h("button", { className: "lmem-btn primary", onClick: saveDraft, disabled: saving }, saving ? tt("saving") : tt("save")),
              h("button", { className: "lmem-btn", onClick: function () { if (!saving) setDraft(null) }, disabled: saving }, tt("cancel")),
            ),
          ))
        }
        if (msg) rows.push(h("div", { className: "lmem-status" }, msg))

        // 下方：待执行 / 已完成 双 tab 纵向列表
        var sorted = (entries || []).slice().sort(function (a, b) { return (a.date + a.time).localeCompare(b.date + b.time) })
        var pendingList = sorted.filter(function (en) { return !en.done })
        var doneList = sorted.filter(function (en) { return en.done })

        rows.push(h("div", { className: "lmem-tabs" },
          h("button", { className: "lmem-tab" + (listTab === "pending" ? " active" : ""), onClick: function () { setListTab("pending") } }, tt("pendingTab") + " (" + pendingList.length + ")"),
          h("button", { className: "lmem-tab" + (listTab === "done" ? " active" : ""), onClick: function () { setListTab("done") } }, tt("doneTab") + " (" + doneList.length + ")"),
        ))
        var listItems = listTab === "pending" ? pendingList : doneList
        rows.push(h("div", { className: "lmem-cal" },
          listItems.length === 0
            ? h("div", { className: "lmem-status lmem-center" }, listTab === "pending" ? tt("noPending") : tt("noDone"))
            : listItems.map(function (en) {
                return h("div", { key: en.id, className: "lmem-cal-item" + (en.done ? " done" : "") },
                  h("span", { className: "lmem-cal-q", style: { borderColor: (QC[en.quadrant] || "#8a94a6"), color: (QC[en.quadrant] || "#8a94a6") } }, en.quadrant),
                  h("span", { className: "lmem-cal-date" }, en.date + " " + en.time),
                  h("span", { className: "lmem-cal-title", style: { textDecoration: en.done ? "line-through" : "none" } }, en.title),
                  en.note ? h("span", { className: "lmem-status" }, en.note) : null,
                  h("button", { className: "lmem-btn lmem-btn-sm", onClick: function () { toggleDone(en) } }, en.done ? tt("restore") : tt("done")),
                  h("button", { className: "lmem-btn lmem-btn-sm", onClick: function () {
                    apiPost("calendar/remove", { date: en.date, time: en.time, title: en.title }).then(function () { load() })
                  } }, tt("del")),
                )
              }),
        ))

        return h("div", { className: "lmem-cal-wrap" }, rows)
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
        ".lmem-cal-wrap{display:flex;flex-direction:column;gap:10px;position:relative}" +
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
        ".lmem-cal-item{display:flex;gap:8px;align-items:center;padding:6px 8px;border-radius:8px;background:rgba(128,128,128,.07);font-size:13px}" +
        ".lmem-cal-item.done{opacity:.5}" +
        ".lmem-cal-q{font-size:11px;padding:1px 7px;border-radius:999px;border:1px solid currentColor;opacity:.85;white-space:nowrap}" +
        ".lmem-cal-date{white-space:nowrap;font-size:12px;opacity:.8}" +
        ".lmem-cal-title{flex:1;min-width:0;word-break:break-word}" +
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
