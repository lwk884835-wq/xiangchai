import { useMemo, useRef, useState } from 'react'
import { Check, Pin, PinOff, Plus, X } from 'lucide-react'
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
        stroke="#8b7ff5"
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
 */
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

  const groups = useMemo(() => {
    /* 单条路线里怎么取：只放用户自己 pin 进来的，不自动带上祖先。
       钉父任务会连带钉三层内的子任务，缩进跟着层级走。 */
    const collect = (b: ActionBoard) => {
      const byId = new Map(b.nodes.map((n) => [n.id, n]))
      const rows: { node: ActionNode; depth: number }[] = []
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
      return rows
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
        {groups.map((g, gi) => (
          <div key={g.boardId}>
            {/* 组与组之间只隔一条细线，不写路线名（他心里清楚东西大概在哪条线上） */}
            {gi > 0 && <div className="mx-2 my-1 border-t border-line/50" />}
            {g.rows.map((r, ri) => {
              const prev = ri > 0 ? g.rows[ri - 1].node : null
              // 上一步是这一步的前置 → 用一个小箭头表达「串着做」
              const serial = !!prev && r.node.deps.includes(prev.id)
              return (
                <div key={r.node.id} className="relative">
                  <div
                    className="group flex items-center gap-2 rounded-[9px] px-2.5 py-[9px] transition-colors duration-150 hover:bg-surface-2/90"
                    style={{ paddingLeft: `${8 + r.depth * 18}px` }}
                  >
                    <button
                      onClick={() => toggleNode(r.node.id, g.boardId)}
                      className={cn(
                        'flex h-[16px] w-[16px] shrink-0 items-center justify-center rounded-[5px] border transition-all duration-150 active:scale-90',
                        r.node.done ? 'border-ok bg-ok text-white' : 'border-line-2 hover:border-ink',
                      )}
                    >
                      {r.node.done && <Check size={10} strokeWidth={3} />}
                    </button>
                    <button
                      onClick={() => onJump(g.boardId, r.node.id)}
                      title={`${g.boardTitle || '未命名路线'} · 点一下跳到这张卡`}
                      className={cn(
                        'min-w-0 flex-1 truncate text-left text-[13px] leading-[1.5]',
                        r.node.done ? 'text-faint line-through decoration-line-2' : 'text-ink-2',
                        'transition-colors duration-200',
                      )}
                    >
                      {r.node.title}
                    </button>
                    <button
                      onClick={() => pinNode(r.node.id, false, g.boardId)}
                      title="从重点里摘掉（连同三层内的子任务）"
                      className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded text-faint opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 hover:bg-surface-3 hover:text-ink"
                    >
                      <PinOff size={11} />
                    </button>
                  </div>
                  {/* 串行连线：叠在上一行和这一行之间，不影响行距 */}
                  {serial && <SerialLink left={8 + r.depth * 18 + 7} />}
                </div>
              )
            })}
          </div>
        ))}

        {focusItems.map((f) => (
          <div
            key={f.id}
            className="group flex items-center gap-2 rounded-lg px-2 py-[5px] transition-colors hover:bg-surface-2"
          >
            <button
              onClick={() => toggleFocusItem(f.id)}
              className={cn(
                'flex h-[14px] w-[14px] shrink-0 items-center justify-center rounded-[3px] border transition-all duration-150 active:scale-90',
                f.done ? 'border-ok bg-ok text-white' : 'border-line-2 hover:border-ink',
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
