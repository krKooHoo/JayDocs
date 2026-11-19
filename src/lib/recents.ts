/**
 * 최근에 쓴 것 — 팔레트가 검색어 없이 열릴 때 위에 올린다 (DESIGN §24.7 X6).
 * 명령은 앱 전체에 하나, 파일은 문서 폴더(layoutId)마다 따로 `localStorage` 에 둔다.
 * 목록은 최근 것이 앞이고 개수를 넘으면 오래된 것부터 버린다. 지금 없는 것(없어진 파일 · 등록 안 된 명령)은
 * 읽는 쪽이 건너뛴다 — 여기서는 지우지 않는다(가져온 폴더가 잠깐 빠졌다 돌아올 수 있다).
 */

export const RECENT_COMMANDS_MAX = 20
export const RECENT_FILES_MAX = 30

const COMMANDS_KEY = 'jaydocs.recent.commands'
function filesKey(layoutId: string) {
  return `jaydocs.recent.files:${layoutId}`
}

/** id 를 맨 앞으로 (이미 있으면 옮긴다). max 를 넘는 뒤쪽은 버린다 */
export function pushRecent(list: readonly string[], id: string, max: number): string[] {
  return [id, ...list.filter((x) => x !== id)].slice(0, Math.max(0, max))
}

/** id → 순위 (0 이 가장 최근). 팔레트가 정렬에 쓴다 */
export function recentRanks(list: readonly string[]): Map<string, number> {
  const out = new Map<string, number>()
  list.forEach((id, i) => { if (!out.has(id)) out.set(id, i) })
  return out
}

/** 저장분을 읽는다. 깨졌거나 모양이 다르면 빈 목록 */
export function parseRecents(raw: string | null, max: number): string[] {
  if (!raw) return []
  try {
    const v: unknown = JSON.parse(raw)
    if (!Array.isArray(v)) return []
    return [...new Set(v.filter((x): x is string => typeof x === 'string' && x !== ''))].slice(0, max)
  } catch {
    return []
  }
}

function load(key: string, max: number): string[] {
  try { return parseRecents(localStorage.getItem(key), max) } catch { return [] }
}
function record(key: string, id: string, max: number) {
  try { localStorage.setItem(key, JSON.stringify(pushRecent(load(key, max), id, max))) } catch { /* 저장 못 해도 동작엔 지장 없음 */ }
}

export function recentCommands(): string[] {
  return load(COMMANDS_KEY, RECENT_COMMANDS_MAX)
}
export function recordRecentCommand(id: string) {
  record(COMMANDS_KEY, id, RECENT_COMMANDS_MAX)
}
export function recentFiles(layoutId: string): string[] {
  return load(filesKey(layoutId), RECENT_FILES_MAX)
}
export function recordRecentFile(layoutId: string, path: string) {
  record(filesKey(layoutId), path, RECENT_FILES_MAX)
}
