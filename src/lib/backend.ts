export interface TreeEntry {
  type: 'dir' | 'file'
  name: string
  path: string
  children?: TreeEntry[]
  /** 가져온 폴더의 루트 노드 (`@별칭`) 일 때만 */
  mount?: MountInfo
}

/** 가져온 폴더 (PLAN-folder-import). 앱 경로는 `@별칭/…` */
export interface MountInfo {
  alias: string
  /** 디스크의 실제 경로 */
  path: string
  readOnly: boolean
  /** 설정 파일에 남는가 (`--mount` 로 이번 실행에만 가져왔으면 false) */
  persist: boolean
  /** 항목이 너무 많아 트리를 다 훑지 못했다 */
  truncated: boolean
}
export interface MountTree extends MountInfo {
  entries: TreeEntry[]
  error: string | null
}
/** 최근에 해제한 폴더 · 설정에는 있지만 이번에 찾지 못한 폴더 */
export interface RecentMount {
  alias: string
  path: string
  readOnly: boolean
}
export interface RootsInfo {
  platform: string
  mounts: MountInfo[]
  recent: RecentMount[]
  missing: RecentMount[]
}
export interface FileData {
  path: string
  text: string
  mtime: number
  /** 디스크의 인코딩. 'utf-8' 이 아니면 (EUC-KR 등) 앱은 읽기 전용으로 연다 */
  encoding?: string
}
export interface ChangeEvent {
  type: 'change'
  event: 'rename' | 'change'
  path: string
}

export type GitCode = 'M' | 'A' | 'D' | 'R' | 'U' | '?'
export interface GitStatus {
  repo: boolean
  branch: string | null
  /** 원격 추적 브랜치 (없으면 null) */
  upstream?: string | null
  /** 원격보다 앞선 / 뒤처진 커밋 수 (upstream 이 있을 때) */
  ahead?: number
  behind?: number
  entries: { path: string; status: GitCode; origPath?: string }[]
}
export interface GitSyncResult {
  ok: boolean
  /** git 의 출력 (stdout + stderr) */
  output: string
}
export interface GitLogEntry {
  hash: string
  shortHash: string
  date: string
  author: string
  subject: string
}

/** 저장하려는 파일이 디스크에서 더 새로울 때 (낙관적 잠금 실패). 디스크 내용을 같이 돌려준다. */
export class ConflictError extends Error {
  constructor(public mtime: number, public text: string, public encoding = 'utf-8') {
    super('디스크의 파일이 더 새롭습니다')
    this.name = 'ConflictError'
  }
}

/** 파일·폴더 접근. 지금은 사이드카(HTTP) 하나, 나중에 File System Access 등을 붙일 수 있게 인터페이스로 둔다. */
export interface Backend {
  info(): Promise<{ root: string; git?: boolean; branch?: string | null }>
  tree(): Promise<{ root: string; entries: TreeEntry[]; mounts: MountTree[] }>
  /** 가져온 폴더 목록 · 최근 해제한 폴더 */
  roots(): Promise<RootsInfo>
  addRoot(path: string, opts?: { alias?: string; readOnly?: boolean }): Promise<MountInfo>
  setRootReadOnly(alias: string, readOnly: boolean): Promise<MountInfo>
  removeRoot(alias: string): Promise<void>
  /** 최근·못 찾은 목록에서 지우기 */
  forgetRoot(path: string): Promise<void>
  /** 경로 자동 완성 — prefix 로 시작하는 폴더들 (절대 경로) */
  listDirs(prefix: string): Promise<string[]>
  /** Windows 폴더 고르기 대화상자. 취소하면 null */
  pickFolder(start?: string): Promise<string | null>
  /** 탐색기에서 보기 (앱 경로, 가져온 폴더 루트는 `@별칭`) */
  reveal(path: string): Promise<void>
  read(path: string): Promise<FileData>
  /** convert: UTF-8 이 아닌 파일을 UTF-8 로 바꿔 쓸 때만 true (서버가 그 외엔 덮어쓰기를 막는다) */
  write(path: string, text: string, baseMtime: number | null, opts?: { convert?: boolean }): Promise<{ mtime: number }>
  mkdir(path: string): Promise<void>
  rename(from: string, to: string): Promise<void>
  remove(path: string, recursive?: boolean): Promise<void>
  gitStatus(): Promise<GitStatus>
  gitShow(path: string, rev?: string): Promise<{ text: string }>
  gitLog(path?: string, limit?: number): Promise<{ entries: GitLogEntry[] }>
  gitCommit(paths: string[], message: string): Promise<{ hash: string; shortHash: string; summary: string }>
  gitRestore(path: string): Promise<void>
  gitPush(): Promise<GitSyncResult>
  gitPull(): Promise<GitSyncResult>
  /** 이미지 같은 원본 파일을 <img src> 로 쓸 수 있는 주소 */
  rawUrl(path: string): string
  subscribe(handler: (e: ChangeEvent) => void): () => void
}

