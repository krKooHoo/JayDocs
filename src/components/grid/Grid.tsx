import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { cellAt, type TsvRow, type TsvTable } from '../../lib/tsv/model'
import { columnLetter, type ColumnSchema, type TableSchema } from '../../lib/tsv/schema'
import { issueKey, type Validation } from '../../lib/tsv/validate'
import { fillDown, fillRange, fillRight, pasteBlock, rangeBlock, setCell, type CellRange } from '../../lib/tsv/edits'
import { formatClipboardTsv, parseClipboardTsv } from '../../lib/tsv/clipboard'
import { sanitizeCell } from '../../lib/tsv/serialize'

/**
 * 자체 DOM 그리드 (DESIGN D3). 상태는 활성 셀(부모가 쥔다)과 범위 선택의 기준점(anchor)뿐이고
 * 표(TsvTable) 는 그리기만 한다 — 편집은 onEdit 으로 올려 보낸다.
 *
 * 입력은 항상 떠 있는 <textarea> 하나가 받는다. 셀을 고르면 그 위(1×1, 투명)에 두고 포커스를 준다.
 * 글자가 들어오면(input / compositionstart) 그때 편집 모드로 커진다. 한글 조합이 textarea 안에서 시작되므로
 * 첫 자모가 사라지는 문제(§3.3)가 구조적으로 없다. 조합 중(isComposing / keyCode 229)에는 키를 가로채지 않는다.
 *
 * 키는 Google Sheets · Excel 의 기본 키를 따른다 (SHORTCUTS.md "TSV 그리드").
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
}

export type RowOp = 'above' | 'below' | 'append' | 'dup' | 'del'
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
  onNotice: (msg: string) => void
  /** 행/열 조작 (단축키에서). 범위를 함께 보낸다 */
  onRowOp: (kind: RowOp, range: CellRange) => void
  onColOp: (kind: ColOp, range: CellRange) => void
  /** 열 너비를 기억할 localStorage 키 */
  widthsKey: string
}

interface Editing {
  r: number
  c: number
  mode: 'replace' | 'edit'
}

type Move = 'up' | 'down' | 'left' | 'right'

// ---------------------------------------------------------------- 열 너비
function textWidth(s: string): number {
  let w = 0
  for (const ch of s) {
    const code = ch.codePointAt(0) ?? 0
    w += code > 0x2e80 ? 13 : code < 0x80 ? 7.3 : 9
  }
  return w
}

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

function isNumeric(t: ColumnSchema['type']) {
  return t === 'byte' || t === 'uint' || t === 'float'
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
  parts.push('클릭: 열 선택 · 드래그: 너비')
  return parts.join('\n')
}

function normalizeRange(a: CellPos, b: CellPos): CellRange {
  return { r1: Math.min(a.r, b.r), c1: Math.min(a.c, b.c), r2: Math.max(a.r, b.r), c2: Math.max(a.c, b.c) }
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
  issue: string | undefined
  head: boolean
}

const Cell = memo(function Cell({ r, c, v, col, w, active, selected, issue, head }: CellProps) {
  let cls = 'grid-cell'
  if (col.type === 'comment') cls += ' is-comment'
  if (col.isKey) cls += ' is-key'
  if (!head && isNumeric(col.type)) cls += ' is-num'
  if (selected) cls += ' is-selected'
  if (active) cls += ' is-active'
  if (issue) cls += ' has-error'
  const bool = !head && col.type === 'bool' && isBoolText(v)
  return (
    <div className={cls} data-r={r} data-c={c} style={{ width: w }} title={issue}>
      {bool ? (
        <span className="grid-bool" data-bool="1">
          <input type="checkbox" checked={/^true$/i.test(v)} readOnly tabIndex={-1} />
        </span>
      ) : (
        v
      )}
    </div>
  )
})

interface RowProps {
  row: TsvRow
  r: number
  widths: number[]
  schema: TableSchema
  validation: Validation
  tableWidth: number
  totalWidth: number
  activeC: number
  /** 이 행에 걸친 선택 열 범위. 없으면 -1 */
  selC1: number
  selC2: number
  rowSelected: boolean
  head: boolean
  style?: React.CSSProperties
}

const Row = memo(function Row({ row, r, widths, schema, validation, tableWidth, totalWidth, activeC, selC1, selC2, rowSelected, head, style }: RowProps) {
  let cls = 'grid-row'
  cls += head ? ' is-head' : ' is-body'
  if (head && schema.typed && r === 0) cls += ' is-type'
  return (
    <div className={cls} style={{ ...style, width: totalWidth }}>
      <div className={'grid-rownum' + (activeC >= 0 || rowSelected ? ' is-active-row' : '')} data-rownum={r} title="클릭: 행 선택">{r + 1}</div>
      {widths.map((w, c) => (
        <Cell
          key={c}
          r={r}
          c={c}
          v={row.cells[c] ?? ''}
          col={schema.columns[c]}
          w={w}
          active={activeC === c}
          selected={selC1 >= 0 && c >= selC1 && c <= selC2}
          issue={validation.issues.get(issueKey(tableWidth, r, c))}
          head={head}
        />
      ))}
    </div>
  )
})

