import { useSyncExternalStore } from 'react'

/**
 * 임시 탭 (ADOPT D2 · DESIGN §58) — 파일 트리에서 누르거나 `Enter` 로 연 문서는 임시 탭(이름 이탤릭)에 열리고,
 * 다음 문서를 그렇게 열면 그 탭이 바뀐다. 흩어진 문서를 훑는 동안 탭이 쌓이지 않는다.
 * 편집하면 · 탭(또는 트리의 그 파일)을 두 번 누르면 · 팔레트 "탭 유지" 로 고정된다.
 * 파일 검색(`Ctrl+P`) · 링크 · 뒤로 · 앞으로로 연 문서는 찾아서 연 것이라 고정 탭이다.
 * 기본 켜짐, 앱 전체에 하나, 이 브라우저에 남긴다. 임시 상태는 탭 설정(`config.transient`)에 있어 레이아웃과 함께 남는다.
 */
const KEY = 'jaydocs.transientTabs'
let on: boolean | null = null
const listeners = new Set<() => void>()

export function transientTabsOn(): boolean {
  if (on === null) { try { on = localStorage.getItem(KEY) !== '0' } catch { on = true } }
  return on
}

export function toggleTransientTabs(): boolean {
  on = !transientTabsOn()
  try { localStorage.setItem(KEY, on ? '1' : '0') } catch { /* 저장 못 해도 이 창에서는 된다 */ }
  for (const l of listeners) l()
  return on
}

export function onTransientTabs(l: () => void): () => void {
  listeners.add(l)
  return () => { listeners.delete(l) }
}

export function useTransientTabs(): boolean {
  return useSyncExternalStore(onTransientTabs, transientTabsOn)
}

/** 탭 묶음 안의 탭 하나 (계산용) */
export interface TabInfo {
  id: string
  path: string | null
  transient: boolean
  dirty: boolean
}

/**
 * 임시로 열 때 어디에: 같은 탭 묶음에 저장 안 한 것이 없는 임시 탭이 있으면 그 탭을 바꾼다(`replace` — 그 탭의 자리).
 * 없으면 끝에 새 임시 탭을 붙인다. 임시 탭이 고친 채로 남아 있으면(편집하면 고정되므로 드물다) 건드리지 않는다.
 */
export function transientSlot(tabs: readonly TabInfo[]): { replace: string; index: number } | null {
  const i = tabs.findIndex((t) => t.transient && !t.dirty)
  return i < 0 ? null : { replace: tabs[i].id, index: i }
}

/** 탭 설정에서 임시 표시를 뺀다 — 고정 */
export function pinnedConfig(cfg: Record<string, unknown> | undefined): Record<string, unknown> {
  const { transient: _drop, ...rest } = cfg ?? {}
  return rest
}
