/**
 * 폴더 훑어보기 격자의 순수 계산 (PLAN-skim Phase E · SK12). DOM 을 만지지 않는다 — 재는 것은 `QuickLookFolder` 가 한다.
 */

/** 카드의 가장 작은 너비(px) — 창 너비에 맞춰 열 수가 정해진다 */
export const CARD_MIN_WIDTH = 140
/** 카드 사이 틈(px) */
export const CARD_GAP = 12

/** 격자 너비 → 열 수 (1 이상). 카드가 `min` 보다 좁아지지 않는 가장 많은 열 */
export function gridColumns(width: number, min = CARD_MIN_WIDTH, gap = CARD_GAP): number {
  if (!(width > 0)) return 1
  return Math.max(1, Math.floor((width + gap) / (min + gap)))
}

export type GridKey = 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown' | 'Home' | 'End' | 'PageUp' | 'PageDown'

const GRID_KEYS = new Set<string>(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'])

export function isGridKey(key: string): key is GridKey {
  return GRID_KEYS.has(key)
}

/**
 * 격자에서 키를 눌렀을 때 옮겨 갈 카드 번호. 카드는 왼쪽 → 오른쪽, 위 → 아래 순서(0부터 `count - 1`).
 *
 * - `←` `→` 는 한 칸 (줄 끝에서 다음 줄로 이어진다), 처음 · 끝에서 멈춘다.
 * - `↑` `↓` 는 한 줄 (`cols` 칸). 아래 줄이 짧아 바로 아래 칸이 없으면 마지막 카드로, 맨 아래 줄에서는 그대로.
 * - `PageUp` `PageDown` 은 `pageRows` 줄씩 (모자라면 첫 줄 · 마지막 줄까지).
 * - `Home` `End` 는 처음 · 끝.
 * 카드가 없으면 -1, 지금 번호가 범위 밖이면 0 에서 시작한다.
 */
export function gridMove(index: number, count: number, cols: number, key: GridKey, pageRows = 1): number {
  if (count <= 0) return -1
  const c = Math.max(1, Math.floor(cols))
  const i = index >= 0 && index < count ? index : 0
  const last = count - 1
  const row = Math.floor(i / c)
  const lastRow = Math.floor(last / c)
  const byRows = (n: number) => {
    const r = Math.max(0, Math.min(lastRow, row + n))
    if (r === row) return i
    return Math.min(last, r * c + (i % c))
  }
  switch (key) {
    case 'ArrowLeft': return Math.max(0, i - 1)
    case 'ArrowRight': return Math.min(last, i + 1)
    case 'ArrowUp': return byRows(-1)
    case 'ArrowDown': return byRows(1)
    case 'PageUp': return byRows(-Math.max(1, Math.floor(pageRows)))
    case 'PageDown': return byRows(Math.max(1, Math.floor(pageRows)))
    case 'Home': return 0
    case 'End': return last
  }
}

/** 한 화면에 드는 줄 수 (PageUp / PageDown 의 걸음). 적어도 1 */
export function pageRowsOf(viewHeight: number, rowHeight: number): number {
  if (!(rowHeight > 0) || !(viewHeight > 0)) return 1
  return Math.max(1, Math.floor(viewHeight / rowHeight))
}

/** 폴더 항목의 하위 폴더 · 문서 수 (바로 아래만) */
export function folderCounts(children: readonly { type: 'dir' | 'file' }[] | undefined): { dirs: number; files: number } {
  let dirs = 0
  let files = 0
  for (const c of children ?? []) if (c.type === 'dir') dirs++; else files++
  return { dirs, files }
}