export class HttpBackend implements Backend {
  constructor(private token: string) {}

  private async call<T>(method: string, url: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { 'X-Token': this.token }
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    const res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
    if (res.status === 409) throw new ConflictError(Number(data.mtime), String(data.text ?? ''), String(data.encoding ?? 'utf-8'))
    if (!res.ok) throw new Error(typeof data.error === 'string' ? data.error : `HTTP ${res.status}`)
    return data as T
  }

  info() {
    return this.call<{ root: string; git?: boolean; branch?: string | null }>('GET', '/api/info')
  }
  async rename(from: string, to: string) {
    await this.call<unknown>('POST', '/api/rename', { from, to })
  }
  async remove(path: string, recursive = false) {
    await this.call<unknown>('POST', '/api/delete', { path, recursive })
  }
  gitStatus() {
    return this.call<GitStatus>('GET', '/api/git/status')
  }
  gitShow(path: string, rev = 'HEAD') {
    return this.call<{ text: string }>('GET', `/api/git/show?path=${encodeURIComponent(path)}&rev=${encodeURIComponent(rev)}`)
  }
  gitLog(path?: string, limit = 100) {
    const q = path ? `path=${encodeURIComponent(path)}&` : ''
    return this.call<{ entries: GitLogEntry[] }>('GET', `/api/git/log?${q}limit=${limit}`)
  }
  gitCommit(paths: string[], message: string) {
    return this.call<{ hash: string; shortHash: string; summary: string }>('POST', '/api/git/commit', { paths, message })
  }
  async gitRestore(path: string) {
    await this.call<unknown>('POST', '/api/git/restore', { path })
  }
  gitPush() {
    return this.call<GitSyncResult>('POST', '/api/git/push', {})
  }
  gitPull() {
    return this.call<GitSyncResult>('POST', '/api/git/pull', {})
  }
  rawUrl(path: string) {
    // <img> 는 헤더를 못 보내니 토큰을 쿼리로. 로컬 전용 주소라 괜찮다
    return `/api/raw?path=${encodeURIComponent(path)}&token=${encodeURIComponent(this.token)}`
  }
  tree() {
    return this.call<{ root: string; entries: TreeEntry[]; mounts: MountTree[] }>('GET', '/api/tree')
  }
  roots() {
    return this.call<RootsInfo>('GET', '/api/roots')
  }
  addRoot(path: string, opts: { alias?: string; readOnly?: boolean } = {}) {
    return this.call<MountInfo>('POST', '/api/roots', { path, ...opts })
  }
  setRootReadOnly(alias: string, readOnly: boolean) {
    return this.call<MountInfo>('PATCH', `/api/roots?alias=${encodeURIComponent(alias)}`, { readOnly })
  }
  async removeRoot(alias: string) {
    await this.call<unknown>('DELETE', `/api/roots?alias=${encodeURIComponent(alias)}`)
  }
  async forgetRoot(path: string) {
    await this.call<unknown>('POST', '/api/roots/forget', { path })
  }
  async listDirs(prefix: string) {
    return (await this.call<{ dirs: string[] }>('GET', `/api/fs/dirs?prefix=${encodeURIComponent(prefix)}`)).dirs
  }
  async pickFolder(start = '') {
    return (await this.call<{ path: string | null }>('POST', '/api/fs/pick', { start })).path
  }
  async reveal(path: string) {
    await this.call<unknown>('POST', '/api/reveal', { path })
  }
  read(path: string) {
    return this.call<FileData>('GET', `/api/file?path=${encodeURIComponent(path)}`)
  }
  write(path: string, text: string, baseMtime: number | null, opts: { convert?: boolean } = {}) {
    return this.call<{ mtime: number }>('PUT', `/api/file?path=${encodeURIComponent(path)}`, { text, baseMtime, convert: opts.convert === true })
  }
  async mkdir(path: string) {
    await this.call<unknown>('POST', `/api/mkdir?path=${encodeURIComponent(path)}`)
  }
  subscribe(handler: (e: ChangeEvent) => void) {
    const es = new EventSource(`/api/events?token=${encodeURIComponent(this.token)}`)
    es.onmessage = (ev) => {
      try { handler(JSON.parse(ev.data) as ChangeEvent) } catch { /* 형식이 아니면 무시 */ }
    }
    return () => es.close()
  }
}

let current: Backend | null = null
export function setBackend(b: Backend) {
  current = b
}
export function backend(): Backend {
  if (!current) throw new Error('backend 가 설정되지 않았습니다')
  return current
}
