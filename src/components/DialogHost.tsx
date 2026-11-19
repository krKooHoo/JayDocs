import { useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { runCommand } from '../lib/commands'
import { currentDialog, dialogOpen, settleDialog, subscribeDialogs, type DialogRequest } from '../lib/dialogs'

/**
 * 앱 대화상자를 그리는 곳 (하나). `lib/dialogs.ts` 의 `askText` · `askConfirm` 이 줄 세운 것을 차례로 띄운다.
 *
 * 키: Enter 확인(입력 칸 · 포커스가 있는 버튼) · Esc 취소 · Tab 은 창 안에서만 돈다 · ← → 로 버튼 사이 이동.
 * 닫히면 부르던 때의 포커스로 돌아간다. 그 자리가 없어졌으면(닫힌 탭, 사라진 팔레트) 문서 창으로 — 팔레트와 같은 규칙(K3).
 */
export function DialogHost() {
  const req = useSyncExternalStore(subscribeDialogs, currentDialog)
  if (!req) return null
  return <DialogBox key={req.id} req={req} />
}

const FOCUSABLE = 'input:not([disabled]), button:not([disabled])'

/** 부른 쪽이 답을 받아 제 할 일(탭 닫기 · 트리 새로 읽기)을 한 뒤에 포커스를 돌려준다 */
function restoreFocus(opener: unknown) {
  window.setTimeout(() => {
    if (dialogOpen()) return // 다음 대화상자가 떴다 — 그쪽이 포커스를 갖는다
    const ae = document.activeElement
    if (ae && ae !== document.body) return // 그 사이 다른 곳이 포커스를 가져갔다
    if (opener instanceof HTMLElement && opener.isConnected && opener.offsetParent !== null) opener.focus()
    else runCommand('focusEditor')
  }, 0)
}

function DialogBox({ req }: { req: DialogRequest }) {
  const box = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const cancelButton = useRef<HTMLButtonElement>(null)
  const okButton = useRef<HTMLButtonElement>(null)
  const titleId = useId()
  const bodyId = useId()
  const [value, setValue] = useState(req.kind === 'text' ? req.opts.value ?? '' : '')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const danger = req.kind === 'confirm' && !!req.opts.danger

  const focusDefault = () => {
    if (req.kind === 'text') input.current?.focus()
    else (danger ? cancelButton : okButton).current?.focus()
  }

  // 열리면 입력 칸(이름 부분을 선택한 채) 또는 기본 버튼에 포커스. 되돌릴 수 없는 확인은 취소가 기본
  useLayoutEffect(() => {
    focusDefault()
    if (req.kind === 'text' && input.current) {
      const [from, to] = req.opts.select ?? [0, input.current.value.length]
      input.current.setSelectionRange(from, to)
    }
    return () => restoreFocus(req.opener)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 떠 있는 동안 포커스가 창 밖으로 나가면(늦게 도는 포커스 이동, 바깥 클릭) 도로 가져온다
  useEffect(() => {
    const onFocusIn = (e: FocusEvent) => {
      if (box.current && e.target instanceof Node && !box.current.contains(e.target)) focusDefault()
    }
    document.addEventListener('focusin', onFocusIn)
    return () => document.removeEventListener('focusin', onFocusIn)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const cancel = () => {
    if (busy) return
    settleDialog(req.id, req.kind === 'text' ? null : false)
  }

  const ok = async () => {
    if (busy) return
    if (req.kind === 'confirm') { settleDialog(req.id, true); return }
    if (req.opts.submit) {
      setBusy(true)
      let problem: string | null
      try {
        problem = await req.opts.submit(value)
      } catch (e) {
        problem = (e as Error).message || '처리하지 못했습니다'
      }
      if (problem !== null) {
        setBusy(false)
        setError(problem)
        // 버튼이 다시 켜진 뒤에 칸으로 — 고쳐서 바로 다시 누를 수 있게
        window.setTimeout(() => input.current?.focus(), 0)
        return
      }
    }
    settleDialog(req.id, value)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return
    const target = e.target as HTMLElement
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancel(); return }
    if (e.key === 'Enter' && target.tagName !== 'BUTTON') { e.preventDefault(); void ok(); return }
    if (e.key === 'Tab') {
      // 창 밖으로 나가지 않는다
      const items = [...(box.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])]
      if (!items.length) { e.preventDefault(); return }
      const i = items.indexOf(document.activeElement as HTMLElement)
      const next = e.shiftKey ? (i <= 0 ? items.length - 1 : i - 1) : (i < 0 || i === items.length - 1 ? 0 : i + 1)
      e.preventDefault()
      items[next].focus()
      return
    }
    if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && target.tagName === 'BUTTON') {
      const buttons = [...(box.current?.querySelectorAll<HTMLElement>('.info-actions button:not([disabled])') ?? [])]
      const i = buttons.indexOf(target)
      if (i < 0) return
      e.preventDefault()
      buttons[(i + (e.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length].focus()
    }
  }

  const o = req.opts
  const hint = req.kind === 'text' ? req.opts.hint : undefined
  return (
    <div className="overlay is-dialog" onMouseDown={(e) => { if (e.target === e.currentTarget) { e.preventDefault(); cancel() } }}>
      <div
        ref={box}
        className={'palette dialog' + (danger ? ' is-danger' : '')}
        role={req.kind === 'text' ? 'dialog' : 'alertdialog'}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={req.kind === 'confirm' || hint ? bodyId : undefined}
        onKeyDown={onKeyDown}
      >
        <div className="dialog-title" id={titleId}>{o.title}</div>
        {req.kind === 'text' ? (
          <>
            <label className="dialog-field">
              {req.opts.label && <span>{req.opts.label}</span>}
              <input
                ref={input}
                value={value}
                onChange={(e) => { setValue(e.target.value); setError(null) }}
                aria-invalid={error !== null}
                aria-describedby={error !== null ? `${bodyId}-err` : undefined}
                spellCheck={false}
                autoComplete="off"
              />
            </label>
            {error !== null && <div className="dialog-error" id={`${bodyId}-err`} role="alert">{error}</div>}
            {hint && <div className="dialog-hint" id={bodyId}>{hint}</div>}
          </>
        ) : (
          <div className="dialog-body" id={bodyId}>
            <p>{req.opts.message}</p>
            {req.opts.items && req.opts.items.length > 0 && (
              <>
                {req.opts.itemsLabel && <p className="muted">{req.opts.itemsLabel}</p>}
                <ul className="dialog-items">
                  {req.opts.items.map((it) => <li key={it}>{it}</li>)}
                </ul>
              </>
            )}
          </div>
        )}
        <div className="info-actions">
          <button ref={cancelButton} onClick={cancel} disabled={busy}>{(req.kind === 'confirm' && req.opts.cancelLabel) || '취소'}</button>
          <button ref={okButton} className={danger ? 'is-danger' : 'is-primary'} onClick={() => void ok()} disabled={busy}>{o.okLabel ?? '확인'}</button>
        </div>
      </div>
    </div>
  )
}
