import { describe, expect, it } from 'vitest'
import { applyTsvView, compileWhere, parseTsvViewSpec, resolveViewPath } from './tsvView'
import { parseTsv } from '../tsv/parse'
import { deriveSchema } from '../tsv/schema'

describe('tsv-view 스펙', () => {
  it('스칼라 · 목록 · 블록', () => {
    const s = parseTsvViewSpec(`file: 10-World/Tile/Tile_Table.tsv
columns: [Key, "SurfaceType", MovementCost]
where: TerrainType == "Peak"
sort: -MovementCost
limit: 5
bake: true
template: |
  flowchart LR
    A --> B
`)
    expect(s.file).toBe('10-World/Tile/Tile_Table.tsv')
    expect(s.columns).toEqual(['Key', 'SurfaceType', 'MovementCost'])
    expect(s.where).toBe('TerrainType == "Peak"')
    expect(s.sort).toEqual(['-MovementCost'])
    expect(s.limit).toBe(5)
    expect(s.bake).toBe(true)
    expect(s.template).toBe('flowchart LR\n  A --> B')
    expect(s.warnings).toEqual([])
  })
  it('블록 목록과 모르는 키', () => {
    const s = parseTsvViewSpec('file: a.tsv\nsort:\n  - Key\n  - -N\nfoo: 1\n')
    expect(s.sort).toEqual(['Key', '-N'])
    expect(s.warnings).toEqual(['모르는 옵션: foo'])
  })
})

describe('where 식', () => {
  const row = { Key: 'Peak-Snow', TerrainType: 'Peak', MovementCost: '9', Buildable: 'FALSE', AllowedTerrain: 'Plains, Hill' }
  const t = (src: string) => compileWhere(src)(row)
  it('비교', () => {
    expect(t('TerrainType == "Peak"')).toBe(true)
    expect(t("TerrainType != 'Peak'")).toBe(false)
    expect(t('MovementCost > 5')).toBe(true)
    expect(t('MovementCost >= 10')).toBe(false)
    expect(t('MovementCost < "10"')).toBe(true) // 숫자끼리는 숫자로
  })
  it('논리 · 괄호 · 부정', () => {
    expect(t('TerrainType == "Peak" && MovementCost > 5')).toBe(true)
    expect(t('TerrainType == "Hill" || MovementCost > 5')).toBe(true)
    expect(t('!(TerrainType == "Peak")')).toBe(false)
    expect(t('not Buildable')).toBe(true)
    expect(t('Buildable == false')).toBe(true)
  })
  it('in · 리스트 셀', () => {
    expect(t('TerrainType in ["Peak", "Hill"]')).toBe(true)
    expect(t('TerrainType not in ["Peak"]')).toBe(false)
    expect(t('AllowedTerrain in ["Hill"]')).toBe(true)
    expect(t('AllowedTerrain in ["Mountain"]')).toBe(false)
  })
  it('문법 오류', () => {
    expect(() => compileWhere('TerrainType ==')).toThrow()
    expect(() => compileWhere('(a == 1')).toThrow()
    expect(() => compileWhere('a == "x')).toThrow()
  })
})

describe('적용', () => {
  const table = parseTsv('#string\tenum\tbyte\t\nKey\tTerrain\tCost\t#메모\nA\tPeak\t9\tm\nB\tHill\t3\t\nC\tPeak\t7\t\nD\tPlains\t1\t\n\t\t\t')
  const schema = deriveSchema(table, 'X_Table.tsv', [])
  it('필터 · 정렬 · 열 선택 · limit', () => {
    const r = applyTsvView(parseTsvViewSpec('file: x\nwhere: Terrain == "Peak"\nsort: -Cost\ncolumns: [Key, Cost]'), table, schema)
    expect(r.error).toBeNull()
    expect(r.total).toBe(4)
    expect(r.columns.map((c) => c.name)).toEqual(['Key', 'Cost'])
    expect(r.rows.map((x) => x.cells)).toEqual([['A', '9'], ['C', '7']])
    expect(r.rows.map((x) => x.index)).toEqual([2, 4])
    const lim = applyTsvView(parseTsvViewSpec('file: x\nsort: Cost\nlimit: 2'), table, schema)
    expect(lim.rows.map((x) => x.cells[0])).toEqual(['D', 'B'])
  })
  it('주석 열은 기본 제외, 없는 열은 오류로', () => {
    const r = applyTsvView(parseTsvViewSpec('file: x'), table, schema)
    expect(r.columns.map((c) => c.name)).toEqual(['Key', 'Terrain', 'Cost'])
    const bad = applyTsvView(parseTsvViewSpec('file: x\ncolumns: [Key, Nope]\nwhere: Cost >'), table, schema)
    expect(bad.error).toContain('없는 열: Nope')
    expect(bad.error).toContain('where:')
    expect(bad.rows.length).toBe(4)
  })
})

describe('경로', () => {
  it('리포 상대 · md 기준', () => {
    expect(resolveViewPath('10-World/Tile/Tile_Table.tsv', '10-World/Tile/Tile.md')).toBe('10-World/Tile/Tile_Table.tsv')
    expect(resolveViewPath('./Tile_Table.tsv', '10-World/Tile/Tile.md')).toBe('10-World/Tile/Tile_Table.tsv')
    expect(resolveViewPath('../Road/Road_Field.tsv', '10-World/Tile/Tile.md')).toBe('10-World/Road/Road_Field.tsv')
    expect(resolveViewPath('/a.tsv', 'x.md')).toBe('a.tsv')
  })
})
