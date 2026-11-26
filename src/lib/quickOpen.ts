/**
 * 빠른 열기(`Ctrl+P`) 확장과 전체 검색(`Ctrl+Alt+F`)의 순수 함수 (ADOPT B1 · B2, DESIGN §47).
 *
 * - `parseQuickOpen`: 입력 규칙 — `이름:12` 그 줄로, `#제목` 지금 문서의 제목으로, 나머지는 이름 찾기.
 * - `headingsOf`: 마크다운 글의 제목 줄 (코드 펜스 안은 뺀다). 편집기 없이 글만으로 — 팔레트가 쓴다.
 * - `findInText`: 본문 찾기. 대소문자를 가리지 않는 그냥 글자 찾기(정규식 아님), 줄마다 맞은 자리.
 * - `tsvColumnAt`: TSV 줄의 글자 자리 → 열 번호 (전체 검색 결과를 그리드의 그 칸으로 열 때).
 */

export type QuickOpenQuery =
  | { kind: 'name'; name: string }
  /** `이름:12` — 1부터 세는 줄 */
  | { kind: 'line'; name: string; line: number }
  /** `#제목` — 지금 문서의 제목 */
  | { kind: 'heading'; text: string }

export function parseQuickOpen(query: string): QuickOpenQuery {
  const q = query.trim()
  if (q.startsWith('#')) return { kind: 'heading', text: q.replace(/^#+\s*/, '') }
  const m = /^(.*?):(\d+)$/.exec(q)
  if (m && m[1]) return { kind: 'line', name: m[1], line: Math.max(1, Number(m[2])) }
  return { kind: 'name', name: q }
}

export interface Heading {
  level: number
  text: string
  /** 1부터 세는 줄 */
  line: number
}

/** ATX 제목(`# …`). 코드 펜스(``` · ~~~) 안의 줄은 제목이 아니다 */
export function headingsOf(text: string): Heading[] {
  const out: Heading[] = []
  const lines = text.split(/\r?\n/)
  let fence: string | null = null
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i]
    const f = /^\s{0,3}(`{3,}|~{3,})/.exec(ln)
    if (f) {
      if (fence === null) fence = f[1][0]
      else if (f[1][0] === fence) fence = null
      continue
    }
    if (fence !== null) continue
    const h = /^\s{0,3}(#{1,6})(?:\s+(.*?))?\s*#*\s*$/.exec(ln)
    if (h) out.push({ level: h[1].length, text: (h[2] ?? '').replace(/\s+#+$/, '').trim(), line: i + 1 })
  }
  return out
}

export interface TextHit {
  /** 1부터 세는 줄 */
  line: number
  /** 줄 안의 글자 자리 (0부터) */
  col: number
  len: number
  /** 그 줄의 글 (길면 맞은 자리 둘레만 — `snippetOf`) */
  text: string
}

/** 한 줄에 맞은 자리가 여럿이면 줄 하나에 첫 자리만 — 결과 목록은 줄 단위다. max: 이 파일에서 볼 줄 수 */
export function findInText(text: string, query: string, max = 200): TextHit[] {
  const q = query.toLocaleLowerCase()
  if (!q) return []
  const out: TextHit[] = []
  const lower = text.toLocaleLowerCase()
  // 대소문자를 바꿔도 길이가 같은 글자만 다룬다 — 다르면(드문 글자) 원문으로 찾는다
  const hay = lower.length === text.length ? lower : text
  let from = 0
  let line = 1
  let lineStart = 0
  let idx = hay.indexOf(hay === lower ? q : query, 0)
  while (idx !== -1 && out.length < max) {
    // idx 가 든 줄까지 줄 번호를 센다
    for (let i = from; i < idx; i++) if (text.charCodeAt(i) === 10) { line++; lineStart = i + 1 }
    let lineEnd = text.indexOf('\n', idx)
    if (lineEnd === -1) lineEnd = text.length
    const raw = text.slice(lineStart, lineEnd).replace(/\r$/, '')
    out.push({ line, col: idx - lineStart, len: query.length, text: raw })
    // 다음 줄부터
    from = lineEnd
    idx = lineEnd >= text.length ? -1 : hay.indexOf(hay === lower ? q : query, lineEnd)
  }
  return out
}

/** 긴 줄은 맞은 자리 둘레만 — 앞 40자 · 뒤 120자. 앞을 잘랐으면 `…` 를 붙이고, 맞은 자리를 다시 센다 */
export function snippetOf(hit: TextHit, before = 40, after = 120): { text: string; col: number } {
  const t = hit.text.replace(/\t/g, ' ')
  if (t.length <= before + after) return { text: t, col: hit.col }
  const start = Math.max(0, hit.col - before)
  const end = Math.min(t.length, hit.col + hit.len + after)
  const head = start > 0 ? '…' : ''
  return { text: head + t.slice(start, end) + (end < t.length ? '…' : ''), col: hit.col - start + head.length }
}

/** TSV 줄에서 글자 자리가 든 열 (앞의 탭 수) */
export function tsvColumnAt(lineText: string, col: number): number {
  let n = 0
  for (let i = 0; i < col && i < lineText.length; i++) if (lineText.charCodeAt(i) === 9) n++
  return n
}
