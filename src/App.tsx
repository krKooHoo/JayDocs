import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { HttpBackend, backend, setBackend, type MountInfo, type TreeEntry } from './lib/backend'
import { splitRootPath } from './lib/roots.mjs'
import { ImportDialog } from './components/ImportDialog'
import type { RootAction } from './components/FileTree'
import { getToken } from './lib/token'
import { DOC_EXTS_LABEL, isDocName } from './lib/filetypes.mjs'
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

type Overlay = { kind: 'palette' } | { kind: 'files' } | { kind: 'help' } | { kind: 'import' } | null

function Workspace() {
  useStoreVersion()
  useGitVersion()
  useCommandsVersion()
  const theme = useTheme()
  const [root, setRoot] = useState<string | null>(null)
  const [tree, setTree] = useState<TreeEntry[]>([])
  /** 가져온 폴더들 (트리를 읽을 때마다 갱신). null = 아직 모름 */
  const [mounts, setMounts] = useState<MountInfo[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** 잠깐 보이는 알림 (가져온 폴더가 사라져 탭을 닫았을 때 등) */
  const [notice, setNotice] = useState<string | null>(null)
  const [connected, setConnected] = useState(false)
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
          mount: { alias: m.alias, path: m.path, readOnly: m.readOnly, persist: m.persist, truncated: m.truncated },
        })),
      ]
      setTree(all)
      store.setTree(all)
      store.setMounts(t.mounts)
      setMounts(t.mounts)
      const broken = t.mounts.filter((m) => m.error)
      setError(broken.length ? broken.map((m) => `@${m.alias}: ${m.error}`).join(' · ') : null)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [])

  const showNotice = useCallback((msg: string) => {
    setNotice(msg)
    window.setTimeout(() => setNotice((n) => (n === msg ? null : n)), 6000)
  }, [])

  // 레이아웃 복원 뒤 처음 한 번: 이제 없는 가져온 폴더의 탭은 닫는다 (다른 PC, 해제됨, 드라이브 빠짐)
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
      // 창 제목에 폴더 이름 — 리포를 여러 개 열어 두어도 구분된다
      document.title = `${i.root.split(/[\\/]/).filter(Boolean).pop() ?? i.root} — JayDocs`
    }).catch((e) => setError((e as Error).message))
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
    const dirty = dirtyUnder(path, isDir)
    if (dirty.length) { window.alert(`먼저 저장하세요:\n${dirty.join('\n')}`); return }
    const to = window.prompt(isDir ? '폴더의 새 경로' : '파일의 새 경로 (폴더를 바꾸면 옮겨진다)', path)
    if (!to || to === path) return
    const next = to.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '')
    if (!isDir && !isDocName(next)) { window.alert(`${DOC_EXTS_LABEL} 중 하나로 끝나야 합니다`); return }
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

  const reveal = useCallback((path: string) => {
    backend().reveal(path).catch((e) => window.alert(`탐색기를 열지 못했습니다: ${(e as Error).message}`))
  }, [])

  const rootAction = useCallback((action: RootAction, path: string) => {
    const alias = splitRootPath(path).alias
    if (action === 'reveal') reveal(path)
    else if (action === 'refresh') void refreshTree()
    else if (alias !== null && action === 'unmount') void unmount(alias)
    else if (alias !== null && action === 'toggleReadOnly') void toggleReadOnly(alias)
  }, [reveal, refreshTree, unmount, toggleReadOnly])

  const onImported = useCallback(async (m: MountInfo) => {
    setOverlay(null)
    await refreshTree()
    showNotice(`가져왔습니다: @${m.alias}${m.readOnly ? ' (읽기 전용)' : ''} — ${m.path}`)
    runCommand('focusTree')
  }, [refreshTree, showNotice])

  // 가져온 폴더마다 팔레트 명령 (해제 · 읽기 전용 전환)
  useEffect(() => registerCommands((mounts ?? []).flatMap((m) => [
    { id: `unmount:${m.alias}`, label: `가져온 폴더 해제 — @${m.alias}`, run: () => void unmount(m.alias) },
    { id: `toggleReadOnly:${m.alias}`, label: `${m.readOnly ? '읽기 전용 끄기' : '읽기 전용 켜기'} — @${m.alias}`, run: () => void toggleReadOnly(m.alias) },
  ])), [mounts, unmount, toggleReadOnly])

  // ---- 전역 명령
  useEffect(() => registerCommands([
    { id: 'importFolder', label: '폴더 가져오기…', run: () => setOverlay({ kind: 'import' }) },
    { id: 'revealActive', label: '탐색기에서 보기 (현재 문서)', run: () => { const p = bench.current?.activePath(); if (p) reveal(p) }, enabled: () => !!bench.current?.activePath() },
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
    { id: 'gitPush', label: 'git push', run: () => void backend().gitPush().then(() => git.headChanged()).catch((e) => window.alert(`push 실패: ${(e as Error).message}`)), enabled: () => git.repo && !!git.upstream },
    { id: 'gitPull', label: 'git pull (--ff-only)', run: () => void backend().gitPull().then(() => git.headChanged()).catch((e) => window.alert(`pull 실패: ${(e as Error).message}`)), enabled: () => git.repo && !!git.upstream },
  ]), [newFile, newFolder, refreshTree, reveal])

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
        <button onClick={() => setOverlay({ kind: 'import' })} title="폴더 가져오기 — 다른 폴더를 원래 자리에서 열기 (Ctrl+Shift+O)">📂 가져오기</button>
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
      {notice && <div className="toast" role="status" onClick={() => setNotice(null)}>{notice}</div>}
    </div>
  )
}
