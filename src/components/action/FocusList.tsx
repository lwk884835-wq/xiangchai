import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, Pin, PinOff, Plus, X } from 'lucide-react'
import type { ActionBoard, ActionNode } from '@/types'
import { childrenOf, useActions } from '@/store/actions'
import { cn } from '@/lib/cn'
import { EmptyState } from '@/components/EmptyState'

/** 串行连线：一个开口朝上的 V（尖朝下）。绝对定位，叠在两行之间，不占行高。 */
function SerialLink({ left }: { left: number }) {
  return (
    <svg
      width="10"
      height="5"
      viewBox="0 0 10 5"
      className="absolute"
      style={{ left: left - 5, top: -1 }}
      aria-hidden
    >
      <path
        d="M2.2 0.5 L5 4.6 L7.8 0.5"
        fill="none"
        style={{ stroke: 'var(--route-tip)' }}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/**
 * 顶部「重点」清单
 *
 * 这里放的是**用户的行为重点**：他自己想推的事。
 * - 来自路线上的节点（被 pin 的），连同它下面最多三层
 * - 用户临时手加的事项
 *
 * 26.11.14：和行动面板解耦——清单不再跟着当前路线变，**所有路线**的重点
 * 汇在同一份里，切路线时内容不动。分组仍按路线走（当前路线排最前，
 * 其余按路线列表顺序），组内仍按树走：父任务在子任务前面，
 * 前置是上一步的时候中间会出现小箭头，表示「串着做」。
 * 跨路线以后光看标题不知道它属于哪条线，所以点标题直接跳过去定位。
 *
 * 26.11.14 折叠：重点全汇总到一处之后一层层摊开会很长，
 * 所以每个有下级的行都能折起自己下面那一整块；表头还有一个
 * 「全部折叠 / 全部展开」，一键只留每条路线的最高层。
 * 折叠状态存 localStorage（按 路线id:卡片id），不写进 store 的持久化结构。
 */

/** 折叠状态单独放一个 key，不碰 store 里那份数据的结构（免得要写迁移） */
const FOLD_KEY = 'work-route-focus-folded-v1'

const loadFolded = (): Record<string, true> => {
  try {
    const raw = localStorage.getItem(FOLD_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, true>) : {}
  } catch {
    return {}
  }
}

type Row = { node: ActionNode; depth: number }

/** 把扁平的行接出「谁是它的上一级」和「它有没有下级」——折叠要用 */
export type FocusRow = {
  node: ActionNode
  depth: number
  /** 上一级在数组里的下标；-1 = 这一组的顶层 */
  parent: number
  hasChildren: boolean
  /** 折起来以后要提示里面还有多少条 */
  descendants: number
}

const shapeRows = (rows: Row[]): FocusRow[] => {
  const stack: number[] = []
  return rows.map((r, i) => {
    while (stack.length && rows[stack[stack.length - 1]].depth >= r.depth) stack.pop()
    const parent = stack.length ? stack[stack.length - 1] : -1
    stack.push(i)
    let descendants = 0
    for (let k = i + 1; k < rows.length && rows[k].depth > r.depth; k++) descendants++
    return { ...r, parent, hasChildren: descendants > 0, descendants }
  })
}

const foldKeyOf = (boardId: string, nodeId: string) => `${boardId}:${nodeId}`

export function FocusList({
  boards,
  activeBoardId,
  onJump,
}: {
  boards: ActionBoard[]
  activeBoardId: string | null
  /** 点一条重点：切到它所在路线并滚到那张卡上 */
  onJump: (boardId: string, nodeId: string) => void
}) {
  const focusItems = useActions((s) => s.focusItems)
  const addFocusItem = useActions((s) => s.addFocusItem)
  const toggleFocusItem = useActions((s) => s.toggleFocusItem)
  const removeFocusItem = useActions((s) => s.removeFocusItem)
  const toggleNode = useActions((s) => s.toggleNode)
  const pinNode = useActions((s) => s.pinNode)
  const [draft, setDraft] = useState('')
  const draftRef = useRef<HTMLInputElement>(null)
  const [folded, setFolded] = useState<Record<string, true>>(loadFolded)

  useEffect(() => {
    try {
      localStorage.setItem(FOLD_KEY, JSON.stringify(folded))
    } catch {
      /* 隐私模式之类写不进去就算了，折叠状态当次会话内仍然有效 */
    }
  }, [folded])

  const groups = useMemo(() => {
    /* 单条路线里怎么取：只放用户自己 pin 进来的，不自动带上祖先。
       钉父任务会连带钉三层内的子任务，缩进跟着层级走。 */
    const collect = (b: ActionBoard) => {
      const byId = new Map(b.nodes.map((n) => [n.id, n]))
      const rows: Row[] = []
      const walk = (id: string, depth: number) => {
        const n = byId.get(id)
        if (!n) return
        if (n.pinned) {
          rows.push({ node: n, depth })
          for (const c of childrenOf(b.nodes, id)) walk(c.id, depth + 1)
        } else {
          for (const c of childrenOf(b.nodes, id)) walk(c.id, depth)
        }
      }
      for (const r of b.nodes.filter((n) => !n.parentId)) walk(r.id, 0)
      return shapeRows(rows)
    }
    // 归档的路线不往重点里冒；当前路线排最前，免得刚钉的东西掉到下面看不见
    const live = boards.filter((b) => !b.archived)
    const ordered = [
      ...live.filter((b) => b.id === activeBoardId),
      ...live.filter((b) => b.id !== activeBoardId),
    ]
    return ordered
      .map((b) => ({ boardId: b.id, boardTitle: b.jobTitle, rows: collect(b) }))
      .filter((g) => g.rows.length)
  }, [boards, activeBoardId])

  /** 这一行是不是被某个折叠起来的上级藏住了 */
  const hiddenIn = (rows: FocusRow[], index: number, fold: Record<string, true>, boardId: string) => {
    let p = rows[index].parent
    while (p >= 0) {
      if (fold[foldKeyOf(boardId, rows[p].node.id)]) return true
      p = rows[p].parent
    }
    return false
  }

  /** 所有「有下级」的行——全部折叠 / 展开都是对它们下手 */
  const foldableKeys = useMemo(
    () =>
      groups.flatMap((g) =>
        g.rows.filter((r) => r.hasChildren).map((r) => foldKeyOf(g.boardId, r.node.id)),
      ),
    [groups],
  )
  const allFolded = foldableKeys.length > 0 && foldableKeys.every((k) => folded[k])

  const toggleFold = (boardId: string, nodeId: string) =>
    setFolded((f) => {
      const key = foldKeyOf(boardId, nodeId)
      const next = { ...f }
      if (next[key]) delete next[key]
      else next[key] = true
      return next
    })

  const foldAll = () => {
    const next: Record<string, true> = {}
    for (const k of foldableKeys) next[k] = true
    setFolded(next)
  }
  const unfoldAll = () => setFolded({})

  const submit = () => {
    if (!draft.trim()) return
    addFocusItem(draft)
    setDraft('')
  }

  return (
    <section className="rounded-[16px] border border-line/60 bg-surface shadow-e1">
      <header className="flex items-center gap-2 border-b border-line/80 px-5 py-3.5">
        <h2 className="shrink-0 text-[14px] font-semibold tracking-tight">重点</h2>
        <span className="hidden min-w-0 truncate text-[12px] text-faint lg:inline">
          所有路线的重点都在这儿 · 钉一个任务会带上它三层内的子任务 · 点标题跳到那张卡
        </span>
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          {foldableKeys.length > 0 && (
            <button
              onClick={allFolded ? unfoldAll : foldAll}
              title={
                allFolded
                  ? '全部展开（把折起来的下级都放出来）'
                  : '全部折叠：只留每条路线最高层的任务，下级的先收起来'
              }
              className="flex h-[22px] items-center gap-1 rounded-md border border-line px-1.5 text-[11px] text-muted transition-colors hover:bg-surface-3 hover:text-ink"
            >
              {allFolded ? <ChevronsUpDown size={11} /> : <ChevronsDownUp size={11} />}
              <span className="hidden xl:inline">{allFolded ? '全部展开' : '全部折叠'}</span>
            </button>
          )}
          <input
            ref={draftRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit()
            }}
            placeholder="临时加一件要做的"
            className="w-[104px] rounded-md border border-line bg-surface-2 px-2 py-[3px] text-[11px] placeholder:text-faint focus:border-line-2 focus:outline-none lg:w-[150px]"
          />
          <button
            onClick={submit}
            title="加一条"
            className="flex h-[22px] w-[22px] items-center justify-center rounded-md border border-line text-muted transition-colors hover:bg-surface-3 hover:text-ink"
          >
            <Plus size={12} />
          </button>
        </div>
      </header>

      <div className="px-2 py-2">
        {groups.map((g, gi) => {
          // 被上级折叠起来的行不画；串行箭头按「可见的上一行」算，免得指着看不见的卡
          const visible = g.rows.filter((_, i) => !hiddenIn(g.rows, i, folded, g.boardId))
          return (
            <div key={g.boardId}>
              {/* 组与组之间只隔一条细线，不写路线名（他心里清楚东西大概在哪条线上） */}
              {gi > 0 && <div className="mx-2 my-1.5 border-t border-line/80" />}
              {visible.map((r, ri) => {
                const prev = ri > 0 ? visible[ri - 1].node : null
                // 上一步是这一步的前置 → 用一个小箭头表达「串着做」
                const serial = !!prev && r.node.deps.includes(prev.id)
                const isFolded = !!folded[foldKeyOf(g.boardId, r.node.id)]
                return (
                  <div key={r.node.id} className="relative">
                    <div
                      className="group flex items-center gap-2 rounded-[9px] px-2.5 py-[9px] transition-colors duration-150 hover:bg-surface-2/90"
                      style={{ paddingLeft: `${8 + r.depth * 18}px` }}
                    >
                      {/* 折叠箭头：只对有下级的行可点，没下级的留同宽空位保住对齐 */}
                      {r.hasChildren ? (
                        <button
                          onClick={() => toggleFold(g.boardId, r.node.id)}
                          title={
                            isFolded
                              ? `展开下面 ${r.descendants} 条`
                              : `折起下面 ${r.descendants} 条`
                          }
                          className="-mr-1 flex h-[14px] w-[14px] shrink-0 items-center justify-center rounded text-faint transition-colors hover:bg-surface-3 hover:text-ink"
                        >
                          {isFolded ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                        </button>
                      ) : (
                        <span className="-mr-1 h-[14px] w-[14px] shrink-0" aria-hidden />
                      )}
                      <button
                        onClick={() => toggleNode(r.node.id, g.boardId)}
                        className={cn(
                          'flex h-[16px] w-[16px] shrink-0 items-center justify-center rounded-[5px] border transition-all duration-150 active:scale-90',
                          r.node.done ? 'border-ok bg-ok text-on-ok' : 'border-line-2 hover:border-ink',
                        )}
                      >
                        {r.node.done && <Check size={10} strokeWidth={3} />}
                      </button>
                      <button
                        onClick={() => onJump(g.boardId, r.node.id)}
                        title={`${r.node.title}\n${g.boardTitle || '未命名路线'} · 点一下跳过去`}
                        className={cn(
                          'min-w-0 truncate text-left text-[13px] leading-[1.5]',
                          r.node.done ? 'text-faint line-through decoration-line-2' : 'text-ink-2',
                          'transition-colors duration-200',
                        )}
                      >
                        {r.node.title}
                      </button>
                      {/* 折起来的时候跟在标题后面提示「里面还有几条」，后面再用弹性空位把图钉顶到右边 */}
                      {isFolded && r.hasChildren && (
                        <span
                          title={`下面还有 ${r.descendants} 条没展开`}
                          className="shrink-0 rounded bg-surface-3 px-1 text-[10px] leading-[15px] text-faint"
                        >
                          {r.descendants}
                        </span>
                      )}
                      <span className="min-w-0 flex-1" aria-hidden />
                      <button
                        onClick={() => pinNode(r.node.id, false, g.boardId)}
                        title="从重点里摘掉（连同三层内的子任务）"
                        className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded text-faint opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 hover:bg-surface-3 hover:text-ink"
                      >
                        <PinOff size={11} />
                      </button>
                    </div>
                    {/* 串行连线：叠在上一行和这一行之间，不影响行距 */}
                    {serial && <SerialLink left={8 + r.depth * 18 + 7 + 18} />}
                  </div>
                )
              })}
            </div>
          )
        })}

        {focusItems.map((f) => (
          <div
            key={f.id}
            className="group flex items-center gap-2 rounded-lg px-2 py-[5px] transition-colors hover:bg-surface-2"
          >
            <button
              onClick={() => toggleFocusItem(f.id)}
              className={cn(
                'flex h-[14px] w-[14px] shrink-0 items-center justify-center rounded-[3px] border transition-all duration-150 active:scale-90',
                f.done ? 'border-ok bg-ok text-on-ok' : 'border-line-2 hover:border-ink',
              )}
            >
              {f.done && <Check size={9} strokeWidth={3} />}
            </button>
            <span
              className={cn(
                'min-w-0 flex-1 truncate text-[13px]',
                f.done ? 'text-faint line-through decoration-line-2' : 'text-ink-2',
                'transition-colors duration-200',
              )}
            >
              {f.text}
            </span>
            <span className="shrink-0 text-[10px] text-faint">手动</span>
            <button
              onClick={() => removeFocusItem(f.id)}
              className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded text-faint opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 hover:bg-surface-3 hover:text-ink"
            >
              <X size={11} />
            </button>
          </div>
        ))}

        {!groups.length && !focusItems.length && (
          <EmptyState
            icon={Pin}
            title="还没有重点"
            hint="点任务卡右上角的图钉把它定到这里；临时想到的事也可以手动加一条。所有路线的重点都会汇总在这一份里。"
            action={{
              label: '加一条临时事项',
              onClick: () => draftRef.current?.focus(),
            }}
            className="mx-1 mb-1 py-6"
          />
        )}
      </div>
    </section>
  )
}
