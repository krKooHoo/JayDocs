import { describe, expect, it } from 'vitest'
import { csvOpenWarnings, parseCsv, serializeCsv } from './csv'
import { setCell, deleteColumns, insertRows, seedHeaderTable } from './edits'
import { parseTable, sanitizeFor, serializeTable } from './table'
import { deriveSchema } from './schema'

const BOM = '﻿'

describe('CSV 왕복', () => {
  const fixtures: Record<string, string> = {
    'Excel CSV UTF-8 (BOM·CRLF·끝 개행)': `${BOM}이름,점수,메모\r\n홍길동,90,"성실함, 발표 잘함"\r\n김철수,85,\r\n`,
    '따옴표 안 줄바꿈·이중 따옴표': 'Key,Desc\n"a","첫 줄\n둘째 줄"\nb,"그는 ""안녕"" 했다"\n',
    'CRLF 안 칸 줄바꿈은 LF (Excel)': 'k,v\r\n1,"x\ny"\r\n2,z\r\n',
    '끝 개행 없음·빈 칸': 'a,,c\n,,\nx,y,z',
    '행마다 칸 수가 다름': 'a,b\n1\n1,2,3\n',
    '빈 줄': 'a,b\n\n1,2\n',
    '따옴표로 감싼 평범한 칸': '"Key","Name"\n"1","검"\n',
    '빈 파일': '',
  }
  for (const [name, text] of Object.entries(fixtures)) {
    it(`열고 바로 저장하면 바이트 동일 — ${name}`, () => {
      expect(serializeCsv(parseCsv(text))).toBe(text)
    })
  }

  it('따옴표·쉼표·줄바꿈을 칸으로 읽는다', () => {
    const t = parseCsv('Key,Desc\n"a","첫 줄\n둘째 줄"\nb,"그는 ""안녕"" 했다"\n')
    expect(t.rows.map((r) => r.cells)).toEqual([['Key', 'Desc'], ['a', '첫 줄\n둘째 줄'], ['b', '그는 "안녕" 했다']])
    expect(t.width).toBe(2)
    expect(t.eol).toBe('\n')
  })

  it('레코드 끝만 세어 줄바꿈을 정한다 (칸 안 LF 는 무시)', () => {
    const t = parseCsv('k,v\r\n1,"x\ny"\r\n2,z\r\n')
    expect(t.eol).toBe('\r\n')
    expect(t.mixedEol).toBe(false)
  })

  it('칸 하나를 고치면 그 레코드만 바뀐다', () => {
    const text = `${BOM}이름,점수,메모\r\n홍길동,90,"성실함, 발표 잘함"\r\n김철수,85,\r\n`
    const t = setCell(parseCsv(text), 2, 1, '88')
    expect(serializeCsv(t)).toBe(`${BOM}이름,점수,메모\r\n홍길동,90,"성실함, 발표 잘함"\r\n김철수,88,\r\n`)
  })

  it('원래 따옴표로 감싼 칸은 고친 뒤에도 감싼다', () => {
    const t = setCell(parseCsv('"Key","Name"\n"1","검"\n'), 1, 1, '도끼')
    expect(serializeCsv(t)).toBe('"Key","Name"\n"1","도끼"\n')
  })

  it('필요한 칸만 새로 감싼다 (쉼표·따옴표·줄바꿈)', () => {
    let t = parseCsv('a,b,c\n1,2,3\n')
    t = setCell(t, 1, 0, 'x,y')
    t = setCell(t, 1, 1, '말 "따옴"')
    t = setCell(t, 1, 2, '두\n줄')
    expect(serializeCsv(t)).toBe('a,b,c\n"x,y","말 ""따옴""","두\n줄"\n')
  })

  it('고친 레코드는 원래 칸 수를 지킨다 (끝에 값을 넣으면 늘어난다)', () => {
    let t = parseCsv('a,b,c\n1\n')
    expect(serializeCsv(setCell(t, 1, 0, '2'))).toBe('a,b,c\n2\n')
    t = setCell(t, 1, 2, 'z')
    expect(serializeCsv(t)).toBe('a,b,c\n1,,z\n')
  })

  it('새 행은 표 너비만큼, 열을 지우면 모든 행을 다시 쓴다', () => {
    const t = insertRows(parseCsv('a,b\n1,2\n'), 2, 1)
    expect(serializeCsv(setCell(t, 2, 0, '3'))).toBe('a,b\n1,2\n3,\n')
    expect(serializeCsv(deleteColumns(parseCsv('"a",b\n"1",2\n'), 1, 1))).toBe('a\n1\n')
  })

  it('따옴표가 안 맞으면 너그럽게 읽고 경고한다', () => {
    const t = parseCsv('a,"b\n1,2\n')
    expect(t.rows.length).toBe(1)
    expect(t.rows[0].cells).toEqual(['a', 'b\n1,2\n'])
    expect(csvOpenWarnings(t).length).toBe(1)
    const u = parseCsv('a,"b"x,c\n')
    expect(u.rows[0].cells).toEqual(['a', 'bx', 'c'])
    expect(serializeCsv(u)).toBe('a,"b"x,c\n')
  })

  it('빈 CSV: 머리글 행부터 시작해 LF·끝 개행 없이 쓴다', () => {
    let t = seedHeaderTable(parseCsv(''))
    t = setCell(setCell(t, 0, 0, '이름'), 1, 0, '홍길동')
    expect(serializeCsv(t)).toBe('이름,,\n홍길동,,')
  })

  it('경로로 형식을 고른다', () => {
    expect(parseTable('a,b\n', 'x/y.csv').format).toBe('csv')
    expect(parseTable('a\tb\n', 'x/y.tsv').format).toBeUndefined()
    expect(serializeTable(parseTable('a\t"b"\n', 'x.tsv'))).toBe('a\t"b"\n')
  })

  it('타입 행 없는 CSV 는 첫 줄이 머리글 (TSV 는 그대로)', () => {
    const s = deriveSchema(parseCsv('이름,점수\n홍길동,90\n'), '점수.csv', [])
    expect(s.headerRows).toBe(1)
    expect(s.columns.map((c) => c.name)).toEqual(['이름', '점수'])
    expect(s.typed).toBe(false)
    expect(deriveSchema(parseTable('이름\t점수\n홍길동\t90\n', '점수.tsv'), '점수.tsv', []).headerRows).toBe(0)
    const typed = deriveSchema(parseCsv('#string,byte\nKey,Score\na,1\n'), 'X_Table.csv', [])
    expect([typed.typed, typed.headerRows, typed.prefix]).toEqual([true, 2, 'X'])
  })

  it('셀 값 정리: TSV 는 줄바꿈·탭을 공백으로, CSV 는 그대로', () => {
    expect(sanitizeFor(undefined, 'a\nb\tc')).toEqual(['a b c', true])
    expect(sanitizeFor('csv', 'a\r\nb\tc')).toEqual(['a\nb\tc', false])
  })
})
