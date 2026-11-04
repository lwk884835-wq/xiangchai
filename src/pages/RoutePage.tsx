import { useEffect, useMemo, useRef, useState } from 'react'
import type { ActionNode } from '@/types'
import { ChevronDown, ChevronUp, Redo2, Search, Undo2 } from 'lucide-react'
import { actionProgress, useActions } from '@/store/actions'
import { ACTION_SEED } from '@/data/actionSeed'
import { useUi } from '@/store/ui'
import { cn } from '@/lib/cn'
import { RouteMark } from '@/components/RouteMark'
import { FocusList } from '@/components/action/FocusList'
import { RouteBoard } from '@/components/action/RouteBoard'
import { NodeDrawer } from '@/components/action/NodeDrawer'
import { BoardList } from '@/components/action/BoardList'

function dateLine() {
  const now = new Date()
  const weekday = '日一二三四五六'[now.getDay()]
  return `${now.getMonth() + 1} 月 ${now.getDate()} 日 · 周${weekday}`
}

/**
 * 想拆首页：一条能长期看下去的行动路线。
 *
 * 左边是重点清单 + 路线图，右边是这份路线/其它计划的切换栏。
 * 没有 Agent、没有后台：所有交互都是本地的。
 */
export function RoutePage({
  agentOpen,
  flying,
  onToggleAgent,
}: {
  agentOpen: boolean
  /** 标正在飞：顶部按钮里的图标先藏起来，让飞行体独占 */
  flying: boolean
  onToggleAgent: () => void
}) {
  const boards = useActions((s) => s.boards)
  const activeId = useActions((s) => s.activeBoardId)
  const collapsedMap = useActions((s) => s.collapsed)
  const addBoard = useActions((s) => s.addBoard)
  const addNode = useActions((s) => s.addNode)
  const toggleNode = useActions((s) => s.toggleNode)
  const pinNode = useActions((s) => s.pinNode)
  const setActiveBoard = useActions((s) => s.setActiveBoard)
  const toggleCollapse = useActions((s) => s.toggleCollapse)
  const history = useActions((s) => s.history)
  const undo = useActions((s) => s.undo)
  const redoHistory = useActions((s) => s.redoHistory)
  const redo = useActions((s) => s.redo)
  const toast = useUi((s) => s.showToast)
  const [openId, setOpenId] = useState<string | null>(null)
  /** 面板内搜索：找卡片 → 自动滚过去并闪一下 */
  const [search, setSearch] = useState('')
  const [matchIdx, setMatchIdx] = useState(0)
  const [highlightNonce, setHighlightNonce] = useState(0)
  const contentRef = useRef<HTMLDivElement>(null)
  const focusWrapRef = useRef<HTMLDivElement>(null)

  // 第一次进来给一份示例，避免空屏；节点 id 会变，所以要维护旧 id → 新 id 的映射
  useEffect(() => {
    if (useActions.getState().boards.length) return
    addBoard({
      jobTitle: ACTION_SEED.jobTitle,
      jobCity: ACTION_SEED.jobCity,
      label: ACTION_SEED.label,
    })
    const bid = useActions.getState().activeBoardId
    if (!bid) return
    const idMap = new Map<string, string>()
    for (const n of ACTION_SEED.nodes) {
      const newId = addNode(
        {
          title: n.title,
          purpose: n.purpose,
          detail: n.detail,
          level: n.level,
          parentId: n.parentId ? (idMap.get(n.parentId) ?? null) : null,
          branch: n.branch,
          deps: n.deps.map((d) => idMap.get(d) ?? d),
          parallel: n.parallel,
          done: n.done,
          pinned: n.pinned,
        },
        bid,
      )
      idMap.set(n.id, newId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const board = boards.find((b) => b.id === activeId) ?? null
  const nodes = board?.nodes ?? []
  const collapsed = board ? (collapsedMap[board.id] ?? []) : []
  const progress = actionProgress(nodes)

  const addGoal = () => {
    const id = addNode({
      title: '新目标',
      purpose: '',
      detail: '',
      level: 1,
      parentId: null,
      pinned: true,
    })
    setOpenId(id)
  }

  /*
    链接路线 = 在当天路线里实时展开另一条路线。
    链接节点本身**不渲染**：它只当一个锚点，把被链接路线的根卡按「普通粘贴过来的卡」
    直接投影到锚点原来的位置（蓝色描边表示是链接的），子任务照常展开、实时同步。
  */
  const { viewNodes, linkedIds, foreignIds, owners, foreignAnchors } = useMemo(() => {
    const views: ActionNode[] = []
    const linked = new Set<string>()
    const foreign = new Set<string>()
    const ownerMap = new Map<string, { boardId: string; origId: string }>()
    const anchorMap = new Map<string, string>()
    if (!board) {
      return {
        viewNodes: views,
        linkedIds: linked,
        foreignIds: foreign,
        owners: ownerMap,
        foreignAnchors: anchorMap,
      }
    }
    for (const n of board.nodes) {
      if (!n.linkBoardId) {
        views.push(n)
        ownerMap.set(n.id, { boardId: board.id, origId: n.id })
        continue
      }
      // 链接锚点：不画它自己，直接把被链接路线的树投影到它的位置
      const lb = boards.find((b) => b.id === n.linkBoardId)
      if (!lb) continue
      const roots = lb.nodes.filter((x) => !x.parentId)
      if (!roots.length) continue
      const delta = n.level - (roots[0]?.level ?? 1)
      const mapId = (id: string) => `lv-${n.id}-${id}`
      for (const orig of lb.nodes) {
        const isRoot = !orig.parentId
        const clone: ActionNode = {
          ...orig,
          id: mapId(orig.id),
          parentId: isRoot ? n.parentId : mapId(orig.parentId as string),
          level: Math.max(1, orig.level + delta),
          branch: isRoot ? n.branch || '' : orig.branch || '',
          deps: orig.deps.map((d) => mapId(d)),
          linkBoardId: undefined,
        }
        views.push(clone)
        linked.add(clone.id)
        foreign.add(clone.id)
        ownerMap.set(clone.id, { boardId: lb.id, origId: orig.id })
        anchorMap.set(clone.id, n.id)
      }
    }
    return {
      viewNodes: views,
      linkedIds: linked,
      foreignIds: foreign,
      owners: ownerMap,
      foreignAnchors: anchorMap,
    }
  }, [board, boards])

  const searchQ = search.trim().toLowerCase()
  const matches = useMemo(() => {
    if (!searchQ) return [] as ActionNode[]
    return viewNodes.filter((n) =>
      [n.title, n.purpose, n.detail, n.notes].join(' ').toLowerCase().includes(searchQ),
    )
  }, [searchQ, viewNodes])

  useEffect(() => {
    if (!searchQ) return
    setMatchIdx(0)
    if (matches.length) setHighlightNonce((n) => n + 1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQ])

  const stepMatch = (dir: 1 | -1) => {
    if (!matches.length) return
    const next = (matchIdx + dir + matches.length) % matches.length
    setMatchIdx(next)
    setHighlightNonce((n) => n + 1)
  }

  const highlight = matches.length
    ? { id: matches[Math.min(matchIdx, matches.length - 1)].id, nonce: highlightNonce }
    : undefined

  const openView = (id: string) => {
    const owner = owners.get(id)
    if (owner) {
      setActiveBoard(owner.boardId)
      setOpenId(owner.origId)
    } else setOpenId(id)
  }
  const toggleView = (id: string) => {
    const owner = owners.get(id)
    if (owner) toggleNode(owner.origId, owner.boardId)
    else toggleNode(id)
  }
  const pinView = (id: string, pinned: boolean) => {
    /*
      钉/取消钉会改变顶部「重点」清单的高度。只恢复 scrollTop 不够——
      清单变高以后，路线整体会被顶下去。要把「清单高度变化量」补进 scrollTop，
      路线这一块在屏幕上才原地不动。
    */
    const scroller = contentRef.current
    const beforeTop = scroller?.scrollTop ?? 0
    const beforeH = focusWrapRef.current?.offsetHeight ?? 0
    const owner = owners.get(id)
    if (owner) pinNode(owner.origId, pinned, owner.boardId)
    else pinNode(id, pinned)
    const fix = () => {
      if (!scroller) return
      const afterH = focusWrapRef.current?.offsetHeight ?? beforeH
      scroller.scrollTop = beforeTop + (afterH - beforeH)
    }
    requestAnimationFrame(() => {
      fix()
      requestAnimationFrame(fix)
    })
  }

  const subtitle = [dateLine(), board?.jobTitle ?? '', board?.jobCity ?? '', board?.label ?? '']
    .filter(Boolean)
    .join(' · ')

  return (
    <div className="flex h-full overflow-hidden">
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex h-[56px] shrink-0 items-center gap-2.5 border-b border-line/80 px-5 xl:gap-3">
          <div className="min-w-0 shrink">
            <h1 className="truncate text-[17px] leading-tight font-semibold tracking-[-0.015em]">
              想拆
            </h1>
            <p className="truncate text-[12px] leading-tight text-faint" title={subtitle}>
              {subtitle}
            </p>
          </div>

          {nodes.length > 0 && (
            <div className="ml-1 hidden shrink-0 items-center gap-2 md:flex xl:ml-4">
              <div className="h-[3px] w-[64px] overflow-hidden rounded-full bg-surface-3 xl:w-[120px]">
                <div
                  className="h-full rounded-full bg-ok transition-[width] duration-500"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <span className="num text-[12px] text-muted">{progress}%</span>
            </div>
          )}

          <div className="ml-auto flex shrink-0 items-center gap-1.5">
            <button
              onClick={onToggleAgent}
              className={cn('btn', agentOpen ? 'btn-line' : 'btn-accent')}
              title={agentOpen ? '收起路线 Agent' : '打开路线 Agent（读 / 拆 / 改路线）'}
            >
              <span
                data-agent-entry-icon
                className={cn(
                  'flex shrink-0 items-center transition-opacity duration-200',
                  flying || agentOpen ? 'opacity-0' : 'opacity-100',
                )}
              >
                <RouteMark size={18} />
              </span>
              <span className="hidden lg:inline">{agentOpen ? '收起 Agent' : 'Agent'}</span>
            </button>
          </div>
        </header>

        <div
          key={board?.id ?? 'empty'}
          ref={contentRef}
          className="anim-fade-in flex-1 space-y-4 overflow-y-auto px-5 py-4 xl:space-y-5 xl:px-6 xl:py-5"
        >
          <div ref={focusWrapRef}>
            <FocusList nodes={nodes} onOpen={setOpenId} />
          </div>

          <section className="rounded-[16px] border border-line/60 bg-surface shadow-e1">
            <header className="flex items-center gap-2 border-b border-line/70 px-5 py-3.5">
              <h2 className="shrink-0 text-[14px] font-semibold tracking-tight">路线</h2>
              <span className="hidden truncate text-[12px] text-faint lg:inline">
                勾父任务会连带勾上子任务 · 勾后面一步会连带勾上前面的
              </span>
            </header>
            <div className="pointer-events-none sticky top-2 z-30 flex items-center justify-between gap-2 px-3 xl:px-4">
              <div className="pointer-events-auto flex items-center gap-1">
                <button
                  onClick={() => {
                    const label = undo()
                    if (label) toast(`已撤回${label}`)
                  }}
                  disabled={!history.length}
                  title="撤回上一步（勾选 / 删除 / 拖拽都能退）"
                  className="flex h-[27px] shrink-0 items-center gap-1 rounded-full border border-line/70 bg-surface/95 px-2.5 text-[11px] text-muted shadow-e2 backdrop-blur transition-colors hover:text-ink disabled:cursor-default disabled:opacity-35"
                >
                  <Undo2 size={11} />
                  撤回{history[0]?.label ?? ''}
                </button>
                <button
                  onClick={() => {
                    const label = redo()
                    if (label) toast(`已回到${label}`)
                  }}
                  disabled={!redoHistory.length}
                  title="回到下一步（撤销多了可以救回来）"
                  className="flex h-[27px] shrink-0 items-center gap-1 rounded-full border border-line/70 bg-surface/95 px-2.5 text-[11px] text-muted shadow-e2 backdrop-blur transition-colors hover:text-ink disabled:cursor-default disabled:opacity-35"
                >
                  <Redo2 size={11} />
                  回到下一步{redoHistory[0] ? ` · ${redoHistory[0].label}` : ''}
                </button>
              </div>

              <div className="pointer-events-auto flex items-center gap-1 rounded-full border border-line/70 bg-surface/95 px-2 py-[3px] shadow-e2 backdrop-blur">
                <Search size={12} className="shrink-0 text-faint" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      stepMatch(e.shiftKey ? -1 : 1)
                    }
                    if (e.key === 'Escape') setSearch('')
                  }}
                  placeholder="找卡片…"
                  title="输入关键词，回车跳到下一张（Shift+回车上一张）"
                  className="w-[104px] bg-transparent text-[12px] text-ink outline-none transition-[width] placeholder:text-faint focus:w-[168px]"
                />
                {searchQ && (
                  <span className="shrink-0 text-[10px] text-faint">
                    {matches.length ? `${Math.min(matchIdx + 1, matches.length)}/${matches.length}` : '0'}
                  </span>
                )}
                <button
                  onClick={() => stepMatch(-1)}
                  disabled={!matches.length}
                  title="上一张（Shift+回车）"
                  className="flex h-[20px] w-[18px] items-center justify-center rounded text-faint transition-colors hover:bg-surface-3 hover:text-ink disabled:opacity-30"
                >
                  <ChevronUp size={12} />
                </button>
                <button
                  onClick={() => stepMatch(1)}
                  disabled={!matches.length}
                  title="下一张（回车）"
                  className="flex h-[20px] w-[18px] items-center justify-center rounded text-faint transition-colors hover:bg-surface-3 hover:text-ink disabled:opacity-30"
                >
                  <ChevronDown size={12} />
                </button>
              </div>
            </div>

            <div className="px-3 py-3 xl:px-4 xl:py-4">
              <RouteBoard
                nodes={viewNodes}
                collapsed={collapsed}
                onOpen={openView}
                onToggle={toggleView}
                onPin={pinView}
                onToggleCollapse={toggleCollapse}
                onAddGoal={addGoal}
                linkedIds={linkedIds}
                foreignIds={foreignIds}
                foreignAnchors={foreignAnchors}
                highlight={highlight}
              />
            </div>
          </section>
        </div>
      </div>

      <BoardList />

      <NodeDrawer
        nodes={nodes}
        nodeId={openId}
        onClose={() => setOpenId(null)}
        onChangeId={setOpenId}
      />
    </div>
  )
}
