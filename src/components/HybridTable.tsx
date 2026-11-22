import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { TABLE_OP_KEYS, parseTable, unescapeCell, type TableOp } from '../lib/md/tableEdit'
import { comboFromEvent } from '../lib/keys'
import { minCellWidth } from '../lib/cellWidth'

/** 렌더마다 새 배열을 만들지 않게 모듈 상수 (PreviewPane 을 들이면 순환 import 가 되어 따로 둔다) */
const REMARK_PLUGINS = [remarkGfm]

/**
 * 하이브리드 모드의 표 (DESIGN §23). 칸은 렌더된 글자로 보이고, 누르면 그 칸만 입력 칸이 된다.
 * 입력은 글자마다 문서에 바로 들어간다 (되돌리기·다른 창·저장 표시가 그대로 따라온다).
 * 한글 조합 중에는 보내지 않고 조합이 끝날 때 보낸다.
 *
 * 입력 칸은 칸 너비 안에서 줄을 바꾼다 (H10) — 보이지 않는 글자 상자가 칸 크기를 정하고 textarea 가 그 위를 덮는다.
 * 글자 길이만큼 넓어지는 input 이면 그 열이 표를 다 차지해 다른 열이 한 글자 폭으로 눌렸다.
 */
export interface CellPos { row: number; col: number }

export interface HybridTableProps {
  source: string
  readOnly: boolean
  /** (row, col) 칸 글자를 바꾼다. row 0 = 머리글 */
  onEdit: (row: number, col: number, text: string) => void
  onAddRow: () => void
  /** 행 · 열 넣기 · 지우기. 그 뒤에 고칠 칸을 돌려준다 (못 하면 null) */
  onStructure: (op: TableOp, row: number, col: number) => CellPos | null
  onUndo: (redo: boolean) => void
  /** 표 편집을 끝내고 에디터로 */
  onLeave: () => void
  /** 고치는 칸이 바뀔 때 (팔레트 명령이 이 칸을 기준으로 돈다) */
  onActive: (pos: CellPos) => void
  /** 이 칸을 고치기 시작하라는 요청 (팔레트 명령 · `|||`). n 이 바뀔 때마다 한 번 */
  focusReq: (CellPos & { n: number }) | null
}

/** 칸의 최소 폭 (`lib/cellWidth`). 18px 은 칸의 좌우 여백, 2px 는 테두리 · 반올림 몫 */
const minWidthOf = (raw: string) => minCellWidth(raw, 20)

const inline = { p: ({ children }: { children?: React.ReactNode }) => <>{children}</> }

/** 칸 하나. 칸마다 마크다운을 파싱하므로 원문이 같으면 다시 그리지 않는다 (한 글자에 모든 칸이 재파싱되지 않게) */
const Cell = memo(function Cell({ raw }: { raw: string }) {
  if (!raw) return <span className="cm-hybrid-cell-empty">{' '}</span>
  return <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={inline}>{raw}</ReactMarkdown>
})

