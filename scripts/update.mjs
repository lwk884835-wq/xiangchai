#!/usr/bin/env node
/**
 * 自助更新执行器：由 5180 页面上的「有新版本」按钮触发，跑在脱离服务的独立进程里。
 *
 * 为什么要独立进程：
 *   更新可能要重启 5180（服务端代码变了）。若在执行更新的是 5180 自己，重启会把自己杀掉。
 *   独立进程被 launchd / init 接管，服务怎么重启都不影响它把流程走完。
 *
 * 流程：
 *   1. 有未提交改动就停下（保护本机工作，data/ 被 gitignore 不算）
 *   2. git pull --ff-only（不产生 merge commit，分叉就明确报错）
 *   3. 看服务端代码有没有变：变了走 release:auto（含重启），没变只切 current（刷新即可）
 *   4. 全程把状态写进 data/update-state.json，前端读它显示进度 / 报错
 */
import { execFileSync, execSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const stateFile = path.join(root, 'data', 'update-state.json')
const log = (m) => console.log(`[update] ${m}`)

function state(phase, message, extra = {}) {
  try {
    mkdirSync(path.dirname(stateFile), { recursive: true })
    writeFileSync(
      stateFile,
      JSON.stringify({ phase, message, at: Date.now(), ...extra }, null, 2),
      'utf8',
    )
  } catch (e) {
    log(`写状态失败：${e.message}`)
  }
}

function run(cmd, args) {
  log(`$ ${cmd} ${args.join(' ')}`)
  execFileSync(cmd, args, { cwd: root, stdio: 'inherit' })
}

try {
  state('running', '检查本机改动')

  const dirty = execSync('git status --porcelain', { cwd: root, encoding: 'utf8' }).trim()
  if (dirty) {
    const files = dirty.split('\n').slice(0, 5).join('、')
    state('error', `本机有未提交改动，已暂停更新。请先提交或撤销再试：${files}`)
    log(`工作区不干净：${dirty}`)
    process.exit(1)
  }

  const before = execSync('git rev-parse HEAD', { cwd: root, encoding: 'utf8' }).trim()

  state('running', '拉取远端代码')
  run('git', ['fetch', 'origin', 'main'])
  run('git', ['pull', '--ff-only', 'origin', 'main'])

  const after = execSync('git rev-parse HEAD', { cwd: root, encoding: 'utf8' }).trim()
  log(`${before.slice(0, 7)} → ${after.slice(0, 7)}`)

  if (before === after) {
    state('done', '已经是最新版本', { from: before.slice(0, 7), to: after.slice(0, 7) })
    log('没有新提交')
    process.exit(0)
  }

  // 服务端代码 / 更新脚本本身变了才需要重启；只改前端的话切 current 就够。
  state('running', '检查服务端代码是否变化')
  let serverChanged = false
  try {
    execFileSync(
      'git',
      ['diff', `${before}..${after}`, '--quiet', '--', 'scripts/'],
      { cwd: root, stdio: 'ignore' },
    )
  } catch (e) {
    serverChanged = e.status === 1 // 1 = 有差异；其它是出错，按「没变」保守处理
  }

  if (serverChanged) {
    state('running', '服务端代码有变化，正在重启服务')
    run(process.execPath, ['scripts/release-auto.mjs'], [])
  } else {
    state('running', '构建新版本')
    run(process.execPath, ['scripts/release.mjs'], [after])
  }

  state('done', '更新完成', { from: before.slice(0, 7), to: after.slice(0, 7) })
  log('更新完成')
} catch (err) {
  const raw = err.stderr?.toString?.() || err.stdout?.toString?.() || err.message || String(err)
  state('error', `更新失败：${raw.trim().slice(0, 280)}`)
  log(`error: ${raw}`)
  process.exit(1)
}
