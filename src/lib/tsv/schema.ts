import { entryNotes, type FieldBlock, type FieldFile } from './field'
import type { TsvTable } from './model'

/**
 * 열 스키마 유도 (DESIGN §6.2). 별도 스키마 파일 없이 열 때마다 타입 행 + Field 블록에서 만든다.
 */
export const COLUMN_TYPES = ['string', 'enum', 'bool', 'byte', 'uint', 'float'] as const
export type DataType = (typeof COLUMN_TYPES)[number]
export type ColumnType = DataType | 'comment' | 'unknown'

export interface ColumnSchema {
  index: number
  name: string
  type: ColumnType
  /** 타입 행에 적힌 글자 그대로 (`#string` 포함) */
  rawType: string
  isKey: boolean
  /** 값이 `A, B` 꼴로 여러 개 들어가는 열 (enum 리스트) */
  list: boolean
  enumValues: string[] | null
  enumSource: 'field' | 'column' | null
  description: string | null
  notes: { label: string; text: string }[]
}

export interface TableSchema {
  /** 1행이 타입 행이고 2행이 헤더인 표 */
  typed: boolean
  /** 고정(헤더) 행 수 — typed 면 2, 아니면 0 */
  headerRows: number
  columns: ColumnSchema[]
  /** `Tile_Table.tsv` → `Tile` */
  prefix: string
  /** 열 설명을 가져온 블록 */
  defBlock: { file: string; name: string } | null
  /** enum 후보·설명을 찾아본 Field 파일들 */
  fieldFiles: string[]
}

const TYPE_SET = new Set<string>(COLUMN_TYPES)

/** 1행이 타입 행인가: 첫 셀이 `#타입` 이고 나머지 비지 않은 셀이 전부 타입 이름 */
export function isTypeRow(cells: readonly string[]): boolean {
  if (cells.length === 0) return false
  const first = cells[0].trim()
  if (!first.startsWith('#')) return false
  if (!TYPE_SET.has(first.slice(1).trim().toLowerCase())) return false
  for (let i = 1; i < cells.length; i++) {
    const v = cells[i].trim().toLowerCase()
    if (v !== '' && !TYPE_SET.has(v)) return false
  }
  return true
}

export function baseName(path: string): string {
  return path.split('/').pop() ?? path
}

/** `10-World/Tile/Tile_Table.tsv` → `Tile` */
export function tablePrefix(path: string): string {
  return baseName(path).replace(/\.tsv$/i, '').replace(/_(Table|Field)$/i, '')
}

/** 짝이 되는 Field 파일 경로 (같은 폴더, `_Table` ↔ `_Field`) */
export function siblingFieldPath(path: string): string {
  const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : ''
  return `${dir}${tablePrefix(path)}_Field.tsv`
}

export function isFieldFile(path: string): boolean {
  return /_Field\.tsv$/i.test(path)
}

export function columnLetter(i: number): string {
  let s = ''
  let n = i
  do {
    s = String.fromCharCode(65 + (n % 26)) + s
    n = Math.floor(n / 26) - 1
  } while (n >= 0)
  return s
}

function parseType(raw: string, index: number): ColumnType {
  let v = raw.trim()
  if (index === 0 && v.startsWith('#')) v = v.slice(1).trim()
  if (v === '') return 'comment'
  const lower = v.toLowerCase()
  return TYPE_SET.has(lower) ? (lower as DataType) : 'unknown'
}

function findBlock(fields: readonly FieldFile[], name: string, preferPath: string): { file: FieldFile; block: FieldBlock } | null {
  const ordered = [...fields].sort((a, b) => (a.path === preferPath ? -1 : b.path === preferPath ? 1 : 0))
  for (const file of ordered) {
    const block = file.blocks.find((b) => b.name === name)
    if (block) return { file, block }
  }
  return null
}

/** 열에 이미 들어 있는 값들 (리스트 셀은 항목별로). enum 후보가 Field 에 없을 때 대신 쓴다 */
function distinctColumnValues(t: TsvTable, headerRows: number, c: number): string[] {
  const set = new Set<string>()
  for (let r = headerRows; r < t.rows.length; r++) {
    const v = t.rows[r].cells[c]
    if (!v) continue
    for (const item of v.split(',')) {
      const s = item.trim()
      if (s) set.add(s)
    }
  }
  return [...set].sort((a, b) => a.localeCompare(b))
}

export function deriveSchema(t: TsvTable, path: string, fields: readonly FieldFile[]): TableSchema {
  const prefix = tablePrefix(path)
  const sibling = siblingFieldPath(path)
  const typed = t.rows.length > 0 && isTypeRow(t.rows[0].cells)
  const headerRows = typed ? 2 : 0
  const typeRow = typed ? t.rows[0].cells : []
  const headRow = typed ? (t.rows[1]?.cells ?? []) : []
  const def = typed ? findBlock(fields, `${prefix}Def`, sibling) : null

  const columns: ColumnSchema[] = []
  for (let c = 0; c < t.width; c++) {
    const rawType = typeRow[c] ?? ''
    const name = (headRow[c] ?? '').trim()
    let type: ColumnType = typed ? parseType(rawType, c) : 'string'
    if (typed && name.startsWith('#')) type = 'comment'
    const col: ColumnSchema = {
      index: c,
      name,
      type,
      rawType,
      isKey: typed && c === 0 && name === 'Key',
      list: false,
      enumValues: null,
      enumSource: null,
      description: null,
      notes: [],
    }
    if (typed && name && def) {
      const entry = def.block.entries.find((e) => e.key === name)
      if (entry) Object.assign(col, entryNotes(def.block, entry))
    }
    if (type === 'enum') {
      const hit = name ? findBlock(fields, name, sibling) : null
      if (hit) {
        col.enumValues = hit.block.entries.map((e) => e.key).filter(Boolean)
        col.enumSource = 'field'
      } else {
        col.enumValues = distinctColumnValues(t, headerRows, c)
        col.enumSource = 'column'
      }
      for (let r = headerRows; r < t.rows.length && !col.list; r++) {
        if ((t.rows[r].cells[c] ?? '').includes(',')) col.list = true
      }
    }
    columns.push(col)
  }

  return {
    typed,
    headerRows,
    columns,
    prefix,
    defBlock: def ? { file: def.file.path, name: def.block.name } : null,
    fieldFiles: fields.map((f) => f.path),
  }
}
