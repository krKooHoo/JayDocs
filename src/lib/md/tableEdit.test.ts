import { describe, expect, it } from 'vitest'
import { appendRowChange, cellChange, escapeCell, parseTable, unescapeCell, type TextChange } from './tableEdit'

const apply = (src: string, c: TextChange | null) => (c ? src.slice(0, c.from) + c.insert + src.slice(c.to) : src)

describe('parseTable', () => {
  it('머리글 · 본문 칸과 정렬을 읽는다 (구분선 줄은 뺀다)', () => {
    const t = parseTable('| 이름 | 값 | 비고 |\n|:---|---:|:-:|\n| a | 1 | x |\n| b | 2 |  |')!
    expect(t.cols).toBe(3)
    expect(t.align).toEqual(['left', 'right', 'center'])
    expect(t.rows.map((r) => r.cells.map((c) => c.raw))).toEqual([['이름', '값', '비고'], ['a', '1', 'x'], ['b', '2', '']])
  })
  it('앞뒤 `|` 가 없는 표', () => {
    const t = parseTable('a | b\n--|--\n1 | 2')!
    expect(t.rows.map((r) => r.cells.map((c) => c.raw))).toEqual([['a', 'b'], ['1', '2']])
    expect(t.rows[1].closed).toBe(false)
  })
  it('`\\|` 는 칸을 나누지 않는다', () => {
    const t = parseTable('| a | b |\n|---|---|\n| x \\| y | z |')!
    expect(t.rows[1].cells.map((c) => c.raw)).toEqual(['x \\| y', 'z'])
  })
  it('구분선이 없으면 표가 아니다', () => {
    expect(parseTable('| a | b |\n| 1 | 2 |')).toBeNull()
  })
})

describe('cellChange', () => {
  const src = '| 이름 | 값 |\n|------|----|\n| 검   | 10 |\n| 활 |  |'
  const t = parseTable(src)!
  it('칸 글자만 바꾸고 다른 칸의 공백은 둔다', () => {
    expect(apply(src, cellChange(t, 1, 0, '창'))).toBe('| 이름 | 값 |\n|------|----|\n| 창   | 10 |\n| 활 |  |')
  })
  it('머리글도 고친다', () => {
    expect(apply(src, cellChange(t, 0, 1, '공격력'))).toBe('| 이름 | 공격력 |\n|------|----|\n| 검   | 10 |\n| 활 |  |')
  })
  it('빈 칸에 넣으면 앞뒤 공백을 하나씩', () => {
    expect(apply(src, cellChange(t, 2, 1, '7'))).toBe('| 이름 | 값 |\n|------|----|\n| 검   | 10 |\n| 활 | 7 |')
  })
  it('칸을 비우기', () => {
    expect(apply(src, cellChange(t, 1, 1, ''))).toBe('| 이름 | 값 |\n|------|----|\n| 검   |  |\n| 활 |  |')
  })
  it('`|` 를 넣으면 이스케이프한다', () => {
    const out = apply(src, cellChange(t, 1, 0, 'a|b'))
    expect(parseTable(out)!.rows[1].cells.map((c) => unescapeCell(c.raw))).toEqual(['a|b', '10'])
  })
  it('줄에 없는 칸은 줄 끝에 덧붙인다', () => {
    const s = '| a | b | c |\n|---|---|---|\n| 1 |'
    expect(apply(s, cellChange(parseTable(s)!, 1, 2, 'z'))).toBe('| a | b | c |\n|---|---|---|\n| 1 |  | z |')
    const open = 'a | b\n--|--\n1'
    expect(apply(open, cellChange(parseTable(open)!, 1, 1, 'z'))).toBe('a | b\n--|--\n1 | z |')
  })
  it('같은 글자면 변경이 없다', () => {
    expect(cellChange(t, 1, 1, '10')).toBeNull()
  })
  it('표 밖 칸은 무시', () => {
    expect(cellChange(t, 9, 0, 'x')).toBeNull()
    expect(cellChange(t, 1, 5, 'x')).toBeNull()
  })
})

describe('appendRowChange', () => {
  it('열 수만큼 빈 칸인 행을 끝에 붙인다', () => {
    const s = '| a | b |\n|---|---|\n| 1 | 2 |'
    const out = apply(s, appendRowChange(parseTable(s)!))
    expect(out).toBe('| a | b |\n|---|---|\n| 1 | 2 |\n|  |  |')
    expect(parseTable(out)!.rows).toHaveLength(3)
  })
})

describe('escapeCell', () => {
  it('줄바꿈은 공백으로, 이미 이스케이프된 `|` 는 그대로', () => {
    expect(escapeCell('a\nb')).toBe('a b')
    expect(escapeCell('a\\|b')).toBe('a\\|b')
    expect(escapeCell('a|b')).toBe('a\\|b')
  })
})
