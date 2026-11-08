/**
 * 全库的「码 → 目标」索引：搜索框里直接输码就能跳到那张卡 / 那条路线。
 *
 * 码是 id 派生的（算法正本 mcp/code.mjs），所以这里只做反查，不存任何东西。
 * 一个码理论上可能同时对上路线和卡片（5 位 base36 碰撞），findCodeHits 会把
 * 未归档的、卡片的排在前面——按码找卡片比找路线常见。
 */
import type { ActionBoard } from '@/types'
import { CODE_LEN, codeOf, normCode } from '@/lib/code'

export type CodeHit =
  | { kind: 'route'; code: string; boardId: string; title: string; archived: boolean }
  | {
      kind: 'node'
      code: string
      boardId: string
      nodeId: string
      title: string
      archived: boolean
      /** 链接锚点：路线图上不单独画它（画的是投影出来的那棵树），跳不过去 */
      anchor: boolean
    }

/** 建索引。路线和卡片都算，归档的也收进来（能跳，只是提示一下）。 */
export function buildCodeIndex(boards: ActionBoard[]): Map<string, CodeHit[]> {
  const index = new Map<string, CodeHit[]>()
  const push = (code: string, hit: CodeHit) => {
    const list = index.get(code)
    if (list) list.push(hit)
    else index.set(code, [hit])
  }
  for (const b of boards) {
    const archived = b.archived === true
    push(codeOf(b.id), {
      kind: 'route',
      code: codeOf(b.id),
      boardId: b.id,
      title: b.jobTitle?.trim() || '未命名路线',
      archived,
    })
    for (const n of b.nodes) {
      const code = codeOf(n.id)
      push(code, {
        kind: 'node',
        code,
        boardId: b.id,
        nodeId: n.id,
        title: n.title?.trim() || '未命名卡片',
        archived,
        anchor: !!n.linkBoardId,
      })
    }
  }
  return index
}

/** 搜索框里的一串 → 命中的目标（空格、全角＃、大小写都容忍；不是 5 位码就是空） */
export function findCodeHits(index: Map<string, CodeHit[]>, raw: string): CodeHit[] {
  const text = String(raw ?? '')
  let code = normCode(text)
  if (code.length !== CODE_LEN) {
    // 从别处整句粘贴过来的（「#BCU5C 某张卡」「已跳到 #BCU5C 下面」）：挑出 # 后面那个码
    const m = text.match(/[#＃]\s*([0-9a-z]{5})(?![0-9a-z])/i)
    if (!m) return []
    code = m[1].toUpperCase()
  }
  const hits = index.get(code)
  if (!hits?.length) return []
  if (hits.length < 2) return hits
  return [...hits].sort(
    (a, b) =>
      Number(a.archived) - Number(b.archived) ||
      Number(a.kind === 'route') - Number(b.kind === 'route'),
  )
}
