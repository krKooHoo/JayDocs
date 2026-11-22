import { useCallback, useSyncExternalStore } from 'react'
import { ChangeSet, Text } from '@codemirror/state'
import { backend, ConflictError, type ChangeEvent, type TreeEntry } from '../lib/backend'
import type { TsvTable } from '../lib/tsv/model'
import { parseTable, serializeTable, tableOpenWarnings } from '../lib/tsv/table'
import { parseFieldBlocks, type FieldFile } from '../lib/tsv/field'
import { deriveSchema, isFieldFile } from '../lib/tsv/schema'
import { bakeMarkdown, bakeTargets, type BakeSource } from '../lib/md/bake'
import { fileTypeOf } from '../lib/filetypes.mjs'
import { splitRootPath } from '../lib/roots.mjs'
import type { MountInfo } from '../lib/backend'

export type Eol = '\n' | '\r\n'

interface DocBase {
  path: string
  status: 'loading' | 'ready' | 'error'
  error: string | null
  /** 디스크의 mtime. 아직 디스크에 없는 새 파일이면 null */
  mtime: number | null
  /** 디스크가 더 새로워서 사용자가 골라야 하는 상태 */
  conflict: { text: string; mtime: number; encoding: string } | null
  saving: boolean
  /** 디스크의 인코딩. 'utf-8' 이 아니면 읽기 전용 — "UTF-8 로 바꿔 저장" 으로만 쓴다 */
  encoding: string
}

/**
 * 텍스트 문서 (.md 등). 텍스트는 CodeMirror Text — 모든 수정은 ChangeSet 으로 들어와 모든 창에 같은 ChangeSet 이 전달된다.
 * undo/redo 는 CM6 history (창마다).
 */
export interface TextDoc extends DocBase {
  kind: 'text'
  text: Text
  savedText: Text
  eol: Eol
  bom: boolean
  /** 마지막 저장 때 bake 에서 난 문제 (있으면 배너로) */
  bakeErrors: string[]
}

/**
 * TSV 문서. 표는 불변 스냅샷 — 편집마다 새 표 객체가 되고 이전 객체가 되돌리기 스택에 쌓인다.
 * 저장된 스냅샷과 같은 객체면 깨끗한 상태다 (되돌려서 저장 시점으로 오면 다시 깨끗해진다).
 */
export interface TsvDoc extends DocBase {
  kind: 'tsv'
  table: TsvTable
  savedTable: TsvTable
  past: TsvTable[]
  future: TsvTable[]
  /** 열 때 한 번 보여 주는 경고 (섞인 줄바꿈, 따옴표 셀) */
  warnings: string[]
}

export type Doc = TextDoc | TsvDoc

export type ChangeListener = (changes: ChangeSet, source: symbol | null) => void

const UNDO_LIMIT = 300

/** 그리드로 여는 표 파일인가 (형식 표의 kind 'table') */
export function isTsvPath(path: string) {
  return fileTypeOf(path)?.kind === 'table'
}

/** 파일 → Text. BOM 과 줄바꿈 종류는 따로 기억해 저장 때 되돌린다. */
function parseText(raw: string): { bom: boolean; eol: Eol; text: Text } {
  const bom = raw.charCodeAt(0) === 0xfeff
  if (bom) raw = raw.slice(1)
  const eol: Eol = raw.includes('\r\n') ? '\r\n' : '\n'
  return { bom, eol, text: Text.of(raw.split(/\r\n|\r|\n/)) }
}

function serialize(d: Doc): string {
  if (d.kind === 'tsv') return serializeTable(d.table)
  let s = d.text.toString()
  if (d.eol === '\r\n') s = s.replace(/\n/g, '\r\n')
  return (d.bom ? '﻿' : '') + s
}

const NO_DIRTY: ReadonlySet<string> = new Set()

class DocumentStore {
  private docs = new Map<string, Doc>()
  private refs = new Map<string, number>()
  private changeListeners = new Map<string, Set<ChangeListener>>()

