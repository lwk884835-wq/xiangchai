# 工作路线 MCP server

把「行动路线」暴露成一个 MCP server，让支持 MCP 的客户端（DSH / Claude Desktop / Claude Code / Cursor / VS Code…）
直接读和改你的路线。

**数据文件优先级**：

1. 环境变量 `ROUTE_DATA_FILE`
2. `../data/routes-stable.json` —— **稳定版（5180，lwk 日常用）的真实数据**（刷新一次稳定版后自动生成）
3. `../data/routes.json` —— 开发版（5174）的数据

网页通过本地数据 API（开发版 Vite 中间件 / 稳定版 stable-server）读写同一份文件，
SSE 实时同步——外部 Agent 改完，网页会自动刷新；网页里改的，文件也会跟着更新。

## 启动

```bash
cd mcp
npm install        # 第一次
node server.mjs    # stdio，普通客户端会自动拉起，一般不用手动跑
```

调试用：

```bash
node call.mjs list_routes
node call.mjs read_route '{"board":"我的路线"}'
node call.mjs apply_plan_ops '{"op":"create","nodes":[{"title":"目标","level":1}]}'
# 指定数据文件（比如调试开发版而不是稳定版）
ROUTE_DATA_FILE=../data/routes.json node call.mjs list_routes
```

## 客户端配置示例

**Claude Desktop**（`~/Library/Application Support/Claude/claude_desktop_config.json`）：

```json
{
  "mcpServers": {
    "work-route": {
      "command": "node",
      "args": ["/Users/lwk/Documents/deepseek-harness/default-workspace/工作路线网页/mcp/server.mjs"]
    }
  }
}
```

**Claude Code / Cursor / 其它 stdio 客户端**：同样是 `command: node` + `args: [server.mjs 绝对路径]`。

**DSH**：在设置里添加 stdio MCP server，命令同上。

## 工具

| 工具 | 作用 |
|---|---|
| `list_routes` | 列出所有路线 |
| `read_route` | 读整棵树的缩进文本，或某个任务的位置 |
| `apply_plan_ops` | create / update / delete（deleteMode=only\|cascade）/ focus / detach / replace |
| `move_nodes` | child（整串搬）/ before・after（单卡调序）/ board（跨路线） |
| `set_done` | 勾选/取消（按网页级联规则） |
| `manage_routes` | 路线的新建/改名/归档/恢复/删除/切换 |
| `focus_items` | 顶部「重点」里临时事项的加/勾/取消/删 |

## 注意

- 只读写本地文件，不需要网络、不会外传。
- 网页没开也能改；下次打开网页会以文件为准加载。
- 建议在 `mcp/` 目录外先备份 `data/routes.json`（或直接用网页的「导出数据」）。
