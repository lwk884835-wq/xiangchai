/**
 * 深链：把「某条路线 / 某张卡」编成一个能贴到别处的网址。
 *
 * 场景是 lwk 的：他在 EI 里存「将来也许会做」的事，想让路线留在想拆里，
 * 在 Obsidian 记一笔 `[任务名](链接)`，点开就跳回浏览器里那张卡。
 *
 * 形如：`http://127.0.0.1:5180/?route=bd-abc123&node=an-xyz789`
 * 也认码：`?c=J12CS`（路线）/ `?c=BCU5C`（卡片），由调用方用 codeIndex 解析。
 *
 * 为什么用 id 不用码：id 全局唯一；码是 id 的末 5 位，跨路线偶发撞码。
 * 码只在手写链接时用，复制出来的链接一律带 id。
 */

import { copyText, normCode } from '@/lib/code'

export const ROUTE_PARAM = 'route'
export const NODE_PARAM = 'node'
export const CODE_PARAM = 'c'

export interface DeepLinkTarget {
  boardId: string
  /** 不传 = 只跳路线；传了 = 跳过去并打开这张卡的抽屉 */
  nodeId?: string | null
}

/**
 * 当前环境的地址前缀：稳定版 5180 / 开发版 5174 各生成各的。
 * 复制的时候在哪个环境，链接就指哪个环境——这是唯一不会指错的做法。
 */
function siteBase(): string {
  if (typeof window === 'undefined') return ''
  return `${window.location.origin}${window.location.pathname}`
}

export function buildDeepLink(target: DeepLinkTarget): string {
  const q = new URLSearchParams()
  q.set(ROUTE_PARAM, target.boardId)
  if (target.nodeId) q.set(NODE_PARAM, target.nodeId)
  return `${siteBase()}?${q.toString()}`
}

/**
 * 实际进剪贴板的那种：Markdown 链接。
 * 粘进 Obsidian 显示的是任务名（不是一长串网址），点开是浏览器里那张卡。
 * 标题里的方括号会提前掐断链接语法，必须转义。
 */
export function noteLink(title: string, url: string): string {
  const text = (title || '未命名').replace(/([[\]])/g, '\\$1')
  return `[${text}](${url})`
}

/** 复制「笔记链接」进剪贴板。false = 浏览器不给剪贴板权限 */
export async function copyNoteLink(title: string, target: DeepLinkTarget): Promise<boolean> {
  return copyText(noteLink(title, buildDeepLink(target)))
}

export interface DeepLinkQuery {
  route: string | null
  node: string | null
  /** 已经规范化过（去掉 #、转大写）；没有就是 null */
  code: string | null
}

export function readDeepLink(
  search: string = typeof window === 'undefined' ? '' : window.location.search,
): DeepLinkQuery {
  const q = new URLSearchParams(search)
  const pick = (key: string) => {
    const v = (q.get(key) ?? '').trim()
    return v || null
  }
  const rawCode = pick(CODE_PARAM)
  return {
    route: pick(ROUTE_PARAM),
    node: pick(NODE_PARAM),
    code: rawCode ? normCode(rawCode) || null : null,
  }
}

/**
 * 用完就把参数从地址栏抹掉（replaceState，不新增历史记录）。
 * 不然他中途自己切了路线，一刷新又被拽回链接里那张卡，看着像页面坏了。
 */
export function clearDeepLink(): void {
  if (typeof window === 'undefined') return
  const { search, pathname, hash } = window.location
  if (!search) return
  window.history.replaceState(null, '', `${pathname}${hash}`)
}
