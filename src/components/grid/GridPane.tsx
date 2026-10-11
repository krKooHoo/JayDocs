import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { onPaneAction, onSelectRequest } from '../../lib/nav'
import { store, useStoreVersion } from '../../store/documents'
import type { TsvTable } from '../../lib/tsv/model'
import { deleteColumns, deleteRows, duplicateRows, insertColumns, insertRows, seedTypedTable, type CellRange } from '../../lib/tsv/edits'
import { baseName, deriveSchema } from '../../lib/tsv/schema'
import { validateTable } from '../../lib/tsv/validate'
import { Grid, type CellPos, type ColOp, type GridHandle, type RowOp } from './Grid'

/** TSV 문서 창. 스토어의 표를 그리드로 보여 주고 편집·되돌리기·행/열 조작·저장을 잇는다. */
export function GridPane({ path, onSplit }: { path: string; onSplit: () => void }) {
  useStoreVersion()
  const grid = useRef<GridHandle>(null)
  const [active, setActive] = useState<CellPos>({ r: 0, c: 0 })
  const [notice, setNotice] = useState<string | null>(null)
  const noticeTimer = useRef<number | undefined>(undefined)

  useEffect(() => {
    store.retain(path)
    return () => store.release(path)
  }, [path])
  // 미리보기의 tsv-view 행이나 diff 항목에서 "이 행으로" 요청이 오면 활성 셀을 옮긴다.
  // 탭이 바뀌는 중이면 포커스가 날아가므로 한 프레임 뒤에 준다
  useEffect(() => onSelectRequest(path, (pos) => { setActive(pos); window.setTimeout(() => grid.current?.focus(), 50) }), [path])
  useEffect(() => onPaneAction(path, (a) => { if (a === 'focus') window.setTimeout(() => grid.current?.focus(), 0) }), [path])

  const d = store.get(path)
  const doc = d?.kind === 'tsv' && d.status === 'ready' ? d : null
  const table = doc?.table ?? null
  const fields = store.fieldFiles()
  const schema = useMemo(() => (table ? deriveSchema(table, path, fields) : null), [table, path, fields])
  const validation = useMemo(() => (table && schema ? validateTable(table, schema) : null), [table, schema])

  // 표가 줄어들면 활성 셀을 안으로
  useEffect(() => {
    if (!table) return
    const r = Math.min(active.r, Math.max(0, table.rows.length - 1))
    const c = Math.min(active.c, Math.max(0, table.width - 1))
    if (r !== active.r || c !== active.c) setActive({ r, c })
  }, [table, active])

  const showNotice = useCallback((msg: string) => {
    setNotice(msg)
    window.clearTimeout(noticeTimer.current)
    noticeTimer.current = window.setTimeout(() => setNotice(null), 4000)
  }, [])
  useEffect(() => () => window.clearTimeout(noticeTimer.current), [])

  const edit = useCallback((fn: (t: TsvTable) => TsvTable) => store.editTable(path, fn), [path])
  const undo = useCallback(() => store.undo(path), [path])
  const redo = useCallback(() => store.redo(path), [path])
  const refocus = () => window.setTimeout(() => grid.current?.focus(), 0)

  const currentRange = (): CellRange => grid.current?.range() ?? { r1: active.r, c1: active.c, r2: active.r, c2: active.c }

  const rowOp = useCallback((kind: RowOp, g: CellRange) => {
    if (!table) return
    const n = g.r2 - g.r1 + 1
    switch (kind) {
      case 'above': edit((t) => insertRows(t, g.r1, n)); break
      case 'below': edit((t) => insertRows(t, g.r2 + 1, n)); grid.current?.clearRange(); setActive({ r: g.r2 + 1, c: active.c }); break
      case 'append': edit((t) => insertRows(t, t.rows.length, 1)); grid.current?.clearRange(); setActive({ r: table.rows.length, c: active.c }); break
      case 'dup': edit((t) => duplicateRows(t, g.r1, n)); grid.current?.clearRange(); setActive({ r: g.r2 + 1, c: active.c }); break
      case 'del': {
        if (n >= table.rows.length && !window.confirm('모든 행을 지웁니다. 계속할까요?')) return
        edit((t) => deleteRows(t, g.r1, n))
        grid.current?.clearRange()
        showNotice(`행 ${n}개 삭제 (Ctrl+Z 로 되돌림)`)
        break
      }
    }
    refocus()
  }, [table, edit, active.c, showNotice])

  const colOp = useCallback((kind: ColOp, g: CellRange) => {
    if (!table) return
    const n = g.c2 - g.c1 + 1
    const msg = kind === 'del'
      ? `${n}개 열을 지웁니다. 열을 바꾸면 모든 행이 다시 조립되어 git diff 에 전체 행이 나옵니다. 계속할까요?`
      : `열 ${n}개를 넣으면 모든 행이 다시 조립되어 git diff 에 전체 행이 나옵니다. 계속할까요?`
    if (!window.confirm(msg)) { refocus(); return }
    switch (kind) {
      case 'left': edit((t) => insertColumns(t, g.c1, n)); break
      case 'right': edit((t) => insertColumns(t, g.c2 + 1, n)); grid.current?.clearRange(); setActive({ r: active.r, c: g.c2 + 1 }); break
      case 'del':
        if (n >= table.width) { showNotice('열을 전부 지울 수는 없습니다'); break }
        edit((t) => deleteColumns(t, g.c1, n))
        grid.current?.clearRange()
        break
    }
    refocus()
  }, [table, edit, active.r, showNotice])

  const dirty = store.isDirty(path)
  const status = doc?.saving ? '저장 중…' : doc?.conflict ? '충돌' : dirty ? '● 수정됨' : '저장됨'
  const canUndo = store.canUndo(path)
  const canRedo = store.canRedo(path)

  let schemaLabel = '스키마 없음 (타입 행 없음)'
  if (schema?.typed) schemaLabel = schema.defBlock ? `스키마: 타입 행 + ${baseName(schema.defBlock.file)}` : '스키마: 타입 행만'

  return (
    <div className="pane">
      <div className="pane-bar">
        <span className="pane-path" title={path}>{path}</span>
        <span className={'pane-status' + (dirty ? ' is-dirty' : '')}>{status}</span>
        <button onClick={() => void store.save(path)} disabled={!dirty || !!doc?.conflict || !!doc?.saving} title="Ctrl+S">저장</button>
        <button onClick={onSplit} title="이 문서를 오른쪽 창에도 연다 (Ctrl+\)">오른쪽에 분할</button>
      </div>
      {doc?.conflict && (
        <div className="banner">
          디스크의 파일이 바뀌었습니다. 어느 쪽을 쓸까요?
          <button onClick={() => store.takeDisk(path)}>디스크 내용 받기 (내 수정 버림)</button>
          <button onClick={() => void store.overwrite(path)}>내 내용으로 덮어쓰기</button>
        </div>
      )}
      {d?.status === 'error' && <div className="banner is-error">{d.error}</div>}
      {doc?.error && !doc.conflict && <div className="banner is-error">{doc.error}</div>}
      {doc?.warnings.map((w) => <div key={w} className="banner">{w}</div>)}
      {d?.status === 'loading' && <div className="pane-empty">불러오는 중…</div>}
      {table && schema && validation && (
        <>
          <div className="grid-toolbar">
            <button onClick={() => { undo(); refocus() }} disabled={!canUndo} title="되돌리기 (Ctrl+Z)">↶</button>
            <button onClick={() => { redo(); refocus() }} disabled={!canRedo} title="다시 실행 (Ctrl+Y)">↷</button>
            <span className="sep" />
            <span className="grid-toolbar-label">행</span>
            <button onClick={() => rowOp('above', currentRange())} disabled={!table.rows.length} title="선택한 행 위에 빈 행">＋위</button>
            <button onClick={() => rowOp('below', currentRange())} disabled={!table.rows.length} title="선택한 행 아래에 빈 행 (Ctrl+Alt+=)">＋아래</button>
            <button onClick={() => rowOp('append', currentRange())} title="맨 끝에 빈 행">＋끝</button>
            <button onClick={() => rowOp('dup', currentRange())} disabled={!table.rows.length} title="선택한 행 복제 (Ctrl+Shift+D)">복제</button>
            <button onClick={() => rowOp('del', currentRange())} disabled={!table.rows.length} title="선택한 행 삭제 (Ctrl+Alt+-)">삭제</button>
            <span className="sep" />
            <span className="grid-toolbar-label">열</span>
            <button onClick={() => colOp('left', currentRange())} title="선택한 열 왼쪽에 빈 열">＋왼쪽</button>
            <button onClick={() => colOp('right', currentRange())} title="선택한 열 오른쪽에 빈 열 (Ctrl+Alt+Shift+=)">＋오른쪽</button>
            <button onClick={() => colOp('del', currentRange())} disabled={table.width <= 1} title="선택한 열 삭제 (Ctrl+Alt+Shift+-)">삭제</button>
            {table.rows.length === 0 && (
              <>
                <span className="sep" />
                <button onClick={() => { edit(seedTypedTable); refocus() }}>타입 행·헤더 행 만들기</button>
              </>
            )}
            <span className="spacer" />
            {notice && <span className="grid-notice">{notice}</span>}
          </div>
          <Grid
            ref={grid}
            table={table}
            schema={schema}
            validation={validation}
            active={active}
            onActiveChange={setActive}
            onEdit={edit}
            onUndo={undo}
            onRedo={redo}
            onNotice={showNotice}
            onRowOp={rowOp}
            onColOp={colOp}
            widthsKey={`jaydocs.colw:${path}`}
          />
          <div className="grid-foot">
            <span>{table.rows.length}행 × {table.width}열</span>
            <span>{active.r + 1}행 {active.c + 1}열{schema.columns[active.c]?.name ? ` · ${schema.columns[active.c].name}` : ''}</span>
            <span className={validation.count ? 'is-err' : ''}>{validation.count ? `오류 ${validation.count}` : '오류 없음'}</span>
            <span>{table.eol === '\r\n' ? 'CRLF' : 'LF'}{table.bom ? ' · BOM' : ''}{table.trailingNewline ? '' : ' · 끝 개행 없음'}</span>
            {!table.trailingNewline && (
              <button
                className="grid-foot-btn"
                title="파일 끝에 개행을 넣는다. 끝 개행이 없으면 행을 덧붙일 때마다 마지막 줄이 git diff 에 같이 나온다 (.editorconfig 도 끝 개행을 요구한다)"
                onClick={() => { edit((t) => ({ ...t, trailingNewline: true })); refocus() }}
              >
                끝 개행 추가
              </button>
            )}
            <span>{schemaLabel}</span>
          </div>
        </>
      )}
    </div>
  )
}
