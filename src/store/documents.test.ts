import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ChangeSet } from '@codemirror/state'
import { setBackend, type Backend, type TreeEntry } from '../lib/backend'
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

// ---------------------------------------------------------------- 구독 (DESIGN §24.5)
function freshMd() {
  const path = `t${++n}/문서.md`
  files.set(path, { text: '# 제목\n', mtime: 1 })
  return path
}

/** 경로 구독자를 붙이고, 불린 횟수와 떼는 함수를 준다 */
function watch(path: string) {
  const fn = vi.fn()
  return { fn, off: store.subscribePath(path, fn) }
}

function fileEntries(paths: string[]): TreeEntry[] {
  return paths.map((path) => ({ type: 'file', name: path.split('/').pop() as string, path }))
}

/** 구독용 dirty 집합이 그 자리에서 센 값과 같은가 */
function expectDirtyInSync() {
  expect([...store.dirtySnapshot()].sort()).toEqual([...store.dirtyPaths()].sort())
}

/** 텍스트 문서 끝에 글자를 넣는다 (편집기가 하듯 ChangeSet 으로) */
function typeAtEnd(path: string, s: string) {
  const d = store.get(path)
  const len = d?.kind === 'text' ? d.text.length : 0
  store.applyChanges(path, ChangeSet.of({ from: len, insert: s }, len), null)
}

describe('경로별 구독 — 한 문서의 변경은 그 문서를 보는 곳만 깨운다', () => {
  it('표 A 를 고치면 A 구독자만 불리고 B 구독자는 안 불린다', async () => {
    const a = freshTsv()
    const b = freshTsv()
    await open(a)
    await open(b)
    const wa = watch(a)
    const wb = watch(b)
    const va = store.pathVersion(a)
    const vb = store.pathVersion(b)
    store.editTable(a, (t) => setCell(t, 1, 1, '2'))
    expect(wa.fn).toHaveBeenCalledTimes(1)
    expect(wb.fn).not.toHaveBeenCalled()
    expect(store.pathVersion(a)).not.toBe(va)
    expect(store.pathVersion(b)).toBe(vb)
    store.undo(a)
    store.redo(a)
    expect(wa.fn).toHaveBeenCalledTimes(3)
    expect(wb.fn).not.toHaveBeenCalled()
    wa.off(); wb.off()
    store.release(a); store.release(b)
    await flush()
  })

  it('바뀐 게 없는 편집(같은 표를 돌려줌)은 아무도 깨우지 않는다', async () => {
    const a = freshTsv()
    await open(a)
    const wa = watch(a)
    const v = store.pathVersion(a)
    store.editTable(a, (t) => t)
    expect(wa.fn).not.toHaveBeenCalled()
    expect(store.pathVersion(a)).toBe(v)
    wa.off()
    store.release(a)
    await flush()
  })

  it('텍스트 문서: 글자를 넣으면 그 문서의 구독자와 편집기 동기화(onChanges)만 불린다', async () => {
    const a = freshMd()
    const b = freshMd()
    await open(a)
    await open(b)
    const wa = watch(a)
    const wb = watch(b)
    const sync = vi.fn()
    const offSync = store.onChanges(a, sync)
    typeAtEnd(a, 'x')
    expect(wa.fn).toHaveBeenCalledTimes(1)
    expect(sync).toHaveBeenCalledTimes(1)
    expect(wb.fn).not.toHaveBeenCalled()
    wa.off(); wb.off(); offSync()
    store.release(a); store.release(b)
    await flush()
  })

  it('저장: 저장 중 · 끝 두 번 깨우고, 다른 문서는 그대로', async () => {
    const a = freshTsv()
    const b = freshTsv()
    await open(a)
    await open(b)
    store.editTable(a, (t) => setCell(t, 1, 1, '2'))
    const wa = watch(a)
    const wb = watch(b)
    const saving = store.save(a)
    expect(store.get(a)?.saving).toBe(true)
    expect(wa.fn).toHaveBeenCalledTimes(1)
    await saving
    expect(store.get(a)?.saving).toBe(false)
    expect(wa.fn).toHaveBeenCalledTimes(2)
    expect(wb.fn).not.toHaveBeenCalled()
    wa.off(); wb.off()
    store.release(a); store.release(b)
    await flush()
  })

  it('바깥에서 바뀐 파일: 깨끗하면 내용을 받고, 고치던 중이면 충돌 — 그 문서만 깨운다', async () => {
    const a = freshTsv()
    const b = freshTsv()
    await open(a)
    await open(b)
    const wa = watch(a)
    const wb = watch(b)
    files.set(a, { text: 'Key\tV\nA\t밖\n', mtime: 50 })
    await store.handleExternal({ type: 'change', event: 'change', path: a })
    const d = store.get(a)
    expect(d?.kind === 'tsv' && d.table.rows[1].cells[1]).toBe('밖')
    expect(wa.fn).toHaveBeenCalled()
    wa.fn.mockClear()
    store.editTable(a, (t) => setCell(t, 1, 1, '안'))
    files.set(a, { text: 'Key\tV\nA\t밖2\n', mtime: 60 })
    await store.handleExternal({ type: 'change', event: 'change', path: a })
    expect(store.get(a)?.conflict).not.toBeNull()
    expect(wa.fn).toHaveBeenCalledTimes(2) // 편집 + 충돌
    store.takeDisk(a)
    expect(store.get(a)?.conflict).toBeNull()
    expect(store.isDirty(a)).toBe(false)
    expect(wb.fn).not.toHaveBeenCalled()
    expectDirtyInSync()
    wa.off(); wb.off()
    store.release(a); store.release(b)
    await flush()
  })

  it('읽기 전용으로 가져온 폴더가 바뀌면 열린 문서를 깨운다', async () => {
    const alias = `별칭${++n}`
    const path = `@${alias}/X_Table.tsv`
    files.set(path, { text: 'Key\tV\nA\t1\n', mtime: 1 })
    await open(path)
    const w = watch(path)
    const mount = { alias, folder: alias, readOnly: true, truncated: false, path: null }
    store.setMounts([mount])
    expect(store.isReadOnly(path)).toBe(true)
    expect(w.fn).toHaveBeenCalledTimes(1)
    store.setMounts([mount]) // 그대로면 조용하다
    expect(w.fn).toHaveBeenCalledTimes(1)
    store.setMounts([])
    expect(store.isReadOnly(path)).toBe(false)
    expect(w.fn).toHaveBeenCalledTimes(2)
    w.off()
    store.release(path)
    await flush()
  })
})

