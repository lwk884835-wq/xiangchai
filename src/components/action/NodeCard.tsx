import { memo, useLayoutEffect, useRef, useState } from 'react'
import { Check, ChevronDown, ChevronRight, MessageSquareText, Pin } from 'lucide-react'
import type { ActionNode } from '@/types'
import { cn } from '@/lib/cn'
import { useActions } from '@/store/actions'
import { useUi } from '@/store/ui'
import { codeOf, copyText } from '@/lib/code'
import { RichText } from './RichText'

/**
 * 层级越深，卡片越小 —— 视觉上直接看出主次。
 * 窄屏收窄一档：同样的窗口能多露出一层，读起来才连得住。
 */
const LEVEL_STYLE: Record<number, { wrap: string; title: string; sub: string }> = {
  1: {
    wrap: 'w-[236px] p-3.5 2xl:w-[268px] 2xl:p-4',
    title: 'text-[14px] 2xl:text-[15px]',
    sub: 'text-[12px] 2xl:text-[12px]',
  },
  2: {
    wrap: 'w-[212px] p-3 2xl:w-[238px] 2xl:p-3.5',
    title: 'text-[13px] 2xl:text-[14px]',
    sub: 'text-[11px] 2xl:text-[12px]',
  },
  3: {
    wrap: 'w-[192px] p-3 2xl:w-[212px]',
    title: 'text-[12px] 2xl:text-[13px]',
    sub: 'text-[11px] 2xl:text-[11px]',
  },
}

function styleOf(level: number) {
  return (
    LEVEL_STYLE[level] ?? {
      wrap: 'w-[176px] p-2.5 2xl:w-[196px]',
      title: 'text-[12px] 2xl:text-[12px]',
      sub: 'text-[10px] 2xl:text-[11px]',
    }
  )
}

