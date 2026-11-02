import { createPortal } from 'react-dom'
import { RouteMark } from './RouteMark'

/**
 * 飞行体：路线助手的标在「顶部问助手按钮」和「面板头像」之间移动时，由它来演这一段。
 * 用 portal 挂到 body，免得被层叠上下文裁掉；起点/终点都传进来，展开收起共用一套。
 */
export function FlyingMark({
  from,
  to,
  duration,
}: {
  from: DOMRect
  to: DOMRect
  duration: number
}) {
  const dx = to.left + to.width / 2 - (from.left + from.width / 2)
  const dy = to.top + to.height / 2 - (from.top + from.height / 2)
  const scale = to.width / from.width

  return createPortal(
    <div
      className="pointer-events-none fixed z-[70]"
      style={
        {
          left: from.left,
          top: from.top,
          width: from.width,
          height: from.height,
          '--fly-x': `${dx}px`,
          '--fly-y': `${dy}px`,
          '--fly-s': `${scale}`,
          animation: `mark-fly ${duration}ms cubic-bezier(.45,.05,.25,1) both`,
        } as React.CSSProperties
      }
    >
      <RouteMark size={from.width} />
    </div>,
    document.body,
  )
}
