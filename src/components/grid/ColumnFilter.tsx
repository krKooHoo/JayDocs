import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ValueCount } from '../../lib/tsv/view'

/**
 * 열의 값으로 거르기 창 (열 머리 메뉴, DESIGN §61) — 값 목록에서 체크해 보일 행을 고른다. 보기만 바꾼다.
 *
 * 포커스는 늘 검색 칸에 있다. ↓ / ↑ 로 "모두"와 값 사이를 옮기고, Space 로 체크, Enter 적용, Esc 닫기.
 * 검색 칸에 글자를 치면 목록을 거른다("모두"는 거른 값에만 걸린다). 마우스로 체크해도 된다.
 */
const LIMIT = 500
const BLANK = '(빈 칸)'

export interface ColumnFilterProps {
  /** 창 머리 — `B · Name` */
  title: string
  values: readonly ValueCount[]
  /** 지금 체크를 푼 값 */
  excluded: readonly string[]
  anchor: { x: number; y: number }
  onApply: (excluded: string[]) => void
  onClose: () => void
}

export function ColumnFilter({ title, values, excluded, anchor, onApply, onClose }: ColumnFilterProps) {
  const [q, setQ] = useState('')
  const [off, setOff] = useState<ReadonlySet<string>>(() => new Set(excluded))
  /** 강조한 줄: -1 검색 칸, 0 "모두", 1.. 값 */
  const [hl, setHl] = useState(-1)
  const root = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLDivElement>(null)

  const shown = useMemo(() => {
    const k = q.trim().toLowerCase()
    const hit = k ? values.filter((v) => (v.value === '' ? BLANK : v.value).toLowerCase().includes(k)) : values
    return hit.slice(0, LIMIT)
  }, [values, q])
  const more = (q.trim() ? values.filter((v) => (v.value === '' ? BLANK : v.value).toLowerCase().includes(q.trim().toLowerCase())).length : values.length) - shown.length
  const allOn = shown.length > 0 && shown.every((v) => !off.has(v.value))
  const noneOn = values.every((v) => off.has(v.value))

  useEffect(() => { input.current?.focus() }, [])
  // 바깥을 누르면 닫는다
  useEffect(() => {
    const h = (e: MouseEvent) => { if (root.current && !root.current.contains(e.target as Node)) onClose() }
    window.addEventListener('mousedown', h, true)
    return () => window.removeEventListener('mousedown', h, true)
  }, [onClose])
  // 강조한 줄이 보이게
  useLayoutEffect(() => {
    if (hl < 0) return
    list.current?.querySelector<HTMLElement>(`[data-i="${hl}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [hl])

  const toggle = (value: string) => setOff((s) => { const n = new Set(s); if (n.has(value)) n.delete(value); else n.add(value); return n })
  const toggleAll = () => setOff((s) => {
    const n = new Set(s)
    for (const v of shown) { if (allOn) n.add(v.value); else n.delete(v.value) }
    return n
  })
  const apply = () => { if (!noneOn) onApply(values.filter((v) => off.has(v.value)).map((v) => v.value)) }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return
    switch (e.key) {
      case 'Escape': e.preventDefault(); e.stopPropagation(); onClose(); return
      case 'Enter': e.preventDefault(); e.stopPropagation(); apply(); return
      case 'ArrowDown': e.preventDefault(); setHl((i) => Math.min(shown.length, i + 1)); return
      case 'ArrowUp': e.preventDefault(); setHl((i) => Math.max(-1, i - 1)); return
      case ' ':
        if (hl < 0) return
        e.preventDefault()
        if (hl === 0) toggleAll()
        else toggle(shown[hl - 1].value)
        return
    }
  }

  // 화면 밖으로 나가지 않게
  const left = Math.max(8, Math.min(anchor.x, window.innerWidth - 300))
  const top = Math.max(8, Math.min(anchor.y, window.innerHeight - 200))
  return (
    <div ref={root} className="grid-colfilter" style={{ left, top }} role="dialog" aria-label={`${title} — 값으로 거르기`} onKeyDown={onKeyDown}>
      <div className="grid-colfilter-title">{title} — 값으로 거르기 <span className="muted">(보기만)</span></div>
      <input
        ref={input}
        className="grid-find-input grid-colfilter-search"
        type="text"
        value={q}
        onChange={(e) => { setQ(e.target.value); setHl(-1) }}
        placeholder="값 찾기"
        aria-label="값 찾기"
        spellCheck={false}
        autoComplete="off"
      />
      {/* 목록을 눌러도 포커스는 검색 칸에 둔다 */}
      <div ref={list} className="grid-colfilter-list" onMouseDown={(e) => e.preventDefault()}>
        <label data-i={0} className={'grid-colfilter-item is-all' + (hl === 0 ? ' is-hl' : '')}>
          <input type="checkbox" tabIndex={-1} checked={allOn} onChange={toggleAll} /> 모두{q.trim() ? ' (찾은 값)' : ''}
        </label>
        {shown.map((v, i) => (
          <label key={v.value} data-i={i + 1} className={'grid-colfilter-item' + (hl === i + 1 ? ' is-hl' : '') + (v.value === '' ? ' is-blank' : '')}>
            <input type="checkbox" tabIndex={-1} checked={!off.has(v.value)} onChange={() => toggle(v.value)} />
            <span className="grid-colfilter-value">{v.value === '' ? BLANK : v.value}</span>
            <span className="grid-colfilter-count">{v.count}</span>
          </label>
        ))}
        {shown.length === 0 && <div className="grid-colfilter-empty muted">맞는 값이 없습니다</div>}
        {more > 0 && <div className="grid-colfilter-empty muted">… 외 {more}개 — 찾기로 좁히세요</div>}
      </div>
      <div className="grid-colfilter-foot">
        <span className="muted">↓↑ · Space 체크 · Enter 적용 · Esc 닫기</span>
        <button onClick={apply} disabled={noneOn} title={noneOn ? '값을 하나 이상 고르세요' : '적용 (Enter)'}>적용</button>
        <button onClick={onClose} title="닫기 (Esc)">취소</button>
      </div>
    </div>
  )
}
