import { useEffect, useRef, useState } from 'react'
import { spotAt } from '../lib/contextMenu'
import { getCommand, keysOf } from '../lib/commands'
import { paneCommand } from '../lib/paneCommands'
import { subscribeDialogs, dialogOpen } from '../lib/dialogs'
import {
  PLACE_TITLE, displayKeys, hintFooter, hintPlace, isMac, keyHints, narrowPlaceAt, setKeyHintsFolded, toggleKeyHints, useKeyHintsState,
  type HintPlace, type KeyHint,
} from '../lib/keyHints'
import './KeyHints.css'

/**
 * 단축키 안내 창 (`Shift+F1`, ADOPT K7 · DESIGN §46). 문서 창 영역의 왼쪽 아래, 파일 트리 바로 오른쪽에 뜬다.
 *
 * - 글자를 칠 때마다 다시 그리지 않는다 — 포커스가 옮겨 갈 때(focusin) · 클릭한 뒤 · 키를 놓고 잠시 쉰 뒤에만 자리를 다시 읽고,
 *   보일 줄이 바뀌었을 때만 그린다 (원칙 2).
 * - 포커스를 받지 않는다 (단추도 `tabIndex=-1`). 알림 영역(aria-live)이 아니라 스크린 리더가 자리마다 읽지 않는다.
 * - 대화상자 · 팔레트 · 새 문서 창이 떠 있을 때(`hidden`), 창이 좁을 때(CSS)는 숨는다.
 * - 단축키가 있는 단추를 마우스로 누르면 그 키를 잠깐 보인다 ("다음엔 …").
 */
interface View {
  place: HintPlace
  items: KeyHint[]
  footer: KeyHint[]
}

const MAC = isMac()
const available = (id: string) => { const c = getCommand(id); return !!c && (!c.enabled || c.enabled()) }

function readView(): View {
  const ae = document.activeElement
  const target = ae && ae !== document.body && !ae.closest('.key-hints') ? ae : null
  const spot = spotAt(target)
  const place = hintPlace(spot, narrowPlaceAt(target))
  return { place, items: keyHints(place, spot, { available, mac: MAC }), footer: hintFooter(place, MAC) }
}

const sig = (v: View) => v.place + '\n' + [...v.items, ...v.footer].map((h) => `${h.keys}\t${h.label}`).join('\n')

/** 안내 창의 높이를 알림 줄에 알린다 — 알림이 안내 창 위로 쌓이게 (같은 오른쪽 아래, DESIGN §46 KH6) */
const HEIGHT_VAR = '--key-hints-h'

export function KeyHints({ hidden }: { hidden: boolean }) {
  const { on, folded } = useKeyHintsState()
  const [view, setView] = useState<View | null>(null)
  const box = useRef<HTMLElement>(null)
  const [promo, setPromo] = useState<KeyHint | null>(null)
  const [dialog, setDialog] = useState(dialogOpen())
  const last = useRef('')

  useEffect(() => subscribeDialogs(() => setDialog(dialogOpen())), [])

  useEffect(() => {
    if (!on) return
    let timer = 0
    const refresh = () => {
      window.clearTimeout(timer)
      const v = readView()
      const s = sig(v)
      if (s !== last.current) { last.current = s; setView(v) }
    }
    // 포커스가 옮겨 간 뒤 (같은 이벤트 안에서는 아직 옛 자리를 읽을 수 있어 한 틱 뒤에)
    const soon = () => { window.clearTimeout(timer); timer = window.setTimeout(refresh, 0) }
    // 키를 놓고 잠시 쉰 뒤 — 커서가 표 칸 · 목차로 들어간 것처럼 포커스는 그대로인 자리 바뀜
    const idle = () => { window.clearTimeout(timer); timer = window.setTimeout(refresh, 350) }
    refresh()
    document.addEventListener('focusin', soon)
    document.addEventListener('pointerup', soon)
    document.addEventListener('keyup', idle)
    window.addEventListener('resize', soon)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('focusin', soon)
      document.removeEventListener('pointerup', soon)
      document.removeEventListener('keyup', idle)
      window.removeEventListener('resize', soon)
      last.current = ''
    }
  }, [on])

  // 다시 보일 때 (대화상자 · 팔레트를 닫은 뒤) 자리를 다시 읽는다
  useEffect(() => {
    if (!on || hidden || dialog) return
    const t = window.setTimeout(() => {
      const v = readView()
      last.current = sig(v)
      setView(v)
    }, 0)
    return () => window.clearTimeout(t)
  }, [on, hidden, dialog])

  // 단축키가 있는 단추를 마우스로 누르면 그 키 (JetBrains Key Promoter 와 같은 생각)
  useEffect(() => {
    if (!on) return
    let t = 0
    const onClick = (e: MouseEvent) => {
      if (e.detail === 0) return // 키보드로 누른 단추 (Enter · Space)
      const el = (e.target as Element | null)?.closest?.('[data-command]')
      const id = el?.getAttribute('data-command')
      if (!id) return
      const keys = keysOf(id)
      if (!keys) return
      setPromo({ keys: displayKeys(keys, MAC), label: getCommand(id)?.label ?? paneCommand(id)?.label ?? id })
      window.clearTimeout(t)
      t = window.setTimeout(() => setPromo(null), 5000)
    }
    document.addEventListener('click', onClick, true)
    return () => { document.removeEventListener('click', onClick, true); window.clearTimeout(t); setPromo(null) }
  }, [on])

  // 보이는 동안 높이를 알림 줄에 — 안 보이면 0
  const shown = on && !hidden && !dialog && !!view
  useEffect(() => {
    const el = box.current
    const root = document.documentElement
    if (!shown || !el || typeof ResizeObserver !== 'function') { root.style.removeProperty(HEIGHT_VAR); return }
    const ro = new ResizeObserver(() => root.style.setProperty(HEIGHT_VAR, `${Math.ceil(el.getBoundingClientRect().height)}px`))
    ro.observe(el)
    return () => { ro.disconnect(); root.style.removeProperty(HEIGHT_VAR) }
  }, [shown])

  if (!shown) return null

  const keep = (e: React.MouseEvent) => e.preventDefault() // 단추를 눌러도 포커스는 제자리
  return (
    <aside ref={box} className={'key-hints' + (folded ? ' is-folded' : '')} aria-label="단축키 안내">
      <div className="kh-head">
        <span className="kh-title">⌨ {PLACE_TITLE[view.place]}</span>
        <span className="spacer" />
        <button type="button" tabIndex={-1} onMouseDown={keep} onClick={() => setKeyHintsFolded(!folded)} title={folded ? '펴기' : '접기'} aria-label={folded ? '펴기' : '접기'}>{folded ? '▸' : '▾'}</button>
        <button type="button" tabIndex={-1} onMouseDown={keep} onClick={toggleKeyHints} title={`안내 창 끄기 (${displayKeys(keysOf('toggleKeyHints') ?? 'Shift+F1', MAC)} 로 다시 켠다)`} aria-label="안내 창 끄기">×</button>
      </div>
      {promo && (
        <div className="kh-promo"><span className="kh-next">다음엔</span><kbd>{promo.keys}</kbd><span className="kh-label">{promo.label}</span></div>
      )}
      {!folded && (
        <ul className="kh-list">
          {view.items.map((h) => <li key={h.keys}><kbd>{h.keys}</kbd><span className="kh-label">{h.label}</span></li>)}
          {view.footer.map((h) => <li key={'f' + h.keys} className="kh-foot"><kbd>{h.keys}</kbd><span className="kh-label">{h.label}</span></li>)}
        </ul>
      )}
    </aside>
  )
}
