import { describe, expect, it } from 'vitest'
import { blockAtLine, blockLineAtY, buildLineMap, followScroll, lineAtY, rangeBox, yAtLine } from './lineMap'
import { SKIM_WIDTH_DEFAULT, SKIM_WIDTH_MAX, SKIM_WIDTH_MIN, clampSkimWidth } from './panel'

/**
 * 문서 20줄, 높이 500:
 *   1줄 제목      0 ~ 40
 *   3줄 문단     50 ~ 150   (한 줄짜리 문단이 길게 흐른다)
 *   5줄 펜스    160 ~ 360   (5 ~ 14줄, 열 줄)
 *  16줄 문단    380 ~ 420
 */
const MAP = buildLineMap(
  [
    { line: 1, top: 0, bottom: 40 },
    { line: 3, top: 50, bottom: 150 },
    { line: 5, top: 160, bottom: 360 },
    { line: 16, top: 380, bottom: 420 },
  ],
  500,
  20,
)

describe('줄 → 위치 (yAtLine)', () => {
  it('조각이 시작하는 줄은 그 조각의 위', () => {
    expect(yAtLine(MAP, 1)).toBe(0)
    expect(yAtLine(MAP, 3)).toBe(50)
    expect(yAtLine(MAP, 5)).toBe(160)
    expect(yAtLine(MAP, 16)).toBe(380)
  })
  it('조각 사이의 줄은 그 줄 이하에서 가장 큰 조각의 구간을 고르게 나눈다', () => {
    // 5 ~ 16줄(열한 줄)이 160 ~ 380 → 한 줄에 20
    expect(yAtLine(MAP, 6)).toBe(180)
    expect(yAtLine(MAP, 10.5)).toBe(270)
    // 2줄(제목 뒤 빈 줄)은 제목 구간(0 ~ 50)의 가운데
    expect(yAtLine(MAP, 2)).toBe(25)
  })
  it('마지막 조각 뒤는 글의 끝(줄 수 + 1)까지', () => {
    expect(yAtLine(MAP, 21)).toBe(500)
    expect(yAtLine(MAP, 18.5)).toBe(440)
  })
  it('범위 밖의 줄은 끝에 붙인다', () => {
    expect(yAtLine(MAP, 0)).toBe(0)
    expect(yAtLine(MAP, -3)).toBe(0)
    expect(yAtLine(MAP, 999)).toBe(500)
  })
  it('첫 조각이 1번째 줄이 아니면 그 앞줄들은 0 ~ 첫 조각 위', () => {
    const m = buildLineMap([{ line: 5, top: 40, bottom: 60 }], 100, 8)
    expect(yAtLine(m, 1)).toBe(0)
    expect(yAtLine(m, 3)).toBe(20)
    expect(yAtLine(m, 5)).toBe(40)
  })
  it('첫 조각이 1번째 줄이면 그 조각의 위(위쪽 여백)가 1번째 줄', () => {
    const m = buildLineMap([{ line: 1, top: 18, bottom: 40 }], 100, 4)
    expect(yAtLine(m, 1)).toBe(18)
  })
  it('조각이 하나도 없으면 줄 수로 고르게', () => {
    const m = buildLineMap([], 100, 4)
    expect(yAtLine(m, 1)).toBe(0)
    expect(yAtLine(m, 3)).toBe(50)
    expect(yAtLine(m, 5)).toBe(100)
  })
})

describe('위치 → 줄 (lineAtY)', () => {
  it('yAtLine 의 반대', () => {
    for (const l of [1, 2, 3, 4.25, 5, 6, 10.5, 15.9, 16, 18.5, 21]) expect(lineAtY(MAP, yAtLine(MAP, l))).toBeCloseTo(l, 9)
  })
  it('범위 밖은 처음 · 끝 줄', () => {
    expect(lineAtY(MAP, -10)).toBe(1)
    expect(lineAtY(MAP, 9999)).toBe(21)
  })
  it('첫 조각 위의 여백은 1번째 줄', () => {
    const m = buildLineMap([{ line: 1, top: 18, bottom: 40 }], 100, 4)
    expect(lineAtY(m, 5)).toBe(1)
  })
  it('높이가 0 인 구간에서 멈추지 않는다', () => {
    const m = buildLineMap([{ line: 1, top: 0, bottom: 0 }, { line: 3, top: 0, bottom: 30 }], 30, 3)
    expect(lineAtY(m, 0)).toBe(1)
    expect(lineAtY(m, 15)).toBe(3.5)
  })
})

describe('누른 곳의 조각 줄 (blockLineAtY)', () => {
  it('조각 안은 그 조각이 시작하는 줄', () => {
    expect(blockLineAtY(MAP, 10)).toBe(1)
    expect(blockLineAtY(MAP, 100)).toBe(3)
    expect(blockLineAtY(MAP, 359)).toBe(5)
  })
  it('조각 사이 빈 곳은 위쪽에서 가장 가까운 조각', () => {
    expect(blockLineAtY(MAP, 155)).toBe(3)
    expect(blockLineAtY(MAP, 370)).toBe(5)
    expect(blockLineAtY(MAP, 480)).toBe(16)
  })
  it('첫 조각보다 위는 첫 조각, 조각이 없으면 1', () => {
    expect(blockLineAtY(buildLineMap([{ line: 4, top: 30, bottom: 50 }], 100, 9), 5)).toBe(4)
    expect(blockLineAtY(buildLineMap([], 100, 9), 5)).toBe(1)
  })
})

