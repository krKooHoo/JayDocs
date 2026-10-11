import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { HttpBackend, backend, setBackend, type TreeEntry } from './lib/backend'
import { getToken } from './lib/token'
import { allCommands, commandByCombo, registerCommands, runCommand, useCommandsVersion } from './lib/commands'
import { comboFromEvent } from './lib/keys'
import { toggleTheme, useTheme } from './lib/theme'
import { store, useStoreVersion } from './store/documents'
import { git, useGitVersion } from './store/git'
import { Workbench, type WorkbenchHandle } from './components/Workbench'
import { Palette, type PaletteItem } from './components/Palette'
import { HelpDialog } from './components/HelpDialog'

export default function App() {
  const token = useMemo(getToken, [])
  // 토큰 없이 열린 뒤 주소에 #token=… 이 붙으면(해시만 바뀌면 새로고침이 없다) 다시 시작한다.
  useEffect(() => {
    const onHash = () => { if (location.hash.includes('token=')) location.reload() }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  if (!token) {
    return (
      <div className="app-message">
        <h1>JayDocs</h1>
        <p>접속 토큰이 없습니다. <code>start.cmd</code> 로 실행하면 토큰이 붙은 주소로 열립니다.</p>
        <p>터미널에 찍힌 주소(<code>http://127.0.0.1:…/#token=…</code>)를 그대로 여세요.</p>
      </div>
    )
  }
  setBackend(new HttpBackend(token))
  return <Workspace />
}

function allFiles(entries: TreeEntry[], out: string[] = []): string[] {
  for (const e of entries) {
    if (e.type === 'dir') allFiles(e.children ?? [], out)
    else out.push(e.path)
  }
  return out
}

type Overlay = { kind: 'palette' } | { kind: 'files' } | { kind: 'help' } | null

function Workspace() {
  useStoreVersion()
  useGitVersion()
  useCommandsVersion()
  const theme = useTheme()
  const [root, setRoot] = useState<string | null>(null)
  const [tree, setTree] = useState<TreeEntry[]>([])
  const [error, setError] = useState<string | null>(null)
  const [connected, setConnected] = useState(false)
  const [overlay, setOverlay] = useState<Overlay>(null)
  const bench = useRef<WorkbenchHandle>(null)
  /** 트리에서 마지막으로 고른 폴더 (새 파일의 기본 위치) — 트리가 알려 준다 */
  const lastDir = useRef('')

  const refreshTree = useCallback(async () => {
    try {
      const t = await backend().tree()
      setTree(t.entries)
      store.setTree(t.entries)
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [])

  useEffect(() => {
    backend().info().then((i) => setRoot(i.root)).catch((e) => setError((e as Error).message))
    void refreshTree()
    void git.refresh()
  }, [refreshTree])

  // 파일 변경 알림: 열린 문서는 스토어가, 트리는 이름 변경(생성·삭제·이동)일 때 다시 읽는다. git 상태는 뭉쳐서 다시 읽는다.
  useEffect(() => {
    let timer: number | undefined
    const unsubscribe = backend().subscribe((e) => {
      setConnected(true)
      void store.handleExternal(e)
      git.scheduleRefresh()
      if (e.event === 'rename') {
        window.clearTimeout(timer)
        timer = window.setTimeout(() => void refreshTree(), 300)
      }
    })
    return () => { unsubscribe(); window.clearTimeout(timer) }
  }, [refreshTree])

  const newFile = useCallback(async (dir: string) => {
    const name = window.prompt('새 파일 이름 (.md 또는 .tsv)', dir ? `${dir}/새 문서.md` : '새 문서.md')
    if (!name) return
    const path = name.replace(/\\/g, '/').replace(/^\/+/, '')
    if (!/\.(md|tsv)$/i.test(path)) { window.alert('.md 또는 .tsv 로 끝나야 합니다'); return }
    try {
      await backend().write(path, '', null)
      await refreshTree()
      bench.current?.openFile(path)
    } catch (e) {
      window.alert(`만들지 못했습니다: ${(e as Error).message}`)
    }
  }, [refreshTree])

  const newFolder = useCallback(async (dir: string) => {
    const name = window.prompt('새 폴더 이름', dir ? `${dir}/새 폴더` : '새 폴더')
    if (!name) return
    try {
      await backend().mkdir(name.replace(/\\/g, '/'))
      await refreshTree()
    } catch (e) {
      window.alert(`만들지 못했습니다: ${(e as Error).message}`)
    }
  }, [refreshTree])

  /** 경로 아래에 저장하지 않은 문서가 있으면 그 목록 */
  const dirtyUnder = (path: string, isDir: boolean) =>
    [...store.dirtyPaths()].filter((p) => p === path || (isDir && p.startsWith(path + '/')))

  const rename = useCallback(async (path: string, isDir: boolean) => {
    const dirty = dirtyUnder(path, isDir)
    if (dirty.length) { window.alert(`먼저 저장하세요:\n${dirty.join('\n')}`); return }
    const to = window.prompt(isDir ? '폴더의 새 경로' : '파일의 새 경로 (폴더를 바꾸면 옮겨진다)', path)
    if (!to || to === path) return
    const next = to.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '')
    if (!isDir && !/\.(md|tsv)$/i.test(next)) { window.alert('.md 또는 .tsv 로 끝나야 합니다'); return }
    try {
      await backend().rename(path, next)
      bench.current?.renamePaths(path, next, isDir)
      await refreshTree()
      git.scheduleRefresh(100)
    } catch (e) {
      window.alert(`바꾸지 못했습니다: ${(e as Error).message}`)
    }
  }, [refreshTree])

  const remove = useCallback(async (path: string, isDir: boolean) => {
    const dirty = dirtyUnder(path, isDir)
    if (dirty.length) { window.alert(`저장하지 않은 문서가 있습니다. 먼저 저장하거나 닫으세요:\n${dirty.join('\n')}`); return }
    if (!window.confirm(isDir ? `폴더 "${path}" 와 그 안의 모든 파일을 지웁니다. 계속할까요?` : `"${path}" 를 지웁니다. 계속할까요?`)) return
    try {
      await backend().remove(path, isDir)
      bench.current?.closePaths(path, isDir)
      await refreshTree()
      git.scheduleRefresh(100)
    } catch (e) {
      window.alert(`지우지 못했습니다: ${(e as Error).message}`)
    }
  }, [refreshTree])

  // ---- 전역 명령
  useEffect(() => registerCommands([
    { id: 'save', label: '저장', run: () => bench.current?.saveActive() },
    { id: 'saveAll', label: '모두 저장', run: () => void store.saveAll(), enabled: () => store.anyDirty() },
    { id: 'palette', label: '명령 팔레트', run: () => setOverlay({ kind: 'palette' }) },
    { id: 'quickOpen', label: '빠른 열기 (파일)', run: () => setOverlay({ kind: 'files' }) },
    { id: 'help', label: '단축키 도움말', run: () => setOverlay({ kind: 'help' }) },
    { id: 'toggleTheme', label: '다크 / 라이트 전환', run: toggleTheme },
    { id: 'newFile', label: '새 파일', run: () => void newFile(lastDir.current) },
    { id: 'newFolder', label: '새 폴더', run: () => void newFolder(lastDir.current) },
    { id: 'refreshTree', label: '파일 트리 새로고침', run: () => void refreshTree() },
    { id: 'gitRefresh', label: 'git 상태 다시 읽기', run: () => void git.refresh(), enabled: () => git.repo },
  ]), [newFile, newFolder, refreshTree])

  // ---- 전역 키 처리. 창(에디터·그리드)이 먼저 처리해 preventDefault 한 키는 건드리지 않는다
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return
      const combo = comboFromEvent(e)
      if (!combo) return
      const id = commandByCombo.get(combo)
      if (!id) return
      if (runCommand(id)) e.preventDefault()
    }
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (store.anyDirty()) { e.preventDefault(); e.returnValue = '' }
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('beforeunload', onBeforeUnload)
    }
  }, [])

  const dirtyCount = store.dirtyPaths().size

  const paletteItems = useMemo<PaletteItem[]>(() => {
    if (overlay?.kind === 'palette') {
      return allCommands().map((c) => ({ id: c.id, label: c.label, hint: c.keys, disabled: c.enabled ? !c.enabled() : false }))
    }
    if (overlay?.kind === 'files') {
      return allFiles(tree).map((path) => ({ id: path, label: path.split('/').pop() ?? path, hint: path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '' }))
    }
    return []
  }, [overlay, tree])

  const closeOverlay = useCallback(() => { setOverlay(null); runCommand('focusEditor') }, [])

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">JayDocs</span>
        <span className="root" title={root ?? ''}>{root ?? '…'}</span>
        {git.repo && git.branch && <span className="branch" title="git 브랜치">⎇ {git.branch}</span>}
        <span className="spacer" />
        {error && <span className="topbar-error" title={error}>오류: {error}</span>}
        <span className={'conn' + (connected ? ' is-on' : '')} title={connected ? '파일 변경 감시 중' : '감시 연결 대기'}>●</span>
        <button onClick={() => setOverlay({ kind: 'palette' })} title="명령 팔레트 (Ctrl+Shift+P)">명령 ⌘</button>
        <button onClick={() => bench.current?.saveActive()} title="Ctrl+S">저장</button>
        <button onClick={() => void store.saveAll()} disabled={dirtyCount === 0} title="Ctrl+Shift+S">
          모두 저장{dirtyCount ? ` (${dirtyCount})` : ''}
        </button>
        <button onClick={() => bench.current?.splitActive()} title="Ctrl+\">오른쪽에 분할</button>
        <button onClick={toggleTheme} title="다크 / 라이트 (Ctrl+Alt+D)">{theme === 'dark' ? '☀' : '☾'}</button>
        <button onClick={() => setOverlay({ kind: 'help' })} title="단축키 (F1)">?</button>
      </header>
      <main className="workbench">
        {root && (
          <Workbench
            ref={bench}
            root={root}
            tree={tree}
            onRefresh={() => void refreshTree()}
            onNewFile={(d) => { lastDir.current = d; void newFile(d) }}
            onNewFolder={(d) => { lastDir.current = d; void newFolder(d) }}
            onRename={(path, isDir) => void rename(path, isDir)}
            onDelete={(path, isDir) => void remove(path, isDir)}
          />
        )}
      </main>
      {overlay?.kind === 'palette' && (
        <Palette title="명령 팔레트" placeholder="명령 이름…" items={paletteItems} onClose={closeOverlay} onPick={(id) => { setOverlay(null); runCommand(id) }} />
      )}
      {overlay?.kind === 'files' && (
        <Palette title="빠른 열기" placeholder="파일 이름…" items={paletteItems} onClose={closeOverlay} onPick={(id) => { setOverlay(null); bench.current?.openFile(id); window.setTimeout(() => runCommand('focusEditor'), 80) }} />
      )}
      {overlay?.kind === 'help' && <HelpDialog onClose={closeOverlay} />}
    </div>
  )
}
