import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { Actions, DockLocation, Layout, Model, TabNode, TabSetNode, type Action, type BorderNode, type IJsonModel, type ITabRenderValues, type Node } from 'flexlayout-react'
import type { TreeEntry } from '../lib/backend'
import { keysOf, registerCommands, runCommand } from '../lib/commands'
import { askConfirm, dialogOpen } from '../lib/dialogs'
import { recordRecentFile } from '../lib/recents'
import { paneAction, requestLine, requestQuickLook, requestTreeFilter, requestTreeOpenSide, sendToPane, setOpener } from '../lib/nav'
import { navCan, navGo, navHistory, noteDocChange, noteRename, resetNavHistory } from '../lib/navHistory'
import { isTsvPath, store, useDirtyPaths } from '../store/documents'
import { isMarkdownPath } from '../lib/cm'
import { fileTypeOf } from '../lib/filetypes.mjs'
import { dismissNotice, notify } from '../lib/notices'
import { SKIM_WIDTH_BIG_STEP, isSkimPath, nudgeSkimPanelWidth, refreshSkimPanels, skimPanelState, toggleSkimPanel } from '../lib/skim/panel'
import { isLookDefault, resetLookPrefs } from '../lib/skim/look'
import { folderPrefs, setFolderSort, toggleFolderView } from '../lib/skim/folderView'
import { outlineOn, setOutlineOn } from '../lib/md/outlineState'
import { DocPaneCountContext } from './docPanes'
import { FileTree, type RootAction } from './FileTree'
import { MarkdownPane } from './MarkdownPane'
import { GridPane } from './grid/GridPane'
import { runTableCommand } from './tableCommands'
import type { TableOp } from '../lib/md/tableEdit'
import { SUMMARY_KEYS, SUMMARY_LABELS, toggleSummaryKey, useSummaryKeys } from '../lib/tsv/summary'
import { confirmConvertToUtf8, reopenAs } from './ReadOnlyBanner'
import { REOPEN_ENCODINGS } from '../lib/encodings'
import { invisiblesOn, toggleInvisibles, useInvisibles } from '../lib/invisibles'
import { scrollSyncOn, toggleScrollSync, useScrollSync } from '../lib/md/scrollSync'
import { EditorView } from '@codemirror/view'
import { revertTextInView } from '../lib/revert'
import { PANE_COMMANDS, type PaneScope } from '../lib/paneCommands'
import { registerSpotReader, type SpotReader, type TabSpot } from '../lib/contextMenu'
import { currentLink, currentTsvView } from './mdContext'
import { EMPTY_TRACK, notePaneFocus, otherPaneTarget, type PaneFocusTrack } from '../lib/paneFocus'

/** 마크다운 표 팔레트 명령: id · 동작 · 이름 · 키(표시용, 그리드와 같다). 열은 키가 없다 (DESIGN §41 K2) */
const MD_TABLE_COMMANDS: [string, TableOp, string, string | undefined][] = [
  ['mdTableRowBelow', 'rowBelow', '마크다운 표: 아래에 행 넣기', 'Ctrl+Alt+='],
  ['mdTableColRight', 'colRight', '마크다운 표: 오른쪽에 열 넣기', undefined],
  ['mdTableDeleteRow', 'deleteRow', '마크다운 표: 행 지우기', 'Ctrl+Alt+-'],
  ['mdTableDeleteCol', 'deleteCol', '마크다운 표: 열 지우기', undefined],
]

export interface WorkbenchHandle {
  /** focus: 열고 그 문서 창(편집기 · 그리드)으로 포커스 — 새 파일, 파일 검색 */
  openFile(path: string, focus?: boolean): void
  saveActive(): void
  activePath(): string | null
  /** 파일·폴더 이름이 바뀌면 열린 탭의 경로를 따라 바꾼다 */
  renamePaths(from: string, to: string, isDir: boolean): void
  /** 파일·폴더가 지워지면 그 탭들을 닫는다 */
  closePaths(path: string, isDir: boolean): void
  /** 열린 문서 탭의 경로들 */
  openPaths(): string[]
  /** 오른쪽 창에 열기 (DESIGN §38) — 빠른 열기 · 전체 검색의 Ctrl+Enter */
  openFileSide(path: string): void
}

interface Props {
  /** 레이아웃을 기억하는 열쇠 (작업 공간 id) */
  layoutId: string
  tree: TreeEntry[]
  onRefresh: () => void
  onNewFile: (dir: string) => void
  onNewFolder: (dir: string) => void
  onRename: (path: string, isDir: boolean) => void
  onDelete: (path: string, isDir: boolean) => void
  onRootAction: (action: RootAction, path: string) => void
  onSelectDir?: (dir: string) => void
  /** 활성 문서가 바뀌면 (창 제목 — DESIGN §33). 탭 전환 · 닫기 · 이름 바꾸기 때 */
  onActiveDocChange?: (path: string | null) => void
}

const LAYOUT_VERSION = 1

function defaultLayout(): IJsonModel {
  return {
    global: {
      tabEnableClose: true,
      tabEnableRename: false,
      tabSetEnableMaximize: false,
      tabSetMinWidth: 200,
      borderEnableAutoHide: false,
    },
    borders: [
      {
        type: 'border',
        location: 'left',
        size: 260,
        selected: 0,
        children: [{ type: 'tab', name: '파일', component: 'tree', enableClose: false, enableDrag: false }],
      },
    ],
    layout: { type: 'row', children: [{ type: 'tabset', id: 'main', weight: 100, enableDeleteWhenEmpty: false, children: [] }] },
  }
}

function layoutKey(layoutId: string) {
  return `jaydocs.layout.v${LAYOUT_VERSION}:${layoutId}`
}

function loadModel(layoutId: string): Model {
  try {
    const raw = localStorage.getItem(layoutKey(layoutId))
    if (raw) return Model.fromJson(JSON.parse(raw) as IJsonModel)
  } catch { /* 깨진 저장분은 버린다 */ }
  return Model.fromJson(defaultLayout())
}

function baseName(path: string) {
  return path.split('/').pop() ?? path
}

function tabJson(path: string) {
  return { type: 'tab', name: baseName(path), component: isTsvPath(path) ? 'tsv' : 'md', config: { path } }
}