  // ---- 구독 (DESIGN §24.5). 전역 버전은 없다 — 무엇이 바뀌었는지에 따라 네 갈래로 알린다.
  //  · 경로: 그 경로의 문서 상태(내용 · dirty · saving · conflict · error · 읽기 전용 · bakeErrors)나 보조 표 캐시가 바뀜
  //  · dirty 집합: 저장 안 한 문서의 집합이 실제로 바뀜 ("모두 저장 (N)", 트리 · 탭의 ●)
  //  · Field: 스키마 유도에 쓰는 Field 파일 목록이나 그 내용이 바뀜 (fieldFiles() 를 읽는 곳)
  //  · 트리: 파일 경로 집합이 바뀜 (hasPath() 를 읽는 곳)
  /** 버전은 스토어 전체에서 하나씩 올라가는 번호를 받는다 — 문서가 내려갔다 다시 열려도 같은 값이 다시 나오지 않는다 */
  private seq = 0
  /** 경로 → 마지막으로 바뀐 때의 번호. 지우지 않는다 (경로마다 숫자 하나) */
  private pathVersions = new Map<string, number>()
  private pathListeners = new Map<string, Set<() => void>>()
  /** 저장 안 한 문서들. 구성이 바뀔 때만 새 객체가 된다 (useSyncExternalStore 의 스냅샷) */
  private dirtySet: ReadonlySet<string> = NO_DIRTY
  private dirtyListeners = new Set<() => void>()
  private fieldsVersion = 0
  private fieldsListeners = new Set<() => void>()
  private treeVersion = 0
  private treeListeners = new Set<() => void>()

  // ---- 보조 표 (Field 시트 = 스키마 힌트, Calc 시트 = 계산식, lookup 대상 표) ----
  // 열려 있지 않은 표를 디스크에서 읽어 들고 있는다. 열린 문서는 그 (저장 전) 표를 우선한다.
  private fieldPaths: string[] = []
  private treePaths = new Set<string>()
  private auxCache = new Map<string, { mtime: number; table: TsvTable }>()
  private auxLoading = new Set<string>()
  private liveFieldParsed = new Map<string, { table: TsvTable; file: FieldFile }>()
  private cachedFieldParsed = new Map<string, { table: TsvTable; file: FieldFile }>()
  private fieldsResult: FieldFile[] = []
  private fieldsStale = true

  /** 이 경로의 문서(또는 보조 표)가 바뀔 때 부른다 */
  subscribePath(path: string, l: () => void) {
    let set = this.pathListeners.get(path)
    if (!set) this.pathListeners.set(path, (set = new Set()))
    set.add(l)
    return () => {
      set.delete(l)
      if (set.size === 0 && this.pathListeners.get(path) === set) this.pathListeners.delete(path)
    }
  }
  /** 이 경로가 마지막으로 바뀐 때의 번호 (바뀐 적 없으면 0). 값의 크기에는 뜻이 없고 같은지만 본다 */
  pathVersion(path: string) { return this.pathVersions.get(path) ?? 0 }

  subscribeDirty = (l: () => void) => {
    this.dirtyListeners.add(l)
    return () => { this.dirtyListeners.delete(l) }
  }
  subscribeFields = (l: () => void) => {
    this.fieldsListeners.add(l)
    return () => { this.fieldsListeners.delete(l) }
  }
  getFieldsVersion = () => this.fieldsVersion
  subscribeTree = (l: () => void) => {
    this.treeListeners.add(l)
    return () => { this.treeListeners.delete(l) }
  }
  getTreeVersion = () => this.treeVersion

  /** 붙어 있는 구독자 수 (시험 · 진단용). path 를 주면 그 경로만 */
  subscriberCount(path?: string) {
    if (path !== undefined) return this.pathListeners.get(path)?.size ?? 0
    let n = this.dirtyListeners.size + this.fieldsListeners.size + this.treeListeners.size
    for (const s of this.pathListeners.values()) n += s.size
    return n
  }

  /**
   * 경로 하나의 상태가 바뀌었다 — 문서를 고치는 모든 곳이 끝에 부른다.
   * dirty 집합도 여기서 맞춘다: 그 경로의 dirty 여부가 달라졌을 때만 새 집합을 만들고 알린다.
   */
  private touch(path: string) {
    this.pathVersions.set(path, ++this.seq)
    const dirty = this.isDirty(path)
    if (dirty !== this.dirtySet.has(path)) {
      const next = new Set(this.dirtySet)
      if (dirty) next.add(path)
      else next.delete(path)
      this.dirtySet = next
      for (const l of [...this.dirtyListeners]) l()
    }
    // Field 문서는 다른 표들의 스키마에 들어간다. 무엇이 바뀌었는지 가리지 않고 알린다 (fieldFiles() 가 같은 배열을 주면 다시 유도하지 않는다)
    if (isFieldFile(path)) this.touchFields()
    for (const l of [...(this.pathListeners.get(path) ?? [])]) l()
  }
  private touchFields() {
    this.fieldsVersion++
    for (const l of [...this.fieldsListeners]) l()
  }

