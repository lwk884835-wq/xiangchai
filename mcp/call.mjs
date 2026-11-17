#!/usr/bin/env node
/**
 * 手动调一次 MCP 工具（调试/演示用）：
 *   node call.mjs list_routes
 *   node call.mjs read_route '{"board":"我的路线"}'
 * 数据文件与服务端同一套优先级（ROUTE_DATA_FILE → routes-stable.json → routes.json），
 * 别再在这里写死开发版路径，否则读到的不是 lwk 的真实数据。
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { resolve } from 'node:path'
import { dataFile } from './routeCore.mjs'
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [resolve(import.meta.dirname, 'server.mjs')],
  env: { ...process.env, ROUTE_DATA_FILE: dataFile },
})
const client = new Client({ name: 'work-route-cli', version: '0.0.1' })
await client.connect(transport)
const [tool, raw] = process.argv.slice(2)
if (!tool) {
  const tools = await client.listTools()
  console.log(tools.tools.map((t) => `${t.name}: ${t.description ?? ''}`).join('\n'))
  process.exit(0)
}
const args = raw ? JSON.parse(raw) : {}
const res = await client.callTool({ name: tool, arguments: args })
console.log(res.content?.find((c) => c.type === 'text')?.text ?? '')
await client.close()
