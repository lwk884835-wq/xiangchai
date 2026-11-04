import { Fragment, useState } from 'react'
import { splitRich } from '@/lib/richText'

/** 只读展示：文字 + 内嵌图片（文段里只显示小胶囊，悬停放大、点击看大图） */
export function RichText({
  text,
  images,
  className,
  onImageClick,
}: {
  text: string
  images: Record<string, string>
  className?: string
  onImageClick?: (src: string) => void
}) {
  const [hover, setHover] = useState<{ src: string; left: number; top: number } | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  if (!text) return null

  const showHover = (el: HTMLElement, src: string) => {
    const r = el.getBoundingClientRect()
    const left = Math.min(Math.max(8, r.left), window.innerWidth - 336)
    const top = r.bottom + 8 + 240 > window.innerHeight ? r.top - 248 : r.bottom + 8
    setHover({ src, left, top })
  }

  let n = 0
  return (
    <span className={className}>
      {splitRich(text).map((part, i) => {
        if (part.type === 'text') return <Fragment key={i}>{part.value}</Fragment>
        const src = images[part.id]
        if (!src)
          return (
            <span key={i} className="text-faint">
              〔图片〕
            </span>
          )
        const no = ++n
        return (
          <Fragment key={i}>
            <span
              className="rich-img-chip"
              title="悬停放大，点击看大图"
              onMouseEnter={(e) => showHover(e.currentTarget, src)}
              onMouseLeave={() => setHover(null)}
              onClick={(e) => {
                e.stopPropagation()
                setHover(null)
                if (onImageClick) onImageClick(src)
                else setPreview(src)
              }}
            >
              图{no}
            </span>
          </Fragment>
        )
      })}
      {hover && (
        <span
          className="pointer-events-none fixed z-[75] overflow-hidden rounded-lg border border-line bg-surface p-1 shadow-e3"
          style={{ left: hover.left, top: hover.top }}
        >
          <img src={hover.src} alt="图片预览" className="max-h-[240px] max-w-[320px] rounded-md object-contain" />
        </span>
      )}
      {preview && (
        <span
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/65 p-8"
          onClick={(e) => {
            e.stopPropagation()
            setPreview(null)
          }}
        >
          <img src={preview} alt="图片预览" className="max-h-full max-w-full rounded-lg shadow-2xl" />
        </span>
      )}
    </span>
  )
}
