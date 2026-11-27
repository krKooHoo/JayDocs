import { describe, expect, it } from 'vitest'
import { parseTsv } from './parse'
import { serializeTsv } from './serialize'
import { fillRange, pasteBlock, setCell } from './edits'
import { validateTable } from './validate'
import { deriveSchema } from './schema'
import {
  actualRows, compareValues, deleteRowSet, distinctValues, editInView, emptyView, fitColumnWidth, hideColumns, makeRowView,
  mapDelete, mapInsert, mapMove, remapColumns, showAllColumns, stepColumn, viewOrder, visibleColumn, withFilter, withSort, withoutFilters,
} from './view'

/** 두 텍스트에서 다른 줄 번호 (줄 수가 같아야 한다) */
function changedLines(a: string, b: string): number[] {
  const x = a.split(/\r?\n/)
  const y = b.split(/\r?\n/)
  expect(y.length).toBe(x.length)
  return x.map((line, i) => (line === y[i] ? -1 : i)).filter((i) => i >= 0)
}

// 타입 행 + 머리글 = 머리글 행 2
const TYPED = '#string\tint\tstring\nKey\tN\tKind\nC\t10\t물\nA\t9\t불\nD\t\t물\nB\t-2\t\nE\t1.5\t불\n'

describe('정렬 순서 (보기만)', () => {
  it('숫자는 수로, 숫자가 글자보다 앞, 글자는 자연 순서', () => {
    expect(compareValues('9', '10')).toBeLessThan(0)
    expect(compareValues('-2', '1.5')).toBeLessThan(0)
    expect(compareValues('1.5', '1.25')).toBeGreaterThan(0)
    expect(compareValues('3', 'a')).toBeLessThan(0)
    expect(compareValues('Item2', 'Item10')).toBeLessThan(0)
    expect(compareValues('가', '나')).toBeLessThan(0)
  })

  it('머리글 행은 그대로, 본문만 정렬. 빈 칸은 방향과 상관없이 맨 뒤', () => {
    const t = parseTsv(TYPED)
    const v = emptyView(t.width)
    expect(viewOrder(t, 2, v)).toEqual([2, 3, 4, 5, 6])
    // N 열: -2(5) 1.5(6) 9(3) 10(2) 빈칸(4)
    expect(viewOrder(t, 2, withSort(v, 1, 1))).toEqual([5, 6, 3, 2, 4])
    expect(viewOrder(t, 2, withSort(v, 1, -1))).toEqual([2, 3, 6, 5, 4])
    expect(viewOrder(t, 2, withSort(v, 0, 1))).toEqual([3, 5, 2, 4, 6])
  })

  it('같은 값은 파일 순서 (안정 정렬) — 두 방향 모두', () => {
    const t = parseTsv(TYPED)
    // Kind: 물(2) 불(3) 물(4) 빈칸(5) 불(6)
    expect(viewOrder(t, 2, withSort(emptyView(3), 2, 1))).toEqual([2, 4, 3, 6, 5])
    expect(viewOrder(t, 2, withSort(emptyView(3), 2, -1))).toEqual([3, 6, 2, 4, 5])
  })
})

describe('값 필터', () => {
  it('체크를 푼 값의 행을 감춘다. 빈 칸은 "" 로 고른다. 여러 열은 모두 맞아야', () => {
    const t = parseTsv(TYPED)
    let v = withFilter(emptyView(3), 2, ['불'])
    expect(viewOrder(t, 2, v)).toEqual([2, 4, 5])
    v = withFilter(v, 1, [''])
    expect(viewOrder(t, 2, v)).toEqual([2, 5])
    v = withFilter(v, 2, [])
    expect(v.filters.map((f) => f.c)).toEqual([1])
    expect(viewOrder(t, 2, withoutFilters(v))).toEqual([2, 3, 4, 5, 6])
  })

  it('필터와 정렬을 같이', () => {
    const t = parseTsv(TYPED)
    expect(viewOrder(t, 2, withSort(withFilter(emptyView(3), 2, ['물']), 1, 1))).toEqual([5, 6, 3])
  })

  it('값 목록: 본문의 값과 개수, 오름차순, 빈 칸은 맨 뒤', () => {
    const t = parseTsv(TYPED)
    expect(distinctValues(t, 2, 2)).toEqual([{ value: '물', count: 2 }, { value: '불', count: 2 }, { value: '', count: 1 }])
    expect(distinctValues(t, 2, 1).map((x) => x.value)).toEqual(['-2', '1.5', '9', '10', ''])
  })
})

