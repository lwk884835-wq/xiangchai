#!/usr/bin/env node
/**
 * 打一个「稳定版」release。
 *
 * 关键点：**从 git 提交里构建，不用当前工作区**。
 * 工作区随时可能有正在改的代码（HMR/未提交），稳定版必须是「已经验证过的那个提交」，
 * 否则你天天用的版本会跟着开发进度一起抖。
 *
 * 用法：
 *   npm run release:stable              # 用当前 HEAD
 *   npm run release:stable -- <git-ref> # 指定某个提交/标签（回滚或补发旧版）
 *
 * 产物：releases/<时间>-<sha>/，并把 releases/current 指过去（稳定版服务读这个）。
 * 只保留最近 6 个版本。
 *
 * 跨平台：macOS/Linux 用 `git archive | tar` + 目录软链；
 *         Windows 用 `git worktree` 导出提交 + junction（不需要管理员权限）。
 */
import { execSync, execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import path from 'node:path'

/**
 * 递归复制目录。
 * 不用 fs.cpSync：某些 Windows 环境（沙箱/安全软件）下它会静默失败——
 * 返回成功但目标目录根本没建出来。手写版逐文件 copy，稳定。
 */
function copyDir(src, dest) {
  mkdirSync(dest, { recursive: true })
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name)
    const to = path.join(dest, entry.name)
    if (entry.isDirectory()) copyDir(from, to)
    else if (entry.isSymbolicLink()) continue
    else copyFileSync(from, to)
  }
}

const isWin = process.platform === 'win32'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const releasesDir = path.join(root, 'releases')
const ref = process.argv[2] ?? 'HEAD'

const sha = execSync(`git rev-parse --short ${ref}`, { cwd: root }).toString().trim()
const subject = execSync(`git log -1 --format=%s ${ref}`, { cwd: root }).toString().trim()
const now = new Date()
const pad = (n) => String(n).padStart(2, '0')
const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`
const name = `${stamp}-${sha}`
const target = path.join(releasesDir, name)

console.log(`[release] 从 ${ref} (${sha}) 构建：${subject}`)
const tmp = mkdtempSync(path.join(tmpdir(), 'work-route-release-'))
try {
  if (isWin) {
    // Windows：用 worktree 从提交导出源码（不读工作区），避免依赖 bash/tar
    execFileSync('git', ['worktree', 'add', '--detach', '--force', tmp, ref], { cwd: root, stdio: 'ignore' })
  } else {
    execSync(`git archive ${ref} | tar -x -C ${JSON.stringify(tmp)}`, { cwd: root, shell: '/bin/bash' })
  }
  // 复用工作区的 node_modules（不在 git 里，但构建需要）
  symlinkSync(path.join(root, 'node_modules'), path.join(tmp, 'node_modules'), isWin ? 'junction' : 'dir')
  execSync('npm run build', { cwd: tmp, stdio: 'inherit' })

  mkdirSync(releasesDir, { recursive: true })
  rmSync(target, { recursive: true, force: true })
  copyDir(path.join(tmp, 'dist'), target)
} finally {
  if (isWin) {
    try {
      execFileSync('git', ['worktree', 'remove', '--force', tmp], { cwd: root, stdio: 'ignore' })
    } catch {
      /* worktree 元数据清不掉也不影响发布 */
    }
  }
  rmSync(tmp, { recursive: true, force: true })
}

// current 指向最新版
const current = path.join(releasesDir, 'current')
try {
  // symlink（macOS）/ junction（Windows）都能被 rmSync 只删链接、不动目标
  rmSync(current, { recursive: true, force: true })
} catch {}
symlinkSync(target, current, isWin ? 'junction' : 'dir')

// 只留最近 6 个
const versions = readdirSync(releasesDir)
  .filter((n) => n !== 'current' && /^\d{8}-\d{4}-/.test(n))
  .sort()
while (versions.length > 6) {
  rmSync(path.join(releasesDir, versions.shift()), { recursive: true, force: true })
}

console.log(`[release] 完成：${name}`)
console.log(`[release] 稳定版：http://127.0.0.1:5180/`)
console.log(`[release] 回滚：npm run release:stable -- <旧提交>`)
