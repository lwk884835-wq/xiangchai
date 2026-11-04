import { useEffect } from 'react'
import { createPortal } from 'react-dom'

/** 悬浮在胶囊旁边的小预览：挂到 body，避免被抽屉/卡片的 transform、overflow 裁掉 */
export function HoverImagePreview({ src, anchor }: { src: string; anchor: DOMRect }) {
  const width = 288
  const height = 220
  const left = Math.min(Math.max(8, anchor.left - 4), window.innerWidth - width - 12)
  const below = anchor.bottom + 3
  const top = below + height > window.innerHeight - 8 ? Math.max(8, anchor.top - height - 4) : below
  return createPortal(
    <div
      className="pointer-events-none fixed z-[200] overflow-hidden rounded-xl border border-line bg-surface p-1 shadow-e3"
      style={{ left, top }}
    >
      <img
        src={src}
        alt="图片预览"
        className="block max-h-[220px] max-w-[280px] rounded-lg object-contain"
      />
    </div>,
    document.body,
  )
}

/** 全屏大图：挂到 body，真正盖住整个视口（包括抽屉、卡片） */
export function ImageLightbox({ src, onClose }: { src: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return createPortal(
    <div
      className="fixed inset-0 z-[210] flex items-center justify-center bg-black/72 p-6"
      onClick={onClose}
    >
      <img
        src={src}
        alt="图片预览"
        className="max-h-[92vh] max-w-[94vw] rounded-lg object-contain shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      />
    </div>,
    document.body,
  )
}
