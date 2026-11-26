import { useSyncExternalStore } from 'react'
import { SHORTCUTS } from './shortcuts-table.mjs'
import { contextIds, type ContextSpot } from './contextMenu'
import { keysOf } from './commands'
import { dismissNotice, notify } from './notices'

/**
 * 단축키 안내 창 (`Shift+F1`, ADOPT K7 · DESIGN §46) — 포커스가 있는 자리에서 자주 쓰는 키 몇 개.
 *
 * - **자리**: K1 맥락 메뉴의 자리 판단(`spotAt` → `ContextSpot`)에 영역보다 좁은 자리(경로 막대 · 목차 · 훑어보기 창 ·
 *   폴더 격자 · 미리보기)를 더해 `HintPlace` 하나로 정한다 (`hintPlace`).
 * - **키**: 단축키 표(`shortcuts-table.mjs`)의 `hint` 가 달린 줄에서만 뽑는다 — F1 · `SHORTCUTS.md` · 맥락 메뉴와 같은 표.
 *   팔레트 명령이 달린 줄은 그 자리의 맥락 메뉴(`contextIds`)에 그 명령이 있을 때만 보인다 (읽기 전용 표에서 행 넣기를 빼는 식).
 * - 순수 함수라 테스트할 수 있다. 화면은 `components/KeyHints.tsx`.
 */

export type HintPlace =
  | 'app' | 'tab' | 'tree' | 'quickLook' | 'folderGrid' | 'pathBar' | 'outline'
  | 'md' | 'mdTable' | 'mdPreview' | 'grid' | 'gridCols' | 'gridEdit'

/** 영역보다 좁은 자리 — DOM 에서 읽는다 (`narrowPlaceAt`) */
export type NarrowPlace = 'pathBar' | 'outline' | 'folderGrid' | 'preview' | 'quickLookOpen'

/** 안내 창 머리에 보일 자리 이름 */
export const PLACE_TITLE: Record<HintPlace, string> = {
  app: 'JayDocs',
  tab: '탭',
  tree: '파일 트리',
  quickLook: '훑어보기 창',
  folderGrid: '폴더 격자',
  pathBar: '경로 막대',
  outline: '목차',
  md: '편집기',
  mdTable: '마크다운 표',
  mdPreview: '미리보기',
  grid: '표',
  gridCols: '표 · 열을 골랐을 때',
  gridEdit: '표 · 셀 편집 중',
}

/** 자리마다 차례로 볼 자리 — 앞의 것이 먼저, 같은 키는 앞의 것만 */
const PLACE_CHAIN: Partial<Record<HintPlace, HintPlace[]>> = {
  mdTable: ['mdTable', 'md'],
  gridCols: ['gridCols', 'grid'],
  quickLook: ['quickLook', 'tree'],
}

/** 자리의 "제 구역" — 그 구역의 줄이 다른 구역(전역 · 탭 · 패널)의 줄보다 먼저 온다 */
const HOME_SCOPE: Record<HintPlace, string> = {
  app: '전역', tab: '탭 · 패널', pathBar: '탭 · 패널', outline: '탭 · 패널',
  tree: '파일 트리', quickLook: '파일 트리', folderGrid: '파일 트리',
  md: '마크다운 (CodeMirror)', mdTable: '마크다운 (CodeMirror)', mdPreview: '마크다운 (CodeMirror)',
  grid: 'TSV 그리드', gridCols: 'TSV 그리드', gridEdit: 'TSV 그리드',
}

/** 안내 창에 한 번에 보이는 줄 수 (맨 아래 두 줄은 따로) */
export const MAX_HINTS = 8

/** 팔레트 명령을 그 자리의 맥락 메뉴로 거르는 자리 — 영역의 자리 판단 함수가 그 명령을 아는 곳만 */
const GATED: ReadonlySet<HintPlace> = new Set(['tree', 'md', 'mdTable', 'mdPreview', 'grid', 'gridCols'])

/** 자리 + 좁은 자리 → 안내 창의 자리 */
export function hintPlace(spot: ContextSpot, narrow: NarrowPlace | null): HintPlace {
  if (narrow === 'pathBar' || narrow === 'outline' || narrow === 'folderGrid') return narrow
  switch (spot.zone) {
    case 'grid': return spot.editing ? 'gridEdit' : spot.wholeCols ? 'gridCols' : 'grid'
    case 'tree': return narrow === 'quickLookOpen' ? 'quickLook' : 'tree'
    case 'md': return spot.mode === 'preview' || narrow === 'preview' ? 'mdPreview' : spot.table ? 'mdTable' : 'md'
    case 'tab': return 'tab'
    case 'app': return 'app'
  }
}

/** DOM — 포커스 요소의 좁은 자리. 훑어보기 창이 떠 있으면 트리에 포커스가 있어도 그 창의 키 */
export function narrowPlaceAt(el: Element | null): NarrowPlace | null {
  if (el) {
    if (el.closest('.path-bar')) return 'pathBar'
    if (el.closest('.outline-panel')) return 'outline'
    if (el.closest('.quicklook')) return 'folderGrid'
    if (el.closest('.preview')) return 'preview'
  }
  return typeof document !== 'undefined' && document.querySelector('.quicklook') ? 'quickLookOpen' : null
}

export interface KeyHint {
  keys: string
  label: string
}

