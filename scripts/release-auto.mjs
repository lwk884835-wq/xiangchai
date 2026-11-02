#!/usr/bin/env node
/**
 * 自动发布稳定版（5180）并重启服务 + 健康检查。
 *
 * lwk 的口径（26.11.2）：5180 以后由 Agent 改完自动更新，不等人。
 * 用法：npm run release:auto         # 从 git HEAD 发布
 *       npm run release:auto -- <ref> # 回滚/补发某个提交
 *
 * 做的事：
 *   1. 备份 data/routes-stable.json（如果存在）
 *   2. 跑 scripts/release.mjs（只从 git 提交构建，不读工作区）
 *   3. launchctl 重启稳定版服务（加载最新的 stable-server.mjs）
 *   4. 轮询 5180 页面和 /api/routes，确认真的活着
 *
 * 失败会以非 0 退出；不会改动 releases/ 里已有的历史版本（release.mjs 管保留 6 个）。
 */
import { execFileSync, execSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ref = process.argv[2] ?? 'HEAD'
const LABEL = 'com.lwk.work-route-stable'
const PORT = 5180
const log = (msg) => console.log(`[release:auto] ${msg}`)

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

// 3) 重启稳定版服务（launchd）
try {
  execFileSync('launchctl', ['kickstart', '-k', `gui/${process.getuid()}/${LABEL}`], { stdio: 'inherit' })
  log('已重启稳定版服务')
} catch (err) {
  log(`重启服务失败：${err.message ?? err}`)
  process.exitCode = 1
}

// 4) 健康检查
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let pageOk = false
let apiOk = false
for (let i = 0; i < 30; i++) {
  await sleep(500)
  try {
    const page = await fetch(`http://127.0.0.1:${PORT}/`)
    pageOk = page.ok
  } catch {
    pageOk = false
  }
  try {
    const api = await fetch(`http://127.0.0.1:${PORT}/api/routes`)
    apiOk = api.ok
  } catch {
    apiOk = false
  }
  if (pageOk && apiOk) break
}
const current = realpathSync(path.join(root, 'releases', 'current'))
log(`5180 page=${pageOk ? 'OK' : 'FAIL'} api=${apiOk ? 'OK' : 'FAIL'} current=${path.relative(root, current)}`)
if (!pageOk || !apiOk) {
  log('健康检查失败，请查看 /tmp/work-route-stable.log')
  process.exitCode = 1
} else {
  log('稳定版已更新（lwk 刷新 http://127.0.0.1:5180 即可）')
}
