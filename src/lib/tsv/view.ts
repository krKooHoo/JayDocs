import type { TsvTable } from './model'
import { moveSpan } from './edits'

/**
 * 그리드의 보기 상태 — 정렬 · 값 필터 · 열 숨기기 (ADOPT E1 · DESIGN §61). 전부 순수 함수.
 *
 * **보기 전용이다.** 파일의 행 순서와 내용은 그대로 두고, 그리드가 보여 줄 순서(`viewOrder`)만 계산한다.
 * 그리드는 "보이는 행 번호(vr)" 로 움직이고, 고칠 때만 실제 행 번호로 바꿔 쓴다(`editInView`) — 그래서 바꾼 셀의 행만 diff 에 나온다.
 *
 * - 머리글 행(타입 행 · 머리글)은 늘 맨 위 그대로다. 정렬 · 필터는 본문 행만.
 * - 순서는 정렬 · 필터를 고른 때 한 번 정하고, 셀을 고쳐도 그대로 둔다(고친 행이 눈앞에서 사라지지 않게).
 *   다시 맞추려면 정렬 · 필터를 다시 고른다. 행 수가 바뀌면(행 삭제 · 되돌리기) 다시 계산한다 — 그건 부르는 쪽이 정한다.
 * - 검증(Key 중복 등)은 보기와 상관없이 늘 파일 전체를 본다. 이 모듈은 검증에 관여하지 않는다.
 */

export interface SortSpec {
  c: number
  /** 1 오름차순, -1 내림차순 */
  dir: 1 | -1
}

/** 열 하나의 값 필터 — 체크를 푼 값(빈 칸은 ''). 새로 생긴 값은 보인다 (Sheets 와 같다) */
export interface ColumnFilter {
  c: number
  excluded: readonly string[]
}

export interface ViewSpec {
  sort: SortSpec | null
  filters: readonly ColumnFilter[]
  /** 숨긴 열 (오름차순) */
  hidden: readonly number[]
  /** 이 보기가 맞는 표의 열 수. 열 수가 다른 표에는 쓰지 않는다 (열 번호가 어긋나므로) */
  width: number
}

export function emptyView(width: number): ViewSpec {
  return { sort: null, filters: [], hidden: [], width }
}

/** 정렬이나 필터가 걸려 있다 — 보이는 행 순서가 파일과 다를 수 있다 */
export function rowsViewed(v: ViewSpec): boolean {
  return v.sort !== null || v.filters.length > 0
}

export function hasView(v: ViewSpec): boolean {
  return rowsViewed(v) || v.hidden.length > 0
}

/** 정렬 · 필터 중에 막는 편집의 알림 */
export const VIEW_BLOCKED = '정렬 · 필터 중에는 행 넣기 · 복제 · 옮기기 · 채우기를 하지 않습니다 — 보이는 순서가 파일의 행 순서와 달라서. 상태 줄의 "정렬 해제" · "필터 해제" 뒤에 하세요'
export const VIEW_PASTE_BLOCKED = '정렬 · 필터 중에는 보이는 행을 넘는 붙여넣기 · 머리글이 있는 표 붙여넣기를 하지 않습니다 — 행이 늘어나서. 정렬 · 필터를 푼 뒤에 붙여넣으세요'

// ---------------------------------------------------------------- 정렬

const NUM = /^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i
const collator = new Intl.Collator('ko', { numeric: true, sensitivity: 'base' })

