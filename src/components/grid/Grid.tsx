import './grid-extras.css'
import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { cellAt, type TsvRow, type TsvTable } from '../../lib/tsv/model'
import { columnLetter, isNumericType, type ColumnSchema, type TableSchema } from '../../lib/tsv/schema'
import { issueKey, type Validation } from '../../lib/tsv/validate'
import { fillDown, fillRange, fillRight, fillSeries, fillTarget, moveSpan, pasteBlock, pasteHeadedBlock, rangeBlock, setCell, type CellRange } from '../../lib/tsv/edits'
import { formatClipboardTsv, parseClipboardTsv } from '../../lib/tsv/clipboard'
import { parseHtmlTable, parseMarkdownTable } from '../../lib/tsv/mdTable'
import { sanitizeFor } from '../../lib/tsv/table'
import type { CalcCell } from '../../lib/calc/calc'
import { splitCellSpaces, useInvisibles } from '../../lib/invisibles'
import { editInView, fitColumnWidth, stepColumn, textWidth, visibleColumn, VIEW_BLOCKED, VIEW_PASTE_BLOCKED, type RowView, type SortSpec } from '../../lib/tsv/view'

/**
 * 자체 DOM 그리드 (DESIGN D3). 상태는 활성 셀(부모가 쥔다)과 범위 선택의 기준점(anchor)뿐이고
 * 표(TsvTable) 는 그리기만 한다 — 편집은 onEdit 으로 올려 보낸다.
 *
 * 입력은 항상 떠 있는 <textarea> 하나가 받는다. 셀을 고르면 그 위(1×1, 투명)에 두고 포커스를 준다.
 * 글자가 들어오면(input / compositionstart) 그때 편집 모드로 커진다. 한글 조합이 textarea 안에서 시작되므로
 * 첫 자모가 사라지는 문제(§3.3)가 구조적으로 없다. 조합 중(isComposing / keyCode 229)에는 키를 가로채지 않는다.
 *
 * 키는 Google Sheets · Excel 의 기본 키를 따른다 (SHORTCUTS.md "TSV 그리드").
 *
 * 마우스 끌기 세 가지(열 너비 · 채우기 핸들 · 열 글자로 열 옮기기)는 window 리스너 하나가 받는다.
 * 범위 오른쪽 아래의 채우기 핸들은 fillSeries, 열 옮기기는 onMoveColumns(확인은 부모가)로 올려 보낸다.
 */
export const ROW_H = 26
const LETTER_H = 22
const ROWNUM_W = 48
const MIN_COL = 56
const MAX_COL = 420

export interface CellPos {
  r: number
  c: number
}

export interface GridHandle {
  focus(): void
  /** 지금 선택된 범위 (활성 셀 하나뿐이면 1×1) */
  range(): CellRange
  clearRange(): void
  /** 선택(기준점 · 활성 셀)을 dr 행만큼 옮긴다 — 행을 옮기거나 복제한 뒤 선택이 그 행을 따라가게 */
  shiftRows(dr: number): void
  /** 열 c1..c2 의 폭을 내용에 맞춘다 (숨긴 열은 빼고) — 열 경계 두 번 누르기와 같다 (DESIGN §61) */
  fitColumns(c1: number, c2: number): void
}

/** dup: 복제하고 선택을 복제본으로 (Shift+Alt+↓), dupKeep: 복제하고 선택은 그대로 (Shift+Alt+↑), moveUp · moveDown: 한 칸 옮기기 (Alt+↑ / ↓) */
export type RowOp = 'above' | 'below' | 'append' | 'dup' | 'dupKeep' | 'del' | 'moveUp' | 'moveDown'
export type ColOp = 'left' | 'right' | 'del'

export interface GridProps {
  table: TsvTable
  schema: TableSchema
  validation: Validation
  active: CellPos
  onActiveChange: (p: CellPos) => void
  onEdit: (fn: (t: TsvTable) => TsvTable) => void
  onUndo: () => void
  onRedo: () => void
  /** 알림 줄에 알린다. undo: 방금 한 편집을 되돌리는 버튼을 단다 (onEdit 바로 뒤에 불러야 한다) */
  onNotice: (msg: string, opts?: { undo?: boolean }) => void
  /** 행/열 조작 (단축키에서). 범위를 함께 보낸다 */
  onRowOp: (kind: RowOp, range: CellRange) => void
  /** 실제로 바꿨으면 true (읽기 전용 · 못 하는 조작이면 false) */
  onColOp: (kind: ColOp, range: CellRange) => boolean
  /** 열 글자를 끌어 옮기기. to 는 옮긴 뒤 첫 열의 자리. 실제로 옮겼으면(읽기 전용이 아니면) true */
  onMoveColumns: (from: number, count: number, to: number) => boolean
  /** Ctrl+F / Ctrl+H — 찾기 막대 열기 (withReplace 면 바꾸기 칸으로) */
  onFind: (withReplace: boolean) => void
  /** F3 / Shift+F3 — 다음 / 이전 찾기 */
  onFindStep: (dir: 1 | -1) => void
  /** 찾기에 걸린 셀 (issueKey 와 같은 r * width + c) */
  matches: ReadonlySet<number>
  /** 계산식이 걸린 셀 (issueKey 키). stale 이면 F9 로 바뀔 셀 */
  calcCells: ReadonlyMap<number, CalcCell>
  /** F9 — 계산식 적용 */
  onCalc: () => void
  /** 열 너비를 기억할 localStorage 키 */
  widthsKey: string
  /** 선택 범위가 바뀌면 (상태 줄의 선택 요약 — DESIGN §32) */
  onRangeChange?: (range: CellRange) => void
  /**
   * 정렬 · 필터 중이면 보이는 행 (DESIGN §61). 그리드는 보이는 행 번호로 움직이고 그린다 —
   * active · onActiveChange 는 실제 행 번호 그대로, onEdit 은 보이는 표에 대한 편집을 실제 표로 옮겨 부른다.
   * range() · onRangeChange 의 범위는 보이는 행 번호다
   */
  rowView?: RowView | null
  /** 숨긴 열 — 폭 0 으로 그리지 않고, 방향키는 건너뛴다 */
  hiddenCols?: ReadonlySet<number>
  /** 열 글자의 표시 — 정렬한 열 · 거른 열 */
  sort?: SortSpec | null
  filteredCols?: ReadonlySet<number>
}

const NO_COLS: ReadonlySet<number> = new Set()

interface Editing {
  r: number
  c: number
  mode: 'replace' | 'edit'
}

type Move = 'up' | 'down' | 'left' | 'right'

// ---------------------------------------------------------------- 열 너비
function estimateWidths(table: TsvTable): number[] {
  const out: number[] = []
  const limit = Math.min(table.rows.length, 300)
  for (let c = 0; c < table.width; c++) {
    let w = 0
    for (let r = 0; r < limit; r++) {
      const v = table.rows[r].cells[c]
      if (v) w = Math.max(w, textWidth(v))
    }
    out.push(Math.round(Math.min(MAX_COL, Math.max(MIN_COL, w + 18))))
  }
  return out
}

function loadWidths(key: string, width: number): number[] | null {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const arr = JSON.parse(raw) as unknown
    if (Array.isArray(arr) && arr.length === width && arr.every((n) => typeof n === 'number')) return arr as number[]
  } catch { /* 깨진 값은 버린다 */ }
  return null
}

function saveWidths(key: string, ws: readonly number[]) {
  try { localStorage.setItem(key, JSON.stringify(ws)) } catch { /* 무시 */ }
}

function isBoolText(v: string) {
  return v === '' || /^(true|false)$/i.test(v)
}

