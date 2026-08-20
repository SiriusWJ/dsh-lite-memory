# dsh-lite-memory — DSH 简化版记忆插件

参考 [dsh-auto-memory](https://github.com/Aik358/dsh-auto-memory) 裁剪的轻量记忆插件：

- **两级记忆**：全局（`~/.dsh/memory/MEMORY.md`）+ 项目（`~/.dsh/memory/workspaces/{工作区}/MEMORY.md`），复用原有目录结构
- **记忆工具**：`memory_recall`（关键词检索）/ `memory_write`（append/replace，带乱码/重复行卫生检查）
- **日历与提醒**：`calendar_add` / `calendar_list` / `calendar_done` / `calendar_remove`；到点后通过 `agent.followup` 把提醒投递到注册会话（会话被移除则新建会话投递）
- **对话面板「记忆」tab**：查看/编辑全局与项目记忆
- **设置页「记忆」分区**：日历视图（添加/完成/删除/刷新，四象限）
- **中英双语**：跟随 DSH 设置的语言，无手动外观设置、默认字号

## 已裁剪（对比 dsh-auto-memory）

主动注入、每轮自动沉淀、每日反思/日志、AI 问候、智能检索、外部记忆继承、侧边栏浮层面板、外观设置、写入预算。

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
| 全局记忆 | `~/.dsh/memory/MEMORY.md` |
| 项目记忆 | `~/.dsh/memory/workspaces/{工作区}/MEMORY.md` |
| 日历 | `~/.dsh/memory/calendar.json` |

## License

BSD-3-Clause
