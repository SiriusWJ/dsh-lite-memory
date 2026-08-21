# dsh-lite-memory — DSH 简化版记忆插件

参考 [dsh-auto-memory](https://github.com/Aik358/dsh-auto-memory) 裁剪的轻量记忆插件：

- **条目化记忆**（SQLite `~/.dsh/memory/memory.db`）：每条记忆含标题 / 内容 / 重要程度（高·中·低）/ 来源（工作区-会话）/ 创建更新时间，按条目增删改查
- **记忆工具**：`memory_recall`（关键词检索条目）/ `memory_entry`（条目增删改查）
- **日历与提醒**：`calendar_add` / `calendar_list` / `calendar_done` / `calendar_remove`；到点后通过 `agent.followup` 把提醒投递到注册会话（会话被移除则新建会话投递）
- **对话面板「记忆」tab**：条目化记忆面板（卡片列表 + 新增/编辑/删除，重要程度色标、来源角标）
- **设置页「记忆」分区**：二级菜单（记忆 / 日历）——日历为月视图 + 当天 07:00-22:00 时间轴 + 浮层编辑，面板下方「待执行」「已完成」双 tab 纵向列表
- **中英双语**：跟随 DSH 设置的语言，无手动外观设置、默认字号

## 安装

```bash
cd ~/.dsh/profiles/web
pnpm add dsh-lite-memory
# 或 npm install dsh-lite-memory
```

然后在 `package.json` 的 `dsh.profile.bundles` 数组追加 `"dsh-lite-memory"`，重启 dsh web 生效。

## 存储

| 数据 | 位置 |
|---|---|
| 记忆条目 | `~/.dsh/memory/memory.db`（表 `entries`） |
| 日历事项 | `~/.dsh/memory/memory.db`（表 `calendar`） |

旧版 `MEMORY.md` / `calendar.json` 数据不再读写。

## License

BSD-3-Clause
