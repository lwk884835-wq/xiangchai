/**
 * 行动路线的数据核心：MCP server 直接读写 data/routes.json。
 *
 * 语义和网页端 store 对齐（层级/分支/串行 deps/并行），但不依赖 React。
 * 数据只有这一份文件，网页通过 Vite 的 /api/routes 读写同一份，SSE 同步。
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

/**
 * 数据文件优先级：
 *   1. ROUTE_DATA_FILE 环境变量（客户端配置里可指定）
 *   2. data/routes-stable.json —— 稳定版（5180）的真实数据（lwk 刷新过稳定版后会自动生成）
 *   3. data/routes.json —— 开发版（5174）的数据
 */
const stableFile = resolve(import.meta.dirname, '..', 'data', 'routes-stable.json')
const devFile = resolve(import.meta.dirname, '..', 'data', 'routes.json')
export const dataFile = process.env.ROUTE_DATA_FILE
  ? resolve(process.env.ROUTE_DATA_FILE)
  : existsSync(stableFile)
    ? stableFile
    : devFile

const uid = () => `an-${Math.random().toString(36).slice(2, 10)}`
const bid = () => `bd-${Math.random().toString(36).slice(2, 10)}`
const fid = () => `fi-${Math.random().toString(36).slice(2, 10)}`

export function load() {
  if (!existsSync(dataFile)) {
    return { version: 1, updatedAt: 0, boards: [], focusItems: [], collapsed: {}, folders: [], images: {}, activeBoardId: null }
  }
  const data = JSON.parse(readFileSync(dataFile, 'utf8'))
  return {
    version: 1,
    updatedAt: Number(data.updatedAt ?? 0),
    boards: Array.isArray(data.boards) ? data.boards : [],
    focusItems: Array.isArray(data.focusItems) ? data.focusItems : [],
    collapsed: data.collapsed && typeof data.collapsed === 'object' ? data.collapsed : {},
    folders: Array.isArray(data.folders) ? data.folders : [],
    images: data.images && typeof data.images === 'object' ? data.images : {},
    activeBoardId: data.activeBoardId ?? null,
  }
}

export function save(state) {
  const next = { ...state, version: 1, updatedAt: Date.now() }
  mkdirSync(dirname(dataFile), { recursive: true })
  const tmp = `${dataFile}.tmp-${process.pid}`
  writeFileSync(tmp, JSON.stringify(next, null, 1), 'utf8')
  renameSync(tmp, dataFile)
  return next
}

/* ---------- 查询 ---------- */

export const findBoard = (state, key) => {
  if (!key) return state.boards.find((b) => b.id === state.activeBoardId) ?? state.boards[0] ?? null
  return (
    state.boards.find((b) => b.id === key) ??
    state.boards.find((b) => b.jobTitle === key || b.label === key) ??
    state.boards.find((b) => b.jobTitle.includes(key) || (b.label || '').includes(key)) ??
    null
  )
}

const activeBoard = (state) =>
  state.boards.find((b) => b.id === state.activeBoardId) ?? state.boards[0] ?? null

const ensureBoard = (state, key) => {
  const found = findBoard(state, key)
  if (found) return { board: found, created: false }
  const board = {
    id: bid(),
    jobTitle: key || '我的路线',
    jobCity: '',
    label: '',
    createdAt: Date.now(),
    nodes: [],
    archived: false,
  }
  state.boards.push(board)
  state.activeBoardId = board.id
  return { board, created: true }
}

const findNode = (board, key) =>
  board?.nodes.find((n) => n.id === key) ??
  board?.nodes.find((n) => n.title.includes(key)) ??
  null

const kidsOf = (nodes, pid) => nodes.filter((n) => n.parentId === pid)
const chainOf = (nodes, node) =>
  nodes.filter((n) => n.parentId === node.parentId && (n.branch || '') === (node.branch || ''))

