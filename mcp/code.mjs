/**
 * 卡片码 / 路线码：从已有的 id 派生 5 位大写码。
 *
 * 网页（src/lib/code.ts 直接引用这一份）和 MCP 共用同一算法，避免两边算出不同的码。
 *
 * 为什么派生而不是新存一个字段：
 * - id 不变，码就不变——改名、移动、换父级、导出再导入，码都跟着卡片走
 * - 不给数据加字段，就没有旧数据兼容问题（lwk 那份 1.8MB 的真实数据直接能用）
 * - 复制/粘贴出来的卡是新 id → 新码，语义上也对：新卡不是原卡
 *
 * 展示成 `#9NVDA`；解析时前面的 #、全角＃、大小写、空格都容忍。
 */

export const CODE_LEN = 5

/** `an-xxxx` / `bd-xxxx` 的前缀去掉，只留随机部分 */
const stripPrefix = (id) => String(id ?? '').replace(/^[a-z]{2}-/i, '')
const alnum = (s) => String(s ?? '').replace(/[^0-9a-z]/gi, '')

/** 随机部分不够 5 位时（老数据可能有），退化成稳定哈希，保证同 id 同码 */
function hash36(input) {
  let h = 2166136261
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0).toString(36).toUpperCase()
}

/** id → 码（5 位大写 base36）。纯函数，同一个 id 永远同一个码。 */
export function codeOf(id) {
  const body = alnum(stripPrefix(id))
  if (body.length >= CODE_LEN) return body.slice(-CODE_LEN).toUpperCase()
  return hash36(String(id ?? '')).padStart(CODE_LEN, '0').slice(-CODE_LEN)
}

/** 用户/Agent 传进来的一串 → 规范化的码（去掉 #、全角＃、空格，转大写） */
export function normCode(input) {
  return alnum(String(input ?? '').replace(/^[#＃\s]+/, '').trim()).toUpperCase()
}

/** 看起来像不像一个码（5 位字母数字）。像也未必存在，解析时仍要回退到按标题找 */
export function looksLikeCode(input) {
  return normCode(input).length === CODE_LEN
}
