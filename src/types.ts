/* ---------- 行动路线 ---------- */

export interface ActionNode {
  id: string
  title: string
  /** 这件事为了什么 */
  purpose: string
  /** 具体怎么做（动作 / 交付物 / 怎么算完成） */
  detail: string
  /** 其他备注：想到什么记什么，不会被当成任务执行 */
  notes?: string
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
  /** 已标记「不太合适」：灰掉/划去，但保留记录 */
  dropped?: boolean
  /** 标记的源头卡片：源头用红色，被带上的子任务/后续任务用灰色 */
  dropRoot?: boolean
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
  /** 归属文件夹（空/undefined = 未分类） */
  folder?: string
  /** 名字还没定：新建时没起名，等第一个目标卡出现后自动跟着它改 */
  titleAuto?: boolean
  createdAt: number
  nodes: ActionNode[]
  archived: boolean
}

/* ---------- 对话 ---------- */

export interface ToolCall {
  name: string
  result: string
}

export interface Message {
  id: string
  role: 'user' | 'agent'
  text: string
  /** 模型的思考过程（流式时同步展示） */
  reasoning?: string
  /** 用户中途按了停止：内容保留，界面上标一下 */
  stopped?: boolean
  /** 被输出上限截断：内容可能不完整，界面上标一下 */
  truncated?: boolean
  /** 这一轮调过的工具（显示成小标签） */
  tools?: ToolCall[]
  streaming?: boolean
  ts: number
}
