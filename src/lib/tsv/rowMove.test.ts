import { describe, expect, it } from 'vitest'
import { parseTsv } from './parse'
import { serializeTsv } from './serialize'
import { parseTable, serializeTable } from './table'
import { canMoveRows, duplicateRows, moveRows } from './edits'

/** 두 텍스트에서 다른 줄 번호 (줄 수가 같아야 한다) */
function changedLines(a: string, b: string): number[] {
  const x = a.split(/\r?\n/)
  const y = b.split(/\r?\n/)
  expect(y.length).toBe(x.length)
  return x.map((line, i) => (line === y[i] ? -1 : i)).filter((i) => i >= 0)
}

const TYPED = '#string\tbyte\tstring\nKey\tN\tNote\nA\t1\t가\nB\t2\t나\nC\t3\t다\nD\t4\t라\n'

describe('행 옮기기 (DESIGN §42 K5)', () => {
  it('한 행을 아래로: 그 행과 자리를 바꾼 행만 바뀌고, 되돌리면 바이트가 같다', () => {
    const t = parseTsv(TYPED)
    const m = moveRows(t, 3, 3, 1)
    expect(serializeTsv(m)).toBe('#string\tbyte\tstring\nKey\tN\tNote\nA\t1\t가\nC\t3\t다\nB\t2\t나\nD\t4\t라\n')
    expect(changedLines(TYPED, serializeTsv(m))).toEqual([3, 4])
    expect(serializeTsv(moveRows(m, 4, 4, -1))).toBe(TYPED)
  })

  it('행 객체를 그대로 옮긴다 — 원문(raw)이 남고 건드리지 않은 행은 같은 객체', () => {
    const t = parseTsv(TYPED)
    const m = moveRows(t, 2, 2, 1)
    expect(m.rows[3]).toBe(t.rows[2])
    expect(m.rows[2]).toBe(t.rows[3])
    expect(m.rows[3].raw).toBe('A\t1\t가')
    for (const r of [0, 1, 4, 5]) expect(m.rows[r]).toBe(t.rows[r])
  })

  it('여러 행을 위로: 고른 행과 그 위의 한 행만 바뀐다', () => {
    const t = parseTsv(TYPED)
    const m = moveRows(t, 3, 4, -1)
    expect(serializeTsv(m)).toBe('#string\tbyte\tstring\nKey\tN\tNote\nB\t2\t나\nC\t3\t다\nA\t1\t가\nD\t4\t라\n')
    expect(changedLines(TYPED, serializeTsv(m))).toEqual([2, 3, 4])
    expect(serializeTsv(moveRows(m, 2, 3, 1))).toBe(TYPED)
  })

  it('CRLF · BOM · 끝 개행 없음: 마지막 행을 위로 옮겨도 그 두 줄만, 되돌리면 그대로', () => {
    const src = '﻿Key\tN\r\nA\t1\r\nB\t2\r\nC\t3'
    const t = parseTsv(src)
    const m = moveRows(t, 3, 3, -1)
    const out = serializeTsv(m)
    expect(out).toBe('﻿Key\tN\r\nA\t1\r\nC\t3\r\nB\t2')
    expect(changedLines(src, out)).toEqual([2, 3])
    expect(serializeTsv(moveRows(m, 2, 2, 1))).toBe(src)
  })

  it('CSV: 따옴표 · 칸 안 줄바꿈이 든 레코드도 원문 그대로 옮긴다', () => {
    const src = '﻿이름,메모\r\n사과,"쉼표, 든 칸"\r\n소금,"두 줄\r\n메모"\r\n당근,\r\n'
    const t = parseTable(src, 'a.csv')
    const m = moveRows(t, 2, 2, -1)
    expect(serializeTable(m)).toBe('﻿이름,메모\r\n소금,"두 줄\r\n메모"\r\n사과,"쉼표, 든 칸"\r\n당근,\r\n')
    expect(serializeTable(moveRows(m, 1, 1, 1))).toBe(src)
  })

  it('끝에서는 아무것도 하지 않는다 (같은 객체)', () => {
    const t = parseTsv(TYPED)
    expect(moveRows(t, 5, 5, 1)).toBe(t)
    expect(moveRows(t, 0, 0, -1)).toBe(t)
    expect(moveRows(t, 4, 9, 1)).toBe(t)
  })
})

describe('canMoveRows — 머리글 · _Field 블록', () => {
  const t = parseTsv(TYPED)
  const plain = { headerRows: 2, field: false }

  it('본문 행은 옮긴다', () => {
    expect(canMoveRows(t, 3, 3, -1, plain)).toBeNull()
    expect(canMoveRows(t, 2, 4, 1, plain)).toBeNull()
  })
  it('머리글 · 타입 행 위로는 옮기지 않는다 (조용히)', () => {
    expect(canMoveRows(t, 2, 2, -1, plain)).toBe('')
  })
  it('머리글 · 타입 행을 고르면 이유를 알린다', () => {
    expect(canMoveRows(t, 1, 2, 1, plain)).toMatch(/머리글/)
    expect(canMoveRows(t, 0, 0, 1, plain)).toMatch(/머리글/)
  })
  it('표 끝 · 표 밖은 조용히', () => {
    expect(canMoveRows(t, 5, 5, 1, plain)).toBe('')
    expect(canMoveRows(t, 6, 6, -1, plain)).toBe('')
  })

  const FIELD = 'ItemDef\t설명\nKey\t열쇠\nName\t이름\nCost\t값\n\nRarity\t설명\nCommon\t흔함\nRare\t드묾\n'
  const f = parseTsv(FIELD)
  const field = { headerRows: 0, field: true }

  it('_Field: 블록 안의 항목은 옮긴다', () => {
    expect(canMoveRows(f, 2, 2, -1, field)).toBeNull()
    expect(canMoveRows(f, 1, 2, 1, field)).toBeNull()
    expect(changedLines(FIELD, serializeTsv(moveRows(f, 2, 2, -1)))).toEqual([1, 2])
  })
  it('_Field: 블록 이름 줄 · 빈 줄을 넘지 않는다 (조용히)', () => {
    expect(canMoveRows(f, 1, 1, -1, field)).toBe('') // 위는 블록 이름
    expect(canMoveRows(f, 3, 3, 1, field)).toBe('') // 아래는 빈 줄
    expect(canMoveRows(f, 6, 6, -1, field)).toBe('') // 다음 블록의 첫 항목
  })
  it('_Field: 블록 이름 줄 · 빈 줄을 고르면 이유를 알린다', () => {
    expect(canMoveRows(f, 0, 0, 1, field)).toMatch(/블록/)
    expect(canMoveRows(f, 4, 4, -1, field)).toMatch(/블록/)
    expect(canMoveRows(f, 3, 6, 1, field)).toMatch(/블록/)
  })
})

describe('행 복제 (Shift+Alt+↓)', () => {
  it('복제본만 새 줄이고 나머지는 그대로', () => {
    const t = parseTsv(TYPED)
    const d = duplicateRows(t, 3, 1)
    const out = serializeTsv(d).split('\n')
    expect(out[3]).toBe('B\t2\t나')
    expect(out[4]).toBe('B\t2\t나')
    expect(d.rows[3]).toBe(t.rows[3])
  })
})
