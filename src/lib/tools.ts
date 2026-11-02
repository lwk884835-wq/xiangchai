import type { ActionBoard } from '@/types'
import { actionGraphText, actionNodeContext, useActions } from '@/store/actions'
import { getSkill, skillIndexLines, SKILLS } from '@/skills/registry'

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
          nodeId: { type: 'string', description: '要定位的节点 id 或标题；不填就返回整棵树' },
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
            enum: ['create', 'update', 'delete', 'focus', 'replace'],
            description:
              'create=新建节点；update=改节点/改父级；delete=删节点；focus=定到重点清单；replace=整条路线重排',
          },
          board: {
            type: 'string',
            description:
              '要改哪条路线（名字）。不填就是当前那条；填了但不存在会新建一条——换方向/另起一条路线时用它，不要复制旧路线',
          },
          nodes: {
            type: 'array',
            description: '要操作的节点列表（create/replace 时按树的先序排：父节点写在子节点前面）',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', description: 'update/delete/focus 时用：节点 id 或标题' },
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
                pinned: { type: 'boolean', description: '是否定到顶部「重点」清单' },
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
          board: { title: board.jobTitle, label: board.label },
          boards: st.boards.map((b) => ({ title: b.jobTitle, nodes: b.nodes.length, archived: b.archived })),
          nodes: nodes.length,
          graph: actionGraphText(nodes, 5),
        }),
        note: `${board.jobTitle} · ${nodes.length} 个节点`,
      }
    }
    const target = nodes.find((n) => n.id === key) ?? nodes.find((n) => n.title.includes(key))
    if (!target) {
      return {
        label: '读路线',
        result: JSON.stringify({ ok: false, reason: '没找到这个任务', available: nodes.slice(0, 20).map((n) => n.title) }),
        note: '没找到',
      }
    }
    const ctx = actionNodeContext(nodes, target.id)
    return {
      label: '读路线',
      result: JSON.stringify({
        ok: true,
        node: target.title,
        level: target.level,
        parent: ctx.parent?.title ?? null,
        prev: ctx.prev.map((n) => n.title),
        next: ctx.next.map((n) => n.title),
        parallel: ctx.parallel.map((n) => n.title),
        children: ctx.children.map((n) => n.title),
        graph: actionGraphText(nodes, 5),
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
      board =
        st.boards.find((b) => b.id === boardKey) ??
        st.boards.find((b) => b.jobTitle === boardKey || b.label === boardKey) ??
        st.boards.find((b) => b.jobTitle.includes(boardKey) || b.label.includes(boardKey)) ??
        null
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
    const findNode = (key: string) => liveNodes().find((n) => n.id === key || n.title.includes(key)) ?? null
    const graphNow = () => actionGraphText(liveNodes(), 5)
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
      let n = 0
      for (const item of items) {
        const target = findNode(String(item.id ?? item.title ?? ''))
        if (!target) continue
        st.removeNode(target.id, boardId)
        n++
      }
      return { label: '改路线', result: JSON.stringify({ ok: true, op, deleted: n }), note: `删了 ${n} 条` }
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

  return { label: '未知工具', result: JSON.stringify({ ok: false, reason: '没有这个工具' }), note: '没有这个工具' }
}

/* ---------- system prompt ---------- */

export function buildSystemPrompt(): string {
  const st = useActions.getState()
  const board = st.boards.find((b) => b.id === st.activeBoardId) ?? st.boards[0]
  const nodes = board?.nodes ?? []
  const pinned = nodes.filter((n) => n.pinned).map((n) => n.title)
  const graph = board ? actionGraphText(nodes, 5) : ''
  const done = nodes.filter((n) => n.done).length
  const focus = st.focusItems.filter((f) => !f.done).map((f) => f.text)

  return `你是「路线助手」，住在一个行动路线网页的左边。用户用这个网页规划自己的工作和生活——不是求职工具，是他自己想把事情理清楚的地方。

## 你现在看到的
- 当前路线：${board ? `「${board.jobTitle}」` : '还没有路线'}（${nodes.length} 个节点，完成 ${done} 个）
${board ? `- 路线全貌（缩进即层级）：\n${graph || '（空）'}` : ''}
- 顶部「重点」：${[...pinned, ...focus].join('；') || '还没有'}

## 你只做一件事：把用户想做的事拆成路线，或者改现在的路线
- 想看结构/找某个任务 → read_action_graph
- 建/改/删/定重点 → update_action_plan
- 需要更细的规则 → load_skill("action-plan")
- **这里没有求职相关的东西**：没有简历、面试、岗位检索，不要提这些，也不要承诺去查外部信息。

## 硬规则
- 层级只能靠 parentId：1=目标，2=并行的线，3+=具体动作；一次 create 可以建整棵树（父在前，parentId 写父节点标题）
- 任务名写成能执行的动作（动词开头、有交付物），不要口号/提醒
- 用户贴缩进大纲时，缩进就是层级，照建，别拍平
- 只改层级/挪位置用 update 传 parentId，别整树 replace；换方向用 board 新建一条，别复制旧路线
- 不要一次铺太满：默认 2–3 层，细节留给他。
- 不编造他没说过的事；不知道就问一句。

## 说话方式
- 中文，2–4 句，先结论后解释。不用「好的」「很高兴帮你」这类开场。
- 不用 emoji、不用 Markdown 标题；要列举最多三条短句。
- 只说动了哪几处，别复述整棵树。

${SKILLS.length ? `## 可用技能\n${skillIndexLines().join('\n')}\n` : ''}`
}
