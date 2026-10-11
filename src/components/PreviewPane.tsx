import { isValidElement, useEffect, useMemo, useState, type ReactNode } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { store, useStoreVersion } from '../store/documents'
import { openPath } from '../lib/nav'
import { useTheme } from '../lib/theme'
import { applyTsvView, parseTsvViewSpec, resolveViewPath } from '../lib/md/tsvView'
import { columnLetter, deriveSchema } from '../lib/tsv/schema'

/**
 * 마크다운 미리보기 (DESIGN D2 v1). 스토어의 텍스트를 react-markdown 으로 그린다.
 * ```mermaid 는 동적으로 불러온 mermaid 로, ```tsv-view 는 스토어의 TsvDoc 을 표로 (DESIGN §7).
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

function Mermaid({ code }: { code: string }) {
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

function TsvView({ body, mdPath }: { body: string; mdPath: string }) {
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

  if (!file) return <div className="tsv-view is-error">tsv-view: <code>file</code> 이 필요합니다</div>
  if (d?.status === 'error') return <div className="tsv-view is-error">tsv-view: {file} — {d.error}</div>
  if (d && d.kind !== 'tsv') return <div className="tsv-view is-error">tsv-view: {file} 은 TSV 가 아닙니다</div>
  if (!result || !schema) return <div className="tsv-view is-loading">불러오는 중… {file}</div>
  const problems = [result.error, ...spec.warnings].filter((s): s is string => !!s)
  return (
    <div className="tsv-view">
      <div className="tsv-view-bar">
        <span className="tsv-view-file" onClick={() => openPath(file)} title="그리드에서 열기">⊞ {file}</span>
        <span className="tsv-view-count">{result.rows.length}{result.rows.length !== result.total ? ` / ${result.total}` : ''}행</span>
        {store.isDirty(file) && <span className="tsv-view-dirty">● 저장 전 내용</span>}
        {problems.length > 0 && <span className="tsv-view-err">{problems.join(' · ')}</span>}
      </div>
      <table>
        <thead>
          <tr>{result.columns.map((c) => <th key={c.index} title={c.description ?? undefined}>{c.name || columnLetter(c.index)}</th>)}</tr>
        </thead>
        <tbody>
          {result.rows.map((row) => (
            <tr key={row.index} onClick={() => openPath(file, { r: row.index, c: 0 })} title={`${row.index + 1}행 — 그리드에서 열기`}>
              {row.cells.map((v, i) => (
                <td key={i} className={isNumericType(result.columns[i].type) ? 'is-num' : ''}>{v}</td>
              ))}
            </tr>
          ))}
          {result.rows.length === 0 && <tr><td colSpan={Math.max(1, result.columns.length)} className="is-empty">조건에 맞는 행이 없습니다</td></tr>}
        </tbody>
      </table>
    </div>
  )
}

// ---------------------------------------------------------------- 링크
/** 마크다운 링크는 그 md 파일 위치 기준. `/` 로 시작하면 리포 루트 기준 */
function resolveLink(href: string, mdPath: string): string {
  if (href.startsWith('/')) return href.replace(/^\/+/, '')
  return resolveViewPath(href.startsWith('./') || href.startsWith('../') ? href : './' + href, mdPath)
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
  }), [path])

  return (
    <div className="preview">
      <div className="preview-body">
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>{debounced}</ReactMarkdown>
      </div>
    </div>
  )
}