const subtree = (nodes, id, into = new Set()) => {
  if (into.has(id)) return into
  into.add(id)
  for (const n of nodes) if (n.parentId === id) subtree(nodes, n.id, into)
  return into
}

const isAncestor = (nodes, a, b) => {
  let cur = nodes.find((n) => n.id === b)
  while (cur?.parentId) {
    if (cur.parentId === a) return true
    cur = nodes.find((n) => n.id === cur.parentId)
  }
  return false
}

const relevel = (nodes, rootId, level) => {
  for (const n of kidsOf(nodes, rootId)) {
    n.level = level + 1
    relevel(nodes, n.id, n.level)
  }
}

const plainRich = (value) => String(value ?? '').replace(/\[\[img:[A-Za-z0-9_-]+\]\]/g, '〔图片〕')

export function graphText(board, maxDepth = 6) {
  if (!board) return ''
  const nodes = board.nodes
  const lines = []
  const walk = (n, depth) => {
    if (depth > maxDepth) return
    const pad = '  '.repeat(Math.max(0, depth - 1))
    const tag = n.branch ? `〔${n.branch}〕` : ''
    const done = n.done ? '✓ ' : ''
    const pin = n.pinned ? '★ ' : ''
    const drop = n.dropped ? '⊘ ' : ''
    const link = n.linkBoardId ? '↪ ' : ''
    lines.push(`${pad}- ${link}${drop}${pin}${done}${tag}${n.title}`)
    const block = (label, value) => {
      if (!value) return
      const text = plainRich(value).trim()
      if (!text) return
      const parts = text.split(/\r?\n/)
      lines.push(`${pad}  · ${label ? label + '：' : ''}${parts[0]}`)
      for (const extra of parts.slice(1)) lines.push(`${pad}    ${extra}`)
    }
    block('', n.purpose)
    block('做法', n.detail)
    block('备注', n.notes)
    for (const c of kidsOf(nodes, n.id)) walk(c, depth + 1)
  }
  for (const r of nodes.filter((n) => !n.parentId)) walk(r, 1)
  return lines.join('\n')
}

export function listRoutes(state) {
  return state.boards.map((b) => ({
    title: b.jobTitle,
    id: b.id,
    label: b.label,
    city: b.jobCity,
    nodes: b.nodes.length,
    archived: b.archived,
    active: b.id === state.activeBoardId,
    folder: b.folder ?? '',
  }))
}

export function readRoute(state, { board: boardKey, node: nodeKey } = {}) {
  const board = boardKey ? findBoard(state, boardKey) : activeBoard(state)
  if (!board) return { ok: false, reason: '没有路线' }
  if (nodeKey) {
    const node = findNode(board, nodeKey)
    if (!node) return { ok: false, reason: '没找到这个任务', graph: graphText(board) }
    const chain = chainOf(board.nodes, node)
    const idx = chain.findIndex((n) => n.id === node.id)
    const parent = board.nodes.find((n) => n.id === node.parentId) ?? null
    return {
      ok: true,
      board: board.jobTitle,
      node: node.title,
      level: node.level,
      purpose: plainRich(node.purpose ?? ''),
      detail: plainRich(node.detail ?? ''),
      notes: plainRich(node.notes ?? ''),
      dropped: node.dropped === true,
      dropRoot: node.dropRoot === true,
      linkBoardId: node.linkBoardId ?? null,
      parent: parent?.title ?? null,
      prev: idx > 0 ? [chain[idx - 1].title] : [],
      next: idx < chain.length - 1 ? [chain[idx + 1].title] : [],
      parallel: kidsOf(board.nodes, node.parentId)
        .filter((n) => n.id !== node.id && (n.branch || '') !== (node.branch || ''))
        .map((n) => n.title),
      children: kidsOf(board.nodes, node.id).map((n) => n.title),
      graph: graphText(board),
    }
  }
  return {
    ok: true,
    board: board.jobTitle,
    label: board.label,
    nodes: board.nodes.length,
    boards: listRoutes(state),
    graph: graphText(board),
  }
}

