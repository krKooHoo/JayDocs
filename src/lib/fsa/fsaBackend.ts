import { ConflictError, type Backend, type ChangeEvent, type FileData, type MountInfo, type MountTree, type RootDetail, type RootsInfo, type TreeEntry } from '../backend'
import { DOC_EXTS, MAX_TEXT_BYTES } from '../filetypes.mjs'
import { checkPath, cleanPath, joinLocal } from '../localPath'
import { MOUNT_IGNORE_DIRS, MOUNT_SCAN_LIMIT, isValidAlias, joinRootPath, makeAlias, splitRootPath } from '../roots.mjs'
import { requestRoot, type StoredRoot, type Workspace } from './workspace'

type Dir = FileSystemDirectoryHandle

const EXTS = new Set<string>(DOC_EXTS)
const IGNORE_DIRS = new Set(['.git', 'node_modules'])
const RECENT_MAX = 10
const DEBOUNCE_MS = 150
/** 변경 감지 API 가 없을 때 다시 확인하는 간격 */
const POLL_MS = 5000

/** 미리보기 이미지로 내보낼 수 있는 형식 */
const RAW_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.avif': 'image/avif',
}

function extOf(name: string) {
  const dot = name.lastIndexOf('.')
  return dot < 0 ? '' : name.slice(dot).toLowerCase()
}

const UTF8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })
const EUCKR = new TextDecoder('euc-kr', { ignoreBOM: true })

/**
 * 바이트 → 텍스트. UTF-8 로 읽히면 그대로 (BOM 은 남긴다 — 앱이 보존한다).
 * 아니면 EUC-KR(CP949) 로 읽고 encoding 으로 알린다 — 앱은 읽기 전용으로 연다.
 * NUL 바이트나 UTF-16 BOM 이 있으면 텍스트 파일이 아니다.
 */
export function decodeText(buf: Uint8Array): { text: string; encoding: string } {
  if ((buf[0] === 0xff && buf[1] === 0xfe) || (buf[0] === 0xfe && buf[1] === 0xff)) throw new Error('UTF-16 파일은 열 수 없습니다 — UTF-8 로 저장한 뒤 여세요')
  if (buf.includes(0)) throw new Error('텍스트 파일이 아닙니다 (바이너리)')
  try {
    return { text: UTF8.decode(buf), encoding: 'utf-8' }
  } catch {
    return { text: EUCKR.decode(buf), encoding: 'euc-kr' }
  }
}

const FS_ERRORS: Record<string, string> = {
  NotFoundError: '경로가 없습니다',
  NotAllowedError: '폴더 접근 권한이 없습니다 — 앱을 다시 열어 허용하세요',
  SecurityError: '폴더 접근 권한이 없습니다 — 앱을 다시 열어 허용하세요',
  NoModificationAllowedError: '다른 프로그램이 파일을 쓰고 있습니다 — 그 프로그램을 닫고 다시 시도하세요',
  InvalidStateError: '다른 프로그램이 파일을 열고 있습니다 — 그 프로그램을 닫고 다시 시도하세요',
  InvalidModificationError: '비어 있지 않은 폴더입니다',
  TypeMismatchError: '파일과 폴더의 종류가 맞지 않습니다',
  QuotaExceededError: '디스크 공간이 부족합니다',
  TypeError: '이름에 쓸 수 없는 글자가 있습니다',
}

/** 브라우저 오류를 알아들을 수 있는 말로. 모르는 오류는 그대로 */
function fsFail(e: unknown, what: string): Error {
  const msg = FS_ERRORS[(e as Error)?.name]
  return msg ? new Error(`${what}: ${msg}`) : (e as Error)
}

/** 파일만 가져온 루트에서 할 수 없는 일 */
const FILE_ROOT_ONLY = '파일 하나만 가져온 곳입니다 — 그 파일을 고쳐 저장하는 것만 됩니다. 새 파일 · 이름 바꾸기 · 지우기는 원래 폴더에서 하세요'

const domError = (name: string) => Object.assign(new Error(name), { name })

/** 확장자를 뗀 이름 — 파일을 가져올 때 별칭으로 쓴다 */
const stemOf = (name: string) => {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(0, dot) : name
}

