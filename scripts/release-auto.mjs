#!/usr/bin/env node
/**
 * 自动发布稳定版（5180）并重启服务 + 健康检查。
 *
 * 用法：npm run release:auto         # 从 git HEAD 发布
 *       npm run release:auto -- <ref> # 回滚/补发某个提交
 *
 * 做的事：
 *   1. 备份 data/routes-stable.json（如果存在）
 *   2. 跑 scripts/release.mjs（只从 git 提交构建，不读工作区）
 *   3. 重启稳定版服务
 *        macOS：launchctl kickstart（launchd 常驻）
 *        Windows：读 data/stable-server.pid 结束旧进程，由开机自启的守护脚本拉起；
 *                 守护脚本没在跑时，这里直接拉起一个脱离的进程兜底
 *   4. 轮询 5180 页面和 /api/routes，确认真的活着
 *
 * 失败会以非 0 退出；不会改动 releases/ 里已有的历史版本（release.mjs 管保留 6 个）。
 */
import { execFileSync, execSync, spawn } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, openSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const isWin = process.platform === 'win32'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ref = process.argv[2] ?? 'HEAD'
const LABEL = 'com.lwk.work-route-stable'
const PORT = 5180
const log = (msg) => console.log(`[release:auto] ${msg}`)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const stableLog = isWin ? path.join(root, 'data', 'stable-server.log') : '/tmp/work-route-stable.log'

// 0) 工作区有未提交改动时提示（发布会用 HEAD，不会带上它们）
const dirty = execSync('git status --porcelain', { cwd: root }).toString().trim()
if (dirty) log(`注意：工作区有未提交改动，本次只发布 HEAD（${dirty.split('\n').length} 个文件）`)

// 1) 备份稳定版数据文件
const stableData = path.join(root, 'data', 'routes-stable.json')
if (existsSync(stableData)) {
  const dir = path.join(root, 'data', 'backups')
  mkdirSync(dir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const bak = path.join(dir, `routes-stable-${stamp}.json`)
  copyFileSync(stableData, bak)
  log(`已备份稳定版数据 → ${path.relative(root, bak)}`)
}

// 2) 从提交构建并发布
log(`开始发布 ${ref}`)
execFileSync(process.execPath, [path.join(root, 'scripts', 'release.mjs'), ref], {
  cwd: root,
  stdio: 'inherit',
})
const sha = execSync(`git rev-parse --short ${ref}`, { cwd: root }).toString().trim()
log(`release 完成：${sha}`)

/* ---------- 3) 重启稳定版服务 ---------- */

async function portAlive() {
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/`, { signal: AbortSignal.timeout(1500) })
    return res.ok
  } catch {
    return false
  }
}

async function restartMac() {
  execFileSync('launchctl', ['kickstart', '-k', `gui/${process.getuid()}/${LABEL}`], {
    stdio: 'inherit',
  })
  log('已通过 launchd 重启稳定版服务')
}

/** Windows：杀掉旧进程，等守护脚本拉起；守护没在跑就自己拉起一个脱离进程 */
async function restartWindows() {
  const pidFile = path.join(root, 'data', 'stable-server.pid')
  const wasAlive = await portAlive()

  if (wasAlive && existsSync(pidFile)) {
    const pid = Number(readFileSync(pidFile, 'utf8').trim())
    if (pid > 0) {
      try {
        process.kill(pid)
        log(`已结束旧服务进程 PID ${pid}`)
      } catch (err) {
        log(`结束旧进程失败（可能已退出）：${err.message}`)
      }
    }
  }

  // 等端口释放 / 等守护脚本把新进程拉起来
  for (let i = 0; i < 20; i++) {
    await sleep(300)
    if (!(await portAlive())) break
  }
  // 守护脚本（scripts/win/stable-supervisor.vbs）会在这期间自动重启新进程
  for (let i = 0; i < 20; i++) {
    await sleep(500)
    if (await portAlive()) {
      log('守护脚本已拉起新服务')
      return
    }
  }

  // 兜底：没有守护脚本在跑，自己拉一个脱离进程（开机自启装好之后不会走到这）
  log('没等到守护脚本，直接拉起稳定版进程')
  mkdirSync(path.join(root, 'data'), { recursive: true })
  const fd = openSync(stableLog, 'a')
  const child = spawn(process.execPath, [path.join(root, 'scripts', 'stable-server.mjs')], {
    cwd: root,
    detached: true,
    stdio: ['ignore', fd, fd],
    env: process.env,
    windowsHide: true,
  })
  child.unref()
  log(`已拉起稳定版进程 PID ${child.pid}`)
}

try {
  if (isWin) await restartWindows()
  else await restartMac()
} catch (err) {
  log(`重启服务失败：${err.message ?? err}`)
  process.exitCode = 1
}

// 4) 健康检查
let pageOk = false
let apiOk = false
for (let i = 0; i < 30; i++) {
  await sleep(500)
  try {
    const page = await fetch(`http://127.0.0.1:${PORT}/`, { signal: AbortSignal.timeout(2000) })
    pageOk = page.ok
  } catch {
    pageOk = false
  }
  try {
    const api = await fetch(`http://127.0.0.1:${PORT}/api/routes`, { signal: AbortSignal.timeout(2000) })
    apiOk = api.ok
  } catch {
    apiOk = false
  }
  if (pageOk && apiOk) break
}
const current = realpathSync(path.join(root, 'releases', 'current'))
log(`5180 page=${pageOk ? 'OK' : 'FAIL'} api=${apiOk ? 'OK' : 'FAIL'} current=${path.relative(root, current)}`)
if (!pageOk || !apiOk) {
  log(`健康检查失败，请查看 ${stableLog}`)
  process.exitCode = 1
} else {
  log('稳定版已更新（lwk 刷新 http://127.0.0.1:5180 即可）')
}
