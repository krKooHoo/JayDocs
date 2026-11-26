import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { DocThumb } from './DocView'
import { fileTypeOf } from '../lib/filetypes.mjs'
import { runCommand } from '../lib/commands'
import { dialogOpen } from '../lib/dialogs'
import { skimReader } from '../lib/skim'
import { blankTemplateFor, fileNameOf, newDocPath, newFolderPath, stripTypedExt, TEMPLATES, typedExt } from '../lib/templates'
import './NewDocDialog.css'

/**
 * 새 문서 창 (PLAN-skim SK8 · SK10). `Ctrl+Alt+N` · 트리의 ＋파일 · 빈 화면 안내의 "새 파일" 이 연다.
 *
 * 세 줄: 빈 문서 · 예시(렌더된 썸네일) · 내 템플릿(주 폴더의 `_templates/`, 있을 때만).
 * 포커스는 늘 이름 칸에 있다 — `↑` `↓` 로 템플릿을 옮기고(줄을 넘어 이어진다) `Enter` 로 만든다, `Esc` 로 닫는다.
 * 카드를 누르면 선택만 바뀌고 포커스는 이름 칸에 남는다. 두 번 누르면 만든다.
 * 이름 끝에 지원 확장자를 치면(`메모.txt`) 그 형식으로 선택이 옮겨 간다. 끝에 `/` 를 치면(`자료/`) 폴더를 만든다 (DESIGN §43).
 *
 * 경로 검사 · 실제 쓰기는 부른 쪽(`onCreate`)이 한다 — 문제가 있으면 이유를 돌려주고, 창은 닫히지 않고 칸 아래에 보인다.
 */
export interface NewDocChoice {
  id: string
  ext: string
  group: 'blank' | 'sample' | 'mine'
  title: string
  desc?: string
  /** 빈 문서 · 예시: 쓸 글 */
  body?: string
  /** 내 템플릿: 그 파일의 경로 (만들 때 읽어 그대로 쓴다) */
  path?: string
}

interface Props {
  /** 트리에서 고른 폴더 ('' = 주 폴더 루트) */
  dir: string
  /** 내 템플릿 후보 경로 (UTF-8 인지는 여기서 읽어 보고 거른다) */
  userTemplates: readonly string[]
  /** 만든다. 문제가 있으면 그 이유, 되면 null (창을 닫는 것도 부른 쪽이 한다) */
  onCreate: (path: string, choice: NewDocChoice) => Promise<string | null>
  /** 이름이 `/` 로 끝날 때 — 폴더를 만든다 (DESIGN §43, K3). 돌려주는 값은 onCreate 와 같다 */
  onCreateFolder: (path: string) => Promise<string | null>
  onClose: () => void
}

const BUILTIN: NewDocChoice[] = TEMPLATES.map((t) => ({ id: t.id, ext: t.ext, group: t.group, title: t.title, desc: t.desc, body: t.body }))
const DEFAULT_NAME = '새 문서'
const FOCUSABLE = 'input:not([disabled]), button:not([disabled])'
const ROWS: { group: NewDocChoice['group']; label: string }[] = [
  { group: 'blank', label: '빈 문서' },
  { group: 'sample', label: '예시' },
  { group: 'mine', label: '내 템플릿' },
]

/** 내 템플릿 중 UTF-8 로 읽히는 것만 (SK10 — 아닌 것을 그대로 옮기면 UTF-8 로 바뀌어 써진다) */
function useUserTemplates(paths: readonly string[]): NewDocChoice[] {
  const [mine, setMine] = useState<NewDocChoice[]>([])
  const key = paths.join('\n')
  useEffect(() => {
    let alive = true
    const list = key ? key.split('\n') : []
    void Promise.all(list.map((p) => skimReader().load(p).then((f) => (f.ok && f.encoding === 'utf-8' ? p : null)))).then((ok) => {
      if (!alive) return
      setMine(ok.filter((p): p is string => p !== null).map((p) => ({ id: `mine:${p}`, ext: fileTypeOf(p)?.ext ?? '', group: 'mine', title: fileNameOf(p), path: p })))
    })
    return () => { alive = false }
  }, [key])
  return mine
}

/** 부르던 때의 포커스로 돌려준다 — 그 자리가 없어졌으면 문서 창으로 (대화상자와 같은 규칙) */
function restoreFocus(opener: Element | null) {
  window.setTimeout(() => {
    if (dialogOpen()) return
    const ae = document.activeElement
    if (ae && ae !== document.body) return
    if (opener instanceof HTMLElement && opener.isConnected && opener.offsetParent !== null) opener.focus()
    else runCommand('focusEditor')
  }, 0)
}

