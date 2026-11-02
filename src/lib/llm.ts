import { parseDslCalls } from './dsl'

export interface ApiToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }

export interface ApiMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | ContentPart[]
  tool_calls?: ApiToolCall[]
  tool_call_id?: string
}

export interface StreamHandlers {
  onReasoning?: (delta: string) => void
  onText?: (delta: string) => void
  onToolCall?: (name: string) => void
}

export interface StreamResult {
  text: string
  reasoning: string
  toolCalls: ApiToolCall[]
  /** stop / length / tool_calls …；length = 被 max_tokens 截断 */
  finishReason?: string | null
  /** 正文里混进了原生工具调用标记、被我们清洗过（能解析的已经还原成 toolCalls） */
  leakedDsl?: boolean
}

interface StreamOptions {
  model: string
  messages: ApiMessage[]
  tools?: unknown[]
  signal?: AbortSignal
}

/** 调本地的 /api/chat（key 在服务端），逐块解析 SSE */
export async function streamChat(
  { model, messages, tools, signal }: StreamOptions,
  handlers: StreamHandlers = {},
): Promise<StreamResult> {
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model, messages, tools, temperature: 0.6, max_tokens: 8192, stream: true }),
    signal,
  })

  if (!res.ok || !res.body) {
    let detail = ''
    try {
      const data = await res.json()
      detail = data?.error ?? ''
    } catch {
      detail = await res.text().catch(() => '')
    }
    throw new Error(detail || `接口返回 ${res.status}`)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let text = ''
  let reasoning = ''
  const calls: { id: string; name: string; args: string }[] = []

  const handleDelta = (delta: Record<string, unknown>) => {
    if (typeof delta.reasoning_content === 'string' && delta.reasoning_content) {
      reasoning += delta.reasoning_content
      handlers.onReasoning?.(delta.reasoning_content)
    }
    if (typeof delta.content === 'string' && delta.content) {
      text += delta.content
      handlers.onText?.(delta.content)
    }
    const toolCalls = delta.tool_calls as
      | { index?: number; id?: string; function?: { name?: string; arguments?: string } }[]
      | undefined
    for (const tc of toolCalls ?? []) {
      const i = tc.index ?? 0
      if (!calls[i]) calls[i] = { id: '', name: '', args: '' }
      if (tc.id) calls[i].id = tc.id
      if (tc.function?.name) {
        calls[i].name = tc.function.name
        handlers.onToolCall?.(calls[i].name)
      }
      if (tc.function?.arguments) calls[i].args += tc.function.arguments
    }
  }

  let finishReason: string | null = null
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    const blocks = buffer.split('\n\n')
    buffer = blocks.pop() ?? ''

    for (const block of blocks) {
      const line = block.split('\n').find((l) => l.startsWith('data:'))
      if (!line) continue
      const raw = line.slice(5).trim()
      if (!raw || raw === '[DONE]') continue
      try {
        const json = JSON.parse(raw)
        const choice = json?.choices?.[0]
        if (choice?.finish_reason) finishReason = String(choice.finish_reason)
        const delta = choice?.delta
        if (delta) handleDelta(delta)
      } catch {
        // 半截 JSON 直接跳过，下一块会补齐
      }
    }
  }

  let finalText = text
  let finalCalls: ApiToolCall[] = calls
    .filter((c) => c.name)
    .map((c) => ({
      id: c.id || `call_${Math.random().toString(36).slice(2, 9)}`,
      type: 'function' as const,
      function: { name: c.name, arguments: c.args || '{}' },
    }))

  /*
    兜底：拿不到结构化 tool_calls、正文里却出现了原生 DSLM 标记。
    典型成因是 max_tokens 截断（工具调用写到一半）或参数不符合 schema、API 转换失败。
    能解析的还原成工具调用；解析不出来就把标记从正文里剥掉，别让用户看到这堆协议文本。
  */
  let leakedDsl = false
  if (text.includes('DSLM')) {
    leakedDsl = true
    const parsed = parseDslCalls(text)
    /*
      正文一律清洗：即使这一轮已经拿到了结构化 tool_calls，模型有时也会把同一次调用
      用原生标记再抄一遍到 content 里（线上真碰到过：read_action_graph 既执行了、
      标记又显示出来了）。所以剥标记不看有没有结构化调用。
    */
    finalText = parsed.text
    // 结构化调用已经有时，只剥标记、不再重复执行解析出来的调用
    if (!finalCalls.length) {
      // 截断的调用一律不执行：如果按补齐的 JSON 跑 replace，会把路线清一半再建一半，更糟
      if (parsed.calls.length && !parsed.truncated) {
        finalCalls = parsed.calls.map((c, i) => ({
          id: `call_dsl_${i}`,
          type: 'function' as const,
          function: { name: c.name, arguments: c.arguments },
        }))
      }
      if (parsed.truncated && !finishReason) finishReason = 'length'
    }
  }

  return { text: finalText, reasoning, toolCalls: finalCalls, finishReason, leakedDsl }
}

export interface CompleteOptions {
  model: string
  messages: ApiMessage[]
  temperature?: number
  max_tokens?: number
}

/** 一次性返回（压缩归档用，不需要流式） */
export async function completeChat({
  model,
  messages,
  temperature = 0.3,
  max_tokens = 1600,
}: CompleteOptions): Promise<{ text: string; promptTokens?: number }> {
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model, messages, temperature, max_tokens, stream: false }),
  })

  if (!res.ok) {
    let detail = ''
    try {
      const data = await res.json()
      detail = data?.error ?? ''
    } catch {
      detail = await res.text().catch(() => '')
    }
    throw new Error(detail || `接口返回 ${res.status}`)
  }

  const data = await res.json()
  return {
    text: String(data?.choices?.[0]?.message?.content ?? ''),
    promptTokens: data?.usage?.prompt_tokens,
  }
}
