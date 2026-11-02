import { useEffect, useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, Check, Link2, Pin, Trash2, X } from 'lucide-react'
import type { ActionNode } from '@/types'
import { childrenOf, actionNodeContext, useActions } from '@/store/actions'

/** 稳定的空数组：selector 里返回新数组会导致无限重渲染 */
const EMPTY_IDS: string[] = []
import { cn } from '@/lib/cn'

/**
 * 节点详情抽屉：具体行动内容（非概括）、目的、子任务、依赖
 * 用户可以在这里加子任务，选串行 / 并行，也可以定到重点。
 */
export function NodeDrawer({
  nodes,
  nodeId,
  onClose,
  onChangeId,
}: {
  nodes: ActionNode[]
  nodeId: string | null
  onClose: () => void
  onChangeId?: (id: string) => void
}) {
  const updateNode = useActions((s) => s.updateNode)
  const activeBoardId = useActions((s) => s.activeBoardId)
  // 注意：这里必须返回**同一个**空数组引用，不能写 `?? []`，
  // 否则每次 getSnapshot 都返回新数组，zustand 会认为状态变了，React 无限重渲染。
  const collapsed = useActions((s) => s.collapsed[activeBoardId ?? ''] ?? EMPTY_IDS)
  const toggleCollapse = useActions((s) => s.toggleCollapse)
  const addNode = useActions((s) => s.addNode)
  const removeNode = useActions((s) => s.removeNode)
  const toggleNode = useActions((s) => s.toggleNode)
  const pinNode = useActions((s) => s.pinNode)
  const moveNode = useActions((s) => s.moveNode)

  const node = useMemo(
    () => nodes.find((n) => n.id === nodeId) ?? null,
    [nodes, nodeId],
  )
  const kids = useMemo(
    () => (node ? childrenOf(nodes, node.id) : []),
    [nodes, node],
  )
  // 位置上下文：箭头多了以后，看不清自己在哪一层。
  // 统一问 store 要，别在这儿再算一遍——两处各算一份，改了一处漏一处。
  const ctx = useMemo(
    () => actionNodeContext(nodes, nodeId ?? ''),
    [nodes, nodeId],
  )
  const parent = ctx.parent ?? null
  const prevOnes = ctx.prev
  const nextOnes = ctx.next
  const parallelOnes = ctx.parallel

  // 「往前挪 / 往后挪」调的是 moveNode，它按整个兄弟数组换位（不分分支），
  // 所以这里要用完整的兄弟列表，跟上面那三个不是一回事
  const siblings = useMemo(
    () => (node ? nodes.filter((n) => n.parentId === node.parentId) : []),
    [nodes, node],
  )
  const sibIdx = siblings.findIndex((n) => n.id === node?.id)

  const [title, setTitle] = useState('')
  const [purpose, setPurpose] = useState('')
  const [detail, setDetail] = useState('')
  const [childTitle, setChildTitle] = useState('')
  const [childPurpose, setChildPurpose] = useState('')
  const [childDetail, setChildDetail] = useState('')
  const [childBranch, setChildBranch] = useState('')
  // 默认串行：往一棵计划里加子任务，绝大多数是「接着上一步做」
  const [childParallel, setChildParallel] = useState(false)
  const [childAtStart, setChildAtStart] = useState(false)

  useEffect(() => {
    if (node) {
      setTitle(node.title)
      setPurpose(node.purpose)
      setDetail(node.detail)
      setChildTitle('')
      setChildPurpose('')
      setChildDetail('')
      // 路线名留空 = 自动：串行沿用父级那条线，并行单独分一条（addNode 里处理）
      setChildBranch('')
    }
  }, [node?.id])

  if (!node) return null

  /** 「确定」：把当前编辑保存下来再关闭（以前只能点 X，隐式保存不直观） */
  const commitEdits = () => {
    if (!node) return
    updateNode(node.id, {
      title: title.trim() || node.title,
      purpose,
      detail,
    })
    onClose()
  }

  const addChild = () => {
    if (!childTitle.trim()) return
    // 如果父节点是折叠的，先展开，不然加了看不见。
    // toggleCollapse(id, boardId) 两个参数别弄反——以前这里传反了，
    // 收起来的那条折叠标记写到了节点 id 名下，父节点根本不会展开。
    if (collapsed.includes(node.id)) toggleCollapse(node.id, activeBoardId ?? undefined)

    /*
      串行：
        - 加在最后 → 前置 = 原来的最后一个子任务
        - 加在最前 → 新任务没有前置，但原来的第一个子任务要改成「前置 = 新任务」
      并行：不接前置，单独占一条路线（branch 留空时 addNode 自动分配「并行N」）
    */
    const prev = childAtStart ? null : kids[kids.length - 1]
    const next = childAtStart ? kids[0] : null
    const newId = addNode({
      title: childTitle.trim(),
      purpose: childPurpose.trim(),
      detail: childDetail.trim(),
      level: node.level + 1,
      parentId: node.id,
      branch: childBranch.trim() || (childParallel ? '' : node.branch || ''),
      parallel: childParallel,
      deps: !childParallel && prev ? [prev.id] : [],
      // 插到原来的第一个子任务前面，列表顺序才是「在最前」
      beforeId: childAtStart && next ? next.id : undefined,
    })
    // 串行 + 加在最前：把原来那个第一个子任务的前置改成新节点。
    // 以前这里写成了 [next.id]，等于让任务依赖自己，图上是条死链。
    if (childAtStart && next && !childParallel) {
      updateNode(next.id, { deps: [newId] })
    }
    setChildTitle('')
    setChildPurpose('')
    setChildDetail('')
  }

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-ink/20 anim-fade-in" onClick={onClose}>
      <aside
        className="anim-drawer-in flex h-full w-[min(420px,92vw)] flex-col border-l border-line bg-surface shadow-[-24px_0_60px_-24px_rgba(23,22,26,.35)]"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex h-[56px] shrink-0 items-center gap-2 border-b border-line/70 px-5">
          <span className="chip">第 {node.level} 层</span>
          <button
            onClick={() => pinNode(node.id, !node.pinned)}
            className={cn(
              'ml-auto flex h-[24px] items-center gap-1 rounded-md px-1.5 text-[11px] transition-colors',
              node.pinned ? 'bg-accent-soft text-accent-ink' : 'text-muted hover:bg-surface-3',
            )}
            title={node.pinned ? '从重点里拿掉' : '定到重点'}
          >
            <Pin size={11} />
            {node.pinned ? '已在重点' : '定到重点'}
          </button>
          <button
            onClick={onClose}
            className="flex h-[24px] w-[24px] items-center justify-center rounded-md text-faint transition-colors hover:bg-surface-3 hover:text-ink"
          >
            <X size={14} />
          </button>
        </header>

        <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
          {/* 任何节点都有「它在哪」：顶层目标也要写清楚没有父级，别留白 */}
          <div className="rounded-lg border border-line bg-surface-2 p-2.5">
              <div className="label mb-1.5">它在哪</div>
              <div className="space-y-1">
                <div className="flex items-start gap-1.5 text-[11px]">
                  <span className="w-[52px] shrink-0 text-faint">父级任务</span>
                  {parent ? (
                    <button
                      onClick={() => onChangeId?.(parent.id)}
                      className="min-w-0 flex-1 truncate text-left text-ink-2 transition-colors hover:text-accent"
                    >
                      {parent.title}
                    </button>
                  ) : (
                    <span className="min-w-0 flex-1 text-faint">无 · 这是顶层目标</span>
                  )}
                </div>
                {prevOnes.length > 0 && (
                  <div className="flex items-start gap-1.5 text-[11px]">
                    <span className="w-[52px] shrink-0 text-faint">上一步</span>
                    <span className="flex min-w-0 flex-1 flex-wrap gap-x-1.5">
                      {prevOnes.map((n) => (
                        <button
                          key={n.id}
                          onClick={() => onChangeId?.(n.id)}
                          className="truncate text-ink-2 transition-colors hover:text-accent"
                        >
                          {n.title}
                        </button>
                      ))}
                    </span>
                  </div>
                )}
                {nextOnes.length > 0 && (
                  <div className="flex items-start gap-1.5 text-[11px]">
                    <span className="w-[52px] shrink-0 text-faint">下一步</span>
                    <span className="flex min-w-0 flex-1 flex-wrap gap-x-1.5">
                      {nextOnes.map((n) => (
                        <button
                          key={n.id}
                          onClick={() => onChangeId?.(n.id)}
                          className="truncate text-ink-2 transition-colors hover:text-accent"
                        >
                          {n.title}
                        </button>
                      ))}
                    </span>
                  </div>
                )}
                {parallelOnes.length > 0 && (
                  <div className="flex items-start gap-1.5 text-[11px]">
                    <span className="w-[52px] shrink-0 text-faint">同层并行</span>
                    <span className="flex min-w-0 flex-1 flex-wrap gap-x-1.5">
                      {parallelOnes.map((n) => (
                        <button
                          key={n.id}
                          onClick={() => onChangeId?.(n.id)}
                          className="truncate text-ink-2 transition-colors hover:text-accent"
                        >
                          {n.title}
                        </button>
                      ))}
                    </span>
                  </div>
                )}
              </div>
            </div>

          <div>
            <label className="label">任务</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={() => updateNode(node.id, { title: title.trim() || node.title })}
              onKeyDown={(e) => {
                // 回车就直接保存并关掉抽屉（输入法组字时的回车不算）
                if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                  e.preventDefault()
                  commitEdits()
                }
              }}
              className="field mt-1"
            />
          </div>

          <div>
            <label className="label">行动目标和目的</label>
            <textarea
              value={purpose}
              onChange={(e) => setPurpose(e.target.value)}
              onBlur={() => updateNode(node.id, { purpose })}
              rows={2}
              placeholder="这一块是为了什么"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault()
                  commitEdits()
                }
              }}
              className="field mt-1 resize-none text-[12px] leading-[1.7]"
            />
          </div>

          <div>
            <label className="label">具体怎么做</label>
            <textarea
              value={detail}
              onChange={(e) => setDetail(e.target.value)}
              onBlur={() => updateNode(node.id, { detail })}
              rows={5}
              placeholder="具体动作、交付物、验收标准"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault()
                  commitEdits()
                }
              }}
              className="field mt-1 resize-none text-[12px] leading-[1.75]"
            />
          </div>

          {node.deps.length > 0 && (
            <div className="flex items-start gap-1.5 rounded-lg bg-surface-2 px-2.5 py-1.5 text-[11px] text-muted">
              <Link2 size={11} className="mt-[2px] shrink-0" />
              <span>
                前置：
                {node.deps
                  .map((d) => nodes.find((n) => n.id === d)?.title ?? d)
                  .join('、')}
              </span>
            </div>
          )}

          <div>
            <label className="label">子任务（{kids.length}）</label>
            <div className="mt-1 space-y-1">
              {kids.map((k) => (
                <div
                  key={k.id}
                  className="group flex items-center gap-2 rounded-lg border border-line px-2 py-1.5"
                >
                  <button
                    onClick={() => toggleNode(k.id)}
                    className={cn(
                      'flex h-[13px] w-[13px] shrink-0 items-center justify-center rounded-[3px] border',
                      k.done ? 'border-ok bg-ok text-white' : 'border-line-2',
                    )}
                  >
                    {k.done && <Check size={8} strokeWidth={3} />}
                  </button>
                  <span className="min-w-0 flex-1 truncate text-[12px] text-ink-2">{k.title}</span>
                  <button
                    onClick={() => removeNode(k.id)}
                    className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded text-faint opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 hover:bg-danger-soft hover:text-danger"
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              ))}
              {!kids.length && (
                <p className="px-1 py-1 text-[11px] text-faint">还没有子任务</p>
              )}
            </div>

            <div className="mt-2 space-y-1.5 rounded-lg border border-dashed border-line-2 p-2">
              <input
                value={childTitle}
                onChange={(e) => setChildTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                    e.preventDefault()
                    addChild()
                  }
                }}
                placeholder="子任务标题（回车直接添加）"
                className="field h-8 text-[12px]"
              />
              <input
                value={childPurpose}
                onChange={(e) => setChildPurpose(e.target.value)}
                placeholder="目的（选填：为什么要做这个）"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault()
                    addChild()
                  }
                }}
                className="field h-8 text-[11.5px]"
              />
              <textarea
                value={childDetail}
                onChange={(e) => setChildDetail(e.target.value)}
                rows={2}
                placeholder="具体怎么做（选填：动作、产出物、怎么算完成）"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault()
                    addChild()
                  }
                }}
                className="field resize-none text-[11.5px] leading-[1.6]"
              />
              <div className="flex flex-wrap items-center gap-1.5">
                <input
                  value={childBranch}
                  onChange={(e) => setChildBranch(e.target.value)}
                  placeholder="路线名（可空）"
                  className="field h-7 w-[104px] px-2 py-0 text-[11px]"
                />
                <button
                  onClick={() => setChildParallel(!childParallel)}
                  className={cn(
                    'rounded-md border px-1.5 py-[2px] text-[11px] transition-colors',
                    childParallel
                      ? 'border-accent-line bg-accent-soft text-accent-ink'
                      : 'border-line text-muted hover:bg-surface-3',
                  )}
                >
                  {childParallel ? '并行' : '串行'}
                </button>
                <button
                  onClick={() => setChildAtStart(!childAtStart)}
                  className={cn(
                    'rounded-md border px-1.5 py-[2px] text-[11px] transition-colors',
                    childAtStart
                      ? 'border-accent-line bg-accent-soft text-accent-ink'
                      : 'border-line text-muted hover:bg-surface-3',
                  )}
                >
                  {childAtStart ? '加在最前' : '加在最后'}
                </button>
                <button
                  onClick={addChild}
                  disabled={!childTitle.trim()}
                  className="ml-auto rounded-md bg-ink px-2.5 py-[3px] text-[11px] text-white transition-opacity hover:opacity-85 disabled:opacity-30"
                >
                  添加（⌘↩）
                </button>
              </div>
            </div>
          </div>
        </div>

        <footer className="flex shrink-0 items-center gap-1.5 border-t border-line px-4 py-2.5">
          <button
            onClick={() => moveNode(node.id, -1)}
            disabled={sibIdx <= 0}
            className="flex h-[24px] w-[24px] items-center justify-center rounded-md text-muted transition-colors hover:bg-surface-3 disabled:opacity-30"
            title="往前挪"
          >
            <ArrowUp size={12} />
          </button>
          <button
            onClick={() => moveNode(node.id, 1)}
            disabled={sibIdx < 0 || sibIdx >= siblings.length - 1}
            className="flex h-[24px] w-[24px] items-center justify-center rounded-md text-muted transition-colors hover:bg-surface-3 disabled:opacity-30"
            title="往后挪"
          >
            <ArrowDown size={12} />
          </button>
          <button
            onClick={() => {
              removeNode(node.id)
              onClose()
            }}
            className="ml-auto flex h-[24px] items-center gap-1 rounded-md px-2 text-[11px] text-muted transition-colors hover:bg-danger-soft hover:text-danger"
          >
            <Trash2 size={12} />
            删掉这个
          </button>
          <span className="shrink-0 text-[10px] text-faint">回车 / ⌘回车 保存</span>
          <button
            onClick={commitEdits}
            className="flex h-[26px] items-center gap-1 rounded-[8px] bg-ink px-3 text-[12px] font-medium text-white transition-opacity hover:opacity-90"
          >
            <Check size={12} strokeWidth={2.4} />
            确定
          </button>
        </footer>
      </aside>
    </div>
  )
}
