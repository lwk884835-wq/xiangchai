import { RoutePage } from './pages/RoutePage'
import { Toaster } from './components/Toaster'

export default function App() {
  return (
    <div className="app-canvas flex h-full overflow-hidden">
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <RoutePage />
      </main>
      <Toaster />
    </div>
  )
}