function columnTitle(col: ColumnSchema): string {
  const parts: string[] = []
  parts.push(`${col.name || columnLetter(col.index)} · ${col.type === 'comment' ? '주석 열' : col.type}${col.list ? ' (리스트)' : ''}`)
  if (col.description) parts.push(col.description)
  for (const n of col.notes) parts.push(`${n.label}: ${n.text}`)
  if (col.enumValues?.length) parts.push(`허용 값${col.enumSource === 'column' ? ' (열에 있는 값)' : ''}: ${col.enumValues.join(', ')}`)
  parts.push('클릭: 열 선택 · 끌기: 열 옮기기 · 오른쪽 끝 끌기: 너비')
  return parts.join('\n')
}

function normalizeRange(a: CellPos, b: CellPos): CellRange {
  return { r1: Math.min(a.r, b.r), c1: Math.min(a.c, b.c), r2: Math.max(a.r, b.r), c2: Math.max(a.c, b.c) }
}

function sameRange(a: CellRange | null, b: CellRange | null): boolean {
  if (!a || !b) return a === b
  return a.r1 === b.r1 && a.c1 === b.c1 && a.r2 === b.r2 && a.c2 === b.c2
}

// ---------------------------------------------------------------- 셀 · 행
interface CellProps {
  r: number
  c: number
  v: string
  col: ColumnSchema
  w: number
  active: boolean
  selected: boolean
  /** 찾기에 걸린 셀 */
  match: boolean
  /** 채우기 핸들로 채울 자리 (끄는 중) */
  fill: boolean
  /** 계산식이 걸린 셀 */
  calc: CalcCell | undefined
  issue: string | undefined
  head: boolean
  /** 보이지 않는 문자 보이기 (DESIGN §55) — 앞뒤 공백 · 탭 */
  inv: boolean
}

/** 셀 글 — 칸 안 줄바꿈은 늘 ↵, 보이지 않는 문자를 켜면 앞뒤 공백 · · 탭 → */
function cellText(v: string, inv: boolean) {
  const t = v.includes('\n') ? v.replace(/\r?\n/g, ' ↵ ') : v
  if (!inv) return t
  const [lead, core, trail] = splitCellSpaces(t)
  if (!lead && !trail && core === t) return t
  return (
    <>
      {lead > 0 && <span className="grid-ws">{'·'.repeat(lead)}</span>}
      {core}
      {trail > 0 && <span className="grid-ws">{'·'.repeat(trail)}</span>}
    </>
  )
}

const Cell = memo(function Cell({ r, c, v, col, w, active, selected, match, fill, calc, issue, head, inv }: CellProps) {
  let cls = 'grid-cell'
  if (col.type === 'comment') cls += ' is-comment'
  if (col.isKey) cls += ' is-key'
  if (!head && isNumericType(col.type)) cls += ' is-num'
  if (selected) cls += ' is-selected'
  if (match) cls += ' is-match'
  if (fill) cls += ' is-fill-target'
  if (calc) cls += calc.stale ? ' is-calc is-stale' : ' is-calc'
  if (active) cls += ' is-active'
  if (issue) cls += ' has-error'
  const bool = !head && col.type === 'bool' && isBoolText(v)
  let title = issue
  if (calc) {
    const f = `ƒ ${calc.rule.formula}${calc.stale ? ` → ${calc.computed} (F9 로 적용)` : ''}`
    title = issue ? `${issue}\n${f}` : f
  }
  return (
    <div className={cls} data-r={r} data-c={c} style={{ width: w }} title={title}>
      {bool ? (
        <span className="grid-bool" data-bool="1">
          <input type="checkbox" checked={/^true$/i.test(v)} readOnly tabIndex={-1} />
        </span>
      ) : (
        // CSV 칸 안 줄바꿈은 한 줄 높이에 ↵ 로 보인다 (편집하면 그대로 나온다)
        cellText(v, inv)
      )}
    </div>
  )
})

interface RowProps {
  row: TsvRow
  r: number
  /** 실제 행 번호 (정렬 · 필터 중이 아니면 r 과 같다) — 행 번호 칸 · 검증 · 찾기 · 계산식 셀의 키 */
  ar: number
  widths: number[]
  schema: TableSchema
  validation: Validation
  tableWidth: number
  totalWidth: number
  activeC: number
  /** 이 행에 걸친 선택 열 범위. 없으면 -1 */
  selC1: number
  selC2: number
  /** 이 행에 걸친 채우기 대상 열 범위. 없으면 -1 */
  fillC1: number
  fillC2: number
  matches: ReadonlySet<number>
  calcCells: ReadonlyMap<number, CalcCell>
  rowSelected: boolean
  head: boolean
  /** 본문 행의 세로 위치(px). style 객체를 props 로 넘기면 매 렌더 새 객체라 memo 가 깨져 스크롤마다 모든 행이 다시 그려진다 */
  top?: number
  inv: boolean
}

const Row = memo(function Row({ row, r, ar, widths, schema, validation, tableWidth, totalWidth, activeC, selC1, selC2, fillC1, fillC2, matches, calcCells, rowSelected, head, top, inv }: RowProps) {
  let cls = 'grid-row'
  cls += head ? ' is-head' : ' is-body'
  if (head && schema.typed && r === 0) cls += ' is-type'
  let numCls = 'grid-rownum'
  if (activeC >= 0 || rowSelected) numCls += ' is-active-row'
  if (ar !== r) numCls += ' is-viewed'
  return (
    <div className={cls} style={top === undefined ? { width: totalWidth } : { transform: `translateY(${top}px)`, width: totalWidth }}>
      {/* 정렬 · 필터 중에도 행 번호는 파일의 행 번호 (Excel 처럼) */}
      <div className={numCls} data-rownum={r} title={ar !== r ? `파일의 ${ar + 1}행 · 클릭: 행 선택` : '클릭: 행 선택'}>{ar + 1}</div>
      {/* 숨긴 열은 폭 0 — 그리지 않는다 */}
      {widths.map((w, c) => w === 0 ? null : (
        <Cell
          key={c}
          r={r}
          c={c}
          v={row.cells[c] ?? ''}
          col={schema.columns[c]}
          w={w}
          active={activeC === c}
          selected={selC1 >= 0 && c >= selC1 && c <= selC2}
          match={matches.size > 0 && matches.has(issueKey(tableWidth, ar, c))}
          fill={fillC1 >= 0 && c >= fillC1 && c <= fillC2}
          calc={calcCells.size > 0 ? calcCells.get(issueKey(tableWidth, ar, c)) : undefined}
          issue={validation.issues.get(issueKey(tableWidth, ar, c))}
          head={head}
          inv={inv}
        />
      ))}
    </div>
  )
})

