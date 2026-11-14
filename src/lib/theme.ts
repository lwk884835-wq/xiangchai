/**
 * 主题：偏好（system / light / dark）+ 实际生效的浅深。
 *
 * 颜色的正本在 index.css 的 html[data-theme="dark"] 块里，
 * 这里只管三件事：读上次的选择、写回 localStorage、把结果贴到 DOM 上。
 *
 * 默认是 system：跟着系统走，系统切了这边也跟着变（不用刷新页面）。
 * 手动选过浅色或深色之后，就固定住，不再被系统带着跑。
 */
export type Theme = 'light' | 'dark'
/** 用户的选择：「跟随系统」或明确指定 */
export type ThemePref = 'system' | Theme

const KEY = 'work-route-theme'
/** 地址栏 / 状态栏的颜色，跟 --color-bg 对齐，切主题时一起换 */
const THEME_COLOR: Record<Theme, string> = {
  light: '#f0ece3',
  dark: '#171512',
}
const DARK_QUERY = '(prefers-color-scheme: dark)'

export function systemTheme(): Theme {
  if (typeof window === 'undefined') return 'light'
  return window.matchMedia(DARK_QUERY).matches ? 'dark' : 'light'
}

/** 把偏好换算成实际该用的主题 */
export function resolveTheme(pref: ThemePref): Theme {
  return pref === 'system' ? systemTheme() : pref
}

export function readPref(): ThemePref {
  if (typeof window === 'undefined') return 'system'
  try {
    const saved = localStorage.getItem(KEY)
    if (saved === 'light' || saved === 'dark' || saved === 'system') return saved
  } catch {
    /* 隐私模式读不了 localStorage，退回跟随系统 */
  }
  return 'system'
}

export function applyTheme(theme: Theme) {
  const root = document.documentElement
  root.dataset.theme = theme
  root.style.colorScheme = theme
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', THEME_COLOR[theme])
}

export function rememberPref(pref: ThemePref) {
  try {
    localStorage.setItem(KEY, pref)
  } catch {
    /* ignore */
  }
}

/**
 * 盯着系统主题：偏好是 system 时，系统一切换就回调（不用刷新页面）。
 * 返回取消订阅。旧版 Safari 只有 addListener，顺手兼容。
 */
export function watchSystemTheme(onChange: (theme: Theme) => void) {
  const mq = window.matchMedia(DARK_QUERY)
  const handler = (e: MediaQueryListEvent | MediaQueryList) => onChange(e.matches ? 'dark' : 'light')
  if (mq.addEventListener) mq.addEventListener('change', handler)
  else mq.addListener(handler)
  return () => {
    if (mq.removeEventListener) mq.removeEventListener('change', handler)
    else mq.removeListener(handler)
  }
}
