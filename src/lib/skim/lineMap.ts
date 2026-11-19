/**
 * 원문 줄 ↔ 렌더된 조각의 세로 위치 (PLAN-skim SK7). DOM 을 만지지 않는 순수 계산 — 재는 것은 `SkimPanel` 이 한다.
 *
 * 원문 높이와 렌더 높이는 비례하지 않는다(한 줄짜리 문단이 다섯 줄로 흐르고, 펜스 스무 줄이 그림 하나가 된다).
 * 그래서 조각마다 찍힌 원문 줄(`data-line`)을 기준점으로 삼는다:
 *
 * - 조각 i 는 원문 `[line_i, line_{i+1})` 줄을 맡는다 — 조각 뒤의 빈 줄, 걷어 낸 baked 표, 줄 번호가 없는 조각(각주 묶음)까지.
 *   "그 줄 이하에서 가장 큰 data-line" 이 그 줄의 조각이다.
 * - 그 사이는 고르게 나눈다(`top_i` ~ `top_{i+1}`). 긴 펜스 · 목록 안에서 상자가 한 번에 뛰지 않는다.
 *
 * 줄은 소수로 다룬다: `3` 은 3번째 줄의 위 끝, `3.5` 는 그 줄의 가운데, `줄 수 + 1` 은 글의 끝.
 * 세로 위치의 단위는 쓰는 쪽이 정한다(패널은 축소한 뒤의 px, 미리보기는 스크롤 내용의 px).
 */

/** 줄 번호가 찍힌 조각 하나 */
export interface LineBlock {
  /** 원문 시작 줄 (1부터) */
  line: number
  top: number
  bottom: number
}

export interface LineMap {
  /** 줄 오름차순 · 위치 내림 없음 */
  blocks: LineBlock[]
  /** 내용 전체 높이 */
  height: number
  /** 원문 줄 수 */
  lines: number
}

/**
 * 잰 조각들로 지도를 만든다. 줄 순서로 놓고, 같은 줄의 조각은 처음 것만 남기고, 위치가 거꾸로 가는 조각은 앞 조각에 맞춘다.
 * `lines` 가 조각의 줄보다 작으면(패널이 아직 옛 글을 그리고 있다) 조각 쪽에 맞춘다.
 */
export function buildLineMap(measured: readonly LineBlock[], height: number, lines: number): LineMap {
  const sorted = measured
    .filter((b) => Number.isFinite(b.line) && b.line >= 1 && Number.isFinite(b.top) && Number.isFinite(b.bottom))
    .slice()
    .sort((a, b) => a.line - b.line || a.top - b.top)
  const blocks: LineBlock[] = []
  for (const b of sorted) {
    const prev = blocks[blocks.length - 1]
    if (prev && b.line === prev.line) continue
    const top = Math.max(0, prev ? Math.max(prev.top, b.top) : b.top)
    blocks.push({ line: b.line, top, bottom: Math.max(top, b.bottom) })
  }
  const last = blocks[blocks.length - 1]
  const h = Math.max(Number.isFinite(height) ? height : 0, last ? last.bottom : 0, 0)
  const n = Math.max(1, Number.isFinite(lines) ? Math.floor(lines) : 1, last ? last.line : 1)
  return { blocks, height: h, lines: n }
}

interface Point { line: number; y: number }
/** 지도는 만든 뒤 바꾸지 않는다 → 기준점은 지도마다 한 번만 만든다 (스크롤할 때마다 부른다) */
const pointCache = new WeakMap<LineMap, Point[]>()

/** 기준점들: (1, 0) → 조각의 (줄, 위) … → (줄 수 + 1, 높이). 첫 조각이 1번째 줄이면 (1, 0) 은 넣지 않는다 */
function points(map: LineMap): Point[] {
  let pts = pointCache.get(map)
  if (pts) return pts
  pts = []
  if (!map.blocks.length || map.blocks[0].line > 1) pts.push({ line: 1, y: 0 })
  for (const b of map.blocks) pts.push({ line: b.line, y: b.top })
  pts.push({ line: map.lines + 1, y: map.height })
  pointCache.set(map, pts)
  return pts
}

/** `key(pts[i]) <= v` 인 가장 큰 i (마지막 기준점은 구간의 끝이라 뺀다). 없으면 0 */
function segmentAt(pts: Point[], v: number, key: 'line' | 'y'): number {
  let lo = 0
  let hi = pts.length - 2
  let hit = 0
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (pts[mid][key] <= v) { hit = mid; lo = mid + 1 } else hi = mid - 1
  }
  return hit
}

