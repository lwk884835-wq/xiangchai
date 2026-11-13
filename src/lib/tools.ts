import type { ActionBoard, ActionNode } from '@/types'
import { actionNodeContext, useActions } from '@/store/actions'
import { getSkill, skillIndexLines, SKILLS } from '@/skills/registry'
import { CODE_LEN, codeOf, normCode } from '@/lib/code'

/**
 * 给模型看的缩进树，每行前面带卡片码。
 * 不复用 store 里那份 actionGraphText：那份是「我现在在哪 / 导出」用的干净文本，不带码。
 */
function graphWithCodes(nodes: ActionNode[], maxDepth = 5): string {
  if (!nodes.length) return ''
  const kidsOf = (pid: string | null) => nodes.filter((n) => n.parentId === pid)
  const lines: string[] = []
  const walk = (n: ActionNode, depth: number, prefix: string) => {
    const kids = kidsOf(n.id)
    const done = kids.length
      ? `${kids.filter((k) => k.done).length}/${kids.length}`
      : n.done
        ? '已完成'
        : ''
    lines.push(
      `${'  '.repeat(depth)}${prefix}#${codeOf(n.id)} ${n.title}${
        n.branch ? `〔${n.branch}〕` : ''
      }${done ? `（${done}）` : ''}${n.pinned ? ' ★重点' : ''}`,
    )
    if (depth >= maxDepth) {
      if (kids.length) lines.push(`${'  '.repeat(depth + 1)}… 还有 ${kids.length} 个子任务`)
      return
    }
    kids.forEach((k, i) => walk(k, depth + 1, `${i + 1}.`))
  }
  kidsOf(null).forEach((r, i) => walk(r, 0, `${i + 1}.`))
  return lines.join('\n')
}

/** 指代用的一行：`#9NVDA 标题` */
const refOf = (n: ActionNode) => `#${codeOf(n.id)} ${n.title}`

/** 用户/Agent 给的 key → 路线：先按 5 位码，再按 id / 名字 / 模糊名字 */
export function resolveBoard(boards: ActionBoard[], key: string): ActionBoard | null {
  if (!key) return null
  const want = normCode(key)
  const byCode = want.length === CODE_LEN ? boards.find((b) => codeOf(b.id) === want) : undefined
  return (
    byCode ??
    boards.find((b) => b.id === key) ??
    boards.find((b) => b.jobTitle === key || b.label === key) ??
    boards.find((b) => b.jobTitle.includes(key) || (b.label || '').includes(key)) ??
    null
  )
}

/** 用户/Agent 给的 key → 卡片：先按 5 位码，再按 id、标题包含 */
export function resolveNode(nodes: ActionNode[], key: string): ActionNode | null {
  const want = normCode(key)
  const byCode = want.length === CODE_LEN ? nodes.find((n) => codeOf(n.id) === want) : undefined
  return (
    byCode ??
    nodes.find((n) => n.id === key) ??
    nodes.find((n) => n.title.includes(key)) ??
    null
  )
}