/**
 * 파일 하나만 가져온 루트 (DESIGN §28). 그 파일 하나만 든 폴더처럼 보이게 해서 트리 · 읽기 · 저장 코드를 그대로 쓴다.
 * 새 파일 · 폴더 · 지우기 · 이름 바꾸기는 할 수 없다 — `locateWritable` 이 먼저 막고 여기서도 막는다.
 */
class SingleFileDir {
  readonly kind = 'directory' as const
  constructor(readonly file: FileSystemFileHandle) {}
  get name() { return this.file.name }
  private is(name: string) { return name.toLowerCase() === this.file.name.toLowerCase() }
  async getFileHandle(name: string, opts: { create?: boolean } = {}) {
    if (this.is(name)) return this.file
    throw domError(opts.create ? 'NotAllowedError' : 'NotFoundError')
  }
  async getDirectoryHandle(name: string, opts: { create?: boolean } = {}): Promise<never> {
    throw domError(this.is(name) ? 'TypeMismatchError' : opts.create ? 'NotAllowedError' : 'NotFoundError')
  }
  async removeEntry(): Promise<never> { throw domError('NotAllowedError') }
  async *entries(): AsyncGenerator<[string, FileSystemHandle]> { yield [this.file.name, this.file] }
  async *keys(): AsyncGenerator<string> { yield this.file.name }
  async *values(): AsyncGenerator<FileSystemHandle> { yield this.file }
  async resolve(h: FileSystemHandle) { return (await this.file.isSameEntry(h)) ? [this.file.name] : null }
  async isSameEntry() { return false }
  queryPermission(d?: FileSystemHandlePermissionDescriptor) { return this.file.queryPermission(d) }
  requestPermission(d?: FileSystemHandlePermissionDescriptor) { return this.file.requestPermission(d) }
}

const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i])

async function readLimited(file: File): Promise<Uint8Array> {
  if (file.size > MAX_TEXT_BYTES) throw new Error(`파일이 너무 큽니다 (${(file.size / 1024 / 1024).toFixed(1)} MB, 최대 ${MAX_TEXT_BYTES / 1024 / 1024} MB)`)
  return new Uint8Array(await file.arrayBuffer())
}

async function writeAll(h: FileSystemFileHandle, data: string | Uint8Array<ArrayBuffer>) {
  const w = await h.createWritable()
  try {
    await w.write(data)
    await w.close()
  } catch (e) {
    await w.abort().catch(() => { /* 이미 닫힘 */ })
    throw e
  }
}

interface Located {
  root: Root
  /** 정규화한 앱 경로 */
  rel: string
  /** 루트 안 경로 조각 */
  segs: string[]
}

/** 주 폴더(alias null) 또는 가져온 폴더. 파일만 가져왔으면 handle 은 그 파일 하나만 든 폴더(SingleFileDir) */
interface Root {
  alias: string | null
  handle: Dir
  readOnly: boolean
  file: boolean
}

export interface FsaBackendOptions {
  save(w: Workspace): Promise<void>
  /** 변경 감지 구현. 없으면(null) 주기적으로 다시 확인한다. 시험에서 바꿔 끼운다 */
  Observer?: typeof FileSystemObserver | null
}

export class FsaBackend implements Backend {
  private save: (w: Workspace) => Promise<void>
  private Observer: typeof FileSystemObserver | null
  private handlers = new Set<(e: ChangeEvent) => void>()
  private observers = new Map<string, FileSystemObserver>()
  private pending = new Map<string, { timer: ReturnType<typeof setTimeout>; event: 'rename' | 'change' }>()
  private stopWatching: (() => void) | null = null

  constructor(private ws: Workspace, opts: FsaBackendOptions) {
    this.save = opts.save
    this.Observer = opts.Observer !== undefined ? opts.Observer : typeof FileSystemObserver === 'function' ? FileSystemObserver : null
  }

  private primary(): Root {
    return { alias: null, handle: this.ws.primary, readOnly: false, file: false }
  }

  private fileDirs = new WeakMap<FileSystemFileHandle, Dir>()

