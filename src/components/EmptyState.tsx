import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/cn'

/**
 * 统一的空状态：图标 + 一句话 + 可选主按钮。
 * 重点清单、行动路线、简历、面试四处共用，避免每处自己拼一段文字。
 */
export function EmptyState({
  icon: Icon,
  title,
  hint,
  action,
  className,
}: {
  icon?: LucideIcon
  title: string
  hint?: string
  action?: { label: string; onClick: () => void; icon?: ReactNode }
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center gap-2.5 rounded-[14px] border border-dashed border-line-2 px-5 py-8 text-center',
        className,
      )}
    >
      {Icon && (
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-surface-2 text-faint">
          <Icon size={16} strokeWidth={1.7} />
        </span>
      )}
      <p className="text-[12.5px] font-medium text-muted">{title}</p>
      {hint && <p className="max-w-[300px] text-[12px] leading-relaxed text-faint">{hint}</p>}
      {action && (
        <button
          onClick={action.onClick}
          className="btn btn-ink mt-1 h-8 gap-1.5 px-3 text-[12px]"
        >
          {action.icon}
          {action.label}
        </button>
      )}
    </div>
  )
}
