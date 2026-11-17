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
 * ⚠️ 关于黑框：计划任务直接拉起 node.exe 会带一个控制台窗口（黑框），
 * 而控制台窗口属于 conhost.exe，从 node 进程查窗口句柄查不到。
 * 所以这里做「自重生」：第一次被拉起时立刻以隐藏窗口的方式重新启动自己再退出，
 * 前台那个黑框随之关闭。带 XC_SUPERVISOR_DETACHED=1 的那个才是真正常驻的守护。
 *
 * 由计划任务「想拆-稳定版」在登录时 / 每 2 分钟巡检时调用。
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const self = fileURLToPath(import.meta.url)
const root = path.resolve(path.dirname(self), '..', '..')
const server = path.join(root, 'scripts', 'stable-server.mjs')
const dataDir = path.join(root, 'data')
const logFile = path.join(dataDir, 'stable-server.log')
const supPidFile = path.join(dataDir, 'supervisor.pid')
const PORT = 5180
const DETACHED = process.env.XC_SUPERVISOR_DETACHED === '1'

const log = (m) => console.log(`[supervisor] ${m}`)

mkdirSync(dataDir, { recursive: true })

function pidAlive(pid) {
  if (!pid) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** 已有守护在跑就不再起第二个 */
function existingSupervisor() {
  try {
    const pid = Number(readFileSync(supPidFile, 'utf8').trim())
    if (pid && pid !== process.pid && pidAlive(pid)) return pid
  } catch {}
  return null
}

function portAlive() {
  return new Promise((resolve) => {
    const req = fetch(`http://127.0.0.1:${PORT}/`, { signal: AbortSignal.timeout(1500) })
    req.then((r) => resolve(r.ok)).catch(() => resolve(false))
  })
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  // 1) 已有守护在跑 → 直接退出（计划任务每 2 分钟巡检会走到这里）
  const running = existingSupervisor()
  if (running) {
    log(`已有守护进程在运行（PID ${running}），本次退出`)
    return
  }

  // 2) 被计划任务直接拉起（有控制台黑框）→ 隐藏窗口重生自己，再关掉这个黑框
  if (!DETACHED && process.platform === 'win32') {
    const fd = openSync(logFile, 'a')
    const child = spawn(process.execPath, [self], {
      cwd: root,
      detached: true,
      windowsHide: true,
      stdio: ['ignore', fd, fd],
      env: { ...process.env, XC_SUPERVISOR_DETACHED: '1' },
    })
    child.unref()
    return
  }

  // 3) 真正常驻：记 PID、盯住 stable-server
  writeFileSync(supPidFile, String(process.pid), 'utf8')

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
