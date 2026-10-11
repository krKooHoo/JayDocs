import type { TsvTable } from '../tsv/model'
import { setCells, type CellEdit } from '../tsv/edits'
import { issueKey } from '../tsv/validate'
import type { TableSchema } from '../tsv/schema'
import { compileExpr, type CalcEnv, type CompiledExpr } from './expr'

/**
 * `X_Calc.tsv` — 표 `X_Table.tsv` 의 값 열을 채우는 계산식 (DESIGN §17, 권고안 b).
 *
 *   Target	Formula	#메모
 *   MovementCost	=if(TerrainType == "Peak", 9, 1)	지형별 이동 비용
 *   FoodCost[Peak-Snow]	=MovementCost * 2	이 행만
 *
 * 1행이 헤더(첫 셀 `Target`), 2행부터 규칙. `열이름` 은 모든 데이터 행, `열이름[Key]` 는 그 Key 행 하나. `#` 로 시작하는 Target 은 주석.
 * 계산 결과는 그리드의 **계산(F9)** 으로 표에 써 넣는다 — 파일에는 값만 남고, 식은 이 파일에만 있다.
 */
export interface CalcRule {
  /** 규칙이 적힌 행 번호 (0부터, Calc 파일 안) */
  row: number
  target: string
  key: string | null
  formula: string
}

export interface CalcError {
  rule: CalcRule | null
  /** 표의 행 번호 (규칙 자체 오류면 null) */
  row: number | null
  message: string
}

export interface CalcCell {
  rule: CalcRule
  computed: string
  current: string
  stale: boolean
}

export interface CalcResult {
  /** issueKey(width, r, c) → 계산 결과 */
  cells: Map<number, CalcCell>
  errors: CalcError[]
  /** 지금 값과 다른 셀 수 */
  staleCount: number
  /** 식이 참조한 lookup 파일 (리포 상대 경로 그대로) */
  lookupFiles: string[]
}

export function isCalcFile(path: string): boolean {
  return /_Calc\.tsv$/i.test(path)
}

/** `Tile_Table.tsv` → `Tile_Calc.tsv` (같은 폴더) */
export function siblingCalcPath(tablePath: string): string {
  return tablePath.replace(/_Table\.tsv$/i, '_Calc.tsv')
}

export function parseCalcRules(t: TsvTable): { rules: CalcRule[]; errors: CalcError[] } {
  const rules: CalcRule[] = []
  const errors: CalcError[] = []
  const first = t.rows[0]?.cells[0]?.trim().toLowerCase()
  const start = first === 'target' || first === '#target' ? 1 : 0
  for (let r = start; r < t.rows.length; r++) {
    const cells = t.rows[r].cells
    const target = (cells[0] ?? '').trim()
    const formula = (cells[1] ?? '').trim()
    if (target === '' && formula === '') continue
    if (target.startsWith('#')) continue
    if (target === '' || formula === '') { errors.push({ rule: null, row: null, message: `${r + 1}행: Target 과 Formula 가 모두 필요합니다` }); continue }
    const m = /^([^[\]]+?)\s*(?:\[(.+)\])?$/.exec(target)
    if (!m) { errors.push({ rule: null, row: null, message: `${r + 1}행: Target 형식이 틀렸습니다 (열이름 또는 열이름[Key])` }); continue }
    rules.push({ row: r, target: m[1].trim(), key: m[2]?.trim() ?? null, formula })
  }
  return { rules, errors }
}

/** 규칙들이 참조하는 lookup 파일 (미리 불러올 것) */
export function calcLookupFiles(rules: CalcRule[]): string[] {
  const out = new Set<string>()
  for (const rule of rules) {
    try { for (const f of compileExpr(rule.formula).lookupFiles) out.add(f) } catch { /* 식 오류는 compute 에서 보고 */ }
  }
  return [...out]
}

export interface LookupSource {
  table: TsvTable
  schema: TableSchema
}

/**
 * 모든 규칙을 평가해 셀별 계산값을 낸다 (표는 바꾸지 않는다). 규칙이 다른 규칙의 결과를 읽을 수 있으니 값이 안정될 때까지 최대 5번 돈다.
 */
