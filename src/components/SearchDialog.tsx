import { useEffect, useMemo, useRef, useState } from 'react'
import { backend } from '../lib/backend'
import { store } from '../store/documents'
import { findInText, snippetOf, type TextHit } from '../lib/quickOpen'
import { fileTypeOf } from '../lib/filetypes.mjs'
import './SearchDialog.css'

/**
 * 전체 검색 (`Ctrl+Alt+F`, ADOPT B2 · DESIGN §47). 연 폴더(가져온 폴더 포함)의 문서 본문에서 글자를 찾는다.
 *
 * - 대소문자를 가리지 않는 그냥 글자 찾기. 줄마다 한 결과, 파일마다 묶는다.
 * - 저장 안 한 문서는 편집 중인 글에서 찾는다. 나머지는 디스크에서 읽고, 창이 떠 있는 동안 읽은 글을 기억한다.
 * - 큰 폴더는 나눠 읽고 "n / m개 읽음" 을 보인다. 입력이 바뀌면 앞의 찾기를 버린다 (원칙 2).
 * - 범위: 전체 · 현재 폴더(지금 문서의 폴더). 결과에서 Enter 는 그 줄(표는 그 셀)로, Ctrl+Enter 는 오른쪽 창에.
 */
export type SearchScope = 'all' | 'folder'

export interface SearchOpen {
  path: string
  /** 없으면 파일만 연다 */
  hit?: TextHit
  side: boolean
}

interface FileResult {
  path: string
  hits: TextHit[]
}

type Row = { kind: 'file'; path: string; count: number } | { kind: 'hit'; path: string; hit: TextHit }

/** 한 번에 보일 결과 줄 수 (파일 머리 빼고) — 넘으면 찾기를 멈추고 알린다 */
export const MAX_HITS = 1000
const PER_FILE = 100
const PARALLEL = 6

/** 다시 열면 앞의 찾기 그대로 (VS Code 와 같다) */
let lastQuery = ''
let lastScope: SearchScope = 'all'

interface Props {
  files: string[]
  /** 지금 문서의 폴더 ('' 는 주 폴더 루트). 문서가 없으면 null — "현재 폴더" 를 고를 수 없다 */
  folder: string | null
  initialQuery?: string
  onOpen: (o: SearchOpen) => void
  onClose: () => void
}

