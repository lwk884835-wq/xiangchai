import { Fragment, useState } from 'react'
import { splitRich } from '@/lib/richText'
import { HoverImagePreview, ImageLightbox } from './ImageOverlay'

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
  const [hover, setHover] = useState<{ src: string; anchor: DOMRect } | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  if (!text) return null

  const showHover = (el: HTMLElement, src: string) => {
    setHover({ src, anchor: el.getBoundingClientRect() })
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
      {hover && <HoverImagePreview src={hover.src} anchor={hover.anchor} />}
      {preview && <ImageLightbox src={preview} onClose={() => setPreview(null)} />}
    </span>
  )
}
