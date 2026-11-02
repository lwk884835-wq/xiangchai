import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { startRouteSync } from './lib/routeSync'
import { ErrorBoundary } from './components/ErrorBoundary'
import '@fontsource-variable/inter'
import './index.css'

if (import.meta.env.DEV) {
  // 开发期调试钩子：拿到「页面真正在用的」store 实例
  void (async () => {
    const [actions, ui] = await Promise.all([
      import('./store/actions'),
      import('./store/ui'),
    ])
    ;(window as unknown as Record<string, unknown>).__route = {
      useActions: actions.useActions,
      useUi: ui.useUi,
    }
  })()
}

// 有本地数据 API 时和 data/routes.json 双向同步（MCP 用）；没有就退回 localStorage
void startRouteSync()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
