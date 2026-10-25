import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { onPaneAction, onSelectRequest, openPath } from '../../lib/nav'
import { backend } from '../../lib/backend'
import { store, useStoreVersion } from '../../store/documents'
import { applyCalc, calcLookupFiles, calcTemplate, computeCalc, parseCalcRules, siblingCalcPath, type CalcCell, type CalcResult, type LookupSource } from '../../lib/calc/calc'
import { cellAt, type TsvTable } from '../../lib/tsv/model'
import { deleteColumns, deleteRows, duplicateRows, insertColumns, insertRows, moveColumns, seedHeaderTable, seedTypedTable, setCell, type CellRange } from '../../lib/tsv/edits'
import { findMatches, matchIndex, replaceAll, replaceInCell, stepMatch, type FindHit, type FindOptions } from '../../lib/tsv/find'
import { baseName, deriveSchema } from '../../lib/tsv/schema'
import { sanitizeFor } from '../../lib/tsv/table'
import { issueKey, validateTable } from '../../lib/tsv/validate'
import { Grid, type CellPos, type ColOp, type GridHandle, type RowOp } from './Grid'
import { ReadOnlyBanner } from '../ReadOnlyBanner'
import { PaneErrorBoundary } from '../PaneErrorBoundary'
import { inRootOf } from '../../lib/roots.mjs'

