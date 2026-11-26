import { isValidElement, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentProps, type ReactNode } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { store, useDocVersion, useFieldsVersion } from '../store/documents'
import { backend } from '../lib/backend'
import { openPath } from '../lib/nav'
import { useTheme } from '../lib/theme'
import { applyTsvView, parseTsvViewSpec, resolveViewPath, rowRecord, type TsvViewResult } from '../lib/md/tsvView'
import { compileTemplate } from '../lib/md/template'
import { stripBaked, stripBakedWithLines } from '../lib/md/bake'
import { LINE_ATTR, rehypeSourceLines } from '../lib/md/sourceLines'
import { columnLetter, deriveSchema, isNumericType, type TableSchema } from '../lib/tsv/schema'
import { issueKey, validateTable } from '../lib/tsv/validate'
import { setCell } from '../lib/tsv/edits'
import { sanitizeFor, tableFormatOf } from '../lib/tsv/table'
import type { TsvTable } from '../lib/tsv/model'
import { isDocName } from '../lib/filetypes.mjs'
import { codeLangOf } from '../lib/code/langs'
import { minCellWidth } from '../lib/cellWidth'
import { CodeBlock } from './CodeBlock'
import { EditorView } from '@codemirror/view'
import { FIT, ZOOM_STEP, diagramKey, isFit, loadDiagramView, panBy, panKey, saveDiagramView, zoomAt, zoomKey, type DiagramView } from '../lib/md/diagramZoom'

/**
 * 마크다운 미리보기 (DESIGN D2 v1). 스토어의 텍스트를 react-markdown 으로 그린다.
 * ```mermaid 는 동적으로 불러온 mermaid 로, ```tsv-view 는 스토어의 TsvDoc 을 표로 (DESIGN §7).
 * 하이브리드 모드(components/hybrid.ts)도 같은 Mermaid · TsvView 컴포넌트를 쓴다.
 */

/** 미리보기 · 하이브리드 표가 같이 쓴다. 렌더마다 새 배열을 만들지 않게 모듈 상수 */
export const REMARK_PLUGINS = [remarkGfm]

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), ms)
    return () => window.clearTimeout(t)
  }, [value, ms])
  return v
}

// ---------------------------------------------------------------- mermaid
type MermaidApi = typeof import('mermaid').default
let mermaidLoading: Promise<MermaidApi> | null = null
function loadMermaid(): Promise<MermaidApi> {
  if (!mermaidLoading) mermaidLoading = import('mermaid').then((m) => m.default)
  return mermaidLoading
}
let mermaidSeq = 0

/**
 * 그린 SVG 캐시 (테마 + 코드 → svg). 하이브리드에서 커서가 펜스를 스칠 때마다 위젯이 새로 만들어지는데,
 * 그때 처음부터 다시 그리지 않고 바로 보여 준다. 오래 안 쓴 것부터 버린다 (Map 순서 = 쓴 순서).
 */
const MERMAID_CACHE_MAX = 40
const mermaidCache = new Map<string, { id: string; svg: string }>()
function cachedMermaid(key: string): string | null {
  const hit = mermaidCache.get(key)
  if (!hit) return null
  mermaidCache.delete(key)
  mermaidCache.set(key, hit)
  // SVG 안의 id(스타일 · 화살표 marker 가 가리킨다)를 새로 매긴다 — 같은 그림이 두 곳(미리보기 · 하이브리드)에 떠도 id 가 겹치지 않게
  const id = `jd-mmd-${++mermaidSeq}`
  return hit.svg.replace(new RegExp(`${hit.id}(?!\\d)`, 'g'), id)
}
function rememberMermaid(key: string, id: string, svg: string) {
  mermaidCache.delete(key)
  mermaidCache.set(key, { id, svg })
  while (mermaidCache.size > MERMAID_CACHE_MAX) mermaidCache.delete(mermaidCache.keys().next().value!)
}