function firstTabSet(model: Model): TabSetNode | undefined {
  let found: TabSetNode | undefined
  model.visitNodes((n: Node) => { if (!found && n.getType() === 'tabset') found = n as TabSetNode })
  return found
}

function findTabs(model: Model, pred: (cfg: Record<string, unknown>, component: string) => boolean): TabNode[] {
  const out: TabNode[] = []
  model.visitNodes((n: Node) => {
    if (n.getType() === 'tab') {
      const tab = n as TabNode
      if (pred((tab.getConfig() ?? {}) as Record<string, unknown>, tab.getComponent() ?? '')) out.push(tab)
    }
  })
  return out
}

/** 문서 창의 수 — 탭이 든 탭 묶음. 가장자리 패널(border)은 탭 묶음이 아니라 세지 않는다 */
function countDocPanes(model: Model): number {
  let n = 0
  model.visitNodes((node: Node) => { if (node.getType() === 'tabset' && (node as TabSetNode).getChildren().length) n++ })
  return n
}

/** 가장자리 패널(border)의 탭을 찾는다. visitNodes 는 border 안의 탭도 돈다 */
function findBorder(model: Model, component: string): { border: BorderNode; tab: TabNode } | null {
  let found: { border: BorderNode; tab: TabNode } | null = null
  model.visitNodes((n: Node) => {
    if (found || n.getType() !== 'tab') return
    const tab = n as TabNode
    const parent = tab.getParent()
    if (tab.getComponent() === component && parent?.getType() === 'border') found = { border: parent as BorderNode, tab }
  })
  return found
}

function focusLater(selector: string) {
  window.setTimeout(() => document.querySelector<HTMLElement>(selector)?.focus(), 60)
}

/**
 * 탭 하나의 문서 창 안에서 포커스를 받는 곳 — 에디터 본문, 그리드의 입력 칸, 미리보기(미리보기 전용 모드).
 * 문서 순서대로 보이는 첫 번째 것이 받는다: 분할 모드는 에디터, 미리보기 전용은 (에디터가 숨겨져) 미리보기.
 */
const PANE_FOCUS = '.cm-content, textarea.grid-input, .preview'

/**
 * 그 탭(탭 id)의 창에 포커스. 같은 문서가 두 창에 열려 있어도 이 탭의 창만 받는다 (경로로 부르면 마지막 창이 가져간다).
 * 막 선택한 탭은 다음 프레임에야 그려질 수 있어 몇 번 다시 시도한다 (막 만든 파일은 읽히는 데 더 걸려 tries 를 늘려 부른다).
 */
function focusTabPane(tabId: string, tries = 6) {
  const els = document.querySelectorAll<HTMLElement>(`[data-tab-id="${tabId}"] :is(${PANE_FOCUS})`)
  for (const el of els) if (el.offsetParent !== null) { el.focus(); return }
  if (tries > 0) window.setTimeout(() => focusTabPane(tabId, tries - 1), 40)
}

/** 탭 제목 버튼(flexlayout 이 그리는 `role="tab"`)의 id — 앞머리 뒤가 탭 id (공백은 `_`) */
function tabButtonId(tabId: string) {
  return 'flexlayout-tabbutton-' + tabId.replace(/\s/g, '_')
}

const DOC_COMPONENTS = new Set(['md', 'tsv'])