export function HybridTable({ source, readOnly, onEdit, onAddRow, onStructure, onUndo, onLeave, onActive, focusReq }: HybridTableProps) {
  const table = useMemo(() => parseTable(source), [source])
  const [editing, setEditing] = useState<CellPos | null>(null)
  const [draft, setDraft] = useState('')
  /** 마지막으로 문서에 보낸 글자 — 문서 쪽 글자가 이것과 다르면 밖(되돌리기 등)에서 바뀐 것 */
  const sent = useRef<string | null>(null)

  const rows = table?.rows ?? []
  const cols = table?.cols ?? 0
  const rawAt = (p: CellPos) => rows[p.row]?.cells[p.col]?.raw ?? ''
  const current = editing && editing.row < rows.length ? unescapeCell(rawAt(editing)) : null

  useEffect(() => {
    if (current === null || current === sent.current) return
    setDraft(current)
    sent.current = current
  }, [current])

  // 편집이 끝나도(칸에서 포커스가 빠져도) 알리지 않는다 — 팔레트를 열면 칸이 포커스를 잃지만 명령은 그 칸을 기준으로 돌아야 한다
  useEffect(() => { if (editing) onActive(editing) }, [editing?.row, editing?.col]) // eslint-disable-line react-hooks/exhaustive-deps

  // 고치던 칸의 행이 사라졌으면 (새 행을 되돌리기 등) 편집을 끝내고 에디터로 — 포커스가 허공에 남지 않게
  const lost = editing !== null && (editing.row >= rows.length || editing.col >= cols)
  useLayoutEffect(() => {
    if (!lost) return
    setEditing(null)
    onLeave()
  }, [lost, onLeave])

  const start = (p: CellPos) => {
    if (readOnly) return
    const text = p.row < rows.length ? unescapeCell(rawAt(p)) : ''
    setEditing(p)
    setDraft(text)
    sent.current = text
  }

  const reqN = focusReq?.n
  useEffect(() => {
    if (focusReq) start({ row: focusReq.row, col: focusReq.col })
  }, [reqN]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!table) return <pre>{source}</pre>

  const commit = (text: string) => {
    if (!editing) return
    sent.current = text
    onEdit(editing.row, editing.col, text)
  }
  const move = (dr: number, dc: number) => {
    if (!editing) return
    let row = editing.row + dr
    let col = editing.col + dc
    if (col >= cols) { col = 0; row++ }
    if (col < 0) { col = cols - 1; row-- }
    if (row < 0) return
    if (row >= rows.length) {
      // Tab 으로 마지막 칸을 넘으면 새 행, Enter · ↓ 는 표를 떠난다
      if (dc > 0) { onAddRow(); start({ row: rows.length, col: 0 }) } else { setEditing(null); onLeave() }
      return
    }
    start({ row, col })
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return
    const op = TABLE_OP_KEYS[comboFromEvent(e.nativeEvent) ?? '']
    if (op && editing) {
      e.preventDefault()
      e.stopPropagation()
      const next = onStructure(op, editing.row, editing.col)
      if (next) start(next)
      return
    }
    const mod = e.ctrlKey || e.metaKey
    if (mod && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); onUndo(e.shiftKey); return }
    if (mod && (e.key === 'y' || e.key === 'Y')) { e.preventDefault(); onUndo(true); return }
    if (mod || e.altKey) return
    switch (e.key) {
      case 'Tab': e.preventDefault(); move(0, e.shiftKey ? -1 : 1); break
      case 'Enter': e.preventDefault(); move(e.shiftKey ? -1 : 1, 0); break
      case 'ArrowDown': e.preventDefault(); move(1, 0); break
      case 'ArrowUp': e.preventDefault(); move(-1, 0); break
      case 'Escape': e.preventDefault(); setEditing(null); onLeave(); break
      default: break
    }
  }

  const renderCell = (row: number, col: number) => {
    const Tag = row === 0 ? 'th' : 'td'
    const isEditing = editing?.row === row && editing.col === col
    const style = { textAlign: table.align[col] ?? undefined, minWidth: minWidthOf(rows[row]?.cells[col]?.raw ?? '') }
    return (
      <Tag
        key={col}
        style={style}
        className={isEditing ? 'is-editing' : readOnly ? undefined : 'is-editable'}
        onMouseDown={(e) => {
          if (isEditing || readOnly) return
          e.preventDefault()
          start({ row, col })
        }}
      >
        {isEditing ? (
          <div className="cm-hybrid-cell-edit">
            {/* 칸 크기를 정하는 보이지 않는 글자 — 끝의 글자는 빈 칸 · 끝 공백에도 한 줄 높이를 둔다 */}
            <span className="cm-hybrid-cell-sizer" aria-hidden="true">{draft + '​'}</span>
            <textarea
              className="cm-hybrid-cell-input"
              autoFocus
              rows={1}
              value={draft}
              spellCheck={false}
              onFocus={(e) => { const n = e.currentTarget.value.length; e.currentTarget.setSelectionRange(n, n) }}
              onChange={(e) => {
                // 줄바꿈은 칸을 깨므로 (붙여 넣은 글) 공백으로
                const text = e.target.value.replace(/\r?\n/g, ' ')
                setDraft(text)
                if (!(e.nativeEvent as InputEvent).isComposing) commit(text)
              }}
              onCompositionEnd={(e) => commit(e.currentTarget.value.replace(/\r?\n/g, ' '))}
              onKeyDown={onKeyDown}
              onBlur={() => setEditing((cur) => (cur && cur.row === row && cur.col === col ? null : cur))}
            />
          </div>
        ) : (
          <Cell raw={rows[row]?.cells[col]?.raw ?? ''} />
        )}
      </Tag>
    )
  }

  const colIdx = Array.from({ length: cols }, (_, i) => i)
  return (
    <div className="preview-body is-inline">
      <table className="cm-hybrid-table">
        <thead><tr>{colIdx.map((c) => renderCell(0, c))}</tr></thead>
        {rows.length > 1 && <tbody>{rows.slice(1).map((_, i) => <tr key={i}>{colIdx.map((c) => renderCell(i + 1, c))}</tr>)}</tbody>}
      </table>
    </div>
  )
}