  /** 저장해 둔 가져온 폴더 · 파일 → 백엔드가 다루는 루트 */
  private rootOf(m: StoredRoot): Root {
    if (m.handle.kind === 'directory') return { alias: m.alias, handle: m.handle as Dir, readOnly: m.readOnly, file: false }
    const f = m.handle as FileSystemFileHandle
    let d = this.fileDirs.get(f)
    if (!d) { d = new SingleFileDir(f) as unknown as Dir; this.fileDirs.set(f, d) }
    return { alias: m.alias, handle: d, readOnly: m.readOnly, file: true }
  }

  private mountInfo(m: StoredRoot, truncated = false): MountInfo {
    return { alias: m.alias, folder: m.handle.name, readOnly: m.readOnly, truncated, path: m.path ?? null, file: m.handle.kind === 'file' }
  }

  private checkedPath(raw: string, folder: string) {
    const path = cleanPath(raw)
    const problem = path ? checkPath(path, folder) : null
    if (problem) throw new Error(problem)
    return path || undefined
  }

  // ---------------------------------------------------------------- 경로
  /** 앱 경로를 루트와 그 안 경로 조각으로. `..`, 절대 경로, `.git` 을 거부한다 */
  private async locate(path: string): Promise<Located> {
    if (typeof path !== 'string' || path === '') throw new Error('경로가 필요합니다')
    const rel = path.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '')
    const parts = rel.split('/')
    if (rel === '' || parts.some((s) => s === '..' || s === '' || s === '.')) throw new Error('잘못된 경로')
    if (/^[a-zA-Z]:/.test(rel)) throw new Error('절대 경로는 쓸 수 없습니다')
    if (parts.some((s) => s.toLowerCase() === '.git')) throw new Error('.git 폴더는 건드릴 수 없습니다')
    const { alias, rel: inner } = splitRootPath(rel)
    if (alias === null) return { root: this.primary(), rel, segs: parts }
    const mount = this.ws.mounts.find((m) => m.alias === alias)
    if (mount) {
      if (inner === '') throw new Error('가져온 폴더 자체에는 쓸 수 없습니다')
      return { root: this.rootOf(mount), rel, segs: inner.split('/') }
    }
    // 주 폴더 최상위에 진짜 `@이름` 폴더가 있으면 그쪽 (가져오기가 그 별칭을 쓰지 못하게 막아 둔다)
    if (await this.primaryHasDir(`@${alias}`)) return { root: this.primary(), rel, segs: parts }
    throw new Error(`가져온 폴더가 없습니다 (@${alias}) — 해제되었습니다`)
  }

  private async primaryHasDir(name: string) {
    try {
      await this.ws.primary.getDirectoryHandle(name)
      return true
    } catch {
      return false
    }
  }

  /**
   * 쓰기(저장·폴더 만들기·이름 바꾸기·지우기)용 — 읽기 전용으로 가져온 폴더면 거부.
   * 파일 하나만 가져온 곳은 그 파일의 저장(`save`)만 된다
   */
  private async locateWritable(path: string, op: 'save' | 'change' = 'change') {
    const l = await this.locate(path)
    if (l.root.readOnly) {
      const what = l.root.file ? '파일' : '폴더'
      throw new Error(`읽기 전용으로 가져온 ${what}입니다 (@${l.root.alias}) — 트리에서 @${l.root.alias} 를 오른쪽 클릭해 읽기 전용을 끌 수 있습니다`)
    }
    if (l.root.file && op !== 'save') throw new Error(FILE_ROOT_ONLY)
    return l
  }

  private async dirAt(root: Dir, segs: string[], create = false): Promise<Dir> {
    let d = root
    for (const s of segs) d = await d.getDirectoryHandle(s, { create })
    return d
  }

  private parent(l: Located, create = false) {
    return this.dirAt(l.root.handle, l.segs.slice(0, -1), create)
  }

  private fileOf(l: Located) {
    return this.parent(l).then((d) => d.getFileHandle(l.segs[l.segs.length - 1]))
  }

  /** 항목 종류. 없으면 null */
  private async kindOf(l: Located): Promise<'file' | 'dir' | null> {
    const name = l.segs[l.segs.length - 1]
    let dir: Dir
    try {
      dir = await this.parent(l)
    } catch (e) {
      // 중간 경로가 없거나 파일이면 그 항목도 없다
      const n = (e as Error).name
      if (n === 'NotFoundError' || n === 'TypeMismatchError') return null
      throw e
    }
    try {
      await dir.getFileHandle(name)
      return 'file'
    } catch (e) {
      const n = (e as Error).name
      if (n === 'NotFoundError') return null
      if (n === 'TypeMismatchError') return 'dir'
      throw e
    }
  }

  // ---------------------------------------------------------------- 정보 · 트리
  async info() {
    return { root: this.ws.primary.name, id: this.ws.id }
  }

  async roots(): Promise<RootsInfo> {
    return {
      mounts: this.ws.mounts.map((m) => this.mountInfo(m)),
      recent: this.ws.recent.map((m) => ({ alias: m.alias, folder: m.handle.name, readOnly: m.readOnly, path: m.path ?? null, file: m.handle.kind === 'file' })),
    }
  }

  rootDetail(alias: string | null): RootDetail {
    if (alias === null) {
      const folder = this.ws.primary.name
      return { alias: null, folder, label: this.ws.label || folder, path: this.ws.path ?? null }
    }
    const m = this.ws.mounts.find((x) => x.alias === alias)
    if (!m) throw new Error(`가져온 폴더가 없습니다 (@${alias})`)
    return { alias, folder: m.handle.name, label: `@${alias}`, path: m.path ?? null, file: m.handle.kind === 'file' }
  }

  async updateRoot(alias: string | null, info: { label?: string; path: string }) {
    const before = this.rootDetail(alias)
    const path = this.checkedPath(info.path, before.folder)
    const m = this.ws.mounts.find((x) => x.alias === alias)
    if (m) m.path = path
    else {
      this.ws.label = info.label || undefined
      this.ws.path = path
    }
    await this.save(this.ws)
    return this.rootDetail(alias)
  }

  localPath(path: string) {
    const { alias, rel } = splitRootPath(path)
    // 주 폴더의 진짜 `@이름` 폴더는 가져온 폴더가 아니다
    const mount = alias !== null ? this.ws.mounts.find((m) => m.alias === alias) : undefined
    const root = this.rootDetail(mount ? alias : null)
    // 파일 하나만 가져왔으면 상세 경로가 곧 그 파일의 경로다
    if (mount?.handle.kind === 'file') return { root, full: root.path }
    return { root, full: root.path ? joinLocal(root.path, mount ? rel : path) : null }
  }

  /**
   * 폴더 트리 (문서 형식만). 경로는 앱 경로(가져온 폴더면 `@별칭/` 접두).
   * 가져온 폴더는 Unity 같은 큰 폴더를 생각해 — 기본 무시 폴더를 더 빼고, 문서가 없는 폴더는 접어 버린다.
   * 항목은 MOUNT_SCAN_LIMIT 개까지만 훑는다 (넘으면 truncated). 읽을 수 없는 하위 폴더는 건너뛴다.
   */
  private async scan(root: Root): Promise<{ entries: TreeEntry[]; truncated: boolean }> {
    const isMount = root.alias !== null
    const ignore = isMount ? new Set([...IGNORE_DIRS, ...MOUNT_IGNORE_DIRS]) : IGNORE_DIRS
    const ctx = { budget: MOUNT_SCAN_LIMIT, truncated: false }
    const walk = async (dir: Dir, rel: string): Promise<TreeEntry[]> => {
      const entries: TreeEntry[] = []
      try {
        for await (const [name, h] of dir.entries()) {
          if (name.startsWith('.') || ignore.has(name)) continue
          if (--ctx.budget < 0) { ctx.truncated = true; break }
          const inner = rel ? `${rel}/${name}` : name
          const appPath = joinRootPath(root.alias, inner)
          if (h.kind === 'directory') {
            const children = await walk(h as Dir, inner)
            if (isMount && children.length === 0) continue
            entries.push({ type: 'dir', name, path: appPath, children })
          } else if (EXTS.has(extOf(name))) {
            entries.push({ type: 'file', name, path: appPath })
          }
        }
      } catch (e) {
        if (rel === '') throw e // 폴더 자체를 못 읽으면 위에서 알린다. 안쪽 폴더면 건너뛴다
      }
      entries.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name, 'ko') : a.type === 'dir' ? -1 : 1))
      return entries
    }
    return { entries: await walk(root.handle, ''), truncated: ctx.truncated }
  }

  private async mountTree(m: StoredRoot): Promise<MountTree> {
    try {
      const { entries, truncated } = await this.scan(this.rootOf(m))
      return { ...this.mountInfo(m, truncated), entries, error: null }
    } catch (e) {
      return { ...this.mountInfo(m), entries: [], error: fsFail(e, '폴더를 읽지 못했습니다').message }
    }
  }

  async tree() {
    const primary = await this.scan(this.primary()).catch((e) => { throw fsFail(e, '문서 폴더를 읽지 못했습니다') })
    return { root: this.ws.primary.name, entries: primary.entries, truncated: primary.truncated, mounts: await Promise.all(this.ws.mounts.map((m) => this.mountTree(m))) }
  }

  // ---------------------------------------------------------------- 가져온 폴더
  /**
   * 폴더나 파일 하나를 `@별칭` 으로 연다. 겹침(주 폴더·다른 가져온 폴더 안이거나 그것들을 품음)과 별칭을 검사한다.
   * 파일은 여는 형식(`filetypes.mjs`)만 — 별칭은 확장자를 뗀 이름 (DESIGN §28)
   */
  async addRoot(handle: Dir | FileSystemFileHandle, opts: { alias?: string; readOnly?: boolean; path?: string } = {}): Promise<MountInfo> {
    const readOnly = opts.readOnly === true
    const isFile = handle.kind === 'file'
    if (isFile && !EXTS.has(extOf(handle.name))) throw new Error(`여는 문서 형식이 아닙니다: ${handle.name} — ${DOC_EXTS.join(' · ')} 파일만 가져옵니다`)
    const path = this.checkedPath(opts.path ?? '', handle.name)
    const what = isFile ? '파일' : '폴더'
    const others: { alias: string | null; handle: FileSystemHandle }[] = [{ alias: null, handle: this.ws.primary }, ...this.ws.mounts]
    for (const r of others) {
      const name = r.alias === null ? '주 문서 폴더' : `@${r.alias}`
      if (r.handle.kind === 'directory') {
        if ((await (r.handle as Dir).resolve(handle)) !== null) throw new Error(`이미 열려 있는 ${name} 안의 ${what}입니다`)
      } else if (await r.handle.isSameEntry(handle)) throw new Error(`이미 가져온 파일입니다 (${name})`)
      if (!isFile && (await (handle as Dir).resolve(r.handle)) !== null) throw new Error(`이 폴더 안에 ${name} 이 들어 있어 겹칩니다 — 겹치지 않는 폴더를 고르세요`)
    }
    const taken = this.ws.mounts.map((m) => m.alias)
    const typed = opts.alias?.trim()
    const alias = typed ? typed : makeAlias(isFile ? stemOf(handle.name) : handle.name, taken)
    if (!isValidAlias(alias)) throw new Error(`별칭으로 쓸 수 없습니다: ${alias} (40자 이하, / \\ : * ? " < > | 와 맨 앞 점 제외)`)
    if (taken.some((t) => t.toLowerCase() === alias.toLowerCase())) throw new Error(`이미 쓰는 별칭입니다: @${alias}`)
    if (await this.primaryHasDir(`@${alias}`)) throw new Error(`주 폴더에 "@${alias}" 폴더가 있어 그 별칭은 쓸 수 없습니다`)
    if ((await requestRoot(handle, readOnly)) !== 'granted') throw new Error(`${what} 접근을 허용하지 않았습니다`)
    const m: StoredRoot = { alias, handle, readOnly, path }
    this.ws.mounts.push(m)
    const recent: StoredRoot[] = []
    for (const r of this.ws.recent) if (!(await r.handle.isSameEntry(handle))) recent.push(r)
    this.ws.recent = recent
    await this.save(this.ws)
    if (this.stopWatching) void this.watchRoot(this.rootOf(m))
    this.emit({ type: 'change', event: 'rename', path: `@${alias}` })
    return this.mountInfo(m)
  }

  async pathOf(handle: FileSystemHandle): Promise<string | null> {
    const inPrimary = await this.ws.primary.resolve(handle)
    if (inPrimary) return inPrimary.join('/')
    for (const m of this.ws.mounts) {
      if (m.handle.kind === 'directory') {
        const inner = await (m.handle as Dir).resolve(handle)
        if (inner) return joinRootPath(m.alias, inner.join('/'))
      } else if (await m.handle.isSameEntry(handle)) return joinRootPath(m.alias, m.handle.name)
    }
    return null
  }

  async restoreRoot(alias: string) {
    const r = this.ws.recent.find((x) => x.alias === alias)
    if (!r) throw new Error(`최근 목록에 없습니다: @${alias}`)
    return this.addRoot(r.handle, { alias: r.alias, readOnly: r.readOnly, path: r.path })
  }

  async setRootReadOnly(alias: string, readOnly: boolean) {
    const m = this.ws.mounts.find((x) => x.alias === alias)
    if (!m) throw new Error(`가져온 폴더가 없습니다 (@${alias})`)
    if (!readOnly && (await requestRoot(m.handle, false)) !== 'granted') throw new Error('쓰기 권한을 허용하지 않았습니다')
    m.readOnly = readOnly
    await this.save(this.ws)
    this.emit({ type: 'change', event: 'rename', path: `@${alias}` })
    return this.mountInfo(m)
  }

  async removeRoot(alias: string) {
    const m = this.ws.mounts.find((x) => x.alias === alias)
    if (!m) throw new Error(`가져온 폴더가 없습니다 (@${alias})`)
    this.observers.get(alias)?.disconnect()
    this.observers.delete(alias)
    this.ws.mounts = this.ws.mounts.filter((x) => x !== m)
    this.ws.recent = [m, ...this.ws.recent.filter((x) => x.alias !== alias)].slice(0, RECENT_MAX)
    await this.save(this.ws)
    this.emit({ type: 'change', event: 'rename', path: `@${alias}` })
  }

  async forgetRoot(alias: string) {
    this.ws.recent = this.ws.recent.filter((x) => x.alias !== alias)
    await this.save(this.ws)
  }

  // ---------------------------------------------------------------- 파일
  async read(path: string): Promise<FileData> {
    const l = await this.locate(path)
    try {
      const file = await (await this.fileOf(l)).getFile()
      return { path: l.rel, mtime: file.lastModified, ...decodeText(await readLimited(file)) }
    } catch (e) {
      throw fsFail(e, '읽지 못했습니다')
    }
  }

  async stat(path: string): Promise<{ mtime: number; size: number }> {
    const l = await this.locate(path)
    try {
      const file = await (await this.fileOf(l)).getFile()
      return { mtime: file.lastModified, size: file.size }
    } catch (e) {
      throw fsFail(e, '읽지 못했습니다')
    }
  }

  async write(path: string, text: string, baseMtime: number | null, opts: { convert?: boolean } = {}) {
    if (typeof text !== 'string') throw new Error('text 가 필요합니다')
    const l = await this.locateWritable(path, 'save')
    const kind = await this.kindOf(l)
    if (kind === 'dir') throw new Error('파일이 아닙니다')
    if (l.root.file && kind === null) throw new Error(FILE_ROOT_ONLY)
    try {
      if (kind === 'file') {
        const file = await (await this.fileOf(l)).getFile()
        const disk = decodeText(await readLimited(file))
        // 낙관적 잠금: 디스크가 더 새로우면 디스크 내용과 함께 거부한다
        if (typeof baseMtime !== 'number' || Math.abs(file.lastModified - baseMtime) >= 1) throw new ConflictError(file.lastModified, disk.text, disk.encoding)
        // UTF-8 이 아닌 파일은 앱이 읽기 전용으로 연다. 덮어쓰기는 "UTF-8 로 바꿔 저장"(convert) 때만
        if (opts.convert !== true && disk.encoding !== 'utf-8') throw new Error('UTF-8 이 아닌 파일입니다 — "UTF-8 로 바꿔 저장" 으로만 덮어쓸 수 있습니다')
      }
      const dir = await this.parent(l, true)
      const h = await dir.getFileHandle(l.segs[l.segs.length - 1], { create: true })
      await writeAll(h, text)
      return { mtime: (await h.getFile()).lastModified }
    } catch (e) {
      if (e instanceof ConflictError) throw e
      throw fsFail(e, '저장하지 못했습니다')
    }
  }

  async mkdir(path: string) {
    const l = await this.locateWritable(path)
    try {
      await this.dirAt(l.root.handle, l.segs, true)
    } catch (e) {
      throw fsFail(e, '폴더를 만들지 못했습니다')
    }
  }

  async rename(fromPath: string, toPath: string) {
    const from = await this.locateWritable(fromPath)
    const to = await this.locateWritable(toPath)
    if (from.root.alias !== to.root.alias) throw new Error('다른 폴더(주 폴더 ↔ 가져온 폴더)로는 옮길 수 없습니다')
    if (from.rel === to.rel) throw new Error('같은 경로입니다')
    const kind = await this.kindOf(from)
    if (!kind) throw new Error('원본이 없습니다')
    if (kind === 'dir') throw new Error('폴더 이름은 탐색기에서 바꾸세요 — 트리는 자동으로 따라옵니다')
    const fromName = from.segs[from.segs.length - 1]
    const toName = to.segs[to.segs.length - 1]
    const samePlace = from.segs.slice(0, -1).join('/').toLowerCase() === to.segs.slice(0, -1).join('/').toLowerCase()
    try {
      const toDir = await this.parent(to, true)
      // 대상 검사는 이름 목록으로 한다. move() 는 있는 파일을 경고 없이 덮어쓰고, Windows 는 대소문자를 가리지 않는다.
      for await (const name of toDir.keys()) {
        if (name.toLowerCase() === toName.toLowerCase() && !(samePlace && name === fromName)) throw new Error('대상이 이미 있습니다')
      }
      const h = await this.fileOf(from)
      await this.moveFile(h, await this.parent(from), toDir, fromName, toName, samePlace)
    } catch (e) {
      throw fsFail(e, '이름을 바꾸지 못했습니다')
    }
  }

  /** move() 가 막히면 (Chrome 은 NotAllowedError) 복사 → 바이트 확인 → 원본 삭제로 옮긴다 */
  private async moveFile(h: FileSystemFileHandle, fromDir: Dir, toDir: Dir, fromName: string, toName: string, samePlace: boolean) {
    try {
      await (samePlace ? h.move(toName) : h.move(toDir, toName))
      return
    } catch (e) {
      if ((e as Error).name !== 'NotAllowedError' && !(e instanceof TypeError)) throw e
    }
    const bytes = new Uint8Array(await (await h.getFile()).arrayBuffer())
    const copyTo = async (dir: Dir, name: string) => {
      const dst = await dir.getFileHandle(name, { create: true })
      await writeAll(dst, bytes)
      if (!sameBytes(bytes, new Uint8Array(await (await dst.getFile()).arrayBuffer()))) throw new Error(`복사한 내용이 다릅니다: ${name}`)
    }
    if (fromName.toLowerCase() === toName.toLowerCase() && samePlace) {
      // 대소문자만 바꾸면 복사본이 곧 원본이다 — 임시 이름을 거친다
      const tmp = `${fromName}.jaydocs-rename`
      await copyTo(fromDir, tmp)
      await fromDir.removeEntry(fromName)
      await copyTo(fromDir, toName)
      await fromDir.removeEntry(tmp)
      return
    }
    await copyTo(toDir, toName)
    await fromDir.removeEntry(fromName)
  }

  async remove(path: string, recursive = false) {
    const l = await this.locateWritable(path)
    const kind = await this.kindOf(l)
    if (!kind) throw new Error('파일이 없습니다')
    try {
      await (await this.parent(l)).removeEntry(l.segs[l.segs.length - 1], { recursive: kind === 'dir' && recursive })
    } catch (e) {
      throw fsFail(e, '지우지 못했습니다')
    }
  }

  async rawUrl(path: string) {
    const l = await this.locate(path)
    const type = RAW_MIME[extOf(l.segs[l.segs.length - 1])]
    if (!type) throw new Error('허용되지 않은 파일 형식입니다')
    const file = await (await this.fileOf(l)).getFile()
    return URL.createObjectURL(new Blob([file], { type }))
  }

  // ---------------------------------------------------------------- 변경 감지
  watching() {
    return this.Observer !== null
  }

  private emit(e: ChangeEvent) {
    for (const h of this.handlers) h(e)
  }

  /** 경로 하나의 변경. 몰려오는 이벤트(저장 한 번에 여러 건)를 경로별로 뭉친다 */
  private notify(root: Root, segs: string[], event: 'rename' | 'change') {
    const ignore = root.alias === null ? IGNORE_DIRS : new Set([...IGNORE_DIRS, ...MOUNT_IGNORE_DIRS])
    if (segs.some((s) => ignore.has(s) || s.startsWith('.'))) return
    const rel = segs.join('/')
    if (rel.toLowerCase().endsWith('.crswap')) return // 브라우저가 저장 중에 만드는 임시 파일
    const path = joinRootPath(root.alias, rel)
    const prev = this.pending.get(path)
    if (prev) clearTimeout(prev.timer)
    const merged = prev?.event === 'rename' ? 'rename' : event
    const timer = setTimeout(() => {
      this.pending.delete(path)
      this.emit({ type: 'change', event: merged, path })
    }, DEBOUNCE_MS)
    this.pending.set(path, { timer, event: merged })
  }

  private onRecords(root: Root, records: FileSystemChangeRecord[]) {
    for (let r of records) {
      // 파일을 보면 경로 조각이 비어서 온다 — 그 파일의 이름으로 바꾼다
      if (root.file && r.relativePathComponents.length === 0 && r.type !== 'errored' && r.type !== 'unknown') r = { ...r, relativePathComponents: [root.handle.name] }
      if (r.type === 'errored' || r.type === 'unknown' || r.relativePathComponents.length === 0) {
        if (r.type === 'errored') void this.watchRoot(root)
        this.emit({ type: 'change', event: 'rescan', path: '' })
        continue
      }
      this.notify(root, r.relativePathComponents, r.type === 'modified' ? 'change' : 'rename')
      if (r.relativePathMovedFrom) this.notify(root, r.relativePathMovedFrom, 'rename')
    }
  }

  private async watchRoot(root: Root) {
    if (!this.Observer) return
    const key = root.alias ?? ''
    this.observers.get(key)?.disconnect()
    const ob = new this.Observer((records) => this.onRecords(root, records))
    this.observers.set(key, ob)
    try {
      // 파일만 가져온 곳은 그 파일을 본다
      if (root.file) await ob.observe((root.handle as unknown as SingleFileDir).file)
      else await ob.observe(root.handle, { recursive: true })
    } catch (e) {
      // 폴더가 사라졌거나 권한이 없다. 포커스·주기 확인이 남아 있으니 앱은 계속 돈다
      console.warn(`파일 감시를 시작하지 못했습니다 (${root.handle.name}):`, (e as Error).message)
    }
  }

  private startWatching() {
    for (const r of [this.primary(), ...this.ws.mounts.map((m) => this.rootOf(m))]) void this.watchRoot(r)
    const rescan = () => this.emit({ type: 'change', event: 'rescan', path: '' })
    // 절전·감시 끊김으로 놓친 변경은 창에 돌아올 때 잡는다
    const hasWindow = typeof window !== 'undefined'
    if (hasWindow) window.addEventListener('focus', rescan)
    const poll = this.Observer ? null : setInterval(rescan, POLL_MS)
    return () => {
      if (hasWindow) window.removeEventListener('focus', rescan)
      if (poll) clearInterval(poll)
      for (const ob of this.observers.values()) ob.disconnect()
      this.observers.clear()
      for (const p of this.pending.values()) clearTimeout(p.timer)
      this.pending.clear()
    }
  }

  subscribe(handler: (e: ChangeEvent) => void) {
    this.handlers.add(handler)
    if (!this.stopWatching) this.stopWatching = this.startWatching()
    return () => {
      this.handlers.delete(handler)
      if (this.handlers.size === 0 && this.stopWatching) {
        this.stopWatching()
        this.stopWatching = null
      }
    }
  }
}