// ---------------------------------------------------------------- 그리드
export const Grid = forwardRef<GridHandle, GridProps>(function Grid(p, ref) {
  const { schema, validation, onUndo, onRedo, onNotice, onRowOp, onColOp, onMoveColumns, onFind, onFindStep, matches, calcCells, onCalc } = p
  // ---- 보기 (정렬 · 필터 · 숨긴 열, DESIGN §61). 아래의 table · active · onEdit 은 모두 "보이는 행" 기준이다
  const rowView = p.rowView ?? null
  const hidden = p.hiddenCols ?? NO_COLS
  const realTable = p.table
  const table = rowView ? rowView.table : realTable
  const pActive = p.active
  const activeVr = rowView ? rowView.toView(pActive.r) : pActive.r
  // 걸러져 안 보이는 행이면 잠깐 첫 본문 행으로 그린다 (창이 곧 보이는 행으로 옮긴다)
  const activeR = activeVr >= 0 ? activeVr : Math.min(rowView?.headerRows ?? 0, Math.max(0, table.rows.length - 1))
  const active = useMemo<CellPos>(() => ({ r: activeR, c: pActive.c }), [activeR, pActive.c])
  const parentActive = p.onActiveChange
  const onActiveChange = useCallback((v: CellPos) => parentActive(rowView ? { r: rowView.toActual(v.r), c: v.c } : v), [rowView, parentActive])
  const parentEdit = p.onEdit
  const onEdit = useCallback((fn: (t: TsvTable) => TsvTable) => parentEdit(rowView ? (t) => editInView(t, rowView, fn) : fn), [rowView, parentEdit])
  const headerRows = schema.headerRows
  const headerH = LETTER_H + headerRows * ROW_H
  const bodyCount = Math.max(0, table.rows.length - headerRows)
  const maxR = Math.max(0, table.rows.length - 1)
  const maxC = Math.max(0, table.width - 1)

  const scrollRef = useRef<HTMLDivElement>(null)
  const ta = useRef<HTMLTextAreaElement>(null)
  const inv = useInvisibles()
  const [scroll, setScroll] = useState({ top: 0, left: 0 })
  const [editing, setEditing] = useState<Editing | null>(null)
  const [draft, setDraft] = useState('')
  const [ddActive, setDdActive] = useState<number | null>(null)
  /** 범위 선택의 기준점. null 이면 활성 셀 하나만 선택 */
  const [anchor, setAnchor] = useState<CellPos | null>(null)
  const dragging = useRef(false)

  const range = useMemo<CellRange>(() => {
    const a = anchor ? { r: Math.min(anchor.r, maxR), c: Math.min(anchor.c, maxC) } : active
    return normalizeRange(a, active)
  }, [anchor, active, maxR, maxC])
  // 보이는 순서가 새로 정해지면(정렬 · 필터를 고르거나 풀면) 범위를 푼다 — 보이는 행 번호의 범위가 다른 행들을 가리키게 되므로
  const viewOrderKey = rowView?.order
  useEffect(() => { setAnchor(null) }, [viewOrderKey])
  const multi = range.r1 !== range.r2 || range.c1 !== range.c2
  const onRangeChange = p.onRangeChange
  useEffect(() => { onRangeChange?.(range) }, [range, onRangeChange])

  // ---- 열 너비. 열 수가 바뀐 그 렌더에서 바로 길이를 맞춘다 — effect 로 한 박자 늦추면
  // 열 삭제 직후 옛 너비 배열이 없는 열(schema.columns[c] = undefined)을 그리려다 터진다 (TC-307)
  const [savedWidths, setWidths] = useState<number[]>(() => loadWidths(p.widthsKey, realTable.width) ?? estimateWidths(realTable))
  const widths = useMemo(
    () => (savedWidths.length === realTable.width ? savedWidths : loadWidths(p.widthsKey, realTable.width) ?? estimateWidths(realTable)),
    [savedWidths, realTable, p.widthsKey],
  )
  useEffect(() => {
    if (widths !== savedWidths) setWidths(widths)
  }, [widths, savedWidths])
  /** 그릴 폭 — 숨긴 열은 0 (그리지 않는다) */
  const shown = useMemo(() => (hidden.size ? widths.map((w, c) => (hidden.has(c) ? 0 : w)) : widths), [widths, hidden])
  const offsets = useMemo(() => {
    const out: number[] = []
    let x = 0
    for (const w of shown) { out.push(x); x += w }
    return out
  }, [shown])
  const totalWidth = ROWNUM_W + (offsets.length ? offsets[offsets.length - 1] + shown[shown.length - 1] : 0)
  /** 열 c1..c2 의 폭을 내용에 맞춘다 (DESIGN §61) — 숨긴 열은 그대로 */
  const fitColumns = useCallback((c1: number, c2: number) => {
    const next = widths.map((w, c) => (c >= c1 && c <= c2 && !hidden.has(c) ? fitColumnWidth(realTable, c, MIN_COL, MAX_COL * 2) : w))
    setWidths(next)
    saveWidths(p.widthsKey, next)
  }, [widths, hidden, realTable, p.widthsKey])

  const resizing = useRef<{ c: number; startX: number; startW: number } | null>(null)
  /** 채우기 핸들을 끄는 중: 원본 범위 */
  const filling = useRef<CellRange | null>(null)
  /** 끄는 동안 보여 줄 채울 범위. null 이면 끄는 중이 아니다 */
  const [fillDrag, setFillDrag] = useState<{ target: CellRange | null } | null>(null)
  /** 열 글자를 누른 채: 옮길 열들. 6px 넘게 움직이면 moved */
  const colDrag = useRef<{ from: number; count: number; pressed: number; startX: number; keepSel: boolean; moved: boolean } | null>(null)
  /** 열을 끄는 중이면 놓을 경계(0..width, 제자리면 null) */
  const [colDrop, setColDrop] = useState<{ at: number | null } | null>(null)
  /** window 리스너는 한 번만 달고, 채우기·열 끌기는 최신 렌더의 처리기를 부른다 */
  const drag = useRef<{ move(e: MouseEvent): void; up(e: MouseEvent): void }>({ move() {}, up() {} })
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const rs = resizing.current
      if (!rs) { drag.current.move(e); return }
      const w = Math.max(MIN_COL, Math.min(MAX_COL * 2, rs.startW + e.clientX - rs.startX))
      setWidths((ws) => ws.map((x, i) => (i === rs.c ? w : x)))
    }
    const onUp = (e: MouseEvent) => {
      dragging.current = false
      if (!resizing.current) { drag.current.up(e); return }
      resizing.current = null
      setWidths((ws) => { saveWidths(p.widthsKey, ws); return ws })
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
  }, [p.widthsKey])

  // ---- 가상화
  // ---- 행 윈도잉. 행 높이가 고정이라 직접 계산한다.
  // (@tanstack/react-virtual 을 썼더니 숨은 탭에서 마운트된 그리드가 보이게 된 뒤에도 높이 0 으로 남아 행을 안 그리는 일이 있었다.
  //  보이는 높이를 아직 모르면 창 높이로 넉넉히 잡아 어떤 경우에도 행이 비지 않게 한다.)
  const [viewH, setViewH] = useState(0)
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setViewH(el.clientHeight))
    ro.observe(el)
    setViewH(el.clientHeight)
    return () => ro.disconnect()
  }, [])
  const OVERSCAN = 8
  const effectiveH = viewH > 0 ? viewH : window.innerHeight
  const firstRow = Math.max(0, Math.floor(scroll.top / ROW_H) - OVERSCAN)
  const lastRow = Math.min(bodyCount, Math.ceil((scroll.top + effectiveH) / ROW_H) + OVERSCAN)
  const virtualItems = Array.from({ length: Math.max(0, lastRow - firstRow) }, (_, k) => ({ index: firstRow + k, start: (firstRow + k) * ROW_H, key: firstRow + k }))
  const totalSize = bodyCount * ROW_H

  // ---- 활성 셀 보이게 스크롤
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el || widths.length === 0) return
    if (active.r >= headerRows) {
      const i = active.r - headerRows
      const top = i * ROW_H
      const bottom = top + ROW_H
      const viewH = el.clientHeight - headerH
      if (top < el.scrollTop) el.scrollTop = top
      else if (bottom > el.scrollTop + viewH) el.scrollTop = bottom - viewH
    }
    const left = offsets[active.c] ?? 0
    const right = left + (shown[active.c] ?? 0)
    const viewW = el.clientWidth - ROWNUM_W
    if (left < el.scrollLeft) el.scrollLeft = left
    else if (right > el.scrollLeft + viewW) el.scrollLeft = Math.max(0, right - viewW)
  }, [active, headerRows, headerH, offsets, shown, widths.length])

  const focusInput = useCallback(() => { ta.current?.focus({ preventScroll: true }) }, [])
  useImperativeHandle(ref, () => ({
    focus: focusInput,
    range: () => range,
    clearRange: () => setAnchor(null),
    shiftRows: (dr: number) => {
      if (anchor) setAnchor({ r: anchor.r + dr, c: anchor.c })
      onActiveChange({ r: active.r + dr, c: active.c })
    },
    fitColumns,
  }), [focusInput, range, anchor, active, onActiveChange, fitColumns])

  // ---- 선택 · 이동
  /** 활성 셀을 옮긴다. extend 면 범위를 넓힌다 (기준점 유지), 아니면 범위를 푼다 */
  const select = useCallback((pos: CellPos, extend = false) => {
    const c0 = Math.max(0, Math.min(maxC, pos.c))
    // 숨긴 열에는 서지 않는다 — 움직인 쪽으로 다음 보이는 열
    const c = hidden.size ? visibleColumn(c0, c0 >= active.c ? 1 : -1, maxC + 1, hidden) : c0
    const next = { r: Math.max(0, Math.min(maxR, pos.r)), c }
    if (extend) { if (!anchor) setAnchor(active) } else setAnchor(null)
    if (next.r !== active.r || next.c !== active.c) onActiveChange(next)
  }, [active, anchor, maxR, maxC, onActiveChange, hidden])

  const moveActive = useCallback((dir: Move, far = false, extend = false) => {
    let { r, c } = active
    if (dir === 'up') r = far ? 0 : r - 1
    if (dir === 'down') r = far ? maxR : r + 1
    if (dir === 'left') c = far ? 0 : stepColumn(c, -1, maxC + 1, hidden)
    if (dir === 'right') c = far ? maxC : stepColumn(c, 1, maxC + 1, hidden)
    select({ r, c }, extend)
  }, [active, maxR, maxC, select, hidden])

  const selectRows = useCallback((r1: number, r2: number) => {
    setAnchor({ r: Math.min(r1, r2), c: 0 })
    onActiveChange({ r: Math.max(r1, r2), c: maxC })
  }, [maxC, onActiveChange])
  /**
   * 열 전체 선택(Ctrl+Space · 열 글자)으로 고른 열. 범위가 그대로인 동안만 "열을 골랐다" 로 본다 —
   * Ctrl+Alt+= / - 가 열을 넣고 지운다 (DESIGN §41 K2). 행이 한두 개인 표에서 셀 범위를 열로 오해하지 않게 범위만으로 판단하지 않는다.
   */
  const colPick = useRef<{ c1: number; c2: number } | null>(null)
  const selectCols = useCallback((c1: number, c2: number) => {
    colPick.current = { c1: Math.min(c1, c2), c2: Math.max(c1, c2) }
    setAnchor({ r: 0, c: Math.min(c1, c2) })
    onActiveChange({ r: maxR, c: Math.max(c1, c2) })
  }, [maxR, onActiveChange])
  const isWholeCols = (g: CellRange) => {
    const pick = colPick.current
    return !!pick && g.r1 === 0 && g.r2 === maxR && g.c1 === pick.c1 && g.c2 === pick.c2
  }
  // 범위가 바뀌어 고른 열과 달라지면 잊는다
  useEffect(() => { if (!isWholeCols(range)) colPick.current = null })
  const selectAll = useCallback(() => {
    setAnchor({ r: 0, c: 0 })
    onActiveChange({ r: maxR, c: maxC })
  }, [maxR, maxC, onActiveChange])

  // ---- 편집 시작 · 확정 · 취소
  const startEdit = useCallback((mode: Editing['mode'], r = active.r, c = active.c) => {
    const el = ta.current
    if (!el || r >= table.rows.length) return
    if (mode === 'edit') {
      const cur = cellAt(table, r, c)
      el.value = cur
      el.setSelectionRange(cur.length, cur.length)
    }
    setAnchor(null)
    setEditing({ r, c, mode })
    setDraft(el.value)
    setDdActive(null)
    el.focus({ preventScroll: true })
  }, [active, table])

  const commitEdit = useCallback((move: Move | null, override?: string) => {
    const el = ta.current
    if (!editing || !el) return
    const [clean, changed] = sanitizeFor(table.format, override ?? el.value)
    if (changed) onNotice('탭·줄바꿈은 TSV 셀에 넣을 수 없어 공백으로 바꿨습니다')
    const { r, c } = editing
    onEdit((t) => setCell(t, r, c, clean))
    el.value = ''
    setEditing(null)
    setDraft('')
    setDdActive(null)
    if (move) moveActive(move)
  }, [editing, onEdit, onNotice, moveActive, table.format])

  const cancelEdit = useCallback(() => {
    const el = ta.current
    if (el) el.value = ''
    setEditing(null)
    setDraft('')
    setDdActive(null)
  }, [])

  const toggleBool = useCallback((r: number, c: number) => {
    const v = cellAt(table, r, c)
    const on = /^true$/i.test(v)
    let next = on ? 'FALSE' : 'TRUE'
    if (v !== '' && v === v.toLowerCase()) next = next.toLowerCase()
    onEdit((t) => setCell(t, r, c, next))
  }, [table, onEdit])

  // ---- enum 드롭다운
  const editCol = editing ? schema.columns[editing.c] : null
  const segment = useMemo(() => {
    if (!editCol) return ''
    return (editCol.list ? draft.slice(draft.lastIndexOf(',') + 1) : draft).trim()
  }, [draft, editCol])
  const ddItems = useMemo(() => {
    if (!editing || !editCol?.enumValues?.length) return null
    const q = segment.toLowerCase()
    return editCol.enumValues.filter((v) => v.toLowerCase().includes(q)).slice(0, 14)
  }, [editing, editCol, segment])
  const applyItem = useCallback((item: string): string => {
    if (!editCol?.list) return item
    const i = draft.lastIndexOf(',')
    if (i < 0) return item
    return `${draft.slice(0, i + 1).trimEnd()} ${item}`
  }, [editCol, draft])

  // ---- 범위 편집
  const clearRange = useCallback(() => {
    const g = range
    onEdit((t) => fillRange(t, g, ''))
  }, [range, onEdit])

  // ---- 끌기: 채우기 핸들 · 열 옮기기
  /** 내용 x(행 번호 칸 뺀, 스크롤 포함) → 열 번호 (0..width-1 로 붙인다) */
  const columnAt = (x: number): number => {
    let c = 0
    while (c < widths.length - 1 && x >= offsets[c + 1]) c++
    return hidden.size ? visibleColumn(c, -1, widths.length, hidden) : c
  }
  /** 화면 좌표 → 셀. 그리드 밖이면 보이는 가장자리로 붙인다. 표 끝 아래 빈 곳이면 표보다 큰 행 번호가 나온다 */
  const cellFromPoint = (x: number, y: number): CellPos => {
    const el = scrollRef.current
    if (!el) return active
    const rect = el.getBoundingClientRect()
    const cx = Math.max(0, Math.min(el.clientWidth - 1, x - rect.left))
    const cy = Math.max(0, Math.min(el.clientHeight - 1, y - rect.top))
    const r = headerRows > 0 && cy < headerH
      ? Math.max(0, Math.floor((cy - LETTER_H) / ROW_H))
      : headerRows + Math.floor((Math.max(cy, headerH) - headerH + el.scrollTop) / ROW_H)
    return { r, c: columnAt(cx - ROWNUM_W + el.scrollLeft) }
  }
  /** 화면 x → 가장 가까운 열 경계 (0..width) */
  const boundaryAt = (x: number): number => {
    const el = scrollRef.current
    if (!el || widths.length === 0) return 0
    const cx = x - el.getBoundingClientRect().left - ROWNUM_W + el.scrollLeft
    const c = columnAt(cx)
    return cx < offsets[c] + shown[c] / 2 ? c : c + 1
  }
  const applyFill = (src: CellRange, target: CellRange) => {
    const added = Math.max(0, target.r2 + 1 - table.rows.length)
    onEdit((t) => fillSeries(t, src, target))
    // 채운 뒤 선택은 원본 + 채운 곳. 활성 셀은 끈 쪽 끝 모서리로
    const u = { r1: Math.min(src.r1, target.r1), c1: Math.min(src.c1, target.c1), r2: Math.max(src.r2, target.r2), c2: Math.max(src.c2, target.c2) }
    const back = target.r1 < src.r1 || target.c1 < src.c1
    setAnchor(back ? { r: u.r2, c: u.c2 } : { r: u.r1, c: u.c1 })
    onActiveChange(back ? { r: u.r1, c: u.c1 } : { r: u.r2, c: u.c2 })
    if (added) onNotice(`행 ${added}개 추가`)
  }
  useLayoutEffect(() => {
    drag.current = {
      move(e) {
        const src = filling.current
        if (src) {
          // 창 밖에서 버튼을 놓으면 mouseup 이 안 온다 — 다음 움직임에서 버튼이 풀려 있으면 취소
          if (!(e.buttons & 1)) { filling.current = null; setFillDrag(null); return }
          const pt = cellFromPoint(e.clientX, e.clientY)
          const target = fillTarget(src, pt.r, pt.c)
          setFillDrag((cur) => (cur && sameRange(cur.target, target) ? cur : { target }))
          return
        }
        const cd = colDrag.current
        if (!cd) return
        if (!(e.buttons & 1)) { colDrag.current = null; setColDrop(null); return }
        if (!cd.moved && Math.abs(e.clientX - cd.startX) <= 6) return
        cd.moved = true
        const b = boundaryAt(e.clientX)
        const at = b < cd.from || b > cd.from + cd.count ? b : null
        setColDrop((cur) => (cur && cur.at === at ? cur : { at }))
      },
      up(e) {
        const src = filling.current
        if (src) {
          filling.current = null
          setFillDrag(null)
          const pt = cellFromPoint(e.clientX, e.clientY)
          const target = fillTarget(src, pt.r, pt.c)
          if (target) applyFill(src, target)
          focusInput()
          return
        }
        const cd = colDrag.current
        if (!cd) return
        colDrag.current = null
        setColDrop(null)
        if (!cd.moved) {
          // 선택한 여러 열 안을 눌렀다 떼기만 했으면 그 열 하나만 고른다 (Sheets 와 같다)
          if (cd.keepSel) selectCols(cd.pressed, cd.pressed)
          return
        }
        const b = boundaryAt(e.clientX)
        const to = b < cd.from ? b : b > cd.from + cd.count ? b - cd.count : -1
        if (to < 0 || !onMoveColumns(cd.from, cd.count, to)) return
        // 열 너비도 열을 따라간다
        const next = moveSpan(widths, cd.from, cd.count, to)
        setWidths(next)
        saveWidths(p.widthsKey, next)
        setAnchor({ r: 0, c: to })
        onActiveChange({ r: maxR, c: to + cd.count - 1 })
      },
    }
  })

  // ---- 키보드
  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return
    const mod = e.ctrlKey || e.metaKey
    const code = e.code
    if (editing) {
      switch (e.key) {
        case 'Enter': {
          e.preventDefault()
          // CSV 는 칸 안 줄바꿈을 담을 수 있다 — Excel 처럼 Alt+Enter 가 줄을 바꾼다
          if (e.altKey && table.format === 'csv') {
            const el = e.currentTarget
            el.setRangeText('\n', el.selectionStart, el.selectionEnd, 'end')
            setDraft(el.value)
            return
          }
          const pick = ddItems && ddActive !== null ? ddItems[ddActive] : undefined
          commitEdit(e.shiftKey ? 'up' : 'down', pick !== undefined ? applyItem(pick) : undefined)
          return
        }
        case 'Tab': {
          e.preventDefault()
          const pick = ddItems && ddActive !== null ? ddItems[ddActive] : undefined
          commitEdit(e.shiftKey ? 'left' : 'right', pick !== undefined ? applyItem(pick) : undefined)
          return
        }
        case 'Escape':
          e.preventDefault()
          cancelEdit()
          return
        case 'ArrowDown':
          if (ddItems?.length) { e.preventDefault(); setDdActive((i) => (i === null ? 0 : Math.min(ddItems.length - 1, i + 1))) }
          return
        case 'ArrowUp':
          if (ddItems?.length) { e.preventDefault(); setDdActive((i) => (i === null || i === 0 ? null : i - 1)) }
          return
        default:
          return
      }
    }

    // 행/열 조작 (Ctrl+Alt+= / -). 열 전체를 골랐으면 열, 아니면 행 — Excel 과 같다 (DESIGN §41 K2)
    if (mod && e.altKey && !e.shiftKey && (code === 'Equal' || code === 'Minus')) {
      e.preventDefault()
      if (isWholeCols(range)) {
        const n = range.c2 - range.c1 + 1
        if (code === 'Equal') {
          // 넣은 열을 고른 채로 둔다 — 한 번 더 누르면 또 열이 들어간다
          if (onColOp('right', range)) selectCols(range.c2 + 1, range.c2 + n)
        } else if (onColOp('del', range)) {
          // 지운 자리의 열을 고른 채로 둔다 (Excel). 끝 열을 지웠으면 새 끝 열로
          const left = table.width - n
          const c1 = Math.min(range.c1, left - 1)
          selectCols(c1, Math.min(c1 + n - 1, left - 1))
        }
      } else if (code === 'Equal') onRowOp('below', range)
      else onRowOp('del', range)
      return
    }

    // 행 옮기기 · 복제 (Alt+↑ / ↓, Shift+Alt+↑ / ↓) — 마크다운의 줄 옮기기 · 복제와 같은 키 (DESIGN §42 K5)
    if (e.altKey && !mod && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault()
      const up = e.key === 'ArrowUp'
      if (e.shiftKey) onRowOp(up ? 'dupKeep' : 'dup', range)
      else onRowOp(up ? 'moveUp' : 'moveDown', range)
      return
    }

    // 선택 상태
    switch (e.key) {
      case 'ArrowUp': e.preventDefault(); moveActive('up', mod, e.shiftKey); return
      case 'ArrowDown': e.preventDefault(); moveActive('down', mod, e.shiftKey); return
      case 'ArrowLeft': e.preventDefault(); moveActive('left', mod, e.shiftKey); return
      case 'ArrowRight': e.preventDefault(); moveActive('right', mod, e.shiftKey); return
      case 'Tab': e.preventDefault(); moveActive(e.shiftKey ? 'left' : 'right'); return
      case 'Home':
        e.preventDefault()
        select({ r: mod ? 0 : active.r, c: 0 }, e.shiftKey)
        return
      case 'End':
        e.preventDefault()
        select({ r: mod ? maxR : active.r, c: maxC }, e.shiftKey)
        return
      case 'PageUp':
      case 'PageDown': {
        e.preventDefault()
        const el = scrollRef.current
        const page = Math.max(1, Math.floor(((el?.clientHeight ?? 400) - headerH) / ROW_H) - 1)
        const r = e.key === 'PageUp' ? active.r - page : active.r + page
        select({ r, c: active.c }, e.shiftKey)
        return
      }
      case 'Escape':
        e.preventDefault()
        setAnchor(null)
        return
      case 'Enter':
        // Alt+Enter 는 맥락 메뉴 (전역 — DESIGN §40). 편집 중의 Alt+Enter 는 위 분기(칸 안 줄바꿈)
        if (e.altKey) return
        e.preventDefault()
        startEdit('edit')
        return
      case 'F2':
        e.preventDefault()
        startEdit('edit')
        return
      case 'F9':
        e.preventDefault()
        onCalc()
        return
      case 'F3':
        e.preventDefault()
        onFindStep(e.shiftKey ? -1 : 1)
        return
      case 'Delete':
      case 'Backspace':
        e.preventDefault()
        clearRange()
        return
      case ' ': {
        if (e.shiftKey) { e.preventDefault(); selectRows(range.r1, range.r2); return }
        if (mod) { e.preventDefault(); selectCols(range.c1, range.c2); return }
        const col = schema.columns[active.c]
        if (!multi && col?.type === 'bool' && active.r >= headerRows && isBoolText(cellAt(table, active.r, active.c))) {
          e.preventDefault()
          toggleBool(active.r, active.c)
        }
        return
      }
      default:
        break
    }
    if (mod) {
      switch (code) {
        case 'KeyA': e.preventDefault(); selectAll(); return
        case 'KeyZ': e.preventDefault(); if (e.shiftKey) onRedo(); else onUndo(); return
        case 'KeyY': e.preventDefault(); onRedo(); return
        case 'KeyD':
          e.preventDefault()
          // Ctrl+Shift+D(행 복제)는 Shift+Alt+↓ 로 옮겼다 (K5). 손에 익은 키를 누르면 새 키를 알린다 —
          // 흘려보내면 Chrome 의 "모든 탭을 북마크에 추가" 가 뜬다
          if (e.shiftKey) { onNotice('행 복제는 Shift+Alt+↓ 로 바뀌었습니다 (Alt+↑ / ↓ 는 행 옮기기)'); return }
          if (rowView) { onNotice(VIEW_BLOCKED); return }
          { const g = range; onEdit((t) => fillDown(t, g)) }
          return
        case 'KeyR': {
          e.preventDefault()
          if (rowView) { onNotice(VIEW_BLOCKED); return }
          const g = range
          onEdit((t) => fillRight(t, g))
          return
        }
        // Shift·Alt 가 겹친 Ctrl+F / Ctrl+H (Ctrl+Shift+F 등)는 그리드가 가로채지 않고 전역 단축키에 맡긴다
        case 'KeyF': if (e.shiftKey || e.altKey) return; e.preventDefault(); onFind(false); return
        case 'KeyH': if (e.shiftKey || e.altKey) return; e.preventDefault(); onFind(true); return
        default:
          return // Ctrl+C/X/V 는 clipboard 이벤트로, 나머지 Ctrl 조합은 전역으로
      }
    }
    // 글자 키는 textarea 로 들어가 input 이벤트에서 편집이 시작된다
  }

  const onInput = (e: React.FormEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget
    if (!editing) {
      if (active.r >= table.rows.length) { el.value = ''; return }
      setAnchor(null)
      setEditing({ r: active.r, c: active.c, mode: 'replace' })
    }
    setDraft(el.value)
    setDdActive(null)
  }
  const onCompositionStart = () => {
    if (!editing && active.r < table.rows.length) {
      setAnchor(null)
      setEditing({ r: active.r, c: active.c, mode: 'replace' })
      setDraft('')
    }
  }
  const onBlur = () => { if (editing) commitEdit(null) }

  // ---- 클립보드 (선택 상태에서만 가로챈다. 편집 중엔 textarea 기본 동작)
  const onCopy = (e: React.ClipboardEvent) => {
    if (editing) return
    e.preventDefault()
    e.clipboardData.setData('text/plain', formatClipboardTsv(rangeBlock(table, range)))
  }
  const onCut = (e: React.ClipboardEvent) => {
    if (editing) return
    e.preventDefault()
    e.clipboardData.setData('text/plain', formatClipboardTsv(rangeBlock(table, range)))
    clearRange()
  }
  const onPaste = (e: React.ClipboardEvent) => {
    if (editing) return
    const text = e.clipboardData.getData('text/plain')
    const html = e.clipboardData.getData('text/html')
    e.preventDefault()
    // 칸 값은 형식 규칙대로 다듬는다 — TSV 칸엔 탭·줄바꿈을 넣을 수 없다 (편집 확정과 같은 규칙, TC-1310)
    let cleaned = false
    const clean = (v: string) => {
      const [s, changed] = sanitizeFor(table.format, v)
      if (changed) cleaned = true
      return s
    }
    const cleanNote = () => (cleaned ? ['탭·줄바꿈은 공백으로 바꿈'] : [])

    // 마크다운 표·<th> 머리글 HTML 표: 머리글은 머리글 행으로, 모자라는 열·행은 늘린다 (DESIGN §19)
    const headed = parseMarkdownTable(text) ?? parseHtmlTable(html)
    // 정렬 · 필터 중에는 행이 늘어나는 붙여넣기를 하지 않는다 (DESIGN §61) — 보이는 행 다음이 파일의 어디인지 정할 수 없다
    if (headed && rowView) { onNotice(VIEW_PASTE_BLOCKED); return }
    if (headed) {
      const b = { header: headed.header.map(clean), rows: headed.rows.map((l) => l.map(clean)) }
      const r = range.r1
      const c = range.c1
      const opts = { headerRow: schema.headerRows - 1, typeRow: schema.typed ? 0 : -1, expand: true }
      const w = Math.max(b.header.length, ...b.rows.map((l) => l.length))
      // 붙일 표가 더 넓으면 열을 늘린다. 열 삽입처럼 묻지 않고(Ctrl+Z 로 돌아온다) 알림에 되돌리기를 단다 (DESIGN §24.6 N6)
      const preview = pasteHeadedBlock(table, r, c, b, opts)
      onEdit((t) => pasteHeadedBlock(t, r, c, b, opts).table)
      const notes = [`표 붙여넣음: 머리글 + ${b.rows.length}행 × ${w}열`]
      // 행이 있는 표에 열이 늘면 모든 행이 다시 조립된다
      if (preview.addedCols) notes.push(table.rows.length > 0 ? `열 ${preview.addedCols}개 추가 (모든 행이 다시 조립되어 git diff 에 전체 행이 나옵니다)` : `열 ${preview.addedCols}개 추가`)
      if (preview.addedRows) notes.push(`행 ${preview.addedRows}개 추가`)
      if (preview.clippedCols) notes.push(`열 ${preview.clippedCols}개는 표 너비를 넘어 잘림`)
      onNotice([...notes, ...cleanNote()].join(' · '), { undo: preview.addedCols > 0 })
      setAnchor({ r: preview.range.r1, c: preview.range.c1 })
      onActiveChange({ r: preview.range.r2, c: preview.range.c2 })
      return
    }

    if (text === '') return
    const block = parseClipboardTsv(text).map((l) => l.map(clean))
    const g = range
    // 한 셀을 복사해 범위에 붙이면 범위를 그 값으로 채운다 (Sheets 와 같다)
    if (block.length === 1 && block[0].length === 1 && multi) {
      const v = block[0][0]
      onEdit((t) => fillRange(t, g, v))
      onNotice([`${g.r2 - g.r1 + 1}×${g.c2 - g.c1 + 1} 범위를 "${v}" 로 채움`, ...cleanNote()].join(' · '))
      return
    }
    const r = g.r1
    const c = g.c1
    const preview = pasteBlock(table, r, c, block)
    if (rowView && preview.addedRows) { onNotice(VIEW_PASTE_BLOCKED); return }
    onEdit((t) => pasteBlock(t, r, c, block).table)
    const cols = Math.max(...block.map((l) => l.length))
    const notes = [`${block.length}×${cols} 붙여넣음`]
    if (preview.addedRows) notes.push(`행 ${preview.addedRows}개 추가`)
    if (preview.clippedCols) notes.push(`열 ${preview.clippedCols}개는 표 너비를 넘어 잘림`)
    onNotice([...notes, ...cleanNote()].join(' · '))
    // 붙인 블록을 선택 상태로
    setAnchor({ r, c })
    onActiveChange({ r: Math.min(r + block.length - 1, Math.max(maxR, r + block.length - 1)), c: Math.min(maxC, c + cols - 1) })
  }

  // ---- 마우스 (이벤트 위임)
  const onMouseDown = (e: React.MouseEvent) => {
    if (e.button === 2) { onRightDown(e); return }
    if (e.button !== 0) return
    const target = e.target as HTMLElement
    // 열 글자의 ▾ — 그 열을 고르고 맥락 메뉴(열 머리 메뉴가 위)를 연다. 마우스용이고 키보드는 Alt+Enter (DESIGN §61)
    const menuBtn = target.closest<HTMLElement>('[data-colmenu]')
    if (menuBtn) {
      e.preventDefault()
      if (editing) commitEdit(null)
      const c = Number(menuBtn.dataset.colmenu)
      if (!(c >= range.c1 && c <= range.c2 && range.r1 === 0 && range.r2 === maxR)) selectCols(c, c)
      focusInput()
      const letterEl = menuBtn.closest<HTMLElement>('[data-letter]') ?? menuBtn
      // 고른 열이 그려진 뒤에 연다 — 메뉴는 앱의 contextmenu 처리가 띄운다
      window.setTimeout(() => {
        const rect = letterEl.getBoundingClientRect()
        letterEl.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: rect.left + 4, clientY: rect.bottom + 2 }))
      }, 0)
      return
    }
    if (target.closest('[data-fill]')) {
      e.preventDefault()
      filling.current = range
      setFillDrag({ target: null })
      focusInput()
      return
    }
    const handle = target.closest<HTMLElement>('[data-resize]')
    if (handle) {
      e.preventDefault()
      const c = Number(handle.dataset.resize)
      resizing.current = { c, startX: e.clientX, startW: widths[c] }
      return
    }
    const rownum = target.closest<HTMLElement>('[data-rownum]')
    if (rownum) {
      e.preventDefault()
      if (editing) commitEdit(null)
      const r = Number(rownum.dataset.rownum)
      if (e.shiftKey && anchor) selectRows(anchor.r, r)
      else selectRows(r, r)
      focusInput()
      return
    }
    const letter = target.closest<HTMLElement>('[data-letter]')
    if (letter) {
      e.preventDefault()
      if (editing) commitEdit(null)
      const c = Number(letter.dataset.letter)
      if (e.shiftKey && anchor) { selectCols(anchor.c, c); focusInput(); return }
      // 누른 채 옆으로 끌면 열 옮기기. 이미 고른 여러 열(열 전체) 안을 눌렀으면 그 열들을 함께 옮긴다
      const inRun = range.c2 > range.c1 && c >= range.c1 && c <= range.c2 && range.r1 === 0 && range.r2 === maxR
      if (inRun) colDrag.current = { from: range.c1, count: range.c2 - range.c1 + 1, pressed: c, startX: e.clientX, keepSel: true, moved: false }
      else {
        selectCols(c, c)
        colDrag.current = { from: c, count: 1, pressed: c, startX: e.clientX, keepSel: false, moved: false }
      }
      focusInput()
      return
    }
    if (target.closest('[data-corner]')) {
      e.preventDefault()
      if (editing) commitEdit(null)
      selectAll()
      focusInput()
      return
    }
    const cell = target.closest<HTMLElement>('[data-r]')
    if (!cell) return
    e.preventDefault()
    const r = Number(cell.dataset.r)
    const c = Number(cell.dataset.c)
    if (editing && (editing.r !== r || editing.c !== c)) commitEdit(null)
    if (target.closest('[data-bool]')) { select({ r, c }); toggleBool(r, c); focusInput(); return }
    select({ r, c }, e.shiftKey)
    dragging.current = true
    focusInput()
  }
  /** 오른쪽 클릭 (맥락 메뉴, DESIGN §40) — 고른 범위 밖을 누르면 그 셀 · 행 · 열을 고른다 (Excel 과 같다). 메뉴는 앱의 contextmenu 처리가 띄운다 */
  const onRightDown = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement
    const letter = target.closest<HTMLElement>('[data-letter]')
    const rownum = target.closest<HTMLElement>('[data-rownum]')
    const cell = target.closest<HTMLElement>('[data-r]')
    if (!letter && !rownum && !cell) return
    e.preventDefault()
    if (editing) commitEdit(null)
    if (letter) {
      const c = Number(letter.dataset.letter)
      if (!(c >= range.c1 && c <= range.c2 && range.r1 === 0 && range.r2 === maxR)) selectCols(c, c)
    } else if (rownum) {
      const r = Number(rownum.dataset.rownum)
      if (!(r >= range.r1 && r <= range.r2 && range.c1 === 0 && range.c2 === maxC)) selectRows(r, r)
    } else if (cell) {
      const r = Number(cell.dataset.r)
      const c = Number(cell.dataset.c)
      if (r < range.r1 || r > range.r2 || c < range.c1 || c > range.c2) select({ r, c })
    }
    focusInput()
  }
  const onMouseMove = (e: React.MouseEvent) => {
    if (!dragging.current || !(e.buttons & 1)) { dragging.current = false; return }
    const cell = (e.target as HTMLElement).closest<HTMLElement>('[data-r]')
    if (!cell) return
    const r = Number(cell.dataset.r)
    const c = Number(cell.dataset.c)
    if (r === active.r && c === active.c && anchor) return
    select({ r, c }, true)
  }
  const onDoubleClick = (e: React.MouseEvent) => {
    // 열 경계를 두 번 누르면 폭 맞춤 — 고른 여러 열 안이면 그 열들 모두 (Excel 과 같다)
    const rz = (e.target as HTMLElement).closest<HTMLElement>('[data-resize]')
    if (rz) {
      const c = Number(rz.dataset.resize)
      if (range.c2 > range.c1 && c >= range.c1 && c <= range.c2 && range.r1 === 0 && range.r2 === maxR) fitColumns(range.c1, range.c2)
      else fitColumns(c, c)
      return
    }
    const cell = (e.target as HTMLElement).closest<HTMLElement>('[data-r]')
    if (!cell || (e.target as HTMLElement).closest('[data-bool]')) return
    startEdit('edit', Number(cell.dataset.r), Number(cell.dataset.c))
  }
  const onScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget
    setScroll({ top: el.scrollTop, left: el.scrollLeft })
  }

  // ---- 입력창 위치
  const inputX = ROWNUM_W + (offsets[active.c] ?? 0) - scroll.left
  const inputY = active.r < headerRows ? LETTER_H + active.r * ROW_H : headerH + (active.r - headerRows) * ROW_H - scroll.top
  const inputW = Math.max(shown[active.c] || MIN_COL, 160)
  const inputH = editing && textWidth(draft) > inputW - 12 ? ROW_H * 3 : ROW_H

  const rowSel = (r: number): { c1: number; c2: number } => (r >= range.r1 && r <= range.r2 ? { c1: range.c1, c2: range.c2 } : { c1: -1, c2: -1 })
  const wholeRow = range.c1 === 0 && range.c2 === maxC && multi

  // ---- 채우기 핸들: 범위 오른쪽 아래 모서리. 헤더 행이면 고정 헤더 안에, 아니면 스크롤 내용 안에 둔다
  const fillT = fillDrag?.target ?? null
  const fillSel = (r: number): { c1: number; c2: number } => (fillT && r >= fillT.r1 && r <= fillT.r2 ? { c1: fillT.c1, c2: fillT.c2 } : { c1: -1, c2: -1 })
  const handleX = ROWNUM_W + (offsets[range.c2] ?? 0) + (shown[range.c2] ?? 0)
  const handleInHead = range.r2 < headerRows
  const handleY = handleInHead ? LETTER_H + (range.r2 + 1) * ROW_H : headerH + (range.r2 - headerRows + 1) * ROW_H
  // 행 번호 칸 밑으로 스크롤돼 들어가면 숨긴다
  // 정렬 · 필터 중에는 채우기를 하지 않으니 핸들도 없다 (DESIGN §61)
  const handle = !editing && !rowView && table.rows.length > 0 && widths.length > 0 && handleX - scroll.left >= ROWNUM_W
    ? <div className="grid-fill-handle" data-fill="1" style={{ left: handleX, top: handleY }} title="끌어서 채우기 — 값 무늬를 되풀이, 숫자는 수열로" />
    : null
  // 표 끝을 넘어 새로 생길 행 자리 (셀이 없으니 덮개 하나로 보인다)
  const ghostR1 = fillT ? Math.max(fillT.r1, table.rows.length) : 0
  const ghost = fillT && fillT.r2 >= table.rows.length && table.rows.length >= headerRows
    ? {
        left: ROWNUM_W + offsets[fillT.c1],
        top: headerH + (ghostR1 - headerRows) * ROW_H,
        width: offsets[fillT.c2] + shown[fillT.c2] - offsets[fillT.c1],
        height: (fillT.r2 - ghostR1 + 1) * ROW_H,
      }
    : null
  // ---- 열 옮기기: 놓을 경계의 세로선
  const dropAt = colDrop?.at ?? null
  const dropX = dropAt === null ? null : ROWNUM_W + (dropAt < shown.length ? offsets[dropAt] : totalWidth - ROWNUM_W) - scroll.left

  let wrapCls = 'grid-wrap'
  if (fillDrag) wrapCls += ' is-filling'
  if (colDrop) wrapCls += ' is-col-moving'

  const items = virtualItems
  return (
    <div className={wrapCls}>
      <div ref={scrollRef} className="grid-scroll" onScroll={onScroll} onMouseDown={onMouseDown} onMouseMove={onMouseMove} onDoubleClick={onDoubleClick}>
        <div className="grid-inner" style={{ width: totalWidth, height: headerH + totalSize }}>
          <div className="grid-head" style={{ width: totalWidth }}>
            <div className="grid-row is-letters" style={{ width: totalWidth }}>
              <div className="grid-rownum grid-corner" data-corner="1" title="전체 선택 (Ctrl+A)" />
              {shown.map((w, c) => {
                if (w === 0) return null
                const col = schema.columns[c]
                const errs = validation.byColumn[c]
                const colSel = c >= range.c1 && c <= range.c2 && (multi || active.c === c)
                const sorted = p.sort?.c === c ? p.sort.dir : 0
                const filtered = !!p.filteredCols?.has(c)
                // 숨긴 열이 이 열 왼쪽(또는 끝 열 오른쪽)에 있으면 경계에 표시
                const hiddenBefore = c > 0 && hidden.has(c - 1)
                const hiddenAfter = c < shown.length - 1 && hidden.has(c + 1) && shown.slice(c + 1).every((x) => x === 0)
                let cls = 'grid-letter'
                if (colSel) cls += ' is-active-col'
                if (sorted || filtered) cls += ' is-viewed'
                if (hiddenBefore) cls += ' has-hidden-before'
                if (hiddenAfter) cls += ' has-hidden-after'
                let title = columnTitle(col)
                if (sorted) title += `\n${sorted > 0 ? '오름차순' : '내림차순'}으로 정렬해 보는 중 (파일 순서는 그대로)`
                if (filtered) title += '\n값으로 거르는 중'
                if (hiddenBefore || hiddenAfter) title += '\n옆에 숨긴 열이 있다 — 열 머리 메뉴의 "숨긴 열 모두 보이기"'
                return (
                  <div key={c} className={cls} data-letter={c} style={{ width: w }} title={title}>
                    {columnLetter(c)}
                    {sorted !== 0 && <span className="grid-colmark">{sorted > 0 ? '↑' : '↓'}</span>}
                    {filtered && (
                      <svg className="grid-colmark is-filter" viewBox="0 0 10 10" width="9" height="9" aria-label="거르는 중">
                        <path d="M0 1h10L6 5.5V9.5L4 8.5V5.5z" fill="currentColor" />
                      </svg>
                    )}
                    {errs > 0 && <span className="grid-errcount">{errs}</span>}
                    <span className="grid-colmenu" data-colmenu={c} title="열 머리 메뉴 — 정렬 · 거르기 · 숨기기 · 폭 맞춤 (키보드: Alt+Enter)">▾</span>
                    <span className="grid-resize" data-resize={c} title="끌기: 너비 · 두 번 누르기: 내용에 맞추기" />
                  </div>
                )
              })}
            </div>
            {table.rows.slice(0, headerRows).map((row, r) => {
              const s = rowSel(r)
              const f = fillSel(r)
              return (
                <Row key={r} row={row} r={r} ar={r} widths={shown} schema={schema} validation={validation} tableWidth={table.width} totalWidth={totalWidth} activeC={active.r === r ? active.c : -1} selC1={s.c1} selC2={s.c2} fillC1={f.c1} fillC2={f.c2} matches={matches} calcCells={calcCells} rowSelected={wholeRow && s.c1 >= 0} head inv={inv} />
              )
            })}
            {handleInHead && handle}
          </div>
          {items.map((vi) => {
            const r = vi.index + headerRows
            const s = rowSel(r)
            const f = fillSel(r)
            return (
              <Row
                key={vi.key}
                row={table.rows[r]}
                r={r}
                ar={rowView ? rowView.toActual(r) : r}
                widths={shown}
                schema={schema}
                validation={validation}
                tableWidth={table.width}
                totalWidth={totalWidth}
                activeC={active.r === r ? active.c : -1}
                selC1={s.c1}
                selC2={s.c2}
                fillC1={f.c1}
                fillC2={f.c2}
                matches={matches}
                calcCells={calcCells}
                rowSelected={wholeRow && s.c1 >= 0}
                head={false}
                top={headerH + vi.start}
                inv={inv}
              />
            )
          })}
          {!handleInHead && handle}
          {ghost && <div className="grid-fill-ghost is-fill-target" style={ghost} />}
        </div>
      </div>
      {dropX !== null && dropX >= ROWNUM_W - 1 && <div className="grid-col-drop" style={{ left: dropX }} />}
      <textarea
        ref={ta}
        className={'grid-input' + (editing ? ' is-editing' : '')}
        style={{ left: inputX, top: inputY, width: inputW, height: inputH }}
        spellCheck={false}
        autoComplete="off"
        aria-label="셀 입력"
        onKeyDown={onKeyDown}
        onInput={onInput}
        onCompositionStart={onCompositionStart}
        onBlur={onBlur}
        onCopy={onCopy}
        onCut={onCut}
        onPaste={onPaste}
      />
      {editing && ddItems && ddItems.length > 0 && (
        <div className="grid-dropdown" style={{ left: inputX, top: inputY + inputH, minWidth: inputW }} onMouseDown={(e) => e.preventDefault()}>
          {ddItems.map((item, i) => (
            <div key={item} className={i === ddActive ? 'is-hl' : ''} onClick={() => commitEdit(null, applyItem(item))}>
              {item}
            </div>
          ))}
        </div>
      )}
    </div>
  )
})
