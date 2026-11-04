/** 正文里内嵌图片：用 [[img:id]] 当占位符，图片本体存在 store.images 里 */
export const IMG_TOKEN_RE = /\[\[img:([A-Za-z0-9_-]+)\]\]/g

export type RichPart = { type: 'text'; value: string } | { type: 'img'; id: string }

export const imgToken = (id: string) => `[[img:${id}]]`

/** 把带图片占位符的文本切成「文字 / 图片」片段 */
export function splitRich(text: string): RichPart[] {
  const out: RichPart[] = []
  let last = 0
  for (const m of text.matchAll(IMG_TOKEN_RE)) {
    const at = m.index ?? 0
    if (at > last) out.push({ type: 'text', value: text.slice(last, at) })
    out.push({ type: 'img', id: m[1] })
    last = at + m[0].length
  }
  if (last < text.length) out.push({ type: 'text', value: text.slice(last) })
  return out
}

/** 给纯文本场景（搜索、MCP 等）用：占位符换成「〔图片〕」 */
export const richPlain = (text: string) =>
  String(text ?? '').replace(IMG_TOKEN_RE, '〔图片〕')

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** 给 contenteditable 生成初始 HTML */
export function richHtml(text: string, images: Record<string, string>): string {
  let html = ''
  let no = 0
  for (const part of splitRich(text)) {
    if (part.type === 'text') html += escapeHtml(part.value).replace(/\n/g, '<br>')
    else {
      const url = images[part.id]
      if (!url) {
        html += '<span class="rich-missing">〔图片〕</span>'
        continue
      }
      no += 1
      html += `<span contenteditable="false" data-img-id="${part.id}" class="rich-img-chip" title="悬停放大，点击看大图">图${no}</span>`
    }
  }
  return html
}

/** 从 contenteditable 里把内容还原成 [[img:id]] 文本 */
export function parseEditorValue(root: HTMLElement): string {
  const out: string[] = []
  const walk = (node: Node) => {
    node.childNodes.forEach((child) => {
      if (child.nodeType === Node.TEXT_NODE) {
        out.push((child.textContent ?? '').replace(/\u200b/g, ''))
        return
      }
      if (!(child instanceof HTMLElement)) return
      const imgId = child.dataset.imgId
      if (imgId) {
        out.push(imgToken(imgId))
        return
      }
      if (child.tagName === 'BR') {
        out.push('\n')
        return
      }
      if (child.tagName === 'DIV' || child.tagName === 'P') {
        walk(child)
        out.push('\n')
        return
      }
      walk(child)
    })
  }
  walk(root)
  // 浏览器每个块后面都会补一个换行，收尾规则去掉多余的那一个
  let text = out.join('')
  while (text.endsWith('\n\n')) text = text.slice(0, -1)
  if (text.endsWith('\n')) text = text.slice(0, -1)
  return text
}
