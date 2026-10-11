import { describe, expect, it } from 'vitest'
import { diffTables } from './diff'
import { parseTsv } from './parse'
import { deriveSchema } from './schema'

describe('표 diff', () => {
  it('Key 로 맞춘다: 변경 · 추가 · 삭제 · 순서 바뀜은 무시', () => {
    const a = parseTsv('#string\tbyte\nKey\tN\nA\t1\nB\t2\nC\t3')
    const b = parseTsv('#string\tbyte\nKey\tN\nC\t3\nA\t9\nD\t4')
    const d = diffTables(a, b, deriveSchema(b, 'X_Table.tsv', []))
    expect(d.keyed).toBe(true)
    expect(d.changed).toBe(1)
    expect(d.added).toBe(1)
    expect(d.removed).toBe(1)
    const ch = d.rows.find((r) => r.kind === 'changed')!
    expect(ch.key).toBe('A')
    expect(ch.r).toBe(3)
    expect(ch.cells).toEqual([{ c: 1, name: 'N', before: '1', after: '9' }])
    expect(d.rows.find((r) => r.kind === 'added')?.key).toBe('D')
    expect(d.rows.find((r) => r.kind === 'removed')?.key).toBe('B')
  })
  it('헤더가 바뀌면 (헤더) 항목으로', () => {
    const a = parseTsv('#string\tbyte\nKey\tN\nA\t1')
    const b = parseTsv('#string\tuint\nKey\tCount\nA\t1')
    const d = diffTables(a, b, deriveSchema(b, 'X_Table.tsv', []))
    expect(d.rows.map((r) => r.key)).toEqual(['(타입 행)', '(헤더)'])
  })
  it('Key 가 없으면 행 번호로', () => {
    const a = parseTsv('TileDef\t설명\nKey\t키\nName\t이름')
    const b = parseTsv('TileDef\t설명\nKey\t고유 키\nName\t이름\nExtra\t추가')
    const d = diffTables(a, b, deriveSchema(b, 'Tile_Field.tsv', []))
    expect(d.keyed).toBe(false)
    expect(d.rows.map((r) => [r.kind, r.key])).toEqual([['changed', '2행'], ['added', '4행']])
  })
})
