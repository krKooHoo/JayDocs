import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, type HTMLAttributes, type ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import { fileTypeOf } from '../lib/filetypes.mjs'
import { stripBakedWithLines } from '../lib/md/bake'
import { LINE_ATTR, rehypeSourceLines } from '../lib/md/sourceLines'
import { PAGE_WIDTH, firstZoom, headText, normalizeText, refineZoom, thumbLayout, useSkimText } from '../lib/skim'
import { isFieldFile, isTypeRow } from '../lib/tsv/schema'
import { parseTable } from '../lib/tsv/table'
import { REMARK_PLUGINS, mdComponents, type MdWeight } from './PreviewPane'

/**
 * 훑어보기의 공통 렌더러 (PLAN-skim Phase A · SK1~SK5). 읽기 전용이다.
 *
 * - `DocView`     경로 + 글 → 형식별 렌더 (md · 표 · 평문)
 * - `DocFileView` 경로만 → 읽어서(`useSkimText`) `DocView`, 못 읽으면 이유 상자
 * - `DocThumb`    세로 A4 틀에 축소해 넣은 썸네일 (앞부분만, 짧으면 키운다)
 * - `DocNote`     이유 · 안내 상자
 */

/** rich: Mermaid · tsv-view 를 실제로 그린다 · light: 상자로 대신한다 (썸네일 격자용) */
export type DocWeight = MdWeight

/** 표는 앞 60행만 그린다 (타입 행 · 머리글 포함) */
export const TABLE_MAX_ROWS = 60
/** 표의 열도 이만큼만 (나머지는 어차피 틀 밖이다) */
export const TABLE_MAX_COLS = 40
/** 썸네일은 글의 앞 200줄만 그린다 — 틀에 보이는 것은 그보다 훨씬 적다 */
export const THUMB_MAX_LINES = 200

export interface DocViewProps {
  /** 앱 경로. 확장자로 형식을 정하고, md 안의 상대 링크 · 그림 · tsv-view `file` 의 기준이 된다. 실제로 있는 파일이 아니어도 된다(템플릿) */
  path: string
  /** 그릴 글. BOM · CRLF 가 있어도 된다 */
  text: string
  /** 기본 'rich' */
  weight?: DocWeight
  /**
   * 원문 줄 번호를 찍는다 (`data-line`, 1부터). md 는 최상위 조각마다(baked 표를 걷어 내도 **원문** 줄), txt · json 은 줄마다.
   * 표에는 찍지 않는다. 읽을 때는 `sourceLineOf(el)` (lib/md/sourceLines).
   */
  lines?: boolean
  /** 앞 N줄만 그린다 (md · 평문). 썸네일용 — md 는 코드 펜스 한가운데에서 자르지 않는다 */
  maxLines?: number
  className?: string
}

function cls(...names: (string | false | null | undefined)[]) {
  return names.filter(Boolean).join(' ')
}

/** 이유 · 안내 상자 — 읽을 수 없는 파일(바이너리 · 5 MB 초과 · 읽기 실패), 불러오는 중 */
export function DocNote({ kind = 'info', children, className }: { kind?: 'info' | 'error'; children: ReactNode; className?: string }) {
  return <div className={cls('doc-note', kind === 'error' && 'is-error', className)}>{children}</div>
}

// ---------------------------------------------------------------- md
function MdDoc({ path, text, weight = 'rich', lines = false, maxLines, className }: DocViewProps) {
  const components = useMemo(() => mdComponents(path, weight), [path, weight])
  // react-markdown 은 렌더될 때마다 문서 전체를 다시 파싱한다 → 글이 바뀔 때만 새 엘리먼트 (PreviewPane 과 같다)
  const body = useMemo(() => {
    const stripped = stripBakedWithLines(normalizeText(text))
    const source = maxLines ? headText(stripped.text, maxLines, 'md') : stripped.text
    return (
      <ReactMarkdown remarkPlugins={REMARK_PLUGINS} rehypePlugins={lines ? [[rehypeSourceLines, { lines: stripped.lines }]] : undefined} components={components}>
        {source}
      </ReactMarkdown>
    )
  }, [text, maxLines, lines, components])
  return <div className={cls('doc-view doc-md preview-body', className)}>{body}</div>
}

