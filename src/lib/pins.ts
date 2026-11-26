import { useSyncExternalStore } from 'react'

/**
 * 고정 (ADOPT B4 · DESIGN §49) — 자주 쓰는 문서 · 폴더를 트리 맨 위 "고정" 구역과 `Ctrl+P` 빈 입력 맨 위에 올린다.
 *
 * - 문서 폴더(layoutId)마다 `localStorage` 에 경로 목록으로 둔다 — 화면 상태라 파일은 바뀌지 않는다 (원칙 7).
 * - 경로는 앱 경로 그대로다. 가져온 폴더는 `@별칭/…` 라 주 폴더의 같은 이름과 섞이지 않는다.
 * - 고정한 순서대로 (새로 고정한 것이 끝). 지금 트리에 없는 것은 보이는 쪽이 건너뛴다 — 여기서 지우지 않는다
 *   (가져온 폴더가 잠깐 빠졌다 돌아올 수 있다, `recents.ts` 와 같다). 앱에서 이름을 바꾸거나 지우면 따라간다.
 */

export const PINS_MAX = 50

function key(layoutId: string) {
  return `jaydocs.pins:${layoutId}`
}

/** 저장분 → 경로 목록. 깨졌거나 모양이 다르면 빈 목록 */
export function parsePins(raw: string | null): string[] {
  if (!raw) return []
  try {
    const v: unknown = JSON.parse(raw)
    if (!Array.isArray(v)) return []
    return [...new Set(v.filter((x): x is string => typeof x === 'string' && x !== ''))].slice(0, PINS_MAX)
  } catch {
    return []
  }
}

/** 고정 / 해제 — 없으면 끝에 넣고, 있으면 뺀다 */
export function togglePin(list: readonly string[], path: string): string[] {
  return list.includes(path) ? list.filter((p) => p !== path) : [...list, path].slice(-PINS_MAX)
}

/** 이름 바꾸기 · 옮기기 — 그 경로(폴더면 그 아래도)를 새 경로로. 자리는 그대로 */
export function renamePins(list: readonly string[], from: string, to: string): string[] {
  const out = list.map((p) => (p === from ? to : p.startsWith(from + '/') ? to + p.slice(from.length) : p))
  return [...new Set(out)]
}

/** 지우기 — 그 경로와 (폴더면) 그 아래를 뺀다 */
export function removePins(list: readonly string[], path: string): string[] {
  return list.filter((p) => p !== path && !p.startsWith(path + '/'))
}

// ---- 저장 · 구독 (트리와 팔레트가 같은 목록을 본다)
const cache = new Map<string, string[]>()
const listeners = new Set<() => void>()

export function pinsOf(layoutId: string): string[] {
  let v = cache.get(layoutId)
  if (!v) {
    try { v = parsePins(localStorage.getItem(key(layoutId))) } catch { v = [] }
    cache.set(layoutId, v)
  }
  return v
}

function save(layoutId: string, next: string[]) {
  const prev = pinsOf(layoutId)
  if (next.length === prev.length && next.every((p, i) => p === prev[i])) return
  cache.set(layoutId, next)
  try { localStorage.setItem(key(layoutId), JSON.stringify(next)) } catch { /* 저장 못 해도 이 창에서는 동작한다 */ }
  for (const l of listeners) l()
}

/** 고정했으면 true, 해제했으면 false */
export function togglePinned(layoutId: string, path: string): boolean {
  const next = togglePin(pinsOf(layoutId), path)
  save(layoutId, next)
  return next.includes(path)
}
export function movePinned(layoutId: string, from: string, to: string) {
  save(layoutId, renamePins(pinsOf(layoutId), from, to))
}
export function forgetPinned(layoutId: string, path: string) {
  save(layoutId, removePins(pinsOf(layoutId), path))
}

function subscribe(l: () => void) {
  listeners.add(l)
  return () => { listeners.delete(l) }
}

export function usePins(layoutId: string): string[] {
  return useSyncExternalStore(subscribe, () => pinsOf(layoutId))
}
