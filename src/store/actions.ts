import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ActionBoard, ActionNode } from '@/types'

/**
 * 行动路线：一个方向/计划可以有多份路线（比如「主计划 / 备用」）。
 *
 * 节点扁平存放（parentId 指回上级），查找走 Map：
 * 增删改一个节点不用重建整棵树，节点多了也不卡。
 *
 * 树的语义：
 * - 一级 = 目标（大卡）
 * - 同一 branch 下的子节点 = 一条路线内的一串动作，横向排开
 * - 不同 branch = 分叉出的多条路线，竖着堆叠
 * - deps 表达串行依赖
 */

export interface FocusItem {
  id: string
  text: string
  done: boolean
  createdAt: number
}

const uid = () => Math.random().toString(36).slice(2, 10)

interface ActionState {
  boards: ActionBoard[]
  activeBoardId: string | null
  /** 用户自己加的临时事项，全局（不属于任何一条路线） */
  focusItems: FocusItem[]
  /** 折叠状态，按路线分：{ [boardId]: string[] } */
  collapsed: Record<string, string[]>

  addBoard: (b: { jobTitle: string; jobCity?: string; label?: string }) => string
  setActiveBoard: (id: string) => void
  removeBoard: (id: string) => void
  archiveBoard: (id: string) => void
  restoreBoard: (id: string) => void
  renameBoard: (id: string, patch: Partial<Pick<ActionBoard, 'jobTitle' | 'jobCity' | 'label'>>) => void

  addNode: (
    node: Partial<ActionNode> & { title: string; level: number; beforeId?: string },
    boardId?: string,
  ) => string
  updateNode: (id: string, patch: Partial<ActionNode>, boardId?: string) => void
  toggleNode: (id: string, boardId?: string) => void
  /** 撤销栈：勾选 / 删除 / 拖拽前各存一份整路线快照，删错了能整体退回去 */
  history: { label: string; boards: ActionBoard[]; activeBoardId: string | null }[]
  /** 撤回上一步，返回那一步的名字（勾选/删除/拖拽…）；没有可撤回的返回 null */
  undo: () => string | null
  pinNode: (id: string, pinned: boolean, boardId?: string) => void
  removeNode: (id: string, boardId?: string) => void
  moveNode: (id: string, dir: -1 | 1, boardId?: string) => void
  /**
   * 把一个串行链上的子任务独立出来：单独一条线（新的 branch），不接前置。
   * 如果后面还串着任务，那个任务的前置改接到它的上一步，链不断。
   */
  detachNode: (id: string, boardId?: string) => void
  /**
   * 删节点：
   * - mode='only'：删它 + 它的子树；同一串里后面那一步的前置跨过它，接到它的前一步
   * - mode='cascade'：删它 + 子树 + 同一串里后面所有步骤及它们的子树
   */
  deleteNode: (id: string, mode: 'only' | 'cascade', boardId?: string) => void
  /**
   * 拖拽搬动：搬「它 + 子树 + 同一串里后面的步骤（含子树）」。
   * 放到目标卡片上 → 成为目标的子任务，接在目标现有子任务后面。
   */
  moveSubtree: (id: string, targetId: string, boardId?: string) => void
  /** 拖到路线列表：整串搬到另一条路线，挂到那条路线最后一个目标下面 */
  moveSubtreeToBoard: (id: string, targetBoardId: string, targetId?: string) => void
  toggleCollapse: (id: string, boardId?: string) => void

  addFocusItem: (text: string) => void
  toggleFocusItem: (id: string) => void
  removeFocusItem: (id: string) => void

  /** 导出全部路线数据（换浏览器、换机器时搬数据用） */
  exportData: () => string
  /** 导入：按 board id 去重合并 */
  importData: (raw: string) => { boards: number; focus: number }
}

