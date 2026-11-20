import { useSyncExternalStore } from 'react'

/**
 * 훑어보기 창(트리 `Space`)의 크기와 배율 (DESIGN §25.4 SK17). 앱 전체에 하나씩이고 이 브라우저의 localStorage 에만 남긴다.
 *
 * - 크기: 파일일 때의 너비 · 폴더일 때의 너비 · 높이(둘이 같이 쓴다). `null` 은 "정하지 않음" — 창이 알아서 잡는다.
 *   저장하는 값은 사용자가 원한 크기다. 화면이 작으면 그릴 때 줄이고, 화면이 다시 커지면 원한 크기로 돌아온다.
 * - 배율: 파일은 글자 크기(CSS zoom), 폴더 격자는 카드 크기. 따로 기억한다.
 */
export const LOOK_ZOOM_STEPS = [0.5, 0.67, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3] as const
export const LOOK_ZOOM_MIN = LOOK_ZOOM_STEPS[0]
export const LOOK_ZOOM_MAX = LOOK_ZOOM_STEPS[LOOK_ZOOM_STEPS.length - 1]
/** 키보드(`Shift+방향키`)로 크기를 바꾸는 한 걸음(px) */
export const LOOK_SIZE_STEP = 40
/** 창이 이보다 작아지지 않는다 */
export const LOOK_MIN_WIDTH = 280
export const LOOK_MIN_HEIGHT = 160
/** 저장하는 크기의 상한 — 깨진 값이 들어와도 화면을 벗어난 숫자가 남지 않게 */
const LOOK_SIZE_MAX = 8000

const KEY = 'jaydocs.quicklook'

export interface LookPrefs {
  /** 파일일 때의 너비(px) */
  fileWidth: number | null
  /** 폴더(격자)일 때의 너비(px) */
  folderWidth: number | null
  /** 높이(px) — 파일 · 폴더가 같이 쓴다 */
  height: number | null
  /** 파일의 배율 (1 = 100%) */
  zoom: number
  /** 폴더 격자의 카드 배율 */
  gridZoom: number
}

export const LOOK_DEFAULT: LookPrefs = { fileWidth: null, folderWidth: null, height: null, zoom: 1, gridZoom: 1 }

/** 배율을 범위 안으로. 숫자가 아니면 1 */
export function clampLookZoom(z: unknown): number {
  if (typeof z !== 'number' || !Number.isFinite(z)) return 1
  return Math.min(LOOK_ZOOM_MAX, Math.max(LOOK_ZOOM_MIN, Math.round(z * 100) / 100))
}

/** 한 단계 크게(1) · 작게(-1). 단계 사이의 값이면 그 방향의 가장 가까운 단계로. 끝에서는 그대로 */
export function stepLookZoom(z: number, dir: 1 | -1): number {
  const cur = clampLookZoom(z)
  if (dir > 0) return LOOK_ZOOM_STEPS.find((s) => s > cur + 0.001) ?? LOOK_ZOOM_MAX
  return [...LOOK_ZOOM_STEPS].reverse().find((s) => s < cur - 0.001) ?? LOOK_ZOOM_MIN
}

function cleanSize(v: unknown, min: number): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null
  return Math.min(LOOK_SIZE_MAX, Math.max(min, Math.round(v)))
}

/** 저장분(또는 아무 값)을 쓸 수 있는 설정으로 — 빠진 값 · 깨진 값은 기본값 */
export function cleanLookPrefs(raw: unknown): LookPrefs {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  return {
    fileWidth: cleanSize(r.fileWidth, LOOK_MIN_WIDTH),
    folderWidth: cleanSize(r.folderWidth, LOOK_MIN_WIDTH),
    height: cleanSize(r.height, LOOK_MIN_HEIGHT),
    zoom: clampLookZoom(r.zoom),
    gridZoom: clampLookZoom(r.gridZoom),
  }
}

/**
 * 그릴 크기 — 원한 크기(`want`, 없으면 `auto`)를 `[min, room]` 안으로.
 * 자리가 최소보다 좁으면 자리만큼만 쓴다
 */
export function fitLookSize(want: number | null, auto: number, min: number, room: number): number {
  return Math.min(Math.max(min, Math.round(want ?? auto)), Math.max(0, Math.round(room)))
}

/** 확대 · 축소 키인가 — `Ctrl+=` · `Ctrl++` 는 1, `Ctrl+-` 는 -1, 아니면 0. 숫자판의 + · - 도 같은 key 로 온다 */
export function lookZoomKey(e: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean }): 1 | -1 | 0 {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return 0
  if (e.key === '=' || e.key === '+') return 1
  if (e.key === '-' || e.key === '_') return -1
  return 0
}

/** 크기를 바꾸는 키인가 — `Shift+방향키`. [너비, 높이] 에 더할 px, 아니면 null */
export function lookResizeKey(e: { key: string; shiftKey: boolean; ctrlKey: boolean; metaKey: boolean; altKey: boolean }): [number, number] | null {
  if (!e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return null
  switch (e.key) {
    case 'ArrowRight': return [LOOK_SIZE_STEP, 0]
    case 'ArrowLeft': return [-LOOK_SIZE_STEP, 0]
    case 'ArrowDown': return [0, LOOK_SIZE_STEP]
    case 'ArrowUp': return [0, -LOOK_SIZE_STEP]
    default: return null
  }
}

function load(): LookPrefs {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return cleanLookPrefs(JSON.parse(raw))
  } catch { /* 저장소를 못 쓰거나 깨진 저장분이면 기본값 */ }
  return LOOK_DEFAULT
}

let state: LookPrefs = load()
const listeners = new Set<() => void>()

function same(a: LookPrefs, b: LookPrefs) {
  return a.fileWidth === b.fileWidth && a.folderWidth === b.folderWidth && a.height === b.height && a.zoom === b.zoom && a.gridZoom === b.gridZoom
}

export function lookPrefs(): LookPrefs {
  return state
}

export function setLookPrefs(patch: Partial<LookPrefs>) {
  const next = cleanLookPrefs({ ...state, ...patch })
  if (same(next, state)) return
  state = next
  try { localStorage.setItem(KEY, JSON.stringify(next)) } catch { /* 저장 못 해도 동작엔 지장 없음 */ }
  for (const l of listeners) l()
}

/** 크기 · 배율을 모두 처음으로 */
export function resetLookPrefs() {
  setLookPrefs(LOOK_DEFAULT)
}

/** 처음 값 그대로인가 (팔레트의 "처음으로" 를 켤지) */
export function isLookDefault(p: LookPrefs = state): boolean {
  return same(p, LOOK_DEFAULT)
}

export function useLookPrefs(): LookPrefs {
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => { listeners.delete(l) } },
    () => state,
  )
}