// ---------------------------------------------------------------- 표 (tsv · csv)
function TableDoc({ path, text, className }: DocViewProps) {
  const view = useMemo(() => {
    const t = parseTable(text, path)
    const typed = t.rows.length > 0 && isTypeRow(t.rows[0].cells)
    // 타입 행이 있으면 1 · 2행이 고정 행, 타입 행 없는 CSV 는 첫 줄이 머리글 (lib/tsv/schema 의 deriveSchema 와 같은 규칙)
    const headerRows = typed ? 2 : t.format === 'csv' && t.rows.length > 0 ? 1 : 0
    const rows = t.rows.slice(0, TABLE_MAX_ROWS)
    const cols = Math.min(TABLE_MAX_COLS, Math.max(1, ...rows.map((r) => r.cells.length)))
    // 주석 열: 타입이 비었거나 머리글이 # 로 시작 (DESIGN §2)
    const comment = typed
      ? Array.from({ length: cols }, (_, c) => (c > 0 && (t.rows[0].cells[c] ?? '').trim() === '') || (t.rows[1]?.cells[c] ?? '').trim().startsWith('#'))
      : null
    // `_Field` 시트: 빈 줄로 나눈 블록의 첫 줄이 블록 이름
    const field = isFieldFile(path)
    const blockHead = (r: number) => field && rows[r].cells.some((v) => v !== '') && (r === 0 || rows[r - 1].cells.every((v) => v === ''))
    return { total: t.rows.length, typed, headerRows, rows, cols, comment, blockHead }
  }, [text, path])

  const { total, typed, headerRows, rows, cols, comment, blockHead } = view
  if (total === 0) return <div className={cls('doc-view doc-table', className)}><DocNote>빈 표</DocNote></div>
  const indexes = Array.from({ length: cols }, (_, c) => c)
  return (
    <div className={cls('doc-view doc-table', className)}>
      <table>
        <tbody>
          {rows.map((row, r) => {
            const head = r < headerRows
            const rowClass = head ? (typed && r === 0 ? 'is-types' : 'is-head') : blockHead(r) ? 'is-head' : undefined
            return (
              <tr key={r} className={rowClass}>
                {indexes.map((c) => {
                  const v = row.cells[c] ?? ''
                  return head ? <th key={c}>{v}</th> : <td key={c} className={comment?.[c] ? 'is-comment' : undefined}>{v}</td>
                })}
              </tr>
            )
          })}
        </tbody>
      </table>
      {total > rows.length && <div className="doc-more">… 아래로 {total - rows.length}행 더</div>}
    </div>
  )
}

// ---------------------------------------------------------------- 평문 (txt · json)
function TextDoc({ text, lines = false, maxLines, className }: DocViewProps) {
  const source = useMemo(() => {
    const n = normalizeText(text)
    return maxLines ? headText(n, maxLines) : n
  }, [text, maxLines])
  const rows = useMemo(() => (lines ? source.split('\n') : null), [lines, source])
  // 줄마다 한 조각. 끝의 줄바꿈은 빈 줄도 한 줄 높이를 갖게 한다 (블록 끝의 줄바꿈은 줄을 더 만들지 않는다)
  if (rows) return <div className={cls('doc-view doc-text', className)}>{rows.map((l, i) => <div key={i} {...{ [LINE_ATTR]: i + 1 }}>{l + '\n'}</div>)}</div>
  return <div className={cls('doc-view doc-text', className)}>{source}</div>
}

/**
 * 경로와 글을 받아 형식별로 그린다 — md 는 미리보기와 같은 렌더, 표(tsv · csv)는 앞 60행의 정적 표, txt · json 은 평문(색 없음).
 * 바깥 너비를 그대로 채운다. 축소 · 틀은 쓰는 쪽(`DocThumb`, 훑어보기 패널)이 한다.
 */
export const DocView = memo(function DocView(props: DocViewProps) {
  const kind = fileTypeOf(props.path)?.kind
  if (kind === 'md') return <MdDoc {...props} />
  if (kind === 'table') return <TableDoc {...props} />
  if (kind === 'text') return <TextDoc {...props} />
  return <DocNote kind="error" className={props.className}>지원하지 않는 형식입니다</DocNote>
})

// ---------------------------------------------------------------- 경로만 주면 읽어서 그린다
export type DocFileViewProps = Omit<DocViewProps, 'text'>