export const Workbench = forwardRef<WorkbenchHandle, Props>(function Workbench(p, ref) {
  // 글자를 칠 때마다가 아니라 저장 안 한 문서의 구성이 바뀔 때만 다시 그린다 (트리 · 탭 제목의 ●)
  const dirtyPaths = useDirtyPaths()
  const [model] = useState(() => loadModel(p.layoutId))

  const activeTabSet = useCallback(() => model.getActiveTabset() ?? firstTabSet(model), [model])
  const activeTab = useCallback(() => activeTabSet()?.getSelectedNode() as TabNode | undefined, [activeTabSet])
  const activePath = useCallback(() => {
    const tab = activeTab()
    if (!tab || !DOC_COMPONENTS.has(tab.getComponent() ?? '')) return null
    return (tab.getConfig()?.path as string | undefined) ?? null
  }, [activeTab])
  /**
   * 트리가 강조할 "지금 문서". flexlayout 은 탭 내용(트리 포함)을 이 컴포넌트가 다시 그려질 때만 다시 그린다 —
   * 탭을 바꿔도 모델만 바뀐다. 예전에는 스토어가 바뀔 때마다 다시 그려져 강조가 (늦게나마) 따라왔다.
   * 이제 그 렌더가 없으니 모델이 바뀔 때 활성 문서를 state 로 받아, 그것이 달라질 때만 다시 그린다.
   */
  const [activeDoc, setActiveDoc] = useState<string | null>(() => activePath())
  /** 문서 창의 수 (훑어보기 패널은 하나일 때만 보인다 — PLAN-skim SK6). 레이아웃이 바뀔 때 세고, 수가 달라질 때만 다시 그린다 */
  const [paneCount, setPaneCount] = useState(() => countDocPanes(model))
  const onActiveDocChange = p.onActiveDocChange
  useEffect(() => { onActiveDocChange?.(activeDoc) }, [activeDoc, onActiveDocChange])
  // 뒤로 · 앞으로 (DESIGN §50) — 지금 문서가 바뀔 때마다 떠난 자리를 적는다. 문서 폴더를 바꾸면 비운다
  const prevDoc = useRef<string | null>(null)
  useEffect(() => { resetNavHistory(); prevDoc.current = null }, [p.layoutId])
  useEffect(() => {
    if (!activeDoc) return
    noteDocChange(prevDoc.current, activeDoc)
    prevDoc.current = activeDoc
  }, [activeDoc])

  /** 훑어보기 패널 켜기 / 끄기. 켰는데 지금 화면에는 안 보이는 경우(분할 중 · md · txt 가 아닌 문서)에는 이유를 알린다 */
  const toggleSkim = useCallback(() => {
    toggleSkimPanel()
    const path = activePath()
    const why = countDocPanes(model) > 1 ? '문서 창이 하나일 때만 보입니다' : !path || !isSkimPath(path) ? '.md · .txt 문서에서 보입니다' : null
    if (why) notify(skimPanelState().on ? `훑어보기 패널을 켰습니다 — ${why}` : '훑어보기 패널을 껐습니다', { key: 'skim' })
    else dismissNotice('skim')
  }, [model, activePath])

  const selectTab = useCallback((tab: TabNode) => {
    model.doAction(Actions.selectTab(tab.getId()))
    const parent = tab.getParent()
    if (parent && parent.getType() === 'tabset') model.doAction(Actions.setActiveTabset(parent.getId()))
  }, [model])

  /** 탭을 붙이고 그 탭을 돌려준다 */
  const addTab = useCallback((json: Record<string, unknown>): TabNode | undefined => {
    const ts = activeTabSet()
    if (!ts) return undefined
    return model.doAction(Actions.addNode(json, ts.getId(), DockLocation.CENTER, -1, true)) as TabNode | undefined
  }, [model, activeTabSet])

  const openFile = useCallback((path: string, focus = false) => {
    recordRecentFile(p.layoutId, path)
    const existing = findTabs(model, (cfg, comp) => DOC_COMPONENTS.has(comp) && cfg.path === path)
    let tab: TabNode | undefined = existing[0]
    if (tab) selectTab(tab)
    else tab = addTab(tabJson(path))
    // 막 만든 파일은 읽힌 뒤에야 편집기가 생긴다 — 넉넉히 기다린다 (약 1초)
    if (focus && tab) focusTabPane(tab.getId(), 25)
  }, [model, selectTab, addTab, p.layoutId])

  useEffect(() => {
    setOpener(openFile)
    return () => setOpener(null)
  }, [openFile])

  /** 뒤로(-1) · 앞으로(+1) — 그 문서를 열고(탭이 있으면 그 탭), 글 문서면 그 줄로. 없어진 문서는 건너뛴다 */
  const treeRef = useRef(p.tree)
  treeRef.current = p.tree
  const goNav = useCallback((dir: -1 | 1) => {
    const files = new Set<string>()
    const walk = (list: TreeEntry[]) => { for (const e of list) { if (e.type === 'file') files.add(e.path); else walk(e.children ?? []) } }
    walk(treeRef.current)
    const ok = navGo(dir, activePath(), (path) => files.has(path), (loc, sameDoc) => {
      if (!sameDoc) openFile(loc.path, true)
      if (loc.line) requestLine(loc.path, { line: loc.line })
    })
    if (!ok) notify(dir < 0 ? '더 뒤로 갈 곳이 없습니다' : '더 앞으로 갈 곳이 없습니다', { key: 'nav' })
  }, [activePath, openFile])

  /**
   * 오른쪽 창에 열기 (DESIGN §38, `Ctrl+Enter`). 다른 탭 묶음이 있으면 거기에(활성 묶음의 오른쪽 · 다음 것 먼저), 없으면 오른쪽에 새 묶음.
   * 그 묶음에 이미 열려 있으면 그 탭을 고른다. 포커스는 연 창으로
   */
  const openFileSide = useCallback((path: string) => {
    recordRecentFile(p.layoutId, path)
    const active = activeTabSet()
    if (!active) { openFile(path, true); return }
    const sets: TabSetNode[] = []
    model.visitNodes((n: Node) => { if (n.getType() === 'tabset') sets.push(n as TabSetNode) })
    const i = sets.indexOf(active)
    const target = sets.slice(i + 1)[0] ?? sets.slice(0, Math.max(0, i)).reverse()[0]
    let tab: TabNode | undefined
    if (target) {
      tab = target.getChildren().find((t) => DOC_COMPONENTS.has((t as TabNode).getComponent() ?? '') && (t as TabNode).getConfig()?.path === path) as TabNode | undefined
      if (tab) selectTab(tab)
      else tab = model.doAction(Actions.addNode(tabJson(path), target.getId(), DockLocation.CENTER, -1, true)) as TabNode | undefined
    } else {
      tab = model.doAction(Actions.addNode(tabJson(path), active.getId(), DockLocation.RIGHT, -1, true)) as TabNode | undefined
    }
    if (tab) {
      const parent = tab.getParent()
      if (parent?.getType() === 'tabset') model.doAction(Actions.setActiveTabset(parent.getId()))
      focusTabPane(tab.getId(), 25)
    }
  }, [model, activeTabSet, openFile, selectTab, p.layoutId])

  const splitActive = useCallback(() => {
    const path = activePath()
    const ts = activeTabSet()
    if (!path || !ts) return
    model.doAction(Actions.addNode(tabJson(path), ts.getId(), DockLocation.RIGHT, -1, true))
  }, [model, activePath, activeTabSet])

  const saveActive = useCallback(() => {
    const path = activePath()
    if (path) void store.save(path)
  }, [activePath])

  // ---- 탭 · 패널 키보드 명령
  const cycleTab = useCallback((delta: number) => {
    const ts = activeTabSet()
    if (!ts) return
    const children = ts.getChildren()
    if (!children.length) return
    const i = ts.getSelected() ?? 0
    const next = children[(i + delta + children.length) % children.length] as TabNode
    model.doAction(Actions.selectTab(next.getId()))
    focusTabPane(next.getId())
  }, [model, activeTabSet])

  const selectTabIndex = useCallback((i: number) => {
    const ts = activeTabSet()
    const tab = ts?.getChildren()[i] as TabNode | undefined
    if (!tab) return
    model.doAction(Actions.selectTab(tab.getId()))
    focusTabPane(tab.getId())
  }, [model, activeTabSet])

  /** 이 탭을 닫으면 버려지는 저장 안 한 문서의 경로. 같은 문서를 보는 마지막 탭일 때만 — 그냥 닫아도 되면 null */
  const unsavedOnClose = useCallback((id: string): string | null => {
    const node = model.getNodeById(id) as TabNode | undefined
    const comp = node?.getComponent() ?? ''
    const path = node?.getConfig()?.path as string | undefined
    if (!path || !DOC_COMPONENTS.has(comp) || !store.isDirty(path)) return null
    const others = findTabs(model, (cfg, c) => DOC_COMPONENTS.has(c) && cfg.path === path).length
    return others > 1 ? null : path
  }, [model])

  /**
   * 탭 닫기. 저장 안 한 변경을 버리게 되면 먼저 묻는다 (앱 대화상자 — 답을 기다리는 동안 탭이 없어졌을 수 있어 다시 찾는다).
   * model.doAction 은 Layout 의 onAction 을 거치지 않으므로 Alt+W · 팔레트 · 탭의 × 모두 여기로 온다 (TC-904)
   */
  const closeTab = useCallback(async (id: string) => {
    const path = unsavedOnClose(id)
    if (path) {
      const ok = await askConfirm({
        title: '저장하지 않은 변경',
        message: `"${path}" 에 저장하지 않은 변경이 있습니다. 버리고 닫을까요?`,
        okLabel: '버리고 닫기',
        danger: true,
      })
      if (!ok) return
    }
    if (model.getNodeById(id)) model.doAction(Actions.deleteTab(id))
  }, [model, unsavedOnClose])

  const closeActive = useCallback(() => {
    const tab = activeTab()
    if (tab) void closeTab(tab.getId())
  }, [activeTab, closeTab])

  /** 다른 탭 닫기 — 같은 탭 묶음에서 활성 탭만 남긴다. 저장 안 한 탭은 하나씩 묻는다 (취소하면 그 탭은 남는다) */
  const closeOthers = useCallback(async () => {
    const tab = activeTab()
    const ts = activeTabSet()
    if (!tab || !ts) return
    for (const t of [...ts.getChildren()] as TabNode[]) if (t !== tab) await closeTab(t.getId())
    if (model.getNodeById(tab.getId())) { selectTab(tab); focusTabPane(tab.getId()) }
  }, [activeTab, activeTabSet, closeTab, model, selectTab])

  /** 패널을 접거나 편다. show=true 면 펴기만. 이미 열려 있었으면 true */
  const toggleBorder = useCallback((component: string, show = false): boolean => {
    const hit = findBorder(model, component)
    if (!hit) return false
    const isOpen = hit.border.getSelected() >= 0
    if (show && isOpen) return true
    model.doAction(Actions.selectTab(hit.tab.getId()))
    return isOpen
  }, [model])

  const focusPanel = useCallback((component: string, selector: string) => {
    // 이미 펴져 있으면 바로, 아니면 그려진 뒤에
    if (toggleBorder(component, true)) document.querySelector<HTMLElement>(selector)?.focus()
    else focusLater(selector)
  }, [toggleBorder])
  const focusTree = useCallback(() => focusPanel('tree', '[data-focus-target="tree"]'), [focusPanel])
  /**
   * 문서 창으로 포커스. 활성 탭 묶음이 비었으면 문서가 있는 다른 묶음으로 간다.
   * 문서 탭이 하나도 없으면 포커스가 body 에 남지 않게 트리로 (접혀 있으면 억지로 펴지 않고 빈 화면 안내로) — DESIGN §24.7 X3
   */
  const focusEditor = useCallback(() => {
    const docTab = (t: Node | undefined) => (t && DOC_COMPONENTS.has((t as TabNode).getComponent() ?? '') ? (t as TabNode) : undefined)
    const tab = docTab(activeTab())
    if (tab) { focusTabPane(tab.getId()); return }
    let other: TabSetNode | undefined
    model.visitNodes((n: Node) => { if (!other && n.getType() === 'tabset' && docTab((n as TabSetNode).getSelectedNode())) other = n as TabSetNode })
    const otherTab = docTab(other?.getSelectedNode())
    if (other && otherTab) {
      model.doAction(Actions.setActiveTabset(other.getId()))
      focusTabPane(otherTab.getId())
      return
    }
    const treeOpen = (findBorder(model, 'tree')?.border.getSelected() ?? -1) >= 0
    focusLater(treeOpen ? '[data-focus-target="tree"]' : '[data-focus-target="empty"]')
  }, [activeTab, model])

  /** 경로 막대로 포커스 (Ctrl+Shift+., DESIGN §31) — 활성 문서 창의 막대, 마지막 단계(제목 · 열)에 */
  const focusPathBar = useCallback(() => {
    const tab = activeTab()
    if (!tab || !DOC_COMPONENTS.has(tab.getComponent() ?? '')) { focusEditor(); return }
    const seg = [...document.querySelectorAll<HTMLElement>(`[data-tab-id="${tab.getId()}"] .path-seg[tabindex="0"]`)].find((el) => el.offsetParent !== null)
    seg?.focus()
  }, [activeTab, focusEditor])

  /**
   * 마지막 저장 상태로 되돌리기 (DESIGN §34). 묻지 않는다 — Ctrl+Z 한 번으로 다시 고친 상태로 간다.
   * 글 문서는 활성 탭의 편집기에서 트랜잭션으로 (같은 문서가 두 창에 열려 있어도 되돌리기 기록은 이 창에 남는다)
   */
  const canRevert = useCallback(() => {
    const path = activePath()
    const d = path ? store.get(path) : undefined
    return !!path && !!d && d.status === 'ready' && !d.conflict && !d.saving && store.isDirty(path)
  }, [activePath])
  const revertActive = useCallback(() => {
    const tab = activeTab()
    const path = activePath()
    if (!tab || !path) return
    let done = false
    if (isTsvPath(path)) done = store.revertTable(path)
    else {
      const el = document.querySelector<HTMLElement>(`[data-tab-id="${tab.getId()}"] .cm-editor`)
      const view = el ? EditorView.findFromDOM(el) : null
      done = !!view && revertTextInView(view, path)
    }
    if (done) notify(`마지막 저장 상태로 되돌렸습니다 — Ctrl+Z 로 고친 내용으로 다시 돌아갑니다`, { key: `revert:${path}` })
    focusTabPane(tab.getId())
  }, [activeTab, activePath])

  /** F6 / Shift+F6 — 파일 트리(펴져 있을 때) → 문서가 있는 탭 묶음들 순서로 포커스를 돌린다 */
  const cyclePane = useCallback((delta: number) => {
    const tabsets: TabSetNode[] = []
    model.visitNodes((n: Node) => { if (n.getType() === 'tabset' && (n as TabSetNode).getChildren().length) tabsets.push(n as TabSetNode) })
    const treeOpen = (findBorder(model, 'tree')?.border.getSelected() ?? -1) >= 0
    const zones: Array<'tree' | TabSetNode> = [...(treeOpen ? ['tree' as const] : []), ...tabsets]
    if (zones.length < 2) return
    // 지금 포커스가 있는 영역 (없으면 활성 탭 묶음)
    const ae = document.activeElement as HTMLElement | null
    let cur = -1
    if (ae?.closest('.tree')) cur = zones.indexOf('tree')
    else {
      const tabId = ae?.closest<HTMLElement>('[data-tab-id]')?.dataset.tabId
      const parent = tabId ? model.getNodeById(tabId)?.getParent() : model.getActiveTabset()
      cur = zones.findIndex((z) => z !== 'tree' && z === parent)
    }
    const next = zones[(cur < 0 ? (delta > 0 ? 0 : zones.length - 1) : (cur + delta + zones.length) % zones.length)]
    if (next === 'tree') { focusTree(); return }
    model.doAction(Actions.setActiveTabset(next.getId()))
    const tab = next.getSelectedNode()
    if (tab) focusTabPane(tab.getId())
  }, [model, focusTree])

  /** 다른 창으로 포커스 — 직전 창 (Ctrl+Alt+O, DESIGN §57). 문서 창(탭 묶음)에 포커스가 들어올 때마다 적는다 — 클릭 · F6 · 탭 이동 모두 */
  const paneTrack = useRef<PaneFocusTrack>(EMPTY_TRACK)
  useEffect(() => {
    const onFocus = (e: FocusEvent) => {
      const tabId = (e.target instanceof Element ? e.target : null)?.closest<HTMLElement>('[data-tab-id]')?.dataset.tabId
      const node = tabId ? model.getNodeById(tabId) : undefined
      if (!(node instanceof TabNode) || !DOC_COMPONENTS.has(node.getComponent() ?? '')) return
      const parent = node.getParent()
      if (parent instanceof TabSetNode) paneTrack.current = notePaneFocus(paneTrack.current, parent.getId())
    }
    document.addEventListener('focusin', onFocus)
    return () => document.removeEventListener('focusin', onFocus)
  }, [model])
  const focusOtherPane = useCallback(() => {
    // 문서가 열린 탭 묶음들 (화면 순서)
    const open: string[] = []
    model.visitNodes((n: Node) => {
      if (!(n instanceof TabSetNode)) return
      const sel = n.getSelectedNode()
      if (sel instanceof TabNode && DOC_COMPONENTS.has(sel.getComponent() ?? '')) open.push(n.getId())
    })
    const tabId = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>('[data-tab-id]')?.dataset.tabId
    const focused = (tabId ? model.getNodeById(tabId)?.getParent()?.getId() : null) ?? null
    const target = otherPaneTarget(paneTrack.current, focused, open)
    const ts = target ? model.getNodeById(target) : undefined
    const tab = ts instanceof TabSetNode ? ts.getSelectedNode() : undefined
    if (!target || !tab) { notify('옮겨 갈 다른 문서 창이 없습니다 — 오른쪽에 분할은 Ctrl+\\', { key: 'otherPane' }); return }
    dismissNotice('otherPane')
    model.doAction(Actions.setActiveTabset(target))
    focusTabPane(tab.getId())
  }, [model])

  useEffect(() => registerCommands([
    { id: 'split', label: '오른쪽에 분할', run: splitActive, enabled: () => activePath() !== null },
    { id: 'nextTab', label: '다음 탭', run: () => cycleTab(1) },
    { id: 'prevTab', label: '이전 탭', run: () => cycleTab(-1) },
    ...Array.from({ length: 9 }, (_, i) => ({ id: `tab${i + 1}`, label: `${i + 1}번째 탭`, hidden: true, run: () => selectTabIndex(i) })),
    { id: 'closeTab', label: '탭 닫기', run: closeActive },
    { id: 'closeOtherTabs', label: '다른 탭 닫기 (같은 탭 묶음에서 이 탭만 남긴다)', run: () => void closeOthers(), enabled: () => (activeTabSet()?.getChildren().length ?? 0) > 1 },
    // 커서 · 포커스의 문서 링크 · tsv-view (맥락 메뉴 · DESIGN §40) — 미리보기의 링크에 포커스가 있으면 그것, 아니면 마지막 마크다운 편집기의 커서
    { id: 'openLinkAtCursor', label: '커서의 링크 열기 (문서 링크)', run: () => { const t = currentLink(); if (t) openFile(t, true) }, enabled: () => currentLink() !== null },
    { id: 'openLinkAtCursorSide', label: '커서의 링크를 오른쪽 창에 열기', run: () => { const t = currentLink(); if (t) openFileSide(t) }, enabled: () => currentLink() !== null },
    { id: 'openTsvViewGrid', label: 'tsv-view 의 표를 그리드로 열기 (커서의 tsv-view 펜스 · 고른 셀)', run: () => { const t = currentTsvView(); if (t) openFile(t, true) }, enabled: () => currentTsvView() !== null },
    // 트리에 포커스가 있을 때 접으면 포커스가 body 로 빠진다 — 문서 창(없으면 빈 화면 안내)으로 보낸다
    { id: 'toggleTree', label: '파일 트리 접기 / 펴기', run: () => { toggleBorder('tree'); window.setTimeout(() => { const ae = document.activeElement as HTMLElement | null; if (!ae || ae === document.body || ae.offsetParent === null) focusEditor() }, 60) } },
    { id: 'focusTree', label: '파일 트리로 포커스', run: focusTree },
    { id: 'navBack', label: '뒤로 — 앞에 있던 문서 · 자리로 (파일 열기 · 탭 · 제목 이동을 되짚는다)', run: () => goNav(-1), enabled: () => navCan(navHistory(), -1) },
    { id: 'navForward', label: '앞으로 — 뒤로 오기 전의 문서 · 자리로', run: () => goNav(1), enabled: () => navCan(navHistory(), 1) },
    { id: 'openTreeCursorSide', label: '파일 트리 커서의 파일을 오른쪽 창에 열기', run: requestTreeOpenSide },
    { id: 'treeFilter', label: '파일 트리: 이름으로 거르기 (트리 위 필터 칸)', run: () => { focusTree(); requestTreeFilter('focus') } },
    { id: 'treeFilterDirty', label: '파일 트리: 저장 안 한 것만 보기 켜기 / 끄기', run: () => { focusTree(); requestTreeFilter('dirty') } },
    { id: 'quickLook', label: '훑어보기 (파일 트리 커서의 항목)', run: () => { focusTree(); requestQuickLook() } },
    { id: 'quickLookFolder', label: '폴더 훑어보기 (파일 트리에서 고른 폴더의 썸네일 격자)', run: () => { focusTree(); requestQuickLook('folder') } },
    // 폴더 격자의 보기 · 정렬 (DESIGN §51) — 격자 안의 Ctrl+Shift+V 는 격자가 받는다. 팔레트에서는 다음에 열 때부터
    { id: 'folderViewToggle', label: '폴더 격자: 격자 ↔ 목록 보기 (목록은 이름 · 수정 시각 · 크기)', run: () => { const v = toggleFolderView(); notify(v === 'list' ? '폴더 격자를 목록으로 봅니다' : '폴더 격자를 썸네일 격자로 봅니다', { key: 'folderView' }) } },
    { id: 'folderSortName', label: '폴더 격자: 이름 순서로', run: () => { setFolderSort('name'); notify('폴더 격자를 이름 순서로 봅니다', { key: 'folderView' }) }, enabled: () => folderPrefs().sort !== 'name' },
    { id: 'folderSortTime', label: '폴더 격자: 수정 시각 순서로 (오늘 · 어제 · 지난 7일 · 그 전)', run: () => { setFolderSort('time'); notify('폴더 격자를 수정 시각 순서로 봅니다', { key: 'folderView' }) }, enabled: () => folderPrefs().sort !== 'time' },
    { id: 'quickLookReset', label: '훑어보기 창 크기 · 배율 처음으로', run: () => { resetLookPrefs(); notify('훑어보기 창의 크기와 배율을 처음으로 되돌렸습니다') }, enabled: () => !isLookDefault() },
    { id: 'focusEditor', label: '문서 창으로 포커스', run: focusEditor },
    { id: 'revertToSaved', label: '마지막 저장 상태로 되돌리기 — 저장 안 한 수정 버림 (Ctrl+Z 로 다시)', run: revertActive, enabled: canRevert },
    { id: 'focusPathBar', label: '경로 막대로 포커스 (폴더 · 파일 · 제목 · 열 목록)', run: focusPathBar, enabled: () => activePath() !== null },
    { id: 'nextPane', label: '다음 영역으로 포커스 (파일 트리 → 탭 묶음)', run: () => cyclePane(1) },
    { id: 'prevPane', label: '이전 영역으로 포커스', run: () => cyclePane(-1) },
    { id: 'focusOtherPane', label: '다른 창으로 포커스 (직전 창) — 다시 하면 돌아온다', run: focusOtherPane },
    { id: 'cycleMdMode', label: '마크다운 보기 모드 순환 (소스 → 하이브리드 → 분할 → 미리보기)', run: () => { const path = activePath(); if (path && isMarkdownPath(path)) paneAction(path, 'cycleMdMode') }, enabled: () => { const path = activePath(); return !!path && isMarkdownPath(path) } },
    { id: 'formatJson', label: 'JSON 정렬 (들여쓰기 2칸)', run: () => { const path = activePath(); if (path && fileTypeOf(path)?.lang === 'json') paneAction(path, 'formatJson') }, enabled: () => { const path = activePath(); return !!path && fileTypeOf(path)?.lang === 'json' && !store.isReadOnly(path) } },
    { id: 'calc', label: '계산식 적용 — _Calc.tsv 의 결과를 표에 써 넣기', run: () => { const path = activePath(); if (path && isTsvPath(path)) paneAction(path, 'calc') }, enabled: () => { const path = activePath(); return !!path && isTsvPath(path) } },
    { id: 'toggleSkim', label: '훑어보기 패널 켜기 / 끄기', run: toggleSkim },
    { id: 'focusOutline', label: '목차로 포커스 (마크다운 · 하이브리드 모드, 꺼져 있으면 켠다)', run: () => { const path = activePath(); if (path && isMarkdownPath(path)) paneAction(path, 'focusOutline') }, enabled: () => { const path = activePath(); return !!path && isMarkdownPath(path) } },
    { id: 'toggleOutline', label: '목차 보이기 / 숨기기 (마크다운 · 하이브리드 모드)', run: () => { setOutlineOn(!outlineOn()); notify(outlineOn() ? '목차를 켰습니다 — 마크다운의 하이브리드 모드에서 보입니다' : '목차를 껐습니다', { key: 'outline' }) } },
    { id: 'skimWider', label: '훑어보기 패널 넓히기', run: () => nudgeSkimPanelWidth(SKIM_WIDTH_BIG_STEP), enabled: () => skimPanelState().on },
    { id: 'skimNarrower', label: '훑어보기 패널 좁히기', run: () => nudgeSkimPanelWidth(-SKIM_WIDTH_BIG_STEP), enabled: () => skimPanelState().on },
    // 마크다운 표 (DESIGN §23 H9) — 마지막으로 쓴 마크다운 편집기의 표 칸 · 커서 기준. 키는 그 편집기가 직접 받는다
    ...MD_TABLE_COMMANDS.map(([id, op, label, keys]) => ({
      id, label, keys,
      run: () => { const msg = runTableCommand(op); if (msg) notify(msg, { key: 'mdTable' }) },
      enabled: () => { const path = activePath(); return !!path && isMarkdownPath(path) && !store.isReadOnly(path) },
    })),
    { id: 'refreshSkim', label: '훑어보기 패널 새로 고침 (큰 문서는 자동으로 다시 그리지 않는다)', run: refreshSkimPanels, enabled: () => skimPanelState().on },
  ]), [splitActive, activePath, cycleTab, selectTabIndex, closeActive, closeOthers, activeTabSet, openFile, openFileSide, toggleBorder, focusTree, focusEditor, focusPathBar, revertActive, canRevert, cyclePane, focusOtherPane, toggleSkim, goNav])

  // 상태 줄 (DESIGN §32): 선택 요약에 보일 계산 켜고 끄기 · UTF-8 로 바꿔 저장. 이름이 지금 상태를 따라가게 다시 등록한다
  const summaryKeys = useSummaryKeys()
  const invOn = useInvisibles()
  const syncOn = useScrollSync()
  useEffect(() => registerCommands([
    ...SUMMARY_KEYS.map((k) => ({
      id: `selSummary:${k}`,
      label: `선택 요약: ${SUMMARY_LABELS[k]} ${summaryKeys.includes(k) ? '숨기기' : '보이기'} (그리드 상태 줄)`,
      run: () => toggleSummaryKey(k),
    })),
    {
      id: 'convertUtf8',
      label: 'UTF-8 로 바꿔 저장 (UTF-8 이 아닌 현재 문서)',
      run: () => { const path = activePath(); if (path) void confirmConvertToUtf8(path) },
      enabled: () => { const path = activePath(); const d = path ? store.get(path) : undefined; return !!d && d.status === 'ready' && d.encoding !== 'utf-8' },
    },
    // 보이지 않는 문자 보이기 (DESIGN §55) — 앱 전체에 하나, 기본은 꺼짐
    { id: 'toggleInvisibles', label: `보이지 않는 문자 ${invisiblesOn() ? '숨기기' : '보이기'} (공백 · · 탭 → · 줄 끝 ↵, 표는 셀 앞뒤 공백)`, run: () => { const on = toggleInvisibles(); notify(on ? '보이지 않는 문자를 보입니다 — 공백 · · 탭 → · 줄 끝 ↵' : '보이지 않는 문자를 숨깁니다', { key: 'invisibles' }) } },
    // 분할 보기 스크롤 맞추기 (DESIGN §56) — 앱 전체에 하나, 기본 켜짐
    { id: 'splitScrollSync', label: `분할 보기: 스크롤 맞추기 ${scrollSyncOn() ? '끄기' : '켜기'} (마크다운 분할 모드에서 소스 ↔ 미리보기)`, run: () => { const on = toggleScrollSync(); notify(on ? '분할 보기에서 소스와 미리보기의 스크롤을 맞춥니다' : '분할 보기에서 소스와 미리보기를 따로 스크롤합니다', { key: 'scrollSync' }) } },
    // 다른 인코딩으로 다시 열기 (DESIGN §55) — UTF-8 이 아닌 현재 문서. 화면만 바뀐다
    ...REOPEN_ENCODINGS.map((c) => ({
      id: `reopenEncoding:${c.id}`,
      label: `다른 인코딩으로 다시 열기: ${c.label}`,
      run: () => { const path = activePath(); if (path) void reopenAs(path, c.id) },
      enabled: () => { const path = activePath(); const d = path ? store.get(path) : undefined; return !!d && d.status === 'ready' && d.encoding !== 'utf-8' && d.encoding !== c.id && !store.isDirty(path!) },
    })),
  ]), [summaryKeys, activePath, invOn, syncOn])

  // 창 막대 단추의 팔레트 명령 (DESIGN §36) — 활성 탭의 창 하나에만 보낸다. 충돌 배너의 두 선택도 팔레트에
  useEffect(() => {
    const activeOf = (scope: PaneScope) => {
      const path = activePath()
      if (!path) return null
      const kind = fileTypeOf(path)?.kind
      const ok = scope === 'grid' ? isTsvPath(path) : scope === 'md' ? isMarkdownPath(path) : kind === 'md' || kind === 'text'
      return ok ? path : null
    }
    const conflictPath = () => { const path = activePath(); return path && store.get(path)?.conflict ? path : null }
    return registerCommands([
      ...PANE_COMMANDS.map((c) => ({
        id: c.id,
        label: c.label,
        run: () => { const tab = activeTab(); if (tab && activeOf(c.scope)) sendToPane(tab.getId(), c.id) },
        enabled: () => { const path = activeOf(c.scope); return !!path && (!c.edits || !store.isReadOnly(path)) },
      })),
      { id: 'conflictTakeDisk', label: '충돌: 디스크 내용 받기 (내 수정 버림)', run: () => { const p = conflictPath(); if (p) store.takeDisk(p) }, enabled: () => !!conflictPath() },
      { id: 'conflictOverwrite', label: '충돌: 내 내용으로 덮어쓰기', run: () => { const p = conflictPath(); if (p) void store.overwrite(p) }, enabled: () => !!conflictPath() },
    ])
  }, [activePath, activeTab])

  const renamePaths = useCallback((from: string, to: string, isDir: boolean) => {
    noteRename(from, to)
    if (prevDoc.current === from) prevDoc.current = to
    const prefix = from + '/'
    for (const tab of findTabs(model, () => true)) {
      const cfg = (tab.getConfig() ?? {}) as Record<string, unknown>
      const path = cfg.path as string | undefined
      if (!path) continue
      let next: string | null = null
      if (path === from) next = to
      else if (isDir && path.startsWith(prefix)) next = to + '/' + path.slice(prefix.length)
      if (next === null) continue
      model.doAction(Actions.updateNodeAttributes(tab.getId(), { name: baseName(next), config: { ...cfg, path: next } }))
    }
  }, [model])

  const closePaths = useCallback((path: string, isDir: boolean) => {
    const prefix = path + '/'
    for (const tab of findTabs(model, (cfg) => cfg.path === path || (isDir && typeof cfg.path === 'string' && cfg.path.startsWith(prefix)))) {
      model.doAction(Actions.deleteTab(tab.getId()))
    }
  }, [model])

  const openPaths = useCallback(() => {
    const out = new Set<string>()
    for (const tab of findTabs(model, (cfg) => typeof cfg.path === 'string')) out.add(((tab.getConfig() ?? {}) as Record<string, string>).path)
    return [...out]
  }, [model])

  useImperativeHandle(ref, () => ({ openFile, saveActive, activePath, renamePaths, closePaths, openPaths, openFileSide }), [openFile, saveActive, activePath, renamePaths, closePaths, openPaths, openFileSide])

  const factory = (node: TabNode) => {
    const cfg = (node.getConfig() ?? {}) as Record<string, unknown>
    switch (node.getComponent()) {
      case 'tree':
        return (
          <FileTree
            stateKey={p.layoutId}
            entries={p.tree}
            activePath={activeDoc}
            dirtyPaths={dirtyPaths}
            onOpen={openFile}
            onOpenSide={openFileSide}
            onRefresh={p.onRefresh}
            onNewFile={p.onNewFile}
            onNewFolder={p.onNewFolder}
            onRename={p.onRename}
            onDelete={p.onDelete}
            onRootAction={p.onRootAction}
            onSelectDir={p.onSelectDir}
          />
        )
      case 'md':
      case 'tsv': {
        // 저장된 레이아웃에는 예전 이름(md)이 남아 있을 수 있으니 확장자로 고른다
        const path = cfg.path as string
        // display: contents — 레이아웃엔 영향이 없고, 이 탭의 창을 DOM 에서 찾을 이름표만 준다 (F6 · 탭 이동 포커스)
        return (
          <div data-tab-id={node.getId()} style={{ display: 'contents' }}>
            {isTsvPath(path) ? <GridPane path={path} onSplit={splitActive} /> : <MarkdownPane path={path} onSplit={splitActive} />}
          </div>
        )
      }
      default:
        return <div className="pane-empty">알 수 없는 창: {node.getComponent()}</div>
    }
  }

  const onRenderTab = (node: TabNode, values: ITabRenderValues) => {
    const comp = node.getComponent() ?? ''
    const path = node.getConfig()?.path as string | undefined
    if (!path || !DOC_COMPONENTS.has(comp)) return
    if (dirtyPaths.has(path)) values.content = <span>{node.getName()}<span className="dirty-dot"> ●</span></span>
  }

  const docTabs = () => findTabs(model, (_cfg, comp) => DOC_COMPONENTS.has(comp))

  // Layout 이 내는 동작 (마우스 · 탭 줄의 키보드). model.doAction 으로 부른 것은 여기를 거치지 않는다
  const onAction = (action: Action): Action | undefined => {
    // 탭의 ×. 물어야 하면 이 동작은 막고, 답을 받은 뒤 closeTab 이 직접 닫는다
    if (action.type === Actions.DELETE_TAB) {
      const id = action.data.node as string
      if (unsavedOnClose(id)) { void closeTab(id); return undefined }
    }
    // 탭을 골랐으면 (제목 클릭 · 넘친 탭 목록 · 탭 줄에서 Enter) 그 창으로 포커스 — 탭 이동 명령과 같은 결과 (DESIGN §24.7 X1)
    if (action.type === Actions.SELECT_TAB) {
      const id = action.data.tabNode as string
      if (docTabs().some((t) => t.getId() === id)) focusTabPane(id)
    }
    return action
  }

  /**
   * 이미 골라져 있는 탭의 제목을 누르면 Layout 은 아무 동작도 내지 않는다 — 클릭을 직접 받아 그 창으로 포커스를 준다.
   * 끌어 옮기기는 click 을 내지 않으므로 건드리지 않는다. × 는 닫기라 뺀다.
   */
  const onLayoutClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement
    const button = target.closest<HTMLElement>('[id^="flexlayout-tabbutton-"]')
    if (!button || target.closest('.flexlayout__tab_button_trailing')) return
    const tab = docTabs().find((t) => tabButtonId(t.getId()) === button.id)
    if (tab) focusTabPane(tab.getId())
  }

  // 탭 제목의 맥락 메뉴 자리 (DESIGN §40). 오른쪽 클릭한 탭을 먼저 고른다 — 메뉴의 명령은 활성 탭에 돈다
  const wrap = useRef<HTMLDivElement>(null)
  const tabSpot = useRef<SpotReader>(() => null)
  tabSpot.current = (target, point): TabSpot | null => {
    const button = target.closest<HTMLElement>('[id^="flexlayout-tabbutton-"]')
    if (!button) return null
    const tab = docTabs().find((t) => tabButtonId(t.getId()) === button.id)
    if (!tab) return null
    if (point) selectTab(tab)
    const r = button.getBoundingClientRect()
    return { zone: 'tab', title: tab.getName(), anchor: { x: r.left + 8, y: r.bottom + 2 }, path: (tab.getConfig()?.path as string | undefined) ?? null }
  }
  useEffect(() => {
    const el = wrap.current
    return el ? registerSpotReader(el, (t, pt) => tabSpot.current(t, pt)) : undefined
  }, [])

  const onModelChange = (m: Model, action: Action) => {
    try { localStorage.setItem(layoutKey(p.layoutId), JSON.stringify(m.toJson())) } catch { /* 저장 못 해도 동작엔 지장 없음 */ }
    setActiveDoc(activePath())
    setPaneCount(countDocPanes(m))
    // 탭이 닫히며 포커스가 있던 편집기 · 탭 버튼이 사라지면 body 로 빠진다 — 남은 문서 창으로, 없으면 트리로 (DESIGN §24.7 X3)
    if (action.type === Actions.DELETE_TAB) {
      window.setTimeout(() => {
        if (dialogOpen()) return // 대화상자가 닫히며 제 규칙대로 돌려준다
        const ae = document.activeElement
        if (!ae || ae === document.body || !ae.isConnected) runCommand('focusEditor')
      }, 60)
    }
  }

  /** 문서 탭이 하나도 없는 탭 묶음에 보이는 안내. 단축키는 표에서 가져온다 (하드코딩하지 않는다) */
  const emptyPane = () => (
    <div className="empty-pane" tabIndex={0} data-focus-target="empty" aria-label="열린 문서 없음">
      <p className="empty-pane-title">열린 문서가 없습니다</p>
      <ul>
        <li><button onClick={() => runCommand('newFile')}>새 문서</button><kbd>{keysOf('newFile')}</kbd><span>빈 문서 · 예시 · 내 템플릿에서</span></li>
        <li><button onClick={() => runCommand('focusTree')}>파일 트리</button><kbd>{keysOf('focusTree')}</kbd><span>에서 파일을 골라 <kbd>Enter</kbd></span></li>
        <li><button onClick={() => runCommand('fileSearch')}>파일 검색</button><kbd>{keysOf('fileSearch')}</kbd></li>
        <li><button onClick={() => runCommand('palette')}>명령 팔레트</button><kbd>{keysOf('palette')}</kbd><span>모든 명령</span></li>
        <li><button onClick={() => runCommand('help')}>단축키 도움말</button><kbd>{keysOf('help')}</kbd></li>
      </ul>
    </div>
  )

  // display: contents — 레이아웃엔 영향이 없고 탭 제목 클릭만 받는다
  return (
    <div ref={wrap} style={{ display: 'contents' }} onClick={onLayoutClick}>
      <DocPaneCountContext.Provider value={paneCount}>
        <Layout
          model={model}
          factory={factory}
          onRenderTab={onRenderTab}
          onAction={onAction}
          onModelChange={onModelChange}
          onTabSetPlaceHolder={emptyPane}
        />
      </DocPaneCountContext.Provider>
    </div>
  )
})