describe('dirty 집합 구독 — "모두 저장 (N)" · 트리와 탭의 ●', () => {
  it('구성이 바뀔 때만 불린다: 첫 편집 1번, 더 고쳐도 0번, 되돌려 깨끗해지면 1번', async () => {
    const a = freshTsv()
    await open(a)
    const fn = vi.fn()
    const off = store.subscribeDirty(fn)
    const before = store.dirtySnapshot()
    store.editTable(a, (t) => setCell(t, 1, 1, '2'))
    expect(fn).toHaveBeenCalledTimes(1)
    const dirty1 = store.dirtySnapshot()
    expect(dirty1).not.toBe(before)
    expect(dirty1.has(a)).toBe(true)
    store.editTable(a, (t) => setCell(t, 1, 1, '3'))
    store.editTable(a, (t) => setCell(t, 1, 1, '4'))
    expect(fn).toHaveBeenCalledTimes(1)
    expect(store.dirtySnapshot()).toBe(dirty1) // 같은 객체 — useSyncExternalStore 가 다시 그리지 않는다
    store.undo(a); store.undo(a)
    expect(fn).toHaveBeenCalledTimes(1)
    store.undo(a) // 저장 시점의 표로 돌아옴
    expect(fn).toHaveBeenCalledTimes(2)
    expect(store.dirtySnapshot().has(a)).toBe(false)
    expectDirtyInSync()
    off()
    store.release(a)
    await flush()
  })

  it('저장하면 빠진다. 저장 중 표시만으로는 불리지 않는다', async () => {
    const a = freshTsv()
    const b = freshTsv()
    await open(a)
    await open(b)
    store.editTable(a, (t) => setCell(t, 1, 1, '2'))
    store.editTable(b, (t) => setCell(t, 1, 1, '2'))
    const fn = vi.fn()
    const off = store.subscribeDirty(fn)
    const saving = store.save(a)
    expect(fn).not.toHaveBeenCalled() // saving = true 일 뿐 아직 dirty
    await saving
    expect(fn).toHaveBeenCalledTimes(1)
    expect([...store.dirtySnapshot()].filter((p) => p === a || p === b)).toEqual([b])
    expectDirtyInSync()
    off()
    store.release(a); store.release(b)
    await flush()
  })

  it('텍스트 문서도 같다: 글자마다가 아니라 dirty 여부가 바뀔 때만', async () => {
    const a = freshMd()
    await open(a)
    const fn = vi.fn()
    const off = store.subscribeDirty(fn)
    typeAtEnd(a, 'a'); typeAtEnd(a, 'b'); typeAtEnd(a, 'c')
    expect(fn).toHaveBeenCalledTimes(1)
    expect(store.dirtySnapshot().has(a)).toBe(true)
    await store.save(a)
    expect(fn).toHaveBeenCalledTimes(2)
    expect(store.dirtySnapshot().has(a)).toBe(false)
    expectDirtyInSync()
    off()
    store.release(a)
    await flush()
  })

  it('버리고 닫으면(탭이 놓음) 빠지고, 그 자리 보기가 놓은 dirty 문서는 남는다', async () => {
    const a = freshTsv()
    const b = freshTsv()
    await open(a)
    await open(b)
    store.editTable(a, (t) => setCell(t, 1, 1, '2'))
    store.editTable(b, (t) => setCell(t, 1, 1, '2'))
    const fn = vi.fn()
    const off = store.subscribeDirty(fn)
    store.release(a) // 탭
    store.release(b, { keepDirty: true }) // tsv-view
    await flush()
    expect(store.dirtySnapshot().has(a)).toBe(false)
    expect(store.dirtySnapshot().has(b)).toBe(true)
    expect(fn).toHaveBeenCalledTimes(1)
    await store.saveAll()
    expect(store.dirtySnapshot().has(b)).toBe(false)
    expect(store.get(b)).toBeUndefined()
    expectDirtyInSync()
    off()
  })
})

