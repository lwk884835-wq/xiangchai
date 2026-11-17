import { useEffect, useMemo, useRef, useState } from 'react'
import type { ActionNode } from '@/types'
import {
  Check,
  ChevronDown,
  ChevronUp,
  CornerDownLeft,
  ExternalLink,
  Moon,
  Redo2,
  Search,
  Sun,
  SunMoon,
  Undo2,
} from 'lucide-react'
import { actionProgress, useActions } from '@/store/actions'
import { ACTION_SEED } from '@/data/actionSeed'
import { useUi } from '@/store/ui'
import { cn } from '@/lib/cn'
import { codeOf, copyText, looksLikeCode } from '@/lib/code'
import { buildCodeIndex, findCodeHits, type CodeHit } from '@/lib/codeIndex'
import { clearDeepLink, copyNoteLink, readDeepLink } from '@/lib/deepLink'
import { FocusList } from '@/components/action/FocusList'
import { UpdateButton } from '@/components/UpdateButton'
import { RouteBoard } from '@/components/action/RouteBoard'
import { NodeDrawer } from '@/components/action/NodeDrawer'
import { BoardList } from '@/components/action/BoardList'
import {
  applyTheme,
  readPref,
  rememberPref,
  systemTheme,
  watchSystemTheme,
  type Theme,
  type ThemePref,
} from '@/lib/theme'

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
export function RoutePage() {
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
  /*
    主题：偏好（跟随系统 / 浅 / 深）和「实际生效的浅深」分开存。
    偏好是 system 时跟着系统走——系统切了这边当场跟着变，不用刷新。
    手动选过浅或深就固定住，不再被系统带着跑；选回「跟随系统」立刻交还控制权。
  */
  const [pref, setPref] = useState<ThemePref>(() => readPref())
  const [systemDark, setSystemDark] = useState(() => systemTheme() === 'dark')
  const theme: Theme = pref === 'system' ? (systemDark ? 'dark' : 'light') : pref
  useEffect(() => {
    applyTheme(theme)
  }, [theme])
  useEffect(() => watchSystemTheme((t) => setSystemDark(t === 'dark')), [])
  const [themeMenu, setThemeMenu] = useState(false)
  const themeMenuRef = useRef<HTMLDivElement>(null)
  const choosePref = (next: ThemePref) => {
    setPref(next)
    rememberPref(next)
    setThemeMenu(false)
  }
  // 点菜单外面 / 按 Esc 就收起
  useEffect(() => {
    if (!themeMenu) return
    const onDown = (e: MouseEvent) => {
      if (!themeMenuRef.current?.contains(e.target as Node)) setThemeMenu(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setThemeMenu(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [themeMenu])
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
    /* 26.11.14：不再自动定到重点。以前重点面板只放这条路线的重点，
       空路线里放个根任务当锚点还算合理；现在重点面板是「所有路线的重点」
       汇总，新任务默认挤进去只是噪音。要定就自己点图钉。 */
    const id = addNode({
      title: '新目标',
      purpose: '',
      detail: '',
      level: 1,
      parentId: null,
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

  /**
   * 切到某条路线，把一张卡滚到视口中间闪一下。
   * 重点清单跨路线了，点一条重点就走这里（以前只能定位当前路线里的卡）。
   * 链接锚点在图上不单独画（画的是投影出来的那棵树），退到它的上级去定位，
   * 退不动（它是根）就只切路线。
   */
  const locateCard = (boardId: string, nodeId: string) => {
    const target = boards.find((b) => b.id === boardId)
    const node = target?.nodes.find((n) => n.id === nodeId)
    if (!target || !node) return false
    const focusId = node.linkBoardId ? node.parentId : node.id
    if (!focusId) {
      if (boardId !== activeId) setActive(boardId)
      return false
    }
    // 目标卡如果被折叠在子树里，先把祖先链展开，不然滚过去也看不到
    const byId = new Map(target.nodes.map((n) => [n.id, n]))
    const folded = new Set(collapsedMap[boardId] ?? [])
    const toOpen: string[] = []
    for (let p = node.parentId; p; p = byId.get(p)?.parentId ?? null) {
      if (folded.has(p)) toOpen.push(p)
    }
    toOpen.forEach((id) => toggleCollapse(id, boardId))
    if (boardId !== activeId) setActive(boardId)
    setCodeJump({ id: focusId, nonce: Date.now(), code: '' })
    return true
  }

  /*
    深链：从 Obsidian / 别处点回来的链接带着 ?route=…&node=…
    进来先按它定位那条路线、那张卡，然后把参数从地址栏抹掉（不然他中途切了路线，
    一刷新又被拽回来）。数据可能还在从 /api/routes 同步，找不到路线就等下一轮再试；
    过了 5 秒还没有，说明链接指向的路线已经没了，收手并说一声。
  */
  const deepLinkDone = useRef(false)
  const deepLinkDeadline = useRef(0)
  /** 到点重试用：值变化才能让上面那个 effect 再跑一遍（依赖里放 setter 是没用的，setter 引用永远不变） */
  const [deepLinkTick, bumpDeepLinkTick] = useState(0)
  useEffect(() => {
    if (deepLinkDone.current) return
    const want = readDeepLink()
    if (!want.route && !want.node && !want.code) {
      deepLinkDone.current = true
      return
    }
    if (!deepLinkDeadline.current) deepLinkDeadline.current = Date.now() + 5000

    let boardId = want.route
    let nodeId = want.node
    if (want.code) {
      const hit = findCodeHits(buildCodeIndex(boards), want.code)[0]
      if (hit) {
        boardId = hit.boardId
        if (hit.kind === 'node') nodeId = hit.nodeId
      }
    }
    const target = boardId ? (boards.find((b) => b.id === boardId) ?? null) : null

    if (!target) {
      if (Date.now() >= deepLinkDeadline.current) {
        deepLinkDone.current = true
        clearDeepLink()
        toast('这个链接指向的路线找不到了，可能已经删掉')
        return
      }
      /* 数据可能还在从 /api/routes 同步：等到截止点再试一次。
         boards 之后如果不再变化，这个 effect 不会自己重跑，链接就会一直挂在地址栏上。 */
      const timer = window.setTimeout(
        () => bumpDeepLinkTick((n) => n + 1),
        Math.max(50, deepLinkDeadline.current - Date.now()),
      )
      return () => window.clearTimeout(timer)
    }

    deepLinkDone.current = true
    clearDeepLink()
    const node = nodeId ? (target.nodes.find((n) => n.id === nodeId) ?? null) : null
    if (!node) {
      if (target.id !== activeId) setActive(target.id)
      toast(`从链接打开路线「${target.jobTitle}」`)
      return
    }
    locateCard(target.id, node.id)
    setDrawerBoardId(target.id)
    setOpenId(node.id)
    toast(`从链接定位到「${node.title}」`)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boards, deepLinkTick])

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
    setSearch('')
    if (!locateCard(hit.boardId, hit.nodeId)) {
      setCodeJump(null)
      toast(`#${hit.code} 是链接卡，图上没有它自己的位置，跳到它所在路线了`)
      return
    }
    toast(`已跳到 #${hit.code}「${hit.title}」${hit.archived ? ' · 在归档里' : ''}`)
  }

  const matches = useMemo(() => {
    if (!searchQ) return [] as ActionNode[]
    return viewNodes.filter((n) =>
      [n.title, n.purpose, n.approach, n.detail, n.notes].join(' ').toLowerCase().includes(searchQ),
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

          {board && (
            <button
              onClick={() => {
                void copyNoteLink(board.jobTitle, { boardId: board.id }).then((ok) =>
                  toast(
                    ok
                      ? '已复制路线链接：粘进笔记后显示路线名，点开跳回这条路线'
                      : '复制失败：浏览器不给剪贴板权限',
                  ),
                )
              }}
              title="复制这条路线的链接（粘进 Obsidian 等笔记，点开跳回这里）"
              className="hidden shrink-0 items-center rounded-md px-1.5 py-[3px] text-faint transition-colors hover:bg-surface-3 hover:text-ink sm:flex"
            >
              <ExternalLink size={12} strokeWidth={1.9} />
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
            <UpdateButton />
            <div ref={themeMenuRef} className="relative shrink-0">
              <button
                onClick={() => setThemeMenu((v) => !v)}
                title={
                  pref === 'system'
                    ? `外观：跟随系统（现在是用${theme === 'dark' ? '深色' : '浅色'}）`
                    : pref === 'dark'
                      ? '外观：深色'
                      : '外观：浅色'
                }
                aria-label="切换外观"
                aria-expanded={themeMenu}
                className={cn(
                  'flex h-[32px] w-[32px] items-center justify-center rounded-full border transition-colors',
                  themeMenu
                    ? 'border-line-2 bg-surface-3 text-ink'
                    : 'border-line/70 bg-surface text-muted hover:border-line-2 hover:text-ink',
                )}
              >
                {pref === 'system' ? (
                  <SunMoon size={15} strokeWidth={1.9} />
                ) : theme === 'dark' ? (
                  <Moon size={15} strokeWidth={1.9} />
                ) : (
                  <Sun size={15} strokeWidth={1.9} />
                )}
              </button>

              {themeMenu && (
                <div
                  data-theme-menu
                  className="anim-pop absolute top-[38px] right-0 z-50 w-[142px] rounded-[12px] border border-line bg-surface p-1 shadow-e3"
                >
                  {(
                    [
                      { key: 'system', label: '跟随系统', icon: SunMoon },
                      { key: 'light', label: '浅色', icon: Sun },
                      { key: 'dark', label: '深色', icon: Moon },
                    ] as const
                  ).map(({ key, label, icon: Icon }) => {
                    const active = pref === key
                    return (
                      <button
                        key={key}
                        onClick={() => choosePref(key)}
                        className={cn(
                          'flex w-full items-center gap-2 rounded-[8px] px-2 py-[7px] text-left text-[12px] transition-colors',
                          active
                            ? 'bg-accent-soft text-accent-ink'
                            : 'text-ink-2 hover:bg-surface-3 hover:text-ink',
                        )}
                      >
                        <Icon size={13} strokeWidth={1.9} className="shrink-0" />
                        <span className="flex-1">{label}</span>
                        {active && <Check size={12} strokeWidth={2.4} className="shrink-0" />}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        </header>

        <div
          key={board?.id ?? 'empty'}
          ref={contentRef}
          className="anim-fade-in flex-1 space-y-4 overflow-y-auto px-5 py-4 xl:space-y-5 xl:px-6 xl:py-5"
        >
          <div ref={focusWrapRef}>
            <FocusList boards={boards} activeBoardId={activeId} onJump={locateCard} />
          </div>

          <section className="rounded-[16px] border border-line/60 bg-surface shadow-e1">
            <header className="sticky top-0 z-30 flex items-center gap-2 rounded-t-[16px] border-b border-line/70 bg-surface px-5 py-2">
              <h2 className="shrink-0 text-[14px] font-semibold tracking-tight">路线</h2>
              <span className="hidden min-w-0 flex-1 truncate text-[12px] text-faint lg:inline">
                勾父任务会连带勾上子任务 · 勾后面一步会连带勾上前面的
              </span>
              {/* 撤回 / 回到下一步 / 搜索跟标题同一行，整条 header 看起来是一块固定栏 */}
              <div className="flex shrink-0 items-center gap-2">
                <div className="flex items-center gap-1">
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

                <div className="flex shrink-0 items-center gap-1 rounded-full border border-line/70 bg-surface/95 px-2 py-[3px] shadow-e2 backdrop-blur">
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