  get(path: string) { return this.docs.get(path) }
  /** 저장하면 파일에 써질 글 (저장 전 편집 · BOM · 줄바꿈 포함). 열려 있지 않거나 읽는 중이면 null — "템플릿으로 저장" 이 쓴다 */
  fileText(path: string): string | null {
    const d = this.docs.get(path)
    return d && d.status === 'ready' ? serialize(d) : null
  }
  all() { return [...this.docs.values()] }
  isDirty(path: string) {
    const d = this.docs.get(path)
    if (!d || d.status !== 'ready') return false
    return d.kind === 'tsv' ? d.table !== d.savedTable : !d.text.eq(d.savedText)
  }
  // ---- 읽기 전용: 읽기 전용으로 가져온 폴더(mount) 또는 UTF-8 이 아닌 파일(encoding)
  private readOnlyAliases = new Set<string>()
  /** 파일 하나만 가져온 별칭 (DESIGN §28) — 그 안에서는 새 파일 · 이름 바꾸기 · 지우기가 안 된다 */
  private fileAliases = new Set<string>()

  /** 파일 하나만 가져온 곳 안의 경로인가 */
  inFileRoot(path: string): boolean {
    const { alias } = splitRootPath(path)
    return alias !== null && this.fileAliases.has(alias)
  }

  /** 가져온 폴더 목록이 바뀌면 (트리를 읽을 때마다) */
  setMounts(mounts: readonly MountInfo[]) {
    this.fileAliases = new Set(mounts.filter((m) => m.file).map((m) => m.alias))
    const next = new Set(mounts.filter((m) => m.readOnly).map((m) => m.alias))
    if ([...next].sort().join('\n') === [...this.readOnlyAliases].sort().join('\n')) return
    this.readOnlyAliases = next
    // 읽기 전용 여부는 어느 경로든 달라질 수 있다 — 드문 일이라 열린 문서와 구독 중인 경로를 모두 깨운다
    for (const p of new Set([...this.docs.keys(), ...this.pathListeners.keys()])) this.touch(p)
  }

  /** 왜 읽기 전용인가. 가져온 폴더가 우선 (그때는 UTF-8 변환도 막는다) */
  readOnlyReason(path: string): 'mount' | 'encoding' | null {
    const { alias } = splitRootPath(path)
    if (alias !== null && this.readOnlyAliases.has(alias)) return 'mount'
    const d = this.docs.get(path)
    return d && d.status === 'ready' && d.encoding !== 'utf-8' ? 'encoding' : null
  }

  /** 편집·저장을 막는다 */
  isReadOnly(path: string) {
    return this.readOnlyReason(path) !== null
  }
  // 아래 둘은 그 자리에서 다시 센다 — 닫기 전 경고 · 이름 바꾸기 · 삭제를 막는 데 쓰여, 구독용 집합(dirtySnapshot)에 기대지 않는다
  anyDirty() { return this.all().some((d) => this.isDirty(d.path)) }
  dirtyPaths() { return new Set(this.all().filter((d) => this.isDirty(d.path)).map((d) => d.path)) }
  /** 화면이 구독하는 dirty 집합. 구성이 그대로면 같은 객체다 (touch 가 맞춘다) — 고치지 말 것 */
  dirtySnapshot = (): ReadonlySet<string> => this.dirtySet

  /** 창이 문서를 쓰기 시작할 때. 처음이면 디스크에서 읽는다. */
  retain(path: string) {
    this.refs.set(path, (this.refs.get(path) ?? 0) + 1)
    if (!this.docs.has(path)) void this.load(path)
  }
  /**
   * 창이 문서를 놓을 때. 마지막 창이면 메모리에서 내린다.
   * - 탭(그리드 · md 창)은 닫기 확인을 거친 뒤 놓는다 → 저장 안 한 내용이 있어도 내린다 (사용자가 "버리고 닫기" 를 골랐다).
   * - 그 자리 보기(tsv-view)는 `keepDirty` 로 놓는다. 확인 없이 사라지므로 (md 탭 닫기, 소스 모드, 하이브리드에서 커서가 펜스에 들어감)
   *   저장 안 한 내용이 있으면 문서를 남겨 둔다. 그 문서는 계속 dirty 라 "모두 저장" 과 닫기 전 경고에 들고,
   *   트리에서 다시 열면 고친 내용이 그대로 보인다. 저장되면 그때 내린다 (dropIfOrphan).
   * 내리는 것은 마이크로태스크 하나 뒤다 — 같은 순간에 다시 붙잡으면 (React StrictMode 의 effect 두 번 실행,
   * 창을 옮기며 다시 그리기) 내리지 않는다. 그 사이 디스크에서 다시 읽거나 남겨 둔 편집을 잃지 않게.
   */
  release(path: string, opts: { keepDirty?: boolean } = {}) {
    const n = (this.refs.get(path) ?? 1) - 1
    if (n > 0) { this.refs.set(path, n); return }
    this.refs.delete(path)
    if (opts.keepDirty && this.isDirty(path)) { this.touch(path); return }
    const d = this.docs.get(path)
    queueMicrotask(() => {
      if (!this.refs.has(path) && this.docs.get(path) === d) this.drop(path)
    })
  }

