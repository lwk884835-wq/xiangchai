import { useEffect, useRef, useState } from 'react'
import { ArrowUp, Sparkles, Square, Wand2 } from 'lucide-react'
import { cn } from '@/lib/cn'

const QUICK = [
  { label: '排一条新路线', prompt: '帮我排一条新的行动路线。我想做的事是：' },
  { label: '整理现在的路线', prompt: '帮我看一下现在这条路线，层级和并行关系有没有问题，需要改的地方直接改。' },
]

export function Composer({
  onSend,
  onStop,
  busy,
}: {
  onSend: (text: string) => void
  onStop: () => void
  busy: boolean
}) {
  const [value, setValue] = useState('')
  const ref = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`
  }, [value])

  const submit = () => {
    const text = value.trim()
    if (!text || busy) return
    onSend(text)
    setValue('')
  }

  return (
    <div className="border-t border-line bg-surface-2 px-3 pt-2 pb-2.5">
      <div className="relative rounded-[14px] border border-line bg-surface shadow-e1 transition-colors focus-within:border-line-2">
        <div className="flex items-center gap-0.5 px-1.5 pt-1.5">
          {QUICK.map(({ label, prompt }) => (
            <button
              key={label}
              onClick={() => onSend(prompt)}
              disabled={busy}
              className="flex h-[26px] items-center gap-1 rounded-md px-1.5 text-[11.5px] text-muted transition-colors hover:bg-surface-3 hover:text-ink disabled:opacity-50"
            >
              {label.startsWith('排') ? <Sparkles size={12} strokeWidth={1.9} /> : <Wand2 size={12} strokeWidth={1.9} />}
              {label}
            </button>
          ))}
        </div>

        <textarea
          ref={ref}
          rows={1}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              submit()
            }
          }}
          placeholder="说说你想做成什么，或者哪里想改…"
          className="max-h-[120px] w-full resize-none bg-transparent px-3 pt-1.5 pb-1 text-[13px] leading-[1.7] placeholder:text-faint"
        />

        <div className="flex items-center gap-2 px-2 pb-2">
          <span className="shrink-0 text-[10.5px] whitespace-nowrap text-faint">
            {busy ? '正在处理…' : 'Enter 发送 · Shift+Enter 换行'}
          </span>
          {busy ? (
            <button
              onClick={onStop}
              title="停止生成"
              aria-label="停止生成"
              className="ml-auto flex h-[28px] w-[28px] shrink-0 items-center justify-center rounded-full bg-ink text-on-ink transition-all hover:bg-ink-hover"
            >
              <Square size={9} fill="currentColor" strokeWidth={0} />
            </button>
          ) : (
            <button
              onClick={submit}
              disabled={!value.trim()}
              title="发送（Enter）"
              className={cn(
                'ml-auto flex h-[28px] w-[28px] shrink-0 items-center justify-center rounded-full transition-all',
                value.trim() ? 'bg-ink text-on-ink hover:bg-ink-hover' : 'bg-surface-3 text-faint',
              )}
            >
              <ArrowUp size={14} strokeWidth={2.4} />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
