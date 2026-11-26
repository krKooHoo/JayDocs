/**
 * 맥락 메뉴(`Alt+Enter` · `Shift+F10` · 오른쪽 클릭)의 자리 판단 (ADOPT K1 · DESIGN §40).
 *
 * - **자리(spot)**: 포커스가 있는 곳이 어떤 영역의 어디인가. 영역(그리드 · 파일 트리 · 마크다운 · 탭)의 컴포넌트가
 *   제 DOM 요소에 "자리 읽기" 함수를 걸어 두고(`registerSpotReader`), `spotAt(요소)` 가 요소에서 위로 올라가며 찾는다.
 * - **자리 판단 함수**: 자리 → 그 자리에서 쓸 수 있는 명령 id 목록 (`gridContextIds` · `treeContextIds` · `markdownContextIds` ·
 *   `tabContextIds`, 묶어서 `contextIds`). 순수 함수라 테스트할 수 있고, 단축키 안내 창(K7)이 같은 함수를 쓴다.
 * - 명령은 모두 이미 있는 등록부(`lib/commands.ts`)의 것이다 — **메뉴 전용 동작은 없다.** 메뉴는 여기 id 중에서
 *   지금 등록되어 있고 `enabled()` 인 것만 보인다(`availableContextCommands`). 키 표기는 등록부(단축키 표)에서.
 */
import { getCommand, type Command } from './commands'

export interface SpotAnchor {
  x: number
  y: number
}

interface SpotBase {
  /** 메뉴 머리에 보일 자리 이름 (셀 주소 · 경로 · 파일 이름) */
  title: string
  /** 키보드로 열 때 메뉴를 띄울 자리 (커서 · 셀 · 트리 항목의 아래 왼쪽) */
  anchor?: SpotAnchor
}

/** 그리드 셀 · 열 머리 · 행 번호 */
export interface GridSpot extends SpotBase {
  zone: 'grid'
  /** 셀 편집 중 — `Alt+Enter` 는 칸 안 줄바꿈이라 메뉴가 뜨지 않는다 */
  editing: boolean
  readOnly: boolean
  /** 행이 하나도 없는 표 */
  empty: boolean
  /** 열 전체를 골랐다 (`Ctrl+Space`, 열 글자 클릭) — 열 명령이 위로 온다 */
  wholeCols: boolean
}

/** 파일 트리의 항목 */
export interface TreeSpot extends SpotBase {
  zone: 'tree'
  /** 항목 경로. '' 는 주 폴더 루트(트리의 빈 자리) */
  path: string
  isDir: boolean
  /** 가져온 폴더 안이면 그 별칭 */
  mountAlias: string | null
  /** 가져온 폴더의 루트 노드 (`@별칭`) */
  isMountRoot: boolean
  /** 파일 하나만 가져온 곳 — 그 파일을 고치는 것만 된다 */
  fileMount: boolean
  /** 읽기 전용으로 가져온 폴더 안이 아니다 */
  writable: boolean
}

/** 마크다운 · 글 문서 (편집기 · 미리보기 · 목차) */
export interface MarkdownSpot extends SpotBase {
  zone: 'md'
  /** .md 문서 (아니면 .txt · .json 같은 글 문서) */
  markdown: boolean
  json: boolean
  readOnly: boolean
  mode: 'source' | 'hybrid' | 'split' | 'preview'
  /** 커서가 GFM 표 안 */
  table: boolean
  /** 커서 · 포커스의 문서 링크 (앱 경로). 바깥 주소는 null */
  link: string | null
  /** 커서의 ```tsv-view 펜스 · 미리보기의 tsv-view 가 가리키는 표 (앱 경로) */
  tsvView: string | null
  /** 커서가 ```mermaid 펜스 안 · 다이어그램에 포커스 */
  mermaid: boolean
}

/** 탭 제목 */
export interface TabSpot extends SpotBase {
  zone: 'tab'
  /** 그 탭의 문서 */
  path: string | null
}