  private held = new Set<string>()
  /**
   * 앱 화면이 오류로 통째로 내려갈 때(DESIGN §22 U11) — 창들이 놓기(`release`) 전에 부른다.
   * 창의 놓기는 "탭 닫기" 라 dirty 여도 내리는데, 이때는 사용자가 닫은 것이 아니다. 저장 안 한 문서를 하나씩 더 붙잡아
   * 오류 화면에서 저장할 수 있게 남긴다. 여러 번 불러도 한 번만 붙잡는다.
   */
  holdDirty() {
    for (const path of this.dirtyPaths()) {
      if (this.held.has(path)) continue
      this.held.add(path)
      this.refs.set(path, (this.refs.get(path) ?? 0) + 1)
    }
  }

  /** 아무 창도 붙잡지 않은 문서인가 (keepDirty 로 남은 문서) */
  isOrphan(path: string) {
    return this.docs.has(path) && !this.refs.has(path)
  }

  private drop(path: string) {
    // 보조 표로도 읽히던 표(계산식 · lookup 대상 · Field)라면 캐시는 탭을 열기 전에 읽은 옛 내용이다 — 내 저장은
    // 수정 시각이 같아 handleExternal 이 건너뛴다. 내려가는 문서의 "디스크와 같은 표" 로 바꿔 둔다 (모르면 버리고 다시 읽게)
    if (this.auxCache.has(path)) {
      const d = this.docs.get(path)
      if (d?.kind === 'tsv' && d.status === 'ready' && !d.conflict && d.mtime !== null) this.auxCache.set(path, { mtime: d.mtime, table: d.savedTable })
      else this.auxCache.delete(path)
    }
    this.docs.delete(path)
    this.changeListeners.delete(path)
    if (isFieldFile(path)) this.fieldsStale = true
    this.touch(path)
  }

  /** 창 없이 남아 있던 문서가 더는 dirty 가 아니면 (저장됨 · 디스크 내용 받음) 내린다 */
  private dropIfOrphan(path: string) {
    const d = this.docs.get(path)
    if (d && !this.refs.has(path) && !d.saving && !this.isDirty(path)) this.drop(path)
  }

  private async load(path: string) {
    const base: DocBase = { path, status: 'loading', error: null, mtime: null, conflict: null, saving: false, encoding: 'utf-8' }
    const empty = Text.of([''])
    const d: Doc = isTsvPath(path)
      ? { ...base, kind: 'tsv', table: parseTable('', path), savedTable: parseTable('', path), past: [], future: [], warnings: [] }
      : { ...base, kind: 'text', text: empty, savedText: empty, eol: '\n', bom: false, bakeErrors: [] }
    if (d.kind === 'tsv') d.savedTable = d.table
    this.docs.set(path, d)
    this.touch(path)
    try {
      const f = await backend().read(path)
      if (this.docs.get(path) !== d) return // 읽는 사이 닫힘
      d.encoding = f.encoding ?? 'utf-8'
      if (d.kind === 'tsv') {
        const table = parseTable(f.text, path)
        Object.assign(d, { status: 'ready', table, savedTable: table, past: [], future: [], warnings: tableOpenWarnings(table), mtime: f.mtime })
        if (isFieldFile(path)) this.fieldsStale = true
      } else {
        const p = parseText(f.text)
        Object.assign(d, { status: 'ready', text: p.text, savedText: p.text, mtime: f.mtime, eol: p.eol, bom: p.bom })
      }
    } catch (e) {
      d.status = 'error'
      d.error = (e as Error).message
    }
    this.touch(path)
  }

  // ---------------------------------------------------------------- 텍스트 문서
  onChanges(path: string, l: ChangeListener) {
    let set = this.changeListeners.get(path)
    if (!set) this.changeListeners.set(path, (set = new Set()))
    set.add(l)
    return () => { set.delete(l) }
  }

