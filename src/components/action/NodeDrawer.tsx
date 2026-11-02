import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, Check, Link2, Pin, Trash2, Unlink, X } from 'lucide-react'
import type { ActionNode } from '@/types'
import { childrenOf, actionNodeContext, useActions } from '@/store/actions'
import { useUi } from '@/store/ui'

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
  const detachNode = useActions((s) => s.detachNode)
  const deleteNode = useActions((s) => s.deleteNode)
  const reorderChild = useActions((s) => s.reorderChild)
  const toggleNode = useActions((s) => s.toggleNode)
  const pinNode = useActions((s) => s.pinNode)
  const moveNode = useActions((s) => s.moveNode)
  const toast = useUi((s) => s.showToast)

  const node = useMemo(
    () => nodes.find((n) => n.id === nodeId) ?? null,
    [nodes, nodeId],
  )
  const kids = useMemo(
    () => (node ? childrenOf(nodes, node.id) : []),
    [nodes, node],
  )
  // 子任务按 branch 分组：同一 branch = 一条串行线，抽屉里用框分开，跟路线图对齐
  const kidGroups = useMemo(() => {
    const map = new Map<string, ActionNode[]>()
    for (const k of kids) {
      const key = k.branch || ''
      const arr = map.get(key)
      if (arr) arr.push(k)
      else map.set(key, [k])
    }
    return [...map.values()]
  }, [kids])

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
  /** 其他备注：纯记录用，不参与任务/依赖逻辑 */
  const [notes, setNotes] = useState('')
  const [childTitle, setChildTitle] = useState('')
  const [childPurpose, setChildPurpose] = useState('')
  const [childDetail, setChildDetail] = useState('')
  const [childBranch, setChildBranch] = useState('')
  // 默认串行：往一棵计划里加子任务，绝大多数是「接着上一步做」
  const [childParallel, setChildParallel] = useState(false)
  const [childAtStart, setChildAtStart] = useState(false)
  /** 右键子任务弹出的菜单：位置 + 目标节点 */
  const [menu, setMenu] = useState<{ nodeId: string; x: number; y: number } | null>(null)
  /** 抽屉里点选中的子任务：串行新增会接在它的后面（相当于「延长这一串」） */
  const [selectedChildId, setSelectedChildId] = useState<string | null>(null)
  /** 底部「删掉这个」的两种删法弹层 */
  const [delMenu, setDelMenu] = useState(false)
  /** 抽屉里拖拽调整子任务顺序 / 并入别的分线 */
  const [dragChildId, setDragChildId] = useState<string | null>(null)
  const [dropHint, setDropHint] = useState<{ id: string; pos: 'before' | 'after' } | null>(null)

  /*
    子任务草稿：在「子任务标题 / 目的 / 具体怎么做」里打了字、但没点添加就关抽屉，
    以前会直接丢掉（重开抽屉时这些 state 被清空）。现在按「路线 + 父节点」存到
    localStorage，重开/刷新后自动恢复，成功添加后清掉。
  */
  type ChildDraft = {
    title: string
    purpose: string
    detail: string
    branch: string
    parallel: boolean
    atStart: boolean
    selectedChildId: string | null
  }
  const draftKey = node ? `work-route-child-draft:${activeBoardId ?? 'none'}:${node.id}` : null
  /** 当前草稿已经为哪个节点载入过：防止切换节点时把上一个节点的值写进新节点的草稿 */
  const draftLoadedFor = useRef<string | null>(null)
  const readDraft = (): ChildDraft | null => {
    if (!draftKey) return null
    try {
      const raw = localStorage.getItem(draftKey)
      return raw ? (JSON.parse(raw) as ChildDraft) : null
    } catch {
      return null
    }
  }
  const writeDraft = (d: ChildDraft) => {
    if (!draftKey) return
    try {
      localStorage.setItem(draftKey, JSON.stringify(d))
    } catch {}
  }
  const clearDraft = () => {
    if (!draftKey) return
    try {
      localStorage.removeItem(draftKey)
    } catch {}
  }

  // 默认选中最上面的子任务；选中的被删/换父节点时也回落到最上面那条。
  // 这样「串行」永远有一个明确的落点，不用先手动点一下。
  useEffect(() => {
    if (!kids.length) {
      setSelectedChildId(null)
      return
    }
    if (!selectedChildId || !kids.some((k) => k.id === selectedChildId)) {
      setSelectedChildId(kids[0].id)
    }
  }, [kids, selectedChildId])


  useEffect(() => {
    if (!node) return
    setTitle(node.title)
    setPurpose(node.purpose)
    setDetail(node.detail)
    setNotes(node.notes ?? '')
    // 路线名留空 = 自动：串行沿用父级那条线，并行单独分一条（addNode 里处理）
    const draft = readDraft()
    if (draft && (draft.title || draft.purpose || draft.detail || draft.branch)) {
      setChildTitle(draft.title ?? '')
      setChildPurpose(draft.purpose ?? '')
      setChildDetail(draft.detail ?? '')
      setChildBranch(draft.branch ?? '')
      setChildParallel(!!draft.parallel)
      setChildAtStart(!!draft.atStart)
      setSelectedChildId(draft.selectedChildId ?? null)
      toast('已恢复上次没提交的子任务草稿')
    } else {
      setChildTitle('')
      setChildPurpose('')
      setChildDetail('')
      setChildBranch('')
      setChildParallel(false)
      setChildAtStart(false)
    }
    draftLoadedFor.current = node.id
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node?.id])

  // 子任务草稿随输入实时存（空草稿就删掉）
  useEffect(() => {
    if (!node || draftLoadedFor.current !== node.id) return
    const draft: ChildDraft = {
      title: childTitle,
      purpose: childPurpose,
      detail: childDetail,
      branch: childBranch,
      parallel: childParallel,
      atStart: childAtStart,
      selectedChildId,
    }
    const empty =
      !draft.title && !draft.purpose && !draft.detail && !draft.branch && !draft.parallel && !draft.atStart
    if (empty) clearDraft()
    else writeDraft(draft)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    childTitle,
    childPurpose,
    childDetail,
    childBranch,
    childParallel,
    childAtStart,
    selectedChildId,
    node?.id,
  ])

  if (!node) return null

  /**
   * 新加的子任务经常落在抽屉盖住的那块，用户会以为没创建成功。
   * 这里把它滚进「抽屉左侧可见区」并闪一下，给个明确反馈。
   */
  const revealNode = (id: string) => {
    window.setTimeout(() => {
      const el = document.querySelector<HTMLElement>(`[data-node-id="${id}"]`)
      if (!el) return
      // 先保证纵向在视野里（页面自身是纵向滚动的）
      el.scrollIntoView({ block: 'nearest', inline: 'nearest' })
      const scroller = el.closest<HTMLElement>('.overflow-x-auto')
      if (scroller) {
        const er = el.getBoundingClientRect()
        const sr = scroller.getBoundingClientRect()
        const drawer = document.querySelector('div.fixed.inset-0.z-40 aside')?.getBoundingClientRect()
        const rightLimit = Math.min(sr.right, drawer ? drawer.left : sr.right) - 20
        const leftLimit = Math.max(sr.left, 0) + 20
        if (er.right > rightLimit) scroller.scrollBy({ left: er.right - rightLimit, behavior: 'smooth' })
        else if (er.left < leftLimit) scroller.scrollBy({ left: er.left - leftLimit, behavior: 'smooth' })
      }
      // 高亮一下（1200ms 后自己消失）
      el.animate?.(
        [
          { boxShadow: '0 0 0 2px rgba(76,65,210,.6)', borderRadius: '14px' },
          { boxShadow: '0 0 0 2px rgba(76,65,210,0)', borderRadius: '14px' },
        ],
        { duration: 1200, easing: 'ease-out' },
      )
    }, 80)
  }

  /** 关抽屉（X / 点遮罩）：先把主字段落库，别指望 onBlur 一定跑过 */
  const closeDrawer = () => {
    if (node) {
      updateNode(node.id, {
        title: title.trim() || node.title,
        purpose,
        detail,
        notes: notes.trim(),
      })
    }
    onClose()
  }

  /**
   * 「确定」：把当前编辑保存下来再关闭。
   * 如果子任务输入框里还有没提交的内容，**先创建再关**——
   * 否则用户打了子任务标题直接点「确定」，那条就被静默丢掉了（lwk 踩到过）。
   */
  const commitEdits = () => {
    if (!node) return
    if (childTitle.trim()) addChild()
    updateNode(node.id, {
      title: title.trim() || node.title,
      purpose,
      detail,
      notes: notes.trim(),
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
      串行怎么接，取决于抽屉里「点选了哪个子任务」：
        - 选中了某个任务 → 串行就接在它那一条链上（延长这一串）
          · 加在最后 → 接在它后面（如果它后面还有一步，那一步的前置改接到新任务）
          · 加在最前 → 新任务成为这一串的第一步（原来的选中任务前置改成新任务）
        - 没选中 → 接在「同一个 branch 串」的最后一步后面（老行为，但修掉了
          以前把「所有子任务里最后一条」当上一跳、跨到别的串上的问题）
      并行：不接前置，单独占一条线（branch 留空时 addNode 自动分配「并行N」）
    */
    const base = {
      title: childTitle.trim(),
      purpose: childPurpose.trim(),
      detail: childDetail.trim(),
      level: node.level + 1,
      parentId: node.id,
    }
    const selected = kids.find((k) => k.id === selectedChildId) ?? null
    let newId: string

    if (childParallel) {
      newId = addNode({ ...base, branch: childBranch.trim(), parallel: true, deps: [] })
    } else if (selected) {
      const branch = childBranch.trim() || selected.branch || node.branch || ''
      const mates = kids.filter((k) => (k.branch || '') === (selected.branch || ''))
      const at = mates.findIndex((k) => k.id === selected.id)
      const next = at >= 0 ? (mates[at + 1] ?? null) : null
      if (childAtStart) {
        // 插到选中任务前面：如果它前面还有一步，新任务接那一步，再把选中任务的前置改成新任务
        const prevMate = at > 0 ? mates[at - 1] : null
        newId = addNode({
          ...base,
          branch,
          parallel: false,
          deps: prevMate ? [prevMate.id] : [],
          beforeId: selected.id,
        })
        updateNode(selected.id, { deps: [newId] })
      } else {
        newId = addNode({
          ...base,
          branch,
          parallel: false,
          deps: [selected.id],
          beforeId: next ? next.id : undefined,
        })
        if (next) updateNode(next.id, { deps: [newId] })
      }
    } else {
      const branch = childBranch.trim() || node.branch || ''
      const mates = kids.filter((k) => (k.branch || '') === branch)
      if (childAtStart) {
        const first = mates[0] ?? null
        newId = addNode({
          ...base,
          branch,
          parallel: false,
          deps: [],
          beforeId: first ? first.id : undefined,
        })
        if (first) updateNode(first.id, { deps: [newId] })
      } else {
        const prev = mates[mates.length - 1] ?? null
        newId = addNode({ ...base, branch, parallel: false, deps: prev ? [prev.id] : [] })
      }
    }

    setChildTitle('')
    setChildPurpose('')
    setChildDetail('')
    clearDraft()
    // 选中新任务：连续添加时就自然往后延长这一串
    setSelectedChildId(newId)
    toast(`已添加子任务：${childTitle.trim()}`)
    revealNode(newId)
  }

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-ink/20 anim-fade-in" onClick={closeDrawer}>
      {menu &&
        (() => {
          const target = kids.find((k) => k.id === menu.nodeId)
          const group = kidGroups.find((g) => g.some((k) => k.id === menu.nodeId))
          const lone = !group || group.length <= 1
          const x = Math.min(menu.x, window.innerWidth - 236)
          const y = Math.min(menu.y, window.innerHeight - 150)
          return (
            <>
              <div
                className="fixed inset-0 z-40"
                onClick={(e) => {
                  e.stopPropagation()
                  setMenu(null)
                }}
                onContextMenu={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  setMenu(null)
                }}
              />
              <div
                className="fixed z-50 w-[220px] overflow-hidden rounded-[14px] border border-line/70 bg-surface p-1.5 shadow-e3 anim-pop"
                style={{ left: x, top: y }}
                onClick={(e) => e.stopPropagation()}
                onContextMenu={(e) => e.preventDefault()}
              >
                <div className="truncate px-2 pt-1 pb-1.5 text-[10.5px] text-faint">{target?.title}</div>
                <button
                  onClick={() => {
                    if (!target || lone) return
                    detachNode(target.id)
                    toast(`「${target.title}」已独立成一条线`)
                    revealNode(target.id)
                    setMenu(null)
                  }}
                  disabled={lone}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12px] text-ink-2 transition-colors hover:bg-surface-3 disabled:cursor-not-allowed disabled:text-faint"
                >
                  <Unlink size={12} className="shrink-0" />
                  独立成一条线
                </button>
                <p className="px-2 pt-1 pb-1.5 text-[10px] leading-relaxed text-faint">
                  {lone ? '它已经不在串行链上' : '不再串在前面的任务后面，单独从父任务引一条线'}
                </p>
                <div className="my-1 h-px bg-line/70" />
                <button
                  onClick={() => {
                    if (!target) return
                    deleteNode(target.id, 'only')
                    toast(`已删掉「${target.title}」，后面一步接回前一步`)
                    setMenu(null)
                  }}
                  className="flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left text-[12px] text-ink-2 transition-colors hover:bg-danger-soft hover:text-danger"
                >
                  <Trash2 size={12} className="mt-[3px] shrink-0" />
                  <span>
                    删掉这条（子任务一起删）
                    <span className="mt-0.5 block text-[10px] leading-snug text-faint">
                      后面那一步会自动接回它的前一步
                    </span>
                  </span>
                </button>
                <button
                  onClick={() => {
                    if (!target) return
                    deleteNode(target.id, 'cascade')
                    toast(`已删掉「${target.title}」和后面整串`)
                    setMenu(null)
                  }}
                  className="flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left text-[12px] text-ink-2 transition-colors hover:bg-danger-soft hover:text-danger"
                >
                  <Trash2 size={12} className="mt-[3px] shrink-0" />
                  <span>
                    删掉这条和后面整串
                    <span className="mt-0.5 block text-[10px] leading-snug text-faint">
                      这一条后面的步骤不会保留
                    </span>
                  </span>
                </button>
              </div>
            </>
          )
        })()}
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
            title={node.pinned ? '从重点里拿掉（连同三层内的子任务）' : '定到重点（连同三层内的子任务）'}
          >
            <Pin size={11} />
            {node.pinned ? '已在重点' : '定到重点'}
          </button>
          <button
            onClick={closeDrawer}
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

          <div>
            <label className="label">其他备注</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              onBlur={() => updateNode(node.id, { notes: notes.trim() })}
              rows={3}
              placeholder="选填：想到什么记什么，不会被当成任务执行"
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
            <div className="flex items-baseline justify-between">
              <label className="label">子任务（{kids.length}）</label>
              <span className="max-w-[62%] truncate text-[10px] text-faint">
                {(() => {
                  if (childParallel) return '并行：会单独起一条线，不接在选中任务后面'
                  const sel = kids.find((k) => k.id === selectedChildId)
                  return sel
                    ? `已选中「${sel.title}」· 串行接在它后面`
                    : '拖动可调整顺序/并入别的分线 · 右键可独立成线'
                })()}
              </span>
            </div>
            <div className="mt-1 space-y-1.5">
              {kidGroups.map((group) => (
                // 一组 = 路线图里同一行的那一串串行任务；框起来才分得清哪几条是一串
                <div
                  key={group[0].id}
                  className="rounded-lg border border-line/80 bg-surface-2/60 p-1"
                >
                  {group.map((k) => (
                    <div
                      key={k.id}
                      draggable
                      onDragStart={(e) => {
                        setDragChildId(k.id)
                        e.dataTransfer.setData('application/x-child-node', k.id)
                        e.dataTransfer.effectAllowed = 'move'
                      }}
                      onDragEnd={() => {
                        setDragChildId(null)
                        setDropHint(null)
                      }}
                      onDragOver={(e) => {
                        if (!dragChildId || dragChildId === k.id) return
                        e.preventDefault()
                        e.stopPropagation()
                        e.dataTransfer.dropEffect = 'move'
                        const r = e.currentTarget.getBoundingClientRect()
                        const pos = e.clientY < r.top + r.height / 2 ? 'before' : 'after'
                        setDropHint({ id: k.id, pos })
                      }}
                      onDragLeave={() =>
                        setDropHint((cur) => (cur?.id === k.id ? null : cur))
                      }
                      onDrop={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        const from =
                          e.dataTransfer.getData('application/x-child-node') || dragChildId
                        const pos = dropHint?.id === k.id ? dropHint.pos : 'after'
                        setDragChildId(null)
                        setDropHint(null)
                        if (!from || from === k.id) return
                        reorderChild(from, k.id, pos)
                        toast('顺序已调整')
                      }}
                      onClick={() => setSelectedChildId(k.id)}
                      onContextMenu={(e) => {
                        // mac 触控板双指按压 = contextmenu：打开「独立成线」菜单
                        e.preventDefault()
                        e.stopPropagation()
                        setMenu({ nodeId: k.id, x: e.clientX, y: e.clientY })
                      }}
                      style={
                        dropHint?.id === k.id
                          ? {
                              boxShadow:
                                dropHint.pos === 'before'
                                  ? 'inset 0 2px 0 #7c6cf0'
                                  : 'inset 0 -2px 0 #7c6cf0',
                            }
                          : undefined
                      }
                      className={cn(
                        'group flex cursor-grab items-center gap-2 rounded-md px-1.5 py-1.5 transition-colors active:cursor-grabbing',
                        dragChildId === k.id && 'opacity-40',
                        // 选中高亮只属于串行模式：并行是单独一条线，不接在谁后面
                        selectedChildId === k.id && !childParallel
                          ? 'bg-accent-soft/70 ring-1 ring-accent-line'
                          : 'hover:bg-surface-3/70',
                      )}
                    >
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          toggleNode(k.id)
                        }}
                        className={cn(
                          'flex h-[13px] w-[13px] shrink-0 items-center justify-center rounded-[3px] border',
                          k.done ? 'border-ok bg-ok text-white' : 'border-line-2',
                        )}
                      >
                        {k.done && <Check size={8} strokeWidth={3} />}
                      </button>
                      <span className="min-w-0 flex-1 truncate text-[12px] text-ink-2">{k.title}</span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          deleteNode(k.id, 'only')
                          toast(`已删掉「${k.title}」，后面一步自动接回前一步`)
                        }}
                        className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded text-faint opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 hover:bg-danger-soft hover:text-danger"
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>
                  ))}
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

        <footer className="relative flex shrink-0 items-center gap-1.5 border-t border-line px-4 py-2.5">
          {delMenu && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setDelMenu(false)} />
              <div className="absolute right-2 bottom-[50px] z-20 w-[286px] overflow-hidden rounded-[14px] border border-line/70 bg-surface p-1.5 shadow-e3 anim-pop">
                <button
                  onClick={() => {
                    setDelMenu(false)
                    deleteNode(node.id, 'only')
                    toast('已删掉，后面一步接回前一步')
                    onClose()
                  }}
                  className="flex w-full items-start gap-2 rounded-lg px-2 py-2 text-left text-[12px] text-ink-2 transition-colors hover:bg-surface-3"
                >
                  <Trash2 size={12} className="mt-[3px] shrink-0" />
                  <span>
                    只删这条（子任务一起删）
                    <span className="mt-0.5 block text-[10px] leading-snug text-faint">
                      后面那一步会自动接回它的前一步
                    </span>
                  </span>
                </button>
                <button
                  onClick={() => {
                    setDelMenu(false)
                    deleteNode(node.id, 'cascade')
                    toast('已连后面整串一起删掉')
                    onClose()
                  }}
                  className="flex w-full items-start gap-2 rounded-lg px-2 py-2 text-left text-[12px] text-ink-2 transition-colors hover:bg-danger-soft hover:text-danger"
                >
                  <Trash2 size={12} className="mt-[3px] shrink-0" />
                  <span>
                    删掉它和后面整串
                    <span className="mt-0.5 block text-[10px] leading-snug text-faint">
                      这条及后面所有步骤、子任务一起删
                    </span>
                  </span>
                </button>
              </div>
            </>
          )}
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
            onClick={() => setDelMenu((v) => !v)}
            className={cn(
              'ml-auto flex h-[24px] items-center gap-1 rounded-md px-2 text-[11px] transition-colors',
              delMenu ? 'bg-danger-soft text-danger' : 'text-muted hover:bg-danger-soft hover:text-danger',
            )}
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
