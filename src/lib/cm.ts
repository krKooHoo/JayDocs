import { Annotation, EditorState, type Extension } from '@codemirror/state'
import { EditorView, drawSelection, dropCursor, highlightActiveLine, highlightSpecialChars, keymap, rectangularSelection, crosshairCursor } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab, redo } from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { HighlightStyle, bracketMatching, indentOnInput, syntaxHighlighting } from '@codemirror/language'
import { highlightSelectionMatches, openSearchPanel, search, searchKeymap } from '@codemirror/search'
import { tags as t } from '@lezer/highlight'
import { json, jsonParseLinter } from '@codemirror/lang-json'
import { linter, lintGutter } from '@codemirror/lint'
import { fileTypeOf } from './filetypes.mjs'
import { codeColors } from './code/cmColors'
import { foldSectionAtCursor, mdFolding, unfoldSectionAtCursor } from './md/folding'

/** CodeMirror 공통 설정 — 마크다운 창과 평문/JSON 창이 같이 쓴다. */

/** 찾기 패널 문구 — 그리드 찾기 막대(찾기 · 바꾸기 · 이전 · 다음 · 모두 바꾸기 · 대소문자 구분 · 닫기)에 맞춘다 */
const KO_PHRASES: Record<string, string> = {
  Find: '찾기',
  Replace: '바꾸기',
  next: '다음',
  previous: '이전',
  all: '모두 선택',
  'match case': '대소문자 구분',
  regexp: '정규식',
  'by word': '단어 단위',
  replace: '바꾸기',
  'replace all': '모두 바꾸기',
  close: '닫기',
  'Go to line': '줄로 이동',
  go: '이동',
  'current match': '현재 일치',
  'on line': '줄',
  'replaced $ matches': '$개를 바꿨습니다',
  'replaced match on line $': '$번 줄에서 바꿨습니다',
}

/** 다른 창(또는 디스크)에서 온 변경 표시. 되돌리기 이력에 넣지 않고, 스토어로 되돌려 보내지도 않는다. */
export const remote = Annotation.define<boolean>()

const mdHighlight = HighlightStyle.define([
  { tag: t.heading1, fontSize: '1.6em', fontWeight: '700' },
  { tag: t.heading2, fontSize: '1.35em', fontWeight: '700' },
  { tag: t.heading3, fontSize: '1.15em', fontWeight: '700' },
  { tag: [t.heading4, t.heading5, t.heading6], fontWeight: '700' },
  { tag: t.strong, fontWeight: '700' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: t.link, color: 'var(--accent)', textDecoration: 'underline' },
  { tag: t.url, color: 'var(--muted)' },
  { tag: t.monospace, fontFamily: 'var(--mono)', fontSize: '0.92em', background: 'var(--code-bg)', borderRadius: '3px' },
  { tag: t.quote, color: 'var(--muted)' },
  { tag: t.processingInstruction, color: 'var(--muted)' },
  { tag: t.contentSeparator, color: 'var(--muted)' },
  { tag: t.labelName, color: 'var(--accent)' },
])

/** JSON 등 코드형 text 파일 */
const codeHighlight = HighlightStyle.define([
  { tag: t.propertyName, color: 'var(--syn-key)' },
  { tag: t.string, color: 'var(--syn-string)' },
  { tag: [t.number, t.bool, t.null], color: 'var(--syn-number)' },
  { tag: [t.brace, t.squareBracket, t.separator, t.punctuation], color: 'var(--muted)' },
])

/**
 * 선택 영역이 또렷이 보이게. drawSelection 은 선택을 글자 뒤 레이어에 그리므로
 * 활성 줄 배경이 불투명하면 그 줄의 선택이 가려진다 → 활성 줄은 반투명 색(--active-line).
 */
const commonTheme = EditorView.theme({
  '&': { color: 'var(--fg)' },
  '.cm-content': { caretColor: 'var(--fg)' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--fg)' },
  '&.cm-focused': { outline: 'none' },
  '.cm-activeLine': { backgroundColor: 'var(--active-line)' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, &.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground': {
    backgroundColor: 'var(--selection) !important',
  },
  '.cm-selectionMatch': { backgroundColor: 'var(--selection-match)' },
  '.cm-searchMatch': { backgroundColor: 'var(--search-match)', outline: '1px solid var(--accent)' },
  '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'var(--search-match-selected)' },
  '.cm-matchingBracket, &.cm-focused .cm-matchingBracket': { backgroundColor: 'var(--selection-match)', outline: '1px solid var(--border)' },
  '.cm-panels': { backgroundColor: 'var(--panel)', color: 'var(--fg)', borderColor: 'var(--border)' },
  '.cm-panels.cm-panels-bottom': { borderTop: '1px solid var(--border)' },
  '.cm-panels.cm-panels-top': { borderBottom: '1px solid var(--border)' },
  '.cm-panel input, .cm-panel button': { background: 'var(--bg)', color: 'var(--fg)', border: '1px solid var(--border)', borderRadius: '4px' },
  '.cm-panel.cm-search label': { color: 'var(--fg)' },
  '.cm-tooltip': { background: 'var(--elev)', color: 'var(--fg)', border: '1px solid var(--border)' },
  '.cm-gutters': { backgroundColor: 'var(--bg)', color: 'var(--muted)', border: 'none' },
  '.cm-diagnostic-error': { borderLeftColor: 'var(--danger)' },
})

