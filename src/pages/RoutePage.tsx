import { useEffect, useMemo, useState } from 'react'
import type { ActionNode } from '@/types'
import { Plus, Search, Undo2 } from 'lucide-react'
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
  const toast = useUi((s) => s.showToast)
  const [openId, setOpenId] = useState<string | null>(null)
  /** 面板内搜索：找卡片 → 自动滚过去并闪一下 */
  const [search, setSearch] = useState('')
  const [matchIdx, setMatchIdx] = useState(0)
  const [highlightNonce, setHighlightNonce] = useState(0)

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
    链接路线 = 在当天路线里实时展开另一条路线：
    把被链接路线的节点按原层级/串并关系投影成「虚拟节点」，渲染在链接卡下面。
    它们不是副本：勾选/查看都走原路线，原路线改了这里立刻跟着变。
  */
  const { viewNodes, linkedIds, foreignIds, linkTitles, owners } = useMemo(() => {
    const views: ActionNode[] = []
    const linked = new Set<string>()
    const foreign = new Set<string>()
    const titles = new Map<string, string>()
    const ownerMap = new Map<string, { boardId: string; origId: string }>()
    if (!board) {
      return { viewNodes: views, linkedIds: linked, foreignIds: foreign, linkTitles: titles, owners: ownerMap }
    }
    for (const n of board.nodes) views.push(n)
    for (const n of board.nodes) {
      if (!n.linkBoardId) continue
      linked.add(n.id)
      const lb = boards.find((b) => b.id === n.linkBoardId)
      if (!lb) continue
      titles.set(n.id, lb.jobTitle)
      const roots = lb.nodes.filter((x) => !x.parentId)
      if (!roots.length) continue
      const shift = n.level + 1 - roots[0].level
      const mapId = (id: string) => `lv-${n.id}-${id}`
      for (const orig of lb.nodes) {
        const clone: ActionNode = {
          ...orig,
          id: mapId(orig.id),
          parentId: orig.parentId ? mapId(orig.parentId) : n.id,
          level: Math.max(1, orig.level + shift),
          deps: orig.deps.map((d) => mapId(d)),
          linkBoardId: undefined,
        }
        views.push(clone)
        linked.add(clone.id)
        foreign.add(clone.id)
        ownerMap.set(clone.id, { boardId: lb.id, origId: orig.id })
      }
    }
    return { viewNodes: views, linkedIds: linked, foreignIds: foreign, linkTitles: titles, owners: ownerMap }
  }, [board, boards])

  const searchQ = search.trim().toLowerCase()
  const matches = useMemo(() => {
    if (!searchQ) return [] as ActionNode[]
    return viewNodes.filter((n) =>
      [n.title, n.purpose, n.detail, n.notes]
        .join(' ')
        .toLowerCase()
        .includes(searchQ),
    )
  }, [searchQ, viewNodes])

  // 搜索词变了就回到第一个命中，并触发一次滚动+闪烁
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
    const owner = owners.get(id)
    if (owner) pinNode(owner.origId, pinned, owner.boardId)
    else pinNode(id, pinned)
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
              title={agentOpen ? '收起路线助手' : '让路线助手帮你拆/改路线'}
            >
              <span
                data-agent-entry-icon
                className={cn('flex shrink-0 items-center', flying && 'opacity-0')}
              >
                <RouteMark size={18} />
              </span>
              <span className="hidden lg:inline">{agentOpen ? '收起助手' : '问助手'}</span>
            </button>
            <button onClick={addGoal} className="btn btn-line" title="自己加一个目标">
              <Plus size={12} />
              <span className="hidden lg:inline">加目标</span>
            </button>
          </div>
        </header>

        <div
          key={board?.id ?? 'empty'}
          className="anim-fade-in flex-1 space-y-4 overflow-y-auto px-5 py-4 xl:space-y-5 xl:px-6 xl:py-5"
        >
          <FocusList nodes={nodes} onOpen={setOpenId} />

          <section className="rounded-[16px] border border-line/60 bg-surface shadow-e1">
            <header className="flex items-center gap-2 border-b border-line/70 px-5 py-3.5">
              <h2 className="shrink-0 text-[14px] font-semibold tracking-tight">路线</h2>
              <span className="hidden truncate text-[12px] text-faint lg:inline">
                勾父任务会连带勾上子任务 · 勾后面一步会连带勾上前面的
              </span>
              <div className="relative ml-auto flex shrink-0 items-center">
                <Search size={11} className="pointer-events-none absolute left-2 text-faint" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      stepMatch(e.shiftKey ? -1 : 1)
                    }
                    if (e.key === 'Escape') {
                      setSearch('')
                    }
                  }}
                  placeholder="找卡片…"
                  title="输入关键词，回车跳到下一张（Shift+回车上一张）"
                  className="field h-[25px] w-[132px] py-0 pr-10 pl-6 text-[11px] transition-[width] focus:w-[184px] focus:pr-10"
                />
                {searchQ && (
                  <span className="pointer-events-none absolute right-2 text-[9.5px] text-faint">
                    {matches.length ? `${Math.min(matchIdx + 1, matches.length)}/${matches.length}` : '0'}
                  </span>
                )}
              </div>
              {history.length > 0 && (
                <button
                  onClick={() => {
                    const label = undo()
                    if (label) toast(`已撤回${label}`)
                  }}
                  title="撤回上一步（勾选 / 删除 / 拖拽都能退）"
                  className="flex shrink-0 items-center gap-1 rounded-md border border-line px-2 py-[3px] text-[11px] text-muted transition-colors hover:border-line-2 hover:bg-surface-3 hover:text-ink"
                >
                  <Undo2 size={11} />
                  撤回{history[0].label}
                </button>
              )}
            </header>
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
                linkTitles={linkTitles}
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
