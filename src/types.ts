/* ---------- 行动路线 ---------- */

export interface ActionNode {
  id: string
  title: string
  /** 这件事为了什么 */
  purpose: string
  /** 具体怎么做（动作 / 交付物 / 怎么算完成） */
  detail: string
  /** 层级，从 1 开始，可以继续往下 */
  level: number
  /** 上级节点 id；null = 顶层目标 */
  parentId: string | null
  /** 同一父级下的路线名：相同 = 一条串行线，不同 = 并行的多条线 */
  branch: string
  /** 前置依赖（串行的上一环） */
  deps: string[]
  /** 与兄弟节点并行（不串行） */
  parallel: boolean
  done: boolean
  /** 是否钉到顶部「重点」清单 */
  pinned: boolean
  createdAt: number
}

export interface ActionBoard {
  id: string
  /** 这条路线/计划的名字 */
  jobTitle: string
  /** 一行补充说明（城市、方向、阶段都可以） */
  jobCity: string
  /** 区分名，比如「主计划」「备用」 */
  label: string
  createdAt: number
  nodes: ActionNode[]
  archived: boolean
}