export const useActions = create<ActionState>()(
  persist(
    (set, get) => {
      /** 找到某条路线；不传就用当前这条 */
      const boardOf = (boardId?: string) => {
        const s = get()
        const id = boardId ?? s.activeBoardId
        return s.boards.find((b) => b.id === id) ?? null
      }
      const patchBoard = (boardId: string | undefined, fn: (b: ActionBoard) => ActionBoard) =>
        set((s) => ({
          boards: s.boards.map((b) => (b.id === (boardId ?? s.activeBoardId) ? fn(b) : b)),
        }))

      /** 记一步「改动前」的整份路线快照：勾选/删除/拖拽都用同一个撤回按钮 */
      const cloneBoards = (boards: ActionBoard[]) =>
        JSON.parse(JSON.stringify(boards)) as ActionBoard[]
      const pushHistory = (label: string) =>
        set((s) => ({
          history: [
            { label, boards: cloneBoards(s.boards), activeBoardId: s.activeBoardId },
            ...s.history,
          ].slice(0, 30),
        }))

      return {
        boards: [],
        activeBoardId: null,
        focusItems: [],
        collapsed: {},
        history: [],

        addBoard: (b) => {
          const id = `bd-${uid()}`
          const board: ActionBoard = {
            id,
            jobTitle: b.jobTitle,
            jobCity: b.jobCity ?? '',
            label: b.label ?? '',
            createdAt: Date.now(),
            nodes: [],
            archived: false,
          }
          set((s) => ({ boards: [board, ...s.boards], activeBoardId: id }))
          return id
        },

        setActiveBoard: (id) => set({ activeBoardId: id }),

        removeBoard: (id) =>
          set((s) => {
            const boards = s.boards.filter((b) => b.id !== id)
            return {
              boards,
              activeBoardId: s.activeBoardId === id ? (boards[0]?.id ?? null) : s.activeBoardId,
            }
          }),

        archiveBoard: (id) =>
          set((s) => ({
            boards: s.boards.map((b) => (b.id === id ? { ...b, archived: true } : b)),
            activeBoardId: s.activeBoardId === id ? null : s.activeBoardId,
          })),

        restoreBoard: (id) =>
          set((s) => ({
            boards: s.boards.map((b) => (b.id === id ? { ...b, archived: false } : b)),
          })),

        renameBoard: (id, patch) =>
          set((s) => ({
            boards: s.boards.map((b) => (b.id === id ? { ...b, ...patch } : b)),
          })),

        addNode: (input, boardId) => {
          const id = `an-${uid()}`
          // 并行的子任务如果没指定路线名，自动给它一条独立分支：
          // 这样它会单独占一行、从父卡单独引一条线出来，而不是接在串行链后面。
          let branch = input.branch ?? ''
          if (input.parallel === true && !branch) {
            const target = boardOf(boardId)
            const siblings = (target?.nodes ?? []).filter(
              (n) => n.parentId === (input.parentId ?? null),
            )
            const used = new Set(siblings.map((s2) => s2.branch))
            let i = 1
            while (used.has(`并行${i}`)) i++
            branch = `并行${i}`
          }
          const node: ActionNode = {
            id,
            title: input.title,
            purpose: input.purpose ?? '',
            detail: input.detail ?? '',
            level: input.level,
            parentId: input.parentId ?? null,
            branch,
            deps: input.deps ?? [],
            parallel: input.parallel ?? false,
            done: input.done ?? false,
            pinned: input.pinned ?? false,
            createdAt: Date.now(),
          }
          const target = boardOf(boardId)
          /*
            插在哪里由数组顺序决定（同一分支里的先后就是数组顺序）：
            传了 beforeId 就插到那个节点前面——「加在最前」用的就是它。
            以前只往数组尾巴 push，按钮写着「加在最前」其实还是加在最后。
          */
          const insert = (nodes: ActionNode[]) => {
            if (!input.beforeId) return [...nodes, node]
            const at = nodes.findIndex((n) => n.id === input.beforeId)
            if (at < 0) return [...nodes, node]
            return [...nodes.slice(0, at), node, ...nodes.slice(at)]
          }
          if (!target) {
            // 没有路线就先建一条
            const bid = get().addBoard({ jobTitle: '（未命名路线）' })
            patchBoard(bid, (b) => ({ ...b, nodes: insert(b.nodes) }))
            return id
          }
          patchBoard(target.id, (b) => ({ ...b, nodes: insert(b.nodes) }))
          return id
        },

        updateNode: (id, patch, boardId) =>
          patchBoard(boardId, (b) => ({
            ...b,
            nodes: b.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)),
          })),

        toggleNode: (id, boardId) => {
          const board = boardOf(boardId)
          const node = board?.nodes.find((n) => n.id === id)
          if (!board || !node) return
          const next = !node.done

          /*
            勾选是级联的，一次动一片：
            - 勾上父任务 → 它下面所有子任务一起勾上
            - 勾上串行链里靠后的一步 → 前面几步、以及它显式声明的前置（deps）都一起勾上
            - 反过来取消 → 自己、下面的、上面的、以及依赖它的后续任务都松开，
              不然会出现「父级没做完子级却完成」「前置没做后面却完成」
            动之前把整份路线快照压进撤销栈，界面上用同一个「撤回」按钮退回去。
          */
          const hit = new Set<string>([id])
          const byId = new Map(board.nodes.map((n) => [n.id, n]))
          const sweepDown = (pid: string) => {
            for (const k of board.nodes) {
              if (k.parentId === pid && !hit.has(k.id)) {
                hit.add(k.id)
                sweepDown(k.id)
              }
            }
          }
          /** 加一个节点连同它下面的整棵子树 */
          const addWithSubtree = (nid: string) => {
            if (hit.has(nid)) return
            hit.add(nid)
            sweepDown(nid)
          }
          sweepDown(id)
          if (next) {
            // 1) 同一条串行线里排在它前面的（老数据只靠先后顺序，没有 deps）
            const chain = board.nodes.filter(
              (n) => n.parentId === node.parentId && (n.branch || '') === (node.branch || ''),
            )
            const at = chain.findIndex((n) => n.id === id)
            for (let i = 0; i < at; i++) addWithSubtree(chain[i].id)
            // 2) 显式前置依赖 deps：跨线路的串行也认，顺着链一路往上
            const walkDeps = (nid: string) => {
              const n = byId.get(nid)
              if (!n) return
              for (const d of n.deps) {
                if (hit.has(d)) continue
                addWithSubtree(d)
                walkDeps(d)
              }
            }
            walkDeps(id)
          } else {
            // 上面的父级
            let up = node.parentId ? byId.get(node.parentId) : undefined
            while (up) {
              hit.add(up.id)
              up = up.parentId ? byId.get(up.parentId) : undefined
            }
            // 依赖它的后续任务（反向依赖，传到底）
            let grew = true
            while (grew) {
              grew = false
              for (const n of board.nodes) {
                if (hit.has(n.id)) continue
                if (n.deps.some((d) => hit.has(d))) {
                  hit.add(n.id)
                  grew = true
                }
              }
            }
          }

          pushHistory('勾选')

          set((s) => ({
            boards: s.boards.map((b) =>
              b.id === board.id
                ? { ...b, nodes: b.nodes.map((n) => (hit.has(n.id) ? { ...n, done: next } : n)) }
                : b,
            ),
          }))
        },

        undo: () => {
          const last = get().history[0]
          if (!last) return null
          set((s) => ({
            history: s.history.slice(1),
            boards: last.boards,
            activeBoardId: last.activeBoardId ?? s.activeBoardId,
          }))
          return last.label
        },

        pinNode: (id, pinned, boardId) =>
          patchBoard(boardId, (b) => ({
            ...b,
            nodes: b.nodes.map((n) => (n.id === id ? { ...n, pinned } : n)),
          })),

        // 删父节点要把它的后代一起带走
        removeNode: (id, boardId) =>
          patchBoard(boardId, (b) => {
            const drop = new Set<string>([id])
            let grew = true
            while (grew) {
              grew = false
              for (const n of b.nodes) {
                if (n.parentId && drop.has(n.parentId) && !drop.has(n.id)) {
                  drop.add(n.id)
                  grew = true
                }
              }
            }
            return { ...b, nodes: b.nodes.filter((n) => !drop.has(n.id)) }
          }),

        // 在同一父节点下左右移动
        moveNode: (id, dir, boardId) =>
          patchBoard(boardId, (b) => {
            const idx = b.nodes.findIndex((n) => n.id === id)
            if (idx < 0) return b
            const node = b.nodes[idx]
            const siblings = b.nodes.filter((n) => n.parentId === node.parentId)
            const pos = siblings.findIndex((n) => n.id === id)
            const swapWith = siblings[pos + dir]
            if (!swapWith) return b
            const otherIdx = b.nodes.findIndex((n) => n.id === swapWith.id)
            const nodes = [...b.nodes]
            ;[nodes[idx], nodes[otherIdx]] = [nodes[otherIdx], nodes[idx]]
            return { ...b, nodes }
          }),

        detachNode: (id, boardId) => {
          const board = boardOf(boardId)
          const node = board?.nodes.find((n) => n.id === id)
          if (!board || !node) return
          pushHistory('独立成线')

          // 同一父级、同一 branch 的兄弟，数组顺序就是串行顺序
          const mates = board.nodes.filter(
            (n) => n.parentId === node.parentId && (n.branch || '') === (node.branch || ''),
          )
          const at = mates.findIndex((n) => n.id === id)
          const prev = at > 0 ? mates[at - 1] : null
          const next = at >= 0 && at < mates.length - 1 ? mates[at + 1] : null

          // 已经不在串行链上：只清掉可能残留的前置，不再造一条分支
          if (mates.length <= 1) {
            patchBoard(boardId, (b) => ({
              ...b,
              nodes: b.nodes.map((n) =>
                n.id === id ? { ...n, parallel: true, deps: [] } : n,
              ),
            }))
            return
          }

          // 找一条没被占用的并行分支名（沿用「并行N」的命名习惯）
          const used = new Set(
            board.nodes.filter((n) => n.parentId === node.parentId).map((n) => n.branch),
          )
          let i = 1
          while (used.has(`并行${i}`)) i++
          const branch = `并行${i}`

          patchBoard(boardId, (b) => ({
            ...b,
            nodes: b.nodes.map((n) => {
              if (n.id === id) return { ...n, branch, parallel: true, deps: [] }
              // 后面的串行任务：前置从「被拆出去的那个」改接到它的上一步，链保持连续
              if (next && n.id === next.id && (n.deps || []).includes(id)) {
                return { ...n, deps: prev ? [prev.id] : [] }
              }
              return n
            }),
          }))
        },

        deleteNode: (id, mode, boardId) => {
          const board = boardOf(boardId)
          const node = board?.nodes.find((n) => n.id === id)
          if (!board || !node) return
          pushHistory('删除')

          const nodes = board.nodes
          // 同一串（同父级 + 同 branch）里，按数组顺序排在它后面的兄弟
          const mates = nodes.filter(
            (n) => n.parentId === node.parentId && (n.branch || '') === (node.branch || ''),
          )
          const at = mates.findIndex((n) => n.id === id)
          const follow = at >= 0 ? mates.slice(at + 1) : []

          const collect = (rootId: string, into: Set<string>) => {
            if (into.has(rootId)) return
            into.add(rootId)
            for (const n of nodes) if (n.parentId === rootId) collect(n.id, into)
          }

          const drop = new Set<string>()
          collect(id, drop)
          if (mode === 'cascade') {
            for (const f of follow) collect(f.id, drop)
          }

          // 删掉后，链上「被删节点的前置」用它的原前置补上
          const prevDeps = node.deps ?? []
          const next = mode === 'only' ? (follow[0] ?? null) : null

          patchBoard(boardId, (b) => {
            const kept = b.nodes.filter((n) => !drop.has(n.id))
            const fixed = kept.map((n) => {
              if (!n.deps?.length) return n
              // 被删掉的依赖：只删这一条的情况接到被删节点的前置，级联情况直接去掉
              let deps = n.deps.flatMap((d) => {
                if (d === id) return next && n.id === next.id ? prevDeps : []
                if (drop.has(d)) return []
                return [d]
              })
              // 去重
              deps = [...new Set(deps)]
              const same = deps.length === n.deps.length && deps.every((d, i) => d === n.deps[i])
              return same ? n : { ...n, deps }
            })
            return { ...b, nodes: fixed }
          })
        },

        moveSubtree: (id, targetId) => {
          if (id === targetId) return
          const s0 = get()
          const fromBoard = s0.boards.find((b) => b.nodes.some((n) => n.id === id))
          const toBoard = s0.boards.find((b) => b.nodes.some((n) => n.id === targetId))
          if (!fromBoard || !toBoard) return
          // 目标在另一条路线：转跨路线搬运
          if (fromBoard.id !== toBoard.id) {
            get().moveSubtreeToBoard(id, toBoard.id, targetId)
            return
          }
          const nodes = fromBoard.nodes
          const node = nodes.find((n) => n.id === id)
          const target = nodes.find((n) => n.id === targetId)
          if (!node || !target) return

          // 搬动集合 = 自己 + 子树 + 同一串后面的步骤（各自带子树）
          const mates = nodes.filter(
            (n) => n.parentId === node.parentId && (n.branch || '') === (node.branch || ''),
          )
          const at = mates.findIndex((n) => n.id === id)
          const follow = at >= 0 ? mates.slice(at + 1) : []
          const chain = [node, ...follow]
          const moving = new Set<string>()
          const collect = (rootId: string) => {
            if (moving.has(rootId)) return
            moving.add(rootId)
            for (const n of nodes) if (n.parentId === rootId) collect(n.id)
          }
          for (const c of chain) collect(c.id)
          if (moving.has(target.id)) return

          /*
            放到目标卡片上 = 变成目标的**一条新的并行子链**：
            给它一条自己的 branch（并行N），不接目标现有子任务的后面。
            被拖的这段如果本来是一串（A→B→C），搬过去仍然是一串。
          */
          const used = new Set(
            nodes
              .filter((n) => n.parentId === target.id && !moving.has(n.id))
              .map((n) => n.branch || ''),
          )
          let bi = 1
          while (used.has(`并行${bi}`)) bi++
          const destBranch = `并行${bi}`
          const delta = target.level + 1 - node.level
          const chainIds = new Set(chain.map((c) => c.id))
          const movingNodes = nodes.filter((n) => moving.has(n.id))
          const kept = nodes.filter((n) => !moving.has(n.id))
          const updated = movingNodes.map((n) => {
            if (chainIds.has(n.id)) {
              return {
                ...n,
                level: Math.max(1, n.level + delta),
                parentId: target.id,
                branch: destBranch,
                parallel: n.id === id,
                deps: n.id === id ? [] : n.deps,
              }
            }
            return { ...n, level: Math.max(1, n.level + delta) }
          })
          pushHistory('拖拽')
          patchBoard(fromBoard.id, (b) => ({ ...b, nodes: [...kept, ...updated] }))
        },

        moveSubtreeToBoard: (id, targetBoardId, targetId) => {
          const s0 = get()
          const from = s0.boards.find((b) => b.nodes.some((n) => n.id === id))
          const to = s0.boards.find((b) => b.id === targetBoardId)
          if (!from || !to || from.id === to.id) return
          const node = from.nodes.find((n) => n.id === id)
          if (!node) return

          const mates = from.nodes.filter(
            (n) => n.parentId === node.parentId && (n.branch || '') === (node.branch || ''),
          )
          const at = mates.findIndex((n) => n.id === id)
          const follow = at >= 0 ? mates.slice(at + 1) : []
          const chain = [node, ...follow]
          const moving = new Set<string>()
          const collect = (rootId: string) => {
            if (moving.has(rootId)) return
            moving.add(rootId)
            for (const n of from.nodes) if (n.parentId === rootId) collect(n.id)
          }
          for (const c of chain) collect(c.id)

          // 落点：指定了目标卡片 → 成为它的并行子链；否则挂到最后一个目标下；空路线 → 作为新目标
          const target = targetId ? (to.nodes.find((n) => n.id === targetId) ?? null) : null
          const parent =
            target ??
            (to.nodes.length
              ? ([...to.nodes].reverse().find((n) => n.parentId === null) ?? null)
              : null)
          const usedBranches = new Set(
            parent ? to.nodes.filter((n) => n.parentId === parent.id).map((n) => n.branch || '') : [],
          )
          let bi = 1
          while (usedBranches.has(`并行${bi}`)) bi++
          const destBranch = parent ? `并行${bi}` : ''
          const baseLevel = parent ? parent.level + 1 : 1
          const delta = baseLevel - node.level
          const chainIds = new Set(chain.map((c) => c.id))

          const movingNodes = from.nodes.filter((n) => moving.has(n.id))
          const updated = movingNodes.map((n) => {
            if (chainIds.has(n.id)) {
              return {
                ...n,
                level: Math.max(1, n.level + delta),
                parentId: parent ? parent.id : null,
                branch: destBranch,
                parallel: n.id === id,
                deps: n.id === id ? [] : n.deps,
              }
            }
            return { ...n, level: Math.max(1, n.level + delta) }
          })

          pushHistory('跨路线拖拽')
          set((s2) => ({
            activeBoardId: to.id,
            boards: s2.boards.map((b) => {
              if (b.id === from.id) return { ...b, nodes: b.nodes.filter((n) => !moving.has(n.id)) }
              if (b.id === to.id) return { ...b, nodes: [...b.nodes, ...updated] }
              return b
            }),
          }))
        },

        toggleCollapse: (id, boardId) =>
          set((s) => {
            const bid = boardId ?? s.activeBoardId
            if (!bid) return s
            const cur = s.collapsed[bid] ?? []
            return {
              collapsed: {
                ...s.collapsed,
                [bid]: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id],
              },
            }
          }),

        addFocusItem: (text) =>
          set((s) => ({
            focusItems: [
              ...s.focusItems,
              { id: `fi-${uid()}`, text: text.trim(), done: false, createdAt: Date.now() },
            ],
          })),

        toggleFocusItem: (id) =>
          set((s) => ({
            focusItems: s.focusItems.map((f) => (f.id === id ? { ...f, done: !f.done } : f)),
          })),

        removeFocusItem: (id) =>
          set((s) => ({ focusItems: s.focusItems.filter((f) => f.id !== id) })),

        exportData: () => {
          const s = get()
          return JSON.stringify(
            {
              version: 1,
              exportedAt: new Date().toISOString(),
              boards: s.boards,
              focusItems: s.focusItems,
              collapsed: s.collapsed,
              activeBoardId: s.activeBoardId,
            },
            null,
            1,
          )
        },

        importData: (raw) => {
          try {
            const data = JSON.parse(raw) as {
              boards?: ActionBoard[]
              focusItems?: FocusItem[]
              collapsed?: Record<string, string[]>
            }
            const boards = data.boards ?? []
            const focusItems = data.focusItems ?? []
            set((s) => {
              const have = new Set(s.boards.map((b) => b.id))
              const add = boards.filter((b) => !have.has(b.id))
              const merged = [...s.boards, ...add]
              return {
                boards: merged,
                focusItems: [
                  ...s.focusItems,
                  ...focusItems.filter((f) => !s.focusItems.some((x) => x.id === f.id)),
                ],
                collapsed: { ...s.collapsed, ...(data.collapsed ?? {}) },
                activeBoardId: add.length ? add[0].id : s.activeBoardId,
              }
            })
            return { boards: boards.length, focus: focusItems.length }
          } catch {
            return { boards: 0, focus: 0 }
          }
        },
      }
    },
    {
      name: 'work-route-actions-v1',
      // 读盘时清洗一遍：本地数据可能来自更早的版本（缺 nodes、boards 不是数组……），
      // 不清洗就会白屏。宁可丢一点异常数据，也不能进不去。
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<ActionState>
        const rawBoards = Array.isArray(p.boards) ? p.boards : []
        const boards: ActionBoard[] = rawBoards
          .filter((b): b is ActionBoard => !!b && typeof b === 'object')
          .map((b) => ({
            id: String(b.id ?? `bd-${Math.random().toString(36).slice(2, 8)}`),
            jobTitle: String(b.jobTitle ?? '未命名路线'),
            jobCity: String(b.jobCity ?? ''),
            label: String(b.label ?? ''),
            createdAt: Number(b.createdAt ?? Date.now()),
            archived: !!b.archived,
            nodes: Array.isArray(b.nodes)
              ? b.nodes.filter((n) => n && typeof n === 'object' && n.title)
              : [],
          }))
        const collapsed =
          p.collapsed && typeof p.collapsed === 'object' && !Array.isArray(p.collapsed)
            ? p.collapsed
            : {}
        return {
          ...current,
          ...p,
          boards,
          focusItems: Array.isArray(p.focusItems) ? p.focusItems : [],
          collapsed,
          activeBoardId:
            boards.find((b) => b.id === p.activeBoardId)?.id ?? boards[0]?.id ?? null,
          // 撤销栈不落盘：恢复上一次的删除快照会跨刷新出错
          history: [],
        }
      },
    },
  ),
)

