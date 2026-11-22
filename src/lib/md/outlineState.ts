import { useSyncExternalStore } from 'react'

/**
 * 목차 띠의 켬 · 끔 (DESIGN §29). 앱 전체에 하나고 localStorage 에 남긴다. 기본은 켜짐.
 * 켜져 있어도 보이는 것은 마크다운 창이 하이브리드 모드일 때뿐이다.
 */
const KEY = 'jaydocs.outline.on'

function load(): boolean {
  try { return localStorage.getItem(KEY) !== '0' } catch { return true }
}

let on = load()
const listeners = new Set<() => void>()

export function outlineOn(): boolean {
  return on
}

export function setOutlineOn(next: boolean) {
  if (next === on) return
  on = next
  try { localStorage.setItem(KEY, next ? '1' : '0') } catch { /* 저장 못 해도 동작엔 지장 없음 */ }
  for (const l of listeners) l()
}

export function useOutlineOn(): boolean {
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => { listeners.delete(l) } },
    () => on,
  )
}
