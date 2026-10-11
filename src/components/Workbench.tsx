import { forwardRef, useCallback, useImperativeHandle, useState } from 'react'
import { Actions, DockLocation, Layout, Model, TabNode, TabSetNode, type Action, type IJsonModel, type ITabRenderValues, type Node } from 'flexlayout-react'
import type { TreeEntry } from '../lib/backend'
import { store, useStoreVersion } from '../store/documents'
import { FileTree } from './FileTree'
import { MarkdownPane } from './MarkdownPane'

export interface WorkbenchHandle {
  openFile(path: string): void
  splitActive(): void
  saveActive(): void
  activePath(): string | null
}

interface Props {
  root: string
  tree: TreeEntry[]
  onRefresh: () => void
  onNewFile: (dir: string) => void
  onNewFolder: (dir: string) => void
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

function layoutKey(root: string) {
  return `jaydocs.layout.v${LAYOUT_VERSION}:${root}`
}

function loadModel(root: string): Model {
  try {
    const raw = localStorage.getItem(layoutKey(root))
    if (raw) return Model.fromJson(JSON.parse(raw) as IJsonModel)
  } catch { /* 깨진 저장분은 버린다 */ }
  return Model.fromJson(defaultLayout())
}

function tabJson(path: string) {
  return { type: 'tab', name: path.split('/').pop() ?? path, component: 'md', config: { path } }
}

function firstTabSet(model: Model): TabSetNode | undefined {
  let found: TabSetNode | undefined
  model.visitNodes((n: Node) => { if (!found && n.getType() === 'tabset') found = n as TabSetNode })
  return found
}

function findTabsByPath(model: Model, path: string): TabNode[] {
  const out: TabNode[] = []
  model.visitNodes((n: Node) => {
    if (n.getType() === 'tab' && (n as TabNode).getConfig()?.path === path) out.push(n as TabNode)
  })
  return out
}

export const Workbench = forwardRef<WorkbenchHandle, Props>(function Workbench(p, ref) {
  useStoreVersion()
  const [model] = useState(() => loadModel(p.root))

  const activeTabSet = useCallback(() => model.getActiveTabset() ?? firstTabSet(model), [model])
  const activeTab = useCallback(() => activeTabSet()?.getSelectedNode() as TabNode | undefined, [activeTabSet])
  const activePath = useCallback(() => (activeTab()?.getConfig()?.path as string | undefined) ?? null, [activeTab])

  const openFile = useCallback((path: string) => {
    const existing = findTabsByPath(model, path)
    if (existing.length) {
      const tab = existing[0]
      model.doAction(Actions.selectTab(tab.getId()))
      const parent = tab.getParent()
      if (parent && parent.getType() === 'tabset') model.doAction(Actions.setActiveTabset(parent.getId()))
      return
    }
    const ts = activeTabSet()
    if (!ts) return
    model.doAction(Actions.addNode(tabJson(path), ts.getId(), DockLocation.CENTER, -1, true))
  }, [model, activeTabSet])

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

  useImperativeHandle(ref, () => ({ openFile, splitActive, saveActive, activePath }), [openFile, splitActive, saveActive, activePath])

  const factory = (node: TabNode) => {
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
          />
        )
      case 'md':
        return <MarkdownPane path={node.getConfig().path as string} onSplit={splitActive} />
      default:
        return <div className="pane-empty">알 수 없는 창: {node.getComponent()}</div>
    }
  }

  const onRenderTab = (node: TabNode, values: ITabRenderValues) => {
    const path = node.getConfig()?.path as string | undefined
    if (path && store.isDirty(path)) {
      values.content = (
        <span>
          {node.getName()}
          <span className="dirty-dot"> ●</span>
        </span>
      )
    }
  }

  // 같은 문서를 보는 마지막 탭을 닫을 때만 저장 여부를 묻는다.
  const onAction = (action: Action): Action | undefined => {
    if (action.type === Actions.DELETE_TAB) {
      const node = model.getNodeById(action.data.node as string) as TabNode | undefined
      const path = node?.getConfig()?.path as string | undefined
      if (path && store.isDirty(path) && findTabsByPath(model, path).length === 1) {
        if (!window.confirm(`"${path}" 에 저장하지 않은 변경이 있습니다. 버리고 닫을까요?`)) return undefined
      }
    }
    return action
  }

  const onModelChange = (m: Model) => {
    try { localStorage.setItem(layoutKey(p.root), JSON.stringify(m.toJson())) } catch { /* 저장 못 해도 동작엔 지장 없음 */ }
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
