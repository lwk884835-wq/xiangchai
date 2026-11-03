import { Fragment } from 'react'
import { splitRich } from '@/lib/richText'

/** 只读展示：文字 + 内嵌图片缩略图 */
export function RichText({
  text,
  images,
  className,
  imageClassName,
  onImageClick,
}: {
  text: string
  images: Record<string, string>
  className?: string
  imageClassName?: string
  onImageClick?: (src: string) => void
}) {
  if (!text) return null
  return (
    <span className={className}>
      {splitRich(text).map((part, i) =>
        part.type === 'text' ? (
          <Fragment key={i}>{part.value}</Fragment>
        ) : images[part.id] ? (
          // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
          <img
            key={i}
            src={images[part.id]}
            alt="图片"
            className={
              imageClassName ??
              'mr-1 inline-block max-h-[76px] max-w-[132px] rounded-md border border-line/70 object-cover align-middle cursor-zoom-in'
            }
            onClick={(e) => {
              if (!onImageClick) return
              e.stopPropagation()
              onImageClick(images[part.id])
            }}
          />
        ) : (
          <span key={i} className="text-faint">
            〔图片〕
          </span>
        ),
      )}
    </span>
  )
}
