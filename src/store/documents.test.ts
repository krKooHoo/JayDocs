import { beforeEach, describe, expect, it } from 'vitest'
import { setBackend, type Backend } from '../lib/backend'
import { setCell } from '../lib/tsv/edits'
import { store } from './documents'

/** 메모리 파일 몇 개만 읽고 쓰는 가짜 backend */
const files = new Map<string, { text: string; mtime: number }>()
let tick = 1000
setBackend({
  read: async (path: string) => {
    const f = files.get(path)
    if (!f) throw new Error('없는 파일')
    return { path, text: f.text, mtime: f.mtime }
  },
  write: async (path: string, text: string) => {
    files.set(path, { text, mtime: ++tick })
    return { mtime: tick }
  },
} as unknown as Backend)

const flush = () => new Promise((r) => setTimeout(r, 0))

async function open(path: string) {
  store.retain(path)
  await flush()
  expect(store.get(path)?.status).toBe('ready')
}

let n = 0
/** 시험마다 다른 경로 (스토어는 하나뿐이라) */
function freshTsv() {
  const path = `t${++n}/X_Table.tsv`
  files.set(path, { text: 'Key\tV\nA\t1\n', mtime: 1 })
  return path
}

describe('그 자리 보기(tsv-view)가 놓은 표 — 저장 안 한 편집을 지키기', () => {
  beforeEach(() => { tick = 1000 })

  it('dirty 면 마지막 참조가 풀려도 남고, 계속 dirty 로 잡힌다', async () => {
    const path = freshTsv()
    await open(path)
    store.editTable(path, (t) => setCell(t, 1, 1, '999'))
    expect(store.isDirty(path)).toBe(true)
    store.release(path, { keepDirty: true })
    expect(store.get(path)).toBeDefined()
    expect(store.isOrphan(path)).toBe(true)
    expect(store.isDirty(path)).toBe(true)
    expect(store.dirtyPaths().has(path)).toBe(true)
    expect(store.anyDirty()).toBe(true)
  })

  it('다시 열면 고친 내용이 그대로 보이고, 디스크에서 다시 읽지 않는다', async () => {
    const path = freshTsv()
    await open(path)
    store.editTable(path, (t) => setCell(t, 1, 1, '999'))
    store.release(path, { keepDirty: true })
    files.set(path, { text: 'Key\tV\nA\t디스크\n', mtime: 1 })
    store.retain(path)
    await flush()
    const d = store.get(path)
    expect(d?.kind === 'tsv' && d.table.rows[1].cells[1]).toBe('999')
    expect(store.isOrphan(path)).toBe(false)
    store.release(path)
  })

  it('"모두 저장" 으로 저장되면 내린다', async () => {
    const path = freshTsv()
    await open(path)
    store.editTable(path, (t) => setCell(t, 1, 1, '999'))
    store.release(path, { keepDirty: true })
    await store.saveAll()
    expect(files.get(path)?.text).toBe('Key\tV\nA\t999\n')
    expect(store.get(path)).toBeUndefined()
    expect(store.dirtyPaths().has(path)).toBe(false)
  })

  it('dirty 가 아니면 바로 내린다', async () => {
    const path = freshTsv()
    await open(path)
    store.release(path, { keepDirty: true })
    await flush()
    expect(store.get(path)).toBeUndefined()
  })

  it('탭(그리드)이 놓으면 — 닫기 확인을 거쳤으므로 — dirty 여도 내린다', async () => {
    const path = freshTsv()
    await open(path)
    store.editTable(path, (t) => setCell(t, 1, 1, '999'))
    store.release(path)
    await flush()
    expect(store.get(path)).toBeUndefined()
  })

  it('남겨 둔 표를 그리드로 열 때 StrictMode 처럼 retain → release → retain 이 바로 이어져도 편집이 남는다', async () => {
    const path = freshTsv()
    await open(path)
    store.editTable(path, (t) => setCell(t, 1, 1, '999'))
    store.release(path, { keepDirty: true })
    store.retain(path)
    store.release(path)
    store.retain(path)
    await flush()
    const d = store.get(path)
    expect(d?.kind === 'tsv' && d.table.rows[1].cells[1]).toBe('999')
    expect(store.isDirty(path)).toBe(true)
    store.release(path)
  })

  it('그리드 탭과 tsv-view 가 같이 붙잡고 있을 때: 보기가 먼저 놓고 탭이 나중에 놓으면 내린다', async () => {
    const path = freshTsv()
    await open(path) // 그리드
    store.retain(path) // tsv-view
    store.editTable(path, (t) => setCell(t, 1, 1, '999'))
    store.release(path, { keepDirty: true })
    expect(store.get(path)).toBeDefined()
    store.release(path)
    await flush()
    expect(store.get(path)).toBeUndefined()
  })

  it('저장 중에 보기가 놓으면 저장이 끝난 뒤 내린다', async () => {
    const path = freshTsv()
    await open(path)
    store.editTable(path, (t) => setCell(t, 1, 1, '5'))
    const saving = store.save(path)
    store.release(path, { keepDirty: true })
    expect(store.get(path)).toBeDefined()
    await saving
    expect(store.get(path)).toBeUndefined()
    expect(files.get(path)?.text).toBe('Key\tV\nA\t5\n')
  })
})
