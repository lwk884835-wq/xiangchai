/**
 * 主题：只有「浅 / 深」两个值，值挂在 <html data-theme> 上。
 *
 * 颜色的正本在 index.css 的 html[data-theme="dark"] 块里，
 * 这里只管三件事：读上次的选择、写回 localStorage、把选择贴到 DOM 上。
 * 第一次进来没有选择时跟随系统（prefers-color-scheme），
 * 一旦手动切过就记住，不再被系统带着走。
 */
export type Theme = 'light' | 'dark'

const KEY = 'work-route-theme'
/** 地址栏 / 状态栏的颜色，跟 --color-bg 对齐，切主题时一起换 */
const THEME_COLOR: Record<Theme, string> = {
  light: '#f0ece3',
  dark: '#171512',
}

export function systemTheme(): Theme {
  if (typeof window === 'undefined') return 'light'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function readTheme(): Theme {
  if (typeof window === 'undefined') return 'light'
  try {
    const saved = localStorage.getItem(KEY)
    if (saved === 'light' || saved === 'dark') return saved
  } catch {
    /* 隐私模式读不了 localStorage，退回系统 */
  }
  return systemTheme()
}

export function applyTheme(theme: Theme) {
  const root = document.documentElement
  root.dataset.theme = theme
  root.style.colorScheme = theme
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', THEME_COLOR[theme])
}

export function rememberTheme(theme: Theme) {
  try {
    localStorage.setItem(KEY, theme)
  } catch {
    /* ignore */
  }
}
