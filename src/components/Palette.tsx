import { useEffect, useMemo, useRef, useState } from 'react'
import { matchScore } from '../lib/match'

/**
 * 명령 팔레트 · 파일 검색. 글자로 거르고 ↑↓ Enter 로 고른다 — 마우스 없이 모든 명령에 닿는 길.
 */
export interface PaletteItem {
  id: string
  label: string
  /** 오른쪽에 작게 (경로, 단축키) */
  hint?: string
  disabled?: boolean
  /** 최근에 쓴 순위 (0 이 가장 최근). 없으면 최근에 쓴 적 없는 것 */
  recent?: number
}

interface Props {
  title: string
  placeholder: string
  items: PaletteItem[]
  onPick: (id: string) => void
  onClose: () => void
}

/** 띄어쓰기 없이 글자 순서만 맞아도 찾는다. 점수가 낮을수록 좋다 */
const score = matchScore

export function Palette({ title, placeholder, items, onPick, onClose }: Props) {
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLDivElement>(null)

  const filtered = useMemo(() => {
    const scored = items
      .map((it) => ({ it, s: score(query, it.label + ' ' + (it.hint ?? '')) }))
      .filter((x): x is { it: PaletteItem; s: number } => x.s !== null)
    // 검색어가 없으면 점수가 모두 0 이라 최근 것이 위로 온다. 검색어가 있으면 점수가 먼저고, 같은 점수 안에서만 최근 것이 먼저
    const NOT_RECENT = Number.MAX_SAFE_INTEGER
    scored.sort((a, b) => a.s - b.s || (a.it.recent ?? NOT_RECENT) - (b.it.recent ?? NOT_RECENT) || a.it.label.localeCompare(b.it.label, 'ko'))
    return scored.map((x) => x.it).slice(0, 60)
  }, [items, query])

  useEffect(() => { input.current?.focus() }, [])
  useEffect(() => { setIndex(0) }, [query])
  useEffect(() => {
    const el = list.current?.children[index] as HTMLElement | undefined
    el?.scrollIntoView({ block: 'nearest' })
  }, [index])

  const pick = (i: number) => {
    const it = filtered[i]
    if (!it || it.disabled) return
    onPick(it.id)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.nativeEvent.isComposing) return
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); setIndex((i) => Math.min(filtered.length - 1, i + 1)); break
      case 'ArrowUp': e.preventDefault(); setIndex((i) => Math.max(0, i - 1)); break
      case 'PageDown': e.preventDefault(); setIndex((i) => Math.min(filtered.length - 1, i + 10)); break
      case 'PageUp': e.preventDefault(); setIndex((i) => Math.max(0, i - 10)); break
      case 'Home': if (query === '') { e.preventDefault(); setIndex(0) } break
      case 'End': if (query === '') { e.preventDefault(); setIndex(filtered.length - 1) } break
      case 'Enter': e.preventDefault(); pick(index); break
      case 'Escape': e.preventDefault(); onClose(); break
      default: break
    }
  }

  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="palette" role="dialog" aria-label={title}>
        <div className="palette-title">{title}</div>
        <input
          ref={input}
          className="palette-input"
          placeholder={placeholder}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          spellCheck={false}
          autoComplete="off"
        />
        <div className="palette-list" ref={list} role="listbox">
          {filtered.length === 0 && <div className="palette-empty">맞는 항목이 없습니다</div>}
          {filtered.map((it, i) => (
            <div
              key={it.id}
              role="option"
              aria-selected={i === index}
              className={'palette-item' + (i === index ? ' is-hl' : '') + (it.disabled ? ' is-disabled' : '')}
              onMouseEnter={() => setIndex(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(i)}
            >
              <span className="palette-label">{it.label}</span>
              {it.recent !== undefined && query === '' && <span className="palette-recent">최근</span>}
              {it.hint && <span className="palette-hint">{it.hint}</span>}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