describe('보이는 행 ↔ 실제 행', () => {
  it('toActual · toView 가 서로 맞고, 걸러진 행은 -1', () => {
    const t = parseTsv(TYPED)
    const rv = makeRowView(t, 2, viewOrder(t, 2, withSort(withFilter(emptyView(3), 2, ['물']), 1, 1)))
    expect(rv.table.rows.length).toBe(5)
    expect(rv.table.rows[0]).toBe(t.rows[0])
    expect(rv.table.rows[2]).toBe(t.rows[5])
    expect([0, 1, 2, 3, 4].map(rv.toActual)).toEqual([0, 1, 5, 6, 3])
    expect([0, 1, 2, 3, 4, 5, 6].map(rv.toView)).toEqual([0, 1, -1, 4, -1, 2, 3])
    expect(actualRows(rv, 2, 9)).toEqual([5, 6, 3])
  })

  it('정렬한 채 셀 하나를 고치면 파일에서 그 행만 바뀌고 다른 행 순서는 그대로', () => {
    const t = parseTsv(TYPED)
    const rv = makeRowView(t, 2, viewOrder(t, 2, withSort(emptyView(3), 1, 1)))
    // 보이는 3번째 본문 행(vr 4) = 실제 3행(A 9 불)
    const next = editInView(t, rv, (vt) => setCell(vt, 4, 2, '흙'))
    expect(serializeTsv(next)).toBe('#string\tint\tstring\nKey\tN\tKind\nC\t10\t물\nA\t9\t흙\nD\t\t물\nB\t-2\t\nE\t1.5\t불\n')
    expect(changedLines(TYPED, serializeTsv(next))).toEqual([3])
    // 건드리지 않은 행은 같은 객체 (원문 그대로 쓴다)
    expect(next.rows[2]).toBe(t.rows[2])
  })

  it('범위 비우기 · 붙여넣기는 보이는 행에만, 숨은 행은 그대로', () => {
    const t = parseTsv(TYPED)
    const rv = makeRowView(t, 2, viewOrder(t, 2, withFilter(emptyView(3), 2, ['불'])))
    // 보이는 본문: 2 4 5
    const cleared = editInView(t, rv, (vt) => fillRange(vt, { r1: 2, c1: 1, r2: 4, c2: 1 }, '0'))
    expect(changedLines(TYPED, serializeTsv(cleared))).toEqual([2, 4, 5])
    expect(cleared.rows[3]).toBe(t.rows[3])
    const pasted = editInView(t, rv, (vt) => pasteBlock(vt, 3, 0, [['X'], ['Y']]).table)
    expect(pasted.rows[4].cells[0]).toBe('X')
    expect(pasted.rows[5].cells[0]).toBe('Y')
    expect(changedLines(TYPED, serializeTsv(pasted))).toEqual([4, 5])
  })

  it('행 수가 바뀌는 편집은 옮기지 않는다 (표 그대로)', () => {
    const t = parseTsv(TYPED)
    const rv = makeRowView(t, 2, viewOrder(t, 2, withFilter(emptyView(3), 2, ['불'])))
    expect(editInView(t, rv, (vt) => pasteBlock(vt, 4, 0, [['X'], ['Y']]).table)).toBe(t)
    expect(editInView(t, rv, (vt) => vt)).toBe(t)
  })

  it('정렬 · 필터 중의 행 삭제: 이어지지 않은 실제 행들', () => {
    const t = parseTsv(TYPED)
    const d = deleteRowSet(t, [6, 3])
    expect(serializeTsv(d)).toBe('#string\tint\tstring\nKey\tN\tKind\nC\t10\t물\nD\t\t물\nB\t-2\t\n')
    expect(deleteRowSet(t, [])).toBe(t)
  })

  it('Key 중복 검사는 숨긴 행도 본다 — 검증은 늘 파일 전체', () => {
    const t = parseTsv('#string\tstring\nKey\tKind\nA\t물\nA\t불\n')
    const schema = deriveSchema(t, 'X.tsv', [])
    const rv = makeRowView(t, 2, viewOrder(t, 2, withFilter(emptyView(2), 1, ['불'])))
    expect(rv.table.rows.length).toBe(3)
    // 그리드는 실제 표로 검증한다 — 감춘 3행의 A 도 중복으로 걸린다
    expect(validateTable(t, schema).count).toBeGreaterThan(0)
  })
})

