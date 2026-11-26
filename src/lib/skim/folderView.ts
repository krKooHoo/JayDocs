import { useSyncExternalStore } from 'react'
import type { GridKey } from './grid'

/**
 * 폴더 격자의 보기 · 정렬 (ADOPT B6 · DESIGN §51). 앱 전체에 하나, 이 브라우저의 localStorage 에만 남긴다 (화면 상태).
 *
 * - 보기: 격자(썸네일 카드) ↔ 목록(이름 · 수정 시각 · 크기). 격자 안에서 `Ctrl+Shift+V`.
 * - 정렬: 이름(트리 순서) ↔ 수정 시각(새것부터, "오늘 · 어제 · 지난 7일 · 그 전" 묶음). 폴더는 시각이 없어 맨 앞 "폴더" 묶음.
 * - 수정 시각 · 크기는 목록 보기나 시각 정렬일 때만 읽는다 (원칙 2). 다 읽기 전에는 이름 순서 그대로 둔다 — 순서가 흔들리지 않게.
 */
export type FolderView = 'grid' | 'list'
export type FolderSort = 'name' | 'time'

export interface FolderPrefs {
  view: FolderView
  sort: FolderSort
}

export const FOLDER_DEFAULT: FolderPrefs = { view: 'grid', sort: 'name' }
const KEY = 'jaydocs.folderView'

export function cleanFolderPrefs(raw: unknown): FolderPrefs {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  return { view: r.view === 'list' ? 'list' : 'grid', sort: r.sort === 'time' ? 'time' : 'name' }
}

let prefs: FolderPrefs | null = null
const listeners = new Set<() => void>()

export function folderPrefs(): FolderPrefs {
  if (!prefs) {
    try { prefs = cleanFolderPrefs(JSON.parse(localStorage.getItem(KEY) ?? 'null')) } catch { prefs = FOLDER_DEFAULT }
  }
  return prefs
}

function save(next: FolderPrefs) {
  prefs = next
  try { localStorage.setItem(KEY, JSON.stringify(next)) } catch { /* 저장 못 해도 이 창에서는 동작한다 */ }
  for (const l of listeners) l()
}

export function setFolderView(view: FolderView) { save({ ...folderPrefs(), view }) }
export function toggleFolderView(): FolderView {
  const view = folderPrefs().view === 'grid' ? 'list' : 'grid'
  setFolderView(view)
  return view
}
export function setFolderSort(sort: FolderSort) { save({ ...folderPrefs(), sort }) }

export function useFolderPrefs(): FolderPrefs {
  return useSyncExternalStore((l) => { listeners.add(l); return () => { listeners.delete(l) } }, folderPrefs)
}

// ---- 수정 시각 묶음 · 정렬
export interface FileStat {
  mtime: number
  size?: number
}

export type DateGroup = '오늘' | '어제' | '지난 7일' | '그 전'
const DAY = 86_400_000

/** 수정 시각 → 묶음. 날의 경계는 이 컴퓨터의 자정 */
export function dateGroup(mtime: number, now: number): DateGroup {
  const d = new Date(now)
  const today = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  if (mtime >= today) return '오늘'
  if (mtime >= today - DAY) return '어제'
  if (mtime >= today - 7 * DAY) return '지난 7일'
  return '그 전'
}

interface Item {
  type: 'dir' | 'file'
  path: string
}

export interface FolderSection<T> {
  /** 묶음 머리 — 없으면 머리 없이 */
  title: string | null
  items: T[]
}

/**
 * 보일 순서. 이름 정렬은 트리 순서 그대로 한 묶음. 시각 정렬은 폴더 → 오늘 → 어제 → 지난 7일 → 그 전 → 시각을 못 읽은 파일.
 * stats: 읽은 것 (null = 못 읽음). 아직 안 읽은 파일이 있으면(pending > 0) 이름 순서 그대로
 */