export function SearchDialog({ files, folder, initialQuery, onOpen, onClose }: Props) {
  const [query, setQuery] = useState(initialQuery ?? lastQuery)
  const [scope, setScope] = useState<SearchScope>(folder === null ? 'all' : lastScope)
  const [results, setResults] = useState<FileResult[]>([])
  const [progress, setProgress] = useState({ done: 0, total: 0, failed: 0, capped: false })
  const [index, setIndex] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const cache = useRef(new Map<string, string | null>())
  const gen = useRef(0)

  useEffect(() => { input.current?.focus(); input.current?.select() }, [])
  useEffect(() => { lastQuery = query }, [query])
  useEffect(() => { lastScope = scope }, [scope])

  const targets = useMemo(() => {
    const docs = files.filter((p) => fileTypeOf(p) !== undefined)
    if (scope === 'folder' && folder !== null) return docs.filter((p) => folder === '' ? !p.startsWith('@') : p.startsWith(folder + '/')) // 그 폴더와 하위 폴더
    return docs
  }, [files, scope, folder])

  // 찾기 — 입력이 멈추고 200 ms 뒤. 앞의 찾기는 세대 번호로 버린다
  useEffect(() => {
    const my = ++gen.current
    const q = query
    setIndex(0)
    if (!q.trim()) { setResults([]); setProgress({ done: 0, total: 0, failed: 0, capped: false }); return }
    const timer = window.setTimeout(() => {
      const found: FileResult[] = []
      let done = 0
      let failed = 0
      let hits = 0
      let capped = false
      let next = 0
      let flushAt = 0
      const flush = (force = false) => {
        if (my !== gen.current) return
        const now = performance.now()
        if (!force && now - flushAt < 120) return
        flushAt = now
        setResults([...found].sort((a, b) => a.path.localeCompare(b.path, 'ko')))
        setProgress({ done, total: targets.length, failed, capped })
      }
      const readText = async (path: string): Promise<string | null> => {
        const live = store.fileText(path) // 저장 안 한 편집 포함
        if (live !== null) return live
        if (cache.current.has(path)) return cache.current.get(path)!
        try {
          const t = (await backend().read(path)).text
          cache.current.set(path, t)
          return t
        } catch {
          cache.current.set(path, null)
          return null
        }
      }
      const worker = async () => {
        while (my === gen.current && !capped && next < targets.length) {
          const path = targets[next++]
          const text = await readText(path)
          if (my !== gen.current) return
          done++
          if (text === null) failed++
          else {
            const h = findInText(text, q, Math.min(PER_FILE, MAX_HITS - hits))
            if (h.length) { found.push({ path, hits: h }); hits += h.length }
            if (hits >= MAX_HITS) capped = true
          }
          flush()
        }
      }
      setProgress({ done: 0, total: targets.length, failed: 0, capped: false })
      void Promise.all(Array.from({ length: PARALLEL }, worker)).then(() => flush(true))
    }, 200)
    return () => window.clearTimeout(timer)
  }, [query, targets])

  const rows = useMemo<Row[]>(() => results.flatMap((r) => [
    { kind: 'file' as const, path: r.path, count: r.hits.length },
    ...r.hits.map((hit) => ({ kind: 'hit' as const, path: r.path, hit })),
  ]), [results])
  const hitCount = results.reduce((n, r) => n + r.hits.length, 0)

  useEffect(() => {
    const el = list.current?.querySelector<HTMLElement>(`[data-row="${index}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [index])

  const open = (i: number, side: boolean) => {
    const r = rows[i]
    if (!r) return
    onOpen({ path: r.path, hit: r.kind === 'hit' ? r.hit : undefined, side })
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.nativeEvent.isComposing) return
    const last = rows.length - 1
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); setIndex((i) => Math.min(last, i + 1)); break
      case 'ArrowUp': e.preventDefault(); setIndex((i) => Math.max(0, i - 1)); break
      case 'PageDown': e.preventDefault(); setIndex((i) => Math.min(last, i + 10)); break
      case 'PageUp': e.preventDefault(); setIndex((i) => Math.max(0, i - 10)); break
      case 'Enter': if (e.altKey) break; e.preventDefault(); open(index, e.ctrlKey || e.metaKey); break
      case 'Escape': e.preventDefault(); onClose(); break
      default: break
    }
  }

  const folderLabel = folder === null ? '' : folder === '' ? '(루트)' : folder
  const status = !query.trim()
    ? '찾을 글자를 치세요 — 대소문자는 가리지 않습니다'
    : progress.total === 0
      ? '찾을 문서가 없습니다'
      : `${progress.done < progress.total && !progress.capped ? `${progress.done} / ${progress.total}개 읽음` : `문서 ${progress.total}개`} · ${results.length}개 파일에서 ${hitCount}줄`
        + (progress.failed ? ` · 못 읽은 파일 ${progress.failed}개` : '')
        + (progress.capped ? ` · 결과가 많아 처음 ${MAX_HITS}줄만 — 더 길게 치세요` : '')

  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="palette search-dialog" role="dialog" aria-label="전체 검색">
        <div className="palette-title">전체 검색 — 파일 내용에서 찾기</div>
        <div className="search-row">
          <input
            ref={input}
            className="palette-input"
            placeholder="찾을 글자… (Enter 그 줄로 · Ctrl+Enter 오른쪽 창에)"
            aria-label="찾을 글자"
            aria-controls="search-results"
            aria-activedescendant={rows.length ? `search-row-${index}` : undefined}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            spellCheck={false}
            autoComplete="off"
          />
          <button
            type="button"
            className="search-scope"
            disabled={folder === null}
            onClick={() => setScope((s) => (s === 'all' ? 'folder' : 'all'))}
            title={folder === null ? '열린 문서가 없어 전체에서 찾습니다' : '범위 바꾸기 — 전체 / 지금 문서의 폴더'}
          >
            범위: {scope === 'all' || folder === null ? '전체' : `현재 폴더 (${folderLabel})`}
          </button>
        </div>
        <div className="search-status" aria-live="polite">{status}</div>
        <div className="palette-list search-results" id="search-results" ref={list} role="listbox">
          {rows.map((r, i) => r.kind === 'file' ? (
            <div
              key={'f' + r.path}
              id={`search-row-${i}`}
              data-row={i}
              role="option"
              aria-selected={i === index}
              className={'palette-item search-file' + (i === index ? ' is-hl' : '')}
              onMouseEnter={() => setIndex(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={(e) => open(i, e.ctrlKey || e.metaKey)}
            >
              <span className="palette-label">{r.path.split('/').pop()}</span>
              <span className="palette-hint">{r.path.includes('/') ? r.path.slice(0, r.path.lastIndexOf('/')) : ''} · {r.count}줄</span>
            </div>
          ) : (
            <HitRow key={r.path + ':' + r.hit.line} i={i} hit={r.hit} hl={i === index} onHover={() => setIndex(i)} onOpen={(side) => open(i, side)} />
          ))}
        </div>
      </div>
    </div>
  )
}

function HitRow({ i, hit, hl, onHover, onOpen }: { i: number; hit: TextHit; hl: boolean; onHover: () => void; onOpen: (side: boolean) => void }) {
  const s = snippetOf(hit)
  return (
    <div
      id={`search-row-${i}`}
      data-row={i}
      role="option"
      aria-selected={hl}
      className={'palette-item search-hit' + (hl ? ' is-hl' : '')}
      onMouseEnter={onHover}
      onMouseDown={(e) => e.preventDefault()}
      onClick={(e) => onOpen(e.ctrlKey || e.metaKey)}
    >
      <span className="search-line">{hit.line}</span>
      <span className="search-text">
        {s.text.slice(0, s.col)}<mark>{s.text.slice(s.col, s.col + hit.len)}</mark>{s.text.slice(s.col + hit.len)}
      </span>
    </div>
  )
}
