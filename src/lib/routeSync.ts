import { useActions, type FocusItem } from '@/store/actions'
import type { ActionBoard } from '@/types'

/**
 * 路线数据和本地文件的双向同步（给 MCP / 外部 Agent 用）。
 *
 * - 网页启动时先读 /api/routes：有数据就以文件为准（外部刚改过的也能带进来）
 * - 网页自己的改动防抖 350ms 写回 /api/routes
 * - 订阅 SSE：MCP server 直接改 data/routes.json 时，网页自动刷新
 *
 * 没有这个 API（纯静态部署）时自动跳过，退回原来的 localStorage 行为。
 */

export interface RouteSnapshot {
  version: 1
  updatedAt: number
  boards: ActionBoard[]
  focusItems: FocusItem[]
  collapsed: Record<string, string[]>
  activeBoardId: string | null
}

let started = false

export function startRouteSync(): void {
  if (started || typeof window === 'undefined') return
  started = true

  let enabled = false
  let suppress = 0
  let lastApplied = 0
  let timer: number | null = null

  const snapshot = (): RouteSnapshot => {
    const s = useActions.getState()
    return {
      version: 1,
      updatedAt: Date.now(),
      boards: s.boards,
      focusItems: s.focusItems,
      collapsed: s.collapsed,
      activeBoardId: s.activeBoardId,
    }
  }

  const apply = (snap: RouteSnapshot) => {
    suppress++
    useActions.setState({
      boards: Array.isArray(snap.boards) ? snap.boards : [],
      focusItems: Array.isArray(snap.focusItems) ? snap.focusItems : [],
      collapsed: snap.collapsed && typeof snap.collapsed === 'object' ? snap.collapsed : {},
      activeBoardId: snap.activeBoardId ?? null,
    })
    suppress--
  }

  const loadServer = async (): Promise<RouteSnapshot | null> => {
    try {
      const res = await fetch('/api/routes', { cache: 'no-store' })
      if (!res.ok) return null
      return (await res.json()) as RouteSnapshot
    } catch {
      return null
    }
  }

  const push = async () => {
    if (!enabled) return
    const snap = snapshot()
    lastApplied = snap.updatedAt
    try {
      const res = await fetch('/api/routes', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(snap),
      })
      if (!res.ok) enabled = false
    } catch {
      enabled = false
    }
  }

  const schedulePush = () => {
    if (!enabled || suppress > 0) return
    if (timer) window.clearTimeout(timer)
    timer = window.setTimeout(() => {
      timer = null
      void push()
    }, 350)
  }

  void (async () => {
    // 先探一下有没有数据 API：404 = 有 API 但还没数据；网络错误 = 纯静态，跳过
    let server: RouteSnapshot | null = null
    try {
      const res = await fetch('/api/routes', { cache: 'no-store' })
      if (!res.ok && res.status !== 404) return
      if (res.ok) {
        try {
          server = (await res.json()) as RouteSnapshot
        } catch {
          // 静态托管把未知路径兜底成 index.html：不是数据 API，直接退回 localStorage
          return
        }
      }
    } catch {
      return
    }
    enabled = true

    useActions.subscribe(() => schedulePush())

    if (server && Array.isArray(server.boards)) {
      lastApplied = Number(server.updatedAt ?? 0)
      apply(server)
    } else {
      // 第一次启用 API：把本地已有的数据写成文件
      await push()
    }

    // 外部改了文件（MCP）→ 通知网页重载
    const events = new EventSource('/api/routes/events')
    events.onmessage = async (ev) => {
      if (ev.data !== 'changed') return
      const snap = await loadServer()
      if (!snap) return
      const at = Number(snap.updatedAt ?? 0)
      if (at <= lastApplied) return
      lastApplied = at
      apply(snap)
    }
  })()
}
