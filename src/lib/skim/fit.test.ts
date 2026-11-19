import { describe, expect, it } from 'vitest'
import { MAX_ZOOM, PAGE_HEIGHT, PAGE_RATIO, PAGE_WIDTH, firstZoom, refineZoom, thumbLayout } from './fit'

describe('틀 썸네일 배율 (PLAN-skim SK3)', () => {
  it('종이는 세로 A4 비율', () => {
    expect(PAGE_WIDTH).toBe(794)
    expect(PAGE_HEIGHT).toBe(Math.round(794 * 1.414))
    expect(PAGE_RATIO).toBe(1.414)
  })

  it('내용이 틀을 넘거나 꼭 맞으면 1 — 앞부분만 보이고 잘린다', () => {
    expect(firstZoom(PAGE_HEIGHT)).toBe(1)
    expect(firstZoom(PAGE_HEIGHT * 5)).toBe(1)
  })

  it('짧으면 √(틀 높이 ÷ 내용 높이), 상한 3', () => {
    expect(firstZoom(PAGE_HEIGHT / 4)).toBeCloseTo(2, 10)
    expect(firstZoom(PAGE_HEIGHT / 2)).toBeCloseTo(Math.SQRT2, 10)
    expect(firstZoom(PAGE_HEIGHT / 16)).toBe(MAX_ZOOM)
    expect(firstZoom(10)).toBe(MAX_ZOOM)
    expect(firstZoom(PAGE_HEIGHT / 4, PAGE_HEIGHT, 1.5)).toBe(1.5)
  })

  it('잴 수 없는 값은 1', () => {
    expect(firstZoom(0)).toBe(1)
    expect(firstZoom(-5)).toBe(1)
    expect(firstZoom(Number.NaN)).toBe(1)
    expect(firstZoom(100, 0)).toBe(1)
  })

  it('다시 재기 — 예상대로 흘렀으면(높이가 배율만큼 늘면) 그대로', () => {
    const h0 = PAGE_HEIGHT / 4
    const z1 = firstZoom(h0)
    expect(refineZoom(h0, z1, h0 * z1)).toBeCloseTo(z1, 10)
    // 그때 내용이 틀을 꼭 채운다: 보이는 높이(틀 ÷ 배율) = 잰 높이
    expect(PAGE_HEIGHT / z1).toBeCloseTo(h0 * z1, 10)
  })

  it('다시 재기 — 다시 흐르지 않으면(표 · 짧은 줄, 높이 그대로) 틀 높이 ÷ 내용 높이까지 키운다', () => {
    const h0 = PAGE_HEIGHT / 2.5
    const z1 = firstZoom(h0)
    const z2 = refineZoom(h0, z1, h0)
    expect(z2).toBeCloseTo(2.5, 10)
    // 꼭 찬다
    expect(h0).toBeCloseTo(PAGE_HEIGHT / z2, 10)
    // 아주 짧은 글은 상한에 걸린다
    expect(refineZoom(20, MAX_ZOOM, 20)).toBe(MAX_ZOOM)
    expect(refineZoom(PAGE_HEIGHT / 8, 2.8, PAGE_HEIGHT / 8)).toBe(MAX_ZOOM)
  })

  it('다시 재기 — 덜 흘렀으면 그 사이, 예상보다 길어졌으면 줄인다 (1 아래로는 안 간다)', () => {
    const h0 = PAGE_HEIGHT / 4
    const z1 = firstZoom(h0) // 2
    // 높이가 √2 배만 늘었다 (k = 0.5) → 4^(1/1.5)
    const between = refineZoom(h0, z1, h0 * Math.SQRT2)
    expect(between).toBeCloseTo(Math.pow(4, 1 / 1.5), 10)
    expect(between).toBeGreaterThan(z1)
    // 높이가 4배로 늘었다 (k = 2) → 4^(1/3)
    const less = refineZoom(h0, z1, h0 * 4)
    expect(less).toBeCloseTo(Math.pow(4, 1 / 3), 10)
    expect(less).toBeLessThan(z1)
    expect(less).toBeGreaterThanOrEqual(1)
    // 맞춘 배율에서 같은 정도로 늘어난다면 틀을 꼭 채운다: h0 × z^k = 틀 ÷ z
    expect(h0 * Math.pow(less, 2)).toBeCloseTo(PAGE_HEIGHT / less, 8)
  })

  it('다시 잰 값이 이상하면 처음 배율을 그대로 쓴다', () => {
    expect(refineZoom(100, 2, 0)).toBe(2)
    expect(refineZoom(100, 2, Number.NaN)).toBe(2)
    expect(refineZoom(0, 2, 100)).toBe(2)
    expect(refineZoom(100, 9, 0)).toBe(MAX_ZOOM)
    expect(refineZoom(100, 1, 100)).toBe(1)
    // 좁혔더니 오히려 짧아졌다 → 다시 흐르지 않은 것으로 본다
    expect(refineZoom(PAGE_HEIGHT / 2, Math.SQRT2, PAGE_HEIGHT / 3)).toBeCloseTo(2, 10)
  })

  it('틀 너비 → 종이 상자 너비와 scale', () => {
    expect(thumbLayout(397)).toEqual({ width: 794, scale: 0.5 })
    expect(thumbLayout(397, 2)).toEqual({ width: 397, scale: 1 })
    // 확대해도 종이 상자는 틀 너비를 꼭 채운다: 너비 × scale = 틀 너비
    const l = thumbLayout(180, 2.4)
    expect(l.width * l.scale).toBeCloseTo(180, 10)
    expect(thumbLayout(0, 2).scale).toBe(0)
    expect(thumbLayout(200, 0)).toEqual({ width: 794, scale: 200 / 794 })
  })
})