  /** 한 창의 수정을 문서에 반영하고 다른 창들에 알린다. source 는 보낸 창 (자기 것은 건너뛴다). */
  applyChanges(path: string, changes: ChangeSet, source: symbol | null) {
    const d = this.docs.get(path)
    if (!d || d.status !== 'ready' || d.kind !== 'text') return
    d.text = changes.apply(d.text)
    for (const l of this.changeListeners.get(path) ?? []) l(changes, source)
    this.touch(path)
  }

  // ---------------------------------------------------------------- TSV 문서
  /** 표를 바꾼다. fn 이 같은 객체를 돌려주면 (바뀐 게 없으면) 아무 일도 없다. */
  editTable(path: string, fn: (t: TsvTable) => TsvTable) {
    const d = this.docs.get(path)
    if (!d || d.status !== 'ready' || d.kind !== 'tsv' || this.isReadOnly(path)) return
    const next = fn(d.table)
    if (next === d.table) return
    d.past.push(d.table)
    if (d.past.length > UNDO_LIMIT) d.past.shift()
    d.future = []
    d.table = next
    if (isFieldFile(path)) this.fieldsStale = true
    this.touch(path)
  }
  /**
   * 마지막 저장 상태로 되돌린다 (DESIGN §34) — 표는 저장된 스냅샷을 되돌리기 한 단계로 올린다(`Ctrl+Z` 로 다시 고친 표로).
   * 읽기 전용이어도 된다 — 고친 것을 버리는 일이라. 충돌 중이면 하지 않는다(배너의 "디스크 내용 받기" 가 맡는다).
   * 글 문서는 편집기 창이 트랜잭션으로 한다(`lib/revert.ts`) — 되돌리기 기록이 편집기에 있어서.
   * 되돌렸으면 true
   */
  revertTable(path: string): boolean {
    const d = this.docs.get(path)
    if (!d || d.kind !== 'tsv' || d.status !== 'ready' || d.conflict || d.saving || d.table === d.savedTable) return false
    d.past.push(d.table)
    if (d.past.length > UNDO_LIMIT) d.past.shift()
    d.future = []
    d.table = d.savedTable
    if (isFieldFile(path)) this.fieldsStale = true
    this.touch(path)
    return true
  }
  canUndo(path: string) { const d = this.docs.get(path); return d?.kind === 'tsv' && d.past.length > 0 }
  canRedo(path: string) { const d = this.docs.get(path); return d?.kind === 'tsv' && d.future.length > 0 }
  undo(path: string) {
    const d = this.docs.get(path)
    if (!d || d.kind !== 'tsv' || d.past.length === 0) return
    d.future.push(d.table)
    d.table = d.past.pop()!
    if (isFieldFile(path)) this.fieldsStale = true
    this.touch(path)
  }
  redo(path: string) {
    const d = this.docs.get(path)
    if (!d || d.kind !== 'tsv' || d.future.length === 0) return
    d.past.push(d.table)
    d.table = d.future.pop()!
    if (isFieldFile(path)) this.fieldsStale = true
    this.touch(path)
  }

  // ---------------------------------------------------------------- Field 시트
  /** 파일 트리가 바뀌면 호출. `*_Field.tsv` 목록과 전체 경로 집합을 갱신한다. */
  setTree(entries: TreeEntry[]) {
    const paths: string[] = []
    const all = new Set<string>()
    const walk = (es: TreeEntry[]) => {
      for (const e of es) {
        if (e.type === 'dir') walk(e.children ?? [])
        else { all.add(e.path); if (isFieldFile(e.path)) paths.push(e.path) }
      }
    }
    walk(entries)
    paths.sort()
    const prev = this.treePaths
    const treeChanged = prev.size !== all.size || [...all].some((p) => !prev.has(p))
    this.treePaths = all
    // 사라진 파일의 캐시는 버린다. 그 표를 보조 표로 읽던 창(계산식 · lookup)이 알게 한다
    for (const p of [...this.auxCache.keys()]) if (!all.has(p)) { this.auxCache.delete(p); this.touch(p) }
    if (paths.join('\n') !== this.fieldPaths.join('\n')) {
      this.fieldPaths = paths
      this.fieldsStale = true
      this.touchFields()
    }
    if (treeChanged) {
      this.treeVersion++
      for (const l of [...this.treeListeners]) l()
    }
    for (const p of this.fieldPaths) this.ensureAux(p)
  }

  /** 트리의 모든 파일 경로 (경로 막대의 목록 — DESIGN §31). 읽기만 한다 */
  filePaths(): ReadonlySet<string> {
    return this.treePaths
  }

  /** 트리에 있는 파일인가 (아직 트리를 못 받았으면 모른다 → true) */
  hasPath(path: string): boolean {
    return this.treePaths.size === 0 || this.treePaths.has(path)
  }

