# dsh-lite-memory — DSH 简化版记忆插件

参考 [dsh-auto-memory](https://github.com/Aik358/dsh-auto-memory) 裁剪的轻量记忆插件。**只做记忆**：不含日历、不含定时任务（0.6.0 起移除）。

- **条目化记忆**（SQLite `~/.dsh/memory/memory.db`）：每条记忆含标题 / 内容 / 重要程度（高·中·低）/ 来源（工作区-会话）/ 创建更新时间，按条目增删改查
- **记忆工具（4 个）**：
  - `memory_recall` —— 关键词检索条目（可限定工作区），并附带历史 DSH 会话全文检索（部署启用索引时）
  - `memory_entry` —— 条目增删改查（list / add / update / delete）
  - `memory_status` —— 数据库位置与大小、条目统计、最近写入时间
  - `memory_range` —— 按时间范围（`YYYY-MM-DD` / `YYYY-MM-DD HH:MM`）按 高/中/低 分组列出条目
- **记忆标题动态注入**：全局 + 当前项目条目的标题经 `systemPrompt.context` 注入为 durable user-role 快照（仅在完整快照变化或 compaction 移除时才进模型历史，比静态 section 省 token）；按会话缓存，CRUD 写入后清缓存自动刷新
- **对话面板「记忆」tab**：卡片列表 + 新增/编辑/删除（重要程度色标、来源角标）；**跟随当前会话的工作区**，不提供工作区选择器，可在「当前工作区 / 全局」两个范围间切换
- **插件页「记忆」分区**：管理入口挂在插件自己的详情页（设置 → 内置插件 → 已安装 → dsh-lite-memory），全局 / 项目工作区切换 + 统计 + 增删改；设置页不再单列「记忆」分区
- **中英双语**：跟随 DSH 设置的语言，无手动外观设置、默认字号

## 兼容性 / 支持的 DSH 版本

- **本版实测**：DSH `0.2.2-rc.1`（桌面版；Node `24.21`）
- **上一版实测**：DSH `0.1.5-rc.1`（`0.4.1` 及更早）
- **声明范围**：`engines.dsh: ">=0.2.2-rc.1"` —— 插件市场（dshmarket）按 package.json 的 `engines.dsh`（或 `dsh.engines.dsh`）判定宿主兼容性；未声明显示「未声明」，不满足则拒绝安装
- **为什么改声明**：按 node-semver 的预发布规则，`0.2.2-rc.1` **不满足** 旧声明 `>=0.1.5-rc.1`（预发布版本只有比较器同为 `主.次.补` 且带预发布标签时才被纳入），旧声明在当前桌面包上会被市场判为不兼容
- **Node**：`>=22.5.0`（用到 `node:sqlite`；22.5–23.3 需 `--experimental-sqlite`，24 起默认可用）
- **用到的宿主能力**（据此可自行判断其他 DSH 版本是否可用）：
  - `webServer.register`（同源 POST 保护）、`systemPrompt.context({ name, order, text })`、`tools.register`
  - `agents.get(sessionId)` —— 仅用于把会话解析成工作区名（`basename(session.cwd)`）
  - 可选：`sessionQuery.searchSessions`（历史会话检索，缺失时静默跳过）
- **契约适配记录**：
  - `0.5.0` 工具注册不再 `createRequire` + `import()` 解析 `@deepseek-ai/dsh-tools`（桌面版把它打进 `app.asar`，且 `agentPresets.list()` 已不再返回 `path`，旧侦测直接落空导致工具静默不注册）。改为自带等价 `defineTool`（`lib/define-tool.js`）：属性级 `required` 编译成 JSON Schema、执行前预校验；同时避免从 profile `node_modules` 解析到镜像副本污染整个 base 层。
  - `0.6.0` 移除日历与定时任务：不再需要 `timer` / `agentPresets` / `workspaceRegistry` / `llm` / `agentDefaultModel`，也不再有向会话投递消息的代码路径（v4 producer-owned source 那段随功能一起删除）。

## 安装

在插件市场（设置 → 插件市场，dshmarket）里搜 `dsh-lite-memory` 一键安装，或按市场条目用命令行安装：

```bash
dsh plugin --profile web add github:SiriusWJ/dsh-lite-memory
```

安装后重启 dsh web 生效。

> npm 上的 `dsh-lite-memory` 是另一位作者的实现（regrevia），与本插件无关。
> 本插件经 **GitHub 源**分发（市场条目 `install: dsh plugin … add github:SiriusWJ/dsh-lite-memory`），
> 不要 `npm i dsh-lite-memory`。

## 存储

| 数据 | 位置 |
|---|---|
| 记忆条目 | `~/.dsh/memory/memory.db`（表 `entries`） |

旧版 `MEMORY.md` / `calendar.json` 数据不再读写；旧库里遗留的 `calendar` / `cron_jobs` / `cron_runs` 表不再访问，可自行删除。

## License

BSD-3-Clause
