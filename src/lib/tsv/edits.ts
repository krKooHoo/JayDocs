import { emptyRow, type TsvRow, type TsvTable } from './model'

/**
 * 표 편집 연산. 전부 순수 함수 — 바뀐 게 없으면 같은 객체를 돌려준다 (되돌리기 스택이 이것으로 중복을 거른다).
 * 바뀐 행만 `raw: null` 인 새 행이 되고 나머지 행 객체는 그대로 공유한다.
 */

export interface CellEdit {
  r: number
  c: number
  v: string
}

/** 포함 범위 (r1 ≤ r2, c1 ≤ c2) */
export interface CellRange {
  r1: number
  c1: number
  r2: number
  c2: number
}

function withRows(t: TsvTable, rows: readonly TsvRow[], width = t.width): TsvTable {
  return { ...t, rows, width }
}

export function setCell(t: TsvTable, r: number, c: number, v: string): TsvTable {
  return setCells(t, [{ r, c, v }])
}

/** 여러 셀을 한 번에. 표 끝을 넘는 행은 새로 만든다. width 밖의 열은 무시한다 (호출 쪽에서 잘라 알린다) */
export function setCells(t: TsvTable, edits: readonly CellEdit[]): TsvTable {
  if (edits.length === 0) return t
  const touched = new Map<number, { cells: string[]; dirty: boolean }>()
  for (const e of edits) {
    if (e.c < 0 || e.c >= t.width || e.r < 0) continue
    let entry = touched.get(e.r)
    if (!entry) {
      const row = t.rows[e.r]
      const cells = row ? [...row.cells] : []
      while (cells.length < t.width) cells.push('')
      entry = { cells, dirty: !row }
      touched.set(e.r, entry)
    }
    if (entry.cells[e.c] !== e.v) {
      entry.cells[e.c] = e.v
      entry.dirty = true
    }
  }
  const dirtyRows = [...touched].filter(([, e]) => e.dirty)
  if (dirtyRows.length === 0) return t
  const rows = [...t.rows]
  for (const [r, e] of dirtyRows) {
    while (rows.length < r) rows.push(emptyRow(t.width))
    rows[r] = { raw: null, cells: e.cells }
  }
  return withRows(t, rows)
}

export function insertRows(t: TsvTable, at: number, count = 1): TsvTable {
  if (count <= 0) return t
  const idx = Math.max(0, Math.min(at, t.rows.length))
  const fresh = Array.from({ length: count }, () => emptyRow(t.width))
  return withRows(t, [...t.rows.slice(0, idx), ...fresh, ...t.rows.slice(idx)])
}

export function deleteRows(t: TsvTable, at: number, count = 1): TsvTable {
  if (count <= 0 || at < 0 || at >= t.rows.length) return t
  return withRows(t, [...t.rows.slice(0, at), ...t.rows.slice(at + count)])
}

/** r 행부터 count 행을 복제해 바로 아래에 넣는다. 복제본은 수정된 행으로 취급한다 (raw 없음) */
export function duplicateRows(t: TsvTable, r: number, count = 1): TsvTable {
  if (r < 0 || r >= t.rows.length || count <= 0) return t
  const src = t.rows.slice(r, r + count)
  const copies: TsvRow[] = src.map((row) => ({ raw: null, cells: [...row.cells] }))
  const end = r + src.length
  return withRows(t, [...t.rows.slice(0, end), ...copies, ...t.rows.slice(end)])
}

export function duplicateRow(t: TsvTable, r: number): TsvTable {
  return duplicateRows(t, r, 1)
}

export function moveRow(t: TsvTable, from: number, to: number): TsvTable {
  if (from === to || from < 0 || from >= t.rows.length || to < 0 || to >= t.rows.length) return t
  const rows = [...t.rows]
  const [row] = rows.splice(from, 1)
  rows.splice(to, 0, row)
  return withRows(t, rows)
}

/** 열 삽입 — 모든 행이 수정된 행이 된다 (불가피, DESIGN §6.1) */
export function insertColumns(t: TsvTable, at: number, count = 1): TsvTable {
  if (count <= 0) return t
  const idx = Math.max(0, Math.min(at, t.width))
  const width = t.width + count
  const blanks = new Array<string>(count).fill('')
  const rows = t.rows.map((row) => {
    const cells = [...row.cells]
    while (cells.length < t.width) cells.push('')
    cells.splice(idx, 0, ...blanks)
    return { raw: null, cells } as TsvRow
  })
  return withRows(t, rows, width)
}