/* ---------- 派生查询（都吃 nodes 数组，跟具体哪条路线无关） ---------- */

export function childrenOf(nodes: ActionNode[], parentId: string | null): ActionNode[] {
  return nodes.filter((n) => n.parentId === parentId)
}

export function rootsOf(nodes: ActionNode[]): ActionNode[] {
  return nodes.filter((n) => !n.parentId)
}

export function focusNodes(nodes: ActionNode[]): ActionNode[] {
  return nodes
    .filter((n) => n.pinned)
    .sort((a, b) => a.level - b.level || a.createdAt - b.createdAt)
}

export function subtreeOf(nodes: ActionNode[], rootId: string, maxDepth = 3): ActionNode[] {
  const out: ActionNode[] = []
  const walk = (id: string, depth: number) => {
    if (depth > maxDepth) return
    for (const child of childrenOf(nodes, id)) {
      out.push(child)
      walk(child.id, depth + 1)
    }
  }
  walk(rootId, 1)
  return out
}

export function actionProgress(nodes: ActionNode[]): number {
  if (!nodes.length) return 0
  const leaves = nodes.filter((n) => !childrenOf(nodes, n.id).length)
  const target = leaves.length ? leaves : nodes
  const done = target.filter((n) => n.done).length
  return Math.round((done / target.length) * 100)
}

