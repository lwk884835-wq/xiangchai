#!/usr/bin/env node
/**
 * 想拆 · 稳定版守护进程（Windows）
 *
 * 作用等价于 macOS 上的 launchd（com.lwk.work-route-stable 的 KeepAlive）：
 *   - 拉起 scripts/stable-server.mjs 子进程
 *   - 子进程退出就等 2 秒重新拉起（发布后 release-auto 杀掉旧进程，这里自动换上新代码）
 *   - 启动时若 5180 已有服务在跑，直接退出，避免开两份
 *
 * 为什么不用 VBS / PowerShell 启动器：本机安全策略拦了 wscript/cscript，
 * node 作为计划任务动作是验证过可用的。
 *
 * 由计划任务「想拆-稳定版」在登录时调用：
 *   node scripts/win/supervisor.mjs
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, openSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const server = path.join(root, 'scripts', 'stable-server.mjs')
const dataDir = path.join(root, 'data')
const logFile = path.join(dataDir, 'stable-server.log')
const supPidFile = path.join(dataDir, 'supervisor.pid')
const PORT = 5180

const log = (m) => console.log(`[supervisor] ${m}`)

mkdirSync(dataDir, { recursive: true })
writeFileSync(supPidFile, String(process.pid), 'utf8')

function portAlive() {
  return new Promise((resolve) => {
    const req = fetch(`http://127.0.0.1:${PORT}/`, { signal: AbortSignal.timeout(1500) })
    req.then((r) => resolve(r.ok)).catch(() => resolve(false))
  })
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  if (await portAlive()) {
    log(`端口 ${PORT} 已有服务在跑，本次不重复启动`)
    return
  }

  for (;;) {
    const fd = openSync(logFile, 'a')
    const child = spawn(process.execPath, [server], {
      cwd: root,
      stdio: ['ignore', fd, fd],
      env: process.env,
      windowsHide: true,
    })
    log(`已启动 stable-server（PID ${child.pid}）`)

    await new Promise((resolve) => child.on('exit', (code, signal) => resolve({ code, signal })))
    log('stable-server 已退出，2 秒后重启')

    await sleep(2000)
    // 退出期间如果别的实例已经把端口占上了（例如手动起的），就不再重复拉
    if (await portAlive()) {
      log(`端口 ${PORT} 已被其它进程占用，守护进程退出`)
      return
    }
  }
}

main().catch((err) => {
  log(`守护进程异常：${err.message}`)
  process.exit(1)
})
