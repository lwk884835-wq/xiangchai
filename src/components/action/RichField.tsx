import { useEffect, useRef, useState } from 'react'
import { ImagePlus } from 'lucide-react'
import { useActions } from '@/store/actions'
import { fileToDataUrl } from '@/lib/image'
import { parseEditorValue, richHtml } from '@/lib/richText'
import { HoverImagePreview, ImageLightbox } from './ImageOverlay'
import { cn } from '@/lib/cn'

/**
 * 可以「在任意两个字之间插图」的输入框：
 * - 内部用 contenteditable，图片存成 [[img:id]] 占位符，正文里显示成小胶囊
 * - 支持按钮选图、直接粘贴截图、拖入图片
 * - 点图片弹出大图预览
 */

/** 在光标处插入纯文本（支持换行），不依赖 execCommand */
function insertPlainText(el: HTMLDivElement, text: string): void {
  el.focus()
  const sel = window.getSelection()
  let range: Range
  if (sel && sel.rangeCount && el.contains(sel.getRangeAt(0).commonAncestorContainer)) {
    range = sel.getRangeAt(0)
  } else {
    range = document.createRange()
    range.selectNodeContents(el)
    range.collapse(false)
  }
  range.deleteContents()
  const frag = document.createDocumentFragment()
  const lines = text.split(/\r?\n/)
  lines.forEach((line, i) => {
    if (i > 0) frag.appendChild(document.createElement('br'))
    if (line) frag.appendChild(document.createTextNode(line))
  })
  range.insertNode(frag)
  // 光标移到插入内容之后
  const after = document.createRange()
  const last = frag.lastChild
  if (last) after.setStartAfter(last)
  else after.setStart(range.startContainer, range.startOffset)
  after.collapse(true)
  sel?.removeAllRanges()
  sel?.addRange(after)
}

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
  const [hover, setHover] = useState<{ src: string; anchor: DOMRect } | null>(null)
  /** 自己维护的撤销栈：粘贴/插图这类程序性修改不进浏览器原生历史，⌘Z 得能退 */
  const undoRef = useRef<string[]>([])
  const redoRef = useRef<string[]>([])

  // 外部值变化时同步回 DOM（正在输入时不打断光标）
  useEffect(() => {
    const el = ref.current
    if (!el || focusedRef.current) return
    const html = richHtml(value, images)
    if (el.innerHTML !== html) el.innerHTML = html
  }, [value, images])

  const currentText = () => {
    const el = ref.current
    return el ? parseEditorValue(el) : value
  }

  const pushUndo = () => {
    undoRef.current = [...undoRef.current.slice(-49), currentText()]
    redoRef.current = []
  }

  const applyText = (text: string) => {
    const el = ref.current
    if (!el) return
    el.innerHTML = richHtml(text, images)
    // 光标放到末尾
    const range = document.createRange()
    range.selectNodeContents(el)
    range.collapse(false)
    const sel = window.getSelection()
    sel?.removeAllRanges()
    sel?.addRange(range)
    onChange(text)
  }

  const undo = () => {
    const prev = undoRef.current.pop()
    if (prev === undefined) return false
    redoRef.current = [...redoRef.current.slice(-49), currentText()]
    applyText(prev)
    return true
  }

  const redo = () => {
    const next = redoRef.current.pop()
    if (next === undefined) return false
    undoRef.current = [...undoRef.current.slice(-49), currentText()]
    applyText(next)
    return true
  }


  /** 按一下退格/Delete 就删掉光标旁边的图片（别让第一次只把光标挪到左边） */
  const tryDeleteAdjacentImage = (dir: -1 | 1): boolean => {
    const sel = window.getSelection()
    const el = ref.current
    if (!el || !sel || sel.rangeCount === 0 || !sel.isCollapsed) return false
    const range = sel.getRangeAt(0)
    if (!el.contains(range.startContainer)) return false
    const imgOf = (node: Node | null): HTMLElement | null =>
      node instanceof HTMLElement && node.dataset.imgId ? node : null
    const isZeroText = (node: Node | null) =>
      node?.nodeType === Node.TEXT_NODE && (node.textContent ?? '').replace(/\u200b/g, '') === ''

    let target: HTMLElement | null = null
    const container = range.startContainer
    const offset = range.startOffset
    if (container.nodeType === Node.TEXT_NODE) {
      const text = container as Text
      if (dir === -1) {
        if (offset === 0 || (offset === text.length && isZeroText(text))) {
          target = imgOf(text.previousSibling)
        }
      } else if (offset === text.length) {
        target = imgOf(text.nextSibling)
      }
    } else {
      let cand: Node | null =
        dir === -1 ? (container.childNodes[offset - 1] ?? null) : (container.childNodes[offset] ?? null)
      if (isZeroText(cand)) cand = dir === -1 ? cand?.previousSibling ?? null : cand?.nextSibling ?? null
      target = imgOf(cand)
    }
    if (!target?.parentNode) return false

    const parent = target.parentNode
    const index = Array.prototype.indexOf.call(parent.childNodes, target)
    const zero = dir === -1 ? target.nextSibling : target.previousSibling
    if (zero && isZeroText(zero)) parent.removeChild(zero)
    parent.removeChild(target)
    const next = document.createRange()
    next.setStart(parent, Math.min(Math.max(0, index), parent.childNodes.length))
    next.collapse(true)
    sel.removeAllRanges()
    sel.addRange(next)
    return true
  }

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
    pushUndo()
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
    span.className = 'rich-img-chip'
    span.title = '悬停放大，点击看大图'
    span.textContent = `图${el.querySelectorAll('[data-img-id]').length + 1}`
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
        onKeyDown={(e) => {
          const mod = e.metaKey || e.ctrlKey
          if (mod && e.key.toLowerCase() === 'z') {
            const ok = e.shiftKey ? redo() : undo()
            if (ok) {
              e.preventDefault()
              e.stopPropagation()
            }
            return
          }
          if (mod && e.key.toLowerCase() === 'y') {
            if (redo()) {
              e.preventDefault()
              e.stopPropagation()
            }
            return
          }
          if (e.key === 'Backspace' || e.key === 'Delete') {
            if (tryDeleteAdjacentImage(e.key === 'Backspace' ? -1 : 1)) {
              e.preventDefault()
              emit()
              return
            }
          }
          onKeyDown?.(e)
        }}
        onInput={emit}
        onMouseDown={(e) => {
          const chip = (e.target as HTMLElement).closest('[data-img-id]') as HTMLElement | null
          const src = chip?.dataset.imgId ? images[chip.dataset.imgId] : null
          if (chip && src) {
            e.preventDefault()
            setHover(null)
            setPreview(src)
          }
        }}
        onMouseOver={(e) => {
          const chip = (e.target as HTMLElement).closest('[data-img-id]') as HTMLElement | null
          const src = chip?.dataset.imgId ? images[chip.dataset.imgId] : null
          if (!chip || !src) return
          setHover({ src, anchor: chip.getBoundingClientRect() })
        }}
        onMouseOut={(e) => {
          if ((e.target as HTMLElement).closest('[data-img-id]')) setHover(null)
        }}
        onPaste={(e) => {
          const dt = e.clipboardData
          if (!dt) return
          const fromFiles = Array.from(dt.files ?? [])
          const fromItems = Array.from(dt.items ?? [])
            .filter((it) => it.kind === 'file')
            .map((it) => it.getAsFile())
            .filter((f): f is File => !!f)
          const file = [...fromFiles, ...fromItems].find((f) => f.type.startsWith('image/'))
          if (file) {
            e.preventDefault()
            rememberSelection()
            void addImageFile(file)
            return
          }
          const text = dt.getData('text/plain')
          if (!text) return
          e.preventDefault()
          if (ref.current) {
            pushUndo()
            insertPlainText(ref.current, text)
            emit()
          }
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
          'rich-field w-full resize-none overflow-y-auto rounded-[6px] border border-line bg-surface px-2.5 py-[5px] text-[12.5px] leading-[16px] break-words whitespace-pre-wrap text-ink outline-none transition-colors focus:border-accent-line focus:ring-2 focus:ring-accent/25',
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

      {hover && <HoverImagePreview src={hover.src} anchor={hover.anchor} />}
      {preview && <ImageLightbox src={preview} onClose={() => setPreview(null)} />}
    </div>
  )
}