export function computeCalc(table: TsvTable, schema: TableSchema, rules: CalcRule[], lookupTables: (file: string) => LookupSource | null): CalcResult {
  const errors: CalcError[] = []
  const cells = new Map<number, CalcCell>()
  if (!schema.typed) {
    if (rules.length) errors.push({ rule: null, row: null, message: '타입 행이 없는 표에는 계산식을 적용할 수 없습니다' })
    return { cells, errors, staleCount: 0, lookupFiles: [] }
  }
  const colIndex = new Map<string, number>()
  for (const c of schema.columns) if (c.name) colIndex.set(c.name, c.index)
  const keyCol = schema.columns.find((c) => c.isKey)?.index ?? null

  const compiled: { rule: CalcRule; fn: CompiledExpr; col: number }[] = []
  const lookupFiles = new Set<string>()
  for (const rule of rules) {
    const col = colIndex.get(rule.target)
    if (col === undefined) { errors.push({ rule, row: null, message: `없는 열: ${rule.target}` }); continue }
    if (schema.columns[col].type === 'comment') { errors.push({ rule, row: null, message: `주석 열에는 쓸 수 없습니다: ${rule.target}` }); continue }
    if (rule.key !== null && keyCol === null) { errors.push({ rule, row: null, message: 'Key 열이 없어 [Key] 규칙을 쓸 수 없습니다' }); continue }
    let fn: CompiledExpr
    try { fn = compileExpr(rule.formula) } catch (e) { errors.push({ rule, row: null, message: `식 오류: ${(e as Error).message}` }); continue }
    for (const n of fn.columns) if (!colIndex.has(n)) errors.push({ rule, row: null, message: `식이 없는 열을 읽습니다: ${n}` })
    for (const f of fn.lookupFiles) lookupFiles.add(f)
    compiled.push({ rule, fn, col })
  }

  // 작업용 값 복사본 (규칙 결과를 다음 규칙·다음 바퀴가 읽는다)
  const work = table.rows.map((r) => [...r.cells])
  const lookupCache = new Map<string, Map<string, readonly string[]> | null>()
  const lookupIndex = (file: string): { byKey: Map<string, readonly string[]>; schema: TableSchema } | null => {
    const src = lookupTables(file)
    if (!src) { lookupCache.set(file, null); return null }
    let byKey = lookupCache.get(file) ?? undefined
    if (byKey === undefined) {
      byKey = new Map()
      const k = src.schema.columns.find((c) => c.isKey)?.index ?? 0
      for (let r = src.schema.headerRows; r < src.table.rows.length; r++) {
        const cells = src.table.rows[r].cells
        const key = cells[k] ?? ''
        if (key !== '' && !byKey.has(key)) byKey.set(key, cells)
      }
      lookupCache.set(file, byKey)
    }
    return byKey ? { byKey, schema: src.schema } : null
  }
  const reported = new Set<string>()
  const report = (rule: CalcRule, row: number, message: string) => {
    const id = `${rule.row}:${row}:${message}`
    if (reported.has(id)) return
    reported.add(id)
    errors.push({ rule, row, message })
  }

  for (let pass = 0; pass < 5; pass++) {
    let changed = false
    for (const { rule, fn, col } of compiled) {
      for (let r = schema.headerRows; r < table.rows.length; r++) {
        const row = work[r]
        if (row.every((v) => v === '')) continue // 빈 행은 건너뛴다
        if (rule.key !== null && (row[keyCol!] ?? '') !== rule.key) continue
        const env: CalcEnv = {
          get: (name) => { const i = colIndex.get(name); return i === undefined ? undefined : (row[i] ?? '') },
          lookup: (file, key, column) => {
            const idx = lookupIndex(file)
            if (!idx) return null
            const c = idx.schema.columns.find((x) => x.name === column)
            if (!c) throw new Error(`lookup: ${file} 에 열 ${column} 이 없습니다`)
            return idx.byKey.get(key)?.[c.index] ?? ''
          },
        }
        let value: string
        try { value = fn(env) } catch (e) { report(rule, r, (e as Error).message); continue }
        if ((row[col] ?? '') !== value) { row[col] = value; changed = true }
        const k = issueKey(table.width, r, col)
        const current = table.rows[r].cells[col] ?? ''
        cells.set(k, { rule, computed: value, current, stale: current !== value })
      }
    }
    if (!changed) break
  }
  let staleCount = 0
  for (const c of cells.values()) if (c.stale) staleCount++
  return { cells, errors, staleCount, lookupFiles: [...lookupFiles] }
}

/** 계산값을 표에 써 넣는다 (바뀐 셀만, 되돌리기 한 단계) */
export function applyCalc(table: TsvTable, result: CalcResult): { table: TsvTable; count: number } {
  const edits: CellEdit[] = []
  for (const [k, c] of result.cells) {
    if (!c.stale) continue
    edits.push({ r: Math.floor(k / table.width), c: k % table.width, v: c.computed })
  }
  return { table: setCells(table, edits), count: edits.length }
}

/** 새 Calc 파일의 시작 내용 */
export function calcTemplate(exampleColumn: string | null): string {
  const col = exampleColumn ?? 'ColumnName'
  return `Target\tFormula\t#메모\n#${col}\t=${col} * 2\t예시 — 앞의 # 을 지우면 켜진다. 열이름[Key] 로 한 행만\n`
}