/** 위 어디도 아닌 곳 (빈 화면 안내 · 아무 데도 포커스가 없을 때) */
export interface AppSpot extends SpotBase {
  zone: 'app'
}

export type ContextSpot = GridSpot | TreeSpot | MarkdownSpot | TabSpot | AppSpot
export type ContextZone = ContextSpot['zone']

// ---------------------------------------------------------------- 자리 판단 함수

/** 문서 어디서나 (맨 아래) — 저장 · 되돌리기 · 분할 · 경로 복사 · 인코딩 */
export const DOC_TAIL_IDS = ['save', 'revertToSaved', 'split', 'copyActivePath', 'convertUtf8'] as const

/** 표 · 글을 고치는 명령 — 읽기 전용 문서에서는 뺀다 (등록부의 `enabled()` 도 끄지만, K7 처럼 등록부 없이 볼 때를 위해 여기서도) */
const EDIT_IDS = new Set([
  'gridRowAbove', 'gridRowBelow', 'gridRowAppend', 'gridRowDup', 'gridRowDel', 'gridColLeft', 'gridColRight', 'gridColDel',
  'gridFillDown', 'gridFillRight', 'gridReplace', 'gridSeedHeader', 'calc',
  'mdTableRowBelow', 'mdTableColRight', 'mdTableDeleteRow', 'mdTableDeleteCol', 'formatJson', 'revertToSaved',
])

const ROW_IDS = ['gridRowAbove', 'gridRowBelow', 'gridRowAppend', 'gridRowDup', 'gridRowDel']
const COL_IDS = ['gridColLeft', 'gridColRight', 'gridColDel']

/** 그리드 셀 · 열 머리. 열 전체를 골랐으면 열 명령이 먼저. 편집 중이면 빈 목록 (그 `Alt+Enter` 는 칸 안 줄바꿈) */
export function gridContextIds(s: GridSpot): string[] {
  if (s.editing) return []
  const ids: string[] = []
  if (s.empty) ids.push('gridSeedHeader')
  ids.push(...(s.wholeCols ? [...COL_IDS, ...ROW_IDS] : [...ROW_IDS, ...COL_IDS]))
  if (!s.empty) ids.push('gridFillDown', 'gridFillRight')
  ids.push('gridFind', 'gridReplace', 'calc', 'gridCalcFile', 'exportDto', 'exportDtoAs', 'gridUndo', 'gridRedo', ...DOC_TAIL_IDS)
  return s.readOnly ? ids.filter((id) => !EDIT_IDS.has(id)) : ids
}

/** 파일 트리 항목 — 예전 `Shift+F10` 메뉴의 항목 전부 + 오른쪽 창에 열기 */
export function treeContextIds(s: TreeSpot): string[] {
  // 주 폴더 루트 (트리의 빈 자리)
  if (s.path === '') return ['newFile', 'newFolder', 'quickLookFolder', 'copyRootPath', 'editRoot', 'refreshTree', 'importFolder']
  const make = s.writable && !s.fileMount ? ['newFile', 'newFolder'] : []
  if (s.isMountRoot && s.mountAlias !== null) {
    const a = s.mountAlias
    return ['quickLook', 'quickLookFolder', ...make, 'treeCopyPath', `editRoot:${a}`, `toggleReadOnly:${a}`, 'refreshTree', `unmount:${a}`]
  }
  const change = s.writable ? ['treeRename'] : []
  const del = s.writable ? ['treeDelete'] : []
  if (s.isDir) return ['quickLook', 'quickLookFolder', ...make, ...change, 'treeCopyPath', ...del]
  return ['openTreeCursorSide', 'quickLook', ...change, 'treeCopyPath', ...make, ...del]
}

const VIEW_IDS: Record<MarkdownSpot['mode'], string> = { source: 'viewSource', hybrid: 'viewHybrid', split: 'viewSplit', preview: 'viewPreview' }

