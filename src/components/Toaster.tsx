import { useUi } from '@/store/ui'

export function Toaster() {
  const toast = useUi((s) => s.toast)
  if (!toast) return null
  return (
    <div className="pointer-events-none fixed bottom-6 left-1/2 z-50 -translate-x-1/2 anim-pop">
      <div className="rounded-full bg-ink px-4 py-2 text-[13px] text-white/90 shadow-lg shadow-ink/20">
        {toast}
      </div>
    </div>
  )
}
