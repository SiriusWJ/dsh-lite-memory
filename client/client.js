// dsh-lite-memory —— Client 面（浏览器 bundle）
//
// 对话视图新增「记忆」tab（查看/编辑全局+项目记忆）+ 设置页「记忆」分区（日历视图）。
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
      globalTab: "全局记忆",
      projectTab: "项目记忆",
      workspace: "工作区",
      loading: "加载中…",
      readFailed: "读取失败",
      saving: "保存中…",
      saved: "已保存 ✓",
      saveFailed: "保存失败",
      save: "保存",
      refresh: "刷新",
      noMemory: "暂无记忆内容，在此编辑…",
      calTitle: "日历",
      date: "日期",
      time: "时间",
      quadrant: "象限",
      title: "标题",
      note: "备注",
      optional: "可选",
      titleRequired: "标题不能为空",
      adding: "添加中…",
      addFailed: "添加失败",
      add: "添加事项",
      done: "完成",
      undo: "恢复",
      del: "删除",
      empty: "日历为空",
      itemTitle: "事项标题",
    }
    var enDict = {
      nav: "Memory",
      globalTab: "Global",
      projectTab: "Project",
      workspace: "Workspace",
      loading: "Loading…",
      readFailed: "Read failed",
      saving: "Saving…",
      saved: "Saved ✓",
      saveFailed: "Save failed",
      save: "Save",
      refresh: "Refresh",
      noMemory: "No memory yet — edit here…",
      calTitle: "Calendar",
      date: "Date",
      time: "Time",
      quadrant: "Quadrant",
      title: "Title",
      note: "Note",
      optional: "Optional",
      titleRequired: "Title required",
      adding: "Adding…",
      addFailed: "Add failed",
      add: "Add",
      done: "Done",
      undo: "Undo",
      del: "Del",
      empty: "Calendar is empty",
      itemTitle: "Item title",
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

      // ── 对话「记忆」tab ────────────────────────────────────────────────────
      function MemoryView(props) {
        var sessionId = props.sessionId || ""
        var s0 = react.useState("global")
        var tab = s0[0]
        var setTab = s0[1]
        var s1 = react.useState("")
        var content = s1[0]
        var setContent = s1[1]
        var s2 = react.useState("")
        var path = s2[0]
        var setPath = s2[1]
        var s3 = react.useState("")
        var ws = s3[0]
        var setWs = s3[1]
        var s4 = react.useState([])
        var workspaces = s4[0]
        var setWorkspaces = s4[1]
        var s5 = react.useState("")
        var status = s5[0]
        var setStatus = s5[1]
        var s6 = react.useState(false)
        var dirty = s6[0]
        var setDirty = s6[1]

        var load = function (which, workspace) {
          setStatus(t("loading"))
          return call("read", { scope: which, workspace: workspace || "" }).then(function (r) {
            if (r && r.ok) {
              setContent(r.content || "")
              setPath(r.path || "")
              setStatus("")
            } else {
              setStatus((r && r.message) || t("readFailed"))
            }
          })
        }

        react.useEffect(function () {
          if (tab === "global") {
            setWs("")
            load("global", "")
          } else {
            Promise.all([call("workspace", { sessionId: sessionId }), call("workspaces", {})]).then(function (rs) {
              var cur = (rs[0] && rs[0].ok && rs[0].workspace) || ""
              setWs(cur)
              if (rs[1] && rs[1].ok) setWorkspaces(rs[1].workspaces || [])
              load("project", cur)
            })
          }
        }, [tab, sessionId])

        var save = function () {
          setStatus(t("saving"))
          post("write", { scope: tab, workspace: tab === "project" ? ws : "", action: "replace", content: content }).then(function (r) {
            if (r && r.ok) {
              setStatus(t("saved"))
              setPath(r.path || "")
              setDirty(false)
            } else {
              setStatus((r && r.message) || t("saveFailed"))
            }
          })
        }

        return el("div", { className: "lmem-view" },
          el("div", { className: "lmem-tabs" },
            el("button", { className: "lmem-tab" + (tab === "global" ? " active" : ""), onClick: function () { setTab("global") } }, t("globalTab")),
            el("button", { className: "lmem-tab" + (tab === "project" ? " active" : ""), onClick: function () { setTab("project") } }, t("projectTab")),
          ),
          tab === "project" && workspaces.length > 1
            ? el("div", { className: "lmem-row" },
                el("label", { className: "lmem-field" }, t("workspace"),
                  el("select", { className: "lmem-input", value: ws, onChange: function (e) { setWs(e.target.value); load("project", e.target.value) } },
                    workspaces.map(function (w) { return el("option", { key: w, value: w }, w) }),
                  ),
                ),
              )
            : null,
          el("textarea", {
            className: "lmem-area",
            value: content,
            onChange: function (e) { setContent(e.target.value); setDirty(true) },
            placeholder: t("noMemory"),
            spellCheck: false,
          }),
          el("div", { className: "lmem-row" },
            el("button", { className: "lmem-btn primary", onClick: save, disabled: !dirty }, t("save")),
            el("button", { className: "lmem-btn", onClick: function () { load(tab, tab === "project" ? ws : "") } }, t("refresh")),
            el("span", { className: "lmem-status" }, status),
          ),
          el("div", { className: "lmem-path" }, path),
        )
      }

      // ── 设置「记忆」分区：日历 ──────────────────────────────────────────────
      function CalendarSettings() {
        var s0 = react.useState([])
        var entries = s0[0]
        var setEntries = s0[1]
        var s1 = react.useState("")
        var status = s1[0]
        var setStatus = s1[1]
        var s2 = react.useState("")
        var date = s2[0]
        var setDate = s2[1]
        var s3 = react.useState("")
        var time = s3[0]
        var setTime = s3[1]
        var s4 = react.useState("重要不紧急")
        var quadrant = s4[0]
        var setQuadrant = s4[1]
        var s5 = react.useState("")
        var title = s5[0]
        var setTitle = s5[1]
        var s6 = react.useState("")
        var note = s6[0]
        var setNote = s6[1]

        var refresh = function () {
          return call("calendar", {}).then(function (r) {
            if (r && r.ok) setEntries(r.entries || [])
          })
        }
        react.useEffect(function () { refresh() }, [])

        var today = function () {
          var d = new Date()
          return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0")
        }
        var add = function () {
          if (!String(title || "").trim()) { setStatus(t("titleRequired")); return }
          setStatus(t("adding"))
          post("calendar/add", { date: date || today(), time: time || "--:--", quadrant: quadrant, title: String(title).trim(), note: String(note || "").trim() }).then(function (r) {
            setStatus((r && r.message) || t("addFailed"))
            setTitle("")
            setNote("")
            refresh()
          })
        }
        var done = function (en) {
          post("calendar/done", { date: en.date, time: en.time, title: en.title }).then(function () { refresh() })
        }
        var remove = function (en) {
          post("calendar/remove", { date: en.date, time: en.time, title: en.title }).then(function () { refresh() })
        }

        var sorted = entries.slice().sort(function (a, b) {
          return a.done === b.done ? (a.date + a.time).localeCompare(b.date + b.time) : (a.done ? 1 : -1)
        })

        return el("div", { className: "lmem-view" },
          el("div", { className: "lmem-row" },
            el("div", { className: "lmem-field" }, t("date"),
              el("input", { className: "lmem-input", type: "date", value: date, onChange: function (e) { setDate(e.target.value) } })),
            el("div", { className: "lmem-field" }, t("time"),
              el("input", { className: "lmem-input", type: "time", value: time, onChange: function (e) { setTime(e.target.value) } })),
            el("div", { className: "lmem-field" }, t("quadrant"),
              el("select", { className: "lmem-input", value: quadrant, onChange: function (e) { setQuadrant(e.target.value) } },
                ["重要紧急", "重要不紧急", "紧急不重要", "不重要不紧急"].map(function (q) { return el("option", { key: q, value: q }, q) }),
              )),
          ),
          el("div", { className: "lmem-row" },
            el("div", { className: "lmem-field lmem-grow" }, t("title"),
              el("input", { className: "lmem-input", value: title, onChange: function (e) { setTitle(e.target.value) }, placeholder: t("itemTitle") })),
            el("div", { className: "lmem-field lmem-grow" }, t("note"),
              el("input", { className: "lmem-input", value: note, onChange: function (e) { setNote(e.target.value) }, placeholder: t("optional") })),
          ),
          el("div", { className: "lmem-row" },
            el("button", { className: "lmem-btn primary", onClick: add }, t("add")),
            el("button", { className: "lmem-btn", onClick: function () { refresh() } }, t("refresh")),
            el("span", { className: "lmem-status" }, status),
          ),
          el("div", { className: "lmem-cal" },
            sorted.length === 0
              ? el("div", { className: "lmem-status" }, t("empty"))
              : sorted.map(function (en) {
                  return el("div", { key: en.id, className: "lmem-cal-item" + (en.done ? " done" : "") },
                    el("span", { className: "lmem-cal-q" }, en.quadrant),
                    el("span", { style: { whiteSpace: "nowrap" } }, en.date + " " + en.time),
                    el("span", { style: { flex: 1, textDecoration: en.done ? "line-through" : "none" } }, en.title),
                    en.note ? el("span", { className: "lmem-status" }, en.note) : null,
                    el("button", { className: "lmem-btn", onClick: function () { done(en) } }, en.done ? t("undo") : t("done")),
                    el("button", { className: "lmem-btn", onClick: function () { remove(en) } }, t("del")),
                  )
                }),
          ),
        )
      }

      // ── 样式 ────────────────────────────────────────────────────────────────
      var css = "" +
        ".lmem-view{display:flex;flex-direction:column;gap:10px;padding:12px 14px;height:100%;min-height:0}" +
        ".lmem-tabs{display:flex;gap:6px}" +
        ".lmem-tab{padding:4px 14px;border-radius:999px;border:1px solid transparent;background:transparent;color:inherit;cursor:pointer;opacity:.7}" +
        ".lmem-tab.active{opacity:1;border-color:currentColor}" +
        ".lmem-area{flex:1;min-height:0;width:100%;resize:none;font:inherit;line-height:1.6;padding:10px;border-radius:8px;border:1px solid var(--border-color,rgba(128,128,128,.35));background:var(--input-bg,rgba(128,128,128,.08));color:inherit;box-sizing:border-box}" +
        ".lmem-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}" +
        ".lmem-btn{padding:5px 14px;border-radius:8px;border:1px solid currentColor;background:transparent;color:inherit;cursor:pointer;opacity:.85}" +
        ".lmem-btn:hover{opacity:1}" +
        ".lmem-btn.primary{background:rgba(88,101,242,.85);border-color:transparent;color:#fff}" +
        ".lmem-btn:disabled{opacity:.4;cursor:default}" +
        ".lmem-status{font-size:12px;opacity:.65}" +
        ".lmem-path{font-size:11px;opacity:.45;word-break:break-all}" +
        ".lmem-cal{display:flex;flex-direction:column;gap:8px}" +
        ".lmem-cal-item{display:flex;gap:8px;align-items:center;padding:6px 8px;border-radius:8px;background:rgba(128,128,128,.08);font-size:13px}" +
        ".lmem-cal-item.done{opacity:.5}" +
        ".lmem-cal-q{font-size:11px;padding:1px 7px;border-radius:999px;border:1px solid currentColor;opacity:.8;white-space:nowrap}" +
        ".lmem-input{padding:5px 9px;border-radius:7px;border:1px solid var(--border-color,rgba(128,128,128,.35));background:var(--input-bg,rgba(128,128,128,.08));color:inherit;font:inherit}" +
        ".lmem-field{display:flex;flex-direction:column;gap:4px;font-size:12px;opacity:.9}" +
        ".lmem-grow{flex:1}"

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
          function () { return el(CalendarSettings, null) },
        )
      })
    }

    module.exports = { name: name, inject: inject, apply: apply }
    return module.exports
  },
})
