#!/usr/bin/env node
/**
 * 工作路线 MCP server（stdio）。
 *
 * 直接读写 ../data/routes.json（可用 ROUTE_DATA_FILE 覆盖）。
 * 网页通过 Vite 的 /api/routes 读写同一份文件，SSE 实时同步——
 * 外部 Agent（DSH / Claude Desktop / Cursor / Codex…）改完，网页立刻能看到。
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import * as core from './routeCore.mjs'

const server = new McpServer({ name: 'work-route', version: '0.1.0' })
const text = (obj) => ({ content: [{ type: 'text', text: JSON.stringify(obj, null, 1) }] })

const run = (fn) => async (args) => {
  const state = core.load()
  try {
    const out = fn(state, args)
    core.save(state)
    return text({ ok: true, dataFile: core.dataFile, ...out })
  } catch (err) {
    return text({ ok: false, reason: String(err?.message ?? err) })
  }
}

server.registerTool(
  'list_routes',
  {
    title: '列出所有路线',
    description:
      '列出所有行动路线（计划）的标题、5 位路线码、节点数、是否归档、哪条是当前路线。路线码可以直接填进别的工具的 board 参数。',
    inputSchema: {},
  },
  async () => text({ boards: core.listRoutes(core.load()), dataFile: core.dataFile }),
)

server.registerTool(
  'read_route',
  {
    title: '读路线结构',
    description:
      '读一条路线的层级树（缩进文本），或某个任务在树里的位置（父级/上一步/下一步/同层并行/子任务）。不传 board 就是当前路线。' +
      '每行开头的 #XXXXX 是卡片码，可以直接拿来当 node/id 参数；返回里也带 boardCode。',
    inputSchema: {
      board: z.string().optional().describe('路线名/id/标签/5 位路线码；不传=当前路线'),
      node: z.string().optional().describe('任务 id、标题或 5 位卡片码；传了就看这个任务的位置'),
    },
  },
  async (args) => {
    const out = core.readRoute(core.load(), args)
    return text(out)
  },
)

server.registerTool(
  'find_code',
  {
    title: '按码找（路线 / 卡片）',
    description:
      '用户给了一个码（#9NVDA 这种，5 位）时用：返回它是哪条路线里的哪张卡、第几层、标题、目的/做法/备注、从根到它的路径。' +
      '能一次查多个（空格或逗号分开）。找不到会放在 missing 里。',
    inputSchema: {
      code: z.string().describe('5 位码，可带 #；多个用空格/逗号分开'),
      board: z.string().optional().describe('只在某条路线里找（名字/id/码）'),
    },
  },
  async (args) => text({ dataFile: core.dataFile, ...core.findByCode(core.load(), args) }),
)

server.registerTool(
  'list_codes',
  {
    title: '拿全部码（路线 + 卡片）',
    description:
      '一次返回所有路线码和卡片码（可只取一条路线、或按标题过滤）。' +
      '需要快速定位、核对用户说的「某个码」时，比把整棵树读进来省 token。',
    inputSchema: {
      board: z.string().optional().describe('只要这条路线的码'),
      q: z.string().optional().describe('标题里包含这段文字才返回'),
    },
  },
  async (args) => text({ dataFile: core.dataFile, ...core.listCodes(core.load(), args) }),
)

server.registerTool(
  'apply_plan_ops',
  {
    title: '改路线（建/改/删/重点/独立成线/整树重排）',
    description:
      '改行动路线。op=create 建节点（可一次建整棵树，子节点 parentId 写父节点标题）；update 改内容/父级/层级；' +
      'delete 删节点（deleteMode=only 默认：子任务一起删、后面一步自动接回前一步；cascade=这条和后面整串一起删）；' +
      'focus 定/取消重点；detach 把串行链上的任务独立成一条线；replace 整条路线重排。' +
      '节点可以用 5 位卡片码（#9NVDA）指代，用户贴码时直接用。',
    inputSchema: {
      op: z.enum(['create', 'update', 'delete', 'focus', 'detach', 'replace']),
      board: z.string().optional().describe('要改哪条路线；不填=当前路线；填了不存在会新建'),
      deleteMode: z.enum(['only', 'cascade']).optional().describe('op=delete 时怎么删'),
      nodes: z
        .array(
          z
            .object({
              id: z.string().optional().describe('update/delete/focus/detach 用：节点 id、标题或 5 位卡片码'),
              title: z.string().optional(),
              purpose: z.string().optional().describe('行动目标/目的'),
              detail: z.string().optional().describe('具体怎么做'),
              notes: z.string().optional().describe('其他备注/批注'),
              dropped: z.boolean().optional().describe('标记「不太合适」：卡片划去/灰掉但保留'),
              level: z.number().optional(),
              parentId: z.string().optional().describe('父节点 id 或标题；update 时换父级'),
              branch: z.string().optional().describe('同一父级下相同 branch=一条串行线，不同=并行多条线'),
              parallel: z.boolean().optional(),
              pinned: z.boolean().optional(),
              done: z.boolean().optional(),
              deps: z.array(z.string()).optional(),
              focus: z.boolean().optional(),
            })
            .passthrough(),
        )
        .describe('节点列表'),
    },
  },
  run((state, args) => core.applyOps(state, args)),
)

server.registerTool(
  'move_nodes',
  {
    title: '搬任务/调顺序',
    description:
      '移动任务：position=child 变成某张卡的并行子任务（整串一起搬）；position=before/after 插到同串某张卡前/后（只搬这一张+它的子任务）；' +
      '传 board 可以跨路线搬（只支持 child）。',
    inputSchema: {
      moves: z.array(
        z.object({
          id: z.string().describe('要搬的任务：id、标题或 5 位卡片码'),
          target: z.string().optional().describe('目标任务：id、标题或 5 位卡片码'),
          board: z.string().optional().describe('目标路线：名字/id（跨路线时用）'),
          position: z.enum(['child', 'before', 'after']).optional(),
        }),
      ),
    },
  },
  run((state, args) => core.moveNodes(state, args)),
)

server.registerTool(
  'set_done',
  {
    title: '勾选/取消完成',
    description: '勾选或取消任务完成状态，按网页规则级联（勾父带子、勾后带前，取消反向松开）。',
    inputSchema: {
      nodes: z.array(
        z.object({
          id: z.string().describe('任务 id、标题或 5 位卡片码'),
          done: z.boolean(),
        }),
      ),
    },
  },
  run((state, args) => core.setDone(state, args)),
)

server.registerTool(
  'manage_routes',
  {
    title: '管理路线本身',
    description:
      '新建 / 改名 / 归档 / 恢复 / 删除 / 切换当前路线 / 列出路线 / 设置所属文件夹（op=folder）。',
    inputSchema: {
      op: z.enum(['list', 'create', 'rename', 'archive', 'restore', 'delete', 'select', 'folder']),
      board: z.string().optional().describe('目标路线：名字/id/标签/5 位路线码'),
      title: z.string().optional(),
      label: z.string().optional(),
      city: z.string().optional(),
      folder: z.string().optional().describe('所属文件夹（空字符串=未分类）'),
    },
  },
  run((state, args) => core.manageRoutes(state, args)),
)

server.registerTool(
  'focus_items',
  {
    title: '顶部重点里的临时事项',
    description: '编辑顶部「重点」里用户手动加的事项：加一条 / 勾掉 / 取消勾 / 删掉 / 列出。',
    inputSchema: {
      op: z.enum(['list', 'add', 'toggle', 'remove']),
      id: z.string().optional(),
      text: z.string().optional(),
    },
  },
  run((state, args) => core.focusItems(state, args)),
)

const transport = new StdioServerTransport()
await server.connect(transport)