export function insertColumn(t: TsvTable, at: number): TsvTable {
  return insertColumns(t, at, 1)
}

export function deleteColumns(t: TsvTable, at: number, count = 1): TsvTable {
  if (count <= 0 || at < 0 || at >= t.width) return t
  const n = Math.min(count, t.width - at)
  if (n >= t.width) return t // 열을 전부 지울 수는 없다
  const width = t.width - n
  const rows = t.rows.map((row) => {
    const cells = [...row.cells]
    while (cells.length < t.width) cells.push('')
    cells.splice(at, n)
    return { raw: null, cells } as TsvRow
  })
  return withRows(t, rows, width)
}

export function deleteColumn(t: TsvTable, at: number): TsvTable {
  return deleteColumns(t, at, 1)
}

/** 빈 파일에 타입 행 · 헤더 행 · 빈 데이터 행을 만든다 */
export function seedTypedTable(t: TsvTable): TsvTable {
  if (t.rows.length > 0) return t
  const width = Math.max(t.width, 2)
  const typeRow: TsvRow = { raw: null, cells: ['#string', ...new Array<string>(width - 1).fill('string')] }
  const headRow: TsvRow = { raw: null, cells: ['Key', ...new Array<string>(width - 1).fill('')] }
  return withRows(t, [typeRow, headRow, emptyRow(width)], width)
}

/** 붙여넣기: 블록을 (r, c) 에 놓는다. 열이 넘치면 잘라 내고 잘린 열 수를 알린다 */
export function pasteBlock(
  t: TsvTable,
  r: number,
  c: number,
  block: readonly (readonly string[])[],
): { table: TsvTable; clippedCols: number; addedRows: number } {
  let clippedCols = 0
  const edits: CellEdit[] = []
  for (let i = 0; i < block.length; i++) {
    const line = block[i]
    for (let j = 0; j < line.length; j++) {
      if (c + j >= t.width) {
        clippedCols = Math.max(clippedCols, c + j - t.width + 1)
        continue
      }
      edits.push({ r: r + i, c: c + j, v: line[j] })
    }
  }
  const addedRows = Math.max(0, r + block.length - t.rows.length)
  return { table: setCells(t, edits), clippedCols, addedRows }
}

/** 범위의 셀 값들 (클립보드 블록용) */
export function rangeBlock(t: TsvTable, g: CellRange): string[][] {
  const out: string[][] = []
  for (let r = g.r1; r <= g.r2; r++) {
    const row: string[] = []
    for (let c = g.c1; c <= g.c2; c++) row.push(t.rows[r]?.cells[c] ?? '')
    out.push(row)
  }
  return out
}

/** 범위를 한 값으로 채운다 (빈 문자열이면 지우기) */
export function fillRange(t: TsvTable, g: CellRange, v: string): TsvTable {
  const edits: CellEdit[] = []
  const rMax = Math.min(g.r2, t.rows.length - 1)
  for (let r = g.r1; r <= rMax; r++) for (let c = g.c1; c <= g.c2; c++) edits.push({ r, c, v })
  return setCells(t, edits)
}

/** Ctrl+D: 범위 첫 행을 아래 행들에 복사. 한 행이면 바로 위 행을 그 행에 복사 (Sheets 와 같다) */
export function fillDown(t: TsvTable, g: CellRange): TsvTable {
  let src = g.r1
  let from = g.r1 + 1
  if (g.r1 === g.r2) {
    if (g.r1 === 0) return t
    src = g.r1 - 1
    from = g.r1
  }
  const edits: CellEdit[] = []
  for (let r = from; r <= g.r2; r++) for (let c = g.c1; c <= g.c2; c++) edits.push({ r, c, v: t.rows[src]?.cells[c] ?? '' })
  return setCells(t, edits)
}

/** Ctrl+R: 범위 첫 열을 오른쪽 열들에 복사. 한 열이면 바로 왼쪽 열을 복사 */
export function fillRight(t: TsvTable, g: CellRange): TsvTable {
  let src = g.c1
  let from = g.c1 + 1
  if (g.c1 === g.c2) {
    if (g.c1 === 0) return t
    src = g.c1 - 1
    from = g.c1
  }
  const edits: CellEdit[] = []
  for (let r = g.r1; r <= g.r2; r++) for (let c = from; c <= g.c2; c++) edits.push({ r, c, v: t.rows[r]?.cells[src] ?? '' })
  return setCells(t, edits)
}