describe('여러 문서에 걸친 의존 — Field · 보조 표 · 트리', () => {
  afterAll(() => store.setTree([]))

  it('Field 문서를 고치면 Field 구독자가 불리고, 보통 표를 고치면 안 불린다', async () => {
    const dir = `t${++n}`
    const table = `${dir}/X_Table.tsv`
    const field = `${dir}/X_Field.tsv`
    files.set(table, { text: 'Key\tV\nA\t1\n', mtime: 1 })
    files.set(field, { text: 'XDef\t설명\nKey\t키\n', mtime: 1 })
    store.setTree(fileEntries([table, field]))
    await flush()
    await open(table)
    await open(field)
    const fn = vi.fn()
    const off = store.subscribeFields(fn)
    const before = store.fieldFiles()
    store.editTable(table, (t) => setCell(t, 1, 1, '2'))
    expect(fn).not.toHaveBeenCalled()
    expect(store.fieldFiles()).toBe(before) // 같은 배열 — 스키마를 다시 유도하지 않는다
    store.editTable(field, (t) => setCell(t, 1, 1, '고친 설명'))
    expect(fn).toHaveBeenCalledTimes(1)
    expect(store.fieldFiles()).not.toBe(before)
    off()
    store.release(table); store.release(field)
    await flush()
  })

  it('열려 있지 않은 Field 파일이 읽히면 Field 구독자가 불린다 (트리에 새로 생김)', async () => {
    const dir = `t${++n}`
    const field = `${dir}/Y_Field.tsv`
    files.set(field, { text: 'YDef\t설명\nKey\t키\n', mtime: 1 })
    const fn = vi.fn()
    const off = store.subscribeFields(fn)
    const v = store.getFieldsVersion()
    store.setTree(fileEntries([field]))
    // 목록이 바뀜 (앞 시험의 Field 캐시가 트리에서 빠지며 한 번 더 불릴 수 있다)
    const afterTree = fn.mock.calls.length
    expect(afterTree).toBeGreaterThanOrEqual(1)
    await flush()
    expect(fn).toHaveBeenCalledTimes(afterTree + 1) // 내용이 읽힘
    expect(store.getFieldsVersion()).not.toBe(v)
    expect(store.fieldFiles().length).toBe(1)
    off()
  })

  it('보조 표(계산식 · lookup 대상): 읽히면, 바깥에서 바뀌면, 열려서 고쳐지면 그 경로의 구독자가 불린다', async () => {
    const dir = `t${++n}`
    const aux = `${dir}/X_Calc.tsv`
    const other = `${dir}/Other.tsv`
    files.set(aux, { text: 'Target\tFormula\nV\t=1\n', mtime: 1 })
    files.set(other, { text: 'Key\tV\nA\t1\n', mtime: 1 })
    store.setTree(fileEntries([aux, other]))
    const w = watch(aux)
    const wo = watch(other)
    expect(store.auxTable(aux)).toBeNull() // 읽기 시작
    await flush()
    expect(w.fn).toHaveBeenCalledTimes(1)
    expect(store.auxTable(aux)?.rows[1].cells[1]).toBe('=1')
    // 바깥에서 바뀜
    files.set(aux, { text: 'Target\tFormula\nV\t=2\n', mtime: 2 })
    await store.handleExternal({ type: 'change', event: 'change', path: aux })
    await flush()
    expect(w.fn).toHaveBeenCalledTimes(2)
    expect(store.auxTable(aux)?.rows[1].cells[1]).toBe('=2')
    // 탭으로 열어 고침 — 저장 전 표가 우선한다
    await open(aux)
    w.fn.mockClear()
    store.editTable(aux, (t) => setCell(t, 1, 1, '=3'))
    expect(w.fn).toHaveBeenCalledTimes(1)
    expect(store.auxTable(aux)?.rows[1].cells[1]).toBe('=3')
    expect(wo.fn).not.toHaveBeenCalled()
    w.off(); wo.off()
    store.release(aux)
    await flush()
  })

  it('보조 표를 탭으로 열어 고치고 저장한 뒤 닫으면 저장한 내용이 남는다 (옛 캐시로 돌아가지 않는다)', async () => {
    const dir = `t${++n}`
    const aux = `${dir}/X_Calc.tsv`
    files.set(aux, { text: 'Target\tFormula\nV\t=1\n', mtime: 1 })
    store.setTree(fileEntries([aux]))
    store.auxTable(aux)
    await flush()
    expect(store.auxTable(aux)?.rows[1].cells[1]).toBe('=1') // 캐시에 들어감
    await open(aux)
    store.editTable(aux, (t) => setCell(t, 1, 1, '=2'))
    await store.save(aux)
    const w = watch(aux)
    store.release(aux)
    await flush()
    expect(store.get(aux)).toBeUndefined()
    expect(w.fn).toHaveBeenCalled() // 그 표를 읽는 그리드가 다시 그린다
    expect(store.auxTable(aux)?.rows[1].cells[1]).toBe('=2')
    // 저장하지 않고 버리면 디스크 내용(=2)으로 돌아간다
    await open(aux)
    store.editTable(aux, (t) => setCell(t, 1, 1, '=3'))
    store.release(aux)
    await flush()
    expect(store.auxTable(aux)?.rows[1].cells[1]).toBe('=2')
    w.off()
  })

  it('바깥에서 지워진 보조 표: 한 번 깨우고 끝난다 (렌더 → 읽기 실패 → 알림이 돌지 않는다)', async () => {
    const dir = `t${++n}`
    const aux = `${dir}/Gone.tsv`
    files.set(aux, { text: 'Key\tV\nA\t1\n', mtime: 1 })
    store.setTree(fileEntries([aux]))
    const fn = vi.fn(() => { store.auxTable(aux) }) // 다시 그리는 창이 하듯 깨어날 때마다 읽는다
    const off = store.subscribePath(aux, fn)
    store.auxTable(aux)
    await flush()
    expect(fn).toHaveBeenCalledTimes(1)
    files.delete(aux)
    await store.handleExternal({ type: 'change', event: 'change', path: aux })
    await flush(); await flush(); await flush()
    expect(fn).toHaveBeenCalledTimes(2)
    expect(store.auxTable(aux)).toBeNull()
    await flush(); await flush()
    expect(fn).toHaveBeenCalledTimes(2)
    off()
  })

  it('트리: 경로 집합이 바뀔 때만 불린다', () => {
    const dir = `t${++n}`
    const fn = vi.fn()
    const off = store.subscribeTree(fn)
    store.setTree(fileEntries([`${dir}/a.md`]))
    expect(fn).toHaveBeenCalledTimes(1)
    store.setTree(fileEntries([`${dir}/a.md`])) // 같은 트리를 다시 읽음
    expect(fn).toHaveBeenCalledTimes(1)
    expect(store.hasPath(`${dir}/b.md`)).toBe(false)
    store.setTree(fileEntries([`${dir}/a.md`, `${dir}/b.md`]))
    expect(fn).toHaveBeenCalledTimes(2)
    expect(store.hasPath(`${dir}/b.md`)).toBe(true)
    off()
  })
})

