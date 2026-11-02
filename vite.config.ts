import { defineConfig, loadEnv, type Connect, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'

/**
 * 工作路线 · 独立的行动路线网页。
 *
 * 路线数据全在浏览器本地；只有「路线助手」需要模型，走 /api/chat 代理，
 * key 放在 .env.local（没有 VITE_ 前缀，永远不打进前端产物）。
 */
const ALLOWED_MODELS = new Set(['deepseek-flash', 'deepseek-chat'])
const ALLOWED_FIELDS = ['model', 'messages', 'tools', 'tool_choice', 'temperature', 'max_tokens', 'stream']

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
    plugins: [react(), tailwindcss(), chatProxy(env.DEEPSEEK_API_KEY ?? '')],
    resolve: {
      alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    },
    server: { port: 5174, host: '127.0.0.1' },
  }
})
