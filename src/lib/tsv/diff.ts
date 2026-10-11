import type { TsvTable } from './model'
import type { TableSchema } from './schema'

/**
 * 두 표의 차이 (DESIGN D5 ②). Key 열이 있으면 Key 로 행을 맞추고, 없으면 행 번호로 맞춘다.
 * 열은 새 표의 스키마를 기준으로 비교한다 (열이 늘거나 줄면 columnsChanged).
 */
export interface CellChange {
  c: number
  name: string
  before: string
  after: string
}
export interface RowChange {
  /** 새 표에서의 행 번호 (삭제된 행은 null) */
  r: number | null
  key: string
  kind: 'added' | 'removed' | 'changed'
  cells: CellChange[]
  /** 삭제된 행의 원래 셀 */
  removedCells?: readonly string[]
}
export interface TableDiff {
  keyed: boolean
  columnsChanged: boolean
  rows: RowChange[]
  added: number
  removed: number
  changed: number
}

function colName(schema: TableSchema, c: number) {
  return schema.columns[c]?.name || `${c + 1}열`
}

export function diffTables(before: TsvTable, after: TsvTable, schema: TableSchema): TableDiff {
  const keyCol = schema.typed ? schema.columns.find((c) => c.isKey)?.index ?? null : null
  const keyed = keyCol !== null
  const width = Math.max(before.width, after.width)
  const rows: RowChange[] = []
  const cellsDiff = (a: readonly string[], b: readonly string[]) => {
    const out: CellChange[] = []
    for (let c = 0; c < width; c++) {
      const x = a[c] ?? ''
      const y = b[c] ?? ''
      if (x !== y) out.push({ c, name: colName(schema, c), before: x, after: y })
    }
    return out
  }

  // 헤더 행(타입·이름)은 항상 행 번호로
  const header = schema.headerRows
  for (let r = 0; r < header; r++) {
    const a = before.rows[r]?.cells ?? []
    const b = after.rows[r]?.cells ?? []
    const cells = cellsDiff(a, b)
    if (cells.length) rows.push({ r, key: r === 0 ? '(타입 행)' : '(헤더)', kind: 'changed', cells })
  }

  if (keyed) {
    const k = keyCol
    const oldByKey = new Map<string, readonly string[]>()
    for (let r = header; r < before.rows.length; r++) {
      const cells = before.rows[r].cells
      const key = cells[k] ?? ''
      if (key !== '' && !oldByKey.has(key)) oldByKey.set(key, cells)
    }
    const seen = new Set<string>()
    for (let r = header; r < after.rows.length; r++) {
      const cells = after.rows[r].cells
      const key = cells[k] ?? ''
      if (key === '' && cells.every((v) => v === '')) continue
      const old = key !== '' && !seen.has(key) ? oldByKey.get(key) : undefined
      if (key !== '') seen.add(key)
      if (!old) { rows.push({ r, key: key || `(${r + 1}행)`, kind: 'added', cells: cellsDiff([], cells) }); continue }
      const cells2 = cellsDiff(old, cells)
      if (cells2.length) rows.push({ r, key, kind: 'changed', cells: cells2 })
    }
    for (const [key, cells] of oldByKey) if (!seen.has(key)) rows.push({ r: null, key, kind: 'removed', cells: [], removedCells: cells })
  } else {
    const n = Math.max(before.rows.length, after.rows.length)
    for (let r = header; r < n; r++) {
      const a = before.rows[r]?.cells
      const b = after.rows[r]?.cells
      if (a && !b) rows.push({ r: null, key: `${r + 1}행`, kind: 'removed', cells: [], removedCells: a })
      else if (!a && b) rows.push({ r, key: `${r + 1}행`, kind: 'added', cells: cellsDiff([], b) })
      else if (a && b) { const cells = cellsDiff(a, b); if (cells.length) rows.push({ r, key: `${r + 1}행`, kind: 'changed', cells }) }
    }
  }

  return {
    keyed,
    columnsChanged: before.width !== after.width,
    rows,
    added: rows.filter((x) => x.kind === 'added').length,
    removed: rows.filter((x) => x.kind === 'removed').length,
    changed: rows.filter((x) => x.kind === 'changed').length,
  }
}
