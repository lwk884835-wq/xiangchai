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
 */
import { createServer } from 'node:http'
import { spawn, execFile } from 'node:child_process'
import { readFileSync, existsSync, realpathSync, statSync, mkdirSync, renameSync, writeFileSync, watch, openSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PORT = Number(process.env.PORT ?? 5180)
const releasesDir = path.join(root, 'releases')
const currentDir = path.join(releasesDir, 'current')

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

/* ---------- 版本检测 + 自助更新 ---------- */
const updateStateFile = path.join(root, 'data', 'update-state.json')
let updateRunning = false

/** 当前部署的版本 = releases/current 目录名里的短 sha */
function deployedVersion() {
  try {
    const link = realpathSync(currentDir)
    const m = path.basename(link).match(/-([0-9a-f]{7,})$/i)
    return m ? m[1] : path.basename(link)
  } catch {
    return null
  }
}

function readUpdateState() {
  try {
    return JSON.parse(readFileSync(updateStateFile, 'utf8'))
  } catch {
    return { phase: 'idle' }
  }
}

/** git fetch 只更新 origin 引用，不动工作区；结果缓存 2 分钟，避免每次开页面都跑 */
let remoteCache = { sha: null, at: 0 }
const REMOTE_TTL = 2 * 60 * 1000
function fetchRemote(force = false) {
  return new Promise((resolve) => {
    if (!force && Date.now() - remoteCache.at < REMOTE_TTL) return resolve(remoteCache)
    execFile(
      'git',
      ['fetch', '--quiet', 'origin', 'main'],
      { cwd: root, timeout: 25000 },
      (fetchErr) => {
        // fetch 失败也用上一次的缓存，别让页面因为断网白等
        execFile(
          'git',
          ['rev-parse', 'origin/main'],
          { cwd: root },
          (err, stdout) => {
            if (!err && stdout.trim()) {
              remoteCache = { sha: stdout.trim(), at: Date.now() }
            } else if (!remoteCache.sha) {
              remoteCache = { sha: null, at: Date.now(), error: fetchErr?.message || err?.message || '无法读取远端' }
            }
            resolve(remoteCache)
          },
        )
      },
    )
  })
}

async function handleVersion(req, res) {
  const force = (req.url ?? '').includes('force=1')
  const cache = await fetchRemote(force)
  const deployed = deployedVersion()
  const remote = cache.sha ? cache.sha.slice(0, 7) : null
  const update = readUpdateState()
  const response = {
    deployed,
    remote,
    hasUpdate: Boolean(deployed && remote && deployed !== remote),
    updateRunning,
    update,
    checkedAt: cache.at,
    error: cache.error ?? null,
  }
  res.setHeader('content-type', 'application/json')
  res.end(JSON.stringify(response))
}

function handleUpdate(req, res) {
  if (req.method !== 'POST') {
    res.statusCode = 405
    res.end(JSON.stringify({ error: '请用 POST' }))
    return
  }
  if (updateRunning) {
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ ok: true, already: true }))
    return
  }
  updateRunning = true
  // 脱离 5180 的独立进程：服务重启也不会把它带走。
  // stdio 写日志文件而非 ignore：detached 下若丢弃，release.mjs 里的 git archive|tar 会失败。
  const logFd = openSync(path.join(root, 'data', 'update.log'), 'a')
  const child = spawn(process.execPath, [path.join(root, 'scripts', 'update.mjs')], {
    cwd: root,
    detached: true,
    stdio: ['ignore', logFd, logFd],
    env: process.env,
  })
  child.unref()
  setTimeout(() => {
    updateRunning = false
  }, 5000)
  res.setHeader('content-type', 'application/json')
  res.end(JSON.stringify({ ok: true }))
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
  if (req.url?.startsWith('/api/version')) {
    await handleVersion(req, res)
    return
  }
  if (req.url?.startsWith('/api/update')) {
    handleUpdate(req, res)
    return
  }
  serveStatic(req, res)
})

server.listen(PORT, '127.0.0.1', () => {
  const link = existsSync(currentDir) ? realpathSync(currentDir) : '(还没发布)'
  console.log(`[stable] 稳定版服务：http://127.0.0.1:${PORT}/`)
  console.log(`[stable] 当前版本：${path.basename(link)}`)
})