export function folderSections<T extends Item>(items: readonly T[], sort: FolderSort, stats: ReadonlyMap<string, FileStat | null>, now: number): { sections: FolderSection<T>[]; pending: number } {
  const files = items.filter((it) => it.type === 'file')
  const pending = files.filter((f) => !stats.has(f.path)).length
  if (sort === 'name' || pending > 0 || !files.length) return { sections: [{ title: null, items: [...items] }], pending: sort === 'name' ? 0 : pending }
  const out: FolderSection<T>[] = []
  const dirs = items.filter((it) => it.type === 'dir')
  if (dirs.length) out.push({ title: '폴더', items: dirs })
  const known = files.filter((f) => stats.get(f.path)).sort((a, b) => stats.get(b.path)!.mtime - stats.get(a.path)!.mtime)
  const order: DateGroup[] = ['오늘', '어제', '지난 7일', '그 전']
  for (const g of order) {
    const list = known.filter((f) => dateGroup(stats.get(f.path)!.mtime, now) === g)
    if (list.length) out.push({ title: g, items: list })
  }
  const unknown = files.filter((f) => stats.get(f.path) === null)
  if (unknown.length) out.push({ title: '시각을 못 읽음', items: unknown })
  return { sections: out, pending: 0 }
}

/** 묶음마다 새 줄에서 시작하는 격자의 줄들 (카드 번호 — 묶음을 이어 붙인 순서) */
export function sectionRows(sizes: readonly number[], cols: number): number[][] {
  const c = Math.max(1, Math.floor(cols))
  const rows: number[][] = []
  let i = 0
  for (const n of sizes) {
    for (let k = 0; k < n; k += c) rows.push(Array.from({ length: Math.min(c, n - k) }, (_, j) => i + k + j))
    i += n
  }
  return rows
}

/**
 * 묶음이 있는 격자에서 키로 옮겨 갈 카드. `←` `→` 는 순서대로 한 칸, `↑` `↓` · `PageUp` `PageDown` 은 줄 단위로 같은 칸
 * (그 줄이 짧으면 마지막 카드), `Home` `End` 는 처음 · 끝. 묶음이 하나면 `gridMove` 와 같다. 카드가 없으면 -1
 */
export function sectionMove(index: number, rows: readonly number[][], key: GridKey, pageRows = 1): number {
  const count = rows.reduce((n, r) => n + r.length, 0)
  if (count <= 0) return -1
  const i = index >= 0 && index < count ? index : 0
  const r = rows.findIndex((row) => row.includes(i))
  const c = rows[r].indexOf(i)
  const byRows = (n: number) => {
    const t = Math.max(0, Math.min(rows.length - 1, r + n))
    if (t === r) return i
    return rows[t][Math.min(c, rows[t].length - 1)]
  }
  switch (key) {
    case 'ArrowLeft': return Math.max(0, i - 1)
    case 'ArrowRight': return Math.min(count - 1, i + 1)
    case 'ArrowUp': return byRows(-1)
    case 'ArrowDown': return byRows(1)
    case 'PageUp': return byRows(-Math.max(1, Math.floor(pageRows)))
    case 'PageDown': return byRows(Math.max(1, Math.floor(pageRows)))
    case 'Home': return 0
    case 'End': return count - 1
  }
}

/** 크기 → `812 B` · `12.3 KB` · `1.2 MB` */
export function formatSize(n: number | undefined): string {
  if (n === undefined || !Number.isFinite(n)) return ''
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

/** 수정 시각 → 오늘이면 `14:05`, 아니면 `2026-11-20 14:05` (이 컴퓨터의 시각) */
export function formatTime(mtime: number, now: number): string {
  const d = new Date(mtime)
  const p = (x: number) => String(x).padStart(2, '0')
  const hm = `${p(d.getHours())}:${p(d.getMinutes())}`
  return dateGroup(mtime, now) === '오늘' ? hm : `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${hm}`
}
