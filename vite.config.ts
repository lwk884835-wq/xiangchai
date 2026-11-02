import { defineConfig, loadEnv, type Connect, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'
import { existsSync, mkdirSync, readFileSync, renameSync, watch, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import type { ServerResponse } from 'node:http'

/**
 * 工作路线 · 独立的行动路线网页。
 *
 * 路线数据全在浏览器本地；只有「路线助手」需要模型，走 /api/chat 代理，
 * key 放在 .env.local（没有 VITE_ 前缀，永远不打进前端产物）。
 */
const ALLOWED_MODELS = new Set(['deepseek-flash', 'deepseek-chat'])
const ALLOWED_FIELDS = ['model', 'messages', 'tools', 'tool_choice', 'temperature', 'max_tokens', 'stream']

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

function chatProxy(apiKey: string): Plugin {
  const handler: Connect.NextHandleFunction = async (req, res, next) => {
    if (req.method !== 'POST') return next()
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(chunk as Buffer)

    let payload: Record<string, unknown>
    try {
      payload = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
    } catch {
      res.statusCode = 400
      res.end(JSON.stringify({ error: 'body 不是合法 JSON' }))
      return
    }
    if (!apiKey) {
      res.statusCode = 500
      res.end(JSON.stringify({ error: '服务端没有配置 DEEPSEEK_API_KEY（见 .env.local）' }))
      return
    }
    const model = String(payload.model ?? '')
    if (!ALLOWED_MODELS.has(model)) {
      res.statusCode = 400
      res.end(JSON.stringify({ error: `不认识的模型：${model}` }))
      return
    }

    const body: Record<string, unknown> = { stream: payload.stream !== false }
    for (const key of ALLOWED_FIELDS) if (payload[key] !== undefined) body[key] = payload[key]

    try {
      const upstream = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(body),
      })
      res.statusCode = upstream.status
      res.setHeader('content-type', upstream.headers.get('content-type') ?? 'text/event-stream')
      res.setHeader('cache-control', 'no-cache, no-transform')
      if (!upstream.body) {
        res.end()
        return
      }
      const reader = upstream.body.getReader()
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        res.write(Buffer.from(value))
      }
      res.end()
    } catch (err) {
      res.statusCode = 502
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ error: `上游请求失败：${(err as Error).message}` }))
    }
  }

  return {
    name: 'work-route-chat-proxy',
    configureServer(server) {
      server.middlewares.use('/api/chat', handler)
    },
    configurePreviewServer(server) {
      server.middlewares.use('/api/chat', handler)
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [react(), tailwindcss(), routeDataApi(), chatProxy(env.DEEPSEEK_API_KEY ?? '')],
    resolve: {
      alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    },
    server: { port: 5174, host: '127.0.0.1' },
  }
})
