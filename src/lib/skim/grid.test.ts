import { describe, expect, it } from 'vitest'
import { CARD_GAP, CARD_MIN_WIDTH, folderCounts, gridColumns, gridMove, isGridKey, pageRowsOf } from './grid'

describe('gridColumns', () => {
  it('카드가 최소 너비보다 좁아지지 않는 가장 많은 열', () => {
    expect(gridColumns(CARD_MIN_WIDTH)).toBe(1)
    expect(gridColumns(CARD_MIN_WIDTH * 2 + CARD_GAP - 1)).toBe(1)
    expect(gridColumns(CARD_MIN_WIDTH * 2 + CARD_GAP)).toBe(2)
    expect(gridColumns(872)).toBe(truncCols(872))
  })
  it('0 · 음수 · NaN 은 1열', () => {
    expect(gridColumns(0)).toBe(1)
    expect(gridColumns(-10)).toBe(1)
    expect(gridColumns(Number.NaN)).toBe(1)
    expect(gridColumns(50)).toBe(1)
  })
  it('최소 너비 · 틈을 바꿀 수 있다', () => {
    expect(gridColumns(300, 100, 0)).toBe(3)
    expect(gridColumns(300, 100, 10)).toBe(2)
  })
})

function truncCols(w: number) {
  return Math.floor((w + CARD_GAP) / (CARD_MIN_WIDTH + CARD_GAP))
}

describe('gridMove', () => {
  // 3열 · 8장
  // 0 1 2
  // 3 4 5
  // 6 7
  const n = 8
  const cols = 3
  it('← → 는 한 칸, 줄을 넘어 이어지고 처음 · 끝에서 멈춘다', () => {
    expect(gridMove(0, n, cols, 'ArrowLeft')).toBe(0)
    expect(gridMove(3, n, cols, 'ArrowLeft')).toBe(2)
    expect(gridMove(2, n, cols, 'ArrowRight')).toBe(3)
    expect(gridMove(7, n, cols, 'ArrowRight')).toBe(7)
  })
  it('↑ ↓ 는 한 줄', () => {
    expect(gridMove(1, n, cols, 'ArrowDown')).toBe(4)
    expect(gridMove(4, n, cols, 'ArrowDown')).toBe(7)
    expect(gridMove(4, n, cols, 'ArrowUp')).toBe(1)
    expect(gridMove(1, n, cols, 'ArrowUp')).toBe(1)
  })
  it('아래 줄이 짧아 바로 아래 칸이 없으면 마지막 카드로', () => {
    expect(gridMove(5, n, cols, 'ArrowDown')).toBe(7)
  })
  it('맨 아래 줄에서 ↓ 는 그대로', () => {
    expect(gridMove(6, n, cols, 'ArrowDown')).toBe(6)
    expect(gridMove(7, n, cols, 'ArrowDown')).toBe(7)
  })
  it('Home · End', () => {
    expect(gridMove(4, n, cols, 'Home')).toBe(0)
    expect(gridMove(4, n, cols, 'End')).toBe(7)
  })
  it('PageUp · PageDown 은 pageRows 줄씩, 모자라면 첫 줄 · 마지막 줄까지', () => {
    // 4열 · 30장 → 8줄
    expect(gridMove(1, 30, 4, 'PageDown', 3)).toBe(13)
    expect(gridMove(13, 30, 4, 'PageDown', 3)).toBe(25)
    expect(gridMove(25, 30, 4, 'PageDown', 3)).toBe(29)
    expect(gridMove(29, 30, 4, 'PageDown', 3)).toBe(29)
    expect(gridMove(13, 30, 4, 'PageUp', 3)).toBe(1)
    expect(gridMove(5, 30, 4, 'PageUp', 3)).toBe(1)
    expect(gridMove(5, 30, 4, 'PageDown')).toBe(9)
  })
  it('1열이면 ↑ ↓ 와 ← → 가 같다', () => {
    expect(gridMove(2, 5, 1, 'ArrowDown')).toBe(3)
    expect(gridMove(2, 5, 1, 'ArrowRight')).toBe(3)
    expect(gridMove(2, 5, 1, 'ArrowUp')).toBe(1)
  })
  it('열이 카드보다 많으면 한 줄', () => {
    expect(gridMove(1, 3, 6, 'ArrowDown')).toBe(1)
    expect(gridMove(1, 3, 6, 'End')).toBe(2)
  })
  it('카드가 없으면 -1, 범위 밖 번호는 0 에서', () => {
    expect(gridMove(0, 0, 3, 'ArrowDown')).toBe(-1)
    expect(gridMove(-1, 5, 3, 'ArrowRight')).toBe(1)
    expect(gridMove(9, 5, 3, 'ArrowLeft')).toBe(0)
  })
  it('열 수가 0 · 소수여도 깨지지 않는다', () => {
    expect(gridMove(0, 5, 0, 'ArrowDown')).toBe(1)
    expect(gridMove(0, 5, 2.7, 'ArrowDown')).toBe(2)
  })
})

describe('isGridKey', () => {
  it('격자가 받는 키만', () => {
    for (const k of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown']) expect(isGridKey(k)).toBe(true)
    for (const k of ['Enter', 'Tab', ' ', 'Backspace', 'Escape', 'a']) expect(isGridKey(k)).toBe(false)
  })
})

describe('pageRowsOf', () => {
  it('한 화면에 드는 줄 수, 적어도 1', () => {
    expect(pageRowsOf(600, 250)).toBe(2)
    expect(pageRowsOf(100, 250)).toBe(1)
    expect(pageRowsOf(600, 0)).toBe(1)
    expect(pageRowsOf(0, 250)).toBe(1)
  })
})

describe('folderCounts', () => {
  it('바로 아래의 폴더 · 문서 수', () => {
    expect(folderCounts([{ type: 'dir' }, { type: 'file' }, { type: 'file' }])).toEqual({ dirs: 1, files: 2 })
    expect(folderCounts([])).toEqual({ dirs: 0, files: 0 })
    expect(folderCounts(undefined)).toEqual({ dirs: 0, files: 0 })
  })
})
