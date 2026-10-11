import { describe, expect, it } from 'vitest'
import { compileExpr, parseExpr, evaluate, format } from './expr'
import { applyCalc, calcLookupFiles, computeCalc, parseCalcRules, siblingCalcPath } from './calc'
import { parseTsv } from '../tsv/parse'
import { deriveSchema } from '../tsv/schema'
import { serializeTsv } from '../tsv/serialize'

const row = (vals: Record<string, string>) => ({ get: (n: string) => vals[n] })
const ev = (src: string, vals: Record<string, string> = {}) => compileExpr(src)(row(vals))

describe('계산식', () => {
  it('사칙 · 우선순위 · 단항 · 괄호', () => {
    expect(ev('1 + 2 * 3')).toBe('7')
    expect(ev('(1 + 2) * 3')).toBe('9')
    expect(ev('-4 + 10 % 3')).toBe('-3')
    expect(ev('7 / 2')).toBe('3.5')
    expect(ev('0.1 + 0.2')).toBe('0.3')
  })
  it('열 참조 · 빈 셀은 0 · 문자열 더하기', () => {
    expect(ev('=MovementCost * 2 + 1', { MovementCost: '9' })).toBe('19')
    expect(ev('Empty + 1', { Empty: '' })).toBe('1')
    expect(ev('Key + "-X"', { Key: 'Peak' })).toBe('Peak-X')
    expect(ev('concat(Key, "[", N, "]")', { Key: 'Cow', N: '20' })).toBe('Cow[20]')
  })
  it('비교 · 논리 · 조건 · if', () => {
    expect(ev('TerrainType == "Peak" ? 9 : 1', { TerrainType: 'Peak' })).toBe('9')
    expect(ev('if(Buildable, 1, 0)', { Buildable: 'TRUE' })).toBe('1')
    expect(ev('if(Buildable, 1, 0)', { Buildable: 'FALSE' })).toBe('0')
    expect(ev('N > 5 && N < 10', { N: '7' })).toBe('TRUE')
    expect(ev('!(N >= 10) || false', { N: '7' })).toBe('TRUE')
    expect(ev('"10" > "9"')).toBe('TRUE') // 숫자로 읽히면 숫자 비교
  })
  it('함수', () => {
    expect(ev('min(3, 1, 2)')).toBe('1')
    expect(ev('max(N, 5)', { N: '3' })).toBe('5')
    expect(ev('round(2.345, 2)')).toBe('2.35')
    expect(ev('floor(2.7) + ceil(2.1) + abs(-1)')).toBe('6')
    expect(ev('len("abc") + count("Plains, Hill")')).toBe('5')
    expect(ev('contains(Allowed, "Hill")', { Allowed: 'Plains, Hill' })).toBe('TRUE')
    expect(ev('upper("a") + lower("B") + trim(" c ")')).toBe('Abc')
    expect(ev('num("x") + num("4")')).toBe('4')
  })
  it('lookup', () => {
    const fn = compileExpr('lookup("20-Settlement/District/District_Table.tsv", DistrictKey, "BuildingLimit") * 2')
    expect(fn.lookupFiles).toEqual(['20-Settlement/District/District_Table.tsv'])
    expect(fn.columns).toEqual(['DistrictKey'])
    const v = fn({ get: () => 'Stronghold', lookup: (_file, key, col) => (key === 'Stronghold' && col === 'BuildingLimit' ? '10' : '') })
    expect(v).toBe('20')
  })
  it('오류', () => {
    expect(() => parseExpr('1 +')).toThrow()
    expect(() => parseExpr('foo(')).toThrow()
    expect(() => ev('Nope + 1', {})).toThrow('없는 열')
    expect(() => ev('1 / 0')).toThrow('0 으로')
    expect(() => ev('"a" * 2')).toThrow('숫자가 아닙니다')
    expect(() => ev('what(1)')).toThrow('모르는 함수')
    expect(format(evaluate(parseExpr('2 * 3'), row({})))).toBe('6')
  })
})

