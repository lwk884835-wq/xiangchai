import { useEffect, useRef, useState } from 'react'
import { ImagePlus } from 'lucide-react'
import { useActions } from '@/store/actions'
import { fileToDataUrl } from '@/lib/image'
import { parseEditorValue, richHtml } from '@/lib/richText'
import { cn } from '@/lib/cn'

/**
 * 可以「在任意两个字之间插图」的输入框：
 * - 内部用 contenteditable，图片存成 [[img:id]] 占位符，正文里显示成小胶囊
 * - 支持按钮选图、直接粘贴截图、拖入图片
 * - 点图片弹出大图预览
 */
export function RichField({
  value,
  onChange,
  placeholder,
  className,
  minHeight = 72,
  disabled,
  onKeyDown,
  onBlur,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  className?: string
  minHeight?: number
  disabled?: boolean
  onKeyDown?: (e: React.KeyboardEvent<HTMLDivElement>) => void
  onBlur?: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const focusedRef = useRef(false)
  const savedRangeRef = useRef<Range | null>(null)
  const images = useActions((s) => s.images)
  const addImage = useActions((s) => s.addImage)
  const [preview, setPreview] = useState<string | null>(null)

  // 外部值变化时同步回 DOM（正在输入时不打断光标）
  useEffect(() => {
    const el = ref.current
    if (!el || focusedRef.current) return
    const html = richHtml(value, images)
    if (el.innerHTML !== html) el.innerHTML = html
  }, [value, images])

  const emit = () => {
    const el = ref.current
    if (el) onChange(parseEditorValue(el))
  }

  const rememberSelection = () => {
    const sel = window.getSelection()
    savedRangeRef.current =
      sel && sel.rangeCount && ref.current?.contains(sel.getRangeAt(0).commonAncestorContainer)
        ? sel.getRangeAt(0).cloneRange()
        : null
  }

  const insertImage = (url: string) => {
    const el = ref.current
    if (!el) return
    const id = `img-${Math.random().toString(36).slice(2, 10)}`
    addImage(id, url)
    el.focus()
    let range = savedRangeRef.current
    if (!range || !el.contains(range.commonAncestorContainer)) {
      range = document.createRange()
      range.selectNodeContents(el)
      range.collapse(false)
    }
    const span = document.createElement('span')
    span.contentEditable = 'false'
    span.dataset.imgId = id
    span.className = 'rich-img'
    const img = document.createElement('img')
    img.src = url
    img.alt = ''
    span.appendChild(img)
    range.deleteContents()
    range.insertNode(span)
    // 图后面留一个光标位，方便继续打字
    const zero = document.createTextNode('\u200b')
    span.after(zero)
    const next = document.createRange()
    next.setStartAfter(zero)
    next.collapse(true)
    const sel = window.getSelection()
    sel?.removeAllRanges()
    sel?.addRange(next)
    savedRangeRef.current = null
    emit()
  }

  const addImageFile = async (file: File) => {
    try {
      insertImage(await fileToDataUrl(file))
    } catch (err) {
      console.error('[rich-field] 插图失败', err)
    }
  }

  const openPicker = () => {
    rememberSelection()
    fileRef.current?.click()
  }

  return (
    <div className="relative">
      <div
        ref={ref}
        role="textbox"
        aria-multiline
        tabIndex={0}
        contentEditable={!disabled}
        data-placeholder={placeholder}
        onFocus={() => {
          focusedRef.current = true
        }}
        onBlur={() => {
          focusedRef.current = false
          emit()
          onBlur?.()
        }}
        onKeyDown={onKeyDown}
        onInput={emit}
        onMouseDown={(e) => {
          const img = (e.target as HTMLElement).closest('span.rich-img img') as HTMLImageElement | null
          if (img) {
            e.preventDefault()
            setPreview(img.src)
          }
        }}
        onPaste={(e) => {
          const file = Array.from(e.clipboardData.files).find((f) => f.type.startsWith('image/'))
          if (file) {
            e.preventDefault()
            rememberSelection()
            void addImageFile(file)
            return
          }
          e.preventDefault()
          const text = e.clipboardData.getData('text/plain')
          if (text) document.execCommand('insertText', false, text)
        }}
        onDragOver={(e) => {
          if (Array.from(e.dataTransfer.items).some((i) => i.kind === 'file')) e.preventDefault()
        }}
        onDrop={(e) => {
          const file = Array.from(e.dataTransfer.files).find((f) => f.type.startsWith('image/'))
          if (!file) return
          e.preventDefault()
          // 尽量把图插在落点附近
          if ('caretRangeFromPoint' in document) {
            const r = document.caretRangeFromPoint(e.clientX, e.clientY)
            if (r && ref.current?.contains(r.commonAncestorContainer)) savedRangeRef.current = r
          }
          void addImageFile(file)
        }}
        onMouseUp={rememberSelection}
        onKeyUp={rememberSelection}
        className={cn(
          'rich-field w-full resize-none overflow-y-auto rounded-[6px] border border-line bg-surface px-2.5 py-1.5 text-[12.5px] leading-[1.7] break-words whitespace-pre-wrap text-ink outline-none transition-colors focus:border-accent-line focus:ring-2 focus:ring-accent/25',
          className,
        )}
        style={{ minHeight }}
      />
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (f) void addImageFile(f)
        }}
      />
      <button
        type="button"
        onClick={openPicker}
        title="插入图片（也可以直接粘贴 / 拖进来）"
        className="absolute right-1.5 bottom-1.5 flex h-[20px] w-[20px] items-center justify-center rounded text-faint transition-colors hover:bg-surface-3 hover:text-ink"
      >
        <ImagePlus size={12} />
      </button>

      {preview && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/65 p-8"
          onClick={() => setPreview(null)}
        >
          <img src={preview} alt="图片预览" className="max-h-full max-w-full rounded-lg shadow-2xl" />
        </div>
      )}
    </div>
  )
}
