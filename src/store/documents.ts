import { useSyncExternalStore } from 'react'
import { ChangeSet, Text } from '@codemirror/state'
import { backend, ConflictError, type ChangeEvent } from '../lib/backend'

export type Eol = '\n' | '\r\n'

/**
 * 열린 문서 하나. 경로당 하나만 있고, 창(페인)이 몇 개든 같은 객체를 본다.
 * 텍스트는 CodeMirror Text — 모든 수정은 ChangeSet 으로 들어와 모든 창에 같은 ChangeSet 이 전달된다.
 */
export interface Doc {
  path: string
  status: 'loading' | 'ready' | 'error'
  error: string | null
  text: Text
  savedText: Text
  /** 디스크의 mtime. 아직 디스크에 없는 새 파일이면 null */
  mtime: number | null
  eol: Eol
  bom: boolean
  /** 디스크가 더 새로워서 사용자가 골라야 하는 상태 */
  conflict: { text: string; mtime: number } | null
  saving: boolean
}

export type ChangeListener = (changes: ChangeSet, source: symbol | null) => void

/** 파일 → Text. BOM 과 줄바꿈 종류는 따로 기억해 저장 때 되돌린다. */
function parseText(raw: string): { bom: boolean; eol: Eol; text: Text } {
  const bom = raw.charCodeAt(0) === 0xfeff
  if (bom) raw = raw.slice(1)
  const eol: Eol = raw.includes('\r\n') ? '\r\n' : '\n'
  return { bom, eol, text: Text.of(raw.split(/\r\n|\r|\n/)) }
}

function serialize(d: Doc): string {
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
    return !!d && d.status === 'ready' && !d.text.eq(d.savedText)
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
    this.emit()
  }

  private async load(path: string) {
    const empty = Text.of([''])
    const d: Doc = { path, status: 'loading', error: null, text: empty, savedText: empty, mtime: null, eol: '\n', bom: false, conflict: null, saving: false }
    this.docs.set(path, d)
    this.emit()
    try {
      const f = await backend().read(path)
      if (this.docs.get(path) !== d) return // 읽는 사이 닫힘
      const p = parseText(f.text)
      Object.assign(d, { status: 'ready', text: p.text, savedText: p.text, mtime: f.mtime, eol: p.eol, bom: p.bom })
    } catch (e) {
      d.status = 'error'
      d.error = (e as Error).message
    }
    this.emit()
  }

  onChanges(path: string, l: ChangeListener) {
    let set = this.changeListeners.get(path)
    if (!set) this.changeListeners.set(path, (set = new Set()))
    set.add(l)
    return () => { set.delete(l) }
  }

  /** 한 창의 수정을 문서에 반영하고 다른 창들에 알린다. source 는 보낸 창 (자기 것은 건너뛴다). */
  applyChanges(path: string, changes: ChangeSet, source: symbol | null) {
    const d = this.docs.get(path)
    if (!d || d.status !== 'ready') return
    d.text = changes.apply(d.text)
    for (const l of this.changeListeners.get(path) ?? []) l(changes, source)
    this.emit()
  }

  private replaceAll(d: Doc, raw: string, mtime: number) {
    const p = parseText(raw)
    d.eol = p.eol
    d.bom = p.bom
    this.applyChanges(d.path, ChangeSet.of({ from: 0, to: d.text.length, insert: p.text }, d.text.length), null)
    d.savedText = d.text
    d.mtime = mtime
    d.conflict = null
    this.emit()
  }

  async save(path: string, baseMtime?: number | null) {
    const d = this.docs.get(path)
    if (!d || d.status !== 'ready' || d.saving) return
    if (d.conflict && baseMtime === undefined) return // 배너에서 골라야 한다
    d.saving = true
    this.emit()
    const snapshot = d.text
    try {
      const r = await backend().write(path, serialize(d), baseMtime === undefined ? d.mtime : baseMtime)
      d.savedText = snapshot
      d.mtime = r.mtime
      d.conflict = null
      d.error = null
    } catch (e) {
      if (e instanceof ConflictError) d.conflict = { text: e.text, mtime: e.mtime }
      else d.error = (e as Error).message
    } finally {
      d.saving = false
      this.emit()
    }
  }

  async saveAll() {
    for (const d of this.all()) if (this.isDirty(d.path)) await this.save(d.path)
  }

  /** 충돌: 내 내용으로 덮어쓴다 */
  overwrite(path: string) {
    const d = this.docs.get(path)
    if (d?.conflict) return this.save(path, d.conflict.mtime)
  }
  /** 충돌: 디스크 내용을 받아들인다 (내 수정은 버린다) */
  takeDisk(path: string) {
    const d = this.docs.get(path)
    if (d?.conflict) this.replaceAll(d, d.conflict.text, d.conflict.mtime)
  }

  /** 사이드카의 파일 변경 알림. 내가 방금 저장한 것이면 mtime 이 같아 무시된다. */
  async handleExternal(e: ChangeEvent) {
    const d = this.docs.get(e.path)
    if (!d || d.status !== 'ready' || d.saving) return
    let f
    try { f = await backend().read(e.path) } catch { return } // 삭제 등
    if (d.mtime !== null && Math.abs(f.mtime - d.mtime) < 1) return
    if (!this.isDirty(e.path)) this.replaceAll(d, f.text, f.mtime)
    else { d.conflict = { text: f.text, mtime: f.mtime }; this.emit() }
  }
}

export const store = new DocumentStore()

/** 스토어가 바뀔 때마다 다시 그리게 한다. 값은 버전 번호라 비교만 쓴다. */
export function useStoreVersion() {
  return useSyncExternalStore(store.subscribe, store.getVersion)
}