/** 给模型看的工具清单（OpenAI function calling 格式） */
export const TOOLS: unknown[] = [
  {
    type: 'function',
    function: {
      name: 'read_action_graph',
      description:
        '读当前路线的完整结构（层级树），或某个任务在整张图里的位置（父级 / 上一步 / 下一步 / 子任务）。判断现状、找某个任务时用。',
      parameters: {
        type: 'object',
        properties: {
          nodeId: {
            type: 'string',
            description: '要定位的节点：5 位卡片码（#9NVDA）、id 或标题；不填就返回整棵树',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_action_plan',
      description:
        '改用户的行动路线：建目标/并行的线/具体动作、改内容、挪层级、删掉、把某几条定成重点。\n' +
        '路线是一棵树：1=目标，2=并行的线，3 及以下=具体动作；每一级都可以有子节点，也可以没有。\n' +
        '一次调用可以建整棵树：nodes 里按「父在前、子在后」排好，子节点的 parentId 写父节点的 title 就行（同一次调用里刚建的也能引用）。\n' +
        '只改层级/挪位置用 op=update 传 parentId，不要为了挪几个节点整树 replace。',
      parameters: {
        type: 'object',
        properties: {
          op: {
            type: 'string',
            enum: ['create', 'update', 'delete', 'focus', 'replace', 'detach'],
            description:
              'create=新建节点；update=改节点/改父级；delete=删节点；focus=定到重点清单；replace=整条路线重排；detach=把串行链上的任务独立成一条线',
          },
          board: {
            type: 'string',
            description:
              '要改哪条路线：名字 / id / 5 位路线码。不填就是当前那条；填了但不存在会新建一条——换方向/另起一条路线时用它，不要复制旧路线',
          },
          deleteMode: {
            type: 'string',
            enum: ['only', 'cascade'],
            description:
              'op=delete 时怎么删：only=只删这条和子任务，后面一步自动接回它的前一步（默认）；cascade=这条和后面整串一起删',
          },
          nodes: {
            type: 'array',
            description: '要操作的节点列表（create/replace 时按树的先序排：父节点写在子节点前面）',
            items: {
              type: 'object',
              properties: {
                id: {
                  type: 'string',
                  description: 'update/delete/focus 时用：5 位卡片码（#9NVDA）、节点 id 或标题',
                },
                title: {
                  type: 'string',
                  description:
                    '任务名，写成能执行的动作（动词开头、有交付物），不要口号/提醒（如「保持节奏」→「每周运动 3 次」）',
                },
                purpose: { type: 'string', description: '这件事为了什么（不要重复标题）' },
                detail: { type: 'string', description: '具体怎么做：动作、产出物、怎么算完成' },
                level: { type: 'number', description: '1=目标 2=并行的线 3+=动作；不填按父节点推断' },
                parentId: {
                  type: 'string',
                  description:
                    '挂在哪个节点下面：写父节点的 id 或标题（同一次调用里刚建的父节点也可以写标题）。update 时用它换父级',
                },
                branch: {
                  type: 'string',
                  description: '同一父级下的路线名：相同 = 一条串行线；不同 = 并行的多条线',
                },
                parallel: {
                  type: 'boolean',
                  description: '与兄弟节点并行（默认串行；并行的线记得传 true）',
                },
                pinned: { type: 'boolean', description: '是否定到顶部「重点」清单（清单跨路线，所有路线的重点汇在一份里）' },
              },
            },
          },
        },
        required: ['op'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'manage_routes',
      description:
        '管理路线（计划）本身：列出 / 新建 / 改名 / 归档 / 恢复 / 删除 / 切换当前路线。要动的是「路线」而不是路线里的任务时用它。',
      parameters: {
        type: 'object',
        properties: {
          op: {
            type: 'string',
            enum: ['list', 'create', 'rename', 'archive', 'restore', 'delete', 'select'],
            description: 'list=列出所有路线；create=新建；rename=改名；archive/restore=归档/恢复；delete=删除；select=切换当前路线',
          },
          board: {
            type: 'string',
            description: '目标路线：名字 / id / 标签 / 5 位路线码。op=list 时可省略',
          },
          title: { type: 'string', description: 'create/rename 用的路线名' },
          label: { type: 'string', description: '可选的区分标签，比如「主计划」' },
          city: { type: 'string', description: '可选的一行补充说明' },
        },
        required: ['op'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'move_action_nodes',
      description:
        '移动任务：把一张卡搬到另一张卡下面（position=child，整串一起搬，含它后面的步骤）、插到同串某张卡前/后（position=before/after，只搬这一张+它的子任务，用来调顺序或并入别的分线）、或搬到另一条路线（传 board）。',
      parameters: {
        type: 'object',
        properties: {
          moves: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', description: '要搬的任务：id 或标题' },
                target: { type: 'string', description: '目标任务：id 或标题（position=child/before/after 时必填）' },
                board: { type: 'string', description: '目标路线（名字 / id）。跨路线搬家时填' },
                position: {
                  type: 'string',
                  enum: ['child', 'before', 'after'],
                  description: 'child=变成目标的并行子任务；before/after=插在目标前/后（同路线内）',
                },
              },
              required: ['id', 'position'],
            },
          },
        },
        required: ['moves'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_action_done',
      description:
        '勾选 / 取消任务的完成状态。勾选会按网页的级联规则来：勾父带子、勾后面带前面，取消则反向松开。',
      parameters: {
        type: 'object',
        properties: {
          nodes: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', description: '任务 id 或标题' },
                done: { type: 'boolean', description: 'true=勾上，false=取消勾选' },
              },
              required: ['id', 'done'],
            },
          },
        },
        required: ['nodes'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_focus_items',
      description:
        '编辑顶部「重点」里用户手动加的事项（不是路线卡片上的图钉）：加一条 / 勾掉 / 取消勾 / 删掉。',
      parameters: {
        type: 'object',
        properties: {
          op: { type: 'string', enum: ['list', 'add', 'toggle', 'remove'] },
          id: { type: 'string', description: 'toggle / remove 用：事项 id 或文本' },
          text: { type: 'string', description: 'add 用：要加的事项内容' },
        },
        required: ['op'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'load_skill',
      description: '载入技能手册（按需）。拆/改路线时先载 action-plan 手册，按里面的规则做。',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '技能 id，比如 action-plan' },
        },
        required: ['name'],
      },
    },
  },
]

export interface ToolOut {
  /** 界面上显示的动作名 */
  label: string
  /** 回灌给模型的 JSON */
  result: string
  /** 气泡上的小字 */
  note: string
}

export async function runTool(name: string, rawArgs: string): Promise<ToolOut> {
  let args: Record<string, unknown> = {}
  try {
    args = rawArgs ? (JSON.parse(rawArgs) as Record<string, unknown>) : {}
  } catch {
    args = {}
  }

  if (name === 'read_action_graph') {
    const st = useActions.getState()
    const board = st.boards.find((b) => b.id === st.activeBoardId) ?? st.boards[0]
    if (!board) {
      return { label: '读路线', result: JSON.stringify({ ok: false, reason: '还没有路线' }), note: '没有路线' }
    }
    const nodes = board.nodes
    const key = String(args.nodeId ?? '').trim()
    if (!key) {
      return {
        label: '读路线',
        result: JSON.stringify({
          ok: true,
          board: { code: codeOf(board.id), title: board.jobTitle, label: board.label },
          boards: st.boards.map((b) => ({
            code: codeOf(b.id),
            title: b.jobTitle,
            nodes: b.nodes.length,
            archived: b.archived,
          })),
          nodes: nodes.length,
          graph: graphWithCodes(nodes, 5),
          hint: '每行开头的 #XXXXX 是卡片码，可以直接当 nodeId / id 参数用',
        }),
        note: `${board.jobTitle} · ${nodes.length} 个节点`,
      }
    }
    const target = resolveNode(nodes, key)
    if (!target) {
      return {
        label: '读路线',
        result: JSON.stringify({ ok: false, reason: '没找到这个任务', available: nodes.slice(0, 20).map(refOf) }),
        note: '没找到',
      }
    }
    const ctx = actionNodeContext(nodes, target.id)
    return {
      label: '读路线',
      result: JSON.stringify({
        ok: true,
        code: codeOf(target.id),
        node: target.title,
        level: target.level,
        parent: ctx.parent ? refOf(ctx.parent) : null,
        prev: ctx.prev.map(refOf),
        next: ctx.next.map(refOf),
        parallel: ctx.parallel.map(refOf),
        children: ctx.children.map(refOf),
        graph: graphWithCodes(nodes, 5),
      }),
      note: `「${target.title}」在第 ${target.level} 层`,
    }
  }

  if (name === 'load_skill') {
    const key = String(args.name ?? '')
    const skill = getSkill(key)
    if (!skill) {
      return {
        label: '载入技能',
        result: JSON.stringify({ ok: false, reason: '没有这个技能', available: SKILLS.map((s) => s.id) }),
        note: '没有这个技能',
      }
    }
    return {
      label: '载入技能',
      result: JSON.stringify({ ok: true, title: skill.title, body: skill.body }),
      note: skill.title,
    }
  }

  if (name === 'update_action_plan') {
    const st = useActions.getState()
    const op = String(args.op ?? 'create')
    const items = (Array.isArray(args.nodes) ? args.nodes : []) as Record<string, unknown>[]
    const boardKey = String(args.board ?? '').trim()
    let createdBoard = false
    let board: ActionBoard | null = null
    if (boardKey) {
      board = resolveBoard(st.boards, boardKey)
      if (!board) {
        const id = st.addBoard({ jobTitle: boardKey, jobCity: '', label: '' })
        board = useActions.getState().boards.find((b) => b.id === id) ?? null
        createdBoard = true
      }
    } else {
      board =
        st.boards.find((b) => b.id === st.activeBoardId) ??
        st.boards.find((b) => !b.archived) ??
        st.boards[0] ??
        null
      if (!board) {
        const id = st.addBoard({ jobTitle: '我的路线', jobCity: '', label: '' })
        board = useActions.getState().boards.find((b) => b.id === id) ?? null
        createdBoard = true
      }
    }
    if (!board) {
      return { label: '改路线', result: JSON.stringify({ ok: false, reason: '建路线失败' }), note: '失败' }
    }
    const boardId = board.id
    const boardInfo = { id: board.id, title: board.jobTitle, created: createdBoard }
    const liveNodes = () => useActions.getState().boards.find((b) => b.id === boardId)?.nodes ?? []
    const findNode = (key: string) => resolveNode(liveNodes(), key)
    const graphNow = () => graphWithCodes(liveNodes(), 5)
    const linkSerial = (id: string, parentId: string | null, branch: string) => {
      const siblings = liveNodes().filter(
        (n) => n.id !== id && n.parentId === parentId && (n.branch || '') === branch,
      )
      const prev = siblings[siblings.length - 1]
      if (prev) st.updateNode(id, { deps: [prev.id] }, boardId)
    }
    const pinnedOf = (n: Record<string, unknown>) => n.pinned === true || n.focus === true
    const doneOf = (n: Record<string, unknown>) => {
      if (n.done === true || n.status === 'done') return true
      return false
    }
    const isAncestor = (a: string, b: string) => {
      let cur = liveNodes().find((n) => n.id === b)
      while (cur?.parentId) {
        if (cur.parentId === a) return true
        cur = liveNodes().find((n) => n.id === cur!.parentId)
      }
      return false
    }
    const relevel = (rootId: string, rootLevel: number) => {
      const walk = (pid: string, lv: number) => {
        for (const n of liveNodes().filter((x) => x.parentId === pid)) {
          st.updateNode(n.id, { level: lv }, boardId)
          walk(n.id, lv + 1)
        }
      }
      walk(rootId, rootLevel)
    }

    if (op === 'replace') {
      for (const n of board.nodes) st.removeNode(n.id, boardId)
      const keyToId = new Map<string, string>()
      const orphans: string[] = []
      const pending: { id: string; parentKey: string; item: Record<string, unknown> }[] = []
      for (const n of items) {
        const id = st.addNode(
          {
            title: String(n.title ?? '新节点'),
            purpose: String(n.purpose ?? ''),
            detail: String(n.detail ?? ''),
            level: Number(n.level ?? 1),
            parentId: null,
            branch: String(n.branch ?? ''),
            parallel: n.parallel === true,
            pinned: pinnedOf(n),
            done: doneOf(n),
          },
          boardId,
        )
        keyToId.set(id, id)
        if (n.id != null) keyToId.set(String(n.id), id)
        keyToId.set(String(n.title ?? ''), id)
        pending.push({ id, parentKey: String(n.parentId ?? ''), item: n })
      }
      for (const p of pending) {
        if (!p.parentKey) continue
        const pid = keyToId.get(p.parentKey) ?? findNode(p.parentKey)?.id
        if (!pid) {
          orphans.push(String(p.item.title ?? p.id))
          continue
        }
        const parent = liveNodes().find((n) => n.id === pid)
        st.updateNode(
          p.id,
          { parentId: pid, level: Number(p.item.level ?? (parent ? parent.level + 1 : 1)) },
          boardId,
        )
        const self = liveNodes().find((n) => n.id === p.id)
        if (self && p.item.parallel !== true) linkSerial(self.id, self.parentId, self.branch || '')
      }
      return {
        label: '改路线',
        result: JSON.stringify({
          ok: true,
          op,
          created: pending.length,
          board: boardInfo,
          orphans,
          graph: graphNow(),
        }),
        note: `重排了路线，${pending.length} 个节点${orphans.length ? `；${orphans.length} 个父级没挂上` : ''}`,
      }
    }

    if (op === 'create') {
      const ids: string[] = []
      const createdByKey = new Map<string, string>()
      const orphans: string[] = []
      for (const n of items) {
        const title = String(n.title ?? '新节点')
        const parentKey = String(n.parentId ?? '').trim()
        const parent =
          (parentKey ? createdByKey.get(parentKey) : undefined)
            ? liveNodes().find((x) => x.id === createdByKey.get(parentKey)) ?? null
            : parentKey
              ? findNode(parentKey)
              : null
        if (parentKey && !parent) orphans.push(title)
        const level = Number(n.level ?? (parent ? parent.level + 1 : 1))
        const id = st.addNode(
          {
            title,
            purpose: String(n.purpose ?? ''),
            detail: String(n.detail ?? ''),
            level,
            parentId: parent?.id ?? null,
            branch: String(n.branch ?? ''),
            parallel: n.parallel === true,
            pinned: pinnedOf(n),
            done: doneOf(n),
          },
          boardId,
        )
        createdByKey.set(title, id)
        createdByKey.set(id, id)
        if (n.parallel !== true) {
          const self = liveNodes().find((x) => x.id === id)
          linkSerial(id, self?.parentId ?? null, self?.branch || '')
        }
        ids.push(id)
      }
      return {
        label: '改路线',
        result: JSON.stringify({
          ok: true,
          op,
          created: ids.length,
          ids,
          board: boardInfo,
          orphans,
          graph: graphNow(),
          hint:
            !boardKey && !createdBoard && ids.length >= 2 && items.every((n) => !n.parentId)
              ? `这些节点都建在了现有路线「${boardInfo.title}」里。如果你其实想新建一条路线，传 board='新路线名' 就会新建一条，别复制旧节点。`
              : undefined,
        }),
        note: `加了 ${ids.length} 条到${createdBoard ? `新路线「${boardInfo.title}」` : '路线'}${orphans.length ? `；${orphans.length} 个父级没挂上` : ''}`,
      }
    }

    if (op === 'focus') {
      let n = 0
      for (const item of items) {
        const target = findNode(String(item.id ?? item.title ?? ''))
        if (!target) continue
        st.pinNode(target.id, item.pinned === false ? false : true, boardId)
        n++
      }
      return { label: '改路线', result: JSON.stringify({ ok: true, op, focused: n }), note: `把 ${n} 条定到了重点` }
    }

    if (op === 'delete') {
      const mode = String(args.deleteMode ?? 'only') === 'cascade' ? 'cascade' : 'only'
      let n = 0
      for (const item of items) {
        const target = findNode(String(item.id ?? item.title ?? ''))
        if (!target) continue
        st.deleteNode(target.id, mode, boardId)
        n++
      }
      return {
        label: '改路线',
        result: JSON.stringify({ ok: true, op, deleteMode: mode, deleted: n, graph: graphNow() }),
        note: mode === 'cascade' ? `连后面整串删了 ${n} 条` : `删了 ${n} 条（后面一步已接回前一步）`,
      }
    }

    if (op === 'detach') {
      let n = 0
      for (const item of items) {
        const target = findNode(String(item.id ?? item.title ?? ''))
        if (!target) continue
        st.detachNode(target.id, boardId)
        n++
      }
      return {
        label: '改路线',
        result: JSON.stringify({ ok: true, op, detached: n, graph: graphNow() }),
        note: `把 ${n} 条独立成线`,
      }
    }

    // update
    let n = 0
    const moved: string[] = []
    for (const item of items) {
      const target = findNode(String(item.id ?? item.title ?? ''))
      if (!target) continue
      const patch: Record<string, unknown> = {}
      if (item.title != null) patch.title = String(item.title)
      if (item.purpose != null) patch.purpose = String(item.purpose)
      if (item.detail != null) patch.detail = String(item.detail)
      if (item.branch != null) patch.branch = String(item.branch)
      if (item.parallel != null) patch.parallel = item.parallel === true
      if (item.pinned != null || item.focus != null) patch.pinned = pinnedOf(item)
      if (item.done != null || item.status != null) patch.done = doneOf(item)
      if (item.parentId !== undefined) {
        const key = String(item.parentId ?? '').trim()
        if (!key) {
          patch.parentId = null
          if (item.level == null) patch.level = 1
        } else {
          const parent = findNode(key)
          if (parent && parent.id !== target.id && !isAncestor(target.id, parent.id)) {
            patch.parentId = parent.id
            if (item.level == null) patch.level = parent.level + 1
            moved.push(target.id)
          }
        }
      }
      if (item.level != null) patch.level = Number(item.level)
      if (Array.isArray(item.deps)) {
        const ids = (item.deps as unknown[])
          .map((d) => findNode(String(d))?.id)
          .filter((x): x is string => !!x && x !== target.id)
        patch.deps = ids
      }
      st.updateNode(target.id, patch, boardId)
      if (patch.parentId !== undefined) relevel(target.id, Number(patch.level ?? target.level))
      n++
    }
    return {
      label: '改路线',
      result: JSON.stringify({ ok: true, op, updated: n, moved: moved.length, graph: graphNow() }),
      note: `改了 ${n} 条${moved.length ? `，其中 ${moved.length} 条换了父级` : ''}`,
    }
  }

  if (name === 'manage_routes') {
    const op = String(args.op ?? 'list')
    const st = useActions.getState()
    const key = String(args.board ?? '').trim()
    const board = key ? resolveBoard(st.boards, key) : null
    const list = () => {
      const cur = useActions.getState()
      return cur.boards.map((b) => ({
        code: codeOf(b.id),
        title: b.jobTitle,
        label: b.label,
        city: b.jobCity,
        nodes: b.nodes.length,
        archived: b.archived,
        active: b.id === cur.activeBoardId,
      }))
    }
    if (op === 'list') {
      return {
        label: '管理路线',
        result: JSON.stringify({ ok: true, op, boards: list() }),
        note: `${list().length} 条路线`,
      }
    }
    if (op === 'create') {
      const title = String(args.title ?? '').trim() || '新路线'
      st.addBoard({
        jobTitle: title,
        jobCity: String(args.city ?? ''),
        label: String(args.label ?? ''),
      })
      return {
        label: '管理路线',
        result: JSON.stringify({ ok: true, op, created: title, boards: list() }),
        note: `新建并切到「${title}」`,
      }
    }
    if (!board) {
      return {
        label: '管理路线',
        result: JSON.stringify({ ok: false, reason: '没找到这条路线', boards: list() }),
        note: '没找到路线',
      }
    }
    if (op === 'rename') {
      const patch: Record<string, string> = {}
      if (args.title != null) patch.jobTitle = String(args.title)
      if (args.label != null) patch.label = String(args.label)
      if (args.city != null) patch.jobCity = String(args.city)
      st.renameBoard(board.id, patch)
    } else if (op === 'archive') {
      st.archiveBoard(board.id)
    } else if (op === 'restore') {
      st.restoreBoard(board.id)
    } else if (op === 'delete') {
      st.removeBoard(board.id)
    } else if (op === 'select') {
      st.setActiveBoard(board.id)
    }
    return {
      label: '管理路线',
      result: JSON.stringify({ ok: true, op, board: board.jobTitle, boards: list() }),
      note: `${op}「${board.jobTitle}」`,
    }
  }

  if (name === 'move_action_nodes') {
    const moves = (Array.isArray(args.moves) ? args.moves : []) as Record<string, unknown>[]
    let moved = 0
    const failed: string[] = []
    for (const m of moves) {
      const id = String(m.id ?? '').trim()
      const position = String(m.position ?? 'child')
      const boardKey = String(m.board ?? '').trim()
      const targetKey = String(m.target ?? '').trim()
      const cur = useActions.getState()
      // 允许用标题定位要搬的卡（和建/改工具一样宽松）
      let fromBoard: (typeof cur.boards)[number] | null = null
      let node: (typeof cur.boards)[number]['nodes'][number] | null = null
      for (const bd of cur.boards) {
        const hit = resolveNode(bd.nodes, id)
        if (hit) {
          fromBoard = bd
          node = hit
          break
        }
      }
      if (!fromBoard || !node) {
        failed.push(`${id}（没找到）`)
        continue
      }
      const findNodeIn = (board: ActionBoard) => resolveNode(board.nodes, targetKey)

      if (boardKey) {
        const toBoard = resolveBoard(cur.boards, boardKey)
        if (!toBoard) {
          failed.push(`${id}（目标路线没找到）`)
          continue
        }
        if (position === 'child') {
          const target = targetKey ? findNodeIn(toBoard) : null
          cur.moveSubtreeToBoard(node.id, toBoard.id, target?.id)
          moved++
        } else {
          failed.push(`${id}（跨路线只支持 position=child）`)
        }
        continue
      }

      if (!targetKey) {
        failed.push(`${id}（缺 target）`)
        continue
      }
      const target = findNodeIn(fromBoard)
      if (!target) {
        failed.push(`${id}（目标没找到）`)
        continue
      }
      if (position === 'child') cur.moveSubtree(node.id, target.id)
      else if (position === 'before' || position === 'after') {
        cur.reorderChild(node.id, target.id, position)
      } else {
        failed.push(`${id}（position 不认识）`)
        continue
      }
      moved++
    }
    const st = useActions.getState()
    const active = st.boards.find((b) => b.id === st.activeBoardId) ?? st.boards[0]
    return {
      label: '搬任务',
      result: JSON.stringify({
        ok: true,
        moved,
        failed,
        board: active?.jobTitle,
        graph: active ? graphWithCodes(active.nodes, 5) : '',
      }),
      note: `搬了 ${moved} 次${failed.length ? `；${failed.length} 次没成` : ''}`,
    }
  }

  if (name === 'update_action_done') {
    const items = (Array.isArray(args.nodes) ? args.nodes : []) as Record<string, unknown>[]
    const st = useActions.getState()
    const active = st.boards.find((b) => b.id === st.activeBoardId) ?? st.boards[0]
    let changed = 0
    const failed: string[] = []
    for (const item of items) {
      const key = String(item.id ?? '').trim()
      const desired = item.done === true
      const target = resolveNode(active?.nodes ?? [], key)
      if (!target) {
        failed.push(key)
        continue
      }
      if (target.done !== desired) {
        useActions.getState().toggleNode(target.id)
        changed++
      }
    }
    return {
      label: '勾选任务',
      result: JSON.stringify({ ok: true, changed, failed }),
      note: `改了 ${changed} 条完成状态`,
    }
  }

  if (name === 'update_focus_items') {
    const op = String(args.op ?? 'list')
    const st = useActions.getState()
    const items = () => useActions.getState().focusItems
    const key = String(args.id ?? '').trim()
    const target =
      key
        ? (st.focusItems.find((f) => f.id === key) ?? st.focusItems.find((f) => f.text.includes(key)) ?? null)
        : null
    if (op === 'add') {
      const text = String(args.text ?? '').trim()
      if (!text) {
        return { label: '改重点清单', result: JSON.stringify({ ok: false, reason: '缺少 text' }), note: '没加' }
      }
      st.addFocusItem(text)
    } else if (op === 'toggle' && target) {
      st.toggleFocusItem(target.id)
    } else if (op === 'remove' && target) {
      st.removeFocusItem(target.id)
    }
    return {
      label: '改重点清单',
      result: JSON.stringify({
        ok: true,
        op,
        items: items().map((f) => ({ id: f.id, text: f.text, done: f.done })),
      }),
      note:
        op === 'add' ? '加了一条临时事项' : op === 'toggle' ? '切换了一条临时事项' : op === 'remove' ? '删了一条临时事项' : `${items().length} 条临时事项`,
    }
  }

  return { label: '未知工具', result: JSON.stringify({ ok: false, reason: '没有这个工具' }), note: '没有这个工具' }
}

/* ---------- system prompt ---------- */

export function buildSystemPrompt(): string {
  const st = useActions.getState()
  const board = st.boards.find((b) => b.id === st.activeBoardId) ?? st.boards[0]
  const nodes = board?.nodes ?? []
  const pinned = st.boards
    .filter((b) => !b.archived)
    .flatMap((b) => b.nodes.filter((n) => n.pinned).map((n) => n.title))
  const graph = board ? graphWithCodes(nodes, 5) : ''
  const done = nodes.filter((n) => n.done).length
  const focus = st.focusItems.filter((f) => !f.done).map((f) => f.text)

  return `你是「路线助手」，住在一个行动路线网页的左边。用户用这个网页规划自己的工作和生活——不是求职工具，是他自己想把事情理清楚的地方。

## 你现在看到的
- 当前路线：${board ? `「${board.jobTitle}」` : '还没有路线'}（${nodes.length} 个节点，完成 ${done} 个）
${board ? `- 路线全貌（缩进即层级）：\n${graph || '（空）'}` : ''}
- 顶部「重点」（跨路线汇总，不随当前路线切）：${[...pinned, ...focus].join('；') || '还没有'}

## 你只做一件事：把用户想做的事拆成路线，或者改现在的路线
- 想看结构/找某个任务 → read_action_graph
- 建 / 改内容 / 改层级 / 删（带删法） / 定重点 / 独立成线 → update_action_plan
- 路线本身：新建 / 改名 / 归档 / 恢复 / 删除 / 切换 → manage_routes
- 搬任务：变成某卡的并行子任务、调顺序、并入别的分线、跨路线搬家 → move_action_nodes
- 勾选 / 取消完成 → update_action_done（自动按网页的级联规则）
- 顶部「重点」里的临时事项 → update_focus_items
- 需要更细的规则 → load_skill("action-plan")
- **这里没有求职相关的东西**：没有简历、面试、岗位检索，不要提这些，也不要承诺去查外部信息。

## 硬规则
- 层级只能靠 parentId：1=目标，2=并行的线，3+=具体动作；一次 create 可以建整棵树（父在前，parentId 写父节点标题）
- 任务名写成能执行的动作（动词开头、有交付物），不要口号/提醒
- 用户贴缩进大纲时，缩进就是层级，照建，别拍平
- 路线和卡片都有 5 位码（#9NVDA 这种）：工具参数里 board / nodeId / id 可以直接填码；回话提到具体卡片时带上码，用户能照着指
- 只改层级/挪位置用 update 传 parentId，别整树 replace；换方向用 board 新建一条，别复制旧路线
- 删任务默认用 deleteMode="only"（后面的步骤会自动接回前一步）；只有用户明确说「后面也不要了」才用 cascade
- 搬卡片：position=child 会连它后面的整串一起搬；只想挪这一个用 before/after
- 不要一次铺太满：默认 2–3 层，细节留给他。
- 不编造他没说过的事；不知道就问一句。

## 说话方式
- 中文，2–4 句，先结论后解释。不用「好的」「很高兴帮你」这类开场。
- 不用 emoji、不用 Markdown 标题；要列举最多三条短句。
- 只说动了哪几处，别复述整棵树。

${SKILLS.length ? `## 可用技能\n${skillIndexLines().join('\n')}\n` : ''}`
}