const proseTheme = EditorView.theme({
  '&': { height: '100%', fontSize: '15px', backgroundColor: 'var(--bg)' },
  '.cm-scroller': { fontFamily: 'var(--font)', lineHeight: '1.7', padding: '14px 0 40vh' },
  '.cm-content': { padding: '0 28px', maxWidth: '920px' },
})

const plainTheme = EditorView.theme({
  '&': { height: '100%', fontSize: '13.5px', backgroundColor: 'var(--bg)' },
  '.cm-scroller': { fontFamily: 'var(--mono)', lineHeight: '1.6', padding: '12px 0 40vh' },
  '.cm-content': { padding: '0 16px' },
})

export function isMarkdownPath(path: string) {
  return fileTypeOf(path)?.kind === 'md'
}

/** 파일 형식별 언어 지원 (마크다운이 아닌 text 파일). 편집 창이면 문법 검사도 */
function languageExtensions(path: string, readOnly: boolean): Extension[] {
  if (fileTypeOf(path)?.lang === 'json') {
    return [json(), syntaxHighlighting(codeHighlight), ...(readOnly ? [] : [linter(jsonParseLinter(), { delay: 300 }), lintGutter()])]
  }
  return []
}

/**
 * 찾기 패널을 열고 **바꾸기 칸**에 포커스 (DESIGN §45, K6) — 그리드의 `Ctrl+H` 와 같은 뜻.
 * 찾을 말은 `Ctrl+F` 와 같이 선택한 글로 채운다. 읽기 전용이면 바꾸기 칸이 없어 찾기 칸에 둔다.
 * (Windows 에서 CodeMirror 는 `Ctrl+H` 를 받지 않아 지금까지는 브라우저의 방문 기록이 열렸다)
 */
export function openReplacePanel(view: EditorView): boolean {
  openSearchPanel(view)
  const field = view.dom.querySelector<HTMLInputElement>('.cm-search input[name=replace]')
  if (field) { field.focus(); field.select() }
  return true
}

/**
 * 제목 접기 (DESIGN §52) — `Ctrl+Alt+[` 접기 · `Ctrl+Alt+]` 펴기 (Mac ⌘⌥[ · ⌘⌥] — CodeMirror 의 Mac 기본과 같다).
 * CodeMirror 기본 `Ctrl+Shift+[` 는 쓰지 않는다 — Mac 에서 ⌘⇧[ 는 브라우저의 이전 탭. 읽기 전용에서도 된다(화면 상태)
 */
const FOLD_KEYS = keymap.of([
  { key: 'Mod-Alt-[', run: (v) => { foldSectionAtCursor(v); return true } },
  { key: 'Mod-Alt-]', run: (v) => { unfoldSectionAtCursor(v); return true } },
])

export interface EditorOptions {
  readOnly?: boolean
  save?: () => void
}

export function baseExtensions(path: string, opts: EditorOptions = {}): Extension[] {
  const isMd = isMarkdownPath(path)
  const ext: Extension[] = [
    highlightSpecialChars(),
    drawSelection(),
    dropCursor(),
    EditorState.allowMultipleSelections.of(true),
    rectangularSelection(),
    crosshairCursor(),
    highlightActiveLine(),
    highlightSelectionMatches(),
    bracketMatching(),
    commonTheme,
    ...(isMd ? [markdown({ base: markdownLanguage }), syntaxHighlighting(mdHighlight), codeColors(), EditorView.lineWrapping, proseTheme, mdFolding(), FOLD_KEYS] : [plainTheme, ...languageExtensions(path, !!opts.readOnly)]),
    EditorState.phrases.of(KO_PHRASES),
    search({ top: true }),
  ]
  if (opts.readOnly) {
    ext.push(EditorState.readOnly.of(true), EditorView.editable.of(false), keymap.of([...defaultKeymap, ...searchKeymap, { key: 'Mod-h', run: openReplacePanel, scope: 'editor search-panel' }]))
  } else {
    ext.push(
      history(),
      indentOnInput(),
      keymap.of([
        ...(opts.save ? [{ key: 'Mod-s', run: () => { opts.save!(); return true } }] : []),
        ...defaultKeymap,
        ...historyKeymap,
        // Windows 의 CodeMirror 기본은 Ctrl+Y 뿐이다 — 그리드와 같게 Ctrl+Shift+Z 도 다시 실행
        { key: 'Mod-Shift-z', run: redo },
        ...searchKeymap,
        // 바꾸기 — 그리드와 같은 키 (K6). 찾기 패널 안(찾기 · 바꾸기 칸)에서 눌러도 같다
        { key: 'Mod-h', run: openReplacePanel, scope: 'editor search-panel' },
        indentWithTab,
      ]),
    )
  }
  return ext
}

/** 파일 텍스트를 에디터용으로: BOM 떼고 줄바꿈 LF 로 */
export function normalizeForEditor(raw: string): string {
  return (raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw).replace(/\r\n?/g, '\n')
}