describe('구독 수명 — 누수 없음', () => {
  it('떼면 사라지고, 뗀 뒤에는 불리지 않는다', async () => {
    const a = freshTsv()
    await open(a)
    const base = store.subscriberCount()
    const w1 = watch(a)
    const w2 = watch(a)
    const dirty = vi.fn()
    const offDirty = store.subscribeDirty(dirty)
    expect(store.subscriberCount(a)).toBe(2)
    expect(store.subscriberCount()).toBe(base + 3)
    w1.off()
    store.editTable(a, (t) => setCell(t, 1, 1, '2'))
    expect(w1.fn).not.toHaveBeenCalled()
    expect(w2.fn).toHaveBeenCalledTimes(1)
    w2.off(); offDirty()
    w2.off() // 두 번 떼도 괜찮다
    expect(store.subscriberCount(a)).toBe(0)
    expect(store.subscriberCount()).toBe(base)
    store.editTable(a, (t) => setCell(t, 1, 1, '3'))
    expect(w2.fn).toHaveBeenCalledTimes(1)
    expect(dirty).toHaveBeenCalledTimes(1)
    store.release(a)
    await flush()
  })

  it('문서가 내려가면 남은 구독자에게 알린다. 구독은 구독자가 뗄 때까지 남고, 버전은 예전 값으로 돌아가지 않는다', async () => {
    const a = freshTsv()
    await open(a)
    const w = watch(a)
    const seen = new Set([store.pathVersion(a)])
    store.release(a)
    await flush()
    expect(store.get(a)).toBeUndefined()
    expect(w.fn).toHaveBeenCalledTimes(1)
    expect(seen.has(store.pathVersion(a))).toBe(false)
    seen.add(store.pathVersion(a))
    // 다시 열면 같은 구독자가 "불러오는 중" 과 "다 읽음" 을 받는다
    store.retain(a)
    expect(seen.has(store.pathVersion(a))).toBe(false)
    seen.add(store.pathVersion(a))
    await flush()
    expect(seen.has(store.pathVersion(a))).toBe(false)
    expect(w.fn).toHaveBeenCalledTimes(3)
    w.off()
    expect(store.subscriberCount(a)).toBe(0)
    store.release(a)
    await flush()
  })

  it('알림 도중에 구독을 떼어도 나머지 구독자는 불린다', async () => {
    const a = freshTsv()
    await open(a)
    const order: string[] = []
    const off1 = store.subscribePath(a, () => { order.push('1'); off1() })
    const off2 = store.subscribePath(a, () => { order.push('2') })
    store.editTable(a, (t) => setCell(t, 1, 1, '2'))
    store.editTable(a, (t) => setCell(t, 1, 1, '3'))
    expect(order).toEqual(['1', '2', '2'])
    off2()
    expect(store.subscriberCount(a)).toBe(0)
    store.release(a)
    await flush()
  })
})
