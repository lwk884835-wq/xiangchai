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

/** 还没起名的路线：名字跟着第一个目标卡走；没有目标就叫「新路线」 */
const autoTitleOf = (b: ActionBoard) => {
  const firstRoot = b.nodes.find((n) => !n.parentId)
  return firstRoot?.title.trim() || '新路线'
}

export type ClipboardMode = 'subtree' | 'chain'
export interface RouteClipboard {
  mode: ClipboardMode
  /** 复制时的快照（深拷贝，和源路线解耦） */
  nodes: ActionNode[]
  sourceBoardId: string
}

interface ActionState {
  boards: ActionBoard[]
  activeBoardId: string | null
  /** 用户自己加的临时事项，全局（不属于任何一条路线） */
  focusItems: FocusItem[]
  /** 折叠状态，按路线分：{ [boardId]: string[] } */
  collapsed: Record<string, string[]>
  /** 路线文件夹（右栏用来归纳路线；顺序即显示顺序） */
  folders: string[]
  /** 正文里插入的图片：id → dataURL（正文用 [[img:id]] 引用，避免把 base64 塞进每段文字） */
  images: Record<string, string>
  addImage: (id: string, dataUrl: string) => void
  /** 清掉没有任何正文再引用的图片 */
  pruneImages: () => number

  addFolder: (name: string) => string
  renameFolder: (oldName: string, newName: string) => void
  removeFolder: (name: string) => void
  setBoardFolder: (boardId: string, folder: string) => void
  /** 右键一键清除某张卡下所有已完成的子任务（连同它们的子树），可撤回 */
  clearDoneChildren: (id: string, boardId?: string) => number
  /**
   * 标记「这个任务似乎不太合适」：当前卡片标红，尚未完成的子任务和后续串行步骤标灰，
   * 但不删除、可撤回/可取消标记。返回被标记的节点数。
   */
  markUnsuitable: (id: string, boardId?: string) => number
  unmarkUnsuitable: (id: string, boardId?: string) => number
  /**
   * 把另一条路线作为「链接分支」插到当前路线第一个目标下面。
   * 链接卡片的子任务实时来自原路线，改动都写回原路线。
   */
  linkBoardInto: (boardIdToLink: string, targetBoardId?: string) => string
  /**
   * 把一张卡连同它的子任务、同一串后面接的步骤一起「独立成一条新路线」，
   * 并从当前路线移走。独立出来的路线可以再被链接插进别的每日路线。
   */
  extractChainToRoute: (id: string, boardId?: string) => { boardId: string; title: string; count: number } | null