/** 줄의 조건 — 자리의 성질 */
function meets(when: string | undefined, s: ContextSpot): boolean {
  if (!when) return true
  switch (when) {
    case 'markdown': return s.zone === 'md' && s.markdown
    case 'hybrid': return s.zone === 'md' && s.markdown && s.mode === 'hybrid'
    case 'mermaid': return s.zone === 'md' && s.mermaid
    case 'writable': return !('readOnly' in s && s.readOnly)
    default: return false
  }
}

/** 표의 keys → 안내 창의 키: 끝의 "(목차)" 같은 자리 표기를 빼고, Mac 이면 Ctrl 을 ⌘ 로 (표기만 — 키 처리는 이미 ⌘ 를 Ctrl 로 받는다) */
export function displayKeys(keys: string, mac = false): string {
  const k = keys.replace(/\s*\([^)]*\)\s*$/, '')
  return mac ? k.replace(/\bCtrl\b/g, '⌘') : k
}

export interface HintOptions {
  /** 전역 명령(`command`)을 지금 쓸 수 있나 — 앱에서는 등록부, 테스트에서는 없음(모두 됨) */
  available?: (id: string) => boolean
  mac?: boolean
}

/** 자리의 자주 쓰는 키 — 표의 순서대로, 제 구역의 줄이 먼저. 최대 `MAX_HINTS` 줄 */
export function keyHints(place: HintPlace, spot: ContextSpot, opt: HintOptions = {}): KeyHint[] {
  const ctx = GATED.has(place) ? new Set(contextIds(spot)) : null
  const out: KeyHint[] = []
  const seen = new Set<string>()
  for (const p of PLACE_CHAIN[place] ?? [place]) {
    const home: KeyHint[] = []
    const other: KeyHint[] = []
    for (const g of SHORTCUTS) {
      for (const s of g.items) {
        const h = s.hint
        if (!h || !(typeof h.at === 'string' ? h.at === p : h.at.includes(p))) continue
        if (!meets(h.when, spot)) continue
        if (s.palette && ctx && !ctx.has(s.palette)) continue
        if (s.command && opt.available && !opt.available(s.command)) continue
        const keys = displayKeys(h.keys ?? s.keys, opt.mac)
        if (seen.has(keys)) continue
        seen.add(keys)
        ;(g.scope === HOME_SCOPE[place] ? home : other).push({ keys, label: h.label })
      }
    }
    out.push(...home, ...other)
  }
  return out.slice(0, MAX_HINTS)
}

/** 맨 아래 줄 — 학습 사다리: 이 자리의 모든 동작(맥락 메뉴) → 전체 표(F1). 셀 편집 중의 Alt+Enter 는 칸 안 줄바꿈이라 뺀다 */
export function hintFooter(place: HintPlace, mac = false): KeyHint[] {
  const out: KeyHint[] = []
  const menu = keysOf('contextMenu')
  const help = keysOf('help')
  if (menu && place !== 'gridEdit') out.push({ keys: displayKeys(menu, mac), label: '이 자리의 모든 동작' })
  if (help) out.push({ keys: displayKeys(help, mac), label: '전체 표' })
  return out
}

/** Mac 인가 — 키 표기만 바꾼다 */
export function isMac(): boolean {
  return typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
}

// ---------------------------------------------------------------- 켬 · 접힘 (화면 설정 — 이 브라우저의 localStorage)

const ON_KEY = 'jaydocs.keyHints.on'
const FOLD_KEY = 'jaydocs.keyHints.folded'

interface HintsState { on: boolean; folded: boolean }

function load(): HintsState {
  // 처음엔 켜짐 (익히는 것이 목적), 끄면 기억한다
  try { return { on: localStorage.getItem(ON_KEY) !== '0', folded: localStorage.getItem(FOLD_KEY) === '1' } } catch { return { on: true, folded: false } }
}

let state = load()
const listeners = new Set<() => void>()

function set(next: HintsState) {
  if (next.on === state.on && next.folded === state.folded) return
  state = next
  try {
    localStorage.setItem(ON_KEY, next.on ? '1' : '0')
    localStorage.setItem(FOLD_KEY, next.folded ? '1' : '0')
  } catch { /* 저장 못 해도 동작엔 지장 없음 */ }
  for (const l of listeners) l()
}

export function keyHintsOn(): boolean {
  return state.on
}

/** 켜면 접힘도 푼다 — 켰는데 머리만 보이면 켠 것 같지 않다 */
export function setKeyHintsOn(on: boolean) {
  set({ on, folded: on ? false : state.folded })
}

/** `Shift+F1` · 팔레트 · F1 도움말의 단추 · 안내 창의 × — 켜고 끄기. 끌 때는 다시 켜는 키를 알린다 */
export function toggleKeyHints() {
  const next = !state.on
  setKeyHintsOn(next)
  if (next) dismissNotice(NOTICE)
  else notify(`단축키 안내 창을 껐습니다 — ${keysOf('toggleKeyHints') ?? 'Shift+F1'} 로 다시 켭니다`, { key: NOTICE })
}
const NOTICE = 'keyHints'

export function setKeyHintsFolded(folded: boolean) {
  set({ ...state, folded })
}

export function useKeyHintsState(): HintsState {
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => { listeners.delete(l) } },
    () => state,
  )
}
