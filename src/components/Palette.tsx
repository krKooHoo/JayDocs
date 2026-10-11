import { useEffect, useMemo, useRef, useState } from 'react'

/**
 * 명령 팔레트 · 빠른 열기. 글자로 거르고 ↑↓ Enter 로 고른다 — 마우스 없이 모든 명령에 닿는 길.
 */
export interface PaletteItem {
  id: string
  label: string
  /** 오른쪽에 작게 (경로, 단축키) */
  hint?: string
  disabled?: boolean
}

interface Props {
  title: string
  placeholder: string
  items: PaletteItem[]
  onPick: (id: string) => void
  onClose: () => void
}

/** 띄어쓰기 없이 글자 순서만 맞아도 찾는다. 점수가 낮을수록 좋다 */
function score(query: string, text: string): number | null {
  if (!query) return 0
  const q = query.toLowerCase()
  const t = text.toLowerCase()
  const idx = t.indexOf(q)
  if (idx >= 0) return idx
  let pos = 0
  let gaps = 0
  for (const ch of q) {
    const i = t.indexOf(ch, pos)
    if (i < 0) return null
    gaps += i - pos
    pos = i + 1
  }
  return 1000 + gaps
}

export function Palette({ title, placeholder, items, onPick, onClose }: Props) {
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLDivElement>(null)

  const filtered = useMemo(() => {
    const scored = items
      .map((it) => ({ it, s: score(query, it.label + ' ' + (it.hint ?? '')) }))
      .filter((x): x is { it: PaletteItem; s: number } => x.s !== null)
    scored.sort((a, b) => a.s - b.s || a.it.label.localeCompare(b.it.label, 'ko'))
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
              {it.hint && <span className="palette-hint">{it.hint}</span>}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