/* ---------- 变更 ---------- */

const addCreated = (nodes, item, createdBy, orphans) => {
  const parentKey = String(item.parentId ?? '').trim()
  const parent =
    (parentKey ? createdBy.get(parentKey) : null) ??
    (parentKey ? findNode({ nodes }, parentKey) : null) ??
    null
  if (parentKey && !parent) orphans.push(String(item.title ?? parentKey))

  const level = Number(item.level ?? (parent ? parent.level + 1 : 1))
  const branch = String(item.branch ?? (parent ? parent.branch ?? '' : ''))
  const parallel = item.parallel === true
  const node = {
    id: uid(),
    title: String(item.title ?? '新任务'),
    purpose: String(item.purpose ?? ''),
    detail: String(item.detail ?? ''),
    notes: String(item.notes ?? ''),
    dropped: item.dropped === true,
    dropRoot: item.dropped === true,
    level,
    parentId: parent?.id ?? null,
    branch,
    deps: [],
    parallel,
    done: item.done === true,
    pinned: item.pinned === true,
    createdAt: Date.now(),
  }
  if (!parallel && parent) {
    const mates = nodes.filter(
      (n) => n.parentId === parent.id && (n.branch || '') === branch,
    )
    const prev = mates[mates.length - 1]
    if (prev) node.deps = [prev.id]
  }
  nodes.push(node)
  createdBy.set(node.id, node)
  createdBy.set(node.title, node)
  return node
}