  addBoard: (b: { jobTitle: string; jobCity?: string; label?: string; folder?: string }) => string
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
  /** 复制来的卡片（不落盘，刷新清空） */
  clipboard: RouteClipboard | null
  /**
   * 复制卡片：mode='subtree' 它和所有子任务；mode='chain' 再加上同一串里后面所有步骤。
   * 返回复制了多少张卡。
   */
  copyNodes: (id: string, mode: ClipboardMode, boardId?: string) => number
  /**
   * 粘贴：parentId 指定 = 变成该卡片的并行子任务线；不指定/为 null = 作为当前路线的新目标。
   * 返回新建了多少张卡。
   */
  pasteNodes: (opts?: { boardId?: string; parentId?: string | null }) => number
  /** 撤销栈：勾选 / 删除 / 拖拽前各存一份整路线快照，删错了能整体退回去 */
  history: { label: string; boards: ActionBoard[]; activeBoardId: string | null }[]
  /** 重做栈：撤销之后还能「回到下一步」 */
  redoHistory: { label: string; boards: ActionBoard[]; activeBoardId: string | null }[]
  /** 复制到的路线链接（粘贴到任意卡片/空白处用） */
  linkClipboard: { boardId: string; title: string } | null
  copyRouteLink: (boardId: string) => boolean
  pasteRouteLink: (opts?: { boardId?: string; parentId?: string | null }) => string
  /** 撤回上一步，返回那一步的名字（勾选/删除/拖拽…）；没有可撤回的返回 null */
  undo: () => string | null
  /** 回到下一步（重做），返回那一步的名字 */
  redo: () => string | null
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
   * 放到目标卡片上 → 成为目标的并行子任务线。
   */
  moveSubtree: (id: string, targetId: string, boardId?: string) => void
  /**
   * 抽屉里调整子任务顺序：只搬这一张卡（连同它的子树），不带走后面的兄弟。
   * position = before/after 目标；目标在别的分线上时直接并入那条分线。
   */
  reorderChild: (
    id: string,
    targetId: string,
    position: 'before' | 'after',
    boardId?: string,
  ) => void
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
          redoHistory: [],
        }))

      return {
        boards: [],
        activeBoardId: null,
        focusItems: [],
        collapsed: {},
        folders: [],
        images: {},
        history: [],
        redoHistory: [],
        clipboard: null,
        linkClipboard: null,

        addImage: (id, dataUrl) =>
          set((s) => ({ images: { ...s.images, [id]: dataUrl } })),

        pruneImages: () => {
          const s0 = get()
          const used = new Set<string>()
          for (const b of s0.boards) {
            for (const n of b.nodes) {
              for (const field of [n.title, n.purpose, n.detail, n.notes]) {
                if (!field) continue
                for (const m of field.matchAll(/\[\[img:([A-Za-z0-9_-]+)\]\]/g)) used.add(m[1])
              }
            }
          }
          const images: Record<string, string> = {}
          let removed = 0
          for (const [id, url] of Object.entries(s0.images)) {
            if (used.has(id)) images[id] = url
            else removed++
          }
          if (removed) set({ images })
          return removed
        },

        extractChainToRoute: (id, boardId) => {
          const src = boardOf(boardId)
          const node = src?.nodes.find((n) => n.id === id)
          if (!src || !node) return null
          const moving = new Set<string>([node.id])
          const addSubtree = (rootId: string) => {
            for (const n of src.nodes) {
              if (n.parentId === rootId && !moving.has(n.id)) {
                moving.add(n.id)
                addSubtree(n.id)
              }
            }
          }
          addSubtree(node.id)
          const mates = src.nodes.filter(
            (n) => n.parentId === node.parentId && (n.branch || '') === (node.branch || ''),
          )
          const at = mates.findIndex((n) => n.id === node.id)
          const followers: ActionNode[] = []
          for (const f of at >= 0 ? mates.slice(at + 1) : []) {
            if (moving.has(f.id)) continue
            followers.push(f)
            moving.add(f.id)
            addSubtree(f.id)
          }
          const picked = src.nodes.filter((n) => moving.has(n.id))
          const followerIds = new Set(followers.map((f) => f.id))
          const rootShift = 1 - node.level
          // 每个「后续步骤的子树」整体挂在根下同一层，位移按各自根算
          const followerShift = new Map<string, number>()
          const markFollowerSubtree = (rootId: string, delta: number) => {
            followerShift.set(rootId, delta)
            for (const n of src.nodes) {
              if (n.parentId === rootId) markFollowerSubtree(n.id, delta)
            }
          }
          for (const f of followers) markFollowerSubtree(f.id, 1 - f.level)
          const newNodes: ActionNode[] = picked.map((n) => {
            const isFollower = followerIds.has(n.id)
            const delta = followerShift.get(n.id) ?? rootShift
            return {
              ...n,
              level: Math.max(1, n.level + delta),
              parentId:
                n.id === node.id
                  ? null
                  : isFollower
                    ? null
                    : n.parentId && moving.has(n.parentId)
                      ? n.parentId
                      : null,
              branch: isFollower || n.id === node.id ? '' : n.branch || '',
              deps: (n.deps ?? []).filter((d) => moving.has(d)),
              pinned: false,
            }
          })
          pushHistory('独立成路线')
          const newBoard: ActionBoard = {
            id: `bd-${uid()}`,
            jobTitle: node.title,
            jobCity: '',
            label: '',
            folder: src.folder ?? '',
            titleAuto: false,
            createdAt: Date.now(),
            archived: false,
            nodes: newNodes,
          }
          // 原位置只留一个「链接锚点」：它自己不渲染，被链接路线的根卡会直接显示在原位
          // （看起来就是普通粘贴过来的卡片，蓝色描边表示是链接的；改动写回新路线）
          const atIndex = src.nodes.findIndex((n) => n.id === node.id)
          const beforeCount = src.nodes
            .slice(0, Math.max(0, atIndex))
            .filter((n) => !moving.has(n.id)).length
          const linkNode: ActionNode = {
            id: `an-${uid()}`,
            title: node.title,
            purpose: '',
            detail: '',
            notes: '',
            level: node.level,
            parentId: node.parentId,
            branch: node.branch || '',
            deps: (node.deps ?? []).filter((d) => !moving.has(d)),
            parallel: node.parallel,
            done: false,
            pinned: false,
            linkBoardId: newBoard.id,
            createdAt: Date.now(),
          }
          set((st) => ({
            boards: [
              newBoard,
              ...st.boards.map((b) => {
                if (b.id !== src.id) return b
                const nodes = b.nodes.filter((n) => !moving.has(n.id))
                nodes.splice(beforeCount, 0, linkNode)
                return { ...b, nodes }
              }),
            ],
          }))
          return { boardId: newBoard.id, title: newBoard.jobTitle, count: newNodes.length }
        },

        copyRouteLink: (boardIdToLink) => {
          const linked = get().boards.find((b) => b.id === boardIdToLink)
          if (!linked) return false
          set({ linkClipboard: { boardId: linked.id, title: linked.jobTitle } })
          return true
        },

        pasteRouteLink: (opts) => {
          const s0 = get()
          const clip = s0.linkClipboard
          if (!clip) return ''
          const linked = s0.boards.find((b) => b.id === clip.boardId)
          const target =
            s0.boards.find((b) => b.id === (opts?.boardId ?? s0.activeBoardId)) ?? null
          if (!linked || !target) return ''
          const parent = opts?.parentId
            ? (target.nodes.find((n) => n.id === opts.parentId) ?? null)
            : null
          const siblings = target.nodes.filter((n) => n.parentId === (parent?.id ?? null))
          const used = new Set(siblings.map((n) => n.branch || ''))
          let bi = 1
          while (used.has(`并行${bi}`)) bi++
          const node: ActionNode = {
            id: `an-${uid()}`,
            title: linked.jobTitle,
            purpose: '',
            detail: '',
            notes: '',
            level: parent ? parent.level + 1 : 1,
            parentId: parent?.id ?? null,
            branch: parent ? `并行${bi}` : '',
            deps: [],
            parallel: !!parent,
            done: false,
            pinned: false,
            linkBoardId: linked.id,
            createdAt: Date.now(),
          }
          pushHistory('粘贴链接路线')
          /* 空白处粘贴 = 作为新的根目标；贴到卡片上 = 变成它的并行子任务 */
          patchBoard(target.id, (b) => ({ ...b, nodes: [...b.nodes, node] }))
          return node.id
        },

        linkBoardInto: (boardIdToLink, targetBoardId) => {
          const s0 = get()
          const linked = s0.boards.find((b) => b.id === boardIdToLink)
          const target =
            s0.boards.find((b) => b.id === (targetBoardId ?? s0.activeBoardId)) ?? null
          if (!linked || !target) return ''
          if (linked.id === target.id) return ''
          if (target.nodes.some((n) => n.linkBoardId === linked.id)) return ''
          const root = target.nodes.find((n) => !n.parentId)
          if (!root) return ''
          const used = new Set(
            target.nodes.filter((n) => n.parentId === root.id).map((n) => n.branch || ''),
          )
          let bi = 1
          while (used.has(`并行${bi}`)) bi++
          const node: ActionNode = {
            id: `an-${uid()}`,
            title: linked.jobTitle,
            purpose: '',
            detail: '',
            notes: '',
            level: root.level + 1,
            parentId: root.id,
            branch: `并行${bi}`,
            deps: [],
            parallel: true,
            done: false,
            pinned: false,
            linkBoardId: linked.id,
            createdAt: Date.now(),
          }
          patchBoard(target.id, (b) => ({ ...b, nodes: [...b.nodes, node] }))
          return node.id
        },

        addFolder: (name) => {
          const clean = name.trim()
          if (!clean) return ''
          set((s) => ({ folders: s.folders.includes(clean) ? s.folders : [...s.folders, clean] }))
          return clean
        },

        renameFolder: (oldName, newName) => {
          const clean = newName.trim()
          if (!clean || clean === oldName) return
          set((s) => ({
            // 改名后如果和已有文件夹撞名，就合并成一个，顺序跟着旧名字的位置
            folders: s.folders
              .map((f) => (f === oldName ? clean : f))
              .filter((f, i, arr) => arr.indexOf(f) === i),
            boards: s.boards.map((b) => (b.folder === oldName ? { ...b, folder: clean } : b)),
          }))
        },

        removeFolder: (name) =>
          set((s) => ({
            folders: s.folders.filter((f) => f !== name),
            boards: s.boards.map((b) => (b.folder === name ? { ...b, folder: '' } : b)),
          })),

        setBoardFolder: (boardId, folder) =>
          set((s) => ({
            boards: s.boards.map((b) => (b.id === boardId ? { ...b, folder: folder || '' } : b)),
            folders:
              folder && !s.folders.includes(folder) ? [...s.folders, folder] : s.folders,
          })),

        clearDoneChildren: (id, boardId) => {
          const board = boardOf(boardId)
          if (!board) return 0
          const value = (n: ActionNode) => n

          /*
            清「完全做完」的并行线，而不是「只要有一个完成就整串删」。
            一条并行线（同一父级、同一 branch 的一串）只有它自己和下面所有子线
            全部做完才整串清掉；只要有一个没做完，整条（含已完成的孩子）原样保留。
          */
          const kidsOf = (pid: string) => board.nodes.filter((n) => n.parentId === pid)
          const groupsOf = (pid: string) => {
            const map = new Map<string, ActionNode[]>()
            for (const k of kidsOf(pid)) {
              const key = k.branch || ''
              map.set(key, [...(map.get(key) ?? []), value(k)])
            }
            return [...map.values()]
          }
          const groupDone = (group: ActionNode[]): boolean =>
            group.every((n) => n.done && groupsOf(n.id).every(groupDone))

          const drop = new Set<string>()
          const addSubtree = (rootId: string) => {
            if (drop.has(rootId)) return
            drop.add(rootId)
            for (const n of board.nodes) if (n.parentId === rootId) addSubtree(n.id)
          }
          const prune = (pid: string) => {
            for (const group of groupsOf(pid)) {
              // 只有整条线（含所有子线）都做完才清；没做完的整条保留，
              // 不往下钻、也不单独清它下面已完成的子任务
              if (groupDone(group)) {
                for (const n of group) addSubtree(n.id)
              }
            }
          }
          prune(id)
          if (!drop.size) return 0
          pushHistory('清除已完成子任务')
          patchBoard(board.id, (b) => ({
            ...b,
            nodes: b.nodes.filter((n) => !drop.has(n.id)),
          }))
          return drop.size
        },

        markUnsuitable: (id, boardId) => {
          const board = boardOf(boardId)
          const node = board?.nodes.find((n) => n.id === id)
          if (!board || !node) return 0
          const marked = new Set<string>([node.id])
          // 尚未完成的子任务：带上；已经勾完的保持绿色不动
          const addUnfinishedKids = (pid: string) => {
            for (const n of board.nodes) {
              if (n.parentId !== pid || marked.has(n.id)) continue
              if (n.done) continue
              marked.add(n.id)
              addUnfinishedKids(n.id)
            }
          }
          addUnfinishedKids(node.id)
          // 同一串里排在它后面的步骤（连同未完成的子任务）
          const mates = board.nodes.filter(
            (n) => n.parentId === node.parentId && (n.branch || '') === (node.branch || ''),
          )
          const at = mates.findIndex((n) => n.id === node.id)
          for (const f of at >= 0 ? mates.slice(at + 1) : []) {
            if (marked.has(f.id)) continue
            marked.add(f.id)
            addUnfinishedKids(f.id)
          }
          pushHistory('标记不合适')
          patchBoard(board.id, (b) => ({
            ...b,
            nodes: b.nodes.map((n) =>
              marked.has(n.id)
                ? { ...n, dropped: true, dropRoot: n.id === node.id }
                : n,
            ),
          }))
          return marked.size
        },

        unmarkUnsuitable: (id, boardId) => {
          const board = boardOf(boardId)
          const node = board?.nodes.find((n) => n.id === id)
          if (!board || !node) return 0
          const clear = new Set<string>([node.id])
          const addAllKids = (pid: string) => {
            for (const n of board.nodes) {
              if (n.parentId !== pid || clear.has(n.id)) continue
              clear.add(n.id)
              addAllKids(n.id)
            }
          }
          addAllKids(node.id)
          const mates = board.nodes.filter(
            (n) => n.parentId === node.parentId && (n.branch || '') === (node.branch || ''),
          )
          const at = mates.findIndex((n) => n.id === node.id)
          for (const f of at >= 0 ? mates.slice(at + 1) : []) {
            if (clear.has(f.id)) continue
            clear.add(f.id)
            addAllKids(f.id)
          }
          // 只清这部分；其它地方的标记不动
          let n = 0
          const patch: Record<string, boolean> = {}
          for (const x of clear) {
            const cur = board.nodes.find((k) => k.id === x)
            if (cur?.dropped || cur?.dropRoot) {
              n++
              patch[x] = true
            }
          }
          if (!n) return 0
          pushHistory('取消不合适标记')
          patchBoard(board.id, (b) => ({
            ...b,
            nodes: b.nodes.map((k) =>
              patch[k.id] ? { ...k, dropped: false, dropRoot: false } : k,
            ),
          }))
          return n
        },

        addBoard: (b) => {
          const id = `bd-${uid()}`
          const auto = !String(b.jobTitle ?? '').trim()
          const board: ActionBoard = {
            id,
            jobTitle: auto ? '新路线' : String(b.jobTitle).trim(),
            titleAuto: auto,
            jobCity: b.jobCity ?? '',
            label: b.label ?? '',
            folder: b.folder ?? '',
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
            boards: s.boards.map((b) =>
              b.id === id
                ? { ...b, ...patch, ...(patch.jobTitle != null ? { titleAuto: false } : {}) }
                : b,
            ),
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
            // 其他批注：纯记录，不参与依赖/勾选逻辑
            notes: input.notes ?? '',
            level: input.level,
            parentId: input.parentId ?? null,
            branch,
            deps: input.deps ?? [],
            parallel: input.parallel ?? false,
            done: input.done ?? false,
            pinned: input.pinned ?? false,
            ...(input.linkBoardId ? { linkBoardId: input.linkBoardId } : {}),
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
          if (target.titleAuto && node.parentId == null) {
            patchBoard(target.id, (b) =>
              b.titleAuto ? { ...b, jobTitle: autoTitleOf(b) } : b,
            )
          }
          return id
        },

        updateNode: (id, patch, boardId) => {
          patchBoard(boardId, (b) => ({
            ...b,
            nodes: b.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)),
          }))
          const board = boardOf(boardId)
          const changed = board?.nodes.find((n) => n.id === id)
          if (board?.titleAuto && patch.title != null && changed?.parentId == null) {
            patchBoard(board.id, (b) =>
              b.titleAuto ? { ...b, jobTitle: autoTitleOf(b) } : b,
            )
          }
        },

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
            redoHistory: [
              {
                label: last.label,
                boards: cloneBoards(s.boards),
                activeBoardId: s.activeBoardId,
              },
              ...s.redoHistory,
            ].slice(0, 30),
            boards: last.boards,
            activeBoardId: last.activeBoardId ?? s.activeBoardId,
          }))
          return last.label
        },

        redo: () => {
          const next = get().redoHistory[0]
          if (!next) return null
          set((s) => ({
            redoHistory: s.redoHistory.slice(1),
            history: [
              {
                label: next.label,
                boards: cloneBoards(s.boards),
                activeBoardId: s.activeBoardId,
              },
              ...s.history,
            ].slice(0, 30),
            boards: next.boards,
            activeBoardId: next.activeBoardId ?? s.activeBoardId,
          }))
          return next.label
        },

        pinNode: (id, pinned, boardId) => {
          const board = boardOf(boardId)
          if (!board) return
          /*
            钉一个任务 = 把它和**三层以内的子任务**一起钉到重点清单。
            以前只钉自己，父任务钉上去之后子任务在清单里看不到；
            反过来取消时也按同一范围一起摘，不留半截。
          */
          const hit = new Set<string>([id])
          let frontier: string[] = [id]
          for (let depth = 0; depth < 3; depth++) {
            const next: string[] = []
            for (const pid of frontier) {
              for (const n of board.nodes) {
                if (n.parentId === pid && !hit.has(n.id)) {
                  hit.add(n.id)
                  next.push(n.id)
                }
              }
            }
            frontier = next
            if (!frontier.length) break
          }
          patchBoard(board.id, (b) => ({
            ...b,
            nodes: b.nodes.map((n) => (hit.has(n.id) ? { ...n, pinned } : n)),
          }))
        },

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
            const nodes = b.nodes.filter((n) => !drop.has(n.id))
            return {
              ...b,
              nodes,
              ...(b.titleAuto ? { jobTitle: autoTitleOf({ ...b, nodes }) } : {}),
            }
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

        copyNodes: (id, mode, boardId) => {
          const board = boardOf(boardId)
          if (!board) return 0
          const nodes = board.nodes
          const node = nodes.find((n) => n.id === id)
          if (!node) return 0

          const picked = new Set<string>([id])
          const collect = (rootId: string) => {
            for (const n of nodes) {
              if (n.parentId === rootId && !picked.has(n.id)) {
                picked.add(n.id)
                collect(n.id)
              }
            }
          }
          collect(id)

          // chain：同一串（同父级 + 同 branch）里排在它后面的步骤，连同各自子树
          if (mode === 'chain') {
            const mates = nodes.filter(
              (n) => n.parentId === node.parentId && (n.branch || '') === (node.branch || ''),
            )
            const at = mates.findIndex((n) => n.id === id)
            for (const f of at >= 0 ? mates.slice(at + 1) : []) {
              // collect 只收「子节点」，串里后面的兄弟要自己先加进去
              if (!picked.has(f.id)) {
                picked.add(f.id)
                collect(f.id)
              }
            }
          }

          const snapshot = nodes
            .filter((n) => picked.has(n.id))
            .map((n) => JSON.parse(JSON.stringify(n)) as ActionNode)
          set({ clipboard: { mode, nodes: snapshot, sourceBoardId: board.id } })
          return snapshot.length
        },

        pasteNodes: (opts) => {
          const s0 = get()
          const clip = s0.clipboard
          if (!clip || !clip.nodes.length) return 0
          const targetBoard =
            s0.boards.find((b) => b.id === (opts?.boardId ?? s0.activeBoardId)) ?? null
          if (!targetBoard) return 0
          const targetNode = opts?.parentId
            ? (targetBoard.nodes.find((n) => n.id === opts.parentId) ?? null)
            : null
          if (opts?.parentId && !targetNode) return 0

          pushHistory('粘贴')

          const idMap = new Map<string, string>()
          for (const n of clip.nodes) idMap.set(n.id, `an-${uid()}`)
          // 快照里没有父节点（或父节点不在快照里）的，就是这次粘贴的顶层
          const topIds = new Set(
            clip.nodes.filter((n) => !n.parentId || !idMap.has(n.parentId)).map((n) => n.id),
          )
          const firstTop = clip.nodes.find((n) => topIds.has(n.id))
          const headLevel = firstTop?.level ?? 1
          const delta = targetNode ? targetNode.level + 1 - headLevel : 1 - headLevel

          // 贴到卡片上：整串变成目标的一条新的并行子线
          let destBranch = ''
          if (targetNode) {
            const used = new Set(
              targetBoard.nodes.filter((n) => n.parentId === targetNode.id).map((n) => n.branch || ''),
            )
            let bi = 1
            while (used.has(`并行${bi}`)) bi++
            destBranch = `并行${bi}`
          }

          const created: ActionNode[] = clip.nodes.map((n) => {
            const isTop = topIds.has(n.id)
            const deps = (n.deps ?? [])
              .map((d) => idMap.get(d))
              .filter((d): d is string => !!d)
            return {
              ...n,
              id: idMap.get(n.id)!,
              parentId: isTop
                ? targetNode
                  ? targetNode.id
                  : null
                : (idMap.get(n.parentId as string) ?? null),
              level: Math.max(1, n.level + delta),
              branch: isTop ? (targetNode ? destBranch : '') : n.branch || '',
              deps,
              pinned: false,
              createdAt: Date.now(),
            }
          })

          patchBoard(targetBoard.id, (b) => ({ ...b, nodes: [...b.nodes, ...created] }))
          return created.length
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

        reorderChild: (id, targetId, position, boardId) => {
          const board = boardOf(boardId)
          if (!board || id === targetId) return
          const nodes = board.nodes
          const node = nodes.find((n) => n.id === id)
          const target = nodes.find((n) => n.id === targetId)
          if (!node || !target) return
          // 只在同一个父级下列内调整（抽屉里的子任务列表）
          if (node.parentId !== target.parentId) return

          // 只搬这一张卡 + 它自己的子树，不带走同一串后面的兄弟
          const moving = new Set<string>([node.id])
          const collect = (rid: string) => {
            for (const n of nodes) {
              if (n.parentId === rid && !moving.has(n.id)) {
                moving.add(n.id)
                collect(n.id)
              }
            }
          }
          collect(node.id)

          pushHistory('调整顺序')
          const oldBranch = node.branch || ''
          const destBranch = target.branch || ''
          const movedNodes = nodes.filter((n) => moving.has(n.id))
          const head = movedNodes.find((n) => n.id === node.id)!
          const descendants = movedNodes.filter((n) => n.id !== node.id)
          const rest = nodes.filter((n) => !moving.has(n.id))

          // 去掉 node 后，按 target 的位置插回去（行序 = 串行顺序）
          const ti = rest.findIndex((n) => n.id === target.id)
          if (ti < 0) return
          const insertAt = position === 'before' ? ti : ti + 1
          const placed = [
            ...rest.slice(0, insertAt),
            { ...head, branch: destBranch, parallel: false, deps: [] as string[] },
            ...rest.slice(insertAt),
            ...descendants,
          ]

          // 两个受影响的分线按数组顺序重接串行前置（以前的 deps 就是按行序串的）
          const branches = new Set([oldBranch, destBranch])
          for (const br of branches) {
            const group = placed.filter(
              (n) => n.parentId === node.parentId && (n.branch || '') === br,
            )
            group.forEach((n, i) => {
              const deps = i > 0 ? [group[i - 1].id] : []
              if (JSON.stringify(n.deps) !== JSON.stringify(deps)) n.deps = deps
            })
          }

          patchBoard(boardId, (b) => ({ ...b, nodes: placed }))
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
            folder: String(b.folder ?? ''),
            titleAuto: b.titleAuto === true,
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
        const images: Record<string, string> =
          p.images && typeof p.images === 'object' && !Array.isArray(p.images)
            ? Object.fromEntries(
                Object.entries(p.images).filter(
                  ([k, v]) => typeof k === 'string' && typeof v === 'string' && v.startsWith('data:image/'),
                ),
              )
            : {}
        const folders = Array.isArray(p.folders)
          ? [...new Set(p.folders.filter((f): f is string => typeof f === 'string' && !!f.trim()))]
          : []
        return {
          ...current,
          ...p,
          boards,
          focusItems: Array.isArray(p.focusItems) ? p.focusItems : [],
          collapsed,
          folders,
          images,
          activeBoardId:
            boards.find((b) => b.id === p.activeBoardId)?.id ?? boards[0]?.id ?? null,
          // 撤销栈不落盘：恢复上一次的删除快照会跨刷新出错
          history: [],
          redoHistory: [],
          clipboard: null,
          linkClipboard: null,
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