export const NodeCard = memo(function NodeCard({
  node,
  onOpen,
  onToggle,
  onPin,
  compact,
  childCount = 0,
  collapsed = false,
  onToggleCollapse,
  progress = 'todo',
  draggable = false,
  dragging = false,
  dropTarget = false,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDragLeave,
  onDrop,
  onContextMenu,
  linked,
  flash,
}: {
  node: ActionNode
  onOpen: (id: string) => void
  onToggle: (id: string) => void
  onPin: (id: string, pinned: boolean) => void
  compact?: boolean
  childCount?: number
  collapsed?: boolean
  onToggleCollapse?: () => void
  /** 推进状态：已完成 / 进行中 / 还没开始 —— 靠卡片底色区分 */
  progress?: 'done' | 'doing' | 'todo'
  draggable?: boolean
  dragging?: boolean
  dropTarget?: boolean
  onDragStart?: (id: string, e: React.DragEvent) => void
  onDragEnd?: () => void
  onDragOver?: (id: string, e: React.DragEvent) => void
  onDragLeave?: (id: string, e: React.DragEvent) => void
  onDrop?: (id: string, e: React.DragEvent) => void
  onContextMenu?: (id: string, e: React.MouseEvent) => void
  /** 从别的路线链接进来的（或链接展开出来的卡片）：蓝色描边 */
  linked?: boolean
  /** 面板内搜索命中：闪一下 */
  flash?: boolean
}) {
  const st = styleOf(node.level)
  const images = useActions((s) => s.images)
  const dropRoot = node.dropRoot === true
  const dropped = node.dropped === true
  const toast = useUi((s) => s.showToast)
  const code = codeOf(node.id)
  const hasNotes = !!node.notes?.trim()
  const titleRef = useRef<HTMLDivElement>(null)
  /** 图标排法：单行横排；会换行的卡用竖排 + 文字环绕，右侧空间不浪费 */
  const [iconLayout, setIconLayout] = useState<'h' | 'v'>('h')
  useLayoutEffect(() => {
    const el = titleRef.current
    if (!el) return
    const cs = getComputedStyle(el)
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`
    const textWidth = ctx.measureText(node.title).width
    const reserved = hasNotes ? 44 : 24
    const available = Math.max(60, el.clientWidth)
    const lines = Math.ceil((textWidth + 6) / Math.max(30, available - reserved))
    setIconLayout(lines <= 1 ? 'h' : 'v')
  }, [node.title, hasNotes])
  return (
    <div
      data-node-id={node.id}
      draggable={draggable}
      style={
        dropTarget
          ? { outline: '2px solid var(--color-accent)', outlineOffset: 2 }
          : undefined
      }
      onDragStart={(e) => onDragStart?.(node.id, e)}
      onDragEnd={onDragEnd}
      onDragOver={(e) => onDragOver?.(node.id, e)}
      onDragLeave={(e) => {
        // 在卡片内部从一个子元素移到另一个子元素时不要清高亮，否则拖到未变色卡片上会闪没
        const next = e.relatedTarget as Node | null
        if (next && e.currentTarget.contains(next)) return
        onDragLeave?.(node.id, e)
      }}
      onDrop={(e) => onDrop?.(node.id, e)}
      onContextMenu={(e) => onContextMenu?.(node.id, e)}
      className={cn(
        'lift group relative shrink-0 rounded-[16px] border',
        st.wrap,
        // 底色 = 推进速度：搞定 / 进行中 / 还没开始；
        // 「不太合适」的标记优先：源头红、被带上的子任务/后续任务灰
        dropRoot
          ? 'border-danger/30 bg-danger-soft/80'
          : dropped
            ? 'border-line/60 bg-surface-3/80 opacity-80'
            : progress === 'done'
              ? 'border-ok/20 bg-ok-soft/75'
              : progress === 'doing'
                ? 'border-accent-line bg-accent-soft/60 shadow-[0_1px_2px_rgba(23,22,26,.04)]'
                : 'border-transparent bg-surface shadow-e1 hover:border-line/70',
        node.pinned && 'ring-1 ring-accent-line/70',
        draggable && 'cursor-grab active:cursor-grabbing',
        dragging && 'opacity-40',
        dropTarget && 'ring-2 ring-accent ring-offset-1 ring-offset-surface',
        linked && 'card-linked ring-0',
        flash && 'flash-hit',
      )}
    >
      <div
        role="button"
        tabIndex={0}
        onClick={() => onOpen(node.id)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onOpen(node.id)
          }
        }}
        className={cn(
          'block w-full text-left',
          draggable ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer',
          // 给右下角的「N 个子任务」按钮留一行，不然它压在描述最后一行上
          childCount > 0 && 'pb-[11px]',
        )}
      >
        <div className="flex items-start gap-1.5">
          <button
            onClick={(e) => {
              e.stopPropagation()
              if (dropped) return
              onToggle(node.id)
            }}
            disabled={dropped}
            className={cn(
              'mt-[2px] flex h-[15px] w-[15px] shrink-0 items-center justify-center rounded-[4px] border transition-all duration-150 active:scale-90',
              dropped
                ? 'cursor-not-allowed border-line-2 bg-surface-3 text-faint'
                : node.done
                  ? 'border-ok bg-ok text-on-ok'
                  : 'border-line-2 hover:border-ink',
            )}
            title={dropped ? '已标记「不太合适」，不参与勾选' : node.done ? '已完成' : '标记完成'}
          >
            {(node.done || dropped) && <Check size={10} strokeWidth={3} />}
          </button>
          <div ref={titleRef} className="min-w-0 flex-1">
            <span
              className={cn(
                'float-right ml-1.5 flex gap-1',
                iconLayout === 'h' ? 'flex-row items-center' : 'flex-col items-center gap-0.5',
              )}
            >
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  onPin(node.id, !node.pinned)
                }}
                title={node.pinned ? '从重点里拿掉（连同三层内的子任务）' : '定到重点（连同三层内的子任务）'}
                className={cn(
                  'flex h-[20px] w-[20px] items-center justify-center text-faint transition-opacity hover:text-ink',
                  node.pinned
                    ? 'text-accent opacity-100'
                    : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100',
                )}
              >
                <Pin size={11} strokeWidth={1.9} />
              </button>
              {hasNotes && (
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    onOpen(node.id)
                  }}
                  title="这条有批注（点开看）"
                  aria-label="有批注"
                  className="flex h-[20px] w-[20px] items-center justify-center text-accent/75 transition-colors hover:text-accent"
                >
                  <MessageSquareText size={11} strokeWidth={1.9} />
                </button>
              )}
            </span>
            <span
              className={cn(
                'leading-snug font-semibold',
                st.title,
                dropRoot
                  ? 'text-danger line-through decoration-danger/50'
                  : dropped
                    ? 'text-faint line-through decoration-line-2'
                    : node.done
                      ? 'text-faint line-through decoration-line-2'
                      : 'text-ink',
              )}
            >
              {node.title}
              {dropRoot && (
                <span className="ml-1.5 inline-block shrink-0 rounded-[4px] bg-danger-soft px-1 py-[1px] align-middle text-[9px] font-normal text-danger ring-1 ring-danger/20">
                  不合适
                </span>
              )}
            </span>
          </div>
        </div>
        {!compact && node.purpose && (
          <p
            className={cn(
              'mt-1.5 line-clamp-2 leading-[1.7]',
              dropRoot ? 'text-danger/80' : dropped ? 'text-faint' : 'text-muted',
              st.sub,
            )}
          >
            <RichText text={node.purpose} images={images} />
          </p>
        )}
      </div>

      <button
        draggable={false}
        onDragStart={(e) => e.preventDefault()}
        onClick={(e) => {
          e.stopPropagation()
          void copyText(`#${code}`).then((ok) =>
            toast(ok ? `已复制卡片码 #${code}` : '复制失败：浏览器不给剪贴板权限'),
          )
        }}
        title={`复制卡片码 #${code}（粘给 Agent 指这张卡）`}
        className={cn(
          'absolute -top-[7px] right-2 z-20 flex h-[15px] items-center rounded-full border border-line/70 bg-surface px-1.5',
          'font-mono text-[9.5px] tracking-[0.06em] text-muted shadow-e1',
          'pointer-events-none opacity-0 transition-opacity duration-150',
          'group-hover:pointer-events-auto group-hover:opacity-100 hover:text-ink',
        )}
      >
        #{code}
      </button>

      {childCount > 0 && onToggleCollapse && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            onToggleCollapse()
          }}
          title={collapsed ? '展开子任务' : '收起子任务'}
          className={cn(
            'absolute bottom-1 right-1 flex h-[20px] items-center gap-0.5 rounded-md px-1.5 text-[10px] transition-colors',
            'text-faint opacity-0 hover:bg-surface-3 hover:text-ink group-hover:opacity-100',
            collapsed && 'bg-accent-soft text-accent-ink opacity-100',
          )}
        >
          {collapsed ? <ChevronRight size={10} /> : <ChevronDown size={10} />}
          {collapsed ? `${childCount} 个子任务` : '收起'}
        </button>
      )}

    </div>
  )
})
