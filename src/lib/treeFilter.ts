import type { TreeEntry } from './backend'

/**
 * 트리 필터 (ADOPT B3 · DESIGN §48). 트리 위 칸에 친 글자로 항목을 거른다 — 폴더 구조는 그대로 두고 맞는 것만.
 *
 * - 이름에 글자가 들어 있으면 맞는다 (대소문자 · 한글 정규화(NFC/NFD) 무시). 글자에 `/` 가 있으면 경로 전체에서 찾는다.
 * - 파일: 맞으면 남는다. 폴더: 이름이 맞으면 폴더째(안의 항목은 거르지 않고) 남고, 아니면 맞는 항목이 안에 있을 때만 남는다.
 * - 맞는 항목 때문에 남은 폴더는 `open` 에 넣는다 — 트리는 펼쳐 보인다 (사용자가 펼쳐 둔 상태는 건드리지 않는다).
 * - `dirty` 를 주면 "저장 안 한 것만" — 저장 안 한 파일과 그 상위 폴더만 남는다 (글자와 같이 쓰면 둘 다 맞아야).
 */
export interface TreeFilter {
  query: string
  /** 저장 안 한 파일의 경로 — 주면 그것만 */
  dirty?: ReadonlySet<string> | null
}

export interface FilteredTree {
  entries: TreeEntry[]
  /** 맞는 항목을 보이려고 펼칠 폴더 */
  open: Set<string>
  /** 맞은 항목 (파일 · 이름이 맞은 폴더) — 트리 순서 */
  hits: string[]
}

export const fold = (s: string) => s.normalize('NFC').toLowerCase()

export function filterActive(f: TreeFilter): boolean {
  return f.query.trim() !== '' || !!f.dirty
}

export function filterTree(entries: TreeEntry[], f: TreeFilter): FilteredTree {
  const q = fold(f.query.trim())
  const byPath = q.includes('/')
  const nameHit = (e: TreeEntry) => q === '' || fold(byPath ? e.path : e.name).includes(q)
  const open = new Set<string>()
  const hits: string[] = []
  const dirty = f.dirty ?? null

  /** inside: 이름이 맞은 폴더 안 — 글자로는 거르지 않는다 */
  const walk = (list: TreeEntry[], inside: boolean): TreeEntry[] => {
    const out: TreeEntry[] = []
    for (const e of list) {
      if (e.type === 'file') {
        const ok = (inside || nameHit(e)) && (!dirty || dirty.has(e.path))
        if (ok) { out.push(e); if (!inside) hits.push(e.path) }
        continue
      }
      // 이름이 맞은 폴더 안은 그대로 (빈 폴더도)
      if (inside && !dirty) { out.push(e); continue }
      // 글자 없이 "저장 안 한 것만" 이면 폴더 이름은 맞은 것으로 치지 않는다 (안의 파일로만 남는다)
      const self = !inside && q !== '' && nameHit(e)
      if (self) hits.push(e.path)
      const at = hits.length
      const kids = walk(e.children ?? [], inside || self)
      const hasKids = kids.length > 0
      if (self && !dirty) { out.push({ ...e, children: kids }); continue }
      if (!hasKids) { if (self) hits.splice(at - 1, 1); continue }
      out.push({ ...e, children: kids })
      // 맞은 것이 안에 있어 남은 폴더 · 저장 안 한 파일이 든 폴더는 펼친다. 이름이 맞은 폴더는 사용자가 편 대로
      if (!self || dirty) open.add(e.path)
    }
    return out
  }

  if (!filterActive(f)) return { entries, open, hits }
  return { entries: walk(entries, false), open, hits }
}
