/**
 * 틀 썸네일의 배율 계산 (PLAN-skim SK1 · SK3). DOM 을 만지지 않는 순수 함수 — 재는 것은 `DocThumb` 이 한다.
 *
 * 문서는 "종이" 상자(너비 `PAGE_WIDTH`)에 그리고 `transform: scale()` 로 틀 너비에 맞춘다.
 * 내용이 틀보다 짧으면 키운다: 종이 상자를 `PAGE_WIDTH ÷ 배율` 로 좁히고 그만큼 더 크게 확대한다.
 * 상자가 좁아지면 글이 다시 흘러 높이가 늘어나므로, 한 번 키운 뒤 다시 재서 한 번 더 맞춘다.
 *
 *   1) 너비 PAGE_WIDTH 에서 높이 h0 를 잰다 → z1 = firstZoom(h0)
 *   2) z1 > 1 이면 너비 PAGE_WIDTH ÷ z1 에서 높이 h1 을 잰다 → z2 = refineZoom(h0, z1, h1)
 *   3) thumbLayout(틀 너비, z2) 의 너비 · scale 로 그린다
 */

/** 종이 너비(px) — A4 를 96dpi 로 본 값 */
export const PAGE_WIDTH = 794
/** 세로 ÷ 가로 (A4) */
export const PAGE_RATIO = 1.414
/** 배율 1 일 때 틀에 보이는 종이 높이(px) */
export const PAGE_HEIGHT = Math.round(PAGE_WIDTH * PAGE_RATIO)
/** 맞춤 확대의 상한 */
export const MAX_ZOOM = 3

function clampZoom(z: number, max: number): number {
  if (!Number.isFinite(z)) return 1
  return Math.min(max, Math.max(1, z))
}

/**
 * 처음 배율. `contentHeight` 는 종이 너비(배율 1)에서 잰 내용 높이.
 * 틀을 넘으면 1(앞부분만 보이고 잘린다), 짧으면 `min(max, √(틀 높이 ÷ 내용 높이))`.
 * 제곱근인 이유: 흐르는 글은 너비를 1/z 로 줄이면 높이가 z 배가 되고 보이는 높이는 1/z 가 된다 → 꽉 차는 z 는 √(틀 ÷ 내용).
 */
export function firstZoom(contentHeight: number, pageHeight = PAGE_HEIGHT, max = MAX_ZOOM): number {
  if (!(contentHeight > 0) || !(pageHeight > 0)) return 1
  return clampZoom(Math.sqrt(pageHeight / contentHeight), max)
}

/**
 * 다시 잰 뒤의 배율. 배율 1 에서 높이가 `contentHeight`, `zoom` 으로 그렸을 때(상자 너비 PAGE_WIDTH ÷ zoom) `heightAtZoom` 이었다.
 * 두 값으로 "좁히면 얼마나 길어지는가"(높이 ∝ 배율^k)를 구해 꽉 차는 배율을 다시 잡는다: (틀 높이 ÷ 내용 높이)^(1 ÷ (k + 1)).
 * - 글이 예상대로 흘렀으면(높이가 zoom 배, k = 1) 처음 배율 그대로다.
 * - 줄이 짧거나 표라서 다시 흐르지 않았으면(높이 그대로, k = 0) 틀 높이 ÷ 내용 높이까지 키운다.
 * - 예상보다 더 길어졌으면(k > 1) 줄인다.
 * 잰 값이 이상하면 처음 배율을 그대로 쓴다.
 */
export function refineZoom(contentHeight: number, zoom: number, heightAtZoom: number, pageHeight = PAGE_HEIGHT, max = MAX_ZOOM): number {
  if (!(contentHeight > 0) || !(heightAtZoom > 0) || !(zoom > 1) || !(pageHeight > 0)) return clampZoom(zoom, max)
  const k = Math.min(3, Math.max(0, Math.log(heightAtZoom / contentHeight) / Math.log(zoom)))
  return clampZoom(Math.pow(pageHeight / contentHeight, 1 / (k + 1)), max)
}

export interface ThumbLayout {
  /** 종이 상자의 CSS 너비(px) */
  width: number
  /** 종이 상자에 걸 `transform: scale()` 값 */
  scale: number
}

/** 틀 너비와 배율 → 종이 상자의 너비 · scale. 틀 너비가 0 이하(숨은 탭 등)면 scale 0 */
export function thumbLayout(frameWidth: number, zoom = 1, pageWidth = PAGE_WIDTH): ThumbLayout {
  const z = zoom > 0 && Number.isFinite(zoom) ? zoom : 1
  const scale = frameWidth > 0 ? (frameWidth / pageWidth) * z : 0
  return { width: pageWidth / z, scale }
}
