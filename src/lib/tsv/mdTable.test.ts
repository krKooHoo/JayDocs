import { describe, expect, it } from 'vitest'
import { parseMarkdownTable, splitPipeRow } from './mdTable'
import { pasteHeadedBlock } from './edits'
import { parseTable, serializeTable } from './table'

describe('마크다운 표 읽기', () => {
  it('머리글 · 구분 줄 · 행', () => {
    const t = parseMarkdownTable('| Key | Name |\n|---|:---:|\n| A | 가 |\n| B | 나 |\n')
    expect(t).toEqual({ header: ['Key', 'Name'], rows: [['A', '가'], ['B', '나']] })
  })

  it('앞뒤 | 가 없어도, CRLF 여도', () => {
    expect(parseMarkdownTable('a | b\r\n--- | ---\r\n1 | 2')).toEqual({ header: ['a', 'b'], rows: [['1', '2']] })
  })

  it('\\| 는 글자 |, <br> 는 칸 안 줄바꿈', () => {
    const t = parseMarkdownTable('| x | y |\n|-|-|\n| a \\| b | 첫<br>둘 |')
    expect(t?.rows).toEqual([['a | b', '첫\n둘']])
    expect(splitPipeRow('| a \\| b |')).toEqual(['a | b'])
  })

  it('칸 수는 머리글에 맞춘다 (GFM)', () => {
    const t = parseMarkdownTable('| a | b |\n|---|---|\n| 1 |\n| 1 | 2 | 3 |')
    expect(t?.rows).toEqual([['1', ''], ['1', '2']])
  })

  it('bake 주석 줄과 빈 줄은 건너뛴다', () => {
    const t = parseMarkdownTable('<!-- tsv-view:baked -->\n\n| a |\n|---|\n| 1 |\n<!-- /tsv-view -->\n')
    expect(t).toEqual({ header: ['a'], rows: [['1']] })
  })

  it('표가 아니면 null', () => {
    expect(parseMarkdownTable('a | b')).toBeNull() // 구분 줄 없음
    expect(parseMarkdownTable('a\tb\n1\t2')).toBeNull() // Sheets TSV
    expect(parseMarkdownTable('| a | b |\n|---|\n| 1 | 2 |')).toBeNull() // 구분 칸 수가 다름
    expect(parseMarkdownTable('| a |\n| b |')).toBeNull() // 둘째 줄이 구분 줄이 아님
    expect(parseMarkdownTable('# 제목\n| a |\n|---|')).toBeNull() // 표 밖 글이 섞임
  })
})

const typed = '#string\tstring\nKey\tName\nA\t가\n'

describe('머리글 있는 표 붙여넣기', () => {
  const block = { header: ['Key', 'Name', 'Cost'], rows: [['X', '엑스', '3'], ['Y', '와이', '4']] }

  it('머리글 행에 붙이면 머리글·데이터를 그 자리부터, 넘치는 열은 늘리고 타입은 string', () => {
    const t = parseTable(typed, 'x.tsv')
    const p = pasteHeadedBlock(t, 1, 0, block, { headerRow: 1, typeRow: 0, expand: true })
    expect(p.addedCols).toBe(1)
    expect(p.addedRows).toBe(1)
    expect(p.range).toEqual({ r1: 1, c1: 0, r2: 3, c2: 2 })
    expect(serializeTable(p.table)).toBe('#string\tstring\tstring\nKey\tName\tCost\nX\t엑스\t3\nY\t와이\t4\n')
  })

  it('본문에 붙이면 데이터만 그 행부터, 머리글은 빈 머리글 칸만 채운다', () => {
    const t = parseTable(typed, 'x.tsv')
    const p = pasteHeadedBlock(t, 2, 0, { header: ['다른키', '다른이름', 'Cost'], rows: block.rows }, { headerRow: 1, typeRow: 0, expand: true })
    expect(serializeTable(p.table)).toBe('#string\tstring\tstring\nKey\tName\tCost\nX\t엑스\t3\nY\t와이\t4\n')
    expect(p.range).toEqual({ r1: 2, c1: 0, r2: 3, c2: 2 })
  })

  it('expand=false 면 예전처럼 잘라 낸다', () => {
    const t = parseTable(typed, 'x.tsv')
    const p = pasteHeadedBlock(t, 1, 0, block, { headerRow: 1, typeRow: 0, expand: false })
    expect(p.addedCols).toBe(0)
    expect(p.clippedCols).toBe(1)
    expect(serializeTable(p.table)).toBe('#string\tstring\nKey\tName\nX\t엑스\nY\t와이\n')
  })

  it('머리글 행이 없는 TSV 는 머리글도 한 행으로', () => {
    const t = parseTable('a\tb\n', 'x.tsv')
    const p = pasteHeadedBlock(t, 1, 0, { header: ['h1', 'h2'], rows: [['1', '2']] }, { headerRow: -1, typeRow: -1, expand: true })
    expect(serializeTable(p.table)).toBe('a\tb\nh1\th2\n1\t2\n')
  })

  it('빈 CSV 는 머리글이 첫 줄이 된다', () => {
    const t = parseTable('', 'x.csv')
    const p = pasteHeadedBlock(t, 0, 0, { header: ['이름', '점수'], rows: [['홍길동', '90']] }, { headerRow: 0, typeRow: -1, expand: true })
    expect(p.table.rows.map((r) => r.cells)).toEqual([['이름', '점수'], ['홍길동', '90']])
  })

  it('CSV 본문 중간 열에 붙이면 그 열부터, 새 열 머리글은 md 머리글에서', () => {
    const t = parseTable('이름,점수\r\n홍길동,90\r\n', 'x.csv')
    const p = pasteHeadedBlock(t, 1, 1, { header: ['점수', '반'], rows: [['85', '1']] }, { headerRow: 0, typeRow: -1, expand: true })
    expect(serializeTable(p.table)).toBe('이름,점수,반\r\n홍길동,85,1\r\n')
  })
})