export function applyOps(state, { board: boardKey, op, deleteMode, nodes: items = [] }) {
  const { board, created } = ensureBoard(state, boardKey)
  const nodes = board.nodes

  if (op === 'replace') {
    nodes.length = 0
    const createdBy = new Map()
    const orphans = []
    for (const item of items) addCreated(nodes, item, createdBy, orphans)
    return { board, created, applied: items.length, orphans, graph: graphText(board) }
  }

  if (op === 'create') {
    const createdBy = new Map()
    const orphans = []
    let n = 0
    for (const item of items) {
      addCreated(nodes, item, createdBy, orphans)
      n++
    }
    return { board, created, applied: n, orphans, graph: graphText(board) }
  }

  if (op === 'delete') {
    const mode = deleteMode === 'cascade' ? 'cascade' : 'only'
    let n = 0
    for (const item of items) {
      const node = findNode(board, String(item.id ?? item.title ?? ''))
      if (!node) continue
      const drop = new Set()
      subtree(nodes, node.id, drop)
      const mates = chainOf(nodes, node)
      const at = mates.findIndex((x) => x.id === node.id)
      const follow = at >= 0 ? mates.slice(at + 1) : []
      if (mode === 'cascade') for (const f of follow) subtree(nodes, f.id, drop)
      const prevDeps = node.deps ?? []
      const next = mode === 'only' ? follow[0] ?? null : null
      for (let i = nodes.length - 1; i >= 0; i--) if (drop.has(nodes[i].id)) nodes.splice(i, 1)
      for (const remain of nodes) {
        if (!remain.deps?.length) continue
        remain.deps = [
          ...new Set(
            remain.deps.flatMap((d) => {
              if (d === node.id) return next && remain.id === next.id ? prevDeps : []
              if (drop.has(d)) return []
              return [d]
            }),
          ),
        ]
      }
      n++
    }
    return { board, created, applied: n, mode, graph: graphText(board) }
  }

  if (op === 'detach') {
    let n = 0
    for (const item of items) {
      const node = findNode(board, String(item.id ?? item.title ?? ''))
      if (!node) continue
      const mates = chainOf(nodes, node)
      const at = mates.findIndex((x) => x.id === node.id)
      const prev = at > 0 ? mates[at - 1] : null
      const next = at >= 0 && at < mates.length - 1 ? mates[at + 1] : null
      if (mates.length <= 1) {
        node.parallel = true
        node.deps = []
        n++
        continue
      }
      const used = new Set(nodes.filter((x) => x.parentId === node.parentId).map((x) => x.branch))
      let i = 1
      while (used.has(`并行${i}`)) i++
      node.branch = `并行${i}`
      node.parallel = true
      node.deps = []
      if (next && (next.deps || []).includes(node.id)) next.deps = prev ? [prev.id] : []
      n++
    }
    return { board, created, applied: n, graph: graphText(board) }
  }

  if (op === 'focus') {
    let n = 0
    for (const item of items) {
      const node = findNode(board, String(item.id ?? item.title ?? ''))
      if (!node) continue
      node.pinned = item.pinned !== false
      n++
    }
    return { board, created, applied: n, graph: graphText(board) }
  }

  // update
  let n = 0
  for (const item of items) {
    const node = findNode(board, String(item.id ?? item.title ?? ''))
    if (!node) continue
    if (item.title != null) node.title = String(item.title)
    if (item.purpose != null) node.purpose = String(item.purpose)
    if (item.detail != null) node.detail = String(item.detail)
    if (item.notes != null) node.notes = String(item.notes)
    if (item.dropped != null) {
      node.dropped = item.dropped === true
      node.dropRoot = item.dropped === true
    }
    if (item.branch != null) node.branch = String(item.branch)
    if (item.parallel != null) node.parallel = item.parallel === true
    if (item.pinned != null || item.focus != null) node.pinned = item.pinned !== false
    if (item.done != null) node.done = item.done === true
    if (item.parentId !== undefined) {
      const key = String(item.parentId ?? '').trim()
      if (!key) {
        node.parentId = null
        if (item.level == null) node.level = 1
      } else {
        const parent = findNode(board, key)
        if (parent && parent.id !== node.id && !isAncestor(nodes, node.id, parent.id)) {
          node.parentId = parent.id
          if (item.level == null) node.level = parent.level + 1
        }
      }
    }
    if (item.level != null) node.level = Number(item.level)
    if (Array.isArray(item.deps)) {
      node.deps = item.deps
        .map((d) => findNode(board, String(d))?.id)
        .filter((x) => !!x && x !== node.id)
    }
    relevel(nodes, node.id, node.level)
    n++
  }
  return { board, created, applied: n, graph: graphText(board) }
}

