import { useEffect, useState } from 'react'
import type { TreeEntry } from '../lib/backend'

interface Props {
  entries: TreeEntry[]
  activePath: string | null
  dirtyPaths: Set<string>
  onOpen: (path: string) => void
  onNewFile: (dir: string) => void
  onNewFolder: (dir: string) => void
  onRefresh: () => void
}

function allDirs(entries: TreeEntry[], out: string[] = []) {
  for (const e of entries) if (e.type === 'dir') { out.push(e.path); allDirs(e.children ?? [], out) }
  return out
}

function fileIcon(name: string) {
  if (/\.tsv$/i.test(name)) return '⊞'
  if (/\.md$/i.test(name)) return '≡'
  return '·'
}

export function FileTree(p: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const [selectedDir, setSelectedDir] = useState('')
  const [initialized, setInitialized] = useState(false)

  // 처음 트리가 오면 전부 펼친다. 그 뒤로는 사용자가 접은 상태를 유지.
  useEffect(() => {
    if (!initialized && p.entries.length) { setExpanded(new Set(allDirs(p.entries))); setInitialized(true) }
  }, [p.entries, initialized])

  const toggle = (path: string) =>
    setExpanded((s) => { const n = new Set(s); if (n.has(path)) n.delete(path); else n.add(path); return n })

  const renderNodes = (entries: TreeEntry[], depth: number) =>
    entries.map((e) => {
      const indent = { paddingLeft: `${8 + depth * 14}px` }
      if (e.type === 'dir') {
        const open = expanded.has(e.path)
        return (
          <div key={e.path}>
            <div
              className={'tree-row is-dir' + (selectedDir === e.path ? ' is-selected' : '')}
              style={indent}
              onClick={() => { toggle(e.path); setSelectedDir(e.path) }}
            >
              <span className="tree-caret">{open ? '▾' : '▸'}</span>
              <span className="tree-name">{e.name}</span>
            </div>
            {open && renderNodes(e.children ?? [], depth + 1)}
          </div>
        )
      }
      const dirty = p.dirtyPaths.has(e.path)
      return (
        <div
          key={e.path}
          className={'tree-row is-file' + (p.activePath === e.path ? ' is-active' : '')}
          style={indent}
          title={e.path}
          onClick={() => { p.onOpen(e.path); setSelectedDir(e.path.includes('/') ? e.path.slice(0, e.path.lastIndexOf('/')) : '') }}
        >
          <span className="tree-icon">{fileIcon(e.name)}</span>
          <span className="tree-name">{e.name}</span>
          {dirty && <span className="dirty-dot">●</span>}
        </div>
      )
    })

  return (
    <div className="tree">
      <div className="tree-bar">
        <span className="tree-dir" title={selectedDir || '(루트)'}>{selectedDir || '(루트)'}</span>
        <button onClick={() => p.onNewFile(selectedDir)} title="선택한 폴더에 새 파일">＋파일</button>
        <button onClick={() => p.onNewFolder(selectedDir)} title="선택한 폴더에 새 폴더">＋폴더</button>
        <button onClick={p.onRefresh} title="새로고침">↻</button>
      </div>
      <div className="tree-body">
        {p.entries.length === 0 && <div className="tree-empty">.md / .tsv 파일이 없습니다</div>}
        {renderNodes(p.entries, 0)}
      </div>
    </div>
  )
}
