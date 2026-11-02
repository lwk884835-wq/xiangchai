import { useCallback, useEffect, useRef, useState } from 'react'
import { MoreHorizontal, PanelLeftClose, RotateCcw } from 'lucide-react'
import type { Message, ToolCall } from '@/types'
import { useChat } from '@/store/chat'
import { useUi } from '@/store/ui'
import { runTool, TOOLS, buildSystemPrompt } from '@/lib/tools'
import { streamChat, type ApiMessage } from '@/lib/llm'
import { stripDsl } from '@/lib/dsl'
import { cn } from '@/lib/cn'
import { Bubble } from './Bubble'
import { RouteMark } from '../RouteMark'
import { Composer } from './Composer'

const MODEL = 'deepseek-flash'
/** 带多少条历史给模型：这个工具对话都比较短，24 条够用又不至于太贵 */
const HISTORY_LIMIT = 24

interface Live {
  reasoning: string
  text: string
  tools: ToolCall[]
}

/**
 * 路线助手：只做「读路线 / 拆路线 / 改路线」三件事。
 * 没有简历/面试/岗位这些东西，也没有外部检索。
 */
export function AgentRail({
  floating = false,
  onClose,
  closing = false,
  flying = false,
}: {
  floating?: boolean
  onClose: () => void
  closing?: boolean
  /** 标正在飞：面板头像先藏起来，让飞行体独占 */
  flying?: boolean
}) {
  const messages = useChat((s) => s.messages)
  const hydrate = useChat((s) => s.hydrate)
  const toast = useUi((s) => s.showToast)

  const [live, setLive] = useState<Live | null>(null)
  const [busy, setBusy] = useState(false)
  const [menu, setMenu] = useState(false)
  const [lastSavedId, setLastSavedId] = useState<string | null>(null)
  const busyRef = useRef(false)
  const abortRef = useRef<AbortController | null>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const pinned = useRef(true)

  useEffect(() => {
    void hydrate()
  }, [hydrate])

  /** 一次完整的发送：模型流式输出 → 需要时调工具 → 继续生成 → 落库 */
  const send = useCallback(
    async (raw: string) => {
      const text = raw.trim()
      if (!text || busyRef.current) return
      busyRef.current = true
      setBusy(true)

      useChat.getState().add({ role: 'user', text })

      const system = buildSystemPrompt()
      const all = useChat.getState().messages.filter((m) => m.text.trim())
      const history: ApiMessage[] = all.slice(-HISTORY_LIMIT).map((m) => ({
        role: m.role === 'user' ? 'user' : 'assistant',
        content: m.text,
      }))
      const apiMessages: ApiMessage[] = [{ role: 'system', content: system }, ...history]
      setLive({ reasoning: '', text: '', tools: [] })

      let collected = ''
      let streamed = ''
      let reasoning = ''
      let truncated = false
      const traces: ToolCall[] = []

      const ctrl = new AbortController()
      abortRef.current = ctrl

      try {
        for (let round = 0; round < 5; round++) {
          const res = await streamChat(
            { model: MODEL, messages: apiMessages, tools: TOOLS, signal: ctrl.signal },
            {
              onReasoning: (delta) => {
                reasoning += delta
                setLive((p) => (p ? { ...p, reasoning: p.reasoning + delta } : p))
              },
              onText: (delta) => {
                streamed += delta
                setLive((p) => (p ? { ...p, text: p.text + delta } : p))
              },
            },
          )
          if (res.finishReason === 'length') truncated = true
          collected += res.text
          apiMessages.push({
            role: 'assistant',
            content: res.text,
            tool_calls: res.toolCalls.length ? res.toolCalls : undefined,
          })
          if (!res.toolCalls.length) break

          for (const call of res.toolCalls) {
            const out = await runTool(call.function.name, call.function.arguments)
            traces.push({ name: out.label, result: out.note })
            setLive((p) => (p ? { ...p, tools: [...traces] } : p))
            apiMessages.push({ role: 'tool', tool_call_id: call.id, content: out.result })
          }
        }

        // 工具调完没说话：再要一句总结
        if (!collected.trim()) {
          const wrap = await streamChat(
            { model: MODEL, messages: apiMessages, signal: ctrl.signal },
            {
              onText: (delta) => {
                streamed += delta
                setLive((p) => (p ? { ...p, text: p.text + delta } : p))
              },
            },
          )
          if (wrap.finishReason === 'length') truncated = true
          collected += wrap.text
        }

        const body = collected.trim()
        const saved = useChat.getState().add({
          role: 'agent',
          text:
            truncated && !body
              ? '这轮被字数上限截断了：想一次把改动全写进工具调用，写到一半就断了。让我分小块改。'
              : body || '我这边没组织好回答，你换个说法再试一次？',
          reasoning: reasoning.trim() || undefined,
          tools: traces.length ? traces : undefined,
          truncated: truncated || undefined,
        })
        setLastSavedId(saved.id)
        setLive(null)
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') {
          const keptText = stripDsl(streamed).trim()
          if (keptText || reasoning.trim() || traces.length) {
            const saved = useChat.getState().add({
              role: 'agent',
              text: keptText,
              reasoning: reasoning.trim() || undefined,
              tools: traces.length ? traces : undefined,
              stopped: true,
            })
            setLastSavedId(saved.id)
          } else {
            toast('已停止生成')
          }
          setLive(null)
          return
        }
        console.error('[agent] 调用失败：', err)
        useChat.getState().add({
          role: 'agent',
          text: '模型接口没连上。检查一下 `.env.local` 里的 DEEPSEEK_API_KEY，然后刷新页面再试；路线本身不受影响，手动也能改。',
        })
        setLive(null)
      } finally {
        abortRef.current = null
        busyRef.current = false
        setBusy(false)
      }
    },
    [toast],
  )

  const stop = useCallback(() => abortRef.current?.abort(), [])

  const editMessage = useCallback(
    (id: string, text: string) => {
      useChat.getState().truncateFrom(id)
      void send(text)
    },
    [send],
  )

  useEffect(() => {
    const el = scroller.current
    if (!el || !pinned.current) return
    el.scrollTop = el.scrollHeight
  }, [messages.length, live?.text, live?.reasoning, live?.tools.length])

  const liveMsg: Message | null = live
    ? {
        id: 'live',
        role: 'agent',
        text: live.text,
        reasoning: live.reasoning || undefined,
        tools: live.tools.length ? live.tools : undefined,
        streaming: true,
        ts: 0,
      }
    : null

  return (
    <>
      {floating && (
        <div
          className={cn(
            'fixed inset-0 z-30 bg-ink/25',
            closing ? 'anim-fade-out' : 'anim-fade-in',
          )}
          onClick={onClose}
          aria-hidden
        />
      )}
      <aside
        className={cn(
          'flex flex-col border-r border-line bg-surface-2',
          closing ? 'anim-panel-leave' : 'anim-panel-enter',
          floating
            ? 'fixed inset-y-0 left-0 z-40 w-[min(380px,calc(100vw-24px))] shadow-[0_12px_44px_rgba(23,22,26,.24)]'
            : 'h-full w-[clamp(320px,23vw,380px)] shrink-0',
        )}
      >
        <div className="flex h-[56px] shrink-0 items-center gap-2.5 border-b border-line px-3.5">
          <span data-agent-avatar className={cn('shrink-0', flying && 'invisible')}>
            <RouteMark size={30} className="shadow-[0_2px_6px_rgba(23,22,26,.18)]" />
          </span>
          <div className="min-w-0">
            <div className="truncate text-[13px] leading-tight font-semibold">路线助手</div>
            <div className="mt-[2px] truncate text-[10.5px] text-muted">只帮你拆/改路线</div>
          </div>

          <div className="ml-auto flex shrink-0 items-center gap-0.5">
            <button
              onClick={onClose}
              title="收起助手"
              aria-label="收起助手"
              className="flex h-[26px] w-[26px] items-center justify-center rounded-md text-faint transition-colors hover:bg-surface-3 hover:text-ink"
            >
              <PanelLeftClose size={14} />
            </button>
            <div className="relative">
              <button
                onClick={() => setMenu(!menu)}
                className="flex h-[26px] w-[26px] items-center justify-center rounded-md text-faint transition-colors hover:bg-surface-3 hover:text-ink"
              >
                <MoreHorizontal size={15} />
              </button>
              {menu && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setMenu(false)} />
                  <div className="absolute top-[30px] right-0 z-20 w-[170px] overflow-hidden rounded-[18px] border border-line/70 bg-surface p-1.5 shadow-e3 anim-pop">
                    <button
                      onClick={() => {
                        setMenu(false)
                        void useChat.getState().clear()
                        toast('对话已清空')
                      }}
                      className="flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-[12px] text-muted transition-colors hover:bg-surface-3"
                    >
                      <RotateCcw size={12} /> 清空对话
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        <div
          ref={scroller}
          onScroll={(e) => {
            const el = e.currentTarget
            pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
          }}
          className="flex-1 space-y-4 overflow-y-auto px-3.5 py-4"
        >
          {messages.map((m) => (
            <Bubble key={m.id} msg={m} onEdit={editMessage} keepThinkingOpen={m.id === lastSavedId} />
          ))}
          {liveMsg && <Bubble key="live" msg={liveMsg} />}
        </div>

        <Composer onSend={send} onStop={stop} busy={busy} />
      </aside>
    </>
  )
}
