/**
 * 머리글이 있는 표를 클립보드에서 읽는다 — 마크다운 파이프 표(md 소스에서 복사)와
 * `<th>` 머리글이 있는 HTML 표(미리보기·하이브리드에서 복사). 그리드는 이걸 받으면
 * 머리글을 머리글 행으로 보내고 모자라는 열·행을 늘린다 (DESIGN §19).
 *
 * Sheets·Excel 의 표는 여기 걸리지 않는다: text/plain 에 탭이 있고(→ 파이프 표 아님),
 * HTML 은 `<td>` 만 쓴다(→ `<th>` 머리글 없음). 그래서 예전처럼 TSV 붙여넣기로 간다.
 */

export interface HeadedBlock {
  header: string[]
  rows: string[][]
}

const DELIM_CELL = /^:?-+:?$/

/** 파이프 표 한 줄 → 칸들. 앞뒤 `|` 는 떼고 `\|` 는 글자 `|` 로 */
export function splitPipeRow(line: string): string[] {
  let s = line.trim()
  if (s.startsWith('|')) s = s.slice(1)
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1)
  const out: string[] = []
  let cur = ''
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (ch === '\\' && s[i + 1] === '|') { cur += '|'; i++; continue }
    if (ch === '|') { out.push(cur.trim()); cur = ''; continue }
    cur += ch
  }
  out.push(cur.trim())
  return out
}

/** 파이프 표 칸 안의 `<br>` 는 칸 안 줄바꿈 (bake 가 그렇게 쓴다). 실제로 넣을 수 있는지는 붙이는 쪽 형식이 정한다 */
function cellText(v: string): string {
  return v.replace(/<br\s*\/?>/gi, '\n')
}

/** GFM 처럼 머리글 칸 수에 맞춘다 — 모자라면 빈 칸, 넘치면 버린다 */
function fit(cells: string[], n: number): string[] {
  const out = cells.slice(0, n)
  while (out.length < n) out.push('')
  return out
}

/**
 * 클립보드 글이 통째로 마크다운 파이프 표(머리글 줄 + 구분 줄 + 행들)면 읽는다. 아니면 null.
 * 빈 줄과 baked 주석 줄(`<!-- tsv-view:baked -->` 등)은 건너뛴다.
 */
export function parseMarkdownTable(text: string): HeadedBlock | null {
  if (text.includes('\t')) return null
  const lines = text.split(/\r\n|\r|\n/).map((l) => l.trim()).filter((l) => l !== '' && !/^<!--.*-->$/.test(l))
  if (lines.length < 2 || !lines.every((l) => l.includes('|'))) return null
  const header = splitPipeRow(lines[0])
  const delim = splitPipeRow(lines[1])
  if (delim.length !== header.length || !delim.every((c) => DELIM_CELL.test(c))) return null
  return {
    header: header.map(cellText),
    rows: lines.slice(2).map((l) => fit(splitPipeRow(l).map(cellText), header.length)),
  }
}

/** HTML 칸의 글. `<br>` 는 줄바꿈으로 */
function htmlCellText(el: Element): string {
  const copy = el.cloneNode(true) as Element
  for (const br of copy.querySelectorAll('br')) br.replaceWith('\n')
  return (copy.textContent ?? '').replace(/[ \t\r\n]*\n[ \t\r\n]*/g, '\n').replace(/[ \t]+/g, ' ').trim()
}

/**
 * 클립보드 HTML 에 표가 하나 있고 첫 행이 전부 `<th>` 면 읽는다. 아니면 null (브라우저 밖에서도 null).
 * tsv-view 표의 줄 번호 칸(`.tsv-view-rownum`)과 "조건에 맞는 행이 없습니다" 행은 뺀다.
 */
export function parseHtmlTable(html: string): HeadedBlock | null {
  if (!html || !/<th[\s>]/i.test(html) || typeof DOMParser === 'undefined') return null
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const tables = doc.querySelectorAll('table')
  if (tables.length !== 1) return null
  const cellsOf = (tr: Element) => [...tr.children].filter((el) => (el.tagName === 'TH' || el.tagName === 'TD') && !el.classList.contains('tsv-view-rownum'))
  const trs = [...tables[0].querySelectorAll('tr')].filter((tr) => !tr.querySelector('.is-empty'))
  if (trs.length === 0) return null
  const head = cellsOf(trs[0])
  if (head.length === 0 || !head.every((el) => el.tagName === 'TH')) return null
  return {
    header: head.map(htmlCellText),
    rows: trs.slice(1).map((tr) => fit(cellsOf(tr).map(htmlCellText), head.length)),
  }
}
