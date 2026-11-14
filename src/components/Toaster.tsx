import { useUi } from '@/store/ui'

export function Toaster() {
  const toast = useUi((s) => s.toast)
  if (!toast) return null
  return (
    /**
     * 用整行 flex 居中，不要 left-1/2 + -translate-x-1/2：
     * 半像素位移会把文字栅格化到非整数像素上（Retina 上看着发糊）。
     * 动画也只用淡入，不带 scale/translate，避免动画期间和之后文字变软。
     */
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center px-4">
      <div className="anim-fade-in flex h-9 max-w-[calc(100vw-2rem)] items-center rounded-full bg-ink px-4 text-[13px] leading-[16px] text-on-ink shadow-lg shadow-ink/20">
        {toast}
      </div>
    </div>
  )
}
