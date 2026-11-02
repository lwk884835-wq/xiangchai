import { create } from 'zustand'

interface UiState {
  toast: string | null
  showToast: (msg: string) => void
  clearToast: () => void
}

let timer: ReturnType<typeof setTimeout> | null = null

/** 统一的小提示（保存、导入导出、勾选撤回等都用它） */
export const useUi = create<UiState>((set) => ({
  toast: null,
  showToast: (msg) => {
    if (timer) clearTimeout(timer)
    set({ toast: msg })
    timer = setTimeout(() => set({ toast: null }), 2600)
  },
  clearToast: () => set({ toast: null }),
}))
