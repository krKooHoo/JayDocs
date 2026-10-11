import { isValidElement, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { store, useStoreVersion } from '../store/documents'
import { backend } from '../lib/backend'
import { openPath } from '../lib/nav'
import { useTheme } from '../lib/theme'
import { applyTsvView, parseTsvViewSpec, resolveViewPath, rowRecord, type TsvViewResult } from '../lib/md/tsvView'
import { compileTemplate } from '../lib/md/template'
import { stripBaked } from '../lib/md/bake'
import { columnLetter, deriveSchema, type TableSchema } from '../lib/tsv/schema'
import { issueKey, validateTable } from '../lib/tsv/validate'
import { setCell } from '../lib/tsv/edits'
import { sanitizeCell } from '../lib/tsv/serialize'
import type { TsvTable } from '../lib/tsv/model'

/**
 * 마크다운 미리보기 (DESIGN D2 v1). 스토어의 텍스트를 react-markdown 으로 그린다.
 * ```mermaid 는 동적으로 불러온 mermaid 로, ```tsv-view 는 스토어의 TsvDoc 을 표로 (DESIGN §7).
 * 하이브리드 모드(components/hybrid.ts)도 같은 Mermaid · TsvView 컴포넌트를 쓴다.
 */

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

export function Mermaid({ code }: { code: string }) {
  const theme = useTheme()
  const [state, setState] = useState<{ svg: string } | { error: string } | null>(null)
  useEffect(() => {
    let alive = true
    setState(null)
    loadMermaid()
      .then(async (m) => {
        try {
          // 테마가 바뀌면 다시 그린다 (initialize 는 다음 render 부터 적용된다)
          m.initialize({ startOnLoad: false, securityLevel: 'strict', theme: theme === 'dark' ? 'dark' : 'neutral', fontFamily: 'inherit' })
          const ok = await m.parse(code, { suppressErrors: true })
          if (!ok) throw new Error('Mermaid 문법 오류')
          const { svg } = await m.render(`jd-mmd-${++mermaidSeq}`, code)
          if (alive) setState({ svg })
        } catch (e) {
          if (alive) setState({ error: (e as Error).message })
        }
      })
      .catch((e) => { if (alive) setState({ error: `mermaid 를 불러오지 못했습니다: ${(e as Error).message}` }) })
    return () => { alive = false }
  }, [code, theme])
  if (!state) return <div className="mermaid-box is-loading">다이어그램 그리는 중…</div>
  if ('error' in state) {
    return (
      <div className="mermaid-box is-error">
        <div>{state.error}</div>
        <pre>{code}</pre>
      </div>
    )
  }
  return <div className="mermaid-box" dangerouslySetInnerHTML={{ __html: state.svg }} />
}

// ---------------------------------------------------------------- tsv-view
function isNumericType(t: string) {
  return t === 'byte' || t === 'uint' || t === 'float'
}

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
  useStoreVersion()
  const spec = useMemo(() => parseTsvViewSpec(body), [body])
  const file = spec.file ? resolveViewPath(spec.file, mdPath) : null
  useEffect(() => {
    if (!file) return
    store.retain(file)
    return () => store.release(file)
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
  useLayoutEffect(() => { setBox(sel ? locate(sel) : null) }, [sel, result, locate])

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
    const [clean] = sanitizeCell(el.value)
    const r = sel.r
    const c = colIndexOf(sel.ci)
    store.editTable(file, (t) => setCell(t, r, c, clean))
    el.value = ''
    setEditing(false)
    if (move) moveSel(move)
  }, [sel, file, editing, colIndexOf, moveSel])

  const cancel = useCallback(() => {
    const el = ta.current
    if (el) el.value = ''
    setEditing(false)
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
    switch (e.key) {
      case 'ArrowUp': e.preventDefault(); moveSel('up'); return
      case 'ArrowDown': e.preventDefault(); moveSel('down'); return
      case 'ArrowLeft': e.preventDefault(); moveSel('left'); return
      case 'ArrowRight': e.preventDefault(); moveSel('right'); return
      case 'Tab': e.preventDefault(); moveSel(e.shiftKey ? 'left' : 'right'); return
      case 'Enter': case 'F2': e.preventDefault(); startEdit('edit'); return
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
    if (mod && e.key === 'Enter') { e.preventDefault(); openPath(file, { r: sel.r, c: colIndexOf(sel.ci) }); return }
  }
  const onInput = (e: React.FormEvent<HTMLTextAreaElement>) => {
    if (!editing) { if (!sel) { e.currentTarget.value = ''; return } setEditing(true) }
  }
  const onCompositionStart = () => { if (!editing && sel) setEditing(true) }
  const onBlur = () => { if (editing) commit(null) }

  if (!file) return <div className="tsv-view is-error">tsv-view: <code>file</code> 이 필요합니다</div>
  if (d?.status === 'error') return <div className="tsv-view is-error">tsv-view: {file} — {d.error}</div>
  if (d && d.kind !== 'tsv') return <div className="tsv-view is-error">tsv-view: {file} 은 TSV 가 아닙니다</div>
  if (!result || !schema || !table || !validation) return <div className="tsv-view is-loading">불러오는 중… {file}</div>
  const problems = [result.error, ...spec.warnings].filter((s): s is string => !!s)
  const isMermaid = spec.render === 'mermaid'

  return (
    <div className={'tsv-view' + (isMermaid ? ' is-mermaid' : '')}>
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
        : <Mermaid code={generated.code} />
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
                        title={issue}
                        onMouseDown={(e) => {
                          e.preventDefault()
                          if (editing && !selected) commit(null)
                          select({ r: row.index, ci })
                        }}
                        onDoubleClick={() => startEdit('edit', { r: row.index, ci })}
                      >
                        {v}
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
/** 마크다운 링크는 그 md 파일 위치 기준. `/` 로 시작하면 리포 루트 기준 */
export function resolveLink(href: string, mdPath: string): string {
  if (href.startsWith('/')) return href.replace(/^\/+/, '')
  return resolveViewPath(href.startsWith('./') || href.startsWith('../') ? href : './' + href, mdPath)
}

function isExternal(src: string) {
  return /^[a-z][a-z0-9+.-]*:/i.test(src) || src.startsWith('//')
}

/** 리포 안 이미지(`_assets/x.png`)는 사이드카의 /api/raw 로, 바깥 주소는 그대로 */
export function imageSrc(src: string, mdPath: string): string {
  if (isExternal(src) || src.startsWith('data:')) return src
  return backend().rawUrl(resolveLink(src.split('#')[0], mdPath))
}

function childClassName(children: ReactNode): string {
  if (isValidElement(children)) return String((children.props as { className?: string }).className ?? '')
  return ''
}

// ---------------------------------------------------------------- 미리보기
export function PreviewPane({ path }: { path: string }) {
  useStoreVersion()
  const d = store.get(path)
  const text = d?.kind === 'text' && d.status === 'ready' ? d.text.toString() : ''
  const debounced = useDebounced(text, 150)
  const source = useMemo(() => stripBaked(debounced), [debounced])

  const components = useMemo<Components>(() => ({
    pre: ({ node, children, ...rest }) => {
      const cls = childClassName(children)
      if (/language-(mermaid|tsv-view)\b/.test(cls)) return <>{children}</>
      return <pre {...rest}>{children}</pre>
    },
    code: ({ node, className, children, ...rest }) => {
      const m = /language-([\w-]+)/.exec(className ?? '')
      const src = String(children ?? '').replace(/\n$/, '')
      if (m?.[1] === 'mermaid') return <Mermaid code={src} />
      if (m?.[1] === 'tsv-view') return <TsvView body={src} mdPath={path} />
      return <code className={className} {...rest}>{children}</code>
    },
    a: ({ node, href, children, ...rest }) => {
      if (href && !/^[a-z][a-z0-9+.-]*:/i.test(href) && !href.startsWith('#')) {
        const target = resolveLink(href.split('#')[0], path)
        if (/\.(md|tsv)$/i.test(target)) {
          return <a href={href} {...rest} onClick={(e) => { e.preventDefault(); openPath(target) }}>{children}</a>
        }
      }
      return <a href={href} target="_blank" rel="noreferrer" {...rest}>{children}</a>
    },
    img: ({ node, src, alt, ...rest }) => <img src={typeof src === 'string' ? imageSrc(src, path) : undefined} alt={alt} loading="lazy" {...rest} />,
  }), [path])

  return (
    <div className="preview">
      <div className="preview-body">
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>{source}</ReactMarkdown>
      </div>
    </div>
  )
}
