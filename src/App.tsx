import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { backend, setBackend, type MountInfo, type RootDetail, type TreeEntry } from './lib/backend'
import { FsaBackend } from './lib/fsa/fsaBackend'
import { currentWorkspaceId, listWorkspaces, queryRoot, saveWorkspace, setCurrentWorkspace, touchWorkspace, type Workspace as WorkspaceData } from './lib/fsa/workspace'
import { explorerSupported, helperReady, openInExplorer } from './lib/explorer'
import { guessPath } from './lib/localPath'
import { splitRootPath } from './lib/roots.mjs'
import { ExplorerHelperDialog } from './components/ExplorerHelperDialog'
import { FolderInfoDialog } from './components/FolderInfoDialog'
import { ImportDialog } from './components/ImportDialog'
import type { RootAction } from './components/FileTree'
import { GrantScreen, StartScreen } from './components/StartScreen'
import { DOC_EXTS_LABEL, isDocName } from './lib/filetypes.mjs'
import { allCommands, commandByCombo, registerCommands, runCommand, useCommandsVersion } from './lib/commands'
import { comboFromEvent } from './lib/keys'
import { usePwa } from './lib/pwa'
import { toggleTheme, useTheme } from './lib/theme'
import { store, useStoreVersion } from './store/documents'
import { Workbench, type WorkbenchHandle } from './components/Workbench'
import { Palette, type PaletteItem } from './components/Palette'
import { HelpDialog } from './components/HelpDialog'

type Phase =
  | { kind: 'loading' }
  | { kind: 'unsupported' }
  | { kind: 'start' }
  | { kind: 'grant'; ws: WorkspaceData }
  | { kind: 'ready'; layoutId: string }

export default function App() {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' })

  const enter = useCallback((ws: WorkspaceData) => {
    setBackend(new FsaBackend(ws, { save: saveWorkspace }))
    void setCurrentWorkspace(ws.id)
    void touchWorkspace(ws)
    setPhase({ kind: 'ready', layoutId: ws.id })
  }, [])

  /** 권한이 모두 있으면 바로, 아니면 허용 화면으로 */
  const open = useCallback(async (ws: WorkspaceData) => {
    const roots = [{ handle: ws.primary, readOnly: false }, ...ws.mounts]
    const states = await Promise.all(roots.map((r) => queryRoot(r.handle, r.readOnly)))
    if (states.every((s) => s === 'granted')) enter(ws)
    else setPhase({ kind: 'grant', ws })
  }, [enter])

  const started = useRef(false)
  useEffect(() => {
    if (started.current) return
    started.current = true
    void (async () => {
      if (!('showDirectoryPicker' in window)) { setPhase({ kind: 'unsupported' }); return }
      if (import.meta.env.DEV && new URLSearchParams(location.search).has('opfs')) {
        const { devWorkspace } = await import('./lib/fsa/devSeed')
        setBackend(new FsaBackend(await devWorkspace(), { save: async () => {} }))
        setPhase({ kind: 'ready', layoutId: 'dev' })
        return
      }
      const id = await currentWorkspaceId()
      const ws = id ? (await listWorkspaces()).find((w) => w.id === id) : undefined
      if (ws) await open(ws)
      else setPhase({ kind: 'start' })
    })().catch((e) => {
      console.warn('작업 공간을 읽지 못했습니다:', e)
      setPhase({ kind: 'start' })
    })
  }, [open])

  switch (phase.kind) {
    case 'loading':
      return null
    case 'unsupported':
      return (
        <div className="app-message">
          <h1>JayDocs</h1>
          <p>이 브라우저는 로컬 폴더를 열 수 없습니다. Edge 또는 Chrome 에서 여세요.</p>
        </div>
      )
    case 'start':
      return <StartScreen onOpen={(ws) => void open(ws)} />
    case 'grant':
      return <GrantScreen key={phase.ws.id} workspace={phase.ws} onReady={() => enter(phase.ws)} onSwitch={() => setPhase({ kind: 'start' })} onOpen={(ws) => void open(ws)} />
    case 'ready':
      return <Workspace layoutId={phase.layoutId} />
  }
}

