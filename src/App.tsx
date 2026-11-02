import { RoutePage } from './pages/RoutePage'
import { Toaster } from './components/Toaster'

/**
 * 工作路线：一个没有 AI、没有后端的纯前端工具。
 * 数据全部在浏览器 localStorage，换机器靠导出/导入 JSON。
 */
export default function App() {
  return (
    <div className="app-canvas flex h-full overflow-hidden">
      <main className="min-w-0 flex-1 overflow-hidden">
        <RoutePage />
      </main>
      <Toaster />
    </div>
  )
}
