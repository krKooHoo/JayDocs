import { useSyncExternalStore } from 'react'
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

class DocumentStore {
  version = 0
  private docs = new Map<string, Doc>()
  private refs = new Map<string, number>()
  private listeners = new Set<() => void>()
  private changeListeners = new Map<string, Set<ChangeListener>>()

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

  subscribe = (l: () => void) => {
    this.listeners.add(l)
    return () => { this.listeners.delete(l) }
  }
  getVersion = () => this.version
  private emit() {
    this.version++
    for (const l of this.listeners) l()
  }

  get(path: string) { return this.docs.get(path) }
  all() { return [...this.docs.values()] }
  isDirty(path: string) {
    const d = this.docs.get(path)
    if (!d || d.status !== 'ready') return false
    return d.kind === 'tsv' ? d.table !== d.savedTable : !d.text.eq(d.savedText)
  }
  // ---- 읽기 전용: 읽기 전용으로 가져온 폴더(mount) 또는 UTF-8 이 아닌 파일(encoding)
  private readOnlyAliases = new Set<string>()

  /** 가져온 폴더 목록이 바뀌면 (트리를 읽을 때마다) */
  setMounts(mounts: readonly MountInfo[]) {
    const next = new Set(mounts.filter((m) => m.readOnly).map((m) => m.alias))
    if ([...next].sort().join('\n') === [...this.readOnlyAliases].sort().join('\n')) return
    this.readOnlyAliases = next
    this.emit()
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
  anyDirty() { return this.all().some((d) => this.isDirty(d.path)) }
  dirtyPaths() { return new Set(this.all().filter((d) => this.isDirty(d.path)).map((d) => d.path)) }

  /** 창이 문서를 쓰기 시작할 때. 처음이면 디스크에서 읽는다. */
  retain(path: string) {
    this.refs.set(path, (this.refs.get(path) ?? 0) + 1)
    if (!this.docs.has(path)) void this.load(path)
  }
  /** 창이 문서를 놓을 때. 마지막 창이면 메모리에서 내린다 (닫기 확인은 창 쪽에서). */
  release(path: string) {
    const n = (this.refs.get(path) ?? 1) - 1
    if (n > 0) { this.refs.set(path, n); return }
    this.refs.delete(path)
    this.docs.delete(path)
    this.changeListeners.delete(path)
    if (isFieldFile(path)) this.fieldsStale = true
    this.emit()
  }

  private async load(path: string) {
    const base: DocBase = { path, status: 'loading', error: null, mtime: null, conflict: null, saving: false, encoding: 'utf-8' }
    const empty = Text.of([''])
    const d: Doc = isTsvPath(path)
      ? { ...base, kind: 'tsv', table: parseTable('', path), savedTable: parseTable('', path), past: [], future: [], warnings: [] }
      : { ...base, kind: 'text', text: empty, savedText: empty, eol: '\n', bom: false, bakeErrors: [] }
    if (d.kind === 'tsv') d.savedTable = d.table
    this.docs.set(path, d)
    this.emit()
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
    this.emit()
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
    this.emit()
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
    this.emit()
  }
  canUndo(path: string) { const d = this.docs.get(path); return d?.kind === 'tsv' && d.past.length > 0 }
  canRedo(path: string) { const d = this.docs.get(path); return d?.kind === 'tsv' && d.future.length > 0 }
  undo(path: string) {
    const d = this.docs.get(path)
    if (!d || d.kind !== 'tsv' || d.past.length === 0) return
    d.future.push(d.table)
    d.table = d.past.pop()!
    if (isFieldFile(path)) this.fieldsStale = true
    this.emit()
  }
  redo(path: string) {
    const d = this.docs.get(path)
    if (!d || d.kind !== 'tsv' || d.future.length === 0) return
    d.past.push(d.table)
    d.table = d.future.pop()!
    if (isFieldFile(path)) this.fieldsStale = true
    this.emit()
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
    this.treePaths = all
    for (const p of [...this.auxCache.keys()]) if (!all.has(p)) this.auxCache.delete(p)
    if (paths.join('\n') !== this.fieldPaths.join('\n')) {
      this.fieldPaths = paths
      this.fieldsStale = true
      this.emit()
    }
    for (const p of this.fieldPaths) this.ensureAux(p)
  }

  /** 트리에 있는 파일인가 (아직 트리를 못 받았으면 모른다 → true) */
  hasPath(path: string): boolean {
    return this.treePaths.size === 0 || this.treePaths.has(path)
  }

  /** 열려 있지 않은 표를 디스크에서 읽어 둔다. 읽히면 emit — 다시 그릴 때 auxTable 이 값을 준다 */
  ensureAux(path: string) {
    if (!isTsvPath(path) || this.auxCache.has(path) || this.auxLoading.has(path) || this.docs.has(path) || !this.hasPath(path)) return
    this.auxLoading.add(path)
    backend().read(path)
      .then((f) => {
        this.auxCache.set(path, { mtime: f.mtime, table: parseTable(f.text, path) })
        if (isFieldFile(path)) this.fieldsStale = true
        this.emit()
      })
      .catch(() => { /* 못 읽으면 없는 것으로 */ })
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
    this.emit()
  }

  async save(path: string, baseMtime?: number | null, opts: { convert?: boolean } = {}) {
    const d = this.docs.get(path)
    if (!d || d.status !== 'ready' || d.saving) return
    if (d.conflict && baseMtime === undefined) return // 배너에서 골라야 한다
    // 읽기 전용 — 가져온 폴더면 아무것도, UTF-8 아닌 파일이면 배너의 "UTF-8 로 바꿔 저장" 만
    const ro = this.readOnlyReason(path)
    if (ro === 'mount' || (ro === 'encoding' && !opts.convert)) return
    d.saving = true
    this.emit()
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
      this.emit()
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
    if (!/bake\s*:\s*(true|yes|1)\b/i.test(text)) { if (d.bakeErrors.length) { d.bakeErrors = []; this.emit() } return }
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
    } else this.emit()
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
      if (this.auxCache.has(e.path)) { this.auxCache.delete(e.path); if (isFieldFile(e.path)) this.fieldsStale = true; this.ensureAux(e.path) }
      return
    }
    if (d.status !== 'ready' || d.saving) return
    let f
    try { f = await backend().read(e.path) } catch { return } // 삭제 등
    if (d.mtime !== null && Math.abs(f.mtime - d.mtime) < 1) return
    const encoding = f.encoding ?? 'utf-8'
    if (!this.isDirty(e.path)) this.replaceAll(d, f.text, f.mtime, encoding)
    else { d.conflict = { text: f.text, mtime: f.mtime, encoding }; this.emit() }
  }

  /** 무엇이 바뀌었는지 모를 때 (창에 돌아옴, 감시 끊김) 열린 문서를 디스크와 맞춰 본다 */
  async recheckOpen() {
    await Promise.all(this.all().map((d) => this.handleExternal({ type: 'change', event: 'change', path: d.path })))
  }
}

export const store = new DocumentStore()

/** 스토어가 바뀔 때마다 다시 그리게 한다. 값은 버전 번호라 비교만 쓴다. */
export function useStoreVersion() {
  return useSyncExternalStore(store.subscribe, store.getVersion)
}
