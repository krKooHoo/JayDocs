import { forwardRef, useCallback, useEffect, useImperativeHandle, useState } from 'react'
import { Actions, DockLocation, Layout, Model, TabNode, TabSetNode, type Action, type BorderNode, type IJsonModel, type ITabRenderValues, type Node } from 'flexlayout-react'
import type { TreeEntry } from '../lib/backend'
import { registerCommands } from '../lib/commands'
import { paneAction, setOpener } from '../lib/nav'
import { isTsvPath, store, useStoreVersion } from '../store/documents'
import { isMarkdownPath } from '../lib/cm'
import { fileTypeOf } from '../lib/filetypes.mjs'
import { FileTree, type RootAction } from './FileTree'
import { MarkdownPane } from './MarkdownPane'
import { GridPane } from './grid/GridPane'

export interface WorkbenchHandle {
  openFile(path: string): void
  splitActive(): void
  saveActive(): void
  activePath(): string | null
  /** 파일·폴더 이름이 바뀌면 열린 탭의 경로를 따라 바꾼다 */
  renamePaths(from: string, to: string, isDir: boolean): void
  /** 파일·폴더가 지워지면 그 탭들을 닫는다 */
  closePaths(path: string, isDir: boolean): void
  /** 열린 문서 탭의 경로들 */
  openPaths(): string[]
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

const DOC_COMPONENTS = new Set(['md', 'tsv'])

export const Workbench = forwardRef<WorkbenchHandle, Props>(function Workbench(p, ref) {
  useStoreVersion()
  const [model] = useState(() => loadModel(p.layoutId))

  const activeTabSet = useCallback(() => model.getActiveTabset() ?? firstTabSet(model), [model])
  const activeTab = useCallback(() => activeTabSet()?.getSelectedNode() as TabNode | undefined, [activeTabSet])
  const activePath = useCallback(() => {
    const tab = activeTab()
    if (!tab || !DOC_COMPONENTS.has(tab.getComponent() ?? '')) return null
    return (tab.getConfig()?.path as string | undefined) ?? null
  }, [activeTab])

  const selectTab = useCallback((tab: TabNode) => {
    model.doAction(Actions.selectTab(tab.getId()))
    const parent = tab.getParent()
    if (parent && parent.getType() === 'tabset') model.doAction(Actions.setActiveTabset(parent.getId()))
  }, [model])

  const addTab = useCallback((json: Record<string, unknown>) => {
    const ts = activeTabSet()
    if (!ts) return
    model.doAction(Actions.addNode(json, ts.getId(), DockLocation.CENTER, -1, true))
  }, [model, activeTabSet])

  const openFile = useCallback((path: string) => {
    const existing = findTabs(model, (cfg, comp) => DOC_COMPONENTS.has(comp) && cfg.path === path)
    if (existing.length) { selectTab(existing[0]); return }
    addTab(tabJson(path))
  }, [model, selectTab, addTab])

  useEffect(() => {
    setOpener(openFile)
    return () => setOpener(null)
  }, [openFile])

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
    paneAction((next.getConfig()?.path as string) ?? '', 'focus')
  }, [model, activeTabSet])

  const selectTabIndex = useCallback((i: number) => {
    const ts = activeTabSet()
    const tab = ts?.getChildren()[i] as TabNode | undefined
    if (!tab) return
    model.doAction(Actions.selectTab(tab.getId()))
    paneAction((tab.getConfig()?.path as string) ?? '', 'focus')
  }, [model, activeTabSet])

  /** 같은 문서를 보는 마지막 탭을 닫을 때만 저장 여부를 묻는다. 닫아도 되면 true */
  const confirmCloseTab = useCallback((id: string): boolean => {
    const node = model.getNodeById(id) as TabNode | undefined
    const comp = node?.getComponent() ?? ''
    const path = node?.getConfig()?.path as string | undefined
    if (!path || !DOC_COMPONENTS.has(comp) || !store.isDirty(path)) return true
    const others = findTabs(model, (cfg, c) => DOC_COMPONENTS.has(c) && cfg.path === path).length
    return others > 1 || window.confirm(`"${path}" 에 저장하지 않은 변경이 있습니다. 버리고 닫을까요?`)
  }, [model])

  const closeActive = useCallback(() => {
    const tab = activeTab()
    // model.doAction 은 Layout 의 onAction 을 거치지 않으므로 저장 확인을 여기서 한다 (TC-904)
    if (tab && confirmCloseTab(tab.getId())) model.doAction(Actions.deleteTab(tab.getId()))
  }, [model, activeTab, confirmCloseTab])

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
  const focusEditor = useCallback(() => { const path = activePath(); if (path) paneAction(path, 'focus') }, [activePath])

