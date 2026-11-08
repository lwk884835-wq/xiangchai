import { useEffect, useMemo, useRef, useState } from 'react'
import type { ActionNode } from '@/types'
import { ChevronDown, ChevronUp, CornerDownLeft, PanelLeftClose, Redo2, Search, Undo2 } from 'lucide-react'
import { actionProgress, useActions } from '@/store/actions'
import { ACTION_SEED } from '@/data/actionSeed'
import { useUi } from '@/store/ui'
import { cn } from '@/lib/cn'
import { codeOf, copyText, looksLikeCode } from '@/lib/code'
import { buildCodeIndex, findCodeHits, type CodeHit } from '@/lib/codeIndex'
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
  const toggleCollapse = useActions((s) => s.toggleCollapse)
  const setActive = useActions((s) => s.setActiveBoard)
  const history = useActions((s) => s.history)
  const undo = useActions((s) => s.undo)
  const redoHistory = useActions((s) => s.redoHistory)
  const redo = useActions((s) => s.redo)
  const toast = useUi((s) => s.showToast)
  const [openId, setOpenId] = useState<string | null>(null)
  /** 抽屉正在改哪条路线：链接卡片取源路线，普通卡片取当前路线 */
  const [drawerBoardId, setDrawerBoardId] = useState<string | null>(null)
  /** 面板内搜索：找卡片 → 自动滚过去并闪一下 */
  const [search, setSearch] = useState('')
  const [matchIdx, setMatchIdx] = useState(0)
  const [highlightNonce, setHighlightNonce] = useState(0)
  /** 搜索框里输码跳过去的目标：比关键词匹配优先，render 后滚过去闪一下 */
  const [codeJump, setCodeJump] = useState<{ id: string; nonce: number; code: string } | null>(null)
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
  /** 全库「码 → 路线/卡片」索引：搜索框里输码就能跳 */
  const codeIndex = useMemo(() => buildCodeIndex(boards), [boards])
  const codeHits = useMemo(() => findCodeHits(codeIndex, search), [codeIndex, search])
  const codeHit = codeHits[0]

  /** 输码跳过去：路线就切过去，卡片就切到它所在路线、展开祖先、滚过去闪一下 */
  const jumpToCode = (hit: CodeHit) => {
    if (hit.kind === 'route') {
      if (hit.boardId === activeId) toast(`已经在路线 #${hit.code}「${hit.title}」`)
      else {
        setActive(hit.boardId)
        toast(
          `已切到路线 #${hit.code}「${hit.title}」${hit.archived ? ' · 在归档里' : ''}`,
        )
      }
      setSearch('')
      setCodeJump(null)
      return
    }
    const target = boards.find((b) => b.id === hit.boardId)
    const node = target?.nodes.find((n) => n.id === hit.nodeId)
    // 链接锚点在图上不单独画（画的是投影出来的那棵树），退到它的上级去定位
    const focusId = node ? (node.linkBoardId ? node.parentId : node.id) : null
    if (!node || !focusId) {
      toast(`#${hit.code} 是链接卡，图上没有它自己的位置，跳到它所在路线了`)
      if (hit.boardId !== activeId) setActive(hit.boardId)
      setSearch('')
      setCodeJump(null)
      return
    }
    // 目标卡如果被折叠在子树里，先把祖先链展开，不然滚过去也看不到
    const byId = new Map(target!.nodes.map((n) => [n.id, n]))
    const folded = new Set(collapsedMap[hit.boardId] ?? [])
    const toOpen: string[] = []
    for (let p = node.parentId; p; p = byId.get(p)?.parentId ?? null) {
      if (folded.has(p)) toOpen.push(p)
    }
    toOpen.forEach((id) => toggleCollapse(id, hit.boardId))
    if (hit.boardId !== activeId) setActive(hit.boardId)
    setSearch('')
    setCodeJump({ id: focusId, nonce: Date.now(), code: hit.code })
    toast(`已跳到 #${hit.code}「${hit.title}」${hit.archived ? ' · 在归档里' : ''}`)
  }

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

  /** 码跳转优先于关键词匹配；跳走以后目标不在当前视图里就不高亮 */
  const codeJumpVisible = codeJump && viewNodes.some((n) => n.id === codeJump.id)
  const highlight = codeJumpVisible
    ? { id: codeJump.id, nonce: codeJump.nonce }
    : matches.length
      ? { id: matches[Math.min(matchIdx, matches.length - 1)].id, nonce: highlightNonce }
      : undefined

  const openView = (id: string) => {
    const owner = owners.get(id)
    if (owner) {
      // 链接进来的卡：不切走当前路线，就在这个面板上方打开源路线的二级菜单
      setDrawerBoardId(owner.boardId)
      setOpenId(owner.origId)
    } else {
      setDrawerBoardId(activeId)
      setOpenId(id)
    }
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

          {board && (
            <button
              onClick={() => {
                const code = codeOf(board.id)
                void copyText(`#${code}`).then((ok) =>
                  toast(ok ? `已复制路线码 #${code}` : '复制失败：浏览器不给剪贴板权限'),
                )
              }}
              title={`复制路线码 #${codeOf(board.id)}（Agent 的 board 参数可以直接填它）`}
              className="hidden shrink-0 items-center rounded-md px-1.5 py-[3px] font-mono text-[10.5px] tracking-[0.06em] text-faint transition-colors hover:bg-surface-3 hover:text-muted sm:flex"
            >
              #{codeOf(board.id)}
            </button>
          )}

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
              className={cn(
                'btn overflow-hidden',
                agentOpen ? 'btn-line' : 'btn-accent',
              )}
              style={{
                width: agentOpen ? 118 : 88,
                transition:
                  'width 300ms cubic-bezier(0.22,1,0.36,1), background-color 300ms ease, border-color 300ms ease, color 300ms ease',
              }}
              title={agentOpen ? '收起路线 Agent' : '打开路线 Agent（读 / 拆 / 改路线）'}
            >
              <span
                data-agent-entry-icon
                className={cn(
                  'flex h-[18px] w-[18px] shrink-0 items-center justify-center transition-opacity duration-200',
                  flying && 'opacity-0',
                )}
              >
                {agentOpen ? <PanelLeftClose size={16} strokeWidth={1.9} /> : <RouteMark size={18} />}
              </span>
              <span className="whitespace-nowrap">{agentOpen ? '收起 Agent' : 'Agent'}</span>
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
                  onChange={(e) => {
                    setSearch(e.target.value)
                    if (codeJump) setCodeJump(null)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      if (codeHit) {
                        jumpToCode(codeHit)
                        return
                      }
                      if (looksLikeCode(search) && !matches.length) {
                        toast(`没找到「${search.trim()}」，可能是打错了，或者这张卡已经删了`)
                        return
                      }
                      stepMatch(e.shiftKey ? -1 : 1)
                    }
                    if (e.key === 'Escape') {
                      setSearch('')
                      setCodeJump(null)
                    }
                  }}
                  placeholder="找卡片 / 输码…"
                  title="输入关键词找卡片，回车跳下一张（Shift+回车上一张）；输入 5 位码（如 #BCU5C）回车直接跳到那张卡或那条路线"
                  className="w-[104px] bg-transparent text-[12px] text-ink outline-none transition-[width] placeholder:text-faint focus:w-[168px]"
                />
                {codeHit ? (
                  <span
                    className="flex max-w-[190px] shrink-0 items-center gap-1 truncate text-[10px] text-muted"
                    title={`按回车跳到${codeHit.kind === 'route' ? '路线' : '卡片'}：${codeHit.title}`}
                  >
                    <span className="flex h-[14px] shrink-0 items-center rounded bg-surface-3 px-1 text-muted">
                      <CornerDownLeft size={9} strokeWidth={2.5} />
                    </span>
                    <span className="truncate">
                      {codeHit.kind === 'route' ? '路线' : '卡片'} · {codeHit.title}
                    </span>
                  </span>
                ) : (
                  searchQ && (
                    <span className="shrink-0 text-[10px] text-faint">
                      {matches.length ? `${Math.min(matchIdx + 1, matches.length)}/${matches.length}` : '0'}
                    </span>
                  )
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
                owners={owners}
                highlight={highlight}
              />
            </div>
          </section>
        </div>
      </div>

      <BoardList />

      <NodeDrawer
        nodes={boards.find((b) => b.id === drawerBoardId)?.nodes ?? nodes}
        nodeId={openId}
        boardId={drawerBoardId ?? board?.id}
        onClose={() => {
          setOpenId(null)
          setDrawerBoardId(null)
        }}
        onChangeId={setOpenId}
      />
    </div>
  )
}
