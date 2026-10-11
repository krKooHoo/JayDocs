import { useEffect, useRef } from 'react'
import { SHORTCUTS } from '../lib/shortcuts-table.mjs'

/** F1 — 단축키 표. SHORTCUTS.md 와 같은 데이터다. */
export function HelpDialog({ onClose }: { onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => { box.current?.focus() }, [])
  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div
        className="help"
        role="dialog"
        aria-label="단축키"
        tabIndex={-1}
        ref={box}
        onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); onClose() } }}
      >
        <div className="help-head">
          <span>단축키</span>
          <span className="muted">SHORTCUTS.md 와 같다 · Esc 로 닫기</span>
          <span className="spacer" />
          <button onClick={onClose}>닫기</button>
        </div>
        <div className="help-body">
          {SHORTCUTS.map((g) => (
            <section key={g.scope}>
              <h3>{g.scope}</h3>
              {g.intro && <p className="muted">{g.intro}</p>}
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
