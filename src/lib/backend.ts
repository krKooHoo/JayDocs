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
  /** 폴더 이름. 브라우저는 절대 경로를 알려 주지 않는다 */
  folder: string
  readOnly: boolean
  /** 항목이 너무 많아 트리를 다 훑지 못했다 */
  truncated: boolean
}
export interface MountTree extends MountInfo {
  entries: TreeEntry[]
  error: string | null
}
/** 최근에 해제한 폴더 */
export interface RecentMount {
  alias: string
  folder: string
  readOnly: boolean
}
export interface RootsInfo {
  mounts: MountInfo[]
  recent: RecentMount[]
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
  /** rename: 트리가 바뀌었다 · change: 파일 내용만 바뀌었다 · rescan: 무엇이 바뀌었는지 모르니 다시 확인한다 */
  event: 'rename' | 'change' | 'rescan'
  path: string
}

/** 저장하려는 파일이 디스크에서 더 새로울 때 (낙관적 잠금 실패). 디스크 내용을 같이 돌려준다. */
export class ConflictError extends Error {
  constructor(public mtime: number, public text: string, public encoding = 'utf-8') {
    super('디스크의 파일이 더 새롭습니다')
    this.name = 'ConflictError'
  }
}

/** 파일·폴더 접근. 구현은 File System Access API 하나 (lib/fsa/fsaBackend.ts) */
export interface Backend {
  /** root: 주 폴더 이름 · id: 레이아웃을 기억하는 열쇠 */
  info(): Promise<{ root: string; id: string }>
  tree(): Promise<{ root: string; entries: TreeEntry[]; mounts: MountTree[]; truncated: boolean }>
  /** 가져온 폴더 목록 · 최근 해제한 폴더 */
  roots(): Promise<RootsInfo>
  /** 사용자가 고른 폴더를 가져온다. 클릭 처리 안에서 불러야 권한을 물을 수 있다 */
  addRoot(handle: FileSystemDirectoryHandle, opts?: { alias?: string; readOnly?: boolean }): Promise<MountInfo>
  /** 최근 목록의 폴더를 다시 가져온다 */
  restoreRoot(alias: string): Promise<MountInfo>
  setRootReadOnly(alias: string, readOnly: boolean): Promise<MountInfo>
  removeRoot(alias: string): Promise<void>
  /** 최근 목록에서 지우기 */
  forgetRoot(alias: string): Promise<void>
  read(path: string): Promise<FileData>
  /** convert: UTF-8 이 아닌 파일을 UTF-8 로 바꿔 쓸 때만 true (그 외엔 덮어쓰기를 막는다) */
  write(path: string, text: string, baseMtime: number | null, opts?: { convert?: boolean }): Promise<{ mtime: number }>
  mkdir(path: string): Promise<void>
  /** 파일만. 폴더 이동 API 가 없어 폴더 이름은 탐색기에서 바꾼다 */
  rename(from: string, to: string): Promise<void>
  remove(path: string, recursive?: boolean): Promise<void>
  /** 이미지 같은 원본 파일을 <img src> 로 쓸 수 있는 주소 (다 쓰면 revokeObjectURL) */
  rawUrl(path: string): Promise<string>
  /** 변경을 실시간으로 받는가 (아니면 창에 포커스가 올 때와 몇 초마다 확인) */
  watching(): boolean
  subscribe(handler: (e: ChangeEvent) => void): () => void
}

let current: Backend | null = null
export function setBackend(b: Backend) {
  current = b
}
export function backend(): Backend {
  if (!current) throw new Error('backend 가 설정되지 않았습니다')
  return current
}
