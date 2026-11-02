/** 本地存储：IndexedDB 里一个极简 KV，聊天记录放这儿（比 localStorage 能装） */

const DB_NAME = 'work-route'
const DB_VERSION = 1
const STORE = 'kv'
const KEY = 'chat'

export interface ChatSnapshot {
  messages: unknown[]
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function kvGet<T>(key: string): Promise<T | undefined> {
  try {
    const db = await openDb()
    return await new Promise<T | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly')
      const req = tx.objectStore(STORE).get(key)
      req.onsuccess = () => resolve(req.result as T | undefined)
      req.onerror = () => reject(req.error)
    })
  } catch {
    const raw = localStorage.getItem(`work-route.kv.${key}`)
    return raw ? (JSON.parse(raw) as T) : undefined
  }
}

export async function kvSet(key: string, value: unknown): Promise<void> {
  try {
    const db = await openDb()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).put(value, key)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } catch {
    localStorage.setItem(`work-route.kv.${key}`, JSON.stringify(value))
  }
}

export async function kvDelete(key: string): Promise<void> {
  try {
    const db = await openDb()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).delete(key)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } catch {
    localStorage.removeItem(`work-route.kv.${key}`)
  }
}

export const readChat = () => kvGet<ChatSnapshot>(KEY)
export const writeChat = (snap: ChatSnapshot) => kvSet(KEY, snap)
export const clearChat = () => kvDelete(KEY)
