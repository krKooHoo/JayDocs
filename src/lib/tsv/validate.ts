import type { TsvTable } from './model'
import type { ColumnSchema, TableSchema } from './schema'

/**
 * 셀 검증 (DESIGN §6.2). 저장을 막지는 않는다 — 기획 중간 상태도 저장할 수 있어야 한다.
 * 빈 셀은 어떤 타입이든 허용한다 (Sheets export 에 빈 셀이 많다).
 */
export interface Validation {
  /** r * width + c → 메시지 */
  issues: Map<number, string>
  count: number
  byColumn: number[]
}

export function issueKey(width: number, r: number, c: number) {
  return r * width + c
}

const INT = /^\d+$/
const FLOAT = /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/

export function checkValue(col: ColumnSchema, v: string): string | null {
  if (v === '') return null
  switch (col.type) {
    case 'bool':
      return /^(true|false)$/i.test(v) ? null : 'TRUE 또는 FALSE 여야 합니다'
    case 'byte':
      if (!INT.test(v)) return '0~255 정수여야 합니다'
      return Number(v) <= 255 ? null : '255 를 넘을 수 없습니다 (byte)'
    case 'uint':
      return INT.test(v) ? null : '0 이상의 정수여야 합니다'
    case 'float':
      return FLOAT.test(v) && Number.isFinite(Number(v)) ? null : '숫자여야 합니다'
    case 'enum': {
      if (col.enumSource !== 'field' || !col.enumValues) return null
      const allowed = new Set(col.enumValues)
      const items = col.list ? v.split(',').map((s) => s.trim()) : [v.trim()]
      const bad = items.filter((s) => s !== '' && !allowed.has(s))
      return bad.length ? `허용되지 않은 값: ${bad.join(', ')}` : null
    }
    default:
      return null
  }
}

export function validateTable(t: TsvTable, schema: TableSchema): Validation {
  const issues = new Map<number, string>()
  const byColumn = new Array<number>(t.width).fill(0)
  const add = (r: number, c: number, msg: string) => {
    issues.set(issueKey(t.width, r, c), msg)
    byColumn[c]++
  }
  if (!schema.typed) return { issues, count: 0, byColumn }

  const keyCol = schema.columns.find((c) => c.isKey)
  const seen = new Map<string, number>()
  for (let r = schema.headerRows; r < t.rows.length; r++) {
    const cells = t.rows[r].cells
    const blank = cells.every((v) => v === '')
    for (const col of schema.columns) {
      const v = cells[col.index] ?? ''
      if (/[\t\r\n]/.test(v)) { add(r, col.index, '탭·줄바꿈은 TSV 셀에 넣을 수 없습니다'); continue }
      const msg = checkValue(col, v)
      if (msg) add(r, col.index, msg)
    }
    if (keyCol && !blank) {
      const k = cells[keyCol.index] ?? ''
      if (k === '') add(r, keyCol.index, 'Key 가 비었습니다')
      else {
        const prev = seen.get(k)
        if (prev !== undefined) {
          add(r, keyCol.index, `중복 Key (${prev + 1}행과 같음)`)
          if (!issues.has(issueKey(t.width, prev, keyCol.index))) add(prev, keyCol.index, `중복 Key (${r + 1}행과 같음)`)
        } else seen.set(k, r)
      }
    }
  }
  return { issues, count: issues.size, byColumn }
}
