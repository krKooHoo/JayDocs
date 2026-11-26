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

/** 빈 행 한 줄 (열 수만큼) */
function emptyRow(cols: number): string {
  return '|' + '  |'.repeat(cols)
}

/** 표 끝에 빈 행 하나 (열 수만큼). 표 원문의 마지막 줄 끝에 넣는다 */
export function appendRowChange(table: ParsedTable): TextChange {
  const last = table.rows[table.rows.length - 1]
  return { from: last.lineTo, to: last.lineTo, insert: '\n' + emptyRow(table.cols) }
}

/* ---- 구조 편집 (행 · 열 넣기 · 지우기, DESIGN §23 H9) ----
 * 바꾸는 것은 그 행 줄, 또는 줄마다 그 열의 칸 하나뿐 — 다른 칸의 정렬 공백 · 앞뒤 `|` 유무는 그대로 둔다. */

/** 표 원문의 줄들 (끝의 빈 줄 제외). 1번이 구분선 */
function tableLines(src: string): { text: string; from: number }[] {
  const lines: { text: string; from: number }[] = []
  let pos = 0
  for (const text of src.split('\n')) {
    lines.push({ text, from: pos })
    pos += text.length + 1
  }
  while (lines.length && lines[lines.length - 1].text.trim() === '') lines.pop()
  return lines
}

/** 줄의 칸 경계 — 칸 i 는 `[a, b)` (앞뒤 공백 포함). b 자리에 `|` 가 있으면 칸을 닫는 `|` */
function segments(line: string): { a: number; b: number }[] {
  const pipes = pipePositions(line)
  const lead = line.length - line.trimStart().length
  const trail = line.trimEnd().length
  const opened = pipes.length > 0 && pipes[0] === lead
  const closed = pipes.length > 0 && pipes[pipes.length - 1] === trail - 1 && !(opened && pipes.length === 1)
  const inner = pipes.filter((_p, i) =>!(opened && i === 0) && !(closed && i === pipes.length - 1))
  const starts = [opened ? pipes[0] + 1 : lead, ...inner.map((p) => p + 1)]
  const ends = [...inner, closed ? pipes[pipes.length - 1] : trail]
  return starts.map((a, i) => ({ a, b: ends[i] }))
}

/** 행 `after` 아래에 빈 행 (0 = 머리글 → 본문 첫 행). 새 행은 `after + 1` 번이 된다 */
export function insertRowChange(src: string, after: number): TextChange | null {
  const t = parseTable(src)
  if (!t || after < 0 || after >= t.rows.length) return null
  // 머리글 아래면 구분선 줄 뒤에
  const at = after === 0 ? tableLines(src)[1].from + tableLines(src)[1].text.length : t.rows[after].lineTo
  return { from: at, to: at, insert: '\n' + emptyRow(t.cols) }
}

/** 본문 행 하나를 지운다. 머리글(0)은 못 지운다 */
export function deleteRowChange(src: string, row: number): TextChange | null {
  const t = parseTable(src)
  if (!t || row < 1 || row >= t.rows.length) return null
  const r = t.rows[row]
  return { from: r.lineFrom - 1, to: r.lineTo, insert: '' }
}

/** 열 `after` 오른쪽에 빈 열. 줄마다 그 칸 뒤에 칸 하나를 넣는다 (구분선은 `---`). 그 열이 없는 줄(모자란 칸)은 그대로 */
export function insertColChanges(src: string, after: number): TextChange[] | null {
  const t = parseTable(src)
  if (!t || after < 0 || after >= t.cols) return null
  const out: TextChange[] = []
  tableLines(src).forEach(({ text, from }, i) => {
    const segs = segments(text)
    const s = segs[after]
    if (!s) return
    const fill = i === 1 ? '---' : ''
    // 칸을 닫는 `|` 가 있으면 그 뒤에 ` x |`, 없으면(닫지 않은 줄의 끝 칸) 줄 끝에 ` | x |`
    if (text[s.b] === '|') out.push({ from: from + s.b + 1, to: from + s.b + 1, insert: ` ${fill} |` })
    else out.push({ from: from + s.b, to: from + s.b, insert: ` | ${fill} |` })
  })
  return out
}

