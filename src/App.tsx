import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { backend, ConflictError, setBackend, type MountInfo, type RootDetail, type TreeEntry } from './lib/backend'
import { FsaBackend } from './lib/fsa/fsaBackend'
import { currentWorkspaceId, listWorkspaces, queryRoot, saveWorkspace, setCurrentWorkspace, touchWorkspace, type Workspace as WorkspaceData } from './lib/fsa/workspace'
import { explorerSupported, helperReady, openInExplorer } from './lib/explorer'
import { guessPath } from './lib/localPath'
import { splitRootPath } from './lib/roots.mjs'
import { checkForUpdate, UpdateButton } from './components/UpdateButton'
import { ExplorerHelperDialog } from './components/ExplorerHelperDialog'
import { FolderInfoDialog } from './components/FolderInfoDialog'
import { ImportDialog } from './components/ImportDialog'
import type { RootAction } from './components/FileTree'
import { GrantScreen, StartScreen } from './components/StartScreen'
import { NewDocDialog, type NewDocChoice } from './components/NewDocDialog'
import { fileNameOf, TEMPLATES_DIR, userTemplatePaths } from './lib/templates'
import { allCommands, commandByCombo, keysOf, registerCommands, runCommand, tip, useCommandsVersion } from './lib/commands'
import { comboFromEvent } from './lib/keys'
import { usePwa } from './lib/pwa'
import { toggleTheme, useTheme } from './lib/theme'
import { store, useDirtyPaths } from './store/documents'
import { Workbench, type WorkbenchHandle } from './components/Workbench'
import { Palette, type PaletteItem } from './components/Palette'
import { HelpDialog } from './components/HelpDialog'
import { DialogHost } from './components/DialogHost'
import { NoticeHost } from './components/NoticeHost'
import { askConfirm, askText, dialogOpen } from './lib/dialogs'
import { dismissAllNotices, dismissNotice, noticeList, notify, notifyError } from './lib/notices'
import { checkEntryPath, cleanEntryPath, nameStemRange } from './lib/names'
import { setTreeCursor } from './lib/nav'
import { recentCommands, recentFiles, recentRanks, recordRecentCommand } from './lib/recents'

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

  const screen = () => {
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

  // 알림 줄과 대화상자는 어느 화면에서든 하나씩 (DESIGN §24.6)
  return (
    <>
      {screen()}
      <NoticeHost />
      <DialogHost />
    </>
  )
}

/** 알림 줄의 key — 같은 종류의 알림은 하나만 남는다 */
const FILE_NOTICE = 'file'
const UPDATE_NOTICE = 'update'

/** 업데이트 확인 결과 (null 은 앞의 결과를 지운다) */
function updateNotice(msg: string | null) {
  if (msg) notify(msg, { key: UPDATE_NOTICE })
  else dismissNotice(UPDATE_NOTICE)
}

/** 트리에 있는 모든 경로(파일 · 폴더)를 소문자로 — 새 이름이 이미 있는지 볼 때 */
function lowerPaths(entries: TreeEntry[], out = new Set<string>()): Set<string> {
  for (const e of entries) {
    out.add(e.path.toLowerCase())
    if (e.type === 'dir') lowerPaths(e.children ?? [], out)
  }
  return out
}