/** docPath: 이 다이어그램이 든 문서 — 확대 상태를 그 문서 · 글로 기억한다 (DESIGN §39 MZ8). 없으면 기억하지 않는다 */
export function Mermaid({ code, docPath }: { code: string; docPath?: string }) {
  const theme = useTheme()
  const key = `${theme}\n${code}`
  const [state, setState] = useState<{ svg: string } | { error: string } | null>(() => {
    const svg = cachedMermaid(key)
    return svg ? { svg } : null
  })
  const shown = useRef(state && 'svg' in state ? key : null)
  useEffect(() => {
    // 처음 그릴 때 캐시에서 이미 보여 줬으면 끝
    if (shown.current === key) return
    const svg = cachedMermaid(key)
    if (svg) { shown.current = key; setState({ svg }); return }
    let alive = true
    setState(null)
    loadMermaid()
      .then(async (m) => {
        try {
          // 테마가 바뀌면 다시 그린다 (initialize 는 다음 render 부터 적용된다)
          m.initialize({ startOnLoad: false, securityLevel: 'strict', theme: theme === 'dark' ? 'dark' : 'neutral', fontFamily: 'inherit' })
          const ok = await m.parse(code, { suppressErrors: true })
          if (!ok) throw new Error('Mermaid 문법 오류')
          const id = `jd-mmd-${++mermaidSeq}`
          const { svg } = await m.render(id, code)
          rememberMermaid(key, id, svg)
          if (alive) { shown.current = key; setState({ svg }) }
        } catch (e) {
          if (alive) setState({ error: (e as Error).message })
        }
      })
      .catch((e) => { if (alive) setState({ error: `mermaid 를 불러오지 못했습니다: ${(e as Error).message}` }) })
    return () => { alive = false }
  }, [key, code, theme])
  if (!state) return <div className="mermaid-box is-loading">다이어그램 그리는 중…</div>
  if ('error' in state) {
    return (
      <div className="mermaid-box is-error">
        <div>{state.error}</div>
        <pre>{code}</pre>
      </div>
    )
  }
  return <MermaidView svg={state.svg} saveKey={docPath ? diagramKey(docPath, code) : null} />
}

/**
 * 그린 다이어그램 — 확대 · 축소 · 끌어 옮기기 · 맞춤 (ADOPT A9 · DESIGN §39). 계산은 `lib/md/diagramZoom.ts`.
 *
 * - 상자는 `Tab` · 클릭으로 포커스를 받는다. 포커스가 있을 때: `Ctrl+=` · `Ctrl+-` 확대 · 축소(상자 가운데 기준), 방향키 옮기기
 *   (Shift 면 크게), `Home` 맞춤, `Esc` 편집기 · 미리보기로. `Ctrl+휠` 은 포커스가 있을 때만 가로챈다(포인터 자리 기준) —
 *   아니면 브라우저의 페이지 확대 그대로.
 * - 확대한 동안은 끌어서 옮긴다. 맞춤 상태에서는 끌지 않는다(다 보인다).
 * - 상자 높이는 맞춤일 때의 높이 그대로 — 확대하면 그 틀 안에서 본다(문서가 아래로 밀리지 않게).
 * - 오른쪽 위의 `− 100% ＋` 는 마우스용. 포커스를 받지 않는다. 썸네일 · 훑어보기 패널(inert)에서는 숨는다.
 * - 하이브리드 위젯 안에서도 같다(위젯은 편집기가 이벤트를 무시한다 — `BlockWidget.ignoreEvent`).
 */
