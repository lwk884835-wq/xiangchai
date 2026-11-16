import { defineConfig, type Connect, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'
import { existsSync, mkdirSync, readFileSync, renameSync, watch, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import type { ServerResponse } from 'node:http'

/**
 * 想拆 · 独立的行动路线网页。
 *
 * 路线数据全在浏览器本地；MCP / 外部 Agent 通过 /api/routes 读写同一份数据文件。
 */

/**
 * 行动路线的本地数据 API（给 MCP / 外部 Agent 用）：
 * - GET  /api/routes        读当前整份数据
 * - PUT  /api/routes        写回（网页保存时用）
 * - GET  /api/routes/events SSE：文件被外部改了就通知网页刷新
 *
 * 数据文件在项目根 data/routes.json；MCP server 直接读写同一个文件。
 * 静态部署（没有这个中间件）时，网页自动退回 localStorage，不影响现有用法。
 */
function routeDataApi(): Plugin {
  const file = resolve(process.cwd(), 'data/routes.json')
  const clients = new Set<ServerResponse>()
  let broadcastTimer: NodeJS.Timeout | null = null
  const broadcast = () => {
    if (broadcastTimer) clearTimeout(broadcastTimer)
    broadcastTimer = setTimeout(() => {
      for (const res of clients) {
        try {
          res.write('data: changed\n\n')
        } catch {
          clients.delete(res)
        }
      }
    }, 100)
  }
  const read = () => (existsSync(file) ? readFileSync(file, 'utf8') : null)
  const write = (body: string) => {
    mkdirSync(dirname(file), { recursive: true })
    const tmp = `${file}.tmp-${process.pid}`
    writeFileSync(tmp, body, 'utf8')
    renameSync(tmp, file)
  }
  const handler: Connect.NextHandleFunction = async (req, res, next) => {
    const url = (req.url || '/').split('?')[0]
    if (url.startsWith('/events')) {
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
      })
      res.write('retry: 1500\n\n')
      clients.add(res)
      const ping = setInterval(() => {
        try {
          res.write(': ping\n\n')
        } catch {
          /* ignore */
        }
      }, 20000)
      req.on('close', () => {
        clearInterval(ping)
        clients.delete(res)
      })
      return
    }
    if (req.method === 'GET') {
      const body = read()
      if (!body) {
        // 文件还不存在：返回空快照，让网页把本地数据推上来（比 404 干净，也避免首次加载竞态）
        res.setHeader('content-type', 'application/json')
        res.end(
          JSON.stringify({
            version: 1,
            updatedAt: 0,
            boards: [],
            focusItems: [],
            collapsed: {},
            activeBoardId: null,
          }),
        )
        return
      }
      res.setHeader('content-type', 'application/json')
      res.end(body)
      return
    }
    if (req.method === 'PUT' || req.method === 'POST') {
      const chunks: Buffer[] = []
      for await (const chunk of req) chunks.push(chunk as Buffer)
      let data: unknown
      try {
        data = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
      } catch {
        res.statusCode = 400
        res.end(JSON.stringify({ error: 'body 不是合法 JSON' }))
        return
      }
      const snap = data as { boards?: unknown }
      if (!snap || !Array.isArray(snap.boards)) {
        res.statusCode = 400
        res.end(JSON.stringify({ error: 'boards 必须是数组' }))
        return
      }
      write(JSON.stringify(data, null, 1))
      broadcast()
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ ok: true }))
      return
    }
    next()
  }
  return {
    name: 'work-route-data-api',
    configureServer(server) {
      server.middlewares.use('/api/routes', handler)
      try {
        mkdirSync(dirname(file), { recursive: true })
        const w = watch(dirname(file), { persistent: false }, () => broadcast())
        server.httpServer?.on('close', () => w.close())
      } catch {
        /* ignore */
      }
    },
    configurePreviewServer(server) {
      server.middlewares.use('/api/routes', handler)
    },
  }
}

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss(), routeDataApi()],
    resolve: {
      alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    },
    server: { port: 5174, host: '127.0.0.1' },
  }
})
