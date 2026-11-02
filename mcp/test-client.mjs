#!/usr/bin/env node
/** 用官方 SDK 的 Client 起一次 server，跑一遍工具（自测用） */
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { rmSync } from 'node:fs'
import { resolve } from 'node:path'

const file = process.env.ROUTE_DATA_FILE ?? resolve(import.meta.dirname, '..', 'data', 'routes-mcp-test.json')
try { rmSync(file) } catch {}

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [resolve(import.meta.dirname, 'server.mjs')],
  env: { ...process.env, ROUTE_DATA_FILE: file },
})
const client = new Client({ name: 'work-route-test', version: '0.0.1' })
await client.connect(transport)

const show = (label, res) => {
  const text = res.content?.find((c) => c.type === 'text')?.text ?? ''
  console.log(`\n### ${label}\n${text.slice(0, 900)}`)
  return text
}
const call = async (name, args) => show(name + ' ' + JSON.stringify(args), await client.callTool({ name, arguments: args }))

const tools = await client.listTools()
console.log('tools:', tools.tools.map((t) => t.name).join(', '))

await call('apply_plan_ops', {
  op: 'create',
  board: 'MCP 测试路线',
  nodes: [
    { title: '目标', purpose: '把事做成', level: 1 },
    { title: '身体', level: 2, parentId: '目标', branch: '身体', parallel: true },
    { title: '运动', level: 3, parentId: '身体', branch: '身体' },
    { title: '睡觉', level: 3, parentId: '身体', branch: '睡眠', parallel: true },
  ],
})
await call('read_route', { board: 'MCP 测试路线' })
await call('set_done', { nodes: [{ id: '运动', done: true }] })
await call('move_nodes', { moves: [{ id: '睡觉', target: '运动', position: 'before' }] })
await call('apply_plan_ops', { op: 'delete', board: 'MCP 测试路线', nodes: [{ id: '运动' }], deleteMode: 'only' })
await call('focus_items', { op: 'add', text: 'MCP 加的临时重点' })
await call('manage_routes', { op: 'rename', board: 'MCP 测试路线', title: 'MCP 改名路线' })
await call('list_routes', {})

await client.close()
console.log('\ndataFile:', file)