const NO_HITS: FindHit[] = []
const NO_KEYS: ReadonlySet<number> = new Set()
const NO_CALC: ReadonlyMap<number, CalcCell> = new Map()
/** 표 객체마다 번호를 붙여 useMemo 의존성 문자열에 넣는다 */
const tableIds = new WeakMap<object, number>()
let nextTableId = 1
function tableId(t: object): number {
  let id = tableIds.get(t)
  if (!id) { id = nextTableId++; tableIds.set(t, id) }
  return id
}
/** Ctrl+F 때 활성 셀 값을 찾을 말로 미리 채우는 최대 길이 */
const PREFILL_MAX = 40

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

  const showNotice = useCallback((msg: string) => {
    setNotice(msg)
    window.clearTimeout(noticeTimer.current)
    noticeTimer.current = window.setTimeout(() => setNotice(null), 4000)
  }, [])
  useEffect(() => () => window.clearTimeout(noticeTimer.current), [])
  const d = store.get(path)
  const doc = d?.kind === 'tsv' && d.status === 'ready' ? d : null
  const table = doc?.table ?? null
  const fields = store.fieldFiles()
  const schema = useMemo(() => (table ? deriveSchema(table, path, fields) : null), [table, path, fields])
  const validation = useMemo(() => (table && schema ? validateTable(table, schema) : null), [table, schema])

  // ---- 계산식 (같은 폴더 X_Calc.tsv, DESIGN §17). 결과는 F9 로 값 열에 써 넣는다
  const calcPath = siblingCalcPath(path)
  const hasCalc = calcPath !== path && store.hasPath(calcPath)
  const calcTable = hasCalc ? store.auxTable(calcPath) : null
  const calcRules = useMemo(() => (calcTable ? parseCalcRules(calcTable) : null), [calcTable])
  const lookupFiles = useMemo(() => (calcRules ? calcLookupFiles(calcRules.rules) : []), [calcRules])
  // lookup 파일 이름은 이 표가 속한 루트(주 폴더 또는 가져온 폴더) 기준
  useEffect(() => { for (const f of lookupFiles) store.ensureAux(inRootOf(path, f)) }, [lookupFiles, path])
  // lookup 표가 읽히거나 바뀌면 다시 계산되게 — 표 객체 번호로 의존성을 만든다
  const lookupKey = lookupFiles.map((f) => { const t = store.auxTable(inRootOf(path, f)); return t ? `${f}#${tableId(t)}` : `${f}#-` }).join('|')
  const lookupSource = useCallback((f: string): LookupSource | null => {
    const p = inRootOf(path, f)
    const t = store.auxTable(p)
    return t ? { table: t, schema: deriveSchema(t, p, fields) } : null
  }, [fields, path])
  const calcResult = useMemo<CalcResult | null>(
    () => (table && schema && calcRules ? computeCalc(table, schema, calcRules.rules, lookupSource) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [table, schema, calcRules, lookupSource, lookupKey],
  )
  const calcErrors = useMemo(() => [...(calcRules?.errors ?? []), ...(calcResult?.errors ?? [])], [calcRules, calcResult])

  const runCalc = useCallback(() => {
    if (!schema || !calcRules) { showNotice(hasCalc ? '계산식을 아직 읽는 중입니다' : `계산식 파일이 없습니다: ${calcPath}`); return }
    let count = 0
    store.editTable(path, (t) => {
      const r = applyCalc(t, computeCalc(t, schema, calcRules.rules, lookupSource))
      count = r.count
      return r.table
    })
    showNotice(count ? `계산식 적용: ${count}개 셀 갱신 (Ctrl+Z 로 되돌림)` : '계산식 적용: 바뀐 셀 없음')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, schema, calcRules, lookupSource, hasCalc, calcPath])

  const createCalc = useCallback(async () => {
    // 예시 규칙에는 숫자 열이 자연스럽다. 없으면 Key·주석이 아닌 첫 열
    const cols = schema?.columns ?? []
    const example = (cols.find((c) => c.name && (c.type === 'byte' || c.type === 'uint' || c.type === 'float')) ?? cols.find((c) => !c.isKey && c.type !== 'comment' && c.name))?.name ?? null
    try {
      await backend().write(calcPath, calcTemplate(example), null)
      window.setTimeout(() => openPath(calcPath), 400) // 트리가 갱신될 시간
    } catch (e) {
      showNotice(`만들지 못했습니다: ${(e as Error).message}`)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calcPath, schema])

  useEffect(() => onPaneAction(path, (a) => {
    if (a === 'focus') window.setTimeout(() => grid.current?.focus(), 0)
    if (a === 'calc') runCalc()
  }), [path, runCalc])

  // 표가 줄어들면 활성 셀을 안으로
  useEffect(() => {
    if (!table) return
    const r = Math.min(active.r, Math.max(0, table.rows.length - 1))
    const c = Math.min(active.c, Math.max(0, table.width - 1))
    if (r !== active.r || c !== active.c) setActive({ r, c })
  }, [table, active])

  const edit = useCallback((fn: (t: TsvTable) => TsvTable) => {
    if (store.isReadOnly(path)) { showNotice('읽기 전용입니다 — 위의 안내 막대를 보세요'); return }
    store.editTable(path, fn)
  }, [path, showNotice])
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

  /** 열 글자를 끌어 옮기기 (Grid 에서). 열 삽입·삭제처럼 확인을 묻는다 */
  const moveCols = useCallback((from: number, count: number, to: number): boolean => {
    if (!window.confirm(`열 ${count}개를 옮기면 모든 행이 다시 조립되어 git diff 에 전체 행이 나옵니다. 계속할까요?`)) { refocus(); return false }
    edit((t) => moveColumns(t, from, count, to))
    refocus()
    return true
  }, [edit])

  // ---- 찾기 / 바꾸기 (툴바와 그리드 사이의 막대)
  const [findOpen, setFindOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [replacement, setReplacement] = useState('')
  const [matchCase, setMatchCase] = useState(false)
  const [wholeCell, setWholeCell] = useState(false)
  /** 막대의 어느 칸에 포커스를 줄지. n 은 같은 칸을 다시 요청할 때 바뀐다 */
  const [findFocus, setFindFocus] = useState<{ field: 'find' | 'replace'; n: number } | null>(null)
  const findInput = useRef<HTMLInputElement>(null)
  const replaceInput = useRef<HTMLInputElement>(null)
  const findOpts = useMemo<FindOptions>(() => ({ matchCase, wholeCell }), [matchCase, wholeCell])
  const hits = useMemo(() => (findOpen && table ? findMatches(table, query, findOpts) : NO_HITS), [findOpen, table, query, findOpts])
  const hitKeys = useMemo<ReadonlySet<number>>(
    () => (table && hits.length ? new Set(hits.map((h) => issueKey(table.width, h.r, h.c))) : NO_KEYS),
    [hits, table],
  )

  useEffect(() => {
    if (!findFocus) return
    const el = findFocus.field === 'replace' ? replaceInput.current : findInput.current
    el?.focus()
    el?.select()
  }, [findFocus])

  const focusFindField = (field: 'find' | 'replace') => setFindFocus((f) => ({ field, n: (f?.n ?? 0) + 1 }))

  const openFind = useCallback((withReplace: boolean) => {
    if (table) {
      const g = grid.current?.range()
      const single = !g || (g.r1 === g.r2 && g.c1 === g.c2)
      const v = cellAt(table, active.r, active.c)
      // 활성 셀 값이 짧으면 찾을 말로 미리 채운다 (Ctrl+H 는 찾을 말이 비어 있을 때만)
      if (single && v && v.length <= PREFILL_MAX && (!withReplace || !query)) setQuery(v)
    }
    setFindOpen(true)
    focusFindField(withReplace ? 'replace' : 'find')
  }, [table, active, query])

  const closeFind = useCallback(() => {
    setFindOpen(false)
    grid.current?.focus()
  }, [])

  const goTo = (h: FindHit) => {
    grid.current?.clearRange()
    setActive({ r: h.r, c: h.c })
  }

  /** 활성 셀 다음(1) / 이전(-1) 결과로. 끝에 닿으면 반대쪽 처음으로 돈다 */
  const findStep = useCallback((dir: 1 | -1) => {
    if (!table) return
    if (!query) { openFind(false); return }
    const list = findOpen ? hits : findMatches(table, query, findOpts)
    if (!findOpen) setFindOpen(true)
    const i = stepMatch(list, active, dir)
    if (i < 0) { showNotice(`찾지 못했습니다: ${query}`); return }
    grid.current?.clearRange()
    setActive({ r: list[i].r, c: list[i].c })
  }, [table, query, findOpen, hits, findOpts, active, openFind, showNotice])

  const cleanReplacement = (): string => {
    const [rep, changed] = sanitizeFor(table?.format, replacement)
    if (changed) showNotice('탭·줄바꿈은 TSV 셀에 넣을 수 없어 공백으로 바꿨습니다')
    return rep
  }

  /** 지금 셀이 걸려 있으면 그 셀에서 바꾸고, 다음 결과로 */
  const replaceOne = () => {
    if (!table || !query) return
    const rep = cleanReplacement()
    const { r, c } = active
    let after = table
    if (matchIndex(hits, active) >= 0) {
      after = setCell(table, r, c, replaceInCell(cellAt(table, r, c), query, rep, findOpts))
      edit((t) => setCell(t, r, c, replaceInCell(cellAt(t, r, c), query, rep, findOpts)))
    }
    const list = findMatches(after, query, findOpts)
    const i = stepMatch(list, active, 1)
    if (i >= 0) goTo(list[i])
    else if (after === table) showNotice(`찾지 못했습니다: ${query}`)
  }

  /** 걸린 셀을 전부 — onEdit 한 번이라 되돌리기도 한 번 */
  const replaceEvery = () => {
    if (!table || !query) return
    const rep = cleanReplacement()
    const { count } = replaceAll(table, query, rep, findOpts)
    if (count === 0) { showNotice('바꿀 셀이 없습니다'); return }
    edit((t) => replaceAll(t, query, rep, findOpts).table)
    showNotice(`${count}개 셀 바꿈`)
  }

  const onFindKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return
    const mod = e.ctrlKey || e.metaKey
    if (e.key === 'Escape') { e.preventDefault(); closeFind(); return }
    if (e.key === 'F3') { e.preventDefault(); findStep(e.shiftKey ? -1 : 1); return }
    // 막대 안에서 Ctrl+F / Ctrl+H 는 칸만 옮긴다 (브라우저 찾기·기록을 막는다). Ctrl+Shift+F/H 는 전역
    if (mod && !e.shiftKey && !e.altKey && (e.code === 'KeyF' || e.code === 'KeyH')) {
      e.preventDefault()
      focusFindField(e.code === 'KeyH' ? 'replace' : 'find')
      return
    }
    if (e.key === 'Enter' && !mod && !e.altKey && (e.target === findInput.current || e.target === replaceInput.current)) {
      e.preventDefault()
      findStep(e.shiftKey ? -1 : 1)
    }
  }

  const hitIdx = findOpen ? matchIndex(hits, active) : -1
  let findCount = ''
  if (query) findCount = hits.length ? `${hitIdx >= 0 ? hitIdx + 1 : '–'} / ${hits.length}` : '결과 없음'

  const dirty = store.isDirty(path)
  const readOnly = store.isReadOnly(path)
  const status = doc?.saving ? '저장 중…' : doc?.conflict ? '충돌' : readOnly ? '🔒 읽기 전용' : dirty ? '● 수정됨' : '저장됨'
  const canUndo = store.canUndo(path)
  const canRedo = store.canRedo(path)

  let schemaLabel = '스키마 없음 (타입 행 없음)'
  if (schema?.typed) schemaLabel = schema.defBlock ? `스키마: 타입 행 + ${baseName(schema.defBlock.file)}` : '스키마: 타입 행만'
  else if (schema?.headerRows) schemaLabel = 'CSV — 첫 줄을 머리글로'

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
      {readOnly && <ReadOnlyBanner path={path} />}
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
            <span className="sep" />
            <button onClick={() => openFind(false)} title="찾기 (Ctrl+F) · 바꾸기 (Ctrl+H)">찾기</button>
            {schema.typed && calcPath !== path && (
              <>
                <span className="sep" />
                {hasCalc ? (
                  <>
                    <button
                      onClick={() => { runCalc(); refocus() }}
                      disabled={!calcResult || (calcResult.staleCount === 0 && calcErrors.length === 0)}
                      title={`${baseName(calcPath)} 의 식을 평가해 값 열에 써 넣는다 (F9). 노란 밑줄 셀이 바뀐다`}
                    >
                      계산{calcResult?.staleCount ? ` (${calcResult.staleCount})` : ''}
                    </button>
                    <button onClick={() => openPath(calcPath)} title={`${baseName(calcPath)} 열기`}>계산식</button>
                  </>
                ) : (
                  <button onClick={() => void createCalc()} title={`${baseName(calcPath)} 를 만들어 연다 — 열 값을 식으로 채우는 규칙을 적는 곳`}>계산식 만들기</button>
                )}
              </>
            )}
            {table.rows.length === 0 && (
              <>
                <span className="sep" />
                {table.format === 'csv'
                  ? <button onClick={() => { edit((t) => seedHeaderTable(t)); refocus() }} title="첫 줄은 머리글(열 이름)">머리글 행 만들기</button>
                  : <button onClick={() => { edit(seedTypedTable); refocus() }}>타입 행·헤더 행 만들기</button>}
              </>
            )}
            <span className="spacer" />
            {notice && <span className="grid-notice">{notice}</span>}
          </div>
          {calcErrors.length > 0 && (
            <div className="banner is-error">
              계산식 문제 {calcErrors.length}건:
              {calcErrors.slice(0, 4).map((e, i) => (
                <span key={i} className="banner-item">{e.rule ? `${e.rule.target}${e.rule.key ? `[${e.rule.key}]` : ''}` : baseName(calcPath)}{e.row !== null ? ` ${e.row + 1}행` : ''} — {e.message}</span>
              ))}
              {calcErrors.length > 4 && <span className="muted">… 외 {calcErrors.length - 4}건</span>}
              <button onClick={() => openPath(calcPath)}>계산식 열기</button>
            </div>
          )}
          {findOpen && (
            <div className="grid-find" onKeyDown={onFindKey}>
              <input
                ref={findInput}
                className="grid-find-input"
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="찾기"
                aria-label="찾기"
                spellCheck={false}
                autoComplete="off"
              />
              <input
                ref={replaceInput}
                className="grid-find-input"
                type="text"
                value={replacement}
                onChange={(e) => setReplacement(e.target.value)}
                placeholder="바꾸기"
                aria-label="바꾸기"
                spellCheck={false}
                autoComplete="off"
              />
              <label title="대소문자를 구분해 찾는다">
                <input type="checkbox" checked={matchCase} onChange={(e) => setMatchCase(e.target.checked)} /> 대소문자 구분
              </label>
              <label title="셀 값 전체가 찾을 말과 같아야 걸린다. 바꾸면 셀 전체가 바뀐다">
                <input type="checkbox" checked={wholeCell} onChange={(e) => setWholeCell(e.target.checked)} /> 셀 전체 일치
              </label>
              <span className={'grid-find-count' + (query && !hits.length ? ' is-none' : '')}>{findCount}</span>
              <button onClick={() => findStep(-1)} title="이전 (Shift+Enter · Shift+F3)">이전</button>
              <button onClick={() => findStep(1)} title="다음 (Enter · F3)">다음</button>
              <button onClick={replaceOne} title="지금 셀에서 바꾸고 다음 결과로">바꾸기</button>
              <button onClick={replaceEvery} title="걸린 셀을 전부 바꾼다 (Ctrl+Z 한 번으로 되돌림)">모두 바꾸기</button>
              <button onClick={closeFind} title="닫기 (Esc)">닫기</button>
            </div>
          )}
          <PaneErrorBoundary>
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
              onMoveColumns={moveCols}
              onFind={openFind}
              onFindStep={findStep}
              matches={hitKeys}
              calcCells={calcResult?.cells ?? NO_CALC}
              onCalc={runCalc}
              widthsKey={`jaydocs.colw:${path}`}
            />
          </PaneErrorBoundary>
          <div className="grid-foot">
            <span>{table.rows.length}행 × {table.width}열</span>
            <span>{active.r + 1}행 {active.c + 1}열{schema.columns[active.c]?.name ? ` · ${schema.columns[active.c].name}` : ''}</span>
            <span className={validation.count ? 'is-err' : ''}>{validation.count ? `오류 ${validation.count}` : '오류 없음'}</span>
            <span>{table.format === 'csv' ? 'CSV · ' : ''}{table.eol === '\r\n' ? 'CRLF' : 'LF'}{table.bom ? ' · BOM' : ''}{table.trailingNewline ? '' : ' · 끝 개행 없음'}</span>
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
            {hasCalc && calcRules && <span title={calcPath}>계산식 {calcRules.rules.length}개{calcResult?.staleCount ? ` · 바뀔 셀 ${calcResult.staleCount}` : ''}</span>}
          </div>
        </>
      )}
    </div>
  )
}