function asNumber(v: string): number | null {
  const s = v.trim()
  if (!NUM.test(s)) return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

/**
 * 두 값의 오름차순 비교. 숫자끼리는 수로, 숫자는 글자보다 앞, 글자는 한국어 · 자연 순서(Item2 < Item10)로.
 * 빈 칸은 여기서 다루지 않는다 — `viewOrder` 가 방향과 상관없이 맨 뒤로 보낸다 (Sheets · Excel 과 같다)
 */
export function compareValues(a: string, b: string): number {
  const x = asNumber(a)
  const y = asNumber(b)
  if (x !== null && y !== null) return x - y
  if (x !== null) return -1
  if (y !== null) return 1
  return collator.compare(a, b)
}

/** 보일 본문 행(실제 행 번호)을 보일 순서대로. 정렬이 같으면 파일 순서 */
export function viewOrder(t: TsvTable, headerRows: number, v: ViewSpec): number[] {
  const out: number[] = []
  const filters = v.filters.map((f) => ({ c: f.c, ex: new Set(f.excluded) }))
  for (let r = headerRows; r < t.rows.length; r++) {
    const cells = t.rows[r].cells
    if (filters.every((f) => !f.ex.has(cells[f.c] ?? ''))) out.push(r)
  }
  const s = v.sort
  if (!s) return out
  // 값과 수를 행마다 한 번만 읽는다 (비교마다 읽으면 2만 행에서 몇 배 느리다). 비교 규칙은 compareValues 와 같다
  // 글자 값은 서로 다른 값만 한 번 줄 세워 순위로 비교한다 (같은 값이 많은 열에서 collator 호출이 크게 준다)
  const str = new Map<number, string>()
  const num = new Map<number, number | null>()
  const words = new Set<string>()
  for (const r of out) {
    const x = t.rows[r].cells[s.c] ?? ''
    const n = asNumber(x)
    str.set(r, x)
    num.set(r, n)
    if (n === null && x !== '') words.add(x)
  }
  const rank = new Map([...words].sort(collator.compare).map((w, i) => [w, i]))
  return out.sort((a, b) => {
    const va = str.get(a)!
    const vb = str.get(b)!
    if (va === '' || vb === '') return va === vb ? a - b : va === '' ? 1 : -1
    const x = num.get(a)!
    const y = num.get(b)!
    const d = x !== null && y !== null ? x - y : x !== null ? -1 : y !== null ? 1 : rank.get(va)! - rank.get(vb)!
    return d * s.dir || a - b
  })
}

// ---------------------------------------------------------------- 보이는 행 ↔ 실제 행

export interface RowView {
  headerRows: number
  /** 보이는 본문 행 → 실제 행 */
  order: readonly number[]
  /** 그리드가 그릴 표 — 머리글 행 + order 의 행 (행 객체는 원래 표와 같은 것) */
  table: TsvTable
  /** 보이는 행 번호 → 실제 행 번호 */
  toActual(vr: number): number
  /** 실제 행 번호 → 보이는 행 번호. 걸러져 안 보이면 -1 */
  toView(r: number): number
}

export function makeRowView(t: TsvTable, headerRows: number, order: readonly number[]): RowView {
  const h = Math.min(headerRows, t.rows.length)
  const rows = t.rows.slice(0, h)
  for (const r of order) rows.push(t.rows[r])
  const pos = new Int32Array(t.rows.length).fill(-1)
  for (let i = 0; i < h; i++) pos[i] = i
  order.forEach((r, i) => { pos[r] = h + i })
  return {
    headerRows: h,
    order,
    table: { ...t, rows },
    toActual: (vr) => (vr < h ? vr : order[vr - h] ?? t.rows.length + (vr - h - order.length)),
    toView: (r) => (r >= 0 && r < pos.length ? pos[r] : -1),
  }
}

/**
 * 보이는 표에 대한 편집을 실제 표에 옮긴다. fn 은 보이는 표(같은 순서 · 같은 행 객체)를 받아 고친다.
 * 바뀐 행 객체만 제자리(실제 행)에 넣는다 — 다른 행은 그대로라 파일에서 그 행만 바뀐다.
 * 행 수나 열 수가 바뀌는 편집은 옮기지 않고 t 를 그대로 돌려준다 (부르는 쪽이 미리 막고 알린다).
 */
export function editInView(t: TsvTable, rv: RowView, fn: (vt: TsvTable) => TsvTable): TsvTable {
  if (rv.order.some((r) => r >= t.rows.length)) return t
  const rows = t.rows.slice(0, rv.headerRows)
  for (const r of rv.order) rows.push(t.rows[r])
  const vt: TsvTable = { ...t, rows }
  const next = fn(vt)
  if (next === vt) return t
  if (next.rows.length !== rows.length || next.width !== t.width) return t
  let out: TsvTable['rows'][number][] | null = null
  for (let i = 0; i < rows.length; i++) {
    if (next.rows[i] === rows[i]) continue
    out ??= [...t.rows]
    out[rv.toActual(i)] = next.rows[i]
  }
  const { rows: _drop, ...rest } = next
  void _drop
  return out ? { ...rest, rows: out } : { ...t, ...rest, rows: t.rows }
}

/** 실제 행 여러 개를 지운다 (정렬 · 필터 중의 행 삭제 — 이어지지 않을 수 있다) */
export function deleteRowSet(t: TsvTable, rows: readonly number[]): TsvTable {
  const drop = new Set(rows.filter((r) => r >= 0 && r < t.rows.length))
  if (drop.size === 0) return t
  return { ...t, rows: t.rows.filter((_, r) => !drop.has(r)) }
}

/** 보이는 행 범위 vr1..vr2 → 실제 행 번호 (보이는 순서) */
export function actualRows(rv: RowView, vr1: number, vr2: number): number[] {
  const out: number[] = []
  for (let vr = vr1; vr <= vr2 && vr < rv.table.rows.length; vr++) out.push(rv.toActual(vr))
  return out
}

// ---------------------------------------------------------------- 값 목록 (필터)

export interface ValueCount {
  value: string
  count: number
}

/** 열의 본문 값과 개수 — 오름차순, 빈 칸은 맨 뒤 */
export function distinctValues(t: TsvTable, headerRows: number, c: number): ValueCount[] {
  const counts = new Map<string, number>()
  for (let r = headerRows; r < t.rows.length; r++) {
    const v = t.rows[r].cells[c] ?? ''
    counts.set(v, (counts.get(v) ?? 0) + 1)
  }
  return [...counts]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => (a.value === '' ? 1 : b.value === '' ? -1 : compareValues(a.value, b.value)))
}

// ---------------------------------------------------------------- 보기 바꾸기