/** 整棵树的缩进文本：给「我现在在哪」和导出用 */
export function actionGraphText(nodes: ActionNode[], maxDepth = 3): string {
  if (!nodes.length) return ''
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const lines: string[] = []

  const walk = (id: string, depth: number, prefix: string) => {
    const n = byId.get(id)
    if (!n) return
    const kids = childrenOf(nodes, id)
    const done = kids.length ? `${kids.filter((k) => k.done).length}/${kids.length}` : n.done ? '已完成' : ''
    lines.push(
      `${'  '.repeat(depth)}${prefix}${n.title}${n.branch ? `〔${n.branch}〕` : ''}${
        done ? `（${done}）` : ''
      }${n.pinned ? ' ★重点' : ''}`,
    )
    if (depth >= maxDepth) {
      if (kids.length) lines.push(`${'  '.repeat(depth + 1)}… 还有 ${kids.length} 个子任务`)
      return
    }
    kids.forEach((k, i) => walk(k.id, depth + 1, `${i + 1}.`))
  }

  rootsOf(nodes).forEach((r, i) => walk(r.id, 0, `${i + 1}.`))
  return lines.join('\n')
}

/**
 * 某个节点在图里的位置：父级任务 / 上一步 / 下一步 / 子任务
 *
 * 「上一步 / 下一步」只认**同一条链**上的邻居。
 * 同一个父节点下的其它分支（并行1、并行2、副线）在图上是从父卡各自分出来的，
 * 它们不是这句话的「下一步」——按 parentId 一把捞会把它们也算进来，读起来就自相矛盾。
 */
