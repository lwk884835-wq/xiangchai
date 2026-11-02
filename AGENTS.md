# AGENTS.md — 工作路线网页（项目级）

> 给**所有会话 / Agent**：这个项目 lwk 已经在自己每天用了，改动前先读完这一页。
> 人类向的说明在 `README.md`「稳定版 vs 开发版」一节。

## 两个部署，别搞混

| | 地址 | 怎么来的 | 用途 |
|---|---|---|---|
| **稳定版（lwk 日常用）** | http://127.0.0.1:5180 | `releases/current` 里的**构建产物**，由 launchd `com.lwk.work-route-stable` 常驻（`scripts/stable-server.mjs`，含 `/api/chat` 代理） | lwk 每天记路线；**不要拿它做实验** |
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

- 这个仓库可能同时有**别的会话/Agent** 在改（例如路线 Agent 工具、MCP 支持）。开工先 `git status`、`git log -1` 看现状，**不要回滚别人的改动**。
- 提交时只 `git add` 自己改的文件；别 `git add -A` 把别人半成品带进去。
- 改完保持 `npx tsc --noEmit` 通过；QA 临时脚本用完删掉，不要提交。
- 稳定版从提交构建：**别人提交的代码也可能被发布**。发布前先看 `git log -1` 是什么，确认那版验证过。

## 目录速记

```
scripts/release.mjs        发布：build + 复制到 releases + 切 current + 清理旧版
scripts/stable-server.mjs  稳定版静态服务 + /api/chat 代理（读 .env.local）
releases/                  构建产物（gitignore，不要提交）
src/store/actions.ts       路线数据（persist 到 localStorage）——改结构要迁移
src/lib/tools.ts           内置「路线助手」的工具（read/update/load_skill）
```
