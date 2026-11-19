/**
 * 파일 트리에서 펼쳐 둔 폴더 — 문서 폴더(layoutId)마다 `localStorage` 에 남겨 새로 열어도 유지한다 (DESIGN §24.7 X7).
 * 펼친 쪽을 적는다: 처음 보는 폴더(새로 생긴 것)는 접힌 채로 나온다 — 한 번 연 뒤 트리에 새 폴더가 생겼을 때와 같다.
 * 저장분이 없으면(처음 연 문서 폴더) 전부 펼친다.
 */

function key(layoutId: string) {
  return `jaydocs.tree.expanded:${layoutId}`
}

/** 저장분 → 경로 목록. 없거나 깨졌으면 null (전부 펼치라는 뜻) */
export function parseExpanded(raw: string | null): string[] | null {
  if (raw === null) return null
  try {
    const v: unknown = JSON.parse(raw)
    if (!Array.isArray(v)) return null
    return v.filter((x): x is string => typeof x === 'string')
  } catch {
    return null
  }
}

/** 지금 트리에 있는 폴더만 남긴다 — 없어진 폴더의 기록을 정리한다 */
export function pruneExpanded(expanded: Iterable<string>, dirs: Iterable<string>): string[] {
  const known = new Set(dirs)
  return [...new Set(expanded)].filter((p) => known.has(p)).sort()
}

export function loadExpanded(layoutId: string): string[] | null {
  try { return parseExpanded(localStorage.getItem(key(layoutId))) } catch { return null }
}

export function saveExpanded(layoutId: string, expanded: string[]) {
  try { localStorage.setItem(key(layoutId), JSON.stringify(expanded)) } catch { /* 저장 못 해도 동작엔 지장 없음 */ }
}

/** 경로의 상위 폴더들 (바깥부터). `a/b/c.md` → `a`, `a/b` */
export function ancestorDirs(path: string): string[] {
  const parts = path.split('/')
  const out: string[] = []
  for (let i = 1; i < parts.length; i++) out.push(parts.slice(0, i).join('/'))
  return out
}
