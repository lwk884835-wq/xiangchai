import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
