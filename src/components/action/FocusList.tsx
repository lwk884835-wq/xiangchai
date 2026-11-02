import { useMemo, useRef, useState } from 'react'
import { Check, Pin, Plus, X } from 'lucide-react'
import type { ActionNode } from '@/types'
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
 * - 来自路线的节点（被 pin 的），连同它下面最多三层
 * - 用户临时手加的事项
 *
 * 顺序按树走：父任务一定在子任务前面；
 * 如果这一步的前置是上一步，中间会出现一个小箭头，表示「串着做」。
 */
export function FocusList({
  nodes,
  onOpen,
}: {
  nodes: ActionNode[]
  onOpen: (id: string) => void
}) {
  const focusItems = useActions((s) => s.focusItems)
  const addFocusItem = useActions((s) => s.addFocusItem)
  const toggleFocusItem = useActions((s) => s.toggleFocusItem)
  const removeFocusItem = useActions((s) => s.removeFocusItem)
  const toggleNode = useActions((s) => s.toggleNode)
  const [draft, setDraft] = useState('')
  const draftRef = useRef<HTMLInputElement>(null)

  const rows = useMemo(() => {
    const byId = new Map(nodes.map((n) => [n.id, n]))
    const out: { node: ActionNode; depth: number }[] = []
    /*
      只放用户自己 pin 进来的，不自动带上祖先和子任务。
      这个清单是「我最近盯着这几件事」，不是「把整棵子树都铺给我看」；
      父子同时出现也是用户自己的选择，不用替他过滤掉。
      顺序还是按树走（父在子前），只是不再擅自扩名单。
    */
    const walk = (id: string, depth: number) => {
      const n = byId.get(id)
      if (!n) return
      if (n.pinned) {
        out.push({ node: n, depth })
        // 钉父任务会连带钉三层内的子任务；缩进跟着层级走
        for (const c of childrenOf(nodes, id)) walk(c.id, depth + 1)
      } else {
        for (const c of childrenOf(nodes, id)) walk(c.id, depth)
      }
    }
    for (const r of nodes.filter((n) => !n.parentId)) walk(r.id, 0)
    return out
  }, [nodes])

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
          你自己最近想推的事 · 钉一个任务会带上它三层内的子任务
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
        {rows.map((r, ri) => {
          const prev = ri > 0 ? rows[ri - 1].node : null
          // 上一步是这一步的前置 → 用一个小箭头表达「串着做」
          const serial = !!prev && r.node.deps.includes(prev.id)
          return (
            <div key={r.node.id} className="relative">
              <div
                className="group flex items-center gap-2 rounded-[9px] px-2.5 py-[9px] transition-colors duration-150 hover:bg-surface-2/90"
                style={{ paddingLeft: `${8 + r.depth * 18}px` }}
              >
                <button
                  onClick={() => toggleNode(r.node.id)}
                  className={cn(
                    'flex h-[16px] w-[16px] shrink-0 items-center justify-center rounded-[5px] border transition-all duration-150 active:scale-90',
                    r.node.done ? 'border-ok bg-ok text-white' : 'border-line-2 hover:border-ink',
                  )}
                >
                  {r.node.done && <Check size={10} strokeWidth={3} />}
                </button>
                <button
                  onClick={() => onOpen(r.node.id)}
                  className={cn(
                    'min-w-0 flex-1 truncate text-left text-[13px] leading-[1.5]',
                    r.node.done ? 'text-faint line-through decoration-line-2' : 'text-ink-2',
                    'transition-colors duration-200',
                  )}
                >
                  {r.node.title}
                </button>
              </div>
              {/* 串行连线：叠在上一行和这一行之间，不影响行距 */}
              {serial && <SerialLink left={8 + r.depth * 18 + 7} />}
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

        {!rows.length && !focusItems.length && (
          <EmptyState
            icon={Pin}
            title="还没有重点"
            hint="点任务卡右上角的图钉把它定到这里；临时想到的事也可以手动加一条。"
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
