import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { onPaneAction, onSelectRequest, openPath } from '../../lib/nav'
import { cmdTitle, tip } from '../../lib/commands'
import { backend } from '../../lib/backend'
import { store, useDocVersion, useDocVersions, useFieldsVersion, useTreeVersion } from '../../store/documents'
import { applyCalc, calcLookupFiles, calcTemplate, computeCalc, parseCalcRules, siblingCalcPath, type CalcCell, type CalcResult, type LookupSource } from '../../lib/calc/calc'
import { cellAt, type TsvTable } from '../../lib/tsv/model'
import { canMoveRows, deleteColumns, deleteRows, duplicateRows, fillDown, fillRight, insertColumns, insertRows, moveColumns, moveRows, seedHeaderTable, seedTypedTable, setCell, setCells, type CellEdit, type CellRange } from '../../lib/tsv/edits'
import {
  actualRows, deleteRowSet, distinctValues, emptyView, filterOf, hasView, hideColumns, makeRowView, mapDelete, mapInsert, mapMove, remapColumns, rowsViewed,
  showAllColumns, viewOrder, visibleColumn, withFilter, withoutFilters, withoutSort, withSort, VIEW_BLOCKED, type ColumnMap, type ViewSpec,
} from '../../lib/tsv/view'
import { ColumnFilter } from './ColumnFilter'
import { findMatches, matchIndex, replaceAll, replaceInCell, stepMatch, type FindHit, type FindOptions } from '../../lib/tsv/find'
import { baseName, columnLetter, deriveSchema, isFieldFile, isNumericType, stabilizeSchema, type TableSchema } from '../../lib/tsv/schema'
import { parseFieldBlocks } from '../../lib/tsv/field'
import { PathBar, type PathTail } from '../PathBar'
import { DocStatus } from '../DocStatus'
import { usePaneCommands } from '../usePaneCommands'
import { anchorOf, registerSpotReader, type GridSpot, type SpotReader } from '../../lib/contextMenu'
import { summarizeRange, summaryParts, useSummaryKeys } from '../../lib/tsv/summary'
import { sanitizeFor } from '../../lib/tsv/table'
import { issueKey, validateTable } from '../../lib/tsv/validate'
import { Grid, type CellPos, type ColOp, type GridHandle, type RowOp } from './Grid'
import { ReadOnlyBanner } from '../ReadOnlyBanner'
import { PaneErrorBoundary } from '../PaneErrorBoundary'
import { inRootOf } from '../../lib/roots.mjs'
import { dismissNotice, notify, notifyError } from '../../lib/notices'

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
/** lookup 대상 표의 스키마 — 표 객체(와 Field 파일 목록)가 그대로면 다시 유도하지 않는다. 계산할 때마다(셀 확정마다) 부르는 곳이라 */
type FieldList = Parameters<typeof deriveSchema>[2]
const lookupSchemas = new WeakMap<TsvTable, { path: string; fields: FieldList; schema: TableSchema }>()
function lookupSchema(t: TsvTable, p: string, fields: FieldList): TableSchema {
  const hit = lookupSchemas.get(t)
  if (hit && hit.path === p && hit.fields === fields) return hit.schema
  const schema = deriveSchema(t, p, fields)
  lookupSchemas.set(t, { path: p, fields, schema })
  return schema
}
/** 지금 스토어에 있는 그 경로의 표 (다 읽힌 표 문서일 때만) */
function tableOf(path: string): TsvTable | null {
  const d = store.get(path)
  return d?.kind === 'tsv' && d.status === 'ready' ? d.table : null
}
/** Ctrl+F 때 활성 셀 값을 찾을 말로 미리 채우는 최대 길이 */
const PREFILL_MAX = 40

