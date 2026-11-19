import { useSyncExternalStore } from 'react'
import { fileTypeOf } from '../filetypes.mjs'

/**
 * 훑어보기 패널의 켬 · 끔과 너비 (PLAN-skim SK6). 앱 전체에 하나씩이고 localStorage 에 남긴다.
 * 문서 창마다 따로가 아니다 — 한 창에서 켜면 모든 md · txt 창에 켜진다(보이는 것은 문서 창이 하나일 때만).
 */
export const SKIM_WIDTH_MIN = 120
export const SKIM_WIDTH_MAX = 400
export const SKIM_WIDTH_DEFAULT = 180
/** 키보드(손잡이의 ← →)로 바꾸는 한 걸음 */
export const SKIM_WIDTH_STEP = 10
/** Shift 를 누른 걸음 · 팔레트의 넓히기 / 좁히기 */
export const SKIM_WIDTH_BIG_STEP = 40

const ON_KEY = 'jaydocs.skim.on'
const WIDTH_KEY = 'jaydocs.skim.width'

/** 패널이 붙는 문서인가 — `.md` · `.txt` 만 (`.json` 과 표에는 없다) */
export function isSkimPath(path: string): boolean {
  const t = fileTypeOf(path)
  return t?.kind === 'md' || (t?.kind === 'text' && !t.lang)
}

export function clampSkimWidth(w: number): number {
  if (!Number.isFinite(w)) return SKIM_WIDTH_DEFAULT
  return Math.min(SKIM_WIDTH_MAX, Math.max(SKIM_WIDTH_MIN, Math.round(w)))
}

export interface SkimPanelState {
  on: boolean
  width: number
  /** "새로 고침" 을 부른 횟수 — 패널이 이 값이 바뀌면 지금 글로 다시 그린다 (저장하지 않는다) */
  refresh: number
}

function load(): SkimPanelState {
  let on = false
  let width = SKIM_WIDTH_DEFAULT
  try {
    on = localStorage.getItem(ON_KEY) === '1'
    const w = localStorage.getItem(WIDTH_KEY)
    if (w !== null) width = clampSkimWidth(Number(w))
  } catch { /* 저장소를 못 쓰면 기본값 */ }
  return { on, width, refresh: 0 }
}

let state: SkimPanelState = load()
const listeners = new Set<() => void>()

function set(next: SkimPanelState) {
  if (next.on === state.on && next.width === state.width && next.refresh === state.refresh) return
  state = next
  try {
    localStorage.setItem(ON_KEY, next.on ? '1' : '0')
    localStorage.setItem(WIDTH_KEY, String(next.width))
  } catch { /* 저장 못 해도 동작엔 지장 없음 */ }
  for (const l of listeners) l()
}

export function skimPanelState(): SkimPanelState {
  return state
}

export function setSkimPanelOn(on: boolean) {
  set({ ...state, on })
}

export function toggleSkimPanel() {
  set({ ...state, on: !state.on })
}

export function setSkimPanelWidth(width: number) {
  set({ ...state, width: clampSkimWidth(width) })
}

/** 지금 너비에서 `delta` px 만큼 (범위 안에서) */
export function nudgeSkimPanelWidth(delta: number) {
  setSkimPanelWidth(state.width + delta)
}

/** 켜져 있는 패널을 지금 글로 다시 그린다 — 큰 문서는 자동으로 다시 그리지 않는다 (`SkimPanel` 의 SKIM_PAUSE_MS) */
export function refreshSkimPanels() {
  set({ ...state, refresh: state.refresh + 1 })
}

export function useSkimPanelState(): SkimPanelState {
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => { listeners.delete(l) } },
    () => state,
  )
}
