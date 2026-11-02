import { Fragment, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { CheckCheck, ChevronRight, ClipboardPaste, Copy, ListChecks, Plus, Trash2 } from 'lucide-react'
import type { ActionNode } from '@/types'
import { childrenOf, useActions } from '@/store/actions'
import { useUi } from '@/store/ui'
import { NodeCard } from './NodeCard'
import { EmptyState } from '@/components/EmptyState'

/**
 * 全局行动路线：从左到右的一条流程
 *
 * 两套连线符号，都用 SVG 画、位置按真实布局算（卡片高度不一，估算一定会错位）：
 * - **带线箭头**：所有跨卡片连接都用它——父卡分叉到子任务、子链收尾接下一个目标、
 *   两个目标之间。统一是「横出 → 竖直 → 横进尖角」的直角肘形，只有一种形状
 * - **小 V**：同一串里相邻的两个小任务之间（两张卡紧挨着，不用再画线）
 *
 * 折叠：父卡片上的按钮把它的**整条子链**收起来，父卡保留（代表这一段），
 * 卡片上显示「N 个子任务」，它和下一个同级之间改用小 V 连过去。
 */

/**
 * 三档线色，把「骨架」和「指向」分开：
 * 主干最淡（只交代归属，不该抢视线）、分叉中等、尖角最深（真正指方向的那个）
 */
const TRUNK = '#ddd5fb'
const CURVE = '#b9aef5'
const TIP = '#7c6cf0'

/** 一段线：trunk 竖主干、branch 分叉/曲线、tip 尖角 */
type Seg = { d: string; tone: 'trunk' | 'branch' | 'tip' }

/** 尖角深度和半高：深 9、开口 10，全站统一 */
const TIP_DEPTH = 9
const TIP_HALF = 5

/**
 * 主干竖线离父卡右边缘多远。
 * 父→子的空隙是 pl-10（40px），和根目标之间的 w-[40px] 一致；
 * 竖线靠左 12px，尖角在这整段 40px 里居中（不是从竖线开始算）。
 */
const TRUNK_INSET = 8

/**
 * 尖角：开口朝左、尖朝右。
 * 传进来的 tipX 是尖的坐标，整枚尖角占 [tipX - 9, tipX]。
 */
function chevron(tipX: number, y: number): string {
  return `M${tipX - TIP_DEPTH},${y - TIP_HALF} L${tipX},${y} L${tipX - TIP_DEPTH},${y + TIP_HALF}`
}

/**
 * 把尖角摆在 (x1, x2) 这段空隙的正中间，返回尖的坐标。
 *
 * 以前尖角一律贴着卡片左边缘画（x2 - 3），于是空隙全堆在左边、
 * 尖角紧贴右边，看着像被推过去了一样。居中之后左边和右边才一样宽。
 */
function centeredTip(x1: number, x2: number): number {
  const center = (x1 + x2) / 2
  return center + TIP_DEPTH / 2
}

/** V 型箭头：同级之间专用，只画一个开口 V，不带任何线 */
const V_DEPTH = 8
const V_HALF = 5
function vArrow(tipX: number, y: number): string {
  return `M${tipX - V_DEPTH},${y - V_HALF} L${tipX},${y} L${tipX - V_DEPTH},${y + V_HALF}`
}

/**
 * 带线箭头：跨层级专用（父→子、链尾→下一个目标）。
 *
 * 规则只有一条：**线必须看得见**。以前同行的时候只画了 12px 出线 + 3.5px 接尖角，
 * 短到像断线，跟同级的 V 混在一起分不出来。现在：
 * - 同一行：一条直线从父卡右边缘一路画到尖角开口，长度占满整个卡片间隙
 * - 不同行：横出 → 竖主干 → 横进尖角，竖主干本身就能看出是跨层
 *
 * 尖角居中于整段卡片空隙（x1 是左边那张卡的右边缘），不是居中于主线到卡片那段。
 */
function elbow(x1: number, y1: number, x2: number, y2: number, outX: number): Seg[] {
  const tipX = centeredTip(x1, x2)
  // 同一行：一条完整直线，别缩进、别断
  if (Math.abs(y2 - y1) <= 1) {
    return [{ d: `M${x1},${y1} L${tipX - TIP_DEPTH},${y2}`, tone: 'branch' }]
  }
  // 不同行：横出 → 竖主干 → 横进尖角
  const segs: Seg[] = [{ d: `M${x1},${y1} L${outX},${y1}`, tone: 'branch' }]
  segs.push({ d: `M${outX},${y1} L${outX},${y2}`, tone: 'trunk' })
  if (tipX - TIP_DEPTH > outX) {
    segs.push({ d: `M${outX},${y2} L${tipX - TIP_DEPTH},${y2}`, tone: 'branch' })
  }
  return segs
}


/** 拖拽回调：卡片和它下面的所有 Column 共用一份 */
interface CtxMenu {
  nodeId?: string
  x: number
  y: number
}

interface Dnd {
  dragId: string | null
  dropId: string | null
  onDragStart: (id: string, e: React.DragEvent) => void
  onDragEnd: () => void
  onDragOver: (id: string, e: React.DragEvent) => void
  onDragLeave: (id: string, e: React.DragEvent) => void
  onDrop: (id: string, e: React.DragEvent) => void
}

function Column({
  node,
  nodes,
  collapsed,
  onOpen,
  onToggle,
  onPin,
  onToggleCollapse,
  dnd,
  onCardContextMenu,
}: {
  node: ActionNode
  nodes: ActionNode[]
  collapsed: string[]
  onOpen: (id: string) => void
  onToggle: (id: string) => void
  onPin: (id: string, pinned: boolean) => void
  onToggleCollapse: (id: string) => void
  dnd: Dnd
  onCardContextMenu: (id: string, e: React.MouseEvent) => void
}) {
  const kids = useMemo(() => childrenOf(nodes, node.id), [nodes, node.id])
  const isCollapsed = collapsed.includes(node.id)
  const visible = isCollapsed ? [] : kids

  // 推进状态：自己完成 = 搞定；子任务有部分完成 = 进行中；否则还没开始
  const progress = node.done
    ? 'done'
    : kids.some((k) => k.done)
      ? 'doing'
      : 'todo'

  // 按 branch 分组：不同 branch = 不同路线（竖着堆叠），同 branch = 一串动作（横着排）
  const groups = useMemo(() => {
    const map = new Map<string, ActionNode[]>()
    for (const k of visible) {
      const key = k.branch || ''
      map.set(key, [...(map.get(key) ?? []), k])
    }
    return [...map.values()]
  }, [visible])

  return (
    <div className="flex shrink-0 items-start">
      <NodeCard
        node={node}
        onOpen={onOpen}
        onToggle={onToggle}
        onPin={onPin}
        childCount={kids.length}
        collapsed={isCollapsed}
        progress={progress}
        onToggleCollapse={() => onToggleCollapse(node.id)}
        draggable
        dragging={dnd.dragId === node.id}
        dropTarget={dnd.dropId === node.id}
        onDragStart={dnd.onDragStart}
        onDragEnd={dnd.onDragEnd}
        onDragOver={dnd.onDragOver}
        onDragLeave={dnd.onDragLeave}
        onDrop={dnd.onDrop}
        onContextMenu={onCardContextMenu}
      />
      {visible.length > 0 && (
        // 中屏把层间距收一收，同样的窗口能多看到一层；超宽屏再放开
        <div className="flex shrink-0 flex-col gap-5 pl-10 2xl:gap-8">
          {groups.map((group, gi) => {
            /*
              只有主线那一行参与宽度计算，其它支线行宽度记 0、内容往下溢。

              不然一条支线横向伸出多远，整棵子树就被撑多宽，后面那个同级目标
              会被顶出去几百像素——可它跟支线在纵向根本碰不到，纯粹是被挤开的。
              支线自己在下面溢出去，既不影响主线的长度，也不会压到谁身上。
            */
            const mainIdx = Math.max(
              0,
              groups.findIndex((g) => (g[0]?.branch || '') === '主线'),
            )
            const spill = gi !== mainIdx
            return (
              <div
                key={group[0]?.id ?? 'g'}
                className={spill ? 'flex w-0 items-start' : 'flex items-start'}
              >
                {group.map((kid, i) => (
                  <Fragment key={kid.id}>
                    {i > 0 && <span className="w-[18px] shrink-0" />}
                    <Column
                      node={kid}
                      nodes={nodes}
                      collapsed={collapsed}
                      onOpen={onOpen}
                      onToggle={onToggle}
                      onPin={onPin}
                      onToggleCollapse={onToggleCollapse}
                      dnd={dnd}
                      onCardContextMenu={onCardContextMenu}
                    />
                  </Fragment>
                ))}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export const RouteBoard = memo(function RouteBoard({
  nodes,
  collapsed,
  onOpen,
  onToggle,
  onPin,
  onToggleCollapse,
  onAddGoal,
}: {
  nodes: ActionNode[]
  collapsed: string[]
  onOpen: (id: string) => void
  onToggle: (id: string) => void
  onPin: (id: string, pinned: boolean) => void
  onToggleCollapse: (id: string) => void
  /** 空路线时给一个「加第一个目标」的入口 */
  onAddGoal?: () => void
}) {
  const moveSubtree = useActions((s) => s.moveSubtree)
  const copyNodes = useActions((s) => s.copyNodes)
  const pasteNodes = useActions((s) => s.pasteNodes)
  const deleteNode = useActions((s) => s.deleteNode)
  const clearDoneChildren = useActions((s) => s.clearDoneChildren)
  const clipboard = useActions((s) => s.clipboard)
  const toast = useUi((s) => s.showToast)
  /** 右键菜单：nodeId 为空 = 点在空白画布上 */
  const [ctxMenu, setCtxMenu] = useState<CtxMenu | null>(null)
  /** 键盘复制/粘贴时，光标停在哪个卡片上 */
  const hoveredRef = useRef<string | null>(null)

  const openCtxMenu = (nodeId: string | undefined, e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setCtxMenu({ nodeId, x: e.clientX, y: e.clientY })
  }

  const doCopy = (id: string, mode: 'subtree' | 'chain') => {
    const n = copyNodes(id, mode)
    if (n) toast(`已复制 ${n} 张卡${mode === 'chain' ? '（含后面的步骤）' : '（含子任务）'}`)
    setCtxMenu(null)
  }

  const doPaste = (parentId?: string | null) => {
    const n = pasteNodes({ parentId: parentId ?? null })
    if (n) toast(`已粘贴 ${n} 张卡`)
    else toast('剪贴板是空的')
    setCtxMenu(null)
  }

  // ⌘C / ⌘V：抽屉开着时交给抽屉自己处理（粘贴到当前任务下）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return
      if (document.querySelector('div.fixed.inset-0.z-40')) return
      const key = e.key.toLowerCase()
      if (key === 'c') {
        const id = hoveredRef.current
        if (!id) return
        e.preventDefault()
        doCopy(id, 'subtree')
      } else if (key === 'v') {
        e.preventDefault()
        doPaste(hoveredRef.current)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })
  /** 拖拽中的节点 id：dragover 用 ref，避免 state 更新延迟到下一帧才生效 */
  const dragIdRef = useRef<string | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  const [dropId, setDropId] = useState<string | null>(null)

  const clearDrag = () => {
    dragIdRef.current = null
    setDragId(null)
    setDropId(null)
    stopEdgeScroll()
  }

  const dnd: Dnd = {
    dragId,
    dropId,
    onDragStart: (id, e) => {
      dragIdRef.current = id
      setDragId(id)
      e.dataTransfer.setData('application/x-route-node', id)
      e.dataTransfer.effectAllowed = 'move'
    },
    onDragEnd: clearDrag,
    onDragOver: (id, e) => {
      if (!dragIdRef.current || dragIdRef.current === id) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      setDropId(id)
    },
    onDragLeave: (id) => {
      setDropId((cur) => (cur === id ? null : cur))
    },
    onDrop: (id, e) => {
      e.preventDefault()
      const from = e.dataTransfer.getData('application/x-route-node') || dragIdRef.current
      clearDrag()
      if (!from || from === id) return
      // 不能拖到自己的子任务里（会成环）
      const isDescendant = (() => {
        let cur = nodes.find((n) => n.id === id)
        while (cur?.parentId) {
          if (cur.parentId === from) return true
          cur = nodes.find((n) => n.id === cur!.parentId)
        }
        return false
      })()
      if (isDescendant) {
        toast('不能拖到它自己的子任务下面')
        return
      }
      moveSubtree(from, id)
      toast('已把整串接到这张卡片后面')
    },
  }
  const roots = useMemo(() => nodes.filter((n) => !n.parentId), [nodes])
  const wrapRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  /**
   * 拖到左右边缘时自动横向滚动：
   * 卡片拖到屏幕外的地方时不用反复松手再拖，停边上就会自己滚。
   */
  const edgeDirRef = useRef<0 | -1 | 1>(0)
  const edgeSpeedRef = useRef(0)
  const vDirRef = useRef<0 | -1 | 1>(0)
  const vSpeedRef = useRef(0)
  const edgeRafRef = useRef<number | null>(null)
  const stopEdgeScroll = () => {
    edgeDirRef.current = 0
    edgeSpeedRef.current = 0
    vDirRef.current = 0
    vSpeedRef.current = 0
    if (edgeRafRef.current !== null) {
      window.cancelAnimationFrame(edgeRafRef.current)
      edgeRafRef.current = null
    }
  }
  const startEdgeScroll = () => {
    if (edgeRafRef.current !== null) return
    const tick = () => {
      const el = scrollRef.current
      const hDir = edgeDirRef.current
      const vDir = vDirRef.current
      if (!el || (hDir === 0 && vDir === 0)) {
        edgeRafRef.current = null
        return
      }
      if (hDir !== 0) el.scrollLeft += hDir * edgeSpeedRef.current
      if (vDir !== 0) {
        // 页面竖向滚动容器（路线图那一块的外层）
        const pageScroller = el.closest('.overflow-y-auto') as HTMLElement | null
        if (pageScroller) pageScroller.scrollTop += vDir * vSpeedRef.current
      }
      edgeRafRef.current = window.requestAnimationFrame(tick)
    }
    edgeRafRef.current = window.requestAnimationFrame(tick)
  }
  /** 只在拖路线卡片时生效；越靠近边缘滚得越快 */
  const handleEdgeDragOver = (e: React.DragEvent) => {
    if (!e.dataTransfer?.types.includes('application/x-route-node')) return
    const el = scrollRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const EDGE = 76
    const dir: 0 | -1 | 1 =
      e.clientX > r.right - EDGE ? 1 : e.clientX < r.left + EDGE ? -1 : 0
    if (dir === 0) {
      edgeDirRef.current = 0
      edgeSpeedRef.current = 0
    } else {
      const depth =
        dir === 1 ? (e.clientX - (r.right - EDGE)) / EDGE : (r.left + EDGE - e.clientX) / EDGE
      edgeSpeedRef.current = 5 + Math.min(1, Math.max(0, depth)) * 17
      edgeDirRef.current = dir
    }

    // 上下：靠近视口边缘时竖向滚动（路线图比一屏高的时候用）
    const V_EDGE = 90
    const vDir: 0 | -1 | 1 =
      e.clientY > window.innerHeight - V_EDGE
        ? 1
        : e.clientY < V_EDGE
          ? -1
          : 0
    if (vDir === 0) {
      vDirRef.current = 0
      vSpeedRef.current = 0
    } else {
      const depth =
        vDir === 1
          ? (e.clientY - (window.innerHeight - V_EDGE)) / V_EDGE
          : (V_EDGE - e.clientY) / V_EDGE
      vSpeedRef.current = 5 + Math.min(1, Math.max(0, depth)) * 15
      vDirRef.current = vDir
    }

    if (dir === 0 && vDir === 0) {
      stopEdgeScroll()
    } else {
      startEdgeScroll()
    }
  }
  useEffect(() => () => stopEdgeScroll(), [])
  const [paths, setPaths] = useState<Seg[]>([])
  const [box, setBox] = useState({ w: 0, h: 0 })
  /** 左右两边还有没有没露出来的卡片：有就挂渐变/箭头，省得用户不知道能滚 */
  const [edges, setEdges] = useState({ left: false, right: false })

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const check = () =>
      setEdges({
        left: el.scrollLeft > 12,
        right: el.scrollWidth - el.scrollLeft - el.clientWidth > 12,
      })
    check()
    el.addEventListener('scroll', check)
    const ro = new ResizeObserver(check)
    ro.observe(el)
    return () => {
      el.removeEventListener('scroll', check)
      ro.disconnect()
    }
  }, [nodes, collapsed])

  /** 按真实布局算连线位置：卡片高度不一，用估算的固定偏移一定会错位 */
  const compute = useCallback(() => {
    const wrap = wrapRef.current
    if (!wrap || !nodes.length) return
    const base = wrap.getBoundingClientRect()
    const rectOf = (id: string) => {
      const el = wrap.querySelector<HTMLElement>(`[data-node-id="${id}"]`)
      if (!el) return null
      const r = el.getBoundingClientRect()
      return {
        left: r.left - base.left,
        right: r.right - base.left,
        top: r.top - base.top,
        bottom: r.bottom - base.top,
        cy: r.top + r.height / 2 - base.top,
      }
    }

    const out: Seg[] = []
    // 折叠的节点：它的**子链**不渲染，但它自己还在，作为「这一段」的代表。
    // 所以这里不能按 collapsed 排除——被收起的那张卡自己也要算可见，
    // 否则父卡在算「我有哪些子任务」时看不到它，连向它的箭头就不画了。
    // 被收起节点下面的卡本来就不在 DOM 里，rectOf 取不到，自然被过滤掉。
    const visible = nodes.filter((n) => rectOf(n.id) !== null)
    const visibleIds = new Set(visible.map((n) => n.id))

    /**
     * 一张卡「子树主线」的末端：沿主线一路往右下走到底。
     * 串行链里上一张卡如果展开了子树，它的下一步其实排在整棵子树后面，
     * 连接线得从子树末端接过去，不能直接从上一张卡横跨子树画到下一步（会穿过子卡）。
     */
    const tailOf = (n: ActionNode): ActionNode => {
      let cur = n
      for (let guard = 0; guard < 50; guard++) {
        const kids = childrenOf(nodes, cur.id).filter((k) => visibleIds.has(k.id))
        if (!kids.length) return cur
        const groups = new Map<string, ActionNode[]>()
        for (const k of kids) {
          const key = k.branch || ''
          groups.set(key, [...(groups.get(key) ?? []), k])
        }
        const mainKey = groups.has('主线') ? '主线' : [...groups.keys()][0]
        const chain = groups.get(mainKey) ?? kids
        const next = chain[chain.length - 1] ?? kids[0]
        if (!next || next.id === cur.id) return cur
        cur = next
      }
      return cur
    }

    // 顶层目标之间的连接，三种情况：
    //  a) 前一个目标有展开的子链 → 从主线末端用「带线箭头」接到下一个目标
    //  b) 前一个目标的主线收起来了 → 从那个收起来的节点接
    //  c) 真的什么都没有 → 只放一个尖角
    for (let i = 1; i < roots.length; i++) {
      const prevRoot = roots[i - 1]
      const a = rectOf(prevRoot.id)
      const b = rectOf(roots[i].id)
      if (!a || !b) continue

      /*
        沿着**主线**一路走到底，而不是取「整棵子树里最靠右的那个」。

        以前用的最靠右：主线一收起来，子节点就不在 DOM 里了，这时最靠右的
        往往是旁边那条并行分支的末端（比如「查软考」）——于是下一个目标
        就接到了那条支线上，看着完全不对。主线才是「走到下一个目标」的那条路。
      */
      let tailNode = prevRoot
      for (let guard = 0; guard < 50; guard++) {
        const kids = childrenOf(nodes, tailNode.id).filter((k) => visibleIds.has(k.id))
        if (!kids.length) break
        /*
          「主线」是同一组里横向排开的那一串，末端 = 这一串的**最后一个**。
          以前取的是 kids.find(branch==='主线')，也就是第一个孩子，于是链走到一半就停了，
          下一个目标的线从半截卡出发、从后面的卡背后穿过去——AGENTS.md 里「沿主线走到底」
          说的就是这个坑。现在按 branch 分组，取主线组的最后一张，它还有子节点就继续往下。
        */
        const groups = new Map<string, ActionNode[]>()
        for (const k of kids) {
          const key = k.branch || ''
          groups.set(key, [...(groups.get(key) ?? []), k])
        }
        const mainKey = groups.has('主线') ? '主线' : [...groups.keys()][0]
        const chain = groups.get(mainKey) ?? kids
        tailNode = chain[chain.length - 1] ?? kids[0]
      }

      /*
        前一个目标和下一个目标之间要不要画线，看它俩之间「有没有藏着一段」：
        - 主线末端不是它自己 → 中间还有东西，从末端连
        - 它自己收了子链 → 它就是这一段的代表，从它连
        只有真的什么都没有、平铺直叙的相邻两步，才只放一个尖角不画线。
      */
      const foldedWithKids =
        collapsed.includes(prevRoot.id) && nodes.some((n) => n.parentId === prevRoot.id)
      const tail =
        tailNode.id !== prevRoot.id || foldedWithKids ? rectOf(tailNode.id) : null

      if (tail) {
        out.push(...elbow(tail.right, tail.cy, b.left, b.cy, tail.right + 6))
        out.push({ d: chevron(centeredTip(tail.right, b.left), b.cy), tone: 'tip' })
        continue
      }

      // 同一层级、中间没有藏着东西：V 型箭头（不带线），取两张卡的中点
      out.push({
        d: vArrow(centeredTip(a.right, b.left), (a.cy + b.cy) / 2),
        tone: 'tip',
      })
    }

    // 父 → 子：竖主干 + 水平分叉
    // 曾经每条分支各画一条长斜线，分支一多必然在中段互相交叉，5 条就成一团电缆。
    // 改成共用一根竖主干、各分支从主干水平伸出，几何上不可能交叉。
    for (const parent of visible) {
      const kids = nodes.filter((n) => n.parentId === parent.id && visibleIds.has(n.id))
      if (!kids.length) continue
      const p = rectOf(parent.id)
      if (!p) continue

      // 按 branch 分组，每组一行
      const map = new Map<string, ActionNode[]>()
      for (const k of kids) map.set(k.branch || '', [...(map.get(k.branch || '') ?? []), k])
      const groups = [...map.values()]

      const heads = groups
        .map((g) => ({ group: g, r: rectOf(g[0].id) }))
        .filter((x): x is { group: ActionNode[]; r: NonNullable<ReturnType<typeof rectOf>> } => !!x.r)
      if (!heads.length) continue

      // 父 → 子：每条分支都走同一个 elbow。
      // 横向出线的长度一致，所以竖直段会重合在同一根主干上——
      // 视觉上还是一根主干分出几枝，但形状和「两个根目标之间」那条完全一样。
      const outX = p.right + TRUNK_INSET
      for (const h of heads) {
        out.push(...elbow(p.right, p.cy, h.r.left, h.r.cy, outX))
        out.push({ d: chevron(centeredTip(p.right, h.r.left), h.r.cy), tone: 'tip' })
      }

      // 同一路线里的一串小任务之间：用 V 连接
      for (const g of groups) {
        for (let i = 1; i < g.length; i++) {
          const a = rectOf(g[i - 1].id)
          const b = rectOf(g[i].id)
          if (!a || !b) continue
          const prevNode = g[i - 1]
          const tail = tailOf(prevNode)
          if (tail.id !== prevNode.id) {
            /*
              上一张卡有展开的子树：它的下一步在整棵子树后面。
              以前还是按「相邻同级」直接画一个 V，V 会落在子卡中间（看起来像
              子卡之间的连接，链条就断了）。现在从子树末端用带线箭头接到下一步。
            */
            const t = rectOf(tail.id)
            if (t) {
              out.push(...elbow(t.right, t.cy, b.left, b.cy, t.right + TRUNK_INSET))
              out.push({ d: chevron(centeredTip(t.right, b.left), b.cy), tone: 'tip' })
              continue
            }
          }
          // 真正相邻的同级：V 型箭头（不带线），纵向放在两张卡的中点，
          // 卡片高度不同时也不会看着偏上/偏下
          out.push({
            d: vArrow(centeredTip(a.right, b.left), (a.cy + b.cy) / 2),
            tone: 'tip',
          })
        }
      }
    }

    // 比较时把 tone 也算进去，否则只是颜色变了不会触发更新
    const sig = (list: Seg[]) => list.map((p) => `${p.tone}:${p.d}`).join('|')
    const next = sig(out)
    setPaths((prev) => (sig(prev) === next ? prev : out))
    setBox((prev) => {
      const w = wrap.scrollWidth
      const h = wrap.scrollHeight
      return prev.w === w && prev.h === h ? prev : { w, h }
    })
  }, [nodes, collapsed, roots])

  useLayoutEffect(() => {
    compute()
  }, [compute])

  useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap) return
    const ro = new ResizeObserver(() => compute())
    ro.observe(wrap)
    return () => ro.disconnect()
  }, [compute])

  const ctxMenuView = ctxMenu
    ? (() => {
        const target = ctxMenu.nodeId ? nodes.find((n) => n.id === ctxMenu.nodeId) : null
        const hasDoneDesc = (() => {
          if (!target) return false
          const stack = [target.id]
          while (stack.length) {
            const pid = stack.pop() as string
            for (const n of nodes) {
              if (n.parentId !== pid) continue
              if (n.done) return true
              stack.push(n.id)
            }
          }
          return false
        })()
        return (
          <>
            <div
              className="fixed inset-0 z-40"
              onClick={() => setCtxMenu(null)}
              onContextMenu={(e) => {
                e.preventDefault()
                setCtxMenu(null)
              }}
            />
            <div
              className="fixed z-50 w-[238px] overflow-hidden rounded-[14px] border border-line/70 bg-surface p-1.5 shadow-e3 anim-pop"
              style={{
                left: Math.min(ctxMenu.x, window.innerWidth - 254),
                top: Math.min(ctxMenu.y, window.innerHeight - 250),
              }}
              onClick={(e) => e.stopPropagation()}
            >
              {target ? (
                <>
                  <div className="truncate px-2 pt-1 pb-1.5 text-[10.5px] text-faint">
                    {target.title}
                  </div>
                  <button
                    onClick={() => doCopy(target.id, 'subtree')}
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12px] text-ink-2 transition-colors hover:bg-surface-3"
                  >
                    <Copy size={12} className="shrink-0" />
                    复制这张（含子任务）
                  </button>
                  <button
                    onClick={() => doCopy(target.id, 'chain')}
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12px] text-ink-2 transition-colors hover:bg-surface-3"
                  >
                    <Copy size={12} className="shrink-0" />
                    复制这一串（含后面步骤）
                  </button>
                  <div className="my-1 h-px bg-line/70" />
                  <button
                    disabled={!clipboard}
                    onClick={() => doPaste(target.id)}
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12px] text-ink-2 transition-colors hover:bg-surface-3 disabled:cursor-not-allowed disabled:text-faint"
                  >
                    <ClipboardPaste size={12} className="shrink-0" />
                    粘贴为它的并行子任务
                  </button>
                  <p className="px-2 pt-1 pb-1.5 text-[10px] leading-relaxed text-faint">
                    效果和把卡片拖到它上面一样，接在它下面单独成一条线
                  </p>
                  <div className="my-1 h-px bg-line/70" />
                  {hasDoneDesc && (
                    <button
                      onClick={() => {
                        const n = clearDoneChildren(target.id)
                        toast(`已清除 ${n} 个已完成的子任务`)
                        setCtxMenu(null)
                      }}
                      className="flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left text-[12px] text-ink-2 transition-colors hover:bg-surface-3"
                    >
                      <CheckCheck size={12} className="mt-[3px] shrink-0" />
                      <span>
                        清除已完成的子任务
                        <span className="mt-0.5 block text-[10px] leading-snug text-faint">
                          只清勾选完成的，其它不动
                        </span>
                      </span>
                    </button>
                  )}
                  <button
                    onClick={() => {
                      deleteNode(target.id, 'only')
                      toast('已删掉这条，后面一步接回前一步')
                      setCtxMenu(null)
                    }}
                    className="flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left text-[12px] text-ink-2 transition-colors hover:bg-danger-soft hover:text-danger"
                  >
                    <Trash2 size={12} className="mt-[3px] shrink-0" />
                    <span>
                      删掉这条（子任务一起删）
                      <span className="mt-0.5 block text-[10px] leading-snug text-faint">
                        后面一步自动接回前一步
                      </span>
                    </span>
                  </button>
                  <button
                    onClick={() => {
                      deleteNode(target.id, 'cascade')
                      toast('已删掉它和后面整串')
                      setCtxMenu(null)
                    }}
                    className="flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left text-[12px] text-ink-2 transition-colors hover:bg-danger-soft hover:text-danger"
                  >
                    <Trash2 size={12} className="mt-[3px] shrink-0" />
                    <span>
                      删掉它和后面整串
                      <span className="mt-0.5 block text-[10px] leading-snug text-faint">
                        后面的步骤不会保留
                      </span>
                    </span>
                  </button>
                </>
              ) : (
                <>
                  <div className="label px-2 pt-1 pb-1.5">空白处</div>
                  <button
                    disabled={!clipboard}
                    onClick={() => doPaste(null)}
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12px] text-ink-2 transition-colors hover:bg-surface-3 disabled:cursor-not-allowed disabled:text-faint"
                  >
                    <ClipboardPaste size={12} className="shrink-0" />
                    粘贴为新的目标
                  </button>
                  <p className="px-2 pt-1 pb-1.5 text-[10px] leading-relaxed text-faint">
                    把剪贴板里的卡片放到当前路线顶层
                  </p>
                </>
              )}
            </div>
          </>
        )
      })()
    : null

  if (!roots.length) {
    return (
      <div
        className="relative"
        onContextMenu={(e) => {
          if ((e.target as HTMLElement).closest('[data-node-id]')) return
          openCtxMenu(undefined, e)
        }}
      >
        <EmptyState
          icon={ListChecks}
          title="还没有行动路线"
          hint="有一个想做成的事，就从一个目标开始；后面可以慢慢拆成几条并行的线。"
          action={
            onAddGoal
              ? { label: '加第一个目标', onClick: onAddGoal, icon: <Plus size={12} /> }
              : undefined
          }
        />
        {ctxMenuView}
      </div>
    )
  }

  return (
    <div
      className="relative"
      onContextMenu={(e) => {
        if ((e.target as HTMLElement).closest('[data-node-id]')) return
        openCtxMenu(undefined, e)
      }}
    >
      <div
        ref={scrollRef}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
          const el = scrollRef.current
          if (!el) return
          e.preventDefault()
          el.scrollBy({ left: e.key === 'ArrowRight' ? 240 : -240, behavior: 'smooth' })
        }}
        aria-label="行动路线图，可以用左右方向键横向滚动"
        onMouseOver={(e) => {
          const el = (e.target as HTMLElement).closest('[data-node-id]')
          hoveredRef.current = el ? el.getAttribute('data-node-id') : null
        }}
        onDragOver={handleEdgeDragOver}
        onDragLeave={(e) => {
          const next = e.relatedTarget as Node | null
          if (!next || !(e.currentTarget as HTMLElement).contains(next)) stopEdgeScroll()
        }}
        className="overflow-x-auto rounded-[12px] px-2 pt-4 pb-4 focus-visible:ring-2 focus-visible:ring-accent/35 focus-visible:outline-none"
      >
        <div ref={wrapRef} className="relative min-w-max px-2">
          {/* 连线层：位置按真实布局算 */}
          <svg
            className="pointer-events-none absolute top-0 left-0 transform-gpu"
            width={box.w}
            height={box.h}
            aria-hidden
          >
            {paths.map((p, i) => (
              <path
                key={i}
                d={p.d}
                fill="none"
                stroke={p.tone === 'tip' ? TIP : p.tone === 'trunk' ? TRUNK : CURVE}
                strokeWidth={p.tone === 'tip' ? 2 : p.tone === 'trunk' ? 1.2 : 1.5}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ))}
          </svg>

          <div className="flex items-start">
            {roots.map((root, i) => (
              <Fragment key={root.id}>
                {i > 0 && <span className="w-[40px] shrink-0" />}
                <Column
                  node={root}
                  nodes={nodes}
                  collapsed={collapsed}
                  onOpen={onOpen}
                  onToggle={onToggle}
                  onPin={onPin}
                  onToggleCollapse={onToggleCollapse}
                  dnd={dnd}
                  onCardContextMenu={openCtxMenu}
                />
              </Fragment>
            ))}
          </div>
        </div>
      </div>
      {edges.left && (
        <div className="pointer-events-none absolute top-0 bottom-2 left-0 w-10 rounded-l-[12px] bg-gradient-to-r from-surface to-transparent" />
      )}
      {edges.right && (
        <div className="pointer-events-none absolute top-0 right-0 bottom-2 w-10 bg-gradient-to-l from-surface to-transparent" />
      )}
      {edges.right && (
        <button
          onClick={() => {
            const el = scrollRef.current
            if (el) el.scrollBy({ left: Math.max(320, el.clientWidth * 0.7), behavior: 'smooth' })
          }}
          title="右边还有，点一下滚过去"
          aria-label="向右滚动"
          className="absolute top-1/2 right-1 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full border border-line bg-surface text-muted shadow-[0_2px_8px_rgba(23,22,26,.12)] transition-colors hover:border-line-2 hover:text-ink"
        >
          <ChevronRight size={16} />
        </button>
      )}

      {ctxMenuView}
    </div>
  )
})
