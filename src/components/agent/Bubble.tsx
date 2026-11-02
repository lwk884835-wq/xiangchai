import { useEffect, useRef, useState } from 'react'
import { Brain, ChevronDown, Pencil, Square, Wrench } from 'lucide-react'
import type { Message } from '@/types'
import { cn } from '@/lib/cn'

/** 极简 Markdown：只认 **加粗**，其余按原文渲染 */
function Markup({ text }: { text: string }) {
  return (
    <>
      {text.split('\n\n').map((block, bi) => (
        <p key={bi} className={cn(bi > 0 && 'mt-2.5')}>
          {block.split('\n').map((line, li) => (
            <span key={li}>
              {li > 0 && <br />}
              {line.split(/(\*\*[^*]+\*\*)/g).map((part, pi) =>
                part.startsWith('**') && part.endsWith('**') ? (
                  <strong key={pi} className="font-semibold text-ink">
                    {part.slice(2, -2)}
                  </strong>
                ) : (
                  <span key={pi}>{part}</span>
                ),
              )}
            </span>
          ))}
        </p>
      ))}
    </>
  )
}

function Thinking({
  reasoning,
  streaming,
  defaultOpen = false,
}: {
  reasoning?: string
  streaming?: boolean
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(!!streaming || defaultOpen)
  const body = useRef<HTMLDivElement>(null)
  const text = reasoning ?? ''

  useEffect(() => {
    if (streaming && open && body.current) body.current.scrollTop = body.current.scrollHeight
  }, [text, streaming, open])

  return (
    <div className="mt-0.5">
      <button
        onClick={() => setOpen(!open)}
        className="group flex items-center gap-1.5 rounded-md py-0.5 text-[11.5px] text-faint transition-colors hover:text-muted"
      >
        <Brain size={12} strokeWidth={2} />
        <span>{streaming ? (text ? '正在想…' : '正在想') : '思考过程'}</span>
        {streaming && (
          <span className="flex gap-0.5">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="h-[3px] w-[3px] rounded-full bg-faint"
                style={{ animation: `breathe 1.2s ease-in-out ${i * 0.16}s infinite` }}
              />
            ))}
          </span>
        )}
        <ChevronDown size={11} className={cn('transition-transform duration-200', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="mt-1.5 border-l border-line-2 pl-2.5">
          <div
            ref={body}
            className="max-h-[176px] overflow-y-auto pr-1 text-[11.5px] leading-[1.75] whitespace-pre-wrap text-muted"
          >
            {text || '…'}
          </div>
        </div>
      )}
    </div>
  )
}

export function Bubble({
  msg,
  onEdit,
  keepThinkingOpen,
}: {
  msg: Message
  onEdit?: (id: string, text: string) => void
  /** 刚落库的这一条：思考块保持展开，别在收尾时塌下去 */
  keepThinkingOpen?: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  if (msg.role === 'user') {
    if (editing) {
      return (
        <div className="anim-fade-up flex justify-end">
          <div className="w-full max-w-[92%]">
            <textarea
              autoFocus
              value={draft}
              rows={Math.min(8, Math.max(2, draft.split('\n').length))}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.preventDefault()
                  setEditing(false)
                }
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault()
                  if (draft.trim()) {
                    onEdit?.(msg.id, draft.trim())
                    setEditing(false)
                  }
                }
              }}
              className="w-full resize-none rounded-[13px] border border-accent-line bg-surface px-3 py-2 text-[13px] leading-[1.7] text-ink ring-2 ring-accent-soft"
            />
            <div className="mt-1.5 flex items-center justify-end gap-1.5">
              <span className="mr-auto text-[10.5px] text-faint">改完会从这里重新问</span>
              <button
                onClick={() => setEditing(false)}
                className="rounded-md px-2 py-1 text-[11px] text-muted transition-colors hover:bg-surface-3 hover:text-ink"
              >
                取消
              </button>
              <button
                onClick={() => {
                  if (!draft.trim()) return
                  onEdit?.(msg.id, draft.trim())
                  setEditing(false)
                }}
                disabled={!draft.trim()}
                className="rounded-md bg-ink px-2.5 py-1 text-[11px] text-white transition-colors hover:bg-[#2b2930] disabled:opacity-40"
              >
                重新发送
              </button>
            </div>
          </div>
        </div>
      )
    }

    return (
      <div className="group flex items-center justify-end gap-1 anim-fade-up">
        {onEdit && !!msg.text && (
          <button
            onClick={() => {
              setDraft(msg.text)
              setEditing(true)
            }}
            title="改一下这条提问"
            aria-label="编辑这条提问"
            className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded text-faint opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 hover:bg-surface-3 hover:text-ink"
          >
            <Pencil size={11} />
          </button>
        )}
        <div className="max-w-[86%] rounded-[13px] rounded-br-[6px] bg-accent-soft px-3 py-[7px] text-[13px] leading-[1.7] text-accent-ink ring-1 ring-accent-line/70">
          {msg.text}
        </div>
      </div>
    )
  }

  return (
    <div className="anim-fade-up">
      {msg.reasoning ? (
        <Thinking reasoning={msg.reasoning} streaming={msg.streaming} defaultOpen={keepThinkingOpen} />
      ) : null}

      {!!msg.tools?.length && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {msg.tools.map((tool, i) => (
            <span
              key={i}
              className="inline-flex max-w-full items-center gap-1 rounded-[5px] border border-line bg-surface-2 px-1.5 py-[2px] text-[10.5px] text-muted"
            >
              <Wrench size={9} className="shrink-0 text-faint" />
              <span className="shrink-0 text-ink-2">{tool.name}</span>
              <span className="text-faint">·</span>
              <span className="truncate">{tool.result}</span>
            </span>
          ))}
        </div>
      )}

      {msg.stopped && (
        <div className="mt-1.5 inline-flex items-center gap-1 rounded-[4px] border border-line bg-surface-2 px-1.5 py-[1px] text-[9.5px] text-faint">
          <Square size={7} fill="currentColor" strokeWidth={0} />
          已停止生成
        </div>
      )}

      {msg.truncated && (
        <div className="mt-1.5 inline-flex items-center gap-1 rounded-[4px] bg-warn-soft px-1.5 py-[1px] text-[9.5px] text-warn">
          回答被截断 · 这轮没写完
        </div>
      )}

      {msg.text && (
        <div className="text-[13px] leading-[1.85] text-ink-2">
          <span className={msg.streaming ? 'caret' : undefined}>
            <Markup text={msg.text} />
          </span>
        </div>
      )}
    </div>
  )
}