// ---------------------------------------------------------------- 그리드
export const Grid = forwardRef<GridHandle, GridProps>(function Grid(p, ref) {
  const { table, schema, validation, active, onActiveChange, onEdit, onUndo, onRedo, onNotice, onRowOp, onColOp } = p
  const headerRows = schema.headerRows
  const headerH = LETTER_H + headerRows * ROW_H
  const bodyCount = Math.max(0, table.rows.length - headerRows)
  const maxR = Math.max(0, table.rows.length - 1)
  const maxC = Math.max(0, table.width - 1)

  const scrollRef = useRef<HTMLDivElement>(null)
  const ta = useRef<HTMLTextAreaElement>(null)
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
  const multi = range.r1 !== range.r2 || range.c1 !== range.c2

  // ---- 열 너비
  const [widths, setWidths] = useState<number[]>(() => loadWidths(p.widthsKey, table.width) ?? estimateWidths(table))
  useEffect(() => {
    if (widths.length !== table.width) setWidths(loadWidths(p.widthsKey, table.width) ?? estimateWidths(table))
  }, [table, widths.length, p.widthsKey])
  const offsets = useMemo(() => {
    const out: number[] = []
    let x = 0
    for (const w of widths) { out.push(x); x += w }
    return out
  }, [widths])
  const totalWidth = ROWNUM_W + (offsets.length ? offsets[offsets.length - 1] + widths[widths.length - 1] : 0)

  const resizing = useRef<{ c: number; startX: number; startW: number } | null>(null)
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const rs = resizing.current
      if (!rs) return
      const w = Math.max(MIN_COL, Math.min(MAX_COL * 2, rs.startW + e.clientX - rs.startX))
      setWidths((ws) => ws.map((x, i) => (i === rs.c ? w : x)))
    }
    const onUp = () => {
      dragging.current = false
      if (!resizing.current) return
      resizing.current = null
      setWidths((ws) => { try { localStorage.setItem(p.widthsKey, JSON.stringify(ws)) } catch { /* 무시 */ } return ws })
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
  }, [p.widthsKey])

  // ---- 가상화
  const virtualizer = useVirtualizer({
    count: bodyCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_H,
    overscan: 8,
  })

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
    const right = left + (widths[active.c] ?? 0)
    const viewW = el.clientWidth - ROWNUM_W
    if (left < el.scrollLeft) el.scrollLeft = left
    else if (right > el.scrollLeft + viewW) el.scrollLeft = Math.max(0, right - viewW)
  }, [active, headerRows, headerH, offsets, widths])

  const focusInput = useCallback(() => { ta.current?.focus({ preventScroll: true }) }, [])
  useImperativeHandle(ref, () => ({ focus: focusInput, range: () => range, clearRange: () => setAnchor(null) }), [focusInput, range])

  // ---- 선택 · 이동
  /** 활성 셀을 옮긴다. extend 면 범위를 넓힌다 (기준점 유지), 아니면 범위를 푼다 */
  const select = useCallback((pos: CellPos, extend = false) => {
    const next = { r: Math.max(0, Math.min(maxR, pos.r)), c: Math.max(0, Math.min(maxC, pos.c)) }
    if (extend) { if (!anchor) setAnchor(active) } else setAnchor(null)
    if (next.r !== active.r || next.c !== active.c) onActiveChange(next)
  }, [active, anchor, maxR, maxC, onActiveChange])

  const moveActive = useCallback((dir: Move, far = false, extend = false) => {
    let { r, c } = active
    if (dir === 'up') r = far ? 0 : r - 1
    if (dir === 'down') r = far ? maxR : r + 1
    if (dir === 'left') c = far ? 0 : c - 1
    if (dir === 'right') c = far ? maxC : c + 1
    select({ r, c }, extend)
  }, [active, maxR, maxC, select])

  const selectRows = useCallback((r1: number, r2: number) => {
    setAnchor({ r: Math.min(r1, r2), c: 0 })
    onActiveChange({ r: Math.max(r1, r2), c: maxC })
  }, [maxC, onActiveChange])
  const selectCols = useCallback((c1: number, c2: number) => {
    setAnchor({ r: 0, c: Math.min(c1, c2) })
    onActiveChange({ r: maxR, c: Math.max(c1, c2) })
  }, [maxR, onActiveChange])
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
    const [clean, changed] = sanitizeCell(override ?? el.value)
    if (changed) onNotice('탭·줄바꿈은 셀에 넣을 수 없어 공백으로 바꿨습니다')
    const { r, c } = editing
    onEdit((t) => setCell(t, r, c, clean))
    el.value = ''
    setEditing(null)
    setDraft('')
    setDdActive(null)
    if (move) moveActive(move)
  }, [editing, onEdit, onNotice, moveActive])

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

  // ---- 키보드
  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return
    const mod = e.ctrlKey || e.metaKey
    const code = e.code
    if (editing) {
      switch (e.key) {
        case 'Enter': {
          e.preventDefault()
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

    // 행/열 조작 (Ctrl+Alt+= / -, Shift 면 열)
    if (mod && e.altKey && (code === 'Equal' || code === 'Minus')) {
      e.preventDefault()
      if (code === 'Equal') { if (e.shiftKey) onColOp('right', range); else onRowOp('below', range) }
      else { if (e.shiftKey) onColOp('del', range); else onRowOp('del', range) }
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
        e.preventDefault()
        startEdit('edit')
        return
      case 'F2':
        e.preventDefault()
        startEdit('edit')
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
          if (e.shiftKey) onRowOp('dup', range)
          else { const g = range; onEdit((t) => fillDown(t, g)) }
          return
        case 'KeyR': { e.preventDefault(); const g = range; onEdit((t) => fillRight(t, g)); return }
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
    e.preventDefault()
    if (text === '') return
    const block = parseClipboardTsv(text)
    const g = range
    // 한 셀을 복사해 범위에 붙이면 범위를 그 값으로 채운다 (Sheets 와 같다)
    if (block.length === 1 && block[0].length === 1 && multi) {
      const v = block[0][0]
      onEdit((t) => fillRange(t, g, v))
      onNotice(`${g.r2 - g.r1 + 1}×${g.c2 - g.c1 + 1} 범위를 "${v}" 로 채움`)
      return
    }
    const r = g.r1
    const c = g.c1
    const preview = pasteBlock(table, r, c, block)
    onEdit((t) => pasteBlock(t, r, c, block).table)
    const cols = Math.max(...block.map((l) => l.length))
    const notes = [`${block.length}×${cols} 붙여넣음`]
    if (preview.addedRows) notes.push(`행 ${preview.addedRows}개 추가`)
    if (preview.clippedCols) notes.push(`열 ${preview.clippedCols}개는 표 너비를 넘어 잘림`)
    onNotice(notes.join(' · '))
    // 붙인 블록을 선택 상태로
    setAnchor({ r, c })
    onActiveChange({ r: Math.min(r + block.length - 1, Math.max(maxR, r + block.length - 1)), c: Math.min(maxC, c + cols - 1) })
  }

  // ---- 마우스 (이벤트 위임)
  const onMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return
    const target = e.target as HTMLElement
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
      if (e.shiftKey && anchor) selectCols(anchor.c, c)
      else selectCols(c, c)
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
  const inputW = Math.max(widths[active.c] ?? MIN_COL, 160)
  const inputH = editing && textWidth(draft) > inputW - 12 ? ROW_H * 3 : ROW_H

  const rowSel = (r: number): { c1: number; c2: number } => (r >= range.r1 && r <= range.r2 ? { c1: range.c1, c2: range.c2 } : { c1: -1, c2: -1 })
  const wholeRow = range.c1 === 0 && range.c2 === maxC && multi

  const items = virtualizer.getVirtualItems()
  return (
    <div className="grid-wrap">
      <div ref={scrollRef} className="grid-scroll" onScroll={onScroll} onMouseDown={onMouseDown} onMouseMove={onMouseMove} onDoubleClick={onDoubleClick}>
        <div className="grid-inner" style={{ width: totalWidth, height: headerH + virtualizer.getTotalSize() }}>
          <div className="grid-head" style={{ width: totalWidth }}>
            <div className="grid-row is-letters" style={{ width: totalWidth }}>
              <div className="grid-rownum grid-corner" data-corner="1" title="전체 선택 (Ctrl+A)" />
              {widths.map((w, c) => {
                const col = schema.columns[c]
                const errs = validation.byColumn[c]
                const colSel = c >= range.c1 && c <= range.c2 && (multi || active.c === c)
                return (
                  <div key={c} className={'grid-letter' + (colSel ? ' is-active-col' : '')} data-letter={c} style={{ width: w }} title={columnTitle(col)}>
                    {columnLetter(c)}
                    {errs > 0 && <span className="grid-errcount">{errs}</span>}
                    <span className="grid-resize" data-resize={c} />
                  </div>
                )
              })}
            </div>
            {table.rows.slice(0, headerRows).map((row, r) => {
              const s = rowSel(r)
              return (
                <Row key={r} row={row} r={r} widths={widths} schema={schema} validation={validation} tableWidth={table.width} totalWidth={totalWidth} activeC={active.r === r ? active.c : -1} selC1={s.c1} selC2={s.c2} rowSelected={wholeRow && s.c1 >= 0} head />
              )
            })}
          </div>
          {items.map((vi) => {
            const r = vi.index + headerRows
            const s = rowSel(r)
            return (
              <Row
                key={vi.key}
                row={table.rows[r]}
                r={r}
                widths={widths}
                schema={schema}
                validation={validation}
                tableWidth={table.width}
                totalWidth={totalWidth}
                activeC={active.r === r ? active.c : -1}
                selC1={s.c1}
                selC2={s.c2}
                rowSelected={wholeRow && s.c1 >= 0}
                head={false}
                style={{ transform: `translateY(${headerH + vi.start}px)` }}
              />
            )
          })}
        </div>
      </div>
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
