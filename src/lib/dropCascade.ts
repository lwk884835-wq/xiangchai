import type { ActionBoard, ActionNode } from '@/types'

/**
 * 「不太合适」的灰色卡片是**推导出来的**，不是记死在卡片上的状态。
 *
 * 唯一记在卡片上的是红卡（dropRoot：明确标了「这个任务不太合适」）。
 * 红卡再带灰两类卡：
 * - 它下面还没做完的子任务（已经勾完的保持绿色，也不再往下钻）
 * - 同一串里排在它后面的步骤（连同各自没做完的子任务）
 *
 * 这样做的好处：卡片被挪到别的链上（红卡已经不在它前面/上面）时，
 * 灰卡会自动恢复白色，不会留下「已经被移走了还灰着」的死灰。
 * 以前 dropped 是标记那一刻算好、写进每张卡的，移动/粘贴把标记一起搬走，就灰住了。
 *
 * 改这里的规则 = 改「不太合适」的语义，UI（NodeCard / RouteBoard）不用动。
 */

/** 一张红卡会带灰哪些卡（含红卡自己） */
export function cascadeOf(nodes: ActionNode[], rootId: string): Set<string> {
  const out = new Set<string>()
  const root = nodes.find((n) => n.id === rootId)
  if (!root) return out
  out.add(root.id)
  const addUnfinishedKids = (pid: string) => {
    for (const n of nodes) {
      if (n.parentId !== pid || n.done || out.has(n.id)) continue
      out.add(n.id)
      addUnfinishedKids(n.id)
    }
  }
  addUnfinishedKids(root.id)
  const mates = nodes.filter(
    (n) => n.parentId === root.parentId && (n.branch || '') === (root.branch || ''),
  )
  const at = mates.findIndex((n) => n.id === root.id)
  for (const f of at >= 0 ? mates.slice(at + 1) : []) {
    if (out.has(f.id)) continue
    out.add(f.id)
    addUnfinishedKids(f.id)
  }
  return out
}

/** 哪些红卡把某张卡带灰了（点灰卡的「取消标记」时用） */
export function dropRootsOf(nodes: ActionNode[], id: string): ActionNode[] {
  const roots = nodes.filter((n) => n.dropRoot === true)
  if (!roots.length) return []
  const self = nodes.find((n) => n.id === id)
  if (self?.dropRoot) return [self]
  return roots.filter((r) => cascadeOf(nodes, r.id).has(id))
}

/**
 * 按红卡把整条路线的灰色重算一遍：
 * - 红卡自己永远是红
 * - 能被某张红卡带到的节点 = 灰
 * - 其它地方一律恢复白色（这就是「没有红卡了 → 自动变回白」）
 *
 * 没变化时返回原数组（节点对象也不换），避免无谓的重渲染。
 */
export function deriveDropFlags(nodes: ActionNode[]): ActionNode[] {
  let changed = false
  const grey = new Set<string>()
  for (const r of nodes) {
    if (r.dropRoot !== true) continue
    for (const id of cascadeOf(nodes, r.id)) grey.add(id)
  }
  const next = nodes.map((n) => {
    if (n.dropRoot === true) {
      if (n.dropped === true) return n
      changed = true
      return { ...n, dropped: true }
    }
    if (grey.has(n.id)) {
      if (n.dropped === true) return n
      changed = true
      return { ...n, dropped: true }
    }
    if (n.dropped === true) {
      changed = true
      return { ...n, dropped: false }
    }
    return n
  })
  return changed ? next : nodes
}

/** 单条路线版：没有红卡/没变化时原样返回，方便直接塞进 patchBoard */
export function normalizeBoardDrops(board: ActionBoard): ActionBoard {
  const nodes = deriveDropFlags(board.nodes)
  return nodes === board.nodes ? board : { ...board, nodes }
}

/** 多条路线版（外部数据进 store 时用） */
export function normalizeBoardsDrops(boards: ActionBoard[]): ActionBoard[] {
  let changed = false
  const next = boards.map((b) => {
    const n = normalizeBoardDrops(b)
    if (n !== b) changed = true
    return n
  })
  return changed ? next : boards
}
