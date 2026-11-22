import { describe, expect, it } from 'vitest'
import { NEW_TABLE, appendRowChange, applyChanges, cellAtOffset, cellCaret, cellChange, escapeCell, parseTable, tableOpChanges, unescapeCell, type TableOp, type TextChange } from './tableEdit'

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

describe('구조 편집 (H9)', () => {
  const run = (src: string, op: TableOp, row: number, col: number) => {
    const r = tableOpChanges(src, op, row, col)
    return r && { text: applyChanges(src, r.changes), next: r.next }
  }
  const cells = (src: string) => parseTable(src)!.rows.map((r) => r.cells.map((c) => c.raw))
  const src = '| 이름 | 값 |\n|:---|---:|\n| 검 | 10 |\n| 활 | 5 |'

  it('아래에 행 — 머리글에서는 본문 첫 행, 다른 줄은 그대로', () => {
    expect(run(src, 'rowBelow', 1, 1)).toEqual({ text: '| 이름 | 값 |\n|:---|---:|\n| 검 | 10 |\n|  |  |\n| 활 | 5 |', next: { row: 2, col: 1 } })
    expect(run(src, 'rowBelow', 0, 0)!.text).toBe('| 이름 | 값 |\n|:---|---:|\n|  |  |\n| 검 | 10 |\n| 활 | 5 |')
  })
  it('오른쪽에 열 — 구분선에는 ---, 정렬 · 다른 칸은 그대로', () => {
    const r = run(src, 'colRight', 2, 0)!
    expect(r.text).toBe('| 이름 |  | 값 |\n|:---| --- |---:|\n| 검 |  | 10 |\n| 활 |  | 5 |')
    expect(r.next).toEqual({ row: 2, col: 1 })
    expect(parseTable(r.text)!.align).toEqual(['left', null, 'right'])
    expect(run(src, 'colRight', 0, 1)!.text).toBe('| 이름 | 값 |  |\n|:---|---:| --- |\n| 검 | 10 |  |\n| 활 | 5 |  |')
  })
  it('앞뒤 `|` 가 없는 표 · 모자란 칸이 있는 줄', () => {
    const open = 'a | b\n--|--\n1 | 2\n3'
    const r = run(open, 'colRight', 1, 1)!.text
    expect(r).toBe('a | b |  |\n--|-- | --- |\n1 | 2 |  |\n3')
    expect(cells(r)).toEqual([['a', 'b', ''], ['1', '2', ''], ['3']])
  })
  it('행 지우기 — 머리글은 못 지우고, 마지막 행이면 위 행으로', () => {
    expect(run(src, 'deleteRow', 0, 0)).toBeNull()
    expect(run(src, 'deleteRow', 2, 1)).toEqual({ text: '| 이름 | 값 |\n|:---|---:|\n| 검 | 10 |', next: { row: 1, col: 1 } })
    expect(run(src, 'deleteRow', 1, 0)!.text).toBe('| 이름 | 값 |\n|:---|---:|\n| 활 | 5 |')
  })
  it('열 지우기 — 하나 남은 열은 못 지우고, `|` 가 다 사라지면 감싼다', () => {
    expect(run(src, 'deleteCol', 1, 0)).toEqual({ text: '| 값 |\n|---:|\n| 10 |\n| 5 |', next: { row: 1, col: 0 } })
    expect(run(src, 'deleteCol', 1, 1)!.text).toBe('| 이름 |\n|:---|\n| 검 |\n| 활 |')
    expect(run('| a |\n|---|\n| 1 |', 'deleteCol', 0, 0)).toBeNull()
    expect(run('a | b\n--|--\n1 | 2', 'deleteCol', 1, 0)!.text).toBe('| b |\n| -- |\n| 2 |')
    expect(run('a | b\n--|--\n1 | 2', 'deleteCol', 1, 1)!.text).toBe('| a |\n| -- |\n| 1 |')
  })
  it('넣고 지우면 원래대로', () => {
    const added = run(src, 'colRight', 1, 0)!.text
    expect(run(added, 'deleteCol', 1, 1)!.text).toBe(src)
    const row = run(src, 'rowBelow', 1, 0)!.text
    expect(run(row, 'deleteRow', 2, 0)!.text).toBe(src)
  })
})

describe('커서 ↔ 칸', () => {
  const src = '| 이름 | 값 |\n|---|---|\n| 검 | 10 |'
  it('오프셋 → (row, col). 구분선은 머리글', () => {
    expect(cellAtOffset(src, 2)).toEqual({ row: 0, col: 0 })
    expect(cellAtOffset(src, 8)).toEqual({ row: 0, col: 1 })
    expect(cellAtOffset(src, src.indexOf('---') + 5)).toEqual({ row: 0, col: 1 })
    expect(cellAtOffset(src, src.indexOf('10'))).toEqual({ row: 1, col: 1 })
    expect(cellAtOffset(src, src.length)).toEqual({ row: 1, col: 1 })
  })
  it('칸의 커서 자리 — 글자 끝, 빈 칸은 `|` 뒤 한 칸', () => {
    expect(cellCaret(src, 1, 1)).toBe(src.indexOf('10') + 2)
    expect(cellCaret(NEW_TABLE, 0, 0)).toBe(2)
  })
  it('`|||` 표는 2열 · 본문 1행', () => {
    expect(parseTable(NEW_TABLE)!.rows.map((r) => r.cells.map((c) => c.raw))).toEqual([['', ''], ['', '']])
  })
})

describe('escapeCell', () => {
  it('줄바꿈은 공백으로, 이미 이스케이프된 `|` 는 그대로', () => {
    expect(escapeCell('a\nb')).toBe('a b')
    expect(escapeCell('a\\|b')).toBe('a\\|b')
    expect(escapeCell('a|b')).toBe('a\\|b')
  })
})