describe('열 숨기기 · 열 조작', () => {
  it('숨기기 · 모두 보이기. 모든 열을 숨기지는 않는다', () => {
    const v = hideColumns(emptyView(3), 0, 1)!
    expect(v.hidden).toEqual([0, 1])
    expect(hideColumns(v, 2, 2)).toBeNull()
    expect(showAllColumns(v).hidden).toEqual([])
  })

  it('보이는 열로 옮기기', () => {
    const hidden = new Set([1, 2])
    expect(stepColumn(0, 1, 5, hidden)).toBe(3)
    expect(stepColumn(3, -1, 5, hidden)).toBe(0)
    expect(stepColumn(4, 1, 5, hidden)).toBe(4)
    expect(visibleColumn(1, 1, 5, hidden)).toBe(3)
    expect(visibleColumn(2, -1, 5, hidden)).toBe(0)
    expect(visibleColumn(4, 1, 5, new Set([3, 4]))).toBe(2)
  })

  it('열을 넣고 · 지우고 · 옮기면 정렬 · 필터 · 숨김이 같은 열을 따라간다', () => {
    const v = { sort: { c: 2, dir: 1 as const }, filters: [{ c: 1, excluded: ['x'] }], hidden: [3], width: 4 }
    expect(remapColumns(v, mapInsert(1, 2), 6)).toEqual({ sort: { c: 4, dir: 1 }, filters: [{ c: 3, excluded: ['x'] }], hidden: [5], width: 6 })
    expect(remapColumns(v, mapDelete(1, 1), 3)).toEqual({ sort: { c: 1, dir: 1 }, filters: [], hidden: [2], width: 3 })
    expect(remapColumns(v, mapDelete(2, 1), 3).sort).toBeNull()
    // 0번 열을 맨 끝으로: 1→0, 2→1, 3→2
    expect(remapColumns(v, mapMove(4, 0, 1, 3), 4)).toEqual({ sort: { c: 1, dir: 1 }, filters: [{ c: 0, excluded: ['x'] }], hidden: [2], width: 4 })
  })
})

describe('폭 맞춤', () => {
  it('가장 긴 칸(머리글 포함)에 맞추고 최소 · 최대로 자른다', () => {
    const t = parseTsv('Key\tLong\nA\tabcdefghijklmnopqrstuvwxyz\n')
    expect(fitColumnWidth(t, 0, 56, 840)).toBe(56)
    expect(fitColumnWidth(t, 1, 56, 840)).toBe(Math.round(26 * 7.3 + 18))
    expect(fitColumnWidth(t, 1, 56, 100)).toBe(100)
    expect(fitColumnWidth(parseTsv('가나다라마바사아자차카타파하\n'), 0, 56, 840)).toBe(14 * 13 + 18)
  })
})
