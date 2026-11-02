import { useRef, useState } from 'react'
import {
  Archive,
  Check,
  ChevronDown,
  Download,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
  Upload,
} from 'lucide-react'
import { actionProgress, useActions } from '@/store/actions'
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
  const renameBoard = useActions((s) => s.renameBoard)
  const exportData = useActions((s) => s.exportData)
  const importData = useActions((s) => s.importData)
  const toast = useUi((s) => s.showToast)

  const [confirmId, setConfirmId] = useState<string | null>(null)
  /** 拖拽悬停在哪条路线上（跨路线搬家用） */
  const [dropBoardId, setDropBoardId] = useState<string | null>(null)
  const [showArchived, setShowArchived] = useState(false)
  const [draft, setDraft] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const live = boards.filter((b) => !b.archived)
  const archived = boards.filter((b) => b.archived)

  const create = () => {
    const title = draft.trim() || '新路线'
    addBoard({ jobTitle: title, jobCity: '', label: '' })
    setDraft('')
    toast(`已新建「${title}」，现在可以加第一个目标`)
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

  return (
    <div className="flex w-[clamp(210px,13vw,260px)] shrink-0 flex-col overflow-hidden border-l border-line bg-surface-2">
      <div className="flex h-[56px] shrink-0 items-center justify-between border-b border-line/70 px-3">
        <span className="label">路线 · {live.length}</span>
      </div>

      <div className="flex-1 space-y-1 overflow-y-auto p-1.5">
        {live.map((b) => {
          const active = b.id === activeId
          const progress = actionProgress(b.nodes)
          return (
            <div
              key={b.id}
              onDragOver={(e) => {
                if (!e.dataTransfer.types.includes('application/x-route-node')) return
                if (b.id === activeId) return
                e.preventDefault()
                e.dataTransfer.dropEffect = 'move'
                setDropBoardId(b.id)
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
        })}

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
  )
}