/**
 * 마크다운 · 글 문서. 자리(표 · 링크 · tsv-view)의 명령이 먼저, 그다음 문서 명령, 맨 아래 문서 어디서나.
 * Mermaid 다이어그램은 아직 팔레트 명령이 없어(확대 · 맞춤은 다이어그램이 직접 받는 키) 넣지 않는다.
 */
export function markdownContextIds(s: MarkdownSpot): string[] {
  const ids: string[] = []
  if (s.table) ids.push('mdTableRowBelow', 'mdTableColRight', 'mdTableDeleteRow', 'mdTableDeleteCol')
  if (s.link) ids.push('openLinkAtCursor', 'openLinkAtCursorSide')
  if (s.tsvView) ids.push('openTsvViewGrid')
  if (s.json) ids.push('formatJson')
  if (s.markdown) {
    ids.push(...(['source', 'hybrid', 'split', 'preview'] as const).filter((m) => m !== s.mode).map((m) => VIEW_IDS[m]))
    if (s.mode === 'hybrid') ids.push('focusOutline', 'toggleOutline')
  }
  ids.push('toggleSkim', ...DOC_TAIL_IDS, 'saveAsTemplate')
  return s.readOnly ? ids.filter((id) => !EDIT_IDS.has(id)) : ids
}

/** 탭 제목 */
export function tabContextIds(s: TabSpot): string[] {
  const doc = s.path ? ['save', 'revertToSaved', 'copyActivePath', 'saveAsTemplate'] : []
  return ['closeTab', 'closeOtherTabs', 'split', 'nextTab', 'prevTab', ...doc]
}

/** 어느 영역도 아닌 곳 */
export function appContextIds(): string[] {
  return ['newFile', 'fileSearch', 'focusTree', 'focusEditor', 'importFolder', 'palette', 'help']
}

/** 자리 → 명령 id 목록 */
export function contextIds(s: ContextSpot): string[] {
  switch (s.zone) {
    case 'grid': return gridContextIds(s)
    case 'tree': return treeContextIds(s)
    case 'md': return markdownContextIds(s)
    case 'tab': return tabContextIds(s)
    case 'app': return appContextIds()
  }
}

// ---------------------------------------------------------------- 자리 읽기 (DOM)

/** point: 오른쪽 클릭한 자리 (키보드로 열면 없음). 마크다운은 그 자리로 커서를 옮긴 뒤 읽는다 */
export type SpotReader = (target: Element, point: SpotAnchor | null) => ContextSpot | null

const readers = new WeakMap<Element, SpotReader>()

/** 영역의 바깥 요소에 자리 읽기 함수를 건다. 돌려준 함수로 뗀다 */
export function registerSpotReader(el: Element, fn: SpotReader): () => void {
  readers.set(el, fn)
  return () => { if (readers.get(el) === fn) readers.delete(el) }
}

/** 요소에서 위로 올라가며 처음 만난 영역의 자리. 아무 영역도 아니면 `app` */
export function spotAt(target: Element | null, point: SpotAnchor | null = null): ContextSpot {
  for (let el = target; el; el = el.parentElement) {
    const fn = readers.get(el)
    if (!fn) continue
    const s = fn(target!, point)
    if (s) return s
  }
  return { zone: 'app', title: 'JayDocs' }
}

/** 자리의 명령 중 지금 등록되어 있고 쓸 수 있는 것 — 순서는 자리 판단 함수의 순서 그대로 */
export function availableContextCommands(s: ContextSpot): Command[] {
  const out: Command[] = []
  for (const id of contextIds(s)) {
    const c = getCommand(id)
    if (c && !c.hidden && (!c.enabled || c.enabled())) out.push(c)
  }
  return out
}

/** 요소의 화면 자리 — 메뉴를 그 아래 왼쪽에 띄운다 */
export function anchorOf(el: Element | null | undefined): SpotAnchor | undefined {
  if (!el) return undefined
  const r = el.getBoundingClientRect()
  if (!r.width && !r.height) return undefined
  return { x: r.left + 8, y: r.bottom + 2 }
}
