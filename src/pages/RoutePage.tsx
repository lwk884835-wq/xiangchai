import { useEffect, useState } from 'react'
import { Download, Plus, Undo2 } from 'lucide-react'
import { actionProgress, planToMarkdown, useActions } from '@/store/actions'
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
 * 工作路线首页：一条能长期看下去的行动路线。
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
  const doneHistory = useActions((s) => s.doneHistory)
  const undoDone = useActions((s) => s.undoDone)
  const toast = useUi((s) => s.showToast)
  const [openId, setOpenId] = useState<string | null>(null)

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

  const exportMd = () => {
    if (!board) return
    const md = planToMarkdown(nodes, `${board.jobTitle}${board.label ? ' · ' + board.label : ''}`)
    if (!md) return
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `路线-${board.jobTitle}.md`
    a.click()
    URL.revokeObjectURL(a.href)
    toast('已导出 Markdown')
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
              工作路线
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
            <button onClick={exportMd} className="btn btn-line" title="导出 Markdown">
              <Download size={12} />
              <span className="hidden lg:inline">导出 md</span>
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
              {doneHistory.length > 0 && (
                <button
                  onClick={undoDone}
                  title="撤回上一次勾选（连带改动一起回退）"
                  className="ml-auto flex shrink-0 items-center gap-1 rounded-md border border-line px-2 py-[3px] text-[11px] text-muted transition-colors hover:border-line-2 hover:bg-surface-3 hover:text-ink"
                >
                  <Undo2 size={11} />
                  撤回勾选
                </button>
              )}
            </header>
            <div className="px-3 py-3 xl:px-4 xl:py-4">
              <RouteBoard
                nodes={nodes}
                collapsed={collapsed}
                onOpen={setOpenId}
                onToggle={toggleNode}
                onPin={pinNode}
                onToggleCollapse={toggleCollapse}
                onAddGoal={addGoal}
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
