#!/usr/bin/env node
/**
 * 稳定版静态服务：只读 releases/current，不参与开发构建。
 *
 * 为什么单独起一个：
 *   - 开发版（vite dev，5174）随时代码变化、HMR 可能中断；
 *   - 稳定版（5180）永远是一份构建产物，你在维护开发版时它也照常能用。
 *   - 数据存浏览器 localStorage，按 origin 分开，互不干扰；
 *     从开发版搬一次数据：开发版「导出数据」→ 稳定版「导入数据」。
 *
 * /api/chat 也会代理（稳定版里的路线助手要能用），key 读 .env.local。
 */
import { createServer } from 'node:http'
import { readFileSync, existsSync, realpathSync, statSync, mkdirSync, renameSync, writeFileSync, watch } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PORT = Number(process.env.PORT ?? 5180)
const releasesDir = path.join(root, 'releases')
const currentDir = path.join(releasesDir, 'current')
const ALLOWED_MODELS = new Set(['deepseek-flash', 'deepseek-chat'])
const ALLOWED_FIELDS = ['model', 'messages', 'tools', 'tool_choice', 'temperature', 'max_tokens', 'stream']

function readApiKey() {
  try {
    const raw = readFileSync(path.join(root, '.env.local'), 'utf8')
    for (const line of raw.split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
      if (m && m[1] === 'DEEPSEEK_API_KEY') return m[2].replace(/^["']|["']$/g, '')
    }
  } catch {}
  return process.env.DEEPSEEK_API_KEY ?? ''
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

async function proxyChat(req, res) {
  if (!currentDir || !existsSync(currentDir)) {
    res.statusCode = 503
    res.end(JSON.stringify({ error: '还没有稳定版，先跑 npm run release:stable' }))
    return
  }
  const apiKey = readApiKey()
  if (!apiKey) {
    res.statusCode = 500
    res.end(JSON.stringify({ error: '服务端没有配置 DEEPSEEK_API_KEY（见 .env.local）' }))
    return
  }
  let payload
  try {
    payload = JSON.parse((await readBody(req)).toString('utf8') || '{}')
  } catch {
    res.statusCode = 400
    res.end(JSON.stringify({ error: 'body 不是合法 JSON' }))
    return
  }
  const model = String(payload.model ?? '')
  if (!ALLOWED_MODELS.has(model)) {
    res.statusCode = 400
    res.end(JSON.stringify({ error: `不认识的模型：${model}` }))
    return
  }
  const body = { stream: payload.stream !== false }
  for (const k of ALLOWED_FIELDS) if (payload[k] !== undefined) body[k] = payload[k]

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
    res.end(JSON.stringify({ error: `上游请求失败：${err.message}` }))
  }
}

/* ---------- 本地数据 API（给 MCP / 外部 Agent 用，和开发版同一套协议） ---------- */
const routesFile =
  process.env.ROUTE_DATA_FILE ?? path.join(root, 'data', 'routes-stable.json')
const sseClients = new Set()
let routesBroadcastTimer = null
const broadcastRoutes = () => {
  if (routesBroadcastTimer) clearTimeout(routesBroadcastTimer)
  routesBroadcastTimer = setTimeout(() => {
    for (const res of sseClients) {
      try {
        res.write('data: changed\n\n')
      } catch {
        sseClients.delete(res)
      }
    }
  }, 100)
}
try {
  mkdirSync(path.dirname(routesFile), { recursive: true })
  const w = watch(path.dirname(routesFile), { persistent: false }, () => broadcastRoutes())
  process.on('exit', () => w.close())
} catch {}

async function handleRoutes(req, res) {
  const url = (req.url ?? '/').split('?')[0]
  if (url.startsWith('/api/routes/events')) {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
    })
    res.write('retry: 1500\n\n')
    sseClients.add(res)
    const ping = setInterval(() => {
      try {
        res.write(': ping\n\n')
      } catch {
        /* ignore */
      }
    }, 20000)
    req.on('close', () => {
      clearInterval(ping)
      sseClients.delete(res)
    })
    return
  }
  if (req.method === 'GET') {
    if (!existsSync(routesFile)) {
      res.statusCode = 404
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ error: '还没有数据文件', file: routesFile }))
      return
    }
    res.setHeader('content-type', 'application/json')
    res.end(readFileSync(routesFile, 'utf8'))
    return
  }
  if (req.method === 'PUT' || req.method === 'POST') {
    let data
    try {
      data = JSON.parse((await readBody(req)).toString('utf8') || '{}')
    } catch {
      res.statusCode = 400
      res.end(JSON.stringify({ error: 'body 不是合法 JSON' }))
      return
    }
    if (!data || !Array.isArray(data.boards)) {
      res.statusCode = 400
      res.end(JSON.stringify({ error: 'boards 必须是数组' }))
      return
    }
    mkdirSync(path.dirname(routesFile), { recursive: true })
    const tmp = `${routesFile}.tmp-${process.pid}`
    writeFileSync(tmp, JSON.stringify(data, null, 1), 'utf8')
    renameSync(tmp, routesFile)
    broadcastRoutes()
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ ok: true }))
    return
  }
  res.statusCode = 405
  res.end()
}

function serveStatic(req, res) {
  let base = currentDir
  if (existsSync(currentDir)) base = realpathSync(currentDir)
  const url = decodeURIComponent((req.url ?? '/').split('?')[0])
  let file = path.join(base, url === '/' ? 'index.html' : url)
  if (!file.startsWith(base)) {
    res.statusCode = 403
    res.end('forbidden')
    return
  }
  try {
    if (!existsSync(file) || statSync(file).isDirectory()) file = path.join(base, 'index.html')
    const data = readFileSync(file)
    res.setHeader('content-type', MIME[path.extname(file)] ?? 'application/octet-stream')
    res.end(data)
  } catch {
    res.statusCode = 404
    res.end('not found')
  }
}

const server = createServer(async (req, res) => {
  if (req.url?.startsWith('/api/routes')) {
    await handleRoutes(req, res)
    return
  }
  if (req.url?.startsWith('/api/chat')) {
    if (req.method !== 'POST') {
      res.statusCode = 405
      res.end('method not allowed')
      return
    }
    await proxyChat(req, res)
    return
  }
  serveStatic(req, res)
})

server.listen(PORT, '127.0.0.1', () => {
  const link = existsSync(currentDir) ? realpathSync(currentDir) : '(还没发布)'
  console.log(`[stable] 稳定版服务：http://127.0.0.1:${PORT}/`)
  console.log(`[stable] 当前版本：${path.basename(link)}`)
})
