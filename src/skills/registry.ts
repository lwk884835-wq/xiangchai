/**
 * Skill 注册表
 *
 * 结构和 WorkBuddy / Claude 的 Agent Skills 对齐，三层披露：
 *   1) 目录：name + description 常驻 system prompt，让模型知道「有哪些技能」
 *   2) 正文：模型判断对得上时，用 load_skill 工具载入 SKILL.md 全文
 *   3) 附件：skill 目录下的其它文件（模板、案例）后续按需读取，现在还没做
 *
 * 加一个技能 = 在 src/skills/ 下新建一个文件夹，放 SKILL.md。
 * 不需要改任何代码：下面用 import.meta.glob 自动收集。
 */

export interface SkillMeta {
  /** 目录名，也是 load_skill 的参数 */
  id: string
  name: string
  title: string
  description: string
  when?: string
  version?: string
  /** SKILL.md 正文（去掉 frontmatter） */
  body: string
}

const rawFiles = import.meta.glob('./*/SKILL.md', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

function parseFrontmatter(raw: string): { data: Record<string, string>; body: string } {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  if (!match) return { data: {}, body: raw.trim() }
  const data: Record<string, string> = {}
  for (const line of match[1].split(/\r?\n/)) {
    const at = line.indexOf(':')
    if (at <= 0) continue
    const key = line.slice(0, at).trim()
    const value = line.slice(at + 1).trim()
    if (key) data[key] = value
  }
  return { data, body: match[2].trim() }
}

export const SKILLS: SkillMeta[] = Object.entries(rawFiles)
  .map(([path, raw]) => {
    const id = path.split('/')[1]
    const { data, body } = parseFrontmatter(raw)
    return {
      id,
      name: data.name ?? id,
      title: data.title ?? data.name ?? id,
      description: data.description ?? '',
      when: data.when,
      version: data.version,
      body,
    }
  })
  // 下划线开头的目录是模板/草稿，不参与加载
  .filter((s) => !s.id.startsWith('_') && s.description)
  .sort((a, b) => a.id.localeCompare(b.id))

export function getSkill(id: string): SkillMeta | undefined {
  return SKILLS.find((s) => s.id === id || s.name === id)
}

/** 给 system prompt 的一行索引 */
export function skillIndexLines(): string[] {
  return SKILLS.map((s) => `- \`${s.id}\`：${s.description}`)
}
