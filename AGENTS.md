# AGENTS.md — 想拆（项目级）

> 给**所有会话 / Agent**：这个项目 lwk 已经在自己每天用了，改动前先读完这一页。
> 人类向的说明在 `README.md`「稳定版 vs 开发版」一节。

## 两个部署，别搞混

| | 地址 | 怎么来的 | 用途 |
|---|---|---|---|
| **稳定版（lwk 日常用）** | http://127.0.0.1:5180 | `releases/current` 里的**构建产物**，由 launchd `com.lwk.work-route-stable` 常驻（`scripts/stable-server.mjs`） | lwk 每天记路线；**不要拿它做实验** |
| 开发版（改代码用） | http://127.0.0.1:5174 | `npm run dev`（工作区源码 + HMR） | 开发、测试；随时会变 |

- 发布：`npm run release:stable`（默认从 **git HEAD** 构建；`-- <git-ref>` 指定提交/回滚）。
- **发布只认提交**：工作区没提交的改动不会进稳定版——这是故意的，别为了「让 lwk 看到」去手动改 `releases/current`。
- 版本目录 `releases/<时间>-<sha>/`，保留最近 6 个；服务永远读 `releases/current` 软链。
- 发布前：`npm run build` 通过 + 开发版真点一遍；发布后告诉 lwk 刷新 5180。

## 数据：lwk 的真实数据不在你的浏览器里

- 路线数据存 **localStorage**（key `work-route-actions-v1`），**按 origin 隔离**。
- lwk 的真实数据在**他自己浏览器**里、稳定版 origin（`127.0.0.1:5180`）下。
- 开发版（5174）和你的无头浏览器都是**另一份数据**，随便造；但不要把 lwk 的真实数据导进开发版长期用。
- **禁止**清 lwk 的浏览器数据、改 storage key、在不写迁移的情况下改持久化结构（`store/actions.ts` 的 persist/merge）。真要动结构：
  1. 在 `merge` 里兼容旧数据（或 bump key 并写迁移）；
  2. 发布前提醒 lwk 先在稳定版「导出数据」备份；
  3. 发布后确认老数据能正常打开。
- 稳定版是**生产构建**，没有 `window.__route` 这个 DEV 调试钩子；验证稳定版请走 UI（导入/导出、点击操作）。

## 不要碰的东西

- 5180 端口、`releases/` 目录、`releases/current` 软链
- `~/Library/LaunchAgents/com.lwk.work-route-stable.plist`
- 桌面 `工作路线-稳定版.webloc` / `.command`
- 如果确实要挪项目目录：先让 lwk 确认，再改 plist 里的路径并重启 launchd。

## 多会话协作

- 这个仓库可能同时有**别的会话/Agent** 在改（例如 MCP 支持、数据同步）。开工先 `git status`、`git log -1` 看现状，**不要回滚别人的改动**。
- 提交时只 `git add` 自己改的文件；别 `git add -A` 把别人半成品带进去。
- 改完保持 `npx tsc --noEmit` 通过；QA 临时脚本用完删掉，不要提交。
- 稳定版从提交构建：**别人提交的代码也可能被发布**。发布前先看 `git log -1` 是什么，确认那版验证过。

## 目录速记

```
scripts/release.mjs        发布：build + 复制到 releases + 切 current + 清理旧版
scripts/stable-server.mjs  稳定版静态服务 + /api/routes 数据接口
releases/                  构建产物（gitignore，不要提交）
src/store/actions.ts       路线数据（persist 到 localStorage）——改结构要迁移
src/lib/deepLink.ts        深链：?route=<boardId>&node=<nodeId>（也认 ?c=<码>）
mcp/                       外部 Agent 的 MCP server（本项目唯一的 Agent 入口）
```


## 自动更新 5180（26.11.2 起，所有会话 / Agent 都照这个做）

lwk 的口径：**以后 5180 由 Agent 改完自动更新，不用再等他确认。**

流程（每次改完、验证通过之后）：

1. `git add` 只加自己改的文件 → `git commit`
2. 跑 `npm run release:auto`

`release:auto` 会：备份 `data/routes-stable.json` → 从 **git HEAD** 构建发布（不读工作区）→
`launchctl` 重启稳定版服务（让 stable-server 的新代码生效）→ 轮询 5180 页面和 `/api/routes` 做健康检查。

- 发布只认提交：工作区没提交的改动不会进稳定版；失败时**不要手改** `releases/current`，看
  `/tmp/work-route-stable.log` 并如实汇报。
- 发布后告诉 lwk「刷新 5180」一次即可；**不要**自己动他的浏览器。
- 只发布**验证过**的那版（`npm run build` + 开发版真点一遍）；别拿正在改的中间状态发。
- 其他 Agent 同样适用：这个仓库可能多会话并行，发布前先 `git log -1` 看 HEAD 是什么、是否验证过。

## MCP / 外部 Agent 读写数据（26.11.2 起）

- 开发版（5174）数据文件：`data/routes.json`
- 稳定版（5180）数据文件：`data/routes-stable.json`（lwk 刷新一次稳定版后，会自动把他 localStorage 的数据写进来）
- MCP server 在 `mcp/`：`npm run mcp:list`；数据文件默认优先 `routes-stable.json`，可用 `ROUTE_DATA_FILE` 覆盖
- **码**：路线/卡片都有 5 位码（`#9NVDA`，算法正本 `mcp/code.mjs`，网页 `src/lib/code.ts` 直接引用）；MCP 所有
  `board` / `node` / `id` 参数都先按码解析，`read_route` 每行开头带码，另有 `find_code` / `list_codes`。
  改这块时别把算法复制成两份——两边算出的码不一样，就全乱了。
- 网页和文件通过 `/api/routes` + SSE 双向同步；纯静态部署没有接口时自动退回 localStorage
- 真实数据只落本地文件（已 gitignore），不要提交
- **深链**：`http://127.0.0.1:5180/?route=<boardId>&node=<nodeId>` 打开即定位到那张卡（`?c=<5 位码>` 也认）。
  往笔记里放链接用 Markdown `[标题](链接)`，别在正文写码
