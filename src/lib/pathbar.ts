import { isMountPath } from './roots.mjs'
import { matchScore } from './match'

/**
 * 경로 막대 (ADOPT A1 · DESIGN §31). 문서 창 막대의 `루트 › 폴더 › 파일 › 제목` 한 줄.
 * 여기는 순수 함수만 둔다 — 경로를 단계로 나누고, 폴더 안의 항목을 트리의 파일 경로 집합에서 뽑는다.
 *
 * 폴더는 트리의 파일 경로에서 유도한다 — 트리와 같이, 문서가 없는 폴더는 보이지 않는다.
 */

export interface Crumb {
  kind: 'root' | 'dir' | 'file'
  label: string
  /** 이 단계의 앱 경로. 주 폴더의 루트는 '' */
  path: string
  /** 이웃 목록을 뽑을 폴더 — 루트 단계는 null(루트 목록) */
  parent: string | null
}

export interface DirEntry {
  name: string
  /** 앱 경로. 주 폴더의 루트는 '' */
  path: string
  isDir: boolean
}

/** `a/b/c.md` → 루트 · a · b · c.md. 가져온 폴더는 `@별칭` 이 루트 단계다 */
export function crumbsOf(path: string, mainLabel: string): Crumb[] {
  const parts = path.split('/')
  const out: Crumb[] = []
  let dir: string
  let i = 0
  if (isMountPath(path)) {
    dir = parts[0]
    out.push({ kind: 'root', label: parts[0], path: dir, parent: null })
    i = 1
  } else {
    dir = ''
    out.push({ kind: 'root', label: mainLabel, path: '', parent: null })
  }
  for (; i < parts.length; i++) {
    const here = dir ? `${dir}/${parts[i]}` : parts[i]
    out.push({ kind: i === parts.length - 1 ? 'file' : 'dir', label: parts[i], path: here, parent: dir })
    dir = here
  }
  return out
}

/** 폴더의 상위 폴더. 루트(주 폴더 '' · `@별칭`)의 위는 null — 루트 목록 */
export function parentDir(dir: string): string | null {
  if (dir === '' || (isMountPath(dir) && !dir.includes('/'))) return null
  const i = dir.lastIndexOf('/')
  return i < 0 ? '' : dir.slice(0, i)
}

function byTreeOrder(a: DirEntry, b: DirEntry) {
  // 파일 트리와 같은 순서: 폴더 먼저, 이름순 (lib/fsa/fsaBackend.ts)
  return a.isDir === b.isDir ? a.name.localeCompare(b.name, 'ko') : a.isDir ? -1 : 1
}

/** 폴더 바로 아래의 폴더 · 파일. `dir` 은 주 폴더 루트면 '', 가져온 폴더 루트면 `@별칭` */
export function listDir(files: Iterable<string>, dir: string): DirEntry[] {
  const prefix = dir ? dir + '/' : ''
  const dirs = new Set<string>()
  const out: DirEntry[] = []
  for (const p of files) {
    if (prefix ? !p.startsWith(prefix) : isMountPath(p)) continue
    const rest = p.slice(prefix.length)
    const slash = rest.indexOf('/')
    if (slash < 0) { out.push({ name: rest, path: p, isDir: false }); continue }
    const name = rest.slice(0, slash)
    if (dirs.has(name)) continue
    dirs.add(name)
    out.push({ name, path: prefix + name, isDir: true })
  }
  return out.sort(byTreeOrder)
}

/** 루트 목록 — 주 폴더가 먼저, 가져온 폴더는 파일 트리와 같은 순서(경로 집합은 트리를 돌며 만든다) */
export function listRoots(files: Iterable<string>, mainLabel: string): DirEntry[] {
  const mounts = new Set<string>()
  for (const p of files) if (isMountPath(p)) mounts.add(p.slice(0, p.includes('/') ? p.indexOf('/') : p.length))
  return [{ name: mainLabel, path: '', isDir: true }, ...[...mounts].map((m) => ({ name: m, path: m, isDir: true }))]
}

/** 글자로 거른다. 글자가 없으면 그대로, 있으면 맞는 것만 점수 순(같으면 원래 순서) */
export function filterByLabel<T>(items: readonly T[], query: string, label: (it: T) => string): T[] {
  if (!query) return [...items]
  return items
    .map((it, i) => ({ it, i, s: matchScore(query, label(it)) }))
    .filter((x): x is { it: T; i: number; s: number } => x.s !== null)
    .sort((a, b) => a.s - b.s || a.i - b.i)
    .map((x) => x.it)
}