function MermaidView({ svg, saveKey }: { svg: string; saveKey: string | null }) {
  const [v, setV] = useState<DiagramView>(FIT)
  const [dragging, setDragging] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const drag = useRef<{ id: number; x: number; y: number } | null>(null)
  const fit = isFit(v)
  /** 이 상자의 확대를 기억하는가 — 열쇠가 있고, 읽기만 하는 곳(썸네일 · 훑어보기, inert)이 아닐 때 */
  const persist = useRef(false)
  // 그림 · 열쇠가 바뀌면 기억한 상태로(없으면 맞춤). 글을 고치면 열쇠가 달라져 맞춤이 된다.
  // 상자 크기는 맞춤일 때의 크기 그대로다(transform 은 배치에 들지 않는다) — 비율로 남긴 자리를 이 크기로 되살린다
  useLayoutEffect(() => {
    const el = box.current
    persist.current = !!saveKey && !!el && !el.closest('[inert]')
    setV(persist.current && el && saveKey ? loadDiagramView(saveKey, el.clientWidth, el.clientHeight) : FIT)
  }, [svg, saveKey])
  // 바뀐 상태를 남긴다 — 끌거나 키를 누르는 동안 매번 쓰지 않고 멈춘 뒤에
  useEffect(() => {
    const el = box.current
    if (!persist.current || !saveKey || !el) return
    const t = window.setTimeout(() => saveDiagramView(saveKey, v, el.clientWidth, el.clientHeight), 300)
    return () => window.clearTimeout(t)
  }, [v, saveKey])

  const zoomCenter = (dir: 1 | -1) => {
    const el = box.current
    if (!el) return
    setV((cur) => zoomAt(cur, dir > 0 ? ZOOM_STEP : 1 / ZOOM_STEP, el.clientWidth / 2, el.clientHeight / 2))
  }

  // Ctrl+휠 — 포커스가 있을 때만. passive 가 아니어야 페이지 확대를 막을 수 있다
  useEffect(() => {
    const el = box.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey) || !el.contains(document.activeElement)) return
      e.preventDefault()
      const r = el.getBoundingClientRect()
      setV((cur) => zoomAt(cur, e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP, e.clientX - r.left, e.clientY - r.top))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  /** Esc — 이 다이어그램을 품은 편집기(하이브리드) 또는 미리보기로 */
  const leave = () => {
    const el = box.current
    const editor = el?.closest<HTMLElement>('.cm-editor')
    if (editor) { EditorView.findFromDOM(editor)?.focus(); return }
    el?.parentElement?.closest<HTMLElement>('.preview, [tabindex]')?.focus()
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.nativeEvent.isComposing) return
    const z = zoomKey(e)
    if (z) { e.preventDefault(); e.stopPropagation(); zoomCenter(z); return }
    if (e.ctrlKey || e.metaKey || e.altKey) return
    const pan = panKey(e.key, e.shiftKey)
    if (pan) { e.preventDefault(); e.stopPropagation(); setV((cur) => panBy(cur, pan[0], pan[1])); return }
    if (e.key === 'Home') { e.preventDefault(); e.stopPropagation(); setV(FIT); return }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); leave() }
  }

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || fit || (e.target as Element).closest('.mermaid-tools')) return
    e.preventDefault()
    box.current?.focus({ preventScroll: true })
    box.current?.setPointerCapture(e.pointerId)
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY }
    setDragging(true)
  }
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d || d.id !== e.pointerId) return
    const dx = e.clientX - d.x
    const dy = e.clientY - d.y
    drag.current = { id: d.id, x: e.clientX, y: e.clientY }
    setV((cur) => panBy(cur, dx, dy))
  }
  const endDrag = (e: React.PointerEvent) => {
    if (drag.current?.id !== e.pointerId) return
    drag.current = null
    setDragging(false)
  }

  return (
    <div
      ref={box}
      className={'mermaid-box is-zoomable' + (fit ? '' : ' is-zoomed') + (dragging ? ' is-dragging' : '')}
      tabIndex={0}
      role="img"
      aria-label="다이어그램 — Ctrl+= · Ctrl+- 확대 · 축소, 방향키로 옮기기, Home 맞춤, Esc 나가기"
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      <div className="mermaid-tools" onMouseDown={(e) => e.preventDefault()}>
        <button type="button" tabIndex={-1} onClick={() => zoomCenter(-1)} title="축소 (Ctrl+-)" aria-label="축소">−</button>
        <button type="button" tabIndex={-1} onClick={() => setV(FIT)} title="맞춤 (Home)">{Math.round(v.s * 100)}%</button>
        <button type="button" tabIndex={-1} onClick={() => zoomCenter(1)} title="확대 (Ctrl+=)" aria-label="확대">＋</button>
      </div>
      <div className="mermaid-stage" style={fit ? undefined : { transform: `translate(${v.x}px, ${v.y}px) scale(${v.s})` }} dangerouslySetInnerHTML={{ __html: svg }} />
    </div>
  )
}

// ---------------------------------------------------------------- tsv-view
interface Sel {
  /** 표 안의 행 번호 */
  r: number
  /** 결과 열 번호 (result.columns 기준) */
  ci: number
}
interface Box {
  left: number
  top: number
  width: number
  height: number
}

/** 템플릿으로 mermaid 텍스트 생성 */
function useGeneratedMermaid(template: string | null, result: TsvViewResult | null, table: TsvTable | null, schema: TableSchema | null, file: string | null) {
  return useMemo<{ code: string } | { error: string } | null>(() => {
    if (!template || !result || !table || !schema) return null
    try {
      const tpl = compileTemplate(template)
      const rows = result.rows.map((row) => rowRecord(table.rows[row.index].cells, schema))
      return { code: tpl({ rows, file: file ?? '', count: rows.length }) }
    } catch (e) {
      return { error: (e as Error).message }
    }
  }, [template, result, table, schema, file])
}

