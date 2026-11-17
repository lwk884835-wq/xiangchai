import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, RefreshCw, RotateCcw } from 'lucide-react'
import { cn } from '@/lib/cn'

/**
 * 更新按钮：只在带 /api/version 的本地稳定版服务里出现，纯静态部署自动隐藏。
 *
 * - 平时是个不起眼的小圆点；检测到远端有新提交时变亮 + 提示
 * - 点击后轮询 /api/version 的 update 状态；服务被重启期间请求会失败，忽略继续轮询
 * - 收到 done 且部署版本变了就自动刷新；收到 error 显示原因，可点重试
 */
type UpdatePhase = 'idle' | 'running' | 'done' | 'error'
type UpdateInfo = {
  phase: UpdatePhase
  message?: string
  from?: string
  to?: string
  at?: number
}
type VersionInfo = {
  deployed: string | null
  remote: string | null
  hasUpdate: boolean
  updateRunning: boolean
  update: UpdateInfo
  error?: string | null
}
type Status = 'hidden' | 'quiet' | 'available' | 'updating' | 'done' | 'error'

export function UpdateButton() {
  const [status, setStatus] = useState<Status>('hidden')
  const [info, setInfo] = useState<VersionInfo | null>(null)
  const [tip, setTip] = useState('')
  const [tick, setTick] = useState(0)
  const pollRef = useRef<number | null>(null)
  const startedVersion = useRef<string | null>(null)
  const phaseRef = useRef<Status>('hidden')
  const setPhase = (next: Status) => {
    phaseRef.current = next
    setStatus(next)
  }

  const load = useCallback(async (force = false) => {
    try {
      const res = await fetch(`/api/version${force ? '?force=1' : ''}`, { cache: 'no-store' })
      if (!res.ok) throw new Error('no api')
      const data = (await res.json()) as VersionInfo
      setInfo(data)
      // 更新进行中 / 刚完成：状态由轮询分支管，别让周期检查覆盖掉
      if (phaseRef.current === 'updating' || phaseRef.current === 'done') return data
      const phase = data.update?.phase
      if (phase === 'error') {
        setPhase('error')
        setTip(data.update.message ?? '更新失败')
      } else if (data.hasUpdate) {
        setPhase('available')
        setTip(`有新版本：${data.deployed} → ${data.remote}，点击更新`)
      } else {
        setPhase('quiet')
        setTip(`已是最新版本${data.deployed ? ` ${data.deployed}` : ''} · 点此重新检查`)
      }
      return data
    } catch {
      setPhase('hidden')
      return null
    }
  }, [])

  useEffect(() => {
    void load()
    const timer = window.setInterval(() => void load(), 60_000)
    return () => {
      window.clearInterval(timer)
      if (pollRef.current) window.clearInterval(pollRef.current)
    }
  }, [load, tick])

  const trigger = async () => {
    if (phaseRef.current === 'updating') return
    try {
      const res = await fetch('/api/update', { method: 'POST' })
      if (!res.ok) throw new Error('无法启动更新')
      startedVersion.current = info?.deployed ?? null
      setPhase('updating')
      setTip('正在更新，服务可能会重启一会儿…')

      let ticks = 0
      if (pollRef.current) window.clearInterval(pollRef.current)
      pollRef.current = window.setInterval(async () => {
        ticks++
        if (ticks > 150) {
          if (pollRef.current) window.clearInterval(pollRef.current)
          setPhase('error')
          setTip('更新超时，请看 /tmp/work-route-stable.log 和 data/update-state.json')
          return
        }
        try {
          const r = await fetch('/api/version', { cache: 'no-store' })
          if (!r.ok) return // 服务重启中，忽略
          const data = (await r.json()) as VersionInfo
          setInfo(data)
          const phase = data.update?.phase
          if (phase === 'error') {
            if (pollRef.current) window.clearInterval(pollRef.current)
            setPhase('error')
            setTip(data.update.message ?? '更新失败')
          } else if (phase === 'done') {
            if (pollRef.current) window.clearInterval(pollRef.current)
            if (data.deployed && startedVersion.current && data.deployed !== startedVersion.current) {
              setPhase('done')
              setTip(`已更新 ${startedVersion.current} → ${data.deployed}，即将刷新`)
              window.setTimeout(() => window.location.reload(), 700)
            } else {
              setPhase('quiet')
              setTip(data.update.message ?? '更新完成，已是最新')
            }
          } else if (phase === 'running') {
            setTip(data.update.message ?? '正在更新…')
          }
        } catch {
          /* 服务重启中 */
        }
      }, 2000)
    } catch {
      setPhase('error')
      setTip('无法启动更新，请确认 5180 服务在运行')
    }
  }

  // 小圆点 / 失败态：点一下强制重新检查
  const recheck = () => {
    startedVersion.current = null
    setPhase('quiet')
    setTip('正在检查更新…')
    setTick((n) => n + 1)
    void load(true)
  }

  if (status === 'hidden') return null

  if (status === 'quiet') {
    return (
      <button
        onClick={recheck}
        title={tip}
        aria-label="检查更新"
        className="flex h-[32px] w-[32px] shrink-0 items-center justify-center rounded-full border border-line/70 bg-surface text-faint transition-colors hover:border-line-2 hover:text-muted"
      >
        <span className="h-[7px] w-[7px] rounded-full bg-ok/70" />
      </button>
    )
  }

  return (
    <button
      onClick={() => void (status === 'error' ? recheck() : trigger())}
      disabled={status === 'updating'}
      title={tip}
      className={cn(
        'flex h-[32px] shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-[11px] font-medium transition-colors',
        status === 'available' && 'border-accent/50 bg-accent-soft text-accent-ink hover:bg-accent/20',
        status === 'updating' && 'cursor-wait border-line/70 bg-surface text-muted',
        status === 'done' && 'border-ok/50 bg-ok/10 text-ok',
        status === 'error' && 'border-danger/50 bg-danger/10 text-danger',
      )}
    >
      {status === 'updating' ? (
        <RefreshCw size={12} className="animate-spin" />
      ) : status === 'done' ? (
        <Check size={12} />
      ) : status === 'error' ? (
        <RotateCcw size={12} />
      ) : (
        <span className="h-[7px] w-[7px] rounded-full bg-accent" />
      )}
      {status === 'available'
        ? '有新版本'
        : status === 'updating'
          ? '更新中'
          : status === 'done'
            ? '已更新'
            : '重试检查'}
    </button>
  )
}
