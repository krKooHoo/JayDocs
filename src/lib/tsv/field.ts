import type { TsvTable } from './model'

/**
 * `_Field` 시트 읽기 (DESIGN §6.2 ④). 자유 서식이라 힌트로만 쓴다 — 못 읽으면 기능 저하일 뿐 오류가 아니다.
 *
 * 빈 줄로 블록을 나누고, 블록 첫 행의 첫 셀이 블록 이름이다 (`TileDef`, `TerrainType`, `Trait` …).
 * 첫 행의 나머지 셀은 열 제목(`설명`, `Note`), 그 아래 행들이 항목이다. 항목 첫 셀이 이름(열 이름 또는 enum 값).
 */
export interface FieldEntry {
  key: string
  cells: readonly string[]
}
export interface FieldBlock {
  name: string
  headers: readonly string[]
  entries: FieldEntry[]
  /** 파일 안 행 번호 (0부터) */
  startRow: number
}
export interface FieldFile {
  path: string
  blocks: FieldBlock[]
}

function isBlank(cells: readonly string[]) {
  return cells.every((c) => c.trim() === '')
}

export function parseFieldBlocks(path: string, t: TsvTable): FieldFile {
  const blocks: FieldBlock[] = []
  let current: FieldBlock | null = null
  t.rows.forEach((row, i) => {
    if (isBlank(row.cells)) {
      current = null
      return
    }
    if (!current) {
      current = { name: row.cells[0]?.trim() ?? '', headers: row.cells.map((c) => c.trim()), entries: [], startRow: i }
      blocks.push(current)
      return
    }
    current.entries.push({ key: row.cells[0]?.trim() ?? '', cells: row.cells })
  })
  return { path, blocks }
}

/** 항목 하나의 설명(2열) 과 그 밖의 제목 있는 열들 */
export function entryNotes(block: FieldBlock, entry: FieldEntry): { description: string | null; notes: { label: string; text: string }[] } {
  const description = entry.cells[1]?.trim() || null
  const notes: { label: string; text: string }[] = []
  for (let i = 2; i < entry.cells.length; i++) {
    const text = entry.cells[i]?.trim()
    const label = block.headers[i]
    if (text && label) notes.push({ label, text })
  }
  return { description, notes }
}