  /**
   * 열려 있지 않은 표를 디스크에서 읽어 둔다. 읽히면 그 경로의 구독자를 깨운다 — 다시 그릴 때 auxTable 이 값을 준다.
   * notifyOnFail: 못 읽었을 때도 깨운다. 있던 캐시를 버리고 다시 읽는 handleExternal 만 쓴다 —
   * 평소에 켜면 렌더 → auxTable → 읽기 실패 → 알림 → 렌더 … 로 돈다.
   */
  ensureAux(path: string, notifyOnFail = false) {
    if (!isTsvPath(path) || this.auxCache.has(path) || this.auxLoading.has(path) || this.docs.has(path) || !this.hasPath(path)) return
    this.auxLoading.add(path)
    backend().read(path)
      .then((f) => {
        this.auxCache.set(path, { mtime: f.mtime, table: parseTable(f.text, path) })
        if (isFieldFile(path)) this.fieldsStale = true
        this.touch(path)
      })
      .catch(() => { if (notifyOnFail) this.touch(path) /* 못 읽으면 없는 것으로 */ })
      .finally(() => this.auxLoading.delete(path))
  }

  /** 표 하나 — 열려 있으면 (저장 전) 그 표, 아니면 디스크 캐시. 아직 없으면 null (읽기를 시작한다) */
  auxTable(path: string): TsvTable | null {
    const d = this.docs.get(path)
    if (d?.kind === 'tsv') return d.status === 'ready' ? d.table : null
    const c = this.auxCache.get(path)
    if (c) return c.table
    this.ensureAux(path)
    return null
  }

  /**
   * 스키마 유도에 쓸 Field 파일들. 열려 있는 Field 문서는 편집 중인 내용을 그대로 쓰고, 나머지는 디스크에서 읽은 것.
   * 바뀐 게 없으면 같은 배열을 돌려준다 (useMemo 의존성으로 쓸 수 있게).
   */
  fieldFiles(): FieldFile[] {
    for (const p of this.fieldPaths) this.ensureAux(p)
    // 열린 Field 문서의 표가 바뀌었는지
    for (const p of this.fieldPaths) {
      const d = this.docs.get(p)
      if (d?.kind === 'tsv' && d.status === 'ready' && this.liveFieldParsed.get(p)?.table !== d.table) this.fieldsStale = true
    }
    if (!this.fieldsStale) return this.fieldsResult
    const out: FieldFile[] = []
    for (const p of this.fieldPaths) {
      const d = this.docs.get(p)
      if (d?.kind === 'tsv' && d.status === 'ready') {
        let live = this.liveFieldParsed.get(p)
        if (!live || live.table !== d.table) {
          live = { table: d.table, file: parseFieldBlocks(p, d.table) }
          this.liveFieldParsed.set(p, live)
        }
        out.push(live.file)
      } else {
        const c = this.auxCache.get(p)
        if (!c) continue
        let parsed = this.cachedFieldParsed.get(p)
        if (!parsed || parsed.table !== c.table) {
          parsed = { table: c.table, file: parseFieldBlocks(p, c.table) }
          this.cachedFieldParsed.set(p, parsed)
        }
        out.push(parsed.file)
      }
    }
    this.fieldsResult = out
    this.fieldsStale = false
    return out
  }

  // ---------------------------------------------------------------- 저장 · 외부 변경
  private replaceAll(d: Doc, raw: string, mtime: number, encoding = 'utf-8') {
    d.encoding = encoding
    if (d.kind === 'tsv') {
      const table = parseTable(raw, d.path)
      d.table = table
      d.savedTable = table
      d.past = []
      d.future = []
      d.warnings = tableOpenWarnings(table)
      if (isFieldFile(d.path)) this.fieldsStale = true
    } else {
      const p = parseText(raw)
      d.eol = p.eol
      d.bom = p.bom
      this.applyChanges(d.path, ChangeSet.of({ from: 0, to: d.text.length, insert: p.text }, d.text.length), null)
      d.savedText = d.text
    }
    d.mtime = mtime
    d.conflict = null
    this.touch(d.path)
    this.dropIfOrphan(d.path)
  }