  useEffect(() => registerCommands([
    { id: 'split', label: '오른쪽에 분할', run: splitActive, enabled: () => activePath() !== null },
    { id: 'nextTab', label: '다음 탭', run: () => cycleTab(1) },
    { id: 'prevTab', label: '이전 탭', run: () => cycleTab(-1) },
    ...Array.from({ length: 9 }, (_, i) => ({ id: `tab${i + 1}`, label: `${i + 1}번째 탭`, hidden: true, run: () => selectTabIndex(i) })),
    { id: 'closeTab', label: '탭 닫기', run: closeActive },
    { id: 'toggleTree', label: '파일 트리 접기 / 펴기', run: () => toggleBorder('tree') },
    { id: 'focusTree', label: '파일 트리로 포커스', run: focusTree },
    { id: 'focusEditor', label: '문서 창으로 포커스', run: focusEditor },
    { id: 'cycleMdMode', label: '마크다운 보기 모드 순환 (소스 → 분할 → 미리보기)', run: () => { const path = activePath(); if (path && isMarkdownPath(path)) paneAction(path, 'cycleMdMode') }, enabled: () => { const path = activePath(); return !!path && isMarkdownPath(path) } },
    { id: 'formatJson', label: 'JSON 정렬 (들여쓰기 2칸)', run: () => { const path = activePath(); if (path && fileTypeOf(path)?.lang === 'json') paneAction(path, 'formatJson') }, enabled: () => { const path = activePath(); return !!path && fileTypeOf(path)?.lang === 'json' && !store.isReadOnly(path) } },
    { id: 'calc', label: '계산식 적용 — _Calc.tsv 의 결과를 표에 써 넣기', run: () => { const path = activePath(); if (path && isTsvPath(path)) paneAction(path, 'calc') }, enabled: () => { const path = activePath(); return !!path && isTsvPath(path) } },
  ]), [splitActive, activePath, cycleTab, selectTabIndex, closeActive, toggleBorder, focusTree, focusEditor])

  const renamePaths = useCallback((from: string, to: string, isDir: boolean) => {
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

  useImperativeHandle(ref, () => ({ openFile, splitActive, saveActive, activePath, renamePaths, closePaths, openPaths }), [openFile, splitActive, saveActive, activePath, renamePaths, closePaths, openPaths])

  const factory = (node: TabNode) => {
    const cfg = (node.getConfig() ?? {}) as Record<string, unknown>
    switch (node.getComponent()) {
      case 'tree':
        return (
          <FileTree
            entries={p.tree}
            activePath={activePath()}
            dirtyPaths={store.dirtyPaths()}
            onOpen={openFile}
            onRefresh={p.onRefresh}
            onNewFile={p.onNewFile}
            onNewFolder={p.onNewFolder}
            onRename={p.onRename}
            onDelete={p.onDelete}
            onRootAction={p.onRootAction}
          />
        )
      case 'md':
      case 'tsv': {
        // 저장된 레이아웃에는 예전 이름(md)이 남아 있을 수 있으니 확장자로 고른다
        const path = cfg.path as string
        return isTsvPath(path) ? <GridPane path={path} onSplit={splitActive} /> : <MarkdownPane path={path} onSplit={splitActive} />
      }
      default:
        return <div className="pane-empty">알 수 없는 창: {node.getComponent()}</div>
    }
  }

  const onRenderTab = (node: TabNode, values: ITabRenderValues) => {
    const comp = node.getComponent() ?? ''
    const path = node.getConfig()?.path as string | undefined
    if (!path || !DOC_COMPONENTS.has(comp)) return
    if (store.isDirty(path)) values.content = <span>{node.getName()}<span className="dirty-dot"> ●</span></span>
  }

  // 탭의 × (Layout 이 내는 동작)
  const onAction = (action: Action): Action | undefined => {
    if (action.type === Actions.DELETE_TAB && !confirmCloseTab(action.data.node as string)) return undefined
    return action
  }

  const onModelChange = (m: Model) => {
    try { localStorage.setItem(layoutKey(p.layoutId), JSON.stringify(m.toJson())) } catch { /* 저장 못 해도 동작엔 지장 없음 */ }
  }

  return (
    <Layout
      model={model}
      factory={factory}
      onRenderTab={onRenderTab}
      onAction={onAction}
      onModelChange={onModelChange}
    />
  )
})
