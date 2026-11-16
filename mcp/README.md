# 想拆 MCP server

把「行动路线」暴露成一个 MCP server，让支持 MCP 的客户端（WorkBuddy / 豆包 / Claude Desktop / Claude Code / Cursor / VS Code…）
直接读和改你的路线。这是本项目唯一的 Agent 入口——应用本身没有内置对话助手。

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
    "xiangchai": {
      "command": "node",
      "args": ["<你把仓库克隆到的路径>/mcp/server.mjs"]
    }
  }
}
```

`<你把仓库克隆到的路径>` 换成实际的绝对路径，比如 `/Users/你/xiangchai/mcp/server.mjs`。
先在这个仓库根目录和 `mcp/` 各跑一次 `npm install`。

**Claude Code / Cursor / 其它 stdio 客户端**：同样是 `command: node` + `args: [server.mjs 绝对路径]`。

**DSH**：在设置里添加 stdio MCP server，命令同上。

## 工具

| 工具 | 作用 |
|---|---|
| `list_routes` | 列出所有路线（含所属文件夹、路线码） |
| `read_route` | 读整棵树的缩进文本（含目的/做法/备注批注），或某个任务的位置与完整字段 |
| `apply_plan_ops` | create / update / delete（deleteMode=only\|cascade）/ focus / detach / replace；节点支持 purpose/detail/notes |
| `move_nodes` | child（整串搬）/ before・after（单卡调序）/ board（跨路线） |
| `set_done` | 勾选/取消（按网页级联规则） |
| `manage_routes` | 路线的新建/改名/归档/恢复/删除/切换/设置文件夹（op=folder） |
| `focus_items` | 顶部「重点」里临时事项的加/勾/取消/删 |
| `find_code` | 按码找：`#9NVDA` 是路线还是哪条路线里的哪张卡（可一次查多个） |
| `list_codes` | 一次拿全部路线码 + 卡片码（可只取一条路线、按标题过滤） |

## 码（卡片 / 路线的短指代）

每条路线、每张卡都有一个 **5 位码**：`#9NVDA`。

- 网页里：卡片 hover 右上角写出码，点一下就复制；右键菜单、「详情抽屉标题旁」、「路线列表 hover」都有复制入口
- 码是**从数据里已有的 id 派生**的，不新增字段：改名、移动、换父级、导出再导入，码都跟着同一条路线/同一张卡走
- 复制/粘贴出来的卡是**新卡**，码会变（新卡不是原卡）；卡删掉后码失效，`find_code` 会回 `missing`
- 所有工具的 `board` / `node` / `id` 参数都先按码解析，再按 id、标题（`#`、全角＃、大小写都能容忍）
- `read_route` 的每一行开头就是码，Agent 回话也能用码反过来指给你

## 注意

- 只读写本地文件，不需要网络、不会外传。
- 顶部「重点」是**跨路线**的（26.11.14 起）：所有路线里 `pinned` 过的节点汇在同一份清单里，切路线不换内容，归档的路线不进来；`focus_items` 管的仍是用户手加的那几条临时事项。
- 网页没开也能改；下次打开网页会以文件为准加载。
- `call.mjs` 调试 CLI 默认读写开发版 `data/routes.json`；想调真实数据显式传 `ROUTE_DATA_FILE=../data/routes-stable.json`。
- 被链接进当天路线的任务在树里带 `↪` 前缀（`linkBoardId` 指向来源路线）；
- 正文里的内嵌图片在文本里是 `[[img:id]]` 占位符，图片本体存在数据文件的 `images` 里；`read_route` 会把占位符显示成「〔图片〕」，写操作不会丢掉 `images`。
- 建议在 `mcp/` 目录外先备份数据文件（或直接用网页的「导出数据」）。
