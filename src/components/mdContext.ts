import { EditorView } from '@codemirror/view'
import { syntaxTree } from '@codemirror/language'
import type { SyntaxNode } from '@lezer/common'
import { isDocName } from '../lib/filetypes.mjs'
import { parseTsvViewSpec, resolveViewPath } from '../lib/md/tsvView'
import type { MarkdownSpot, SpotAnchor } from '../lib/contextMenu'
import { resolveLink } from './PreviewPane'
import { lastMdView } from './tableCommands'

/**
 * 마크다운 창의 맥락 메뉴 자리 (DESIGN §40) — 커서 · 포커스가 표 · 문서 링크 · tsv-view · Mermaid 위인가.
 * 메뉴와 팔레트 명령("커서의 링크 열기" 등)이 같은 판단을 쓴다: 미리보기의 링크 · tsv-view 에 포커스가 있으면 그것,
 * 아니면 마지막으로 쓴 마크다운 편집기의 커서.
 */

/** 편집기 → 그 문서의 앱 경로 (링크 · tsv-view 의 상대 경로 기준). MarkdownPane 이 편집기를 만들 때 넣는다 */
const viewPaths = new WeakMap<EditorView, string>()
export function setMdViewPath(view: EditorView, path: string) {
  viewPaths.set(view, path)
}

/** 링크 주소 → 앱 안 문서 경로. 바깥 주소 · 문서 안 `#제목` · 문서가 아닌 파일은 null */
export function docLinkTarget(rawHref: string, mdPath: string): string | null {
  const href = rawHref.trim().replace(/^<(.*)>$/, '$1')
  if (!href || href.startsWith('#') || href.startsWith('//') || /^[a-z][a-z0-9+.-]*:/i.test(href)) return null
  const target = resolveLink(href.split('#')[0], mdPath)
  return isDocName(target) ? target : null
}

export interface CursorContext {
  table: boolean
  link: string | null
  tsvView: string | null
  mermaid: boolean
}

/** 편집기 커서 자리의 구문 — GFM 표 · 링크 · ```tsv-view · ```mermaid 펜스 */
export function cursorContext(view: EditorView, mdPath: string): CursorContext {
  const { state } = view
  const pos = state.selection.main.head
  const tree = syntaxTree(state)
  const out: CursorContext = { table: false, link: null, tsvView: null, mermaid: false }
  for (const side of [1, -1] as const) {
    for (let n: SyntaxNode | null = tree.resolveInner(pos, side); n; n = n.parent) {
      if (n.name === 'Table') out.table = true
      else if (n.name === 'Link' && out.link === null) {
        const url = n.getChild('URL')
        if (url) out.link = docLinkTarget(state.sliceDoc(url.from, url.to), mdPath)
      } else if (n.name === 'FencedCode') {
        const info = n.getChild('CodeInfo')
        const lang = info ? state.sliceDoc(info.from, info.to).trim() : ''
        if (lang === 'mermaid') out.mermaid = true
        if (lang === 'tsv-view' && out.tsvView === null) {
          const text = n.getChild('CodeText')
          const spec = parseTsvViewSpec(text ? state.sliceDoc(text.from, text.to) : '')
          if (spec.file) out.tsvView = resolveViewPath(spec.file, mdPath)
        }
      }
    }
  }
  return out
}

/** DOM 요소(미리보기 · 하이브리드 위젯 안)의 자리 */
function elementContext(el: Element | null): CursorContext {
  const out: CursorContext = { table: false, link: null, tsvView: null, mermaid: false }
  if (!el) return out
  out.link = el.closest('[data-doc-link]')?.getAttribute('data-doc-link') ?? null
  out.tsvView = el.closest('[data-tsv-file]')?.getAttribute('data-tsv-file') ?? null
  out.mermaid = !!el.closest('.mermaid-box, .cm-hybrid-block.is-mermaid')
  out.table = !!el.closest('.cm-hybrid-block.is-table')
  return out
}

/** 포커스가 든 편집기, 없으면 마지막 마크다운 편집기의 커서 자리 (편집기가 없어졌으면 null) */
function lastCursorContext(): CursorContext | null {
  const ed = document.activeElement?.closest<HTMLElement>('.cm-editor')
  const view = (ed ? EditorView.findFromDOM(ed) : null) ?? lastMdView()
  const path = view ? viewPaths.get(view) : undefined
  return view && path && view.dom.isConnected ? cursorContext(view, path) : null
}

/** 팔레트 "커서의 링크 열기" · 맥락 메뉴가 열 문서 링크 */
export function currentLink(): string | null {
  return elementContext(document.activeElement).link ?? lastCursorContext()?.link ?? null
}

/** 팔레트 "tsv-view 표를 그리드로 열기" 가 열 표 */
export function currentTsvView(): string | null {
  return elementContext(document.activeElement).tsvView ?? lastCursorContext()?.tsvView ?? null
}

interface PaneInfo {
  path: string
  markdown: boolean
  json: boolean
  readOnly: boolean
  mode: MarkdownSpot['mode']
}

/**
 * 마크다운 창의 자리 읽기. 편집기를 오른쪽 클릭했으면(point) 그 자리로 커서를 옮긴 뒤 읽는다 — 고른 범위 안이면 그대로.
 * 하이브리드의 블록 위젯(표 · 다이어그램 · tsv-view) 위는 커서를 옮기지 않는다 (위젯이 원문으로 바뀌지 않게)
 */
export function readMarkdownSpot(view: EditorView | null, target: Element, point: SpotAnchor | null, info: PaneInfo): MarkdownSpot {
  let ctx = elementContext(target)
  let anchor: SpotAnchor | undefined
  const inBlock = !!target.closest('.cm-hybrid-block')
  if (view && view.dom.contains(target) && !inBlock) {
    if (point) {
      const pos = view.posAtCoords(point)
      const sel = view.state.selection.main
      if (pos !== null && (pos < sel.from || pos > sel.to)) view.dispatch({ selection: { anchor: pos } })
    }
    if (info.markdown) ctx = cursorContext(view, info.path)
    const c = view.coordsAtPos(view.state.selection.main.head)
    if (c) anchor = { x: c.left, y: c.bottom + 2 }
  }
  const where = [ctx.table && '표', ctx.link && `링크 → ${ctx.link}`, ctx.tsvView && `tsv-view → ${ctx.tsvView}`, ctx.mermaid && '다이어그램'].filter(Boolean).join(' · ')
  return {
    zone: 'md',
    title: (info.path.split('/').pop() ?? info.path) + (where ? ` · ${where}` : ''),
    anchor,
    markdown: info.markdown,
    json: info.json,
    readOnly: info.readOnly,
    mode: info.mode,
    ...ctx,
  }
}