export function actionNodeContext(
  nodes: ActionNode[],
  nodeId: string,
): {
  node?: ActionNode
  parent?: ActionNode
  prev: ActionNode[]
  next: ActionNode[]
  /** 同一父级、不同 branch：并行的同级路线（跟本节点不是串行关系） */
  parallel: ActionNode[]
  children: ActionNode[]
} {
  const empty = { prev: [], next: [], parallel: [], children: [] as ActionNode[] }
  const node = nodes.find((n) => n.id === nodeId)
  if (!node) return empty
  const siblings = nodes.filter((n) => n.parentId === node.parentId)
  const chain = siblings.filter((n) => (n.branch || '') === (node.branch || ''))
  const parallel = siblings.filter((n) => (n.branch || '') !== (node.branch || ''))
  const idx = chain.findIndex((n) => n.id === node.id)
  return {
    node,
    parent: node.parentId ? nodes.find((n) => n.id === node.parentId) : undefined,
    prev: idx > 0 ? chain.slice(Math.max(0, idx - 2), idx).reverse() : [],
    next: idx >= 0 ? chain.slice(idx + 1, idx + 3) : [],
    parallel,
    children: childrenOf(nodes, node.id),
  }
}

/* ---------- 导出 Markdown ---------- */

export function planToMarkdown(nodes: ActionNode[], title: string): string {
  if (!nodes.length) return ''
  const lines: string[] = [`# 行动路线 · ${title}`, '']

  const walk = (node: ActionNode, depth: number) => {
    const pad = '  '.repeat(depth - 1)
    const mark = node.done ? 'x' : ' '
    const tag = node.branch ? `〔${node.branch}〕` : ''
    lines.push(`${pad}- [${mark}] ${tag}${node.title}`)
    if (node.purpose) lines.push(`${pad}  - 目的：${node.purpose}`)
    if (node.detail) lines.push(`${pad}  - 怎么做：${node.detail}`)
    if (node.parallel) lines.push(`${pad}  - （可与同级并行）`)
    if (node.deps.length) {
      const depTitles = node.deps
        .map((d) => nodes.find((n) => n.id === d)?.title ?? d)
        .filter(Boolean)
      if (depTitles.length) lines.push(`${pad}  - 前置：${depTitles.join('、')}`)
    }
    for (const child of childrenOf(nodes, node.id)) walk(child, depth + 1)
  }

  rootsOf(nodes).forEach((r) => {
    lines.push(`## ${r.title}`)
    if (r.purpose) lines.push(`> 目标：${r.purpose}`)
    if (r.detail) lines.push(r.detail)
    lines.push('')
    walk(r, 1)
    lines.push('')
  })

  return lines.join('\n')
}
