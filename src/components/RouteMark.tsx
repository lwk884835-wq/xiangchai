import { Waypoints } from 'lucide-react'
import { cn } from '@/lib/cn'

/**
 * 路线助手的标：黑底圆角方块 + waypoints 连线。
 * 侧栏头像、飞行动画、顶部入口按钮、favicon 用的是同一个图形。
 */
export function RouteMark({ size = 26, className }: { size?: number; className?: string }) {
  return (
    <span
      className={cn(
        'flex items-center justify-center rounded-[9px] bg-ink text-white',
        className,
      )}
      style={{ width: size, height: size }}
    >
      <Waypoints size={Math.round(size * 0.56)} strokeWidth={1.9} />
    </span>
  )
}
