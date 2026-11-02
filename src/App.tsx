import { useEffect, useRef, useState } from 'react'
import { RoutePage } from './pages/RoutePage'
import { AgentRail } from './components/agent/AgentRail'
import { Toaster } from './components/Toaster'
import { useUi } from './store/ui'
import { useMedia } from '@/lib/useMedia'
import { cn } from '@/lib/cn'

/** 这个宽度以下，助手改成浮层，不再挤占路线图 */
const WIDE_QUERY = '(min-width: 1180px)'

export default function App() {
  const agentOpen = useUi((s) => s.agentOpen)
  const setAgentOpen = useUi((s) => s.setAgentOpen)
  const wide = useMedia(WIDE_QUERY)

  const [closing, setClosing] = useState(false)
  const [entered, setEntered] = useState(false)
  const timer = useRef<number | null>(null)

  useEffect(() => {
    if (!agentOpen) {
      setEntered(false)
      return
    }
    const id = window.requestAnimationFrame(() => setEntered(true))
    return () => window.cancelAnimationFrame(id)
  }, [agentOpen])

  const closeAgent = () => {
    if (closing) return
    setClosing(true)
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      setAgentOpen(false)
      setClosing(false)
      timer.current = null
    }, 240)
  }

  return (
    <div className="app-canvas flex h-full overflow-hidden">
      {agentOpen &&
        (wide ? (
          <div
            className={cn(
              'h-full shrink-0 overflow-hidden will-change-[width]',
              'transition-[width] duration-[260ms] ease-[cubic-bezier(0.22,1,0.36,1)]',
              closing || !entered ? 'w-0' : 'w-[clamp(320px,23vw,380px)]',
            )}
          >
            <AgentRail closing={closing} onClose={closeAgent} />
          </div>
        ) : (
          <AgentRail floating closing={closing} onClose={closeAgent} />
        ))}

      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <RoutePage />
      </main>

      <Toaster />
    </div>
  )
}