describe('줄이 든 조각 (blockAtLine)', () => {
  it('그 줄 이하에서 가장 큰 줄의 조각', () => {
    expect(blockAtLine(MAP, 1)).toMatchObject({ line: 1, top: 0, bottom: 40 })
    expect(blockAtLine(MAP, 2)).toMatchObject({ line: 1 })
    expect(blockAtLine(MAP, 14)).toMatchObject({ line: 5, top: 160, bottom: 360 })
    expect(blockAtLine(MAP, 20)).toMatchObject({ line: 16 })
  })
  it('첫 조각보다 앞줄이면 없다', () => {
    expect(blockAtLine(buildLineMap([{ line: 4, top: 30, bottom: 50 }], 100, 9), 2)).toBeNull()
  })
})

describe('지도 만들기 (buildLineMap)', () => {
  it('줄 순서로 놓고 같은 줄은 처음 것만', () => {
    const m = buildLineMap([{ line: 7, top: 70, bottom: 80 }, { line: 2, top: 10, bottom: 20 }, { line: 7, top: 90, bottom: 95 }], 100, 9)
    expect(m.blocks.map((b) => b.line)).toEqual([2, 7])
    expect(m.blocks[1].top).toBe(70)
  })
  it('위치가 거꾸로 가는 조각은 앞 조각에 맞춘다 (지도가 뒤로 가지 않는다)', () => {
    const m = buildLineMap([{ line: 1, top: 50, bottom: 60 }, { line: 2, top: 40, bottom: 45 }], 100, 3)
    expect(m.blocks[1].top).toBe(50)
    expect(yAtLine(m, 2)).toBeGreaterThanOrEqual(yAtLine(m, 1))
  })
  it('줄 수가 조각의 줄보다 작으면 조각에 맞춘다 (패널이 아직 옛 글을 그리고 있을 때)', () => {
    const m = buildLineMap([{ line: 30, top: 10, bottom: 20 }], 100, 12)
    expect(m.lines).toBe(30)
    expect(yAtLine(m, 31)).toBe(100)
  })
  it('숫자가 아닌 것 · 0 이하의 줄은 버린다', () => {
    const m = buildLineMap([{ line: Number.NaN, top: 0, bottom: 1 }, { line: 0, top: 0, bottom: 1 }, { line: 2, top: 5, bottom: 9 }], 10, 3)
    expect(m.blocks).toHaveLength(1)
  })
})

describe('범위 상자 (rangeBox)', () => {
  it('첫 줄의 위 ~ 끝 줄의 위', () => {
    expect(rangeBox(MAP, 3, 16)).toEqual({ top: 50, height: 330 })
  })
  it('너무 얇으면 가장 작은 높이로 키우되 내용 밖으로 나가지 않는다', () => {
    expect(rangeBox(MAP, 3, 3, 12)).toEqual({ top: 50, height: 12 })
    expect(rangeBox(MAP, 21, 21, 12)).toEqual({ top: 488, height: 12 })
  })
  it('끝이 처음보다 앞이면 높이 0', () => {
    expect(rangeBox(MAP, 10, 4).height).toBe(0)
  })
})

describe('패널 따라 스크롤 (followScroll)', () => {
  // 화면 높이 200, 내용 1000 → 가장 큰 스크롤 800
  it('상자가 다 보이면 그대로', () => {
    expect(followScroll(100, 200, 150, 50, 800)).toBe(100)
  })
  it('위로 벗어나면 상자의 위에 맞춘다', () => {
    expect(followScroll(300, 200, 150, 50, 800)).toBe(150)
    expect(followScroll(300, 200, 150, 50, 800, 20)).toBe(130)
  })
  it('아래로 벗어나면 상자의 아래에 맞춘다', () => {
    expect(followScroll(0, 200, 400, 50, 800)).toBe(250)
    expect(followScroll(0, 200, 400, 50, 800, 20)).toBe(270)
  })
  it('상자가 화면보다 크면 가까운 끝에 맞추고, 화면이 상자 안이면 그대로', () => {
    expect(followScroll(0, 200, 300, 500, 800)).toBe(300)
    expect(followScroll(700, 200, 300, 500, 800)).toBe(600)
    expect(followScroll(400, 200, 300, 500, 800)).toBe(400)
  })
  it('스크롤 범위를 넘지 않는다', () => {
    expect(followScroll(0, 200, 990, 10, 800, 20)).toBe(800)
    expect(followScroll(50, 200, 0, 10, 800, 20)).toBe(0)
  })
})

describe('패널 너비', () => {
  it('범위 안으로 맞춘다', () => {
    expect(clampSkimWidth(50)).toBe(SKIM_WIDTH_MIN)
    expect(clampSkimWidth(9999)).toBe(SKIM_WIDTH_MAX)
    expect(clampSkimWidth(222.4)).toBe(222)
    expect(clampSkimWidth(Number.NaN)).toBe(SKIM_WIDTH_DEFAULT)
  })
})