  async save(path: string, baseMtime?: number | null, opts: { convert?: boolean } = {}) {
    const d = this.docs.get(path)
    if (!d || d.status !== 'ready' || d.saving) return
    if (d.conflict && baseMtime === undefined) return // 배너에서 골라야 한다
    // 읽기 전용 — 가져온 폴더면 아무것도, UTF-8 아닌 파일이면 배너의 "UTF-8 로 바꿔 저장" 만
    const ro = this.readOnlyReason(path)
    if (ro === 'mount' || (ro === 'encoding' && !opts.convert)) return
    d.saving = true
    this.touch(path)
    if (d.kind === 'text' && fileTypeOf(path)?.kind === 'md') await this.bakeIfNeeded(d)
    const snapshot = d.kind === 'tsv' ? d.table : d.text
    try {
      const r = await backend().write(path, serialize(d), baseMtime === undefined ? d.mtime : baseMtime, opts)
      if (opts.convert) d.encoding = 'utf-8'
      if (d.kind === 'tsv') d.savedTable = snapshot as TsvTable
      else d.savedText = snapshot as Text
      d.mtime = r.mtime
      d.conflict = null
      d.error = null
    } catch (e) {
      if (e instanceof ConflictError) d.conflict = { text: e.text, mtime: e.mtime, encoding: e.encoding }
      else d.error = (e as Error).message
    } finally {
      d.saving = false
      this.touch(path)
      this.dropIfOrphan(path)
    }
  }

  async saveAll() {
    for (const d of this.all()) if (this.isDirty(d.path)) await this.save(d.path)
  }

  /**
   * UTF-8 이 아닌 파일(EUC-KR 등)을 지금 보이는 내용 그대로 UTF-8 로 다시 쓴다.
   * 원래 인코딩으로 되쓰지는 않는다 (브라우저·Node 에 CP949 인코더가 없다). 쓰고 나면 편집할 수 있다.
   */
  async convertToUtf8(path: string) {
    const d = this.docs.get(path)
    if (!d || d.status !== 'ready' || d.encoding === 'utf-8') return
    // CSV 는 BOM 을 붙인다 — Excel 은 BOM 없는 UTF-8 CSV 의 한글을 깨뜨린다 ("CSV UTF-8" 저장 형식과 같다)
    if (d.kind === 'tsv' && d.table.format === 'csv' && !d.table.bom) {
      d.table = { ...d.table, bom: true }
      d.savedTable = d.table
    }
    await this.save(path, undefined, { convert: true })
  }

  /**
   * `bake: true` 인 tsv-view 펜스 아래에 파이프 표를 다시 쓴다 (DESIGN §7.1). 저장 직전에 문서 텍스트를 고친다.
   * 참조한 TSV 가 열려 있으면 그 (저장 전) 표를, 아니면 디스크에서 읽는다.
   */
  private async bakeIfNeeded(d: TextDoc) {
    const text = d.text.toString()
    if (!/bake\s*:\s*(true|yes|1)\b/i.test(text)) { if (d.bakeErrors.length) { d.bakeErrors = []; this.touch(d.path) } return }
    const sources = new Map<string, BakeSource>()
    for (const file of bakeTargets(text, d.path)) {
      const open = this.docs.get(file)
      let table: TsvTable | null = null
      if (open?.kind === 'tsv' && open.status === 'ready') table = open.table
      else {
        try { table = parseTable((await backend().read(file)).text, file) } catch { table = null }
      }
      if (table) sources.set(file, { table, schema: deriveSchema(table, file, this.fieldFiles()) })
    }
    if (this.docs.get(d.path) !== d || d.status !== 'ready') return
    // 읽는 사이 문서가 바뀌었을 수 있으니 지금 텍스트로 다시 계산한다. CM 텍스트는 항상 \n 이다
    const now = d.text.toString()
    const r = bakeMarkdown(now, d.path, (f) => sources.get(f) ?? null, '\n')
    d.bakeErrors = r.errors
    if (r.changes.length) {
      this.applyChanges(d.path, ChangeSet.of(r.changes.map((c) => ({ from: c.from, to: c.to, insert: c.insert })), now.length), null)
    } else this.touch(d.path)
  }

  /** 충돌: 내 내용으로 덮어쓴다 */
  overwrite(path: string) {
    const d = this.docs.get(path)
    if (d?.conflict) return this.save(path, d.conflict.mtime)
  }
  /** 충돌: 디스크 내용을 받아들인다 (내 수정은 버린다) */
  takeDisk(path: string) {
    const d = this.docs.get(path)
    if (d?.conflict) this.replaceAll(d, d.conflict.text, d.conflict.mtime, d.conflict.encoding)
  }

