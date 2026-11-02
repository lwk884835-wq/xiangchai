import { useEffect, useState } from 'react'

/**
 * 监听一个媒体查询。
 *
 * 布局里有几处不是纯 CSS 能表达的——比如「Agent 栏宽屏时占位、窄屏时浮起来盖住内容」，
 * 同一个组件要换一种挂载方式，只能用 JS 判断。纯样式能解决的地方就别用它。
 */
export function useMedia(query: string): boolean {
  const [match, setMatch] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.matchMedia(query).matches
  })

  useEffect(() => {
    const mq = window.matchMedia(query)
    const update = () => setMatch(mq.matches)
    update()
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [query])

  return match
}

/** 宽到可以同时摆下 Agent 栏和内容 */
export const WIDE = '(min-width: 1280px)'
/** 宽到可以同时摆下右侧路线栏 */
export const ROOMY = '(min-width: 1180px)'