/** 트리에서 그 폴더 아래에 보이는 파일들 */
function filesUnder(entries: TreeEntry[], dir: string): string[] {
  const prefix = dir + '/'
  return allFiles(entries).filter((p) => p.startsWith(prefix))
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
  /** 새 문서 창 (PLAN-skim SK8). dir: 트리에서 고른 폴더 */
  | { kind: 'newDoc'; dir: string }
  | null

/** 그 창을 여는 명령 — 떠 있는 동안 같은 키를 다시 누르면 닫는다 (DESIGN §24.7 X5) */
const OVERLAY_COMMAND: Partial<Record<NonNullable<Overlay>['kind'], string>> = {
  palette: 'palette', files: 'fileSearch', help: 'help', import: 'importFolder', newDoc: 'newFile',
}
/** 찾아보는 창(팔레트 · 파일 검색 · 도움말)끼리는 서로의 키로 바로 넘어간다. 입력을 받는 창(가져오기 · 폴더 정보 · 연결 도우미)에서는 안 넘어간다 */
const LOOKUP_OVERLAYS = new Set(['palette', 'files', 'help'])
const LOOKUP_COMMANDS = new Set(['palette', 'fileSearch', 'help'])

/** 가져온 폴더 목록에서 화면이 쓰는 값만 — 같은지 볼 때 (안의 파일 목록은 뺀다) */
function mountsKey(mounts: readonly (MountInfo & { error?: string | null })[]) {
  return JSON.stringify(mounts.map((m) => [m.alias, m.folder, m.readOnly, m.truncated, m.path, m.error ?? null]))
}

function Workspace({ layoutId }: { layoutId: string }) {
  useCommandsVersion()
  const theme = useTheme()
  const app = usePwa()
  const [root, setRoot] = useState<string | null>(null)
  const [tree, setTree] = useState<TreeEntry[]>([])
  /** 가져온 폴더들 (트리를 읽을 때마다 갱신). null = 아직 모름 */
  const [mounts, setMounts] = useState<MountInfo[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [overlay, setOverlay] = useState<Overlay>(null)
  const bench = useRef<WorkbenchHandle>(null)
  /** 트리에서 마지막으로 고른 폴더 (새 파일·새 폴더 단축키의 기본 위치) — 트리가 고를 때마다 알려 준다 */
  const lastDir = useRef('')
  /** 지금 떠 있는 창 (오버레이) — 지연 콜백이 최신 값을 읽는다 */
  const overlayRef = useRef<Overlay>(null)
  overlayRef.current = overlay
  /** 지금 트리 — 이름 입력 창이 떠 있는 동안에도 최신 것으로 "이미 있는 이름" 을 본다 */
  const treeRef = useRef<TreeEntry[]>(tree)
  treeRef.current = tree
  /** 마지막으로 state 에 넣은 트리 · 가져온 폴더 목록 (JSON) — 내용이 같으면 state 를 바꾸지 않는다 */
  const lastTree = useRef<string | null>(null)
  const lastMounts = useRef<string | null>(null)

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
      // 창에 포커스가 돌아올 때마다 여기로 온다. 새 배열을 그대로 넣으면 바뀐 것이 없어도 Workspace 아래가 통째로 다시 그려진다 —
      // 내용이 같으면 state 를 그대로 둔다 (DESIGN §24.7 X8). 스토어는 스스로 달라진 것만 알린다
      const treeJson = JSON.stringify(all)
      if (treeJson !== lastTree.current) { lastTree.current = treeJson; setTree(all) }
      store.setTree(all)
      store.setMounts(t.mounts)
      const mountsJson = mountsKey(t.mounts)
      if (mountsJson !== lastMounts.current) { lastMounts.current = mountsJson; setMounts(t.mounts) }
      const problems = t.mounts.filter((m) => m.error).map((m) => `@${m.alias}: ${m.error}`)
      if (t.truncated) problems.unshift('항목이 너무 많아 트리에 일부만 보입니다')
      setError(problems.length ? problems.join(' · ') : null)
    } catch (e) {
      setError((e as Error).message)
    }
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
    if (gone.size) notify(`가져온 폴더가 없어 탭을 닫았습니다: ${[...gone].map((a) => `@${a}`).join(', ')}`)
  }, [mounts, root])

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

  // ---- 새 파일 · 새 폴더 · 이름 바꾸기 · 지우기 (DESIGN §24.6)
  // 이름은 앱 대화상자로 받는다. 검사와 실제 동작을 창의 submit 안에서 해, 안 되면 창을 닫지 않고 칸 아래에 이유를 보인다.
  // 창이 떠 있는 동안 트리 · 문서 상태가 바뀔 수 있어 submit 안에서 (ref 와 스토어로) 다시 읽는다.
  const pathTaken = (lower: string) => lowerPaths(treeRef.current).has(lower)

  /**
   * 읽기 전용으로 가져온 폴더 안이면 알림 줄로 알리고 true — 대화상자를 띄우기 **전에** 막는다 (DESIGN §24.7 X9).
   * 예전에는 이름을 다 치고 확인을 누른 뒤에야 백엔드가 거부했다. 마지막 판단은 여전히 백엔드가 한다.
   */
  const blockedReadOnly = (path: string, what: string) => {
    if (store.readOnlyReason(path) !== 'mount') return false
    const { alias } = splitRootPath(path)
    notifyError(`읽기 전용으로 가져온 폴더(@${alias})에서는 ${what} 수 없습니다. 고치려면 트리에서 그 폴더를 오른쪽 클릭 → 읽기 전용 끄기`, { key: FILE_NOTICE })
    return true
  }

  /** 새 문서 창을 연다 (PLAN-skim SK8). 이름 검사 · 만들기는 창의 Enter 에서 `createDoc` 이 한다 */
  const newFile = useCallback((dir: string) => {
    if (blockedReadOnly(dir, '파일을 만들')) return
    setOverlay({ kind: 'newDoc', dir })
  }, [])

  /** 새 문서 창의 만들기. 문제가 있으면 그 이유(창은 닫히지 않고 칸 아래에 보인다), 되면 null */
  const createDoc = useCallback(async (path: string, choice: NewDocChoice): Promise<string | null> => {
    const problem = checkEntryPath(path, { kind: 'file', exists: pathTaken })
    if (problem) return problem
    let text = choice.body ?? ''
    if (choice.path) {
      // 내 템플릿은 읽은 글을 그대로 쓴다 — UTF-8 파일은 BOM · 줄바꿈까지 바이트가 같다 (PLAN-skim §5)
      try {
        const f = await backend().read(choice.path)
        if ((f.encoding ?? 'utf-8') !== 'utf-8') return `UTF-8 이 아닌 템플릿은 쓸 수 없습니다: ${choice.path}`
        text = f.text
      } catch (e) {
        return `템플릿을 읽지 못했습니다: ${(e as Error).message}`
      }
    }
    try {
      await backend().write(path, text, null)
    } catch (e) {
      // 트리에 안 보이던 파일과 겹치면 백엔드가 충돌로 막는다 (덮어쓰지 않는다)
      return e instanceof ConflictError ? `이미 있는 파일입니다: ${path}` : `만들지 못했습니다: ${(e as Error).message}`
    }
    setOverlay(null)
    dismissNotice(FILE_NOTICE)
    await refreshTree()
    // 만든 문서의 편집기로 포커스 — 바로 칠 수 있게 (DESIGN §24.7 X4). 창이 돌려준 포커스(트리 등)보다 뒤에 온다
    bench.current?.openFile(path, true)
    return null
  }, [refreshTree])

  /** 지금 문서(저장 전 편집 포함)를 주 폴더의 `_templates/` 에 쓴다 (PLAN-skim SK10). 겹치면 덮어쓰지 않는다 */
  const saveAsTemplate = useCallback(async () => {
    const src = bench.current?.activePath()
    if (!src) return
    if (store.fileText(src) === null) { notifyError('문서를 아직 읽는 중입니다', { key: FILE_NOTICE }); return }
    // 이미 있는 폴더는 그 이름(대소문자) 그대로 쓴다
    const dir = treeRef.current.find((e) => e.type === 'dir' && !e.mount && e.path.toLowerCase() === TEMPLATES_DIR)?.path ?? TEMPLATES_DIR
    const name = fileNameOf(src)
    const saved: { path: string | null } = { path: null }
    await askText({
      title: '현재 문서를 템플릿으로 저장',
      label: `이름 (주 폴더의 ${dir}/ 아래)`,
      hint: '새 문서 창의 "내 템플릿" 줄에 뜹니다. 저장하지 않은 편집도 들어갑니다',
      value: name,
      select: nameStemRange(name),
      okLabel: '저장',
      submit: async (input) => {
        const n = cleanEntryPath(input)
        if (n.includes('/')) return `이름에 / 를 쓸 수 없습니다 — ${dir}/ 바로 아래 파일만 템플릿으로 뜹니다`
        const path = n === '' ? '' : `${dir}/${n}`
        const problem = checkEntryPath(path, { kind: 'file', exists: pathTaken })
        if (problem) return problem
        const text = store.fileText(src)
        if (text === null) return '문서가 닫혔습니다'
        try {
          await backend().write(path, text, null)
        } catch (e) {
          return e instanceof ConflictError ? `이미 있는 파일입니다: ${path}` : `저장하지 못했습니다: ${(e as Error).message}`
        }
        saved.path = path
        return null
      },
    })
    if (!saved.path) return
    await refreshTree()
    notify(`템플릿으로 저장했습니다: ${saved.path} — 새 문서 창(${keysOf('newFile') ?? '새 파일'})의 "내 템플릿" 에 뜹니다`, { key: FILE_NOTICE })
  }, [refreshTree])

  const newFolder = useCallback(async (dir: string) => {
    if (blockedReadOnly(dir, '폴더를 만들')) return
    const initial = dir ? `${dir}/새 폴더` : '새 폴더'
    const made: { path: string | null } = { path: null }
    await askText({
      title: '새 폴더',
      label: '경로',
      value: initial,
      select: nameStemRange(initial),
      okLabel: '만들기',
      submit: async (input) => {
        const path = cleanEntryPath(input)
        const problem = checkEntryPath(path, { kind: 'dir', exists: pathTaken })
        if (problem) return problem
        try {
          await backend().mkdir(path)
        } catch (e) {
          return `만들지 못했습니다: ${(e as Error).message}`
        }
        made.path = path
        return null
      },
    })
    if (made.path) await refreshTree()
  }, [refreshTree])

  /** 경로 아래에 저장하지 않은 문서가 있으면 그 목록 */
  const dirtyUnder = (path: string, isDir: boolean) =>
    [...store.dirtyPaths()].filter((p) => p === path || (isDir && p.startsWith(path + '/')))

  const rename = useCallback(async (path: string, isDir: boolean) => {
    if (isDir) { notifyError('폴더 이름은 탐색기에서 바꾸세요. 트리는 자동으로 따라옵니다.', { key: FILE_NOTICE }); return }
    if (blockedReadOnly(path, '이름을 바꿀')) return
    const dirty = dirtyUnder(path, false)
    if (dirty.length) { notifyError('이름을 바꾸기 전에 먼저 저장하세요', { items: dirty, key: FILE_NOTICE }); return }
    const moved: { to: string | null } = { to: null }
    await askText({
      title: '이름 바꾸기 / 옮기기',
      label: '파일의 새 경로',
      hint: '폴더 부분을 바꾸면 그 폴더로 옮겨집니다',
      value: path,
      // 확장자 앞의 이름만 선택 — 바로 치면 폴더와 확장자는 남는다
      select: nameStemRange(path),
      okLabel: '바꾸기',
      submit: async (input) => {
        const next = cleanEntryPath(input)
        if (next === path) return null // 그대로면 아무것도 하지 않고 닫는다
        const problem = checkEntryPath(next, { kind: 'file', exists: pathTaken, current: path })
        if (problem) return problem
        if (store.isDirty(path)) return '저장하지 않은 변경이 있습니다 — 먼저 저장하세요'
        try {
          await backend().rename(path, next)
        } catch (e) {
          return `바꾸지 못했습니다: ${(e as Error).message}`
        }
        moved.to = next
        return null
      },
    })
    if (!moved.to) return
    dismissNotice(FILE_NOTICE)
    bench.current?.renamePaths(path, moved.to, false)
    await refreshTree()
    // 트리 커서를 바뀐 파일에 둔다 — 안 그러면 커서가 사라져 ↓ 가 맨 위부터 간다 (TC-807)
    setTreeCursor(moved.to)
  }, [refreshTree])

  const remove = useCallback(async (path: string, isDir: boolean) => {
    const blocked = () => {
      const dirty = dirtyUnder(path, isDir)
      if (dirty.length) notifyError('저장하지 않은 문서가 있습니다. 먼저 저장하거나 닫으세요', { items: dirty, key: FILE_NOTICE })
      return dirty.length > 0
    }
    if (blockedReadOnly(path, '지울') || blocked()) return
    const inside = isDir ? filesUnder(treeRef.current, path) : []
    const ok = await askConfirm({
      title: isDir ? '폴더 지우기' : '파일 지우기',
      message: isDir ? `폴더 "${path}" 와 그 안의 모든 파일을 지웁니다. 휴지통으로 가지 않습니다. 계속할까요?` : `"${path}" 를 지웁니다. 휴지통으로 가지 않습니다. 계속할까요?`,
      items: inside,
      itemsLabel: `트리에 보이는 문서 ${inside.length}개 — 트리에 안 보이는 파일(그림 등)도 함께 지워집니다`,
      okLabel: '지우기',
      danger: true,
    })
    // 창이 떠 있는 동안 저장 안 한 문서가 생겼을 수 있다 — 다시 본다
    if (!ok || blocked()) return
    try {
      await backend().remove(path, isDir)
      dismissNotice(FILE_NOTICE)
      bench.current?.closePaths(path, isDir)
      await refreshTree()
    } catch (e) {
      notifyError(`지우지 못했습니다: ${(e as Error).message}`, { key: FILE_NOTICE })
    }
  }, [refreshTree])

  // ---- 가져온 폴더
  const unmount = useCallback(async (alias: string) => {
    const dirty = dirtyUnder(`@${alias}`, true)
    if (dirty.length) { notifyError('저장하지 않은 문서가 있습니다. 먼저 저장하거나 닫으세요', { items: dirty, key: FILE_NOTICE }); return }
    try {
      bench.current?.closePaths(`@${alias}`, true)
      await backend().removeRoot(alias)
      await refreshTree()
      notify(`가져오기를 해제했습니다: @${alias} — 파일은 그대로이고, 폴더 가져오기 창의 "최근 폴더" 에서 다시 가져올 수 있습니다`, { key: FILE_NOTICE })
    } catch (e) {
      notifyError(`해제하지 못했습니다: ${(e as Error).message}`, { key: FILE_NOTICE })
    }
  }, [refreshTree])

  // 읽기 전용을 끌 때 브라우저에 쓰기 권한을 묻는다 — 클릭 직후여야 하므로 그 앞에 대화상자를 끼우지 않는다 (실패만 알림 줄로)
  const toggleReadOnly = useCallback(async (alias: string) => {
    const m = mounts?.find((x) => x.alias === alias)
    if (!m) return
    if (!m.readOnly) {
      const dirty = dirtyUnder(`@${alias}`, true)
      if (dirty.length) { notifyError('읽기 전용으로 바꾸기 전에 저장하세요', { items: dirty, key: FILE_NOTICE }); return }
    }
    try {
      await backend().setRootReadOnly(alias, !m.readOnly)
      dismissNotice(FILE_NOTICE)
      await refreshTree()
    } catch (e) {
      notifyError(`바꾸지 못했습니다: ${(e as Error).message}`, { key: FILE_NOTICE })
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
    openInExplorer(full, () => notify('탐색기 창이 뜨지 않았다면 명령 팔레트의 "파일 탐색기 연결 도우미" 를 확인하세요', { key: FILE_NOTICE }))
  }, [])

  const copyLocalPath = useCallback((full: string) => {
    setOverlay(null)
    navigator.clipboard.writeText(full).then(() => notify(`경로를 복사했습니다: ${full}`, { key: FILE_NOTICE }), (e) => notifyError(`복사하지 못했습니다: ${(e as Error).message}`, { key: FILE_NOTICE }))
  }, [])

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
    notify(`가져왔습니다: @${m.alias}${m.readOnly ? ' (읽기 전용)' : ''} — ${m.folder}`, { key: FILE_NOTICE })
    runCommand('focusTree')
  }, [refreshTree])

  const switchFolder = useCallback(async () => {
    if (store.anyDirty()) { notifyError('저장하지 않은 문서가 있습니다. 먼저 저장하세요.', { items: [...store.dirtyPaths()], key: FILE_NOTICE }); return }
    await setCurrentWorkspace(null)
    location.reload()
  }, [])

  const applyUpdate = useCallback(() => {
    if (store.anyDirty()) { notifyError('저장하지 않은 문서가 있습니다. 저장한 뒤 적용하세요.', { items: [...store.dirtyPaths()], key: UPDATE_NOTICE }); return }
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
    { id: 'checkUpdate', label: '업데이트 확인', run: () => void checkForUpdate(updateNotice), enabled: () => app.canCheck },
    { id: 'applyUpdate', label: '새 버전 지금 적용', run: applyUpdate, enabled: () => app.updateReady },
    { id: 'save', label: '저장', run: () => bench.current?.saveActive() },
    { id: 'saveAll', label: '모두 저장', run: () => void store.saveAll(), enabled: () => store.anyDirty() },
    { id: 'palette', label: '명령 팔레트', run: () => setOverlay({ kind: 'palette' }) },
    { id: 'fileSearch', label: '파일 검색', run: () => setOverlay({ kind: 'files' }) },
    { id: 'help', label: '단축키 도움말', run: () => setOverlay({ kind: 'help' }) },
    { id: 'toggleTheme', label: '다크 / 라이트 전환', run: toggleTheme },
    { id: 'newFile', label: '새 파일…', run: () => newFile(lastDir.current) },
    { id: 'saveAsTemplate', label: '현재 문서를 템플릿으로 저장…', run: () => void saveAsTemplate(), enabled: () => !!bench.current?.activePath() },
    { id: 'newFolder', label: '새 폴더', run: () => void newFolder(lastDir.current) },
    { id: 'refreshTree', label: '파일 트리 새로고침', run: () => void refreshTree() },
    { id: 'dismissNotices', label: '알림 모두 닫기', run: dismissAllNotices, enabled: () => noticeList().length > 0 },
  ]), [newFile, saveAsTemplate, newFolder, refreshTree, switchFolder, applyUpdate, app, editRoot, localAction])

  const closeOverlay = useCallback(() => { setOverlay(null); runCommand('focusEditor') }, [])

  // ---- 전역 키 처리. 창(에디터·그리드)이 먼저 처리해 preventDefault 한 키는 건드리지 않는다
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return
      const combo = comboFromEvent(e)
      if (!combo) return
      const id = commandByCombo.get(combo)
      if (!id) return
      // 앱 대화상자가 떠 있으면 명령을 돌리지 않는다 (뒤에서 저장 · 창 이동이 일어나지 않게).
      // 키는 삼킨다 — 안 그러면 Ctrl+S · Ctrl+P 가 브라우저의 저장 · 인쇄 창을 띄운다
      if (dialogOpen()) { e.preventDefault(); return }
      // 팔레트 · 도움말 · 가져오기 같은 창이 떠 있을 때도 같은 규칙이다 (DESIGN §24.7 X5).
      // 예외는 창을 여닫는 키뿐: 그 창을 연 키를 다시 누르면 닫고, 찾아보는 창끼리는 서로의 키로 넘어간다. Esc 는 창이 직접 받는다
      const ov = overlayRef.current
      if (ov) {
        e.preventDefault()
        if (id === OVERLAY_COMMAND[ov.kind]) closeOverlay()
        else if (LOOKUP_OVERLAYS.has(ov.kind) && LOOKUP_COMMANDS.has(id)) runCommand(id)
        return
      }
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
  }, [closeOverlay])

  // 글자를 칠 때마다가 아니라 저장 안 한 문서의 구성이 바뀔 때만 다시 그린다
  const dirtyCount = useDirtyPaths().size
  const watching = backend().watching()
  const primary = backend().rootDetail(null)

  const paletteItems = useMemo<PaletteItem[]>(() => {
    // 최근 순 (DESIGN §24.7 X6): 팔레트로 실행한 명령 · 연 파일이 위에 온다. 지금 못 쓰는 명령은 올리지 않고, 없어진 파일은 목록에 없으니 저절로 빠진다
    if (overlay?.kind === 'palette') {
      const ranks = recentRanks(recentCommands())
      return allCommands().map((c) => {
        const disabled = c.enabled ? !c.enabled() : false
        return { id: c.id, label: c.label, hint: c.keys, disabled, recent: disabled ? undefined : ranks.get(c.id) }
      })
    }
    if (overlay?.kind === 'files') {
      const ranks = recentRanks(recentFiles(layoutId))
      return allFiles(tree).map((path) => ({ id: path, label: path.split('/').pop() ?? path, hint: path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '', recent: ranks.get(path) }))
    }
    return []
  }, [overlay, tree, layoutId])

  /** 팔레트에서 명령을 실행한 뒤: 팔레트가 사라지며 포커스가 body 로 빠졌으면 문서 창으로 돌린다.
   *  다른 창을 연 명령(가져오기 · 도움말 …)이나 스스로 포커스를 옮긴 명령(트리로 포커스 …)은 건드리지 않는다. */
  const pickCommand = useCallback((id: string) => {
    setOverlay(null)
    if (runCommand(id)) recordRecentCommand(id)
    window.setTimeout(() => {
      if (overlayRef.current) return
      const ae = document.activeElement
      if (!ae || ae === document.body) runCommand('focusEditor')
    }, 80)
  }, [])

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">JayDocs</span>
        <button className="root" title={`문서 폴더 바꾸기${primary.path ? `\n${primary.path}` : ''}`} onClick={() => void switchFolder()}>{root ? primary.label : '…'}</button>
        <span className="spacer" />
        {error && <span className="topbar-error" title={error}>오류: {error}</span>}
        <UpdateButton notify={updateNotice} onApply={applyUpdate} />
        {app.canInstall && <button onClick={() => void app.install()} title="시작 메뉴에서 열고 폴더 권한을 유지합니다">앱으로 설치</button>}
        <button onClick={() => setOverlay({ kind: 'import' })} title={tip('폴더 가져오기 — 다른 폴더를 원래 자리에서 열기', 'importFolder')}>📂 가져오기</button>
        <span className={'conn' + (watching ? ' is-on' : '')} title={watching ? '파일 변경 감시 중' : '이 브라우저는 실시간 감시가 없어 몇 초마다 확인합니다'}>●</span>
        {/* 상단의 "저장" · "오른쪽에 분할" 은 뺐다 — 창마다 같은 버튼이 있고(어느 문서인지 분명하다) Ctrl+S · Ctrl+\ · 팔레트로도 된다 (DESIGN §24.7 X10) */}
        <button onClick={() => setOverlay({ kind: 'palette' })} title={tip('명령 팔레트', 'palette')}>명령</button>
        <button onClick={() => void store.saveAll()} disabled={dirtyCount === 0} title={tip('모두 저장', 'saveAll')}>
          모두 저장{dirtyCount ? ` (${dirtyCount})` : ''}
        </button>
        <button onClick={toggleTheme} title={tip('다크 / 라이트', 'toggleTheme')}>{theme === 'dark' ? '☀' : '☾'}</button>
        <button onClick={() => setOverlay({ kind: 'help' })} title={tip('단축키', 'help')}>?</button>
      </header>
      <main className="workbench">
        {root && (
          <Workbench
            ref={bench}
            layoutId={layoutId}
            tree={tree}
            onRefresh={() => void refreshTree()}
            onSelectDir={(d) => { lastDir.current = d }}
            onNewFile={(d) => newFile(d)}
            onNewFolder={(d) => void newFolder(d)}
            onRename={(path, isDir) => void rename(path, isDir)}
            onDelete={(path, isDir) => void remove(path, isDir)}
            onRootAction={rootAction}
          />
        )}
      </main>
      {overlay?.kind === 'palette' && (
        <Palette title="명령 팔레트" placeholder="명령 이름…" items={paletteItems} onClose={closeOverlay} onPick={pickCommand} />
      )}
      {overlay?.kind === 'files' && (
        <Palette title="파일 검색" placeholder="파일 이름이나 경로…" items={paletteItems} onClose={closeOverlay} onPick={(id) => { setOverlay(null); bench.current?.openFile(id, true) }} />
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
      {/* 닫으면 창이 스스로 부르던 곳(트리 · 편집기)으로 포커스를 돌려준다 — 이름 입력 대화상자와 같은 규칙 */}
      {overlay?.kind === 'newDoc' && <NewDocDialog dir={overlay.dir} userTemplates={userTemplatePaths(tree)} onCreate={createDoc} onClose={() => setOverlay(null)} />}
    </div>
  )
}
