/**
 * 하이브리드 모드의 표 칸 편집 (DESIGN §23). GFM 파이프 표 원문에서 칸마다 위치를 찾아,
 * 한 칸의 글자만 바꾸는 변경을 만든다 — 다른 칸의 정렬 공백·앞뒤 `|` 유무는 그대로 둔다.
 *
 * 위치는 모두 표 원문(첫 줄 시작 = 0) 기준이다. 칸 글자는 앞뒤 공백을 뺀 원문 그대로(`\|` 포함).
 */

export type Align = 'left' | 'center' | 'right' | null

export interface TableCell {
  /** 원문 그대로 (앞뒤 공백 제외, `\|` 그대로) */
  raw: string
  /** 칸 글자의 위치. 빈 칸이면 두 `|` 사이 전체 (공백 포함) */
  from: number
  to: number
}

export interface TableRow {
  cells: TableCell[]
  /** 줄 시작 · 끝 (줄바꿈 제외) */
  lineFrom: number
  lineTo: number
  /** 줄이 `|` 로 끝나는가 — 모자란 칸을 덧붙일 때 쓴다 */
  closed: boolean
}

export interface ParsedTable {
  /** 0 = 머리글. 구분선(`---`) 줄은 뺀다 */
  rows: TableRow[]
  align: Align[]
  /** 머리글 칸 수 = 표의 열 수 (GFM) */
  cols: number
}

const DELIM_CELL = /^:?-+:?$/

/** 줄에서 이스케이프되지 않은 `|` 위치들 */
function pipePositions(line: string): number[] {
  const out: number[] = []
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '\\') { i++; continue }
    if (ch === '|') out.push(i)
  }
  return out
}

/** 한 줄 → 칸들 (줄 안 위치 기준) */
function splitLine(line: string): { cells: { raw: string; from: number; to: number }[]; closed: boolean } {
  const pipes = pipePositions(line)
  const lead = line.length - line.trimStart().length
  const trail = line.trimEnd().length
  // 칸 경계: 앞 `|` 가 있으면 그 뒤부터, 없으면 줄의 첫 글자부터
  const bounds: number[] = []
  const opened = pipes.length > 0 && pipes[0] === lead
  const closed = pipes.length > 0 && pipes[pipes.length - 1] === trail - 1 && !(opened && pipes.length === 1)
  bounds.push(opened ? pipes[0] + 1 : lead)
  for (const p of pipes) {
    if (opened && p === pipes[0]) continue
    if (closed && p === pipes[pipes.length - 1]) continue
    bounds.push(p, p + 1)
  }
  bounds.push(closed ? pipes[pipes.length - 1] : trail)
  const cells: { raw: string; from: number; to: number }[] = []
  for (let i = 0; i < bounds.length; i += 2) {
    const a = bounds[i]
    const b = bounds[i + 1]
    const seg = line.slice(a, b)
    const l = seg.length - seg.trimStart().length
    const raw = seg.trim()
    // 빈 칸은 칸 전체(공백 포함)를 가리킨다 — 글자를 넣을 때 ` x ` 로 바꾼다
    cells.push(raw ? { raw, from: a + l, to: a + l + raw.length } : { raw: '', from: a, to: b })
  }
  return { cells, closed }
}

function alignOf(raw: string): Align {
  const l = raw.startsWith(':')
  const r = raw.endsWith(':')
  return l && r ? 'center' : r ? 'right' : l ? 'left' : null
}

/** 파이프 표 원문을 읽는다. 표가 아니면 null */
export function parseTable(src: string): ParsedTable | null {
  const lines: { text: string; from: number }[] = []
  let pos = 0
  for (const text of src.split('\n')) {
    lines.push({ text, from: pos })
    pos += text.length + 1
  }
  while (lines.length && lines[lines.length - 1].text.trim() === '') lines.pop()
  if (lines.length < 2) return null
  const delim = splitLine(lines[1].text)
  if (!delim.cells.length || !delim.cells.every((c) => DELIM_CELL.test(c.raw))) return null
  const rows: TableRow[] = []
  for (let i = 0; i < lines.length; i++) {
    if (i === 1) continue
    const { text, from } = lines[i]
    const { cells, closed } = splitLine(text)
    rows.push({
      cells: cells.map((c) => ({ raw: c.raw, from: from + c.from, to: from + c.to })),
      lineFrom: from,
      lineTo: from + text.length,
      closed,
    })
  }
  const cols = rows[0].cells.length
  const align = Array.from({ length: cols }, (_, i) => (delim.cells[i] ? alignOf(delim.cells[i].raw) : null))
  return { rows, align, cols }
}

/** 칸에 넣을 글자 → 원문. `|` 는 `\|` 로, 줄바꿈은 칸을 깨므로 공백으로 */
export function escapeCell(text: string): string {
  return text.replace(/\r?\n/g, ' ').replace(/(\\*)\|/g, (m, bs: string) => (bs.length % 2 ? m : bs + '\\|'))
}

/** 원문 → 입력 칸에 보일 글자 (`\|` → `|`) */
export function unescapeCell(raw: string): string {
  return raw.replace(/\\\|/g, '|')
}

export interface TextChange {
  from: number
  to: number
  insert: string
}

/**
 * (row, col) 칸의 글자를 text 로 바꾸는 변경. row 0 = 머리글, 1.. = 본문(구분선 제외).
 * 줄에 그 칸이 없으면(GFM 은 모자란 칸을 빈 칸으로 본다) 줄 끝에 칸을 덧붙인다.
 */
export function cellChange(table: ParsedTable, row: number, col: number, text: string): TextChange | null {
  const r = table.rows[row]
  if (!r || col < 0 || col >= table.cols) return null
  const insert = escapeCell(text)
  const cell = r.cells[col]
  if (cell) {
    if (cell.raw === '') return insert ? { from: cell.from, to: cell.to, insert: ` ${insert} ` } : null
    return cell.raw === insert ? null : { from: cell.from, to: cell.to, insert }
  }
  if (!insert) return null
  const missing = col - r.cells.length + 1
  const pad = Array.from({ length: missing }, (_, i) => (i === missing - 1 ? insert : '')).map((s) => ` ${s} |`).join('')
  return r.closed
    ? { from: r.lineTo, to: r.lineTo, insert: pad }
    : { from: r.lineTo, to: r.lineTo, insert: ' |' + pad }
}

/** 표 끝에 빈 행 하나 (열 수만큼). 표 원문의 마지막 줄 끝에 넣는다 */
export function appendRowChange(table: ParsedTable): TextChange {
  const last = table.rows[table.rows.length - 1]
  const line = '|' + '  |'.repeat(table.cols)
  return { from: last.lineTo, to: last.lineTo, insert: '\n' + line }
}