/** 열 하나를 지운다. 열이 하나뿐이면 못 지운다. 줄마다 그 칸과 칸을 닫는 `|` 를 뺀다 */
export function deleteColChanges(src: string, col: number): TextChange[] | null {
  const t = parseTable(src)
  if (!t || t.cols < 2 || col < 0 || col >= t.cols) return null
  const out: TextChange[] = []
  for (const { text, from } of tableLines(src)) {
    const s = segments(text)[col]
    if (!s) continue
    // 닫지 않은 줄의 끝 칸이면 앞의 `|` 와 함께
    const cut = text[s.b] === '|' ? { a: s.a, b: s.b + 1 } : { a: s.a > 0 && text[s.a - 1] === '|' ? s.a - 1 : s.a, b: s.b }
    const next = text.slice(0, cut.a) + text.slice(cut.b)
    // `|` 가 하나도 남지 않으면 표 줄이 아니게 된다 (`a | b` 에서 한 열을 지운 경우) → `| x |` 로 감싼다
    if (pipePositions(next).length === 0) out.push({ from, to: from + text.length, insert: `| ${next.trim()} |` })
    else out.push({ from: from + cut.a, to: from + cut.b, insert: '' })
  }
  return out
}

/**
 * 표 구조 편집 — 행은 그리드(TSV)와 같은 키. 마크다운 표에는 열 전체 선택이 없어
 * 열 넣기 · 지우기는 키 없이 팔레트 "마크다운 표: …" 와 맥락 메뉴로만 (DESIGN §41 K2)
 */
export type TableOp = 'rowBelow' | 'colRight' | 'deleteRow' | 'deleteCol'
export const TABLE_OP_KEYS: Record<string, TableOp> = {
  'Ctrl+Alt+=': 'rowBelow',
  'Ctrl+Alt+-': 'deleteRow',
}

/** 구조 편집 하나 → 변경들과, 그 뒤에 고칠 칸. 못 하면(머리글 행 · 마지막 열 지우기) null */
export function tableOpChanges(src: string, op: TableOp, row: number, col: number): { changes: TextChange[]; next: { row: number; col: number } } | null {
  const t = parseTable(src)
  if (!t) return null
  switch (op) {
    case 'rowBelow': {
      const c = insertRowChange(src, row)
      return c && { changes: [c], next: { row: row + 1, col } }
    }
    case 'colRight': {
      const c = insertColChanges(src, col)
      return c && { changes: c, next: { row, col: col + 1 } }
    }
    case 'deleteRow': {
      const c = deleteRowChange(src, row)
      // 지운 자리의 다음 행, 마지막 행이었으면 위 행
      return c && { changes: [c], next: { row: Math.min(row, t.rows.length - 2), col } }
    }
    case 'deleteCol': {
      const c = deleteColChanges(src, col)
      return c && { changes: c, next: { row, col: Math.min(col, t.cols - 2) } }
    }
  }
}

/** `|||` 로 만드는 빈 표 (2열 · 본문 1행) */
export const NEW_TABLE = '|  |  |\n| --- | --- |\n|  |  |'

/**
 * 표 원문 안의 위치(오프셋) → (row, col). 구분선 줄은 머리글(0)로 본다. 표 밖이면 null.
 * 칸을 닫는 `|` 바로 앞까지는 그 칸, `|` 뒤부터 다음 칸이다 (줄 끝을 넘으면 마지막 칸).
 */
export function cellAtOffset(src: string, offset: number): { row: number; col: number } | null {
  const t = parseTable(src)
  if (!t) return null
  const lines = tableLines(src)
  const li = lines.findIndex((l) => offset >= l.from && offset <= l.from + l.text.length)
  if (li < 0) return null
  const row = li <= 1 ? 0 : li - 1
  const x = offset - lines[li].from
  const segs = segments(lines[li].text)
  let col = segs.findIndex((s) => x <= s.b)
  if (col < 0) col = segs.length - 1
  return { row, col: Math.max(0, Math.min(col, t.cols - 1)) }
}

/** (row, col) 칸의 글자 끝 위치 (표 원문 기준) — 커서를 둘 곳. 그 칸이 줄에 없으면 줄 끝 */
export function cellCaret(src: string, row: number, col: number): number | null {
  const t = parseTable(src)
  const r = t?.rows[row]
  if (!r) return null
  const c = r.cells[col]
  if (!c) return r.lineTo
  // 빈 칸은 `|` 사이 전체를 가리키므로 한 칸 띄운 자리
  return c.raw ? c.to : Math.min(c.from + 1, c.to)
}

/** 변경 여럿을 원문에 적용 (서로 겹치지 않는다고 본다) */
export function applyChanges(src: string, changes: TextChange[]): string {
  let out = src
  for (const c of [...changes].sort((x, y) => y.from - x.from)) out = out.slice(0, c.from) + c.insert + out.slice(c.to)
  return out
}
