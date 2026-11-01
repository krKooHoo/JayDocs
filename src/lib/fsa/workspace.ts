/**
 * 작업 공간 = 주 폴더 + 가져온 폴더들. 폴더 핸들은 IndexedDB 에만 저장할 수 있다.
 * 주 폴더마다 하나씩 남기므로, 폴더를 바꿨다 돌아와도 가져온 폴더 목록과 레이아웃이 그대로다.
 */
export interface StoredRoot {
  alias: string
  handle: FileSystemDirectoryHandle
  readOnly: boolean
  /** 사용자가 넣은 전체 경로. 브라우저는 알려 주지 않는다 (DESIGN §21) */
  path?: string
}

export interface Workspace {
  id: string
  primary: FileSystemDirectoryHandle
  mounts: StoredRoot[]
  recent: StoredRoot[]
  /** 문서 별칭. 없으면 폴더 이름 */
  label?: string
  /** 주 폴더의 전체 경로 */
  path?: string
  /** 마지막으로 연 때 (최근 목록의 순서) */
  openedAt?: number
}

const DB = 'jaydocs'
const STORE = 'workspaces'
const CURRENT = 'current'
/** 최근 폴더 목록에 남기는 수 */
export const RECENT_WORKSPACES = 10

export const workspaceLabel = (w: Workspace) => w.label || w.primary.name

export const newestFirst = <T extends { openedAt?: number }>(list: T[]) =>
  [...list].sort((a, b) => (b.openedAt ?? 0) - (a.openedAt ?? 0))

function withStore<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB, 1)
    open.onupgradeneeded = () => open.result.createObjectStore(STORE)
    open.onerror = () => reject(open.error)
    open.onsuccess = () => {
      const tx = open.result.transaction(STORE, mode)
      const req = run(tx.objectStore(STORE))
      tx.oncomplete = () => { open.result.close(); resolve(req.result) }
      tx.onerror = () => { open.result.close(); reject(tx.error) }
    }
  })
}

export function saveWorkspace(w: Workspace) {
  return withStore('readwrite', (s) => s.put(w, `ws:${w.id}`)).then(() => undefined)
}

export async function listWorkspaces(): Promise<Workspace[]> {
  const all = await withStore<unknown[]>('readonly', (s) => s.getAll())
  return newestFirst(all.filter((x): x is Workspace => typeof x === 'object' && x !== null && 'primary' in x))
}

/** 열었다고 기록하고, 최근 목록을 넘친 오래된 폴더는 지운다 (폴더와 파일은 그대로) */
export async function touchWorkspace(w: Workspace) {
  w.openedAt = Date.now()
  await saveWorkspace(w)
  for (const old of (await listWorkspaces()).slice(RECENT_WORKSPACES)) await forgetWorkspace(old.id)
}

export function setWorkspaceInfo(w: Workspace, label: string, path: string) {
  w.label = label || undefined
  w.path = path || undefined
  return saveWorkspace(w)
}

export function currentWorkspaceId() {
  return withStore<string | undefined>('readonly', (s) => s.get(CURRENT))
}

export function setCurrentWorkspace(id: string | null) {
  if (id === null) return withStore('readwrite', (s) => s.delete(CURRENT))
  return withStore('readwrite', (s) => s.put(id, CURRENT)).then(() => undefined)
}

export function forgetWorkspace(id: string) {
  return withStore('readwrite', (s) => s.delete(`ws:${id}`)).then(() => undefined)
}

/** 고른 폴더의 작업 공간. 전에 연 폴더면 그때의 가져온 폴더·레이아웃을 이어 간다 */
export async function workspaceFor(handle: FileSystemDirectoryHandle): Promise<Workspace> {
  for (const w of await listWorkspaces()) {
    if (await w.primary.isSameEntry(handle)) {
      // 핸들을 새것으로 바꿔 둔다 (폴더가 지워졌다 다시 만들어진 경우에도 맞게)
      w.primary = handle
      await saveWorkspace(w)
      return w
    }
  }
  const w: Workspace = { id: crypto.randomUUID(), primary: handle, mounts: [], recent: [] }
  await saveWorkspace(w)
  return w
}

const modeOf = (readOnly: boolean) => ({ mode: readOnly ? 'read' : 'readwrite' }) as const

export function queryRoot(handle: FileSystemDirectoryHandle, readOnly: boolean) {
  return handle.queryPermission(modeOf(readOnly))
}

/** 권한을 묻는다. 사용자 동작(클릭·키) 안에서만 창이 뜬다 */
export function requestRoot(handle: FileSystemDirectoryHandle, readOnly: boolean) {
  return handle.requestPermission(modeOf(readOnly))
}
