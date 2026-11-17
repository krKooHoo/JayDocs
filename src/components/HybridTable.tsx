import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { parseTable, unescapeCell } from '../lib/md/tableEdit'

/** 렌더마다 새 배열을 만들지 않게 모듈 상수 (PreviewPane 을 들이면 순환 import 가 되어 따로 둔다) */
const REMARK_PLUGINS = [remarkGfm]

/**
 * 하이브리드 모드의 표 (DESIGN §23). 칸은 렌더된 글자로 보이고, 누르면 그 칸만 입력 칸이 된다.
 * 입력은 글자마다 문서에 바로 들어간다 (되돌리기·다른 창·저장 표시가 그대로 따라온다).
 * 한글 조합 중에는 보내지 않고 조합이 끝날 때 보낸다.
 */
export interface HybridTableProps {
  source: string
  readOnly: boolean
  /** (row, col) 칸 글자를 바꾼다. row 0 = 머리글 */
  onEdit: (row: number, col: number, text: string) => void
  onAddRow: () => void
  onUndo: (redo: boolean) => void
  /** 표 편집을 끝내고 에디터로 */
  onLeave: () => void
}

interface Pos { row: number; col: number }

const inline = { p: ({ children }: { children?: React.ReactNode }) => <>{children}</> }

/** 칸 하나. 칸마다 마크다운을 파싱하므로 원문이 같으면 다시 그리지 않는다 (한 글자에 모든 칸이 재파싱되지 않게) */
const Cell = memo(function Cell({ raw }: { raw: string }) {
  if (!raw) return <span className="cm-hybrid-cell-empty">{' '}</span>
  return <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={inline}>{raw}</ReactMarkdown>
})

export function HybridTable({ source, readOnly, onEdit, onAddRow, onUndo, onLeave }: HybridTableProps) {
  const table = useMemo(() => parseTable(source), [source])
  const [editing, setEditing] = useState<Pos | null>(null)
  const [draft, setDraft] = useState('')
  /** 마지막으로 문서에 보낸 글자 — 문서 쪽 글자가 이것과 다르면 밖(되돌리기 등)에서 바뀐 것 */
  const sent = useRef<string | null>(null)

  const rows = table?.rows ?? []
  const cols = table?.cols ?? 0
  const rawAt = (p: Pos) => rows[p.row]?.cells[p.col]?.raw ?? ''
  const current = editing && editing.row < rows.length ? unescapeCell(rawAt(editing)) : null

  useEffect(() => {
    if (current === null || current === sent.current) return
    setDraft(current)
    sent.current = current
  }, [current])

  // 고치던 칸의 행이 사라졌으면 (새 행을 되돌리기 등) 편집을 끝내고 에디터로 — 포커스가 허공에 남지 않게
  const lost = editing !== null && editing.row >= rows.length
  useLayoutEffect(() => {
    if (!lost) return
    setEditing(null)
    onLeave()
  }, [lost, onLeave])

  if (!table) return <pre>{source}</pre>

  const start = (p: Pos) => {
    if (readOnly) return
    const text = p.row < rows.length ? unescapeCell(rawAt(p)) : ''
    setEditing(p)
    setDraft(text)
    sent.current = text
  }
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

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return
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
    const style = table.align[col] ? { textAlign: table.align[col]! } : undefined
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
          <input
            className="cm-hybrid-cell-input"
            autoFocus
            value={draft}
            spellCheck={false}
            onFocus={(e) => { const n = e.currentTarget.value.length; e.currentTarget.setSelectionRange(n, n) }}
            onChange={(e) => {
              setDraft(e.target.value)
              if (!(e.nativeEvent as InputEvent).isComposing) commit(e.target.value)
            }}
            onCompositionEnd={(e) => commit(e.currentTarget.value)}
            onKeyDown={onKeyDown}
            onBlur={() => setEditing((cur) => (cur && cur.row === row && cur.col === col ? null : cur))}
          />
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
