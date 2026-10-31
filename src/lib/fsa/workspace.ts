/**
 * 작업 공간 = 주 폴더 + 가져온 폴더들. 폴더 핸들은 IndexedDB 에만 저장할 수 있다.
 * 주 폴더마다 하나씩 남기므로, 폴더를 바꿨다 돌아와도 가져온 폴더 목록과 레이아웃이 그대로다.
 */
export interface StoredRoot {
  alias: string
  handle: FileSystemDirectoryHandle
  readOnly: boolean
}

export interface Workspace {
  id: string
  primary: FileSystemDirectoryHandle
  mounts: StoredRoot[]
  recent: StoredRoot[]
}

const DB = 'jaydocs'
const STORE = 'workspaces'
const CURRENT = 'current'

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
  return all.filter((x): x is Workspace => typeof x === 'object' && x !== null && 'primary' in x)
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