  /** 파일 변경 알림. 내가 방금 저장한 것이면 mtime 이 같아 무시된다. */
  async handleExternal(e: ChangeEvent) {
    const d = this.docs.get(e.path)
    if (!d) {
      // 열려 있지 않은 보조 표(Field·Calc·lookup 대상)가 바뀌면 캐시를 버리고 다시 읽는다
      if (this.auxCache.has(e.path)) { this.auxCache.delete(e.path); if (isFieldFile(e.path)) this.fieldsStale = true; this.ensureAux(e.path, true) }
      return
    }
    if (d.status !== 'ready' || d.saving) return
    let f
    try { f = await backend().read(e.path) } catch { return } // 삭제 등
    if (d.mtime !== null && Math.abs(f.mtime - d.mtime) < 1) return
    const encoding = f.encoding ?? 'utf-8'
    if (!this.isDirty(e.path)) this.replaceAll(d, f.text, f.mtime, encoding)
    else { d.conflict = { text: f.text, mtime: f.mtime, encoding }; this.touch(e.path) }
  }

  /**
   * 무엇이 바뀌었는지 모를 때 (창에 돌아옴, 감시 끊김, 감시가 없는 브라우저의 주기 확인) 디스크와 맞춰 본다.
   * 열린 문서와, 열려 있지 않은 보조 표(계산식 · lookup 대상 · Field)의 캐시 둘 다 — 캐시를 빼면 감시가 없는 브라우저에서
   * 바깥에서 고친 계산식 · Field 가 반영되지 않는다 (DESIGN §24.7 X11).
   */
  async recheckOpen() {
    await Promise.all([
      ...this.all().map((d) => this.handleExternal({ type: 'change', event: 'change', path: d.path })),
      ...[...this.auxCache.keys()].map((p) => this.recheckAux(p)),
    ])
  }

  /** 보조 표 캐시 하나를 수정 시각으로 다시 본다 (내용은 읽지 않는다). 달라졌거나 지워졌으면 바깥 변경과 같은 길로 다시 읽는다 */
  private async recheckAux(path: string) {
    const c = this.auxCache.get(path)
    if (!c || this.docs.has(path)) return // 열린 문서는 문서 쪽에서 본다
    let mtime: number | null
    try { mtime = (await backend().stat(path)).mtime } catch { mtime = null } // 지워짐 등
    if (this.auxCache.get(path) !== c) return // 그 사이 다시 읽혔다
    if (mtime !== null && Math.abs(mtime - c.mtime) < 1) return
    await this.handleExternal({ type: 'change', event: 'change', path })
  }
}

export const store = new DocumentStore()

// ---------------------------------------------------------------- React 구독 (DESIGN §24.5)
// 돌려주는 값은 "바뀌었다" 는 신호일 뿐이다 — 내용은 렌더 중에 store.get(path) 등으로 읽는다.
// 스냅샷은 숫자 · 문자열 · 구성이 바뀔 때만 새로 생기는 Set 이라, 바뀐 게 없으면 다시 그리지 않는다.

const noSubscription = () => () => {}

/** 이 경로의 문서(또는 보조 표)가 바뀔 때만 다시 그린다. null 이면 구독하지 않는다 */
export function useDocVersion(path: string | null): number {
  const subscribe = useCallback((l: () => void) => (path === null ? noSubscription() : store.subscribePath(path, l)), [path])
  return useSyncExternalStore(subscribe, () => (path === null ? 0 : store.pathVersion(path)))
}

/** 여러 경로 중 하나라도 바뀌면 다시 그린다 — 그리드가 읽는 lookup 대상 표들처럼 개수가 정해지지 않은 의존 */
export function useDocVersions(paths: readonly string[]): string {
  const key = paths.join('\n')
  const subscribe = useCallback((l: () => void) => {
    const offs = (key ? key.split('\n') : []).map((p) => store.subscribePath(p, l))
    return () => { for (const off of offs) off() }
  }, [key])
  return useSyncExternalStore(subscribe, () => paths.map((p) => store.pathVersion(p)).join(','))
}

/** 저장 안 한 문서의 경로들 — 구성이 바뀔 때만 다시 그린다 (글자를 더 쳐도 그대로다) */
export function useDirtyPaths(): ReadonlySet<string> {
  return useSyncExternalStore(store.subscribeDirty, store.dirtySnapshot)
}

/** store.fieldFiles() 를 읽는 곳 — Field 파일 목록이나 내용이 바뀔 때 다시 그린다 */
export function useFieldsVersion(): number {
  return useSyncExternalStore(store.subscribeFields, store.getFieldsVersion)
}

/** store.hasPath() 를 읽는 곳 — 파일 경로 집합이 바뀔 때 다시 그린다 */
export function useTreeVersion(): number {
  return useSyncExternalStore(store.subscribeTree, store.getTreeVersion)
}