describe('Calc 파일', () => {
  const calc = parseTsv('Target\tFormula\t#메모\nMovementCost\t=if(TerrainType == "Peak", 9, 1)\t지형별\nFoodCost[Peak-Snow]\t=MovementCost * 2\t\n#Off\t=1\t주석\n\t\t\nBad\t\t')
  it('규칙 읽기', () => {
    const { rules, errors } = parseCalcRules(calc)
    expect(rules.map((r) => [r.target, r.key, r.formula])).toEqual([
      ['MovementCost', null, '=if(TerrainType == "Peak", 9, 1)'],
      ['FoodCost', 'Peak-Snow', '=MovementCost * 2'],
    ])
    expect(errors.length).toBe(1)
    expect(siblingCalcPath('10-World/Tile/Tile_Table.tsv')).toBe('10-World/Tile/Tile_Calc.tsv')
  })
  it('계산 · stale · 적용 (규칙이 규칙 결과를 읽는다)', () => {
    const table = parseTsv('#string\tenum\tbyte\tbyte\nKey\tTerrainType\tMovementCost\tFoodCost\nPeak-Snow\tPeak\t1\t1\nPlains-Grass\tPlains\t1\t1\n\t\t\t')
    const schema = deriveSchema(table, 'Tile_Table.tsv', [])
    const { rules } = parseCalcRules(calc)
    const r = computeCalc(table, schema, rules, () => null)
    expect(r.errors).toEqual([])
    expect(r.staleCount).toBe(2) // Peak-Snow 의 MovementCost 1→9, FoodCost 1→18 (9*2, 같은 바퀴에서 갱신된 값)
    const applied = applyCalc(table, r)
    expect(applied.count).toBe(2)
    expect(serializeTsv(applied.table)).toBe('#string\tenum\tbyte\tbyte\nKey\tTerrainType\tMovementCost\tFoodCost\nPeak-Snow\tPeak\t9\t18\nPlains-Grass\tPlains\t1\t1\n\t\t\t')
    // 다시 계산하면 바뀔 것이 없다
    expect(computeCalc(applied.table, schema, rules, () => null).staleCount).toBe(0)
  })
  it('오류 보고: 없는 열 · 주석 열 · 행별 식 오류', () => {
    const table = parseTsv('#string\tbyte\t\nKey\tN\tMemo\nA\tx\t\nB\t2\t')
    const schema = deriveSchema(table, 'X_Table.tsv', [])
    const { rules } = parseCalcRules(parseTsv('Target\tFormula\nNope\t=1\nMemo\t=1\nN\t=N * 2'))
    const r = computeCalc(table, schema, rules, () => null)
    expect(r.errors.map((e) => e.message)).toEqual(['없는 열: Nope', '주석 열에는 쓸 수 없습니다: Memo', '숫자가 아닙니다: "x"'])
    expect(r.cells.size).toBe(1) // B 행만 계산됨
  })
  it('lookup 으로 다른 표 읽기', () => {
    const table = parseTsv('#string\tstring\tuint\nKey\tDistrictKey\tLimit\nGranary\tAgricultural-District\t')
    const schema = deriveSchema(table, 'Building_Table.tsv', [])
    const district = parseTsv('#string\tbyte\nKey\tBuildingLimit\nAgricultural-District\t8')
    const rules = parseCalcRules(parseTsv('Target\tFormula\nLimit\t=lookup("District_Table.tsv", DistrictKey, "BuildingLimit")')).rules
    expect(calcLookupFiles(rules)).toEqual(['District_Table.tsv'])
    const r = computeCalc(table, schema, rules, (f) => (f === 'District_Table.tsv' ? { table: district, schema: deriveSchema(district, 'District_Table.tsv', []) } : null))
    expect(r.errors).toEqual([])
    expect([...r.cells.values()][0].computed).toBe('8')
    const missing = computeCalc(table, schema, rules, () => null)
    expect(missing.errors[0].message).toContain('읽지 못했습니다')
  })
})