/** TSV 문서 창. 스토어의 표를 그리드로 보여 주고 편집·되돌리기·행/열 조작·저장을 잇는다. */
export function GridPane({ path, onSplit }: { path: string; onSplit: () => void }) {
  // 이 창이 읽는 것만 구독한다: 이 표, Field 파일들(스키마), 트리(계산식 파일이 있는지), 계산식 파일, lookup 대상 표들(아래)
  useDocVersion(path)
  useFieldsVersion()
  useTreeVersion()
  const grid = useRef<GridHandle>(null)
  const [active, setActive] = useState<CellPos>({ r: 0, c: 0 })
  /** 그리드의 선택 범위 — 상태 줄의 선택 요약 (DESIGN §32) */
  const [range, setRange] = useState<CellRange | null>(null)
  /** "되돌리기" 버튼이 달린 알림과 그때의 표 — 표가 다시 바뀌면(Ctrl+Z · 다른 편집) 버튼이 엉뚱한 것을 되돌리지 않게 알림을 내린다 */
  const undoNotice = useRef<{ id: number; after: TsvTable } | null>(null)
  /** 이 창이 마지막으로 고친 결과 (고쳐지지 않았으면 null) */
  const lastEdited = useRef<TsvTable | null>(null)

  useEffect(() => {
    store.retain(path)
    return () => store.release(path)
  }, [path])
  // 미리보기의 tsv-view 행이나 diff 항목에서 "이 행으로" 요청이 오면 활성 셀을 옮긴다 — 걸러 숨긴 행 · 숨긴 열이면 보기를 푼다.
  // 탭이 바뀌는 중이면 포커스가 날아가므로 한 프레임 뒤에 준다
  const revealRef = useRef<(pos: CellPos) => void>(() => {})
  useEffect(() => onSelectRequest(path, (pos) => { revealRef.current(pos); setActive(pos); window.setTimeout(() => grid.current?.focus(), 50) }), [path])

  /**
   * 방금 한 동작의 결과를 알림 줄에 (DESIGN §24.6). 이 표에서 온 알림은 하나만 남는다.
   * undo: 방금 한 편집을 되돌리는 버튼을 단다 — 묻지 않고 실행한 큰 조작(열 넣기 · 지우기 · 옮기기, 행 지우기)에 쓴다. 편집 직후에 불러야 한다
   */
  const showNotice = useCallback((msg: string, opts?: { undo?: boolean }) => {
    const key = `grid:${path}`
    undoNotice.current = null
    // 방금 이 창이 고친 표가 그대로일 때만 버튼을 단다 (읽기 전용이라 안 고쳐졌으면 앞의 편집을 되돌리게 된다)
    const after = opts?.undo && lastEdited.current && lastEdited.current === tableOf(path) ? lastEdited.current : null
    if (!after) { notify(msg, { key }); return }
    const id = notify(msg, {
      key,
      action: {
        label: '되돌리기',
        hint: 'Ctrl+Z',
        run: () => {
          undoNotice.current = null
          // 알림이 내려가기 전에 표가 또 바뀌었으면 되돌리지 않는다 (아래 effect 가 먼저 내리지만 한 번 더 본다)
          if (tableOf(path) === after) store.undo(path)
          window.setTimeout(() => grid.current?.focus(), 0)
        },
      },
    })
    undoNotice.current = { id, after }
  }, [path])
  const d = store.get(path)
  const doc = d?.kind === 'tsv' && d.status === 'ready' ? d : null
  const table = doc?.table ?? null
  useEffect(() => {
    const u = undoNotice.current
    if (u && table !== u.after) { undoNotice.current = null; dismissNotice(u.id) }
  }, [table])
  const fields = store.fieldFiles()
  // 셀을 확정할 때마다 스키마를 다시 유도하지만, 내용이 같은 열 객체는 이전 것을 쓴다 (Grid 의 Cell memo 가 col 참조로 비교한다)
  const prevSchema = useRef<{ path: string; schema: TableSchema } | null>(null)
  const schema = useMemo(() => {
    if (!table) return null
    const prev = prevSchema.current?.path === path ? prevSchema.current.schema : null
    const next = stabilizeSchema(prev, deriveSchema(table, path, fields))
    prevSchema.current = { path, schema: next }
    return next
  }, [table, path, fields])
  // 검증(Key 중복 등)은 보기와 상관없이 늘 파일 전체 — 걸러 숨긴 행도 본다 (DESIGN §61)
  const validation = useMemo(() => (table && schema ? validateTable(table, schema) : null), [table, schema])

  // ---- 보기: 정렬 · 값 필터 · 열 숨기기 (열 머리 메뉴, DESIGN §61). 파일은 그대로 두고 이 창의 그리드에만 — 문서에 남기지 않는다
  const [view, setView] = useState<ViewSpec>(() => emptyView(table?.width ?? 0))
  const viewOk = !!table && view.width === table.width
  /** 보일 행 순서. 정렬 · 필터를 고른 때 정하고, 셀을 고쳐도 그대로 둔다 — 행 수 · 머리글 행 수가 바뀌면 다시 */
  const frozen = useRef<{ view: ViewSpec; len: number; headerRows: number; order: number[] } | null>(null)
  const rowView = useMemo(() => {
    if (!table || !schema || !viewOk || !rowsViewed(view)) { frozen.current = null; return null }
    const h = schema.headerRows
    let f = frozen.current
    if (!f || f.view !== view || f.len !== table.rows.length || f.headerRows !== h) {
      f = { view, len: table.rows.length, headerRows: h, order: viewOrder(table, h, view) }
      frozen.current = f
    }
    return makeRowView(table, h, f.order)
  }, [table, schema, view, viewOk])
  const hiddenCols = useMemo<ReadonlySet<number>>(() => (viewOk && view.hidden.length ? new Set(view.hidden) : NO_KEYS), [view, viewOk])
  const filteredCols = useMemo<ReadonlySet<number>>(() => (viewOk && view.filters.length ? new Set(view.filters.map((f) => f.c)) : NO_KEYS), [view, viewOk])
  /** 보이는 행 ↔ 실제 행 */
  const toA = (vr: number) => (rowView ? rowView.toActual(vr) : vr)
  const toV = (r: number) => (rowView ? rowView.toView(r) : r)

  // ---- 계산식 (같은 폴더 X_Calc.tsv, DESIGN §17). 결과는 F9 로 값 열에 써 넣는다
  const calcPath = siblingCalcPath(path)
  useDocVersion(calcPath)
  const hasCalc = calcPath !== path && store.hasPath(calcPath)
  const calcTable = hasCalc ? store.auxTable(calcPath) : null
  const calcRules = useMemo(() => (calcTable ? parseCalcRules(calcTable) : null), [calcTable])
  const lookupFiles = useMemo(() => (calcRules ? calcLookupFiles(calcRules.rules) : []), [calcRules])
  // lookup 파일 이름은 이 표가 속한 루트(주 폴더 또는 가져온 폴더) 기준
  useEffect(() => { for (const f of lookupFiles) store.ensureAux(inRootOf(path, f)) }, [lookupFiles, path])
  // 대상 표가 읽히거나(보조 표 캐시) 열려서 고쳐지면 다시 그린다
  useDocVersions(lookupFiles.map((f) => inRootOf(path, f)))
  // lookup 표가 읽히거나 바뀌면 다시 계산되게 — 표 객체 번호로 의존성을 만든다
  const lookupKey = lookupFiles.map((f) => { const t = store.auxTable(inRootOf(path, f)); return t ? `${f}#${tableId(t)}` : `${f}#-` }).join('|')
  const lookupSource = useCallback((f: string): LookupSource | null => {
    const p = inRootOf(path, f)
    const t = store.auxTable(p)
    return t ? { table: t, schema: lookupSchema(t, p, fields) } : null
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
    const before = tableOf(path)
    store.editTable(path, (t) => {
      const r = applyCalc(t, computeCalc(t, schema, calcRules.rules, lookupSource))
      count = r.count
      return r.table
    })
    const after = tableOf(path)
    lastEdited.current = after && after !== before ? after : null
    showNotice(count ? `계산식 적용: ${count}개 셀 갱신` : '계산식 적용: 바뀐 셀 없음', { undo: count > 0 })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, schema, calcRules, lookupSource, hasCalc, calcPath])

  const createCalc = useCallback(async () => {
    // 예시 규칙에는 숫자 열이 자연스럽다. 없으면 Key·주석이 아닌 첫 열
    const cols = schema?.columns ?? []
    const example = (cols.find((c) => c.name && isNumericType(c.type)) ?? cols.find((c) => !c.isKey && c.type !== 'comment' && c.name))?.name ?? null
    try {
      await backend().write(calcPath, calcTemplate(example), null)
      window.setTimeout(() => openPath(calcPath), 400) // 트리가 갱신될 시간
    } catch (e) {
      notifyError(`만들지 못했습니다: ${(e as Error).message}`, { key: `grid:${path}` })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calcPath, schema])

  useEffect(() => onPaneAction(path, (a) => {
    if (a === 'focus') window.setTimeout(() => grid.current?.focus(), 0)
    if (a === 'calc') runCalc()
  }), [path, runCalc])

  // 표가 줄어들면 활성 셀을 안으로. 걸러 숨긴 행이면 첫 보이는 행으로, 숨긴 열이면 옆의 보이는 열로
  useEffect(() => {
    if (!table) return
    let r = Math.min(active.r, Math.max(0, table.rows.length - 1))
    let c = Math.min(active.c, Math.max(0, table.width - 1))
    if (rowView && rowView.toView(r) < 0) r = rowView.order[0] ?? Math.max(0, rowView.headerRows - 1)
    if (hiddenCols.has(c)) c = visibleColumn(c, 1, table.width, hiddenCols)
    if (r !== active.r || c !== active.c) setActive({ r, c })
  }, [table, active, rowView, hiddenCols])
  // 열 수가 바뀌면(바깥에서 바뀐 파일 · 열 조작의 되돌리기) 열 번호가 어긋나므로 보기를 푼다. 이 창의 열 조작은 보기를 함께 옮겨 여기 오지 않는다
  useEffect(() => {
    if (!table || view.width === table.width) return
    if (hasView(view)) notify('열 수가 바뀌어 정렬 · 필터 · 숨긴 열을 풀었습니다', { key: `grid:${path}` })
    setView(emptyView(table.width))
  }, [table, view, path])

  /** 표를 고친다. 실제로 바뀌었으면 true (읽기 전용이거나 바뀐 것이 없으면 false) */
  const edit = useCallback((fn: (t: TsvTable) => TsvTable): boolean => {
    lastEdited.current = null
    if (store.isReadOnly(path)) { showNotice('읽기 전용입니다 — 위의 안내 막대를 보세요'); return false }
    const before = tableOf(path)
    store.editTable(path, fn)
    const after = tableOf(path)
    if (!after || after === before) return false
    lastEdited.current = after
    return true
  }, [path, showNotice])
  const undo = useCallback(() => store.undo(path), [path])
  const redo = useCallback(() => store.redo(path), [path])
  const refocus = () => window.setTimeout(() => grid.current?.focus(), 0)

  /** 그리드의 선택 범위 — 보이는 행 번호 (정렬 · 필터 중이 아니면 실제와 같다) */
  const currentRange = (): CellRange => {
    const g = grid.current?.range()
    if (g) return g
    const r = Math.max(0, toV(active.r))
    return { r1: r, c1: active.c, r2: r, c2: active.c }
  }

  const rowOp = useCallback((kind: RowOp, g: CellRange) => {
    if (!table) return
    // 정렬 · 필터 중에는 행 넣기 · 복제 · 옮기기를 막는다 — 보이는 자리가 파일의 어디인지 정할 수 없다. 지우기는 보이는 행을 그대로 지운다 (DESIGN §61)
    if (rowView) {
      if (kind !== 'del') { showNotice(VIEW_BLOCKED); refocus(); return }
      const rows = actualRows(rowView, g.r1, g.r2)
      if (edit((t) => deleteRowSet(t, rows))) showNotice(`보이는 행 ${rows.length}개를 지웠습니다 (파일의 행 ${rows.map((r) => r + 1).slice(0, 6).join(', ')}${rows.length > 6 ? ' …' : ''})`, { undo: true })
      grid.current?.clearRange()
      refocus()
      return
    }
    const n = g.r2 - g.r1 + 1
    switch (kind) {
      case 'above': edit((t) => insertRows(t, g.r1, n)); break
      case 'below': edit((t) => insertRows(t, g.r2 + 1, n)); grid.current?.clearRange(); setActive({ r: g.r2 + 1, c: active.c }); break
      case 'append': edit((t) => insertRows(t, t.rows.length, 1)); grid.current?.clearRange(); setActive({ r: table.rows.length, c: active.c }); break
      // 복제본을 고른 채로 (마크다운의 줄 복제처럼). dupKeep 은 선택을 그대로 — 위쪽이 원본 자리
      case 'dup': if (edit((t) => duplicateRows(t, g.r1, n))) grid.current?.shiftRows(n); break
      case 'dupKeep': edit((t) => duplicateRows(t, g.r1, n)); break
      case 'moveUp':
      case 'moveDown': {
        // 한 칸 옮기고 선택이 따라간다. 머리글 · 타입 행, _Field 의 블록 경계는 넘지 않는다 (DESIGN §42)
        const dir = kind === 'moveUp' ? -1 : 1
        const r2 = Math.min(g.r2, table.rows.length - 1)
        const why = canMoveRows(table, g.r1, r2, dir, { headerRows: schema?.headerRows ?? 0, field: isFieldFile(path) })
        if (why !== null) { if (why) showNotice(why); break }
        if (edit((t) => moveRows(t, g.r1, r2, dir))) grid.current?.shiftRows(dir)
        break
      }
      case 'del': {
        // 모든 행을 지워도 묻지 않는다 — Ctrl+Z 로 돌아온다. 알림에 되돌리기 버튼을 단다 (DESIGN §24.6 N6)
        if (edit((t) => deleteRows(t, g.r1, n))) showNotice(n >= table.rows.length ? `모든 행(${n}개)을 지웠습니다` : `행 ${n}개를 지웠습니다`, { undo: true })
        grid.current?.clearRange()
        break
      }
    }
    refocus()
  }, [table, schema, path, edit, active.c, showNotice, rowView])

  /** 이 창의 열 조작 뒤 — 정렬 · 필터 · 숨긴 열이 같은 열을 따라간다 */
  const followColumns = useCallback((map: ColumnMap) => {
    const w = tableOf(path)?.width
    if (w !== undefined) setView((v) => remapColumns(v, map, w))
  }, [path])

  // 열을 넣고 · 지우고 · 옮기면 모든 행이 다시 조립된다. 예전에는 그때마다 확인 창으로 물었지만
  // Ctrl+Z 로 돌아오는 조작이라 묻지 않고 실행한 뒤, 같은 사실을 알림에 적고 되돌리기 버튼을 단다 (DESIGN §24.6 N6)
  const colOp = useCallback((kind: ColOp, g: CellRange): boolean => {
    if (!table) return false
    const n = g.c2 - g.c1 + 1
    const note = '모든 행이 다시 조립되어 git diff 에 전체 행이 나옵니다'
    let done = false
    switch (kind) {
      case 'left':
        done = edit((t) => insertColumns(t, g.c1, n))
        if (done) { followColumns(mapInsert(g.c1, n)); showNotice(`열 ${n}개를 넣었습니다 — ${note}`, { undo: true }) }
        break
      case 'right':
        done = edit((t) => insertColumns(t, g.c2 + 1, n))
        if (done) {
          followColumns(mapInsert(g.c2 + 1, n))
          showNotice(`열 ${n}개를 넣었습니다 — ${note}`, { undo: true })
          grid.current?.clearRange()
          setActive({ r: active.r, c: g.c2 + 1 })
        }
        break
      case 'del':
        if (n >= table.width) { showNotice('열을 전부 지울 수는 없습니다'); break }
        done = edit((t) => deleteColumns(t, g.c1, n))
        if (done) { followColumns(mapDelete(g.c1, n)); showNotice(`열 ${n}개를 지웠습니다 — ${note}`, { undo: true }) }
        grid.current?.clearRange()
        break
    }
    refocus()
    return done
  }, [table, edit, active.r, showNotice, followColumns])

  /** 열 글자를 끌어 옮기기 (Grid 에서). 열 삽입 · 삭제처럼 묻지 않고 옮긴 뒤 알림에 되돌리기를 단다. 옮겼으면 true */
  const moveCols = useCallback((from: number, count: number, to: number): boolean => {
    const width = tableOf(path)?.width ?? 0
    const moved = edit((t) => moveColumns(t, from, count, to))
    if (moved) followColumns(mapMove(width, from, count, to))
    if (moved) showNotice(`열 ${count}개를 옮겼습니다 — 모든 행이 다시 조립되어 git diff 에 전체 행이 나옵니다`, { undo: true })
    refocus()
    return moved
  }, [edit, showNotice, followColumns, path])

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
  // 찾을 말 입력 칸은 바로 반응하고, 표 전체를 훑는 찾기는 한 박자 뒤(입력이 이어지면 건너뛰고)에 돈다 — 2만 행 표에서 한 글자마다 수십 ms 가 걸렸다
  const deferredQuery = useDeferredValue(query)
  const hitsStale = deferredQuery !== query
  // 찾기는 보이는 셀만 — 보이는 순서로, 걸러 숨긴 행 · 숨긴 열은 빼고 (DESIGN §61). 결과의 행 번호는 보이는 행 번호다
  const findIn = useCallback((t: TsvTable, q: string): FindHit[] => {
    const vt = !rowView ? t : t === table ? rowView.table : makeRowView(t, rowView.headerRows, rowView.order).table
    const hs = findMatches(vt, q, findOpts)
    return hiddenCols.size ? hs.filter((h) => !hiddenCols.has(h.c)) : hs
  }, [rowView, table, findOpts, hiddenCols])
  const hits = useMemo(() => (findOpen && table ? findIn(table, deferredQuery) : NO_HITS), [findOpen, table, deferredQuery, findIn])
  /** 눌렀을 때의 결과 — 막 친 글자가 아직 반영 전이면 지금 말로 바로 찾는다 */
  const currentHits = (): FindHit[] => (!table ? NO_HITS : hitsStale ? findIn(table, query) : hits)
  const hitKeys = useMemo<ReadonlySet<number>>(
    () => (table && hits.length ? new Set(hits.map((h) => issueKey(table.width, rowView ? rowView.toActual(h.r) : h.r, h.c))) : NO_KEYS),
    [hits, table, rowView],
  )
  /** 활성 셀의 보이는 자리 (찾기 결과와 견준다) */
  const activeV = { r: toV(active.r), c: active.c }

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

  /** 찾기 결과(보이는 행 번호)로 */
  const goTo = (h: FindHit) => {
    grid.current?.clearRange()
    setActive({ r: toA(h.r), c: h.c })
  }

  /** 활성 셀 다음(1) / 이전(-1) 결과로. 끝에 닿으면 반대쪽 처음으로 돈다 */
  const findStep = useCallback((dir: 1 | -1) => {
    if (!table) return
    if (!query) { openFind(false); return }
    const list = findOpen && !hitsStale ? hits : findIn(table, query)
    if (!findOpen) setFindOpen(true)
    const i = stepMatch(list, { r: rowView ? rowView.toView(active.r) : active.r, c: active.c }, dir)
    if (i < 0) { showNotice(`찾지 못했습니다: ${query}`); return }
    grid.current?.clearRange()
    setActive({ r: rowView ? rowView.toActual(list[i].r) : list[i].r, c: list[i].c })
  }, [table, query, findOpen, hits, hitsStale, findIn, active, openFind, showNotice, rowView])

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
    if (matchIndex(currentHits(), activeV) >= 0) {
      after = setCell(table, r, c, replaceInCell(cellAt(table, r, c), query, rep, findOpts))
      edit((t) => setCell(t, r, c, replaceInCell(cellAt(t, r, c), query, rep, findOpts)))
    }
    const list = findIn(after, query)
    const i = stepMatch(list, activeV, 1)
    if (i >= 0) goTo(list[i])
    else if (after === table) showNotice(`찾지 못했습니다: ${query}`)
  }

  /** 걸린 셀을 전부 — onEdit 한 번이라 되돌리기도 한 번 */
  const replaceEvery = () => {
    if (!table || !query) return
    const rep = cleanReplacement()
    // 정렬 · 필터 · 숨긴 열이 있으면 보이는 셀만 바꾼다 (찾기와 같다)
    if (rowView || hiddenCols.size) {
      const edits: CellEdit[] = []
      for (const h of findIn(table, query)) {
        const r = toA(h.r)
        const v = cellAt(table, r, h.c)
        const next = replaceInCell(v, query, rep, findOpts)
        if (next !== v) edits.push({ r, c: h.c, v: next })
      }
      if (edits.length === 0) { showNotice('바꿀 셀이 없습니다'); return }
      if (edit((t) => setCells(t, edits))) showNotice(`보이는 셀 ${edits.length}개 바꿈 (숨긴 행 · 열은 그대로)`, { undo: true })
      return
    }
    const { count } = replaceAll(table, query, rep, findOpts)
    if (count === 0) { showNotice('바꿀 셀이 없습니다'); return }
    if (edit((t) => replaceAll(t, query, rep, findOpts).table)) showNotice(`${count}개 셀 바꿈`, { undo: true })
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

  const hitIdx = findOpen ? matchIndex(hits, activeV) : -1
  let findCount = ''
  if (query) findCount = hits.length ? `${hitIdx >= 0 ? hitIdx + 1 : '–'} / ${hits.length}` : hitsStale ? '…' : '결과 없음'

  const dirty = store.isDirty(path)
  const readOnly = store.isReadOnly(path)
  const canUndo = store.canUndo(path)
  const canRedo = store.canRedo(path)

  let schemaLabel = '스키마 없음 (타입 행 없음)'
  if (schema?.typed) schemaLabel = schema.defBlock ? `스키마: 타입 행 + ${baseName(schema.defBlock.file)}` : '스키마: 타입 행만'
  else if (schema?.headerRows) schemaLabel = 'CSV — 첫 줄을 머리글로'

  // 경로 막대의 마지막 단계 (DESIGN §31): 활성 셀의 열, `_Field` 시트는 활성 셀이 든 블록
  const fieldBlocks = useMemo(() => (table && isFieldFile(path) ? parseFieldBlocks(path, table).blocks : null), [table, path])
  /** pos(실제 행)가 걸러졌거나 숨긴 열이면 보기를 푼다 — 다른 곳에서 "이 셀로" 가 왔을 때 */
  revealRef.current = (pos: CellPos) => {
    const lostRow = !!rowView && pos.r >= rowView.headerRows && rowView.toView(pos.r) < 0
    const lostCol = hiddenCols.has(pos.c)
    if (!lostRow && !lostCol) return
    setView((v) => (lostRow ? withoutFilters(lostCol ? showAllColumns(v) : v) : showAllColumns(v)))
    showNotice(lostRow ? '그 행이 필터로 숨겨져 있어 필터를 풀었습니다' : '그 열이 숨겨져 있어 숨긴 열을 모두 보입니다')
  }
  const goCell = (pos: CellPos) => { revealRef.current(pos); setActive(pos); refocus() }
  let pathTail: PathTail | null = null
  if (table && schema && fieldBlocks) {
    // 블록 사이의 빈 줄은 위 블록에 붙여 본다
    let at = -1
    for (let i = 0; i < fieldBlocks.length && fieldBlocks[i].startRow <= active.r; i++) at = i
    pathTail = {
      name: '블록',
      label: at >= 0 ? fieldBlocks[at].name || '(이름 없는 블록)' : null,
      empty: '블록 밖',
      list: () => ({ current: at, items: fieldBlocks.map((b) => ({ label: b.name || '(이름 없는 블록)', run: () => goCell({ r: b.startRow, c: 0 }) })) }),
    }
  } else if (table && schema && table.width > 0) {
    const colLabel = (c: number) => { const name = schema.columns[c]?.name; return name ? `${columnLetter(c)} · ${name}` : columnLetter(c) }
    pathTail = {
      name: '열',
      label: colLabel(active.c),
      empty: '',
      list: () => ({ current: active.c, items: Array.from({ length: table.width }, (_, c) => ({ label: colLabel(c), run: () => goCell({ r: active.r, c }) })) }),
    }
  }

  // ---- 열 머리 메뉴 (DESIGN §61)
  const colName = (c: number) => { const name = schema?.columns[c]?.name; return name ? `${columnLetter(c)} · ${name}` : `${columnLetter(c)}열` }
  /** 값으로 거르기 창 — 열과 띄울 자리 */
  const [filterAt, setFilterAt] = useState<{ c: number; anchor: { x: number; y: number } } | null>(null)
  const openFilter = (c: number) => {
    const el = paneRoot.current?.querySelector(`[data-letter="${c}"]`) ?? paneRoot.current?.querySelector('.grid-input')
    const r = el?.getBoundingClientRect()
    setFilterAt({ c, anchor: r ? { x: r.left, y: r.bottom + 2 } : { x: 200, y: 120 } })
  }
  const applyFilter = (c: number, excluded: string[]) => {
    setFilterAt(null)
    setView((v) => withFilter(v, c, excluded))
    showNotice(excluded.length ? `${colName(c)} — 값 ${excluded.length}개를 감춰 봅니다 (파일은 그대로)` : `${colName(c)} 의 필터를 풀었습니다`)
    refocus()
  }
  const runView = (id: string) => {
    if (!table) return
    const g = currentRange()
    const c = active.c
    switch (id) {
      case 'gridSortAsc':
      case 'gridSortDesc': {
        const dir = id === 'gridSortAsc' ? 1 : -1
        setView((v) => withSort(v, c, dir))
        showNotice(`${colName(c)} ${dir > 0 ? '오름차순' : '내림차순'}으로 봅니다 — 파일의 행 순서는 그대로`)
        break
      }
      case 'gridSortClear':
        if (!view.sort) { showNotice('정렬하지 않았습니다'); break }
        setView(withoutSort)
        showNotice('정렬을 풀었습니다 — 파일 순서')
        break
      case 'gridFilter': openFilter(c); return
      case 'gridFilterClear':
        if (!view.filters.length) { showNotice('거르지 않았습니다'); break }
        setView(withoutFilters)
        showNotice('필터를 풀었습니다 — 모든 행')
        break
      case 'gridHideCols': {
        const next = hideColumns(viewOk ? view : emptyView(table.width), g.c1, g.c2)
        if (!next) { showNotice('모든 열을 숨길 수는 없습니다'); break }
        setView(next)
        const n = next.hidden.length - (viewOk ? view.hidden.length : 0)
        showNotice(`열 ${g.c1 === g.c2 ? columnLetter(g.c1) : `${columnLetter(g.c1)}:${columnLetter(g.c2)}`} 숨김${n > 0 ? '' : ' (이미 숨김)'} — 상태 줄의 "모두 보이기"로 되돌립니다`)
        break
      }
      case 'gridShowCols':
        if (!view.hidden.length) { showNotice('숨긴 열이 없습니다'); break }
        setView(showAllColumns)
        break
      case 'gridFitCols': grid.current?.fitColumns(g.c1, g.c2); break
    }
    refocus()
  }

  // 막대 단추와 팔레트 명령 (DESIGN §36) — 같은 처리. 팔레트 명령은 활성 탭의 창 하나에만 온다
  const paneRoot = useRef<HTMLDivElement>(null)
  const runPane = (id: string) => {
    if (!table) return
    switch (id) {
      case 'gridSortAsc': case 'gridSortDesc': case 'gridSortClear': case 'gridFilter': case 'gridFilterClear':
      case 'gridHideCols': case 'gridShowCols': case 'gridFitCols':
        runView(id); break
      case 'gridUndo': undo(); refocus(); break
      case 'gridRedo': redo(); refocus(); break
      case 'gridRowAbove': rowOp('above', currentRange()); break
      case 'gridRowBelow': rowOp('below', currentRange()); break
      case 'gridRowAppend': rowOp('append', currentRange()); break
      case 'gridRowDup': rowOp('dup', currentRange()); break
      case 'gridRowUp': rowOp('moveUp', currentRange()); break
      case 'gridRowDown': rowOp('moveDown', currentRange()); break
      case 'gridRowDel': rowOp('del', currentRange()); break
      case 'gridColLeft': colOp('left', currentRange()); break
      case 'gridColRight': colOp('right', currentRange()); break
      case 'gridColDel': colOp('del', currentRange()); break
      // 채우기는 정렬 · 필터 중에 막는다 (DESIGN §61). 그 밖에는 그리드의 Ctrl+D / Ctrl+R 과 같다
      case 'gridFillDown': { if (rowView) { showNotice(VIEW_BLOCKED); refocus(); break } const g = currentRange(); edit((t) => fillDown(t, g)); refocus(); break }
      case 'gridFillRight': { if (rowView) { showNotice(VIEW_BLOCKED); refocus(); break } const g = currentRange(); edit((t) => fillRight(t, g)); refocus(); break }
      case 'gridFind': openFind(false); break
      case 'gridReplace': openFind(true); break
      case 'gridCalcFile': if (hasCalc) openPath(calcPath); else void createCalc(); break
      case 'gridSeedHeader':
        if (table.rows.length > 0) { showNotice('빈 표에서만 만든다 — 이미 행이 있습니다'); break }
        edit(table.format === 'csv' ? (t) => seedHeaderTable(t) : seedTypedTable); refocus(); break
      case 'gridTrailingNewline': edit((t) => ({ ...t, trailingNewline: true })); refocus(); break
    }
  }
  usePaneCommands(paneRoot, runPane)

  // 맥락 메뉴의 자리 (DESIGN §40) — 고른 범위 · 편집 중인가. 메뉴는 활성 셀(입력 칸) 아래에 뜬다
  const spotRef = useRef<SpotReader>(() => null)
  spotRef.current = (): GridSpot | null => {
    if (!table) return null
    const g = currentRange()
    const shownRows = rowView ? rowView.table.rows.length : table.rows.length
    const wholeCols = shownRows > 0 && g.r1 === 0 && g.r2 === shownRows - 1
    // 셀 주소는 파일의 행 번호로 (정렬 · 필터 중이면 보이는 행 → 실제 행)
    const at = (r: number, c: number) => `${columnLetter(c)}${toA(r) + 1}`
    let where = g.r1 === g.r2 && g.c1 === g.c2 ? at(g.r1, g.c1) : `${at(g.r1, g.c1)}:${at(g.r2, g.c2)}`
    if (wholeCols) where = g.c1 === g.c2 ? `${columnLetter(g.c1)}열` : `${columnLetter(g.c1)}:${columnLetter(g.c2)}열`
    const input = paneRoot.current?.querySelector<HTMLElement>('.grid-input')
    return {
      zone: 'grid',
      title: `${baseName(path)} · ${where}`,
      anchor: anchorOf(input),
      editing: !!input?.classList.contains('is-editing'),
      readOnly: store.isReadOnly(path),
      empty: table.rows.length === 0,
      wholeCols,
      sorted: viewOk && !!view.sort,
      filtered: viewOk && view.filters.length > 0,
      hiddenCols: viewOk && view.hidden.length > 0,
    }
  }
  const hasTable = !!table
  useEffect(() => {
    const el = paneRoot.current
    return el ? registerSpotReader(el, (t, pt) => spotRef.current(t, pt)) : undefined
  }, [hasTable])

  // 문서 상태 줄 (DESIGN §32): 활성 셀의 이름 · 열 · 타입 · 검증 오류 · Field 설명, 여러 칸을 고르면 선택 요약
  const summaryKeys = useSummaryKeys()
  const summary = useMemo(() => {
    if (!table || !schema || !range || (range.r1 === range.r2 && range.c1 === range.c2)) return null
    return summaryParts(summarizeRange(rowView ? rowView.table : table, schema, range), summaryKeys)
  }, [table, schema, range, summaryKeys, rowView])
  let statusCell: ReactNode = null
  let statusExtra: ReactNode = null
  if (table && schema && validation) {
    const col = schema.columns[active.c]
    const issue = validation.issues.get(issueKey(table.width, active.r, active.c))
    const typeLabel = !schema.typed || !col ? null : col.type === 'comment' ? '주석 열' : `${col.rawType.replace(/^#/, '') || col.type}${col.list ? ' (리스트)' : ''}`
    statusCell = (
      <>
        <span className="ds-ref" title="활성 셀 (열 글자 + 행 번호)">{columnLetter(active.c)}{active.r + 1}</span>
        {col?.name && <span className="ds-name">{col.name}</span>}
        {typeLabel && <span title="타입 행의 타입">{typeLabel}</span>}
        {issue && <span className="is-err">⚠ {issue}</span>}
        {col?.description && <span title={col.description}>{col.description}</span>}
      </>
    )
    statusExtra = (
      <>
        <span className="ds-item ds-opt">{table.rows.length}행 × {table.width}열</span>
        {/* 보기 상태와 푸는 단추 (DESIGN §61) — 정렬 · 필터 · 숨긴 열 */}
        {viewOk && hasView(view) && (
          <span className="ds-item ds-view" title="보기만 바뀐 상태 — 파일의 행 순서 · 내용은 그대로">
            {[
              view.sort ? `정렬 ${colName(view.sort.c)} ${view.sort.dir > 0 ? '↑' : '↓'}` : '',
              view.filters.length ? `필터 ${view.filters.map((f) => columnLetter(f.c)).join(' · ')}` : '',
              rowView ? `보이는 행 ${rowView.order.length} / ${Math.max(0, table.rows.length - rowView.headerRows)}` : '',
              view.hidden.length ? `숨긴 열 ${view.hidden.map(columnLetter).join(' · ')}` : '',
            ].filter(Boolean).join(' · ')}
          </span>
        )}
        {viewOk && view.sort && <button className="ds-btn" data-command="gridSortClear" title={cmdTitle('gridSortClear')} onClick={() => runPane('gridSortClear')}>정렬 해제</button>}
        {viewOk && view.filters.length > 0 && <button className="ds-btn" data-command="gridFilterClear" title={cmdTitle('gridFilterClear')} onClick={() => runPane('gridFilterClear')}>필터 해제</button>}
        {viewOk && view.hidden.length > 0 && <button className="ds-btn" data-command="gridShowCols" title={cmdTitle('gridShowCols')} onClick={() => runPane('gridShowCols')}>모두 보이기</button>}
        <span className={'ds-item' + (validation.count ? ' is-err' : ' ds-opt')}>{validation.count ? `오류 ${validation.count}` : '오류 없음'}</span>
        <span className="ds-item ds-opt">{schemaLabel}</span>
        {hasCalc && calcRules && <span className="ds-item ds-opt" title={calcPath}>계산식 {calcRules.rules.length}개{calcResult?.staleCount ? ` · 바뀔 셀 ${calcResult.staleCount}` : ''}</span>}
        {!table.trailingNewline && (
          <button className="ds-btn" data-command="gridTrailingNewline" title={cmdTitle('gridTrailingNewline')} onClick={() => runPane('gridTrailingNewline')}>
            끝 개행 추가
          </button>
        )}
      </>
    )
  }

  return (
    <div className="pane" ref={paneRoot}>
      <div className="pane-bar">
        <PathBar path={path} tail={pathTail} onExit={() => grid.current?.focus()} />
        <button data-command="save" onClick={() => void store.save(path)} disabled={!dirty || !!doc?.conflict || !!doc?.saving} title={tip('저장', 'save')}>저장</button>
        <button data-command="split" onClick={onSplit} title={tip('이 문서를 오른쪽 창에도 연다', 'split')}>오른쪽에 분할</button>
      </div>
      {doc?.conflict && (
        <div className="banner">
          디스크의 파일이 바뀌었습니다. 어느 쪽을 쓸까요?
          <button data-command="conflictTakeDisk" onClick={() => store.takeDisk(path)}>디스크 내용 받기 (내 수정 버림)</button>
          <button data-command="conflictOverwrite" onClick={() => void store.overwrite(path)}>내 내용으로 덮어쓰기</button>
        </div>
      )}
      {readOnly && <ReadOnlyBanner path={path} />}
      {d?.status === 'error' && <div className="banner is-error">{d.error}</div>}
      {doc?.error && !doc.conflict && <div className="banner is-error">{doc.error}</div>}
      {doc?.warnings.map((w) => <div key={w} className="banner">{w}</div>)}
      {d?.status === 'loading' && <div className="pane-empty">불러오는 중…</div>}
      {table && schema && validation && (
        <>
          {/* 명령 막대 — 단추마다 data-command (lib/paneCommands.ts, paneCommands.test) */}
          <div className="grid-toolbar">
            <button data-command="gridUndo" onClick={() => runPane('gridUndo')} disabled={!canUndo} title={cmdTitle('gridUndo')}>↶</button>
            <button data-command="gridRedo" onClick={() => runPane('gridRedo')} disabled={!canRedo} title={cmdTitle('gridRedo')}>↷</button>
            <span className="sep" />
            <span className="grid-toolbar-label">행</span>
            <button data-command="gridRowAbove" onClick={() => runPane('gridRowAbove')} disabled={!table.rows.length} title={cmdTitle('gridRowAbove')}>＋위</button>
            <button data-command="gridRowBelow" onClick={() => runPane('gridRowBelow')} disabled={!table.rows.length} title={cmdTitle('gridRowBelow')}>＋아래</button>
            <button data-command="gridRowAppend" onClick={() => runPane('gridRowAppend')} title={cmdTitle('gridRowAppend')}>＋끝</button>
            <button data-command="gridRowDup" onClick={() => runPane('gridRowDup')} disabled={!table.rows.length} title={cmdTitle('gridRowDup')}>복제</button>
            <button data-command="gridRowUp" onClick={() => runPane('gridRowUp')} disabled={!table.rows.length} title={cmdTitle('gridRowUp')} aria-label="행 위로">↑</button>
            <button data-command="gridRowDown" onClick={() => runPane('gridRowDown')} disabled={!table.rows.length} title={cmdTitle('gridRowDown')} aria-label="행 아래로">↓</button>
            <button data-command="gridRowDel" onClick={() => runPane('gridRowDel')} disabled={!table.rows.length} title={cmdTitle('gridRowDel')}>삭제</button>
            <span className="sep" />
            <span className="grid-toolbar-label">열</span>
            <button data-command="gridColLeft" onClick={() => runPane('gridColLeft')} title={cmdTitle('gridColLeft')}>＋왼쪽</button>
            <button data-command="gridColRight" onClick={() => runPane('gridColRight')} title={cmdTitle('gridColRight')}>＋오른쪽</button>
            <button data-command="gridColDel" onClick={() => runPane('gridColDel')} disabled={table.width <= 1} title={cmdTitle('gridColDel')}>삭제</button>
            <span className="sep" />
            <button data-command="gridFind" onClick={() => runPane('gridFind')} title={`${cmdTitle('gridFind')} · ${cmdTitle('gridReplace')}`}>찾기</button>
            {schema.typed && calcPath !== path && (
              <>
                <span className="sep" />
                {hasCalc ? (
                  <>
                    <button
                      data-command="calc"
                      onClick={() => { runCalc(); refocus() }}
                      disabled={!calcResult || (calcResult.staleCount === 0 && calcErrors.length === 0)}
                      title={tip(`${baseName(calcPath)} 의 식을 평가해 값 열에 써 넣는다. 노란 밑줄 셀이 바뀐다`, 'calc')}
                    >
                      계산{calcResult?.staleCount ? ` (${calcResult.staleCount})` : ''}
                    </button>
                    <button data-command="gridCalcFile" onClick={() => runPane('gridCalcFile')} title={tip(`${baseName(calcPath)} 열기`, 'gridCalcFile')}>계산식</button>
                  </>
                ) : (
                  <button data-command="gridCalcFile" onClick={() => runPane('gridCalcFile')} title={tip(`${baseName(calcPath)} 를 만들어 연다 — 열 값을 식으로 채우는 규칙을 적는 곳`, 'gridCalcFile')}>계산식 만들기</button>
                )}
              </>
            )}
            {table.rows.length === 0 && (
              <>
                <span className="sep" />
                <button data-command="gridSeedHeader" onClick={() => runPane('gridSeedHeader')} title={cmdTitle('gridSeedHeader')}>{table.format === 'csv' ? '머리글 행 만들기' : '타입 행·헤더 행 만들기'}</button>
              </>
            )}
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
              <span className={'grid-find-count' + (query && !hits.length && !hitsStale ? ' is-none' : '')}>{findCount}</span>
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
              onRangeChange={setRange}
              rowView={rowView}
              hiddenCols={hiddenCols}
              sort={viewOk ? view.sort : null}
              filteredCols={filteredCols}
            />
          </PaneErrorBoundary>
          {filterAt && filterAt.c < table.width && (
            <ColumnFilter
              key={filterAt.c}
              title={colName(filterAt.c)}
              values={distinctValues(table, schema.headerRows, filterAt.c)}
              excluded={(viewOk && filterOf(view, filterAt.c)?.excluded) || []}
              anchor={filterAt.anchor}
              onApply={(ex) => applyFilter(filterAt.c, ex)}
              onClose={() => { setFilterAt(null); refocus() }}
            />
          )}
        </>
      )}
      <DocStatus path={path} cell={statusCell} summary={summary} extra={statusExtra} />
    </div>
  )
}