export function moveNodes(state, { moves = [] }) {
  let moved = 0
  const failed = []
  for (const m of moves) {
    const key = String(m.id ?? '').trim()
    const position = String(m.position ?? 'child')
    const toBoardKey = String(m.board ?? '').trim()
    const targetKey = String(m.target ?? '').trim()
    let fromBoard = null
    let node = null
    for (const bd of state.boards) {
      const hit = findNode(bd, key)
      if (hit) {
        fromBoard = bd
        node = hit
        break
      }
    }
    if (!fromBoard || !node) {
      failed.push(`${key}（没找到）`)
      continue
    }
    const destBoard = toBoardKey ? findBoard(state, toBoardKey) : fromBoard
    if (!destBoard) {
      failed.push(`${key}（目标路线没找到）`)
      continue
    }
    const target = targetKey ? findNode(destBoard, targetKey) : null
    if (targetKey && !target) {
      failed.push(`${key}（目标没找到）`)
      continue
    }

    const sameBoard = fromBoard.id === destBoard.id
    const chainMates = chainOf(fromBoard.nodes, node)
    const at = chainMates.findIndex((x) => x.id === node.id)
    const follow = at >= 0 ? chainMates.slice(at + 1) : []
    const chain = [node, ...follow]
    const carry = position === 'child'
    const moving = new Set()
    if (carry) {
      for (const c of chain) subtree(fromBoard.nodes, c.id, moving)
    } else {
      subtree(fromBoard.nodes, node.id, moving)
    }
    if (sameBoard && target && moving.has(target.id)) {
      failed.push(`${key}（不能挪到自己的子任务里）`)
      continue
    }

    const chainIds = new Set(chain.map((c) => c.id))
    const movedNodes = fromBoard.nodes.filter((n) => moving.has(n.id))
    if (!movedNodes.length) {
      failed.push(`${key}（没搬动）`)
      continue
    }

    let baseLevel
    let parentId
    let destBranch
    const usedBranches = (parent) =>
      new Set(destBoard.nodes.filter((n) => n.parentId === parent.id).map((n) => n.branch || ''))
    const newBranch = (parent) => {
      const used = usedBranches(parent)
      let i = 1
      while (used.has(`并行${i}`)) i++
      return `并行${i}`
    }

    if (position === 'child') {
      let parent = target
      if (!parent) parent = [...destBoard.nodes].reverse().find((n) => !n.parentId) ?? null
      parentId = parent ? parent.id : null
      baseLevel = parent ? parent.level + 1 : 1
      destBranch = parent ? newBranch(parent) : ''
    } else {
      if (!sameBoard) {
        failed.push(`${key}（跨路线只支持 position=child）`)
        continue
      }
      if (!target) {
        failed.push(`${key}（缺 target）`)
        continue
      }
      const parent = fromBoard.nodes.find((n) => n.id === target.parentId) ?? null
      parentId = parent ? parent.id : null
      baseLevel = target.level
      destBranch = target.branch || ''
    }

    const delta = baseLevel - node.level
    const rest = fromBoard.nodes.filter((n) => !moving.has(n.id))
    const updated = movedNodes.map((n) => {
      const isChain = chainIds.has(n.id)
      const patch = { level: Math.max(1, n.level + delta) }
      if (isChain) {
        patch.parentId = parentId
        patch.branch = destBranch
        patch.parallel = n.id === node.id ? position === 'child' : n.parallel
        if (n.id === node.id) patch.deps = []
      }
      return { ...n, ...patch }
    })

    let finalNodes
    if (position === 'child' || !sameBoard) {
      finalNodes = [...rest, ...updated]
    } else {
      // before/after：单卡插到目标前/后，再按行序重接被影响分支的 deps
      const head = updated.find((n) => n.id === node.id)
      const descendants = updated.filter((n) => n.id !== node.id)
      const base = rest
      const ti = base.findIndex((n) => n.id === target.id)
      if (ti < 0) {
        failed.push(`${key}（目标位置没找到）`)
        continue
      }
      const insertAt = position === 'before' ? ti : ti + 1
      finalNodes = [
        ...base.slice(0, insertAt),
        { ...head, branch: destBranch, parallel: false, deps: [] },
        ...base.slice(insertAt),
        ...descendants,
      ]
      const branches = new Set([node.branch || '', destBranch])
      for (const br of branches) {
        const group = finalNodes.filter(
          (n) => n.parentId === node.parentId && (n.branch || '') === br,
        )
        group.forEach((n, i) => {
          n.deps = i > 0 ? [group[i - 1].id] : []
        })
      }
    }

    fromBoard.nodes = finalNodes
    state.activeBoardId = destBoard.id
    moved++
  }
  return { moved, failed, board: activeBoard(state), graph: graphText(activeBoard(state)) }
}

