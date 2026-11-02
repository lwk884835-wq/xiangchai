import { create } from 'zustand'
import type { Message } from '@/types'
import { readChat, writeChat, clearChat } from '@/lib/storage'

const uid = () => Math.random().toString(36).slice(2, 9)

export const GREETING: Message = {
  id: 'm-greet',
  role: 'agent',
  text: '我是路线助手。你把想做的事说给我，我帮你拆成一条能长期走的路线：先定目标，再分出几条并行的线，每条线下放具体动作。\n\n也可以直接说「改一下现在的路线」——比如把某个任务挂到别的地方、把两条线改成并行、或者把某几件事定成重点。',
  ts: Date.now(),
}

interface ChatState {
  ready: boolean
  messages: Message[]
  hydrate: () => Promise<void>
  add: (m: Omit<Message, 'id' | 'ts'> & { id?: string; ts?: number }) => Message
  truncateFrom: (id: string) => void
  clear: () => Promise<void>
}

let writeTimer: ReturnType<typeof setTimeout> | null = null
const persist = (s: ChatState) => {
  if (writeTimer) clearTimeout(writeTimer)
  writeTimer = setTimeout(() => {
    void writeChat({ messages: s.messages })
  }, 120)
}

export const useChat = create<ChatState>((set, get) => ({
  ready: false,
  messages: [GREETING],

  hydrate: async () => {
    if (get().ready) return
    const snapshot = await readChat()
    const messages = ((snapshot?.messages as Message[]) ?? []).filter(
      (m) => m && (m.role === 'user' || m.role === 'agent'),
    )
    set({ messages: messages.length ? messages : [GREETING], ready: true })
  },

  add: (m) => {
    const msg: Message = { ...m, id: m.id ?? `m-${uid()}`, ts: m.ts ?? Date.now() }
    set((s) => ({ messages: [...s.messages, msg] }))
    persist(get())
    return msg
  },

  truncateFrom: (id) => {
    const i = get().messages.findIndex((m) => m.id === id)
    if (i < 0) return
    set({ messages: get().messages.slice(0, i) })
    persist(get())
  },

  clear: async () => {
    await clearChat()
    set({ messages: [GREETING], ready: true })
  },
}))
