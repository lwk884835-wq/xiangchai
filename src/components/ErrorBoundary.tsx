import { Component, type ReactNode } from 'react'

/**
 * 兜底：页面渲染炸了，至少给用户一个「清掉本地数据重来」的按钮，
 * 而不是白屏干瞪眼。
 */
export class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="flex h-full items-center justify-center bg-surface-3 p-6">
        <div className="w-[min(520px,92vw)] rounded-xl border border-line bg-surface p-5">
          <h1 className="text-[14px] font-semibold">页面出了点问题</h1>
          <p className="mt-1.5 text-[12px] leading-relaxed text-muted">
            多半是本地数据格式对不上（比如换过版本）。下面这行是具体报错，可以发我：
          </p>
          <pre className="mt-2 max-h-[120px] overflow-auto rounded-lg bg-surface-2 p-2 text-[11px] leading-relaxed whitespace-pre-wrap text-danger">
            {String(this.state.error?.message ?? this.state.error)}
          </pre>
          <div className="mt-3 flex gap-2">
            <button
              onClick={() => {
                localStorage.removeItem('gangcha-actions-v2')
                localStorage.removeItem('gangcha-actions-v1')
                location.reload()
              }}
              className="btn btn-line"
            >
              清掉行动路线数据并刷新
            </button>
            <button onClick={() => location.reload()} className="btn btn-accent">
              只刷新一次
            </button>
          </div>
          <p className="mt-2 text-[11px] text-faint">
            清数据只影响「行动路线」和「重点清单」，都在本机浏览器里。
          </p>
        </div>
      </div>
    )
  }
}
