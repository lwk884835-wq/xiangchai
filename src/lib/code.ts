/**
 * 卡片码 / 路线码：算法正本在 `mcp/code.mjs`，MCP 和网页共用同一份——
 * 两边各写一份迟早会算出不同的码，这个入口只是给 TS 侧用的类型出口。
 */
export { CODE_LEN, codeOf, normCode, looksLikeCode } from '../../mcp/code.mjs'

/** 复制文本到剪贴板；失败返回 false（localhost 是安全上下文，正常不会失败） */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    try {
      const el = document.createElement('textarea')
      el.value = text
      el.style.position = 'fixed'
      el.style.opacity = '0'
      document.body.appendChild(el)
      el.select()
      const ok = document.execCommand('copy')
      el.remove()
      return ok
    } catch {
      return false
    }
  }
}
