/**
 * DeepSeek 原生工具调用标记（DSLM）的兜底解析。
 *
 * 正常情况走 OpenAI 格式的 `tool_calls`，这里永远用不上。
 * 但有两种边界情况会把原生标记漏进正文：
 *   1. 流式响应被 max_tokens 截断，工具调用 JSON 写了一半 → API 没法给结构化 tool_calls
 *   2. 参数不符合 schema（比如模型自己发明了字段）→ 转换失败
 * 漏出来的样子（注意字面量里有空格）：
 *
 *   < | | DSLM | | calls>
 *   < | | DSLM | | invoke name="update_action_plan">
 *   < | | DSLM | | parameter name="op" string="true">replace</ | | DSLM | | parameter>
 *   < | | DSLM | | parameter name="nodes" string="false">[...]</ | | DSLM | | parameter>
 *   </ | | DSLM | | invoke>
 *   </ | | DSLM | | calls>
 *
 * 能解析出来就还原成工具调用（照常执行）；解析不出来就把整段标记从正文里清掉，
 * 别让用户看到这堆东西。
 */

export interface DslCall {
  name: string
  /** 已经是 JSON 字符串，跟 OpenAI tool_calls 的 arguments 一致 */
  arguments: string
}

export interface DslParseResult {
  calls: DslCall[]
  /** 剥掉标记之后剩下的正文（开头那句人话通常在这里） */
  text: string
  /** 有没写完的标记：说明这一轮确实被截断了 */
  truncated: boolean
}

/** 匹配一个标记：`< | | DSLM | | xxx ...>` 或 `</ | | DSLM | | xxx>` */
const TAG = /<\s*\/?\s*\|\s*\|\s*DSLM\s*\|\s*\|\s*([^>]*)>/g

function findTags(src: string) {
  TAG.lastIndex = 0
  const out: { start: number; end: number; closing: boolean; body: string }[] = []
  let m: RegExpExecArray | null
  while ((m = TAG.exec(src))) {
    const raw = m[0]
    out.push({
      start: m.index,
      end: m.index + raw.length,
      closing: /^<\s*\//.test(raw),
      body: m[1].trim(),
    })
  }
  return out
}

function attr(body: string, key: string): string | null {
  const m = body.match(new RegExp(`\\b${key}\\s*=\\s*"([^"]*)"`))
  return m ? m[1] : null
}

export function parseDslCalls(src: string): DslParseResult {
  const text = src
  if (!text.includes('DSLM')) return { calls: [], text, truncated: false }

  const tags = findTags(text)
  const calls: DslCall[] = []
  let truncated = false

  // 找到所有 invoke 起点，往后收集它自己的 parameter
  const invokeStarts = tags.filter((t) => !t.closing && /^invoke\b/.test(t.body))
  for (const inv of invokeStarts) {
    const name = attr(inv.body, 'name')
    if (!name) continue
    // 这个 invoke 的范围：从它到配对的 </invoke>（找不到就是到文末，说明截断）
    const after = tags.filter((t) => t.start > inv.start)
    const close = after.find((t) => t.closing && /^invoke\b/.test(t.body))
    const scopeEnd = close ? close.start : text.length
    if (!close) truncated = true
    const params = after.filter((t) => t.start < scopeEnd && !t.closing && /^parameter\b/.test(t.body))

    const args: Record<string, unknown> = {}
    for (let i = 0; i < params.length; i++) {
      const p = params[i]
      const pName = attr(p.body, 'name')
      if (!pName) continue
      const looksString = attr(p.body, 'string') === 'true'
      const next = params[i + 1] ?? (close ? { start: close.start } : null)
      const contentEnd = next ? next.start : text.length
      // 参数内容里可能还夹着 </parameter>，直接截到下一个标记之前、再手工去掉尾巴上的闭合标记
      let value = text.slice(p.end, contentEnd)
      value = stripTrailingTags(value)
      args[pName] = looksString ? value : parseJsonish(value)
    }
    calls.push({ name, arguments: JSON.stringify(args) })
  }

  /*
    正文清理：
    - 有完整的 invoke 就整块删掉
    - 只剩半截（截断）就从第一个 DSLM 标记开始删到结尾——后面全是坏 JSON，留着没意义
  */
  let clean = text
  const first = tags[0]
  if (first) {
    clean = text.slice(0, first.start).trimEnd()
  }
  return { calls, text: clean, truncated }
}

/** 只要清洗后的正文：把原生工具调用标记整段剥掉 */
export function stripDsl(src: string): string {
  return parseDslCalls(src).text
}

/** 去掉内容末尾的 DSLM 闭合标记（`</ | | DSLM | | parameter>` 之类） */
function stripTrailingTags(s: string): string {
  let out = s
  for (;;) {
    const m = out.match(/<\s*\/\s*\|\s*\|\s*DSLM\s*\|\s*\|\s*[^>]*>\s*$/)
    if (!m) break
    out = out.slice(0, m.index)
  }
  return out.trim()
}

function parseJsonish(raw: string): unknown {
  const s = raw.trim()
  try {
    return JSON.parse(s)
  } catch {
    // 截断的 JSON 尽力而为：能补就补（数组补 ]、对象补 }），补完还不行就当字符串
    const mended = mendJson(s)
    if (mended !== null) {
      try {
        return JSON.parse(mended)
      } catch {
        /* ignore */
      }
    }
    return s
  }
}

/** 给被截断的 JSON 补括号：只处理数组/对象两种，字符串中间不做手脚 */
export function mendJson(src: string): string | null {
  let inStr = false
  let esc = false
  const stack: string[] = []
  for (const ch of src) {
    if (inStr) {
      if (esc) esc = false
      else if (ch === '\\') esc = true
      else if (ch === '"') inStr = false
      continue
    }
    if (ch === '"') inStr = true
    else if (ch === '[' || ch === '{') stack.push(ch)
    else if (ch === ']' || ch === '}') stack.pop()
  }
  // 截在字符串中间：没法安全补全
  if (inStr) return null
  let out = src.trimEnd()
  // 去掉可能拖在末尾的半截标点/字段
  for (;;) {
    if (/[\s,]$/.test(out) && !/[\]}]$/.test(out)) {
      out = out.replace(/,\s*$/, '').trimEnd()
    }
    if (/[:\s,]$/.test(out)) {
      out = out.replace(/[,:\s]+$/, '').trimEnd()
      // 去掉最后一个不完整键值对（例如 `{"a":1,"b`）
      const cut = out.lastIndexOf(',')
      const cut2 = Math.max(out.lastIndexOf('{'), out.lastIndexOf('['))
      if (cut > cut2 && /[{[]/.test(out.slice(cut2, cut2 + 1))) out = out.slice(0, cut)
    }
    if (!/[,:\s]$/.test(out)) break
  }
  for (let i = stack.length - 1; i >= 0; i--) out += stack[i] === '[' ? ']' : '}'
  return out
}
