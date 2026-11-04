import { useEffect, useRef, useState } from 'react'
import { RoutePage } from './pages/RoutePage'
import { AgentRail } from './components/agent/AgentRail'
import { FlyingMark } from './components/FlyingMark'
import { Toaster } from './components/Toaster'
import { useMedia } from '@/lib/useMedia'
import { cn } from '@/lib/cn'

/** 这个宽度以下，助手改成浮层，不再挤占路线图 */
const WIDE_QUERY = '(min-width: 1180px)'
/** 标飞一趟花多久（展开 / 收起分开定，收起快一点） */
const FLY_IN = 300
const FLY_OUT = 260
/** 面板头像的位置：头部 56 高、头像 30 居中 → top 13；面板 px-3.5 → left 14 */
const AVATAR_SIZE = 30
const AVATAR_TOP = 13
const AVATAR_LEFT = 14

/**
 * 工作路线：路线图 + 左边常驻的路线助手。
 *
 * 助手的收放沿用比赛项目那套：图标从顶部「问助手」按钮飞到面板头像，
 * 收起时再飞回去；面板本身做宽度 + 淡出过渡，不硬切。
 */
export default function App() {
  const wide = useMedia(WIDE_QUERY)
  const [agentOpen, setAgentOpen] = useState(() => {
    if (typeof window === 'undefined') return false
    try {
      const saved = localStorage.getItem('work-route-agent-open')
      if (saved === '1') return true
      if (saved === '0') return false
    } catch {
      /* ignore */
    }
    return window.matchMedia(WIDE_QUERY).matches
  })
  const rememberAgentOpen = (v: boolean) => {
    try {
      localStorage.setItem('work-route-agent-open', v ? '1' : '0')
    } catch {
      /* ignore */
    }
  }
  const [closing, setClosing] = useState(false)
  const [entered, setEntered] = useState(false)
  const [flight, setFlight] = useState<{ from: DOMRect; to: DOMRect; ms: number } | null>(null)
  const timers = useRef<number[]>([])
  const clearTimers = () => {
    for (const t of timers.current) window.clearTimeout(t)
    timers.current = []
  }
  useEffect(() => () => clearTimers(), [])

  useEffect(() => {
    if (!agentOpen) {
      setEntered(false)
      return
    }
    const id = window.requestAnimationFrame(() => setEntered(true))
    return () => window.cancelAnimationFrame(id)
  }, [agentOpen])

  const entryRect = () =>
    document.querySelector('[data-agent-entry-icon]')?.getBoundingClientRect() ?? null

  const openAgent = () => {
    clearTimers()
    rememberAgentOpen(true)
    setClosing(false)
    const from = entryRect()
    if (wide && from) {
      setFlight({ from, to: new DOMRect(AVATAR_LEFT, AVATAR_TOP, AVATAR_SIZE, AVATAR_SIZE), ms: FLY_IN })
      setAgentOpen(true)
      timers.current.push(window.setTimeout(() => setFlight(null), FLY_IN + 60))
    } else {
      setAgentOpen(true)
    }
  }

  const closeAgent = () => {
    if (closing) return
    clearTimers()
    rememberAgentOpen(false)
    const from = document.querySelector('[data-agent-avatar]')?.getBoundingClientRect() ?? null
    const to = entryRect()
    const ms = wide && from && to ? FLY_OUT : 0
    setClosing(true)
    if (ms > 0) {
      setFlight({ from: from as DOMRect, to: to as DOMRect, ms })
      timers.current.push(
        window.setTimeout(() => {
          setAgentOpen(false)
          setClosing(false)
          setFlight(null)
        }, ms + 60),
      )
    } else {
      timers.current.push(
        window.setTimeout(() => {
          setAgentOpen(false)
          setClosing(false)
        }, 240),
      )
    }
  }

  return (
    <div className="app-canvas flex h-full overflow-hidden">
      {agentOpen &&
        (wide ? (
          <div
            className={cn(
              'h-full shrink-0 overflow-hidden',
              'transition-[width] duration-[260ms] ease-[cubic-bezier(0.22,1,0.36,1)]',
              closing || !entered ? 'w-0' : 'w-[clamp(320px,23vw,380px)]',
            )}
          >
            <AgentRail closing={closing} flying={!!flight} onClose={closeAgent} />
          </div>
        ) : (
          <AgentRail floating closing={closing} onClose={closeAgent} />
        ))}

      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <RoutePage
          agentOpen={agentOpen}
          flying={!!flight}
          onToggleAgent={agentOpen ? closeAgent : openAgent}
        />
      </main>

      {flight && <FlyingMark from={flight.from} to={flight.to} duration={flight.ms} />}
      <Toaster />
    </div>
  )
}