/** 창 제목에 문서 별칭 — 작업 표시줄에서 구분된다 */
function showRootName() {
  document.title = `${backend().rootDetail(null).label} — JayDocs`
}

function allFiles(entries: TreeEntry[], out: string[] = []): string[] {
  for (const e of entries) {
    if (e.type === 'dir') allFiles(e.children ?? [], out)
    else out.push(e.path)
  }
  return out
}

type Overlay =
  | { kind: 'palette' }
  | { kind: 'files' }
  | { kind: 'help' }
  | { kind: 'import' }
  /** after: 저장하고 이어서 할 일 (상세 경로가 없어 탐색기 열기·경로 복사가 여기로 왔을 때) */
  | { kind: 'rootInfo'; root: RootDetail; guess: string; after?: { action: 'reveal' | 'copyPath'; path: string } }
  | { kind: 'explorer'; path: string | null }
  | null

function Workspace({ layoutId }: { layoutId: string }) {
  useStoreVersion()
  useCommandsVersion()
  const theme = useTheme()
  const app = usePwa()
  const [root, setRoot] = useState<string | null>(null)
  const [tree, setTree] = useState<TreeEntry[]>([])
  /** 가져온 폴더들 (트리를 읽을 때마다 갱신). null = 아직 모름 */
  const [mounts, setMounts] = useState<MountInfo[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** 잠깐 보이는 알림 (가져온 폴더가 사라져 탭을 닫았을 때 등) */
  const [notice, setNotice] = useState<string | null>(null)
  const [overlay, setOverlay] = useState<Overlay>(null)
  const bench = useRef<WorkbenchHandle>(null)
  /** 트리에서 마지막으로 고른 폴더 (새 파일의 기본 위치) — 트리가 알려 준다 */
  const lastDir = useRef('')

  const refreshTree = useCallback(async () => {
    try {
      const t = await backend().tree()
      // 가져온 폴더는 주 폴더 항목들 뒤에 `@별칭` 노드로 붙인다
      const all: TreeEntry[] = [
        ...t.entries,
        ...t.mounts.map((m): TreeEntry => ({
          type: 'dir', name: `@${m.alias}`, path: `@${m.alias}`, children: m.entries,
          mount: { alias: m.alias, folder: m.folder, readOnly: m.readOnly, truncated: m.truncated, path: m.path },
        })),
      ]
      setTree(all)
      store.setTree(all)
      store.setMounts(t.mounts)
      setMounts(t.mounts)
      const problems = t.mounts.filter((m) => m.error).map((m) => `@${m.alias}: ${m.error}`)
      if (t.truncated) problems.unshift('항목이 너무 많아 트리에 일부만 보입니다')
      setError(problems.length ? problems.join(' · ') : null)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [])

  const showNotice = useCallback((msg: string) => {
    setNotice(msg)
    window.setTimeout(() => setNotice((n) => (n === msg ? null : n)), 6000)
  }, [])

  // 레이아웃 복원 뒤 처음 한 번: 이제 없는 가져온 폴더의 탭은 닫는다 (해제됨, 드라이브 빠짐)
  const staleChecked = useRef(false)
  useEffect(() => {
    if (staleChecked.current || mounts === null || !root || !bench.current) return
    staleChecked.current = true
    const known = new Set(mounts.map((m) => m.alias))
    const gone = new Set<string>()
    for (const p of bench.current.openPaths()) {
      const { alias } = splitRootPath(p)
      if (alias !== null && !known.has(alias)) gone.add(alias)
    }
    for (const a of gone) bench.current.closePaths(`@${a}`, true)
    if (gone.size) showNotice(`가져온 폴더가 없어 탭을 닫았습니다: ${[...gone].map((a) => `@${a}`).join(', ')}`)
  }, [mounts, root, showNotice])

  useEffect(() => {
    backend().info().then((i) => {
      setRoot(i.root)
      showRootName()
    }).catch((e) => setError((e as Error).message))
    void refreshTree()
  }, [refreshTree])

  // 파일 변경 알림: 열린 문서는 스토어가, 트리는 이름 변경(생성·삭제·이동)일 때 다시 읽는다.
  useEffect(() => {
    let timer: number | undefined
    const scheduleTree = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => void refreshTree(), 300)
    }
    const unsubscribe = backend().subscribe((e) => {
      if (e.event === 'rescan') {
        void store.recheckOpen()
        scheduleTree()
        return
      }
      void store.handleExternal(e)
      if (e.event === 'rename') scheduleTree()
    })
    return () => { unsubscribe(); window.clearTimeout(timer) }
  }, [refreshTree])

  const newFile = useCallback(async (dir: string) => {
    const name = window.prompt(`새 파일 이름 (${DOC_EXTS_LABEL})`, dir ? `${dir}/새 문서.md` : '새 문서.md')
    if (!name) return
    const path = name.replace(/\\/g, '/').replace(/^\/+/, '')
    if (!isDocName(path)) { window.alert(`${DOC_EXTS_LABEL} 중 하나로 끝나야 합니다`); return }
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
    if (isDir) { window.alert('폴더 이름은 탐색기에서 바꾸세요. 트리는 자동으로 따라옵니다.'); return }
    const dirty = dirtyUnder(path, false)
    if (dirty.length) { window.alert(`먼저 저장하세요:\n${dirty.join('\n')}`); return }
    const to = window.prompt('파일의 새 경로 (폴더를 바꾸면 옮겨진다)', path)
    if (!to || to === path) return
    const next = to.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '')
    if (!isDocName(next)) { window.alert(`${DOC_EXTS_LABEL} 중 하나로 끝나야 합니다`); return }
    try {
      await backend().rename(path, next)
      bench.current?.renamePaths(path, next, false)
      await refreshTree()
    } catch (e) {
      window.alert(`바꾸지 못했습니다: ${(e as Error).message}`)
    }
  }, [refreshTree])

  const remove = useCallback(async (path: string, isDir: boolean) => {
    const dirty = dirtyUnder(path, isDir)
    if (dirty.length) { window.alert(`저장하지 않은 문서가 있습니다. 먼저 저장하거나 닫으세요:\n${dirty.join('\n')}`); return }
    if (!window.confirm(isDir ? `폴더 "${path}" 와 그 안의 모든 파일을 지웁니다. 휴지통으로 가지 않습니다. 계속할까요?` : `"${path}" 를 지웁니다. 휴지통으로 가지 않습니다. 계속할까요?`)) return
    try {
      await backend().remove(path, isDir)
      bench.current?.closePaths(path, isDir)
      await refreshTree()
    } catch (e) {
      window.alert(`지우지 못했습니다: ${(e as Error).message}`)
    }
  }, [refreshTree])

  // ---- 가져온 폴더
  const unmount = useCallback(async (alias: string) => {
    const dirty = dirtyUnder(`@${alias}`, true)
    if (dirty.length) { window.alert(`저장하지 않은 문서가 있습니다. 먼저 저장하거나 닫으세요:\n${dirty.join('\n')}`); return }
    try {
      bench.current?.closePaths(`@${alias}`, true)
      await backend().removeRoot(alias)
      await refreshTree()
      showNotice(`가져오기를 해제했습니다: @${alias} — 파일은 그대로이고, 폴더 가져오기 창의 "최근 폴더" 에서 다시 가져올 수 있습니다`)
    } catch (e) {
      window.alert(`해제하지 못했습니다: ${(e as Error).message}`)
    }
  }, [refreshTree, showNotice])

  const toggleReadOnly = useCallback(async (alias: string) => {
    const m = mounts?.find((x) => x.alias === alias)
    if (!m) return
    if (!m.readOnly) {
      const dirty = dirtyUnder(`@${alias}`, true)
      if (dirty.length) { window.alert(`읽기 전용으로 바꾸기 전에 저장하세요:\n${dirty.join('\n')}`); return }
    }
    try {
      await backend().setRootReadOnly(alias, !m.readOnly)
      await refreshTree()
    } catch (e) {
      window.alert(`바꾸지 못했습니다: ${(e as Error).message}`)
    }
  }, [mounts, refreshTree])

  // ---- 폴더 정보 · 파일 탐색기
  /** 폴더 정보 창. 넣은 적 없는 경로는 아는 경로 옆에 있다고 보고 미리 채운다 */
  const editRoot = useCallback(async (alias: string | null, after?: { action: 'reveal' | 'copyPath'; path: string }) => {
    const root = backend().rootDetail(alias)
    const known = backend().rootDetail(null).path ?? (await listWorkspaces()).find((w) => w.path)?.path
    setOverlay({ kind: 'rootInfo', root, guess: !root.path && known ? guessPath(known, root.folder) : '', after })
  }, [])

  const openExplorer = useCallback((full: string) => {
    setOverlay(null)
    openInExplorer(full, () => showNotice('탐색기 창이 뜨지 않았다면 명령 팔레트의 "파일 탐색기 연결 도우미" 를 확인하세요'))
  }, [showNotice])

  const copyLocalPath = useCallback((full: string) => {
    setOverlay(null)
    navigator.clipboard.writeText(full).then(() => showNotice(`경로를 복사했습니다: ${full}`), (e) => showNotice(`복사하지 못했습니다: ${(e as Error).message}`))
  }, [showNotice])

  const localAction = useCallback((action: 'reveal' | 'copyPath', path: string) => {
    const { root, full } = backend().localPath(path)
    if (!full) void editRoot(root.alias, { action, path })
    else if (action === 'copyPath') copyLocalPath(full)
    else if (helperReady()) openExplorer(full)
    else setOverlay({ kind: 'explorer', path: full })
  }, [editRoot, copyLocalPath, openExplorer])

  const rootAction = useCallback((action: RootAction, path: string) => {
    const alias = splitRootPath(path).alias
    if (action === 'refresh') void refreshTree()
    else if (action === 'reveal' || action === 'copyPath') localAction(action, path)
    else if (action === 'editRoot') void editRoot(backend().localPath(path).root.alias)
    else if (alias !== null && action === 'unmount') void unmount(alias)
    else if (alias !== null && action === 'toggleReadOnly') void toggleReadOnly(alias)
  }, [refreshTree, unmount, toggleReadOnly, localAction, editRoot])

  const onImported = useCallback(async (m: MountInfo) => {
    setOverlay(null)
    await refreshTree()
    showNotice(`가져왔습니다: @${m.alias}${m.readOnly ? ' (읽기 전용)' : ''} — ${m.folder}`)
    runCommand('focusTree')
  }, [refreshTree, showNotice])

  const switchFolder = useCallback(async () => {
    if (store.anyDirty()) { window.alert('저장하지 않은 문서가 있습니다. 먼저 저장하세요.'); return }
    await setCurrentWorkspace(null)
    location.reload()
  }, [])

  const applyUpdate = useCallback(() => {
    if (store.anyDirty()) { window.alert('저장하지 않은 문서가 있습니다. 저장한 뒤 적용하세요.'); return }
    app.applyUpdate()
  }, [app])

  // 가져온 폴더마다 팔레트 명령 (해제 · 읽기 전용 전환)
  useEffect(() => registerCommands((mounts ?? []).flatMap((m) => [
    { id: `unmount:${m.alias}`, label: `가져온 폴더 해제 — @${m.alias}`, run: () => void unmount(m.alias) },
    { id: `toggleReadOnly:${m.alias}`, label: `${m.readOnly ? '읽기 전용 끄기' : '읽기 전용 켜기'} — @${m.alias}`, run: () => void toggleReadOnly(m.alias) },
  ])), [mounts, unmount, toggleReadOnly])

  // ---- 전역 명령
  useEffect(() => registerCommands([
    { id: 'importFolder', label: '폴더 가져오기…', run: () => setOverlay({ kind: 'import' }) },
    { id: 'switchFolder', label: '문서 폴더 바꾸기…', run: () => void switchFolder() },
    { id: 'editRoot', label: '문서 폴더 별칭 · 상세 경로 편집…', run: () => void editRoot(null) },
    { id: 'revealRoot', label: '파일 탐색기에서 문서 폴더 열기', run: () => localAction('reveal', ''), enabled: explorerSupported },
    { id: 'explorerHelper', label: '파일 탐색기 연결 도우미…', run: () => setOverlay({ kind: 'explorer', path: null }), enabled: explorerSupported },
    { id: 'installApp', label: '앱으로 설치', run: () => void app.install(), enabled: () => app.canInstall },
    { id: 'applyUpdate', label: '새 버전 지금 적용', run: applyUpdate, enabled: () => app.updateReady },
    { id: 'save', label: '저장', run: () => bench.current?.saveActive() },
    { id: 'saveAll', label: '모두 저장', run: () => void store.saveAll(), enabled: () => store.anyDirty() },
    { id: 'palette', label: '명령 팔레트', run: () => setOverlay({ kind: 'palette' }) },
    { id: 'quickOpen', label: '빠른 열기 (파일)', run: () => setOverlay({ kind: 'files' }) },
    { id: 'help', label: '단축키 도움말', run: () => setOverlay({ kind: 'help' }) },
    { id: 'toggleTheme', label: '다크 / 라이트 전환', run: toggleTheme },
    { id: 'newFile', label: '새 파일', run: () => void newFile(lastDir.current) },
    { id: 'newFolder', label: '새 폴더', run: () => void newFolder(lastDir.current) },
    { id: 'refreshTree', label: '파일 트리 새로고침', run: () => void refreshTree() },
  ]), [newFile, newFolder, refreshTree, switchFolder, applyUpdate, app, editRoot, localAction])

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
  const watching = backend().watching()
  const primary = backend().rootDetail(null)

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
        <button className="root" title={`문서 폴더 바꾸기${primary.path ? `\n${primary.path}` : ''}`} onClick={() => void switchFolder()}>{root ? primary.label : '…'}</button>
        <span className="spacer" />
        {error && <span className="topbar-error" title={error}>오류: {error}</span>}
        {app.updateReady && <button onClick={applyUpdate} title="모든 창을 닫았다 열어도 적용됩니다">새 버전 적용</button>}
        {app.canInstall && <button onClick={() => void app.install()} title="시작 메뉴에서 열고 폴더 권한을 유지합니다">앱으로 설치</button>}
        <button onClick={() => setOverlay({ kind: 'import' })} title="폴더 가져오기 — 다른 폴더를 원래 자리에서 열기 (Ctrl+Shift+O)">📂 가져오기</button>
        <span className={'conn' + (watching ? ' is-on' : '')} title={watching ? '파일 변경 감시 중' : '이 브라우저는 실시간 감시가 없어 몇 초마다 확인합니다'}>●</span>
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
            layoutId={layoutId}
            tree={tree}
            onRefresh={() => void refreshTree()}
            onNewFile={(d) => { lastDir.current = d; void newFile(d) }}
            onNewFolder={(d) => { lastDir.current = d; void newFolder(d) }}
            onRename={(path, isDir) => void rename(path, isDir)}
            onDelete={(path, isDir) => void remove(path, isDir)}
            onRootAction={rootAction}
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
      {overlay?.kind === 'import' && <ImportDialog onClose={closeOverlay} onImported={(m) => void onImported(m)} />}
      {overlay?.kind === 'rootInfo' && (
        <FolderInfoDialog
          title={overlay.root.alias === null ? '문서 폴더 정보' : `가져온 폴더 정보 — ${overlay.root.label}`}
          folder={overlay.root.folder}
          label={overlay.root.alias === null ? (overlay.root.label === overlay.root.folder ? '' : overlay.root.label) : undefined}
          path={overlay.root.path ?? ''}
          guess={overlay.guess}
          onClose={closeOverlay}
          onSave={async (label, path) => {
            await backend().updateRoot(overlay.root.alias, { label, path })
            showRootName()
            setOverlay(null)
            // 클릭 직후여야 브라우저가 앱 열기를 허용한다 — 트리를 다시 읽기 전에
            if (overlay.after && path) localAction(overlay.after.action, overlay.after.path)
            void refreshTree()
          }}
        />
      )}
      {overlay?.kind === 'explorer' && <ExplorerHelperDialog path={overlay.path} onOpen={openExplorer} onCopy={copyLocalPath} onClose={closeOverlay} />}
      {notice && <div className="toast" role="status" onClick={() => setNotice(null)}>{notice}</div>}
    </div>
  )
}