/** 경로의 파일을 읽어(`useSkimText` — 열린 문서는 저장 전 내용) 그린다. 읽는 중 · 못 읽으면 이유 상자 */
export function DocFileView({ path, ...rest }: DocFileViewProps) {
  const file = useSkimText(path)
  if (file.status === 'loading') return <DocNote className={rest.className}>불러오는 중…</DocNote>
  if (file.status === 'error') return <DocNote kind="error" className={rest.className}>{file.error}</DocNote>
  return <DocView path={path} text={file.text ?? ''} {...rest} />
}

// ---------------------------------------------------------------- 틀 썸네일
export interface DocThumbProps {
  /** 앱 경로 (형식 · 링크 기준). `text` 가 없으면 이 파일을 읽는다 */
  path: string
  /** 주면 파일을 읽지 않고 이 글을 그린다 (템플릿처럼 파일이 아닌 내용) */
  text?: string
  /** 기본 'rich'. 썸네일을 수십 개 늘어놓는 곳은 'light' */
  weight?: DocWeight
  /** 앞 N줄만 그린다 (기본 `THUMB_MAX_LINES`) */
  maxLines?: number
  className?: string
}

/** 썸네일 안은 포커스 · 클릭을 받지 않는다 (React 18 은 inert 를 모르는 속성으로 넘긴다 — 빈 문자열이어야 붙는다) */
const INERT = { inert: '' } as HTMLAttributes<HTMLDivElement>

/**
 * 세로 A4 비율(1 : 1.414)의 틀 썸네일 (SK1 · SK3). 너비는 부모를 채운다 — 크기는 부모(격자 칸)가 정한다.
 * A4 너비(794px) 상자에 `DocView` 를 그려 `transform: scale()` 로 틀 너비에 맞춘다. 문서 앞부분만 보이고 넘치면 잘린다.
 * 내용이 틀보다 짧으면 키워서 채운다 (상한 3배 — 계산은 lib/skim/fit.ts).
 * 안은 `inert` 라 클릭은 이 컴포넌트를 감싼 요소가 받는다.
 */
export function DocThumb({ path, text, weight = 'rich', maxLines = THUMB_MAX_LINES, className }: DocThumbProps) {
  const file = useSkimText(text === undefined ? path : null)
  const shown = text !== undefined ? text : file.status === 'ready' ? file.text : null
  const frame = useRef<HTMLDivElement>(null)
  const page = useRef<HTMLDivElement>(null)

  const ready = shown !== null

  /** 재서 맞춘다. 종이 너비에서 한 번, 키웠으면 그 너비에서 한 번 더 잰다 */
  const fit = useCallback(() => {
    const f = frame.current
    const p = page.current
    if (!f || !p) return
    const frameWidth = f.clientWidth
    if (frameWidth <= 0) return // 숨은 탭 — 보이게 되면 ResizeObserver 가 다시 부른다
    p.style.width = `${PAGE_WIDTH}px`
    const height = p.offsetHeight
    let zoom = firstZoom(height)
    if (zoom > 1) {
      p.style.width = `${PAGE_WIDTH / zoom}px`
      zoom = refineZoom(height, zoom, p.offsetHeight)
    }
    const layout = thumbLayout(frameWidth, zoom)
    p.style.width = `${layout.width}px`
    p.style.transform = `scale(${layout.scale})`
    p.dataset.fit = '1'
  }, [])

  // 그릴 때마다(화면에 나오기 전에) 맞춘다 — 이 컴포넌트는 글 · 무게 · 읽기 상태가 바뀔 때만 다시 그려진다
  useLayoutEffect(() => { fit() })
  // 틀 크기가 바뀌거나 내용 높이가 뒤늦게 바뀌면(Mermaid · 그림 · tsv-view) 다시 맞춘다.
  // 맞추면서 종이 상자의 크기를 바꾸므로 다음 프레임으로 미룬다 — 결과가 같으면 크기가 그대로라 거기서 멈춘다
  useEffect(() => {
    const f = frame.current
    const p = page.current
    if (!f || typeof ResizeObserver !== 'function') return
    let raf = 0
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(fit)
    })
    ro.observe(f)
    if (p) ro.observe(p)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
    }
  }, [ready, fit])

  return (
    <div className={cls('doc-thumb', className)} ref={frame}>
      {shown !== null ? (
        <div className="doc-thumb-page" ref={page} {...INERT}>
          <DocView path={path} text={shown} weight={weight} maxLines={maxLines} />
        </div>
      ) : file.status === 'error' ? (
        <div className="doc-thumb-note is-error">{file.error}</div>
      ) : (
        <div className="doc-thumb-note">불러오는 중…</div>
      )}
    </div>
  )
}
