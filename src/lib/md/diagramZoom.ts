/**
 * Mermaid 다이어그램의 확대 · 이동 (ADOPT A9 · DESIGN §39). 순수 계산만 — 그리기는 `PreviewPane.tsx` 의 `Mermaid`.
 *
 * 상태는 `translate(x, y) scale(s)` 하나다(기준점은 왼쪽 위). s = 1 · x = y = 0 이 "맞춤" — 다이어그램이 상자 너비에 맞춘
 * 원래 크기(CSS `max-width: 100%`)로 보인다. 라이브러리 없이 `transform` 만 쓴다.
 */
export interface DiagramView {
  s: number
  x: number
  y: number
}

export const FIT: DiagramView = { s: 1, x: 0, y: 0 }
export const ZOOM_MIN = 0.25
export const ZOOM_MAX = 8
/** 한 번 누를 때 · 휠 한 칸의 배율 */
export const ZOOM_STEP = 1.25
/** 방향키 한 번에 옮기는 거리 (px). Shift 면 4배 */
export const PAN_STEP = 40

export function isFit(v: DiagramView): boolean {
  return v.s === 1 && v.x === 0 && v.y === 0
}

/**
 * 상자 안의 점 (px, py) 를 제자리에 둔 채 factor 배 — 휠은 포인터 자리, 키 · 단추는 상자 가운데.
 * 배율은 ZOOM_MIN ~ ZOOM_MAX 로 자르고, 1 에 아주 가까우면 1 로 붙인다(키를 오가며 생긴 부동소수 찌꺼기). 1 로 돌아오면 자리도 맞춤으로
 */
export function zoomAt(v: DiagramView, factor: number, px: number, py: number): DiagramView {
  let s = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, v.s * factor))
  if (Math.abs(s - 1) < 1e-6) s = 1
  if (s === v.s) return v
  if (s === 1) return FIT
  const k = s / v.s
  return { s, x: px - (px - v.x) * k, y: py - (py - v.y) * k }
}

/** 옮기기 — 내용이 (dx, dy) 만큼 움직인다 */
export function panBy(v: DiagramView, dx: number, dy: number): DiagramView {
  if (!dx && !dy) return v
  return { s: v.s, x: v.x + dx, y: v.y + dy }
}

/** 방향키 → 내용을 옮길 거리. 화살표 방향으로 "보는 곳" 이 가도록 내용은 반대로 움직인다. 방향키가 아니면 null */
export function panKey(key: string, shift: boolean): [number, number] | null {
  const d = PAN_STEP * (shift ? 4 : 1)
  switch (key) {
    case 'ArrowLeft': return [d, 0]
    case 'ArrowRight': return [-d, 0]
    case 'ArrowUp': return [0, d]
    case 'ArrowDown': return [0, -d]
    default: return null
  }
}

/** 확대 · 축소 키 — `Ctrl+=` · `Ctrl+-` (숫자판의 + · - 도). 아니면 0 */
export function zoomKey(e: { key: string; code: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean }): 1 | -1 | 0 {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return 0
  if (e.code === 'Equal' || e.code === 'NumpadAdd' || e.key === '+' || e.key === '=') return 1
  if (e.code === 'Minus' || e.code === 'NumpadSubtract' || e.key === '-') return -1
  return 0
}

// ---------------------------------------------------------------- 기억하기 (DESIGN §39 MZ8)
/**
 * 확대 상태를 이 브라우저(localStorage)에 남긴다 — 문서를 닫았다 열어도 그대로. 파일에는 쓰지 않는다(원칙 7).
 * 열쇠는 문서 경로 + 다이어그램 글 — 글을 고치면 열쇠가 달라져 맞춤으로 돌아온다. 파일 이름을 바꾸면 잊는다(열 너비와 같다).
 * 자리는 상자 너비 · 높이에 대한 비율로 남긴다 — 창 너비가 바뀌거나 미리보기 ↔ 하이브리드처럼 상자가 달라도 같은 곳이 보이게.
 * 최근 `SAVED_MAX` 개만 남긴다.
 */
export const SAVED_KEY = 'jaydocs.diagramZoom'
export const SAVED_MAX = 300

/** [배율, x / 너비, y / 높이] */
export type SavedView = [number, number, number]

type Store = Pick<Storage, 'getItem' | 'setItem'>

function defaultStore(): Store | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage } catch { return null }
}

/** 글의 짧은 지문 (FNV-1a 32비트) — 열쇠를 짧게 */
function fingerprint(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36) + s.length.toString(36)
}

/** 다이어그램의 열쇠 — 문서 경로 + 글 */
export function diagramKey(docPath: string, code: string): string {
  return `${docPath}\n${fingerprint(code)}`
}

export function toSaved(v: DiagramView, w: number, h: number): SavedView {
  return [v.s, w > 0 ? v.x / w : 0, h > 0 ? v.y / h : 0]
}

export function fromSaved(saved: SavedView, w: number, h: number): DiagramView {
  const [s, fx, fy] = saved
  if (!(s >= ZOOM_MIN && s <= ZOOM_MAX) || !Number.isFinite(fx) || !Number.isFinite(fy)) return FIT
  const v = { s, x: fx * w, y: fy * h }
  return isFit(v) ? FIT : v
}

function readAll(store: Store): Record<string, SavedView> {
  try {
    const raw = store.getItem(SAVED_KEY)
    const obj = raw ? (JSON.parse(raw) as unknown) : null
    return obj && typeof obj === 'object' && !Array.isArray(obj) ? (obj as Record<string, SavedView>) : {}
  } catch { return {} }
}

/** 기억한 상태 (없으면 맞춤) */
export function loadDiagramView(key: string, w: number, h: number, store: Store | null = defaultStore()): DiagramView {
  if (!store) return FIT
  const saved = readAll(store)[key]
  return Array.isArray(saved) && saved.length === 3 ? fromSaved(saved, w, h) : FIT
}

/** 기억한다. 맞춤이면 지운다. 가장 최근 것이 맨 뒤 — 넘치면 앞에서부터 버린다 */
export function saveDiagramView(key: string, v: DiagramView, w: number, h: number, store: Store | null = defaultStore()) {
  if (!store) return
  const all = readAll(store)
  const had = key in all
  delete all[key]
  if (!isFit(v)) all[key] = toSaved(v, w, h)
  else if (!had) return
  const keys = Object.keys(all)
  for (let i = 0; i < keys.length - SAVED_MAX; i++) delete all[keys[i]]
  try { store.setItem(SAVED_KEY, JSON.stringify(all)) } catch { /* 저장 못 해도 이번 화면에는 된다 */ }
}