export function withSort(v: ViewSpec, c: number, dir: 1 | -1): ViewSpec {
  return { ...v, sort: { c, dir } }
}

export function withoutSort(v: ViewSpec): ViewSpec {
  return { ...v, sort: null }
}

/** 열 c 의 필터를 바꾼다. excluded 가 비면 그 열의 필터를 푼다 */
export function withFilter(v: ViewSpec, c: number, excluded: readonly string[]): ViewSpec {
  const rest = v.filters.filter((f) => f.c !== c)
  return { ...v, filters: excluded.length ? [...rest, { c, excluded: [...excluded] }].sort((a, b) => a.c - b.c) : rest }
}

export function withoutFilters(v: ViewSpec): ViewSpec {
  return { ...v, filters: [] }
}

export function filterOf(v: ViewSpec, c: number): ColumnFilter | undefined {
  return v.filters.find((f) => f.c === c)
}

/** 열 c1..c2 를 숨긴다. 모든 열이 숨게 되면 null */
export function hideColumns(v: ViewSpec, c1: number, c2: number): ViewSpec | null {
  const set = new Set(v.hidden)
  for (let c = c1; c <= c2; c++) if (c >= 0 && c < v.width) set.add(c)
  if (set.size >= v.width) return null
  return { ...v, hidden: [...set].sort((a, b) => a - b) }
}

export function showAllColumns(v: ViewSpec): ViewSpec {
  return { ...v, hidden: [] }
}

/** c 에서 dir 쪽으로 첫 보이는 열 (c 가 보이면 c). 그쪽에 없으면 반대쪽으로 */
export function visibleColumn(c: number, dir: 1 | -1, width: number, hidden: ReadonlySet<number>): number {
  const cc = Math.max(0, Math.min(width - 1, c))
  for (let x = cc; x >= 0 && x < width; x += dir) if (!hidden.has(x)) return x
  for (let x = cc; x >= 0 && x < width; x -= dir) if (!hidden.has(x)) return x
  return cc
}

/** c 에서 한 칸(dir) 옆의 보이는 열. 더 없으면 c */
export function stepColumn(c: number, dir: 1 | -1, width: number, hidden: ReadonlySet<number>): number {
  for (let x = c + dir; x >= 0 && x < width; x += dir) if (!hidden.has(x)) return x
  return c
}

// ---------------------------------------------------------------- 열을 넣고 · 지우고 · 옮길 때

/** 옛 열 번호 → 새 열 번호 (지워졌으면 null) */
export type ColumnMap = (c: number) => number | null

export const mapInsert = (at: number, n: number): ColumnMap => (c) => (c >= at ? c + n : c)
export const mapDelete = (at: number, n: number): ColumnMap => (c) => (c < at ? c : c < at + n ? null : c - n)
export function mapMove(width: number, from: number, count: number, to: number): ColumnMap {
  const next = moveSpan(Array.from({ length: width }, (_, i) => i), from, count, to)
  const pos = new Map(next.map((old, i) => [old, i]))
  return (c) => pos.get(c) ?? c
}

/** 열 조작 뒤의 보기 — 정렬 · 필터 · 숨김이 같은 열을 따라간다. 지운 열의 정렬 · 필터 · 숨김은 사라진다 */
export function remapColumns(v: ViewSpec, map: ColumnMap, width: number): ViewSpec {
  const sc = v.sort ? map(v.sort.c) : null
  const filters: ColumnFilter[] = []
  for (const f of v.filters) { const c = map(f.c); if (c !== null) filters.push({ c, excluded: f.excluded }) }
  const hidden: number[] = []
  for (const h of v.hidden) { const c = map(h); if (c !== null) hidden.push(c) }
  return {
    sort: v.sort && sc !== null ? { c: sc, dir: v.sort.dir } : null,
    filters: filters.sort((a, b) => a.c - b.c),
    hidden: hidden.sort((a, b) => a - b).filter((c, i, a) => a.indexOf(c) === i && c < width),
    width,
  }
}

// ---------------------------------------------------------------- 폭 맞춤

/** 셀 글의 화면 폭 어림(px) — 그리드 글꼴 13px 기준. 넓은 글자 13, ASCII 7.3, 나머지 9 */
export function textWidth(s: string): number {
  let w = 0
  for (const ch of s) {
    const code = ch.codePointAt(0) ?? 0
    w += code > 0x2e80 ? 13 : code < 0x80 ? 7.3 : 9
  }
  return w
}

/** 열 c 의 모든 행(머리글 포함)이 한 줄에 들어갈 폭. min..max 로 자른다. 칸 안 줄바꿈은 그리드처럼 ↵ 로 센다 */
export function fitColumnWidth(t: TsvTable, c: number, min: number, max: number, pad = 18): number {
  let w = 0
  for (const row of t.rows) {
    const v = row.cells[c]
    if (!v) continue
    w = Math.max(w, textWidth(v.includes('\n') ? v.replace(/\r?\n/g, ' ↵ ') : v))
  }
  return Math.round(Math.min(max, Math.max(min, w + pad)))
}
