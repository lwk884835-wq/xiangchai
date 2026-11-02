import { twMerge } from 'tailwind-merge'

/**
 * className 合并：先拼接，再用 tailwind-merge 去掉同属性的冲突类。
 * 以前是裸 join，条件里同时出现 `opacity-0` 和 `opacity-100` 时谁生效取决于顺序，
 * 样式重构时很容易踩到（比如选中态/禁用态叠加）。tailwind-merge 会按 TB 语义后者胜出。
 */
export const cn = (...parts: (string | false | null | undefined)[]) =>
  twMerge(parts.filter(Boolean).join(' '))
