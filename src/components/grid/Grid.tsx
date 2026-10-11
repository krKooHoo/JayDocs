import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { cellAt, type TsvRow, type TsvTable } from '../../lib/tsv/model'
import { columnLetter, type ColumnSchema, type TableSchema } from '../../lib/tsv/schema'
import { issueKey, type Validation } from '../../lib/tsv/validate'
import { pasteBlock, setCell } from '../../lib/tsv/edits'
import { parseClipboardTsv } from '../../lib/tsv/clipboard'
import { sanitizeCell } from '../../lib/tsv/serialize'

/**
 * 자체 DOM 그리드 (DESIGN D3). 상태는 갖지 않고 표(TsvTable) 를 그리기만 한다 — 편집은 onEdit 으로 올려 보낸다.
 *
 * 입력은 항상 떠 있는 <textarea> 하나가 받는다. 셀을 고르면 그 위(1×1, 투명)에 두고 포커스를 준다.
 * 글자가 들어오면(input / compositionstart) 그때 편집 모드로 커진다. 한글 조합이 textarea 안에서 시작되므로
 * 첫 자모가 사라지는 문제(§3.3)가 구조적으로 없다. 조합 중(isComposing / keyCode 229)에는 키를 가로채지 않는다.
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
}

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
  return parts.join('\n')
}

// ---------------------------------------------------------------- 셀 · 행
interface CellProps {
  r: number
  c: number
  v: string
  col: ColumnSchema
  w: number
  active: boolean
  issue: string | undefined
  head: boolean
}

const Cell = memo(function Cell({ r, c, v, col, w, active, issue, head }: CellProps) {
  let cls = 'grid-cell'
  if (col.type === 'comment') cls += ' is-comment'
  if (col.isKey) cls += ' is-key'
  if (!head && isNumeric(col.type)) cls += ' is-num'
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
  head: boolean
  style?: React.CSSProperties
}

const Row = memo(function Row({ row, r, widths, schema, validation, tableWidth, totalWidth, activeC, head, style }: RowProps) {
  let cls = 'grid-row'
  cls += head ? ' is-head' : ' is-body'
  if (head && schema.typed && r === 0) cls += ' is-type'
  return (
    <div className={cls} style={{ ...style, width: totalWidth }}>
      <div className={'grid-rownum' + (activeC >= 0 ? ' is-active-row' : '')}>{r + 1}</div>
      {widths.map((w, c) => (
        <Cell
          key={c}
          r={r}
          c={c}
          v={row.cells[c] ?? ''}
          col={schema.columns[c]}
          w={w}
          active={activeC === c}
          issue={validation.issues.get(issueKey(tableWidth, r, c))}
          head={head}
        />
      ))}
    </div>
  )
})

// ---------------------------------------------------------------- 그리드
export const Grid = forwardRef<GridHandle, GridProps>(function Grid(p, ref) {
  const { table, schema, validation, active, onActiveChange, onEdit, onUndo, onRedo, onNotice } = p
  const headerRows = schema.headerRows
  const headerH = LETTER_H + headerRows * ROW_H
  const bodyCount = Math.max(0, table.rows.length - headerRows)

  const scrollRef = useRef<HTMLDivElement>(null)
  const ta = useRef<HTMLTextAreaElement>(null)
  const [scroll, setScroll] = useState({ top: 0, left: 0 })
  const [editing, setEditing] = useState<Editing | null>(null)
  const [draft, setDraft] = useState('')
  const [ddActive, setDdActive] = useState<number | null>(null)

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
  useImperativeHandle(ref, () => ({ focus: focusInput }), [focusInput])

  // ---- 편집 시작 · 확정 · 취소
  const startEdit = useCallback((mode: Editing['mode'], r = active.r, c = active.c) => {
    const el = ta.current
    if (!el || r >= table.rows.length) return
    if (mode === 'edit') {
      const cur = cellAt(table, r, c)
      el.value = cur
      el.setSelectionRange(cur.length, cur.length)
    }
    setEditing({ r, c, mode })
    setDraft(el.value)
    setDdActive(null)
    el.focus({ preventScroll: true })
  }, [active, table])

  const moveActive = useCallback((dir: Move, far = false) => {
    const maxR = Math.max(0, table.rows.length - 1)
    const maxC = Math.max(0, table.width - 1)
    let { r, c } = active
    if (dir === 'up') r = far ? 0 : Math.max(0, r - 1)
    if (dir === 'down') r = far ? maxR : Math.min(maxR, r + 1)
    if (dir === 'left') c = far ? 0 : Math.max(0, c - 1)
    if (dir === 'right') c = far ? maxC : Math.min(maxC, c + 1)
    if (r !== active.r || c !== active.c) onActiveChange({ r, c })
  }, [active, table, onActiveChange])

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

  const selectCell = useCallback((r: number, c: number) => {
    if (editing && (editing.r !== r || editing.c !== c)) commitEdit(null)
    if (r !== active.r || c !== active.c) onActiveChange({ r, c })
    focusInput()
  }, [editing, commitEdit, active, onActiveChange, focusInput])

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

  // ---- 키보드
  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return
    const mod = e.ctrlKey || e.metaKey
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
    // 선택 상태
    switch (e.key) {
      case 'ArrowUp': e.preventDefault(); moveActive('up', mod); return
      case 'ArrowDown': e.preventDefault(); moveActive('down', mod); return
      case 'ArrowLeft': e.preventDefault(); moveActive('left', mod); return
      case 'ArrowRight': e.preventDefault(); moveActive('right', mod); return
      case 'Tab': e.preventDefault(); moveActive(e.shiftKey ? 'left' : 'right'); return
      case 'Home':
        e.preventDefault()
        onActiveChange({ r: mod ? 0 : active.r, c: 0 })
        return
      case 'End':
        e.preventDefault()
        onActiveChange({ r: mod ? Math.max(0, table.rows.length - 1) : active.r, c: Math.max(0, table.width - 1) })
        return
      case 'PageUp':
      case 'PageDown': {
        e.preventDefault()
        const el = scrollRef.current
        const page = Math.max(1, Math.floor(((el?.clientHeight ?? 400) - headerH) / ROW_H) - 1)
        const r = e.key === 'PageUp' ? Math.max(0, active.r - page) : Math.min(table.rows.length - 1, active.r + page)
        onActiveChange({ r, c: active.c })
        return
      }
      case 'Enter':
      case 'F2':
        e.preventDefault()
        startEdit('edit')
        return
      case 'Delete':
      case 'Backspace': {
        e.preventDefault()
        const { r, c } = active
        onEdit((t) => setCell(t, r, c, ''))
        return
      }
      case ' ': {
        const col = schema.columns[active.c]
        if (col?.type === 'bool' && active.r >= headerRows && isBoolText(cellAt(table, active.r, active.c))) {
          e.preventDefault()
          toggleBool(active.r, active.c)
        }
        return
      }
      case 'z':
      case 'Z':
        if (mod) { e.preventDefault(); if (e.shiftKey) onRedo(); else onUndo() }
        return
      case 'y':
      case 'Y':
        if (mod) { e.preventDefault(); onRedo() }
        return
      default:
        return // 글자 키는 textarea 로 들어가 input 이벤트에서 편집이 시작된다
    }
  }

  const onInput = (e: React.FormEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget
    if (!editing) {
      if (active.r >= table.rows.length) { el.value = ''; return }
      setEditing({ r: active.r, c: active.c, mode: 'replace' })
    }
    setDraft(el.value)
    setDdActive(null)
  }
  const onCompositionStart = () => {
    if (!editing && active.r < table.rows.length) {
      setEditing({ r: active.r, c: active.c, mode: 'replace' })
      setDraft('')
    }
  }
  const onBlur = () => { if (editing) commitEdit(null) }

  // ---- 클립보드 (선택 상태에서만 가로챈다. 편집 중엔 textarea 기본 동작)
  const onCopy = (e: React.ClipboardEvent) => {
    if (editing) return
    e.preventDefault()
    e.clipboardData.setData('text/plain', cellAt(table, active.r, active.c))
  }
  const onCut = (e: React.ClipboardEvent) => {
    if (editing) return
    e.preventDefault()
    e.clipboardData.setData('text/plain', cellAt(table, active.r, active.c))
    const { r, c } = active
    onEdit((t) => setCell(t, r, c, ''))
  }
  const onPaste = (e: React.ClipboardEvent) => {
    if (editing) return
    const text = e.clipboardData.getData('text/plain')
    e.preventDefault()
    if (text === '') return
    const block = parseClipboardTsv(text)
    const { r, c } = active
    const preview = pasteBlock(table, r, c, block)
    onEdit((t) => pasteBlock(t, r, c, block).table)
    const cols = Math.max(...block.map((l) => l.length))
    const notes = [`${block.length}×${cols} 붙여넣음`]
    if (preview.addedRows) notes.push(`행 ${preview.addedRows}개 추가`)
    if (preview.clippedCols) notes.push(`열 ${preview.clippedCols}개는 표 너비를 넘어 잘림`)
    onNotice(notes.join(' · '))
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
    const cell = target.closest<HTMLElement>('[data-r]')
    if (!cell) return
    e.preventDefault()
    const r = Number(cell.dataset.r)
    const c = Number(cell.dataset.c)
    selectCell(r, c)
    if (target.closest('[data-bool]')) toggleBool(r, c)
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

  const items = virtualizer.getVirtualItems()
  return (
    <div className="grid-wrap">
      <div ref={scrollRef} className="grid-scroll" onScroll={onScroll} onMouseDown={onMouseDown} onDoubleClick={onDoubleClick}>
        <div className="grid-inner" style={{ width: totalWidth, height: headerH + virtualizer.getTotalSize() }}>
          <div className="grid-head" style={{ width: totalWidth }}>
            <div className="grid-row is-letters" style={{ width: totalWidth }}>
              <div className="grid-rownum grid-corner" />
              {widths.map((w, c) => {
                const col = schema.columns[c]
                const errs = validation.byColumn[c]
                return (
                  <div key={c} className={'grid-letter' + (active.c === c ? ' is-active-col' : '')} style={{ width: w }} title={columnTitle(col)}>
                    {columnLetter(c)}
                    {errs > 0 && <span className="grid-errcount">{errs}</span>}
                    <span className="grid-resize" data-resize={c} />
                  </div>
                )
              })}
            </div>
            {table.rows.slice(0, headerRows).map((row, r) => (
              <Row key={r} row={row} r={r} widths={widths} schema={schema} validation={validation} tableWidth={table.width} totalWidth={totalWidth} activeC={active.r === r ? active.c : -1} head />
            ))}
          </div>
          {items.map((vi) => {
            const r = vi.index + headerRows
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