export function TsvView({ body, mdPath }: { body: string; mdPath: string }) {
  const spec = useMemo(() => parseTsvViewSpec(body), [body])
  const file = spec.file ? resolveViewPath(spec.file, mdPath) : null
  // 이 보기가 읽는 것은 표 파일 하나와 Field 파일들(스키마)뿐이다 — md 본문이나 다른 문서가 바뀌어도 다시 그리지 않는다
  useDocVersion(file)
  useFieldsVersion()
  /** 사라지기 직전에 입력 중이던 칸을 써 넣는다 (아래에서 채운다) */
  const flushRef = useRef<(() => void) | null>(null)
  useEffect(() => {
    if (!file) return
    store.retain(file)
    // 이 보기는 확인 없이 사라진다 (md 탭 닫기 · 소스 모드 · 하이브리드 커서) → 저장 안 한 표는 스토어에 남긴다
    return () => {
      flushRef.current?.()
      store.release(file, { keepDirty: true })
    }
  }, [file])
  const d = file ? store.get(file) : undefined
  const fields = store.fieldFiles()
  const table = d?.kind === 'tsv' && d.status === 'ready' ? d.table : null
  const schema = useMemo(() => (table && file ? deriveSchema(table, file, fields) : null), [table, file, fields])
  const result = useMemo(() => (table && schema ? applyTsvView(spec, table, schema) : null), [spec, table, schema])
  const validation = useMemo(() => (table && schema ? validateTable(table, schema) : null), [table, schema])
  const generated = useGeneratedMermaid(spec.render === 'mermaid' ? spec.template : null, result, table, schema, file)
  const [showGen, setShowGen] = useState(false)

  // ---- 그 자리 편집 (DESIGN §7.1 v2). 입력은 그리드처럼 숨은 textarea 하나가 받는다 (한글 조합 보존)
  const wrap = useRef<HTMLDivElement>(null)
  const ta = useRef<HTMLTextAreaElement>(null)
  const [sel, setSel] = useState<Sel | null>(null)
  const [editing, setEditing] = useState(false)
  const [box, setBox] = useState<Box | null>(null)
  /**
   * 고치는 중인 글. 그 칸 안에 보이지 않게 같은 글을 넣어 행 높이가 글만큼 늘어나게 한다 — 입력 칸은 그 칸 크기를 따라간다.
   * textarea 는 계속 비제어(uncontrolled)라 이 값을 넣어도 한글 조합은 건드리지 않는다
   */
  const [draft, setDraft] = useState<string | null>(null)

  const colIndexOf = useCallback((ci: number) => result?.columns[ci]?.index ?? 0, [result])
  const cellValue = useCallback((s: Sel) => table?.rows[s.r]?.cells[colIndexOf(s.ci)] ?? '', [table, colIndexOf])

  const locate = useCallback((s: Sel): Box | null => {
    const w = wrap.current
    const td = w?.querySelector<HTMLElement>(`td[data-r="${s.r}"][data-ci="${s.ci}"]`)
    if (!w || !td) return null
    const a = td.getBoundingClientRect()
    const b = w.getBoundingClientRect()
    return { left: a.left - b.left, top: a.top - b.top, width: a.width, height: a.height }
  }, [])
  useLayoutEffect(() => { setBox(sel ? locate(sel) : null) }, [sel, result, locate, draft])

  const select = useCallback((s: Sel) => {
    setSel(s)
    ta.current?.focus({ preventScroll: true })
  }, [])

  const startEdit = useCallback((mode: 'edit' | 'replace', s: Sel | null = sel) => {
    const el = ta.current
    if (!el || !s) return
    if (mode === 'edit') {
      const v = cellValue(s)
      el.value = v
      el.setSelectionRange(v.length, v.length)
    }
    setSel(s)
    setEditing(true)
    setDraft(el.value)
    el.focus({ preventScroll: true })
  }, [sel, cellValue])

  /** 결과 행 순서대로 위/아래, 결과 열 순서대로 좌/우 */
  const moveSel = useCallback((dir: 'up' | 'down' | 'left' | 'right') => {
    if (!sel || !result) return
    const order = result.rows.map((x) => x.index)
    const i = order.indexOf(sel.r)
    let { r, ci } = sel
    if (dir === 'up' && i > 0) r = order[i - 1]
    if (dir === 'down' && i >= 0 && i < order.length - 1) r = order[i + 1]
    if (dir === 'left') ci = Math.max(0, ci - 1)
    if (dir === 'right') ci = Math.min(result.columns.length - 1, ci + 1)
    setSel({ r, ci })
  }, [sel, result])

  const commit = useCallback((move: 'up' | 'down' | 'left' | 'right' | null) => {
    const el = ta.current
    if (!el || !sel || !file || !editing) return
    const [clean] = sanitizeFor(tableFormatOf(file), el.value)
    const r = sel.r
    const c = colIndexOf(sel.ci)
    store.editTable(file, (t) => setCell(t, r, c, clean))
    el.value = ''
    liveEdit.current = false
    setEditing(false)
    setDraft(null)
    if (move) moveSel(move)
  }, [sel, file, editing, colIndexOf, moveSel])

  // 사라질 때(언마운트) 입력 중이던 칸. ref 는 정리 함수보다 먼저 null 이 되므로 요소를 여기서 잡아 둔다
  const liveEdit = useRef(false)
  liveEdit.current = editing
  {
    const el = ta.current
    const s = sel
    flushRef.current = editing && el && s && file ? () => {
      if (!liveEdit.current) return
      liveEdit.current = false
      const [clean] = sanitizeFor(tableFormatOf(file), el.value)
      const c = colIndexOf(s.ci)
      store.editTable(file, (t) => setCell(t, s.r, c, clean))
    } : null
  }

  const cancel = useCallback(() => {
    const el = ta.current
    if (el) el.value = ''
    liveEdit.current = false
    setEditing(false)
    setDraft(null)
  }, [])

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing || e.keyCode === 229 || !sel || !file) return
    const mod = e.ctrlKey || e.metaKey
    if (editing) {
      if (e.key === 'Enter') { e.preventDefault(); commit(e.shiftKey ? 'up' : 'down') }
      else if (e.key === 'Tab') { e.preventDefault(); commit(e.shiftKey ? 'left' : 'right') }
      else if (e.key === 'Escape') { e.preventDefault(); cancel() }
      return
    }
    // Ctrl+Enter = 그리드로 열기. 아래 switch 의 Enter(편집 시작)보다 먼저 본다 (TC-606)
    if (mod && e.key === 'Enter') { e.preventDefault(); openPath(file, { r: sel.r, c: colIndexOf(sel.ci) }); return }
    switch (e.key) {
      case 'ArrowUp': e.preventDefault(); moveSel('up'); return
      case 'ArrowDown': e.preventDefault(); moveSel('down'); return
      case 'ArrowLeft': e.preventDefault(); moveSel('left'); return
      case 'ArrowRight': e.preventDefault(); moveSel('right'); return
      case 'Tab': e.preventDefault(); moveSel(e.shiftKey ? 'left' : 'right'); return
      case 'Enter': if (e.altKey) return; e.preventDefault(); startEdit('edit'); return // Alt+Enter 는 맥락 메뉴
      case 'F2': e.preventDefault(); startEdit('edit'); return
      case 'Escape': e.preventDefault(); setSel(null); return
      case 'Delete': case 'Backspace': {
        e.preventDefault()
        const r = sel.r
        const c = colIndexOf(sel.ci)
        store.editTable(file, (t) => setCell(t, r, c, ''))
        return
      }
      default:
        break
    }
    if (mod && e.code === 'KeyZ') { e.preventDefault(); if (e.shiftKey) store.redo(file); else store.undo(file); return }
    if (mod && e.code === 'KeyY') { e.preventDefault(); store.redo(file); return }
  }
  const onInput = (e: React.FormEvent<HTMLTextAreaElement>) => {
    if (!editing) { if (!sel) { e.currentTarget.value = ''; return } setEditing(true) }
    // 조합 중인 글자까지 — 친 만큼 행이 늘어난다
    setDraft(e.currentTarget.value)
  }
  const onCompositionStart = () => { if (!editing && sel) { setEditing(true); setDraft(ta.current?.value ?? '') } }
  const onBlur = () => { if (editing) commit(null) }

  if (!file) return <div className="tsv-view is-error">tsv-view: <code>file</code> 이 필요합니다</div>
  if (d?.status === 'error') return <div className="tsv-view is-error">tsv-view: {file} — {d.error}</div>
  if (d && d.kind !== 'tsv') return <div className="tsv-view is-error">tsv-view: {file} 은 TSV 가 아닙니다</div>
  if (!result || !schema || !table || !validation) return <div className="tsv-view is-loading">불러오는 중… {file}</div>
  const problems = [result.error, ...spec.warnings].filter((s): s is string => !!s)
  const isMermaid = spec.render === 'mermaid'

  return (
    <div className={'tsv-view' + (isMermaid ? ' is-mermaid' : '')} data-tsv-file={file}>
      <div className="tsv-view-bar">
        <span className="tsv-view-file" onClick={() => openPath(file)} title="그리드에서 열기">⊞ {file}</span>
        <span className="tsv-view-count">{result.rows.length}{result.rows.length !== result.total ? ` / ${result.total}` : ''}행</span>
        {store.isDirty(file) && <span className="tsv-view-dirty">● 저장 전 내용</span>}
        {isMermaid && <button className="tsv-view-btn" onClick={() => setShowGen((v) => !v)}>{showGen ? '다이어그램' : '생성 텍스트'}</button>}
        {!isMermaid && <span className="muted tsv-view-hint">셀 더블클릭 · Enter 편집 · 행 번호 클릭 → 그리드</span>}
        {problems.length > 0 && <span className="tsv-view-err">{problems.join(' · ')}</span>}
      </div>
      {isMermaid ? (
        !generated ? <div className="tsv-view-gen is-error">render: mermaid 에는 template 이 필요합니다</div>
        : 'error' in generated ? <div className="tsv-view-gen is-error">템플릿 오류: {generated.error}</div>
        : showGen ? <pre className="tsv-view-gen">{generated.code}</pre>
        : <Mermaid code={generated.code} docPath={mdPath} />
      ) : (
        <div className="tsv-view-wrap" ref={wrap}>
          <table>
            <thead>
              <tr>
                <th className="tsv-view-rownum" title="파일 줄 번호">#</th>
                {result.columns.map((c) => <th key={c.index} title={c.description ?? undefined}>{c.name || columnLetter(c.index)}</th>)}
              </tr>
            </thead>
            <tbody>
              {result.rows.map((row) => (
                <tr key={row.index}>
                  <td className="tsv-view-rownum" onMouseDown={(e) => e.preventDefault()} onClick={() => openPath(file, { r: row.index, c: 0 })} title={`${row.index + 1}행 — 그리드에서 열기`}>{row.index + 1}</td>
                  {row.cells.map((v, ci) => {
                    const col = result.columns[ci]
                    const issue = validation.issues.get(issueKey(table.width, row.index, col.index))
                    const selected = sel?.r === row.index && sel.ci === ci
                    let cls = ''
                    if (isNumericType(col.type)) cls += ' is-num'
                    if (selected) cls += ' is-selected'
                    if (issue) cls += ' has-error'
                    if (col.type === 'comment') cls += ' is-comment'
                    return (
                      <td
                        key={ci}
                        data-r={row.index}
                        data-ci={ci}
                        className={cls.trim()}
                        // 칸은 줄을 바꾼다 — 짧은 칸이 눌리지 않게 최소 폭 (좌우 여백 20 + 2)
                        style={{ minWidth: minCellWidth(v, 22) }}
                        title={issue}
                        onMouseDown={(e) => {
                          e.preventDefault()
                          if (editing && !selected) commit(null)
                          select({ r: row.index, ci })
                        }}
                        onDoubleClick={() => startEdit('edit', { r: row.index, ci })}
                      >
                        {selected && editing && draft !== null ? (
                          // 원래 글은 높이 0 으로 남겨 열 너비를 그대로 두고, 고치는 글이 칸 너비에서 줄을 바꿔 행 높이를 정한다
                          <>
                            <div className="tsv-view-keep" aria-hidden="true">{v}</div>
                            <div className="tsv-view-sizer" aria-hidden="true">{draft + '​'}</div>
                          </>
                        ) : v}
                      </td>
                    )
                  })}
                </tr>
              ))}
              {result.rows.length === 0 && <tr><td colSpan={Math.max(1, result.columns.length) + 1} className="is-empty">조건에 맞는 행이 없습니다</td></tr>}
            </tbody>
          </table>
          <textarea
            ref={ta}
            className={'tsv-view-input' + (editing ? ' is-editing' : '')}
            style={box ? { left: box.left, top: box.top, width: Math.max(box.width, 140), height: Math.max(box.height, 26) } : { left: 0, top: 0 }}
            spellCheck={false}
            autoComplete="off"
            aria-label="셀 입력"
            onKeyDown={onKeyDown}
            onInput={onInput}
            onCompositionStart={onCompositionStart}
            onBlur={onBlur}
          />
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- 링크 · 이미지
/** 마크다운 링크는 그 md 파일 위치 기준. `/` 로 시작하면 그 md 가 속한 루트(주 폴더 또는 가져온 폴더) 기준 */
export function resolveLink(rawHref: string, mdPath: string): string {
  // react-markdown 이 한글 등을 %XX 로 바꿔 넘긴다 → 파일 경로로 되돌린다
  let href = rawHref
  try { href = decodeURIComponent(rawHref) } catch { /* 잘못된 % 는 그대로 */ }
  if (href.startsWith('/')) return resolveViewPath(href, mdPath)
  return resolveViewPath(href.startsWith('./') || href.startsWith('../') ? href : './' + href, mdPath)
}

function isExternal(src: string) {
  return /^[a-z][a-z0-9+.-]*:/i.test(src) || src.startsWith('//')
}

/** 문서 폴더 안 이미지(`_assets/x.png`)는 파일을 읽어 blob 주소로, 바깥 주소는 그대로 */
export function imageSrc(src: string, mdPath: string): Promise<string> {
  if (isExternal(src) || src.startsWith('data:')) return Promise.resolve(src)
  return backend().rawUrl(resolveLink(src.split('#')[0], mdPath))
}

function LocalImage({ src, mdPath, alt, ...rest }: ComponentProps<'img'> & { src: string; mdPath: string }) {
  const [url, setUrl] = useState<string | undefined>()
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let alive = true
    let made: string | undefined
    setFailed(false)
    imageSrc(src, mdPath).then((u) => {
      if (u.startsWith('blob:')) made = u
      if (alive) setUrl(u)
      else if (made) URL.revokeObjectURL(made)
    }).catch(() => { if (alive) setFailed(true) })
    return () => {
      alive = false
      if (made) URL.revokeObjectURL(made)
    }
  }, [src, mdPath])
  if (failed) return <span className="banner-item">이미지를 불러오지 못했습니다: {alt || src}</span>
  return <img src={url} alt={alt} loading="lazy" {...rest} />
}

function childClassName(children: ReactNode): string {
  if (isValidElement(children)) return String((children.props as { className?: string }).className ?? '')
  return ''
}

// ---------------------------------------------------------------- react-markdown 컴포넌트
/** rich: Mermaid · tsv-view 를 실제로 그린다 · light: 상자로 대신한다 (PLAN-skim SK2 — 썸네일 격자가 표 · 그림을 한꺼번에 불러오지 않게) */
export type MdWeight = 'rich' | 'light'

/**
 * react-markdown 의 `components` — 미리보기(`PreviewPane`)와 훑어보기(`DocView`)가 같이 쓴다.
 * 펜스(```mermaid · ```tsv-view), 문서 링크(누르면 앱에서 연다), 문서 폴더 안 그림을 처리한다.
 * `mdPath` 는 상대 링크 · 그림 · tsv-view `file` 의 기준이 되는 md 의 앱 경로.
 * 돌려주는 객체는 호출마다 새것이다 — 쓰는 쪽에서 `useMemo(() => mdComponents(path, weight), [path, weight])` 로 잡아 둔다.
 */
export function mdComponents(mdPath: string, weight: MdWeight = 'rich'): Components {
  return {
    pre: ({ node, children, ...rest }) => {
      const cls = childClassName(children)
      if (/language-(mermaid|tsv-view)\b/.test(cls)) {
        // 이 펜스들은 <pre> 없이 그린다. 원문 줄 번호(rehypeSourceLines 가 <pre> 에 찍은 것)가 있으면 잃지 않게 상자에 옮긴다
        const line = (rest as Record<string, unknown>)[LINE_ATTR]
        return line === undefined ? <>{children}</> : <div {...{ [LINE_ATTR]: line }}>{children}</div>
      }
      return <pre {...rest}>{children}</pre>
    },
    code: ({ node, className, children, ...rest }) => {
      const m = /language-([\w-]+)/.exec(className ?? '')
      const src = String(children ?? '').replace(/\n$/, '')
      if (m?.[1] === 'mermaid') return weight === 'light' ? <div className="doc-stub">다이어그램</div> : <Mermaid code={src} docPath={mdPath} />
      if (m?.[1] === 'tsv-view') {
        if (weight === 'light') return <div className="doc-stub">⊞ {parseTsvViewSpec(src).file ?? 'tsv-view'}</div>
        return <TsvView body={src} mdPath={mdPath} />
      }
      // 그 밖의 언어 — 표(lib/code/langs.ts)에 있으면 색을 넣는다. 썸네일(light)은 넣지 않는다: 격자가 문법을 받고 나누느라 느려지지 않게
      // (`[\w-]+` 는 `c#` 을 `c` 로 읽으므로 언어 표기는 따로 끝까지 읽는다)
      const lang = weight === 'rich' ? codeLangOf(/language-(\S+)/.exec(className ?? '')?.[1]) : null
      if (lang) return <CodeBlock lang={lang} code={src} className={className} {...rest} />
      return <code className={className} {...rest}>{children}</code>
    },
    a: ({ node, href, children, ...rest }) => {
      if (href && !/^[a-z][a-z0-9+.-]*:/i.test(href) && !href.startsWith('#')) {
        const target = resolveLink(href.split('#')[0], mdPath)
        if (isDocName(target)) {
          // data-doc-link: 맥락 메뉴 · 팔레트의 "링크 열기 · 오른쪽 창에 열기" 가 읽는다 (DESIGN §40)
          return <a href={href} data-doc-link={target} {...rest} onClick={(e) => { e.preventDefault(); openPath(target) }}>{children}</a>
        }
      }
      return <a href={href} target="_blank" rel="noreferrer" {...rest}>{children}</a>
    },
    img: ({ node, src, alt, ...rest }) => (typeof src === 'string' ? <LocalImage src={src} mdPath={mdPath} alt={alt} {...rest} /> : null),
  }
}

// ---------------------------------------------------------------- 미리보기
/**
 * `lines`: 최상위 조각에 원문 줄(`data-line`)을 찍는다 — 훑어보기 패널이 미리보기 전용 모드에서 스크롤 위치를 줄로 바꾸는 데 쓴다
 * (PLAN-skim SK7). 켜면 HTML 블록 · Mermaid · tsv-view 펜스가 `<div data-line>` 으로 한 겹 싸인다. 끄면(기본) DOM 은 전과 같다.
 */
export function PreviewPane({ path, lines = false }: { path: string; lines?: boolean }) {
  useDocVersion(path)
  const d = store.get(path)
  // 이 문서가 바뀔 때만 다시 그리지만, 내용 말고도(저장 중 · 충돌 등) 바뀐다. 그래서 문자열 변환 · 파싱은 Text 가
  // 바뀌었을 때만 한다 — Text 는 불변이라 편집마다 새 객체다. 디바운스도 Text 객체에 건다
  const text = d?.kind === 'text' && d.status === 'ready' ? d.text : null
  const debounced = useDebounced(text, 150)
  const stripped = useMemo(() => {
    const raw = debounced ? debounced.toString() : ''
    return lines ? stripBakedWithLines(raw) : { text: stripBaked(raw), lines: null }
  }, [debounced, lines])

  const components = useMemo(() => mdComponents(path), [path])

  // react-markdown 은 렌더될 때마다 문서 전체를 다시 파싱한다 (내부 memo 없음) → 원문이 바뀔 때만 새 엘리먼트.
  // 안의 TsvView 는 스스로 스토어를 구독하므로 표가 바뀌면 그것만 다시 그린다
  const body = useMemo(() => (
    <ReactMarkdown remarkPlugins={REMARK_PLUGINS} rehypePlugins={stripped.lines ? [[rehypeSourceLines, { lines: stripped.lines }]] : undefined} components={components}>
      {stripped.text}
    </ReactMarkdown>
  ), [stripped, components])

  // tabIndex: 미리보기 전용 모드에서 포커스를 받는다 (DESIGN §24.7 X2). 미리보기 자체에 포커스가 있을 때만 키로 스크롤한다 —
  // 안의 tsv-view 칸 · 링크에 포커스가 있으면 그쪽 키다. 브라우저 기본 스크롤에 맡기지 않고 직접 옮긴다(부드러운 스크롤 설정과 무관하게 바로 움직인다)
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget || e.ctrlKey || e.altKey || e.metaKey) return
    const el = e.currentTarget
    const page = Math.max(40, el.clientHeight - 40)
    let top: number
    switch (e.key) {
      case 'ArrowDown': top = el.scrollTop + 40; break
      case 'ArrowUp': top = el.scrollTop - 40; break
      case 'PageDown': top = el.scrollTop + page; break
      case 'PageUp': top = el.scrollTop - page; break
      case ' ': top = el.scrollTop + (e.shiftKey ? -page : page); break
      case 'Home': top = 0; break
      case 'End': top = el.scrollHeight; break
      default: return
    }
    e.preventDefault()
    el.scrollTop = top
  }

  return (
    <div className="preview" tabIndex={0} role="region" aria-label="미리보기" onKeyDown={onKeyDown}>
      <div className="preview-body">{body}</div>
    </div>
  )
}
