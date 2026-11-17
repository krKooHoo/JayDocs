import { useEffect, useMemo, useRef, useState } from 'react'
import { SHORTCUTS } from '../lib/shortcuts-table.mjs'

/** F1 — 단축키 표. SHORTCUTS.md 와 같은 데이터다. 위 입력 칸에 치면 키 · 설명으로 거른다. */
export function HelpDialog({ onClose }: { onClose: () => void }) {
  const input = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  useEffect(() => { input.current?.focus() }, [])

  const groups = useMemo(() => {
    // 띄어쓰기로 나눈 낱말이 모두 (키 · 설명 · 이름) 안에 있으면 보인다. 구역 이름이 맞으면 구역 전체
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
    if (!words.length) return SHORTCUTS
    return SHORTCUTS
      .map((g) => {
        const scope = g.scope.toLowerCase()
        const items = g.items.filter((s) => {
          const hay = `${s.keys} ${s.label} ${s.note ?? ''}`.toLowerCase()
          return words.every((w) => hay.includes(w) || scope.includes(w))
        })
        return { ...g, items }
      })
      .filter((g) => g.items.length > 0)
  }, [query])

  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div
        className="help"
        role="dialog"
        aria-label="단축키"
        tabIndex={-1}
        onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); onClose() } }}
      >
        <div className="help-head">
          <span>단축키</span>
          <span className="muted">SHORTCUTS.md 와 같다 · Esc 로 닫기</span>
          <span className="spacer" />
          <button onClick={onClose}>닫기</button>
        </div>
        <div className="help-search">
          <input
            ref={input}
            className="help-input"
            placeholder="키나 설명으로 거르기… (예: 탭, F6, 복사)"
            aria-label="단축키 거르기"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            spellCheck={false}
            autoComplete="off"
          />
        </div>
        <div className="help-body">
          {groups.length === 0 && <p className="muted">맞는 단축키가 없습니다</p>}
          {groups.map((g) => (
            <section key={g.scope}>
              <h3>{g.scope}</h3>
              {g.intro && !query.trim() && <p className="muted">{g.intro}</p>}
              <table>
                <tbody>
                  {g.items.map((s) => (
                    <tr key={s.keys + s.label}>
                      <td className="help-keys"><kbd>{s.keys}</kbd></td>
                      <td>{s.label}{s.note && <span className="muted"> ({s.note})</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}
