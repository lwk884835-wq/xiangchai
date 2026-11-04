import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Archive,
  Check,
  ChevronDown,
  Download,
  Folder,
  FolderInput,
  FolderPlus,
  Link,
  Link2,
  PanelRightClose,
  PanelRightOpen,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
  Upload,
} from 'lucide-react'
import { actionProgress, useActions } from '@/store/actions'
import type { ActionBoard, ActionNode } from '@/types'
import { useUi } from '@/store/ui'
import { cn } from '@/lib/cn'

/**
 * 右侧：路线列表。
 * 一个「方向」一条路线，可以新建 / 改名 / 归档 / 删除，
 * 也可以把全部数据导出成 JSON 带走（换电脑、换浏览器）。
 */
export function BoardList() {
  const boards = useActions((s) => s.boards)
  const activeId = useActions((s) => s.activeBoardId)
  const setActive = useActions((s) => s.setActiveBoard)
  const addBoard = useActions((s) => s.addBoard)
  const removeBoard = useActions((s) => s.removeBoard)
  const archiveBoard = useActions((s) => s.archiveBoard)
  const restoreBoard = useActions((s) => s.restoreBoard)
  const moveSubtreeToBoard = useActions((s) => s.moveSubtreeToBoard)
  const folders = useActions((s) => s.folders)
  const addFolder = useActions((s) => s.addFolder)
  const renameFolder = useActions((s) => s.renameFolder)
  const removeFolder = useActions((s) => s.removeFolder)
  const setBoardFolder = useActions((s) => s.setBoardFolder)
  const linkBoardInto = useActions((s) => s.linkBoardInto)
  const copyRouteLink = useActions((s) => s.copyRouteLink)
  const renameBoard = useActions((s) => s.renameBoard)
  const exportData = useActions((s) => s.exportData)
  const importData = useActions((s) => s.importData)
  const toast = useUi((s) => s.showToast)

  const [confirmId, setConfirmId] = useState<string | null>(null)
  /** 拖拽悬停在哪条路线上（跨路线搬家用） */
  const [dropBoardId, setDropBoardId] = useState<string | null>(null)
  /** 跨路线拖拽时预览目标路线的结构，选精确落点 */
  const [previewBoardId, setPreviewBoardId] = useState<string | null>(null)
  const [previewDropId, setPreviewDropId] = useState<string | null>(null)

  // 拖拽结束后（无论落在哪）把预览收掉
  useEffect(() => {
    const clear = () => {
      setPreviewBoardId(null)
      setPreviewDropId(null)
      setDropBoardId(null)
    }
    window.addEventListener('dragend', clear)
    window.addEventListener('drop', clear)
    return () => {
      window.removeEventListener('dragend', clear)
      window.removeEventListener('drop', clear)
    }
  }, [])

  /** 预览面板里的树：按层级先序遍历，缩进展示 */
  const previewTree = useMemo(() => {
    if (!previewBoardId) return [] as { node: ActionNode; depth: number }[]
    const board = boards.find((b) => b.id === previewBoardId)
    if (!board) return [] as { node: ActionNode; depth: number }[]
    const out: { node: ActionNode; depth: number }[] = []
    const walk = (pid: string | null, depth: number) => {
      for (const n of board.nodes.filter((x) => x.parentId === pid)) {
        out.push({ node: n, depth })
        walk(n.id, depth + 1)
      }
    }
    walk(null, 0)
    return out
  }, [previewBoardId, boards])

  const crossDrop = (e: React.DragEvent, targetNodeId: string | null) => {
    e.preventDefault()
    e.stopPropagation()
    const nodeId = e.dataTransfer.getData('application/x-route-node')
    const toId = previewBoardId
    setPreviewBoardId(null)
    setPreviewDropId(null)
    setDropBoardId(null)
    if (!nodeId || !toId) return
    moveSubtreeToBoard(nodeId, toId, targetNodeId ?? undefined)
    const to = boards.find((b) => b.id === toId)
    toast(`已搬到「${to?.jobTitle ?? '目标路线'}」`)
  }
  const [showArchived, setShowArchived] = useState(false)
  const [draft, setDraft] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [creatingFolder, setCreatingFolder] = useState(false)
  const [folderDraft, setFolderDraft] = useState('')
  /** 正在重命名的文件夹 */
  const [renamingFolder, setRenamingFolder] = useState<string | null>(null)
  const [folderRenameDraft, setFolderRenameDraft] = useState('')
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set())
  const [folderMenuBoardId, setFolderMenuBoardId] = useState<string | null>(null)
  const [folderMenuDraft, setFolderMenuDraft] = useState('')

  const createFolder = () => {
    const name = folderDraft.trim()
    if (!name) {
      setCreatingFolder(false)
      return
    }
    addFolder(name)
    setFolderDraft('')
    setCreatingFolder(false)
    toast(`已创建文件夹「${name}」`)
  }

  const toggleFolder = (name: string) =>
    setCollapsedFolders((cur) => {
      const next = new Set(cur)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  /** 右侧栏是否展开：收起后把宽度让给行动路线 */
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem('work-route-boards-open') !== '0'
    } catch {
      return true
    }
  })
  const setOpenPersist = (v: boolean) => {
    setOpen(v)
    try {
      localStorage.setItem('work-route-boards-open', v ? '1' : '0')
    } catch {}
  }
  // 收起状态下从路线图拖卡片过来：自动展开，否则没有落点
  useEffect(() => {
    const onDragStart = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes('application/x-route-node')) setOpenPersist(true)
    }
    window.addEventListener('dragstart', onDragStart)
    return () => window.removeEventListener('dragstart', onDragStart)
  }, [])

  const q = query.trim()
  const matchRoute = (b: ActionBoard) =>
    !q || [b.jobTitle, b.label, b.jobCity].join(' ').toLowerCase().includes(q.toLowerCase())
  const live = boards.filter((b) => !b.archived && matchRoute(b))
  const archived = boards.filter((b) => b.archived && matchRoute(b))
  /** 收起态显示当前路线名（比「路线 N」直观） */
  const activeBoard = boards.find((b) => b.id === activeId) ?? live[0] ?? null
  const railTitle = activeBoard?.jobTitle?.trim() || '路线'
  const railTitleShort = railTitle.length > 14 ? `${railTitle.slice(0, 14)}…` : railTitle

  const create = () => {
    const title = draft.trim()
    addBoard({ jobTitle: title, jobCity: '', label: '', folder: '' })
    setDraft('')
    toast(
      title
        ? `已新建「${title}」，现在可以加第一个目标`
        : '已新建路线，加第一个目标后，路线名会自动跟着它',
    )
  }

  const startRename = (id: string, title: string) => {
    setEditingId(id)
    setEditDraft(title)
  }
  const commitRename = () => {
    if (!editingId) return
    const next = editDraft.trim()
    if (next) renameBoard(editingId, { jobTitle: next })
    setEditingId(null)
    setEditDraft('')
  }

  const renderRoute = (b: ActionBoard) => {
    const active = b.id === activeId
    const progress = actionProgress(b.nodes)
    return (
      <div
        key={b.id}
        onDragEnter={(e) => {
          if (!e.dataTransfer.types.includes('application/x-route-node')) return
          if (b.id === activeId) return
          setPreviewBoardId(b.id)
        }}
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes('application/x-route-node')) return
          if (b.id === activeId) return
          e.preventDefault()
          e.dataTransfer.dropEffect = 'move'
          setDropBoardId(b.id)
          setPreviewBoardId(b.id)
        }}
        onDragLeave={() => setDropBoardId((cur) => (cur === b.id ? null : cur))}
        onDrop={(e) => {
          if (b.id === activeId) return
          e.preventDefault()
          const id = e.dataTransfer.getData('application/x-route-node')
          setDropBoardId(null)
          if (!id) return
          moveSubtreeToBoard(id, b.id)
          toast(`已搬到「${b.jobTitle}」`)
        }}
        className={cn(
          'group relative rounded-[10px] border px-3 py-2.5 transition-all duration-150',
          active ? 'border-line bg-surface shadow-e1' : 'border-transparent hover:bg-surface-3/70',
          dropBoardId === b.id && 'border-accent-line bg-accent-soft/60 ring-1 ring-accent-line',
        )}
      >
        {active && (
          <span className="absolute top-2.5 bottom-2.5 left-0 w-[2px] rounded-full bg-accent" />
        )}
        <div className="flex items-start gap-1">
          {editingId === b.id ? (
            <input
              autoFocus
              value={editDraft}
              onChange={(e) => setEditDraft(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitRename()
                if (e.key === 'Escape') {
                  setEditingId(null)
                  setEditDraft('')
                }
              }}
              className="field h-7 min-w-0 flex-1 px-1.5 text-[13px]"
            />
          ) : (
            <button onClick={() => setActive(b.id)} className="min-w-0 flex-1 text-left">
              <div className="truncate text-[13px] leading-snug font-medium tracking-tight text-ink">
                {b.jobTitle}
              </div>
              <div className="mt-0.5 flex items-center gap-1 truncate text-[11px] text-faint">
                {b.jobCity && <span>{b.jobCity}</span>}
                {b.jobCity && b.label && <span>·</span>}
                {b.label && <span>{b.label}</span>}
                {!b.jobCity && !b.label && <span>本地路线</span>}
                <span>·</span>
                <span className="num">{b.nodes.length} 个任务</span>
              </div>
              {progress > 0 && (
                <div className="mt-1.5 h-[3px] overflow-hidden rounded-full bg-surface-3">
                  <div
                    className="h-full rounded-full bg-ok transition-[width] duration-500"
                    style={{ width: `${progress}%` }}
                  />
                </div>
              )}
            </button>
          )}
          <div className="flex shrink-0 flex-col gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
            <button
              onClick={() => {
                const ok = copyRouteLink(b.id)
                toast(
                  ok
                    ? '已复制路线链接：去当天路线里右键卡片/空白处粘贴'
                    : '复制失败：找不到这条路线',
                )
              }}
              title="复制路线链接（可在任意卡片或空白处粘贴）"
              className="flex h-[18px] w-[18px] items-center justify-center rounded text-faint transition-colors hover:bg-surface-3 hover:text-ink"
            >
              <Link size={11} />
            </button>
            {b.id !== activeId && (
              <button
                onClick={() => {
                  const id = linkBoardInto(b.id)
                  toast(
                    id
                      ? `已把「${b.jobTitle}」插到当天路线里（蓝色描边，点卡片可跳过去改）`
                      : '当前路线还没有目标，先加一个目标再插',
                  )
                }}
                title="插入到当天路线（实时展开，改动写回原路线）"
                className="flex h-[18px] w-[18px] items-center justify-center rounded text-faint transition-colors hover:bg-surface-3 hover:text-ink"
              >
                <Link2 size={11} />
              </button>
            )}
            <button
              onClick={() => {
                setFolderMenuBoardId(b.id)
                setFolderMenuDraft('')
              }}
              title="移动到文件夹"
              className="flex h-[18px] w-[18px] items-center justify-center rounded text-faint transition-colors hover:bg-surface-3 hover:text-ink"
            >
              <FolderInput size={11} />
            </button>
            <button
              onClick={() => startRename(b.id, b.jobTitle)}
              title="改名字"
              className="flex h-[18px] w-[18px] items-center justify-center rounded text-faint transition-colors hover:bg-surface-3 hover:text-ink"
            >
              {editingId === b.id ? <Check size={11} /> : <Pencil size={11} />}
            </button>
            <button
              onClick={() => archiveBoard(b.id)}
              title="归档（可恢复）"
              className="flex h-[18px] w-[18px] items-center justify-center rounded text-faint transition-colors hover:bg-surface-3 hover:text-ink"
            >
              <Archive size={11} />
            </button>
            <button
              onClick={() => setConfirmId(b.id)}
              title="删除"
              className="flex h-[18px] w-[18px] items-center justify-center rounded text-faint transition-colors hover:bg-surface-3 hover:text-danger"
            >
              <Trash2 size={11} />
            </button>
          </div>
        </div>

        {confirmId === b.id && (
          <div className="mt-2 flex items-center gap-1.5 border-t border-line pt-2">
            <span className="text-[11px] text-muted">删掉这条路线？</span>
            <button
              onClick={() => {
                removeBoard(b.id)
                setConfirmId(null)
              }}
              className="ml-auto rounded-md bg-danger px-1.5 py-[2px] text-[11px] text-white transition-opacity hover:opacity-85"
            >
              删除
            </button>
            <button
              onClick={() => setConfirmId(null)}
              className="rounded-md border border-line px-1.5 py-[2px] text-[11px] text-muted transition-colors hover:bg-surface-3"
            >
              取消
            </button>
          </div>
        )}
      </div>
    )
  }

  return (
    <div
      className={cn(
        'flex shrink-0 flex-col overflow-hidden border-l border-line bg-surface-2 transition-[width] duration-200 ease-out',
        open ? 'w-[clamp(210px,13vw,260px)]' : 'w-[30px]',
      )}
    >
      {!open ? (
        <button
          onClick={() => setOpenPersist(true)}
          title={`展开路线列表（当前：${railTitle}）`}
          aria-label={`展开路线列表（当前路线：${railTitle}）`}
          className="flex w-full flex-1 flex-col items-center gap-2 pt-3 text-faint transition-colors hover:bg-surface-3 hover:text-ink"
        >
          <PanelRightOpen size={14} className="shrink-0" />
          <span
            className="min-h-0 text-[11px] leading-none tracking-[.14em] [writing-mode:vertical-rl] max-h-[calc(100%-48px)] overflow-hidden"
            title={railTitle}
          >
            {railTitleShort}
          </span>
        </button>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-[56px] shrink-0 items-center justify-between border-b border-line/70 px-3">
        <span className="label">路线 · {live.length}</span>
        <div className="flex items-center gap-0.5">
          <button
            onClick={() => setCreatingFolder((v) => !v)}
            title="新建文件夹"
            aria-label="新建文件夹"
            className="flex h-[22px] w-[22px] items-center justify-center rounded-md text-faint transition-colors hover:bg-surface-3 hover:text-ink"
          >
            <FolderPlus size={13} />
          </button>
          <button
            onClick={() => setOpenPersist(false)}
            title="收起路线列表（把宽度让给路线图）"
            aria-label="收起路线列表"
            className="flex h-[22px] w-[22px] items-center justify-center rounded-md text-faint transition-colors hover:bg-surface-3 hover:text-ink"
          >
            <PanelRightClose size={13} />
          </button>
        </div>
      </div>

      <div className="flex-1 space-y-1 overflow-y-auto p-1.5">
        <div className="pb-1">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索路线…"
            className="field h-7 px-2 text-[12px]"
          />
        </div>

        {creatingFolder && (
          <div className="flex items-center gap-1 pb-1">
            <input
              autoFocus
              value={folderDraft}
              onChange={(e) => setFolderDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') createFolder()
                if (e.key === 'Escape') {
                  setCreatingFolder(false)
                  setFolderDraft('')
                }
              }}
              placeholder="文件夹名字（回车创建）"
              className="field h-7 min-w-0 flex-1 px-2 text-[12px]"
            />
            <button
              onClick={createFolder}
              className="rounded-md bg-ink px-2 py-[3px] text-[11px] text-white"
            >
              建
            </button>
          </div>
        )}

        {folders.map((name) => {
          const routes = live.filter((b) => (b.folder || '') === name)
          const folded = collapsedFolders.has(name)
          return (
            <div key={name}>
              <div className="group/folder flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-muted transition-colors hover:bg-surface-3">
                <button
                  onClick={() => toggleFolder(name)}
                  className="flex min-w-0 flex-1 items-center gap-1 text-left"
                >
                  <ChevronDown
                    size={11}
                    className={cn('shrink-0 transition-transform', folded && '-rotate-90')}
                  />
                  <Folder size={11} className="shrink-0 text-faint" />
                  {renamingFolder === name ? (
                    <input
                      autoFocus
                      value={folderRenameDraft}
                      onFocus={(e) => e.currentTarget.select()}
                      onChange={(e) => setFolderRenameDraft(e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          const next = folderRenameDraft.trim()
                          if (next && next !== name) {
                            renameFolder(name, next)
                            toast(`文件夹已改名为「${next}」`)
                          }
                          setRenamingFolder(null)
                        } else if (e.key === 'Escape') setRenamingFolder(null)
                      }}
                      onBlur={() => {
                        const next = folderRenameDraft.trim()
                        if (next && next !== name) {
                          renameFolder(name, next)
                          toast(`文件夹已改名为「${next}」`)
                        }
                        setRenamingFolder(null)
                      }}
                      className="h-[18px] min-w-0 flex-1 rounded border border-accent-line bg-surface px-1 text-[11px] outline-none"
                    />
                  ) : (
                    <>
                      <span
                        className="truncate"
                        onDoubleClick={() => {
                          setRenamingFolder(name)
                          setFolderRenameDraft(name)
                        }}
                      >
                        {name}
                      </span>
                      <span className="num shrink-0 text-faint">{routes.length}</span>
                    </>
                  )}
                </button>
                {renamingFolder !== name && (
                  <button
                    onClick={() => {
                      setRenamingFolder(name)
                      setFolderRenameDraft(name)
                    }}
                    title="重命名文件夹"
                    className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded text-faint opacity-0 transition-opacity group-hover/folder:opacity-100 hover:bg-surface-3 hover:text-ink"
                  >
                    <Pencil size={10} />
                  </button>
                )}
                <button
                  onClick={() => {
                    removeFolder(name)
                    toast(`已删除文件夹「${name}」，里面的路线回到未分类`)
                  }}
                  title="删除文件夹（里面的路线回到未分类）"
                  className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded text-faint opacity-0 transition-opacity group-hover/folder:opacity-100 hover:bg-surface-3 hover:text-danger"
                >
                  <Trash2 size={11} />
                </button>
              </div>
              {!folded && <div className="space-y-1">{routes.map(renderRoute)}</div>}
            </div>
          )
        })}

        <div className="space-y-1">
          {folders.length > 0 && (
            <div className="px-1.5 py-1 text-[11px] text-faint">
              未分类 · {live.filter((b) => !b.folder).length}
            </div>
          )}
          {live.filter((b) => !b.folder).map(renderRoute)}
        </div>

        {archived.length > 0 && (
          <div className="pt-1">
            <button
              onClick={() => setShowArchived(!showArchived)}
              className="flex w-full items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-faint transition-colors hover:bg-surface-3 hover:text-muted"
            >
              <ChevronDown
                size={11}
                className={cn('transition-transform', !showArchived && '-rotate-90')}
              />
              已归档 · {archived.length}
            </button>
            {showArchived &&
              archived.map((b) => (
                <div
                  key={b.id}
                  className="mt-1 flex items-center gap-1 rounded-lg border border-dashed border-line px-2.5 py-1.5"
                >
                  <span className="min-w-0 flex-1 truncate text-[11px] text-faint line-through">
                    {b.jobTitle}
                  </span>
                  <button
                    onClick={() => restoreBoard(b.id)}
                    className="flex items-center gap-1 rounded-md border border-line px-1.5 py-[2px] text-[10px] text-muted transition-colors hover:bg-surface-3 hover:text-ink"
                  >
                    <RotateCcw size={9} />
                    恢复
                  </button>
                </div>
              ))}
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-line/70 p-2.5 pb-3">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') create()
          }}
          placeholder="新路线的名字（回车新建）"
          className="field h-8 px-2.5 text-[12px]"
        />
        <button onClick={create} className="btn btn-ink mt-2 h-8 w-full text-[12px]">
          <Plus size={12} />
          新建一条路线
        </button>

        <div className="mt-1 flex gap-1.5">
          <button
            onClick={() => {
              const blob = new Blob([exportData()], { type: 'application/json' })
              const a = document.createElement('a')
              a.href = URL.createObjectURL(blob)
              a.download = '工作路线-数据.json'
              a.click()
              URL.revokeObjectURL(a.href)
              toast('已导出全部路线数据')
            }}
            title="导出全部路线（换电脑/换浏览器时用）"
            className="flex flex-1 items-center justify-center gap-1 rounded-lg py-1.5 text-[11px] text-faint transition-colors hover:bg-surface-3 hover:text-ink"
          >
            <Download size={10} />
            导出数据
          </button>
          <button
            onClick={() => fileRef.current?.click()}
            title="导入别的浏览器导出的路线数据"
            className="flex flex-1 items-center justify-center gap-1 rounded-lg py-1.5 text-[11px] text-faint transition-colors hover:bg-surface-3 hover:text-ink"
          >
            <Upload size={10} />
            导入数据
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={async (e) => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (!file) return
              const text = await file.text()
              const r = importData(text)
              if (r.boards) toast(`导入了 ${r.boards} 条路线、${r.focus} 条重点`)
              else toast('这个文件读不出来')
            }}
          />
        </div>
      </div>
        </div>
      )}

      {previewBoardId &&
        (() => {
          const board = boards.find((b) => b.id === previewBoardId)
          if (!board) return null
          return (
            <div
              className="fixed z-[60] flex max-h-[72vh] w-[300px] flex-col overflow-hidden rounded-[16px] border border-line/70 bg-surface shadow-e3 anim-pop"
              style={{ right: open ? 'calc(clamp(210px, 13vw, 260px) + 12px)' : 42, top: 96 }}
              onDragOver={(e) => e.preventDefault()}
            >
              <div className="border-b border-line/70 px-3 py-2">
                <div className="truncate text-[12px] font-semibold">落到「{board.jobTitle}」</div>
                <div className="mt-0.5 text-[10px] leading-snug text-faint">
                  拖到某张卡片上 = 变成它的并行子任务
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
                <div
                  onDragOver={(e) => {
                    e.preventDefault()
                    setPreviewDropId('__tail__')
                  }}
                  onDragLeave={() => setPreviewDropId((cur) => (cur === '__tail__' ? null : cur))}
                  onDrop={(e) => crossDrop(e, null)}
                  className={cn(
                    'mb-1 cursor-pointer rounded-md border border-dashed px-2 py-1.5 text-[10.5px] transition-colors',
                    previewDropId === '__tail__'
                      ? 'border-accent-line bg-accent-soft text-accent-ink'
                      : 'border-line text-faint hover:bg-surface-3',
                  )}
                >
                  放到这条路线末尾
                </div>
                {previewTree.map(({ node, depth }) => (
                  <div
                    key={node.id}
                    onDragOver={(e) => {
                      e.preventDefault()
                      setPreviewDropId(node.id)
                    }}
                    onDragLeave={() => setPreviewDropId((cur) => (cur === node.id ? null : cur))}
                    onDrop={(e) => crossDrop(e, node.id)}
                    style={{ paddingLeft: 10 + depth * 14 }}
                    className={cn(
                      'flex cursor-pointer items-center gap-1 rounded-md px-1.5 py-1 text-[11px] transition-colors',
                      previewDropId === node.id
                        ? 'bg-accent-soft text-accent-ink ring-1 ring-accent-line'
                        : 'text-ink-2 hover:bg-surface-3',
                    )}
                  >
                    {depth > 0 && <span className="shrink-0 text-faint">·</span>}
                    <span className="min-w-0 flex-1 truncate">{node.title}</span>
                    <span className="shrink-0 text-[9px] text-faint">L{node.level}</span>
                  </div>
                ))}
                {!previewTree.length && (
                  <p className="px-2 py-3 text-center text-[10.5px] text-faint">
                    这条路线还是空的，会作为新的目标
                  </p>
                )}
              </div>
            </div>
          )
        })()}

      {folderMenuBoardId &&
        (() => {
          const targetBoard = boards.find((b) => b.id === folderMenuBoardId)
          if (!targetBoard) return null
          const moveTo = (folder: string) => {
            setBoardFolder(folderMenuBoardId, folder)
            setFolderMenuBoardId(null)
            setFolderMenuDraft('')
            toast(`已归到「${folder || '未分类'}」`)
          }
          return (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setFolderMenuBoardId(null)} />
              <div
                className="fixed z-50 w-[204px] overflow-hidden rounded-[14px] border border-line/70 bg-surface p-1.5 shadow-e3 anim-pop"
                style={{ right: 'calc(clamp(210px, 13vw, 260px) + 14px)', top: 132 }}
              >
                <div className="truncate px-2 pt-1 pb-1.5 text-[10.5px] text-faint">
                  把「{targetBoard.jobTitle}」放到
                </div>
                <button
                  onClick={() => moveTo('')}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12px] text-ink-2 transition-colors hover:bg-surface-3"
                >
                  <Folder size={12} className="shrink-0" />
                  未分类
                </button>
                {folders.map((f) => (
                  <button
                    key={f}
                    onClick={() => moveTo(f)}
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12px] text-ink-2 transition-colors hover:bg-surface-3"
                  >
                    <Folder size={12} className="shrink-0" />
                    <span className="truncate">{f}</span>
                  </button>
                ))}
                <div className="my-1 h-px bg-line/70" />
                <div className="flex items-center gap-1 px-1 pb-1">
                  <input
                    value={folderMenuDraft}
                    onChange={(e) => setFolderMenuDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        const name = folderMenuDraft.trim()
                        if (!name) return
                        addFolder(name)
                        moveTo(name)
                      }
                    }}
                    placeholder="新建文件夹并放入"
                    className="field h-7 min-w-0 flex-1 px-2 text-[11px]"
                  />
                  <button
                    onClick={() => {
                      const name = folderMenuDraft.trim()
                      if (!name) return
                      addFolder(name)
                      moveTo(name)
                    }}
                    className="rounded-md bg-ink px-2 py-[3px] text-[11px] text-white"
                  >
                    建
                  </button>
                </div>
              </div>
            </>
          )
        })()}

    </div>
  )
}