/** 그 줄 이하에서 가장 큰 줄의 조각 번호. 없으면 -1 */
function blockIndexAtLine(map: LineMap, line: number): number {
  let lo = 0
  let hi = map.blocks.length - 1
  let hit = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (map.blocks[mid].line <= line) { hit = mid; lo = mid + 1 } else hi = mid - 1
  }
  return hit
}

/** 줄(소수 가능)의 세로 위치 */
export function yAtLine(map: LineMap, line: number): number {
  const pts = points(map)
  const l = Math.min(map.lines + 1, Math.max(1, line))
  const i = segmentAt(pts, l, 'line')
  const a = pts[i]
  const b = pts[i + 1]
  if (l <= a.line) return a.y
  const span = b.line - a.line
  return span > 0 ? a.y + ((l - a.line) / span) * (b.y - a.y) : a.y
}

/** 세로 위치의 줄(소수). `yAtLine` 의 반대 — 같은 위치에 기준점이 여럿이면(높이 0 인 구간) 그중 마지막 것의 줄 */
export function lineAtY(map: LineMap, y: number): number {
  const pts = points(map)
  if (y <= pts[0].y) return pts[0].line
  const end = pts[pts.length - 1]
  if (y >= end.y) return end.line
  const i = segmentAt(pts, y, 'y')
  const a = pts[i]
  const b = pts[i + 1]
  const span = b.y - a.y
  return span > 0 ? a.line + ((y - a.y) / span) * (b.line - a.line) : a.line
}

/**
 * 누른 곳의 조각이 시작하는 원문 줄 — 그 위치에 있는 조각, 조각 사이 빈 곳이면 그 위쪽에서 가장 가까운 조각.
 * 첫 조각보다 위를 누르면 첫 조각. 조각이 하나도 없으면 1
 */
export function blockLineAtY(map: LineMap, y: number): number {
  let lo = 0
  let hi = map.blocks.length - 1
  let hit = 0
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (map.blocks[mid].top <= y) { hit = mid; lo = mid + 1 } else hi = mid - 1
  }
  return map.blocks[hit]?.line ?? 1
}

/** 그 줄이 든 조각 (커서 표시). 첫 조각보다 앞줄이면 null */
export function blockAtLine(map: LineMap, line: number): LineBlock | null {
  const i = blockIndexAtLine(map, line)
  return i < 0 ? null : map.blocks[i]
}

/**
 * 보이는 줄 범위 `[first, last)` (소수 줄) 의 상자. 너무 얇으면 `minHeight` 로 키우고, 내용 밖으로 나가지 않게 한다.
 */
export function rangeBox(map: LineMap, first: number, last: number, minHeight = 0): { top: number; height: number } {
  let top = yAtLine(map, first)
  let height = Math.max(0, yAtLine(map, Math.max(first, last)) - top)
  if (height < minHeight) {
    height = Math.min(minHeight, Math.max(map.height, 0))
    top = Math.max(0, Math.min(top, map.height - height))
  }
  return { top, height }
}

/**
 * 상자가 보이게 하는 패널의 스크롤 위치. 이미 다 보이면 그대로 둔다.
 * 위로 벗어나면 상자의 위에, 아래로 벗어나면 상자의 아래에 맞추고(`margin` 만큼 여유), 상자가 화면보다 크면 위에 맞춘다.
 */
export function followScroll(scrollTop: number, viewHeight: number, boxTop: number, boxHeight: number, maxScroll: number, margin = 0): number {
  const clamp = (v: number) => Math.min(Math.max(0, maxScroll), Math.max(0, v))
  const m = Math.max(0, Math.min(margin, (viewHeight - boxHeight) / 2))
  if (boxHeight >= viewHeight) {
    // 상자가 화면보다 크다 — 화면이 상자 안에 있으면 그대로, 아니면 가까운 쪽 끝에 맞춘다
    if (scrollTop >= boxTop && scrollTop + viewHeight <= boxTop + boxHeight) return clamp(scrollTop)
    return clamp(scrollTop < boxTop ? boxTop : boxTop + boxHeight - viewHeight)
  }
  if (boxTop - m < scrollTop) return clamp(boxTop - m)
  if (boxTop + boxHeight + m > scrollTop + viewHeight) return clamp(boxTop + boxHeight + m - viewHeight)
  return clamp(scrollTop)
}
