import { describe, expect, it } from 'vitest'
import { parseTsv } from './parse'
import { parseFieldBlocks } from './field'
import { deriveSchema, stabilizeSchema } from './schema'
import { checkValue, validateTable } from './validate'
import { setCell } from './edits'

const FIELD = parseFieldBlocks('Tile_Field.tsv', parseTsv('TerrainType\t설명\nPlains\t평지\nHill\t언덕\n\nTileDef\t설명\nKey\t고유 키\nTerrainType\t지형\n'))
const BASE = '#string\tenum\tbyte\nKey\tTerrainType\tCost\nA\tPlains\t1\nB\tHill\t2\n'

describe('stabilizeSchema — 다시 유도해도 같은 열은 같은 객체', () => {
  it('셀 값만 바뀌면 스키마 자체를 그대로 돌려준다', () => {
    const t1 = parseTsv(BASE)
    const s1 = deriveSchema(t1, 'Tile_Table.tsv', [FIELD])
    const t2 = setCell(t1, 2, 2, '7')
    const s2 = deriveSchema(t2, 'Tile_Table.tsv', [FIELD])
    expect(s2).not.toBe(s1) // 유도는 새 객체를 만든다
    const st = stabilizeSchema(s1, s2)
    expect(st).toBe(s1)
    expect(st.columns[1]).toBe(s1.columns[1])
  })

  it('바뀐 열만 새 객체, 나머지는 이전 것 (내용은 새 유도와 같다)', () => {
    const t1 = parseTsv(BASE)
    const s1 = deriveSchema(t1, 'Tile_Table.tsv', [FIELD])
    const t2 = setCell(t1, 0, 2, 'uint') // 타입 행에서 Cost 열의 타입이 바뀜
    const s2 = deriveSchema(t2, 'Tile_Table.tsv', [FIELD])
    const st = stabilizeSchema(s1, s2)
    expect(st).not.toBe(s1)
    expect(st.columns[0]).toBe(s1.columns[0])
    expect(st.columns[1]).toBe(s1.columns[1])
    expect(st.columns[2]).toBe(s2.columns[2])
    expect(st.columns[2].type).toBe('uint')
    expect(st).toEqual(s2)
  })

  it('열에 있는 값을 후보로 쓰는 enum 은 새 값이 생기면 새 객체', () => {
    const t1 = parseTsv(BASE)
    const s1 = deriveSchema(t1, 'Tile_Table.tsv', []) // Field 없음 → 열에 있는 값
    const t2 = setCell(t1, 2, 1, 'Peak')
    const st = stabilizeSchema(s1, deriveSchema(t2, 'Tile_Table.tsv', []))
    expect(st.columns[1]).not.toBe(s1.columns[1])
    expect(st.columns[1].enumValues).toEqual(['Hill', 'Peak'])
  })

  it('열 수가 달라지면 이전 것과 섞지 않는다', () => {
    const t1 = parseTsv(BASE)
    const s1 = deriveSchema(t1, 'Tile_Table.tsv', [FIELD])
    const t2 = parseTsv('#string\tenum\nKey\tTerrainType\nA\tPlains\n')
    const s2 = deriveSchema(t2, 'Tile_Table.tsv', [FIELD])
    const st = stabilizeSchema(s1, s2)
    expect(st.columns.length).toBe(2)
    expect(st).toEqual(s2)
    expect(stabilizeSchema(null, s2)).toBe(s2)
  })
})

describe('enum 검증 — 허용값 Set 을 열마다 한 번만 만들어도 결과는 같다', () => {
  it('허용 · 불허 · 리스트 · 빈 칸', () => {
    const t = parseTsv('#string\tenum\nKey\tTerrainType\nA\tPlains\nB\tPeak\nC\tPlains, Hill\nD\tPlains, Moon\nE\t\n')
    const s = deriveSchema(t, 'Tile_Table.tsv', [FIELD])
    expect(s.columns[1].list).toBe(true)
    const v = validateTable(t, s)
    expect([...v.issues.entries()].map(([k, m]) => [Math.floor(k / t.width), m])).toEqual([
      [3, '허용되지 않은 값: Peak'],
      [5, '허용되지 않은 값: Moon'],
    ])
    expect(checkValue(s.columns[1], 'Hill')).toBeNull()
    expect(checkValue(s.columns[1], 'Moon')).toBe('허용되지 않은 값: Moon')
  })

  it('Field 가 다시 유도돼 enumValues 가 바뀌면 새 허용값으로 검사한다', () => {
    const t = parseTsv('#string\tenum\nKey\tTerrainType\nA\tPeak\n')
    const s1 = deriveSchema(t, 'Tile_Table.tsv', [FIELD])
    expect(validateTable(t, s1).count).toBe(1)
    const field2 = parseFieldBlocks('Tile_Field.tsv', parseTsv('TerrainType\t설명\nPlains\t평지\nPeak\t산\n'))
    const s2 = deriveSchema(t, 'Tile_Table.tsv', [field2])
    expect(validateTable(t, s2).count).toBe(0)
  })
})
