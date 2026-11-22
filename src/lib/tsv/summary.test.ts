import { describe, expect, it } from 'vitest'
import { deriveSchema } from './schema'
import { parseTable } from './table'
import { SUMMARY_LIMIT, formatNumber, summarizeRange, summaryParts } from './summary'

const typed = (text: string) => {
  const t = parseTable(text, 'X_Table.tsv')
  return { t, s: deriveSchema(t, 'X_Table.tsv', []) }
}

const TYPED = '#string\tint\tstring\tfloat\nKey\tCost\tCode\tRate\na\t10\t001\t0.1\nb\t20\t002\t0.2\nc\t\t003\tx\n'

describe('선택 요약', () => {
  it('머리글 행은 빼고, 숫자 타입 열만 더한다 (string 열의 001 은 개수에만)', () => {
    const { t, s } = typed(TYPED)
    const r = summarizeRange(t, s, { r1: 0, c1: 0, r2: 4, c2: 3 })
    expect(r.cells).toBe(12)
    expect(r.count).toBe(11)
    expect(r.numbers).toBe(4) // 10 · 20 · 0.1 · 0.2 — 'x' 와 빈 칸은 아니다
    expect(r.sum).toBeCloseTo(30.3)
    expect(r.min).toBe(0.1)
    expect(r.max).toBe(20)
  })

  it('타입 행이 없는 표는 숫자로 읽히는 칸을 더한다', () => {
    const t = parseTable('이름\t수량\n사과\t10\n당근\t4\n', '목록.tsv')
    const s = deriveSchema(t, '목록.tsv', [])
    const r = summarizeRange(t, s, { r1: 0, c1: 0, r2: 2, c2: 1 })
    expect(r.count).toBe(6)
    expect(r.numbers).toBe(2)
    expect(r.sum).toBe(14)
  })

  it('범위가 표 밖으로 나가도 표 안만 센다', () => {
    const { t, s } = typed(TYPED)
    expect(summarizeRange(t, s, { r1: 3, c1: 1, r2: 99, c2: 99 }).cells).toBe(2 * 3)
  })

  it('너무 크면 세지 않는다', () => {
    const rows = Math.ceil(SUMMARY_LIMIT / 2) + 10
    const t = parseTable('a\tb\n'.repeat(rows), 'big.tsv')
    const s = deriveSchema(t, 'big.tsv', [])
    const r = summarizeRange(t, s, { r1: 0, c1: 0, r2: rows - 1, c2: 1 })
    expect(r.skipped).toBe(true)
    expect(summaryParts(r, ['count'])[0]).toContain('요약은')
  })

  it('보일 글 — 숫자가 없으면 개수만, 고른 계산만 그 순서로', () => {
    const { t, s } = typed(TYPED)
    const keys = summaryParts(summarizeRange(t, s, { r1: 2, c1: 1, r2: 3, c2: 1 }), ['count', 'sum', 'avg', 'min', 'max'])
    expect(keys).toEqual(['개수 2', '합 30', '평균 15', '최소 10', '최대 20'])
    expect(summaryParts(summarizeRange(t, s, { r1: 2, c1: 0, r2: 3, c2: 0 }), ['count', 'sum'])).toEqual(['개수 2'])
    expect(summaryParts(summarizeRange(t, s, { r1: 2, c1: 1, r2: 3, c2: 1 }), ['max'])).toEqual(['최대 20'])
  })

  it('숫자 모양 — 부동소수 찌꺼기를 떼고 천 단위 쉼표', () => {
    expect(formatNumber(0.1 + 0.2)).toBe('0.3')
    expect(formatNumber(1234567)).toBe('1,234,567')
    expect(formatNumber(-2.5)).toBe('-2.5')
  })
})