export function setDone(state, { nodes: items = [] }) {
  const board = activeBoard(state)
  const nodes = board?.nodes ?? []
  const byId = new Map(nodes.map((n) => [n.id, n]))
  let changed = 0
  const failed = []

  for (const item of items) {
    const node = findNode(board, String(item.id ?? ''))
    if (!node) {
      failed.push(String(item.id ?? ''))
      continue
    }
    const desired = item.done === true
    if (node.done === desired) continue
    const hit = new Set([node.id])
    const sweepDown = (pid) => {
      for (const n of nodes) {
        if (n.parentId === pid && !hit.has(n.id)) {
          hit.add(n.id)
          sweepDown(n.id)
        }
      }
    }
    const addWithSubtree = (id) => {
      if (hit.has(id)) return
      hit.add(id)
      sweepDown(id)
    }
    sweepDown(node.id)
    if (desired) {
      const chain = chainOf(nodes, node)
      const at = chain.findIndex((n) => n.id === node.id)
      for (let i = 0; i < at; i++) addWithSubtree(chain[i].id)
      const walkDeps = (nid) => {
        const n = byId.get(nid)
        if (!n) return
        for (const d of n.deps) {
          if (hit.has(d)) continue
          addWithSubtree(d)
          walkDeps(d)
        }
      }
      walkDeps(node.id)
    } else {
      let up = node.parentId ? byId.get(node.parentId) : undefined
      while (up) {
        hit.add(up.id)
        up = up.parentId ? byId.get(up.parentId) : undefined
      }
      let grew = true
      while (grew) {
        grew = false
        for (const n of nodes) {
          if (hit.has(n.id)) continue
          if (n.deps.some((d) => hit.has(d))) {
            hit.add(n.id)
            grew = true
          }
        }
      }
    }
    for (const n of nodes) if (hit.has(n.id)) n.done = desired
    changed++
  }
  return { changed, failed, graph: graphText(board) }
}

export function manageRoutes(state, { op, board: key, title, label, city, folder }) {
  if (op === 'list') return { boards: listRoutes(state), folders: state.folders ?? [] }
  if (op === 'create') {
    const { board } = ensureBoard(state, title || '新路线')
    if (label != null) board.label = String(label)
    if (city != null) board.jobCity = String(city)
    if (folder != null) {
      board.folder = String(folder)
      if (String(folder) && !(state.folders ?? []).includes(String(folder))) {
        state.folders = [...(state.folders ?? []), String(folder)]
      }
    }
    state.activeBoardId = board.id
    return { created: board.jobTitle, boards: listRoutes(state), folders: state.folders ?? [] }
  }
  const board = findBoard(state, key)
  if (!board) return { ok: false, reason: '没找到这条路线', boards: listRoutes(state) }
  if (op === 'rename') {
    if (title != null) board.jobTitle = String(title)
    if (label != null) board.label = String(label)
    if (city != null) board.jobCity = String(city)
  } else if (op === 'archive') {
    board.archived = true
  } else if (op === 'restore') {
    board.archived = false
  } else if (op === 'delete') {
    state.boards = state.boards.filter((b) => b.id !== board.id)
    if (state.activeBoardId === board.id) state.activeBoardId = state.boards[0]?.id ?? null
  } else if (op === 'select') {
    state.activeBoardId = board.id
  } else if (op === 'folder') {
    board.folder = String(folder ?? '')
    if (folder && !(state.folders ?? []).includes(String(folder))) {
      state.folders = [...(state.folders ?? []), String(folder)]
    }
  }
  if (folder != null && op !== 'folder') {
    board.folder = String(folder)
    if (folder && !(state.folders ?? []).includes(String(folder))) {
      state.folders = [...(state.folders ?? []), String(folder)]
    }
  }
  return { ok: true, op, board: board.jobTitle, boards: listRoutes(state), folders: state.folders ?? [] }
}

export function focusItems(state, { op, id, text }) {
  const items = state.focusItems
  const target =
    items.find((f) => f.id === id) ?? items.find((f) => String(f.text).includes(String(id ?? '')))
  if (op === 'add' && String(text ?? '').trim()) {
    items.push({ id: fid(), text: String(text).trim(), done: false, createdAt: Date.now() })
  } else if (op === 'toggle' && target) {
    target.done = !target.done
  } else if (op === 'remove' && target) {
    state.focusItems = items.filter((f) => f.id !== target.id)
  }
  return {
    items: state.focusItems.map((f) => ({ id: f.id, text: f.text, done: f.done })),
  }
}