export function NewDocDialog({ dir, userTemplates, onCreate, onCreateFolder, onClose }: Props) {
  const mine = useUserTemplates(userTemplates)
  const choices = useMemo(() => [...BUILTIN, ...mine], [mine])
  const initial = dir ? `${dir}/${DEFAULT_NAME}` : DEFAULT_NAME
  // 선택 · 이름 · 만드는 중은 ref 로도 든다 — 다시 그리기 전에 키가 몇 번 더 와도(키 반복 · 빠른 Enter) 앞의 것을 잃지 않게. 키 처리는 ref 를 읽는다
  const [index, setIndexState] = useState(0)
  const indexRef = useRef(0)
  const setIndex = (i: number) => { indexRef.current = i; setIndexState(i) }
  const [value, setValueState] = useState(initial)
  const valueRef = useRef(initial)
  const setValue = (v: string) => { valueRef.current = v; setValueState(v) }
  const [busy, setBusyState] = useState(false)
  const busyRef = useRef(false)
  const setBusy = (b: boolean) => { busyRef.current = b; setBusyState(b) }
  const [error, setError] = useState<string | null>(null)
  const box = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const baseId = useId()
  const titleId = `${baseId}-title`
  const cardId = (i: number) => `${baseId}-c${i}`

  const choice = choices[Math.min(index, choices.length - 1)]
  const typed = typedExt(value)
  const folderMode = newFolderPath(value) !== null

  /** 만들었다 — 닫힐 때 포커스를 돌려주지 않는다 (만든 문서의 편집기가 받는다) */
  const created = useRef(false)

  // 열리면 이름 칸에 포커스, 기본 이름(`새 문서`)만 선택 — 바로 치면 폴더는 남는다. 닫히면(취소) 부르던 곳으로.
  // 만들고 닫힐 때 돌려주면, 열린 문서가 없을 때의 "트리로" 가 늦게 도착해 새 문서의 편집기 포커스를 빼앗는다
  useLayoutEffect(() => {
    const opener = document.activeElement
    input.current?.focus()
    input.current?.setSelectionRange(initial.length - DEFAULT_NAME.length, initial.length)
    return () => { if (!created.current) restoreFocus(opener) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 떠 있는 동안 포커스가 창 밖으로 나가면 이름 칸으로 도로 가져온다
  useEffect(() => {
    const onFocusIn = (e: FocusEvent) => {
      if (box.current && e.target instanceof Node && !box.current.contains(e.target)) input.current?.focus()
    }
    document.addEventListener('focusin', onFocusIn)
    return () => document.removeEventListener('focusin', onFocusIn)
  }, [])

  // 고른 카드가 보이게
  useEffect(() => {
    document.getElementById(cardId(index))?.scrollIntoView({ block: 'nearest' })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index])

  /** 템플릿을 고른다. 이름 끝에 다른 형식의 확장자를 쳐 두었으면 뗀다 — 확장자는 고른 템플릿을 따른다 */
  const select = (i: number) => {
    const next = choices[i]
    if (!next) return
    setIndex(i)
    setError(null)
    const t = typedExt(valueRef.current)
    if (t && t !== next.ext) setValue(stripTypedExt(valueRef.current))
  }

  const onChange = (v: string) => {
    setValue(v)
    setError(null)
    // 이름 끝에 다른 형식의 확장자를 치면 그 형식의 빈 문서로 (같은 형식의 예시 · 내 템플릿을 고른 중이면 그대로)
    const t = typedExt(v)
    if (t && t !== choices[indexRef.current]?.ext) {
      const blank = blankTemplateFor(t)
      const i = blank ? choices.findIndex((c) => c.id === blank.id) : -1
      if (i >= 0) setIndex(i)
    }
  }

  const create = async (c: NewDocChoice | undefined = choices[indexRef.current]) => {
    if (busyRef.current || !c) return
    setBusy(true)
    let problem: string | null
    // 이름이 / 로 끝나면 폴더 (K3). 만든 뒤 닫히면 포커스는 부르던 곳으로 돌아간다 (열 문서가 없다)
    const folder = newFolderPath(valueRef.current)
    // 부른 쪽이 만든 뒤 창을 닫고 새 문서로 포커스를 옮긴다 — 그 전에 표시해 둔다 (닫히는 것은 onCreate 안이다)
    created.current = folder === null
    try {
      problem = folder !== null ? await onCreateFolder(folder) : await onCreate(newDocPath(valueRef.current, c.ext), c)
    } catch (e) {
      problem = (e as Error).message || '만들지 못했습니다'
    }
    if (problem === null) return
    created.current = false
    setBusy(false)
    setError(problem)
    window.setTimeout(() => input.current?.focus(), 0)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    // 한글 조합 중의 Enter · 방향키는 조합을 끝내는 키다
    if (e.nativeEvent.isComposing || e.keyCode === 229) return
    const target = e.target as HTMLElement
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (!busyRef.current) onClose(); return }
    if (e.key === 'Enter' && target.tagName !== 'BUTTON') { e.preventDefault(); void create(); return }
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
      e.preventDefault()
      const step = e.key === 'ArrowDown' ? 1 : -1
      select(Math.max(0, Math.min(choices.length - 1, indexRef.current + step)))
      return
    }
    if (e.key === 'Tab') {
      // 창 밖으로 나가지 않는다
      const items = [...(box.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])]
      if (!items.length) { e.preventDefault(); return }
      const i = items.indexOf(document.activeElement as HTMLElement)
      const next = e.shiftKey ? (i <= 0 ? items.length - 1 : i - 1) : (i < 0 || i === items.length - 1 ? 0 : i + 1)
      e.preventDefault()
      items[next].focus()
    }
  }

  const card = (c: NewDocChoice, i: number) => {
    const on = i === index
    const ft = fileTypeOf('x' + c.ext)
    return (
      <div
        key={c.id}
        id={cardId(i)}
        role="option"
        aria-selected={on}
        className={'newdoc-card is-' + c.group + (on ? ' is-on' : '')}
        title={c.path ?? c.desc ?? c.title}
        // 포커스는 이름 칸에 남긴다
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => select(i)}
        onDoubleClick={() => void create(c)}
      >
        {c.group === 'blank' ? (
          <div className="newdoc-paper" aria-hidden="true">
            <span className="newdoc-paper-icon">{ft?.icon}</span>
            <span className="newdoc-paper-ext">{c.ext}</span>
          </div>
        ) : (
          <DocThumb path={c.path ?? '예시' + c.ext} text={c.body} />
        )}
        <div className="newdoc-card-title">{c.group === 'sample' ? `${c.title} ${c.ext}` : c.title}</div>
        {c.group === 'sample' && c.desc && <div className="newdoc-card-desc">{c.desc}</div>}
      </div>
    )
  }

  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) { e.preventDefault(); if (!busy) onClose() } }}>
      <div ref={box} className="palette newdoc" role="dialog" aria-modal="true" aria-labelledby={titleId} onKeyDown={onKeyDown}>
        <div className="dialog-title" id={titleId}>새 문서</div>
        <label className="dialog-field">
          <span>{dir ? `이름 (트리에서 고른 폴더: ${dir})` : '이름'}</span>
          <span className={'newdoc-name' + (error !== null ? ' is-invalid' : '')}>
            <input
              ref={input}
              value={value}
              onChange={(e) => onChange(e.target.value)}
              aria-invalid={error !== null}
              aria-describedby={error !== null ? `${baseId}-err` : undefined}
              aria-controls={`${baseId}-list`}
              aria-activedescendant={cardId(index)}
              spellCheck={false}
              autoComplete="off"
            />
            {folderMode
              ? <span className="newdoc-ext" aria-label="새 폴더">📁 폴더</span>
              : !typed && <span className="newdoc-ext" aria-label={`확장자 ${choice.ext}`}>{choice.ext}</span>}
          </span>
        </label>
        {error !== null && <div className="dialog-error" id={`${baseId}-err`} role="alert">{error}</div>}
        <div className="dialog-hint">
          <kbd>↑</kbd> <kbd>↓</kbd> 템플릿 고르기 · <kbd>Enter</kbd> 만들기 · 확장자는 고른 템플릿을 따르고, 이름 끝에 <code>.txt</code> 처럼 치면 그 형식이 됩니다 · <code>a/b</code> 처럼 하위 폴더도 됩니다 · 끝에 <code>/</code> 를 치면(<code>자료/</code>) 폴더를 만듭니다
        </div>
        <div className="newdoc-body" id={`${baseId}-list`} role="listbox" aria-label="템플릿">
          {ROWS.map((row) => {
            const items = choices.map((c, i) => [c, i] as const).filter(([c]) => c.group === row.group)
            if (!items.length) return null
            return (
              <section key={row.group} className={'newdoc-row is-' + row.group} role="group" aria-label={row.label}>
                <h3>{row.label}{row.group === 'mine' && <span className="muted"> — 주 폴더의 _templates/</span>}</h3>
                <div className="newdoc-cards">{items.map(([c, i]) => card(c, i))}</div>
              </section>
            )
          })}
        </div>
        <div className="info-actions">
          <button onClick={onClose} disabled={busy}>취소</button>
          <button className="is-primary" onClick={() => void create()} disabled={busy}>{folderMode ? '폴더 만들기' : '만들기'}</button>
        </div>
      </div>
    </div>
  )
}
