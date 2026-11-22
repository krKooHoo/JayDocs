import { useEffect, useRef, useState } from 'react'
import { checkPath, cleanPath } from '../lib/localPath'

interface Props {
  title: string
  /** 고른 폴더의 이름 (브라우저가 알려 주는 유일한 이름). 파일 하나만 가져온 곳이면 그 파일 이름 */
  folder: string
  /** 파일 하나만 가져온 곳 — 경로는 그 파일의 전체 경로 */
  file?: boolean
  /** 문서 별칭. 없으면(가져온 폴더 · 경로 복사) 별칭 칸을 숨긴다 */
  label?: string
  path: string
  /** 입력한 적이 없어 미리 채운 경로 */
  guess?: string
  /** 전체 경로 복사를 하려는데 경로를 몰라 온 것 — 경로가 꼭 있어야 하고, 저장하면 복사한다 */
  forCopy?: boolean
  closeLabel?: string
  onSave: (label: string, path: string) => void | Promise<void>
  onClose: () => void
}

const isWindows = () => typeof navigator !== 'undefined' && /Windows/.test(navigator.userAgent)

/** 폴더의 별칭과 상세 경로 입력. 키: Enter 저장 · Esc 닫기 */
export function FolderInfoDialog(p: Props) {
  const [label, setLabel] = useState(p.label ?? '')
  const [path, setPath] = useState(p.path || p.guess || '')
  const [error, setError] = useState<string | null>(null)
  const first = useRef<HTMLInputElement>(null)
  const guessed = !p.path && !!p.guess && path === p.guess
  const what = p.file ? '파일' : '폴더'

  useEffect(() => { first.current?.focus() }, [])

  const submit = async () => {
    const clean = cleanPath(path)
    if (p.forCopy && !clean) { setError(`${what}의 전체 경로를 넣으세요`); return }
    const problem = clean ? checkPath(clean, p.folder) : null
    if (problem) { setError(problem); return }
    try {
      await p.onSave(label.trim(), clean)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.nativeEvent.isComposing) return
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); p.onClose() }
    if (e.key === 'Enter' && (e.target as HTMLElement).tagName !== 'BUTTON') { e.preventDefault(); void submit() }
  }

  const example = isWindows() ? `C:\\Users\\이름\\Documents\\${p.folder}` : `/Users/이름/Documents/${p.folder}`

  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) p.onClose() }}>
      <div className="palette import" role="dialog" aria-label={p.title} onKeyDown={onKeyDown}>
        <div className="palette-title">{p.title} — {p.file ? '📄' : '📁'} {p.folder}</div>
        {p.forCopy && (
          <div className="import-hint">
            브라우저 앱은 보안상 {what}의 <b>전체 경로를 알 수 없어요.</b> 이 {what}의 경로를 한 번만 알려 주면 기억해 두고, 그 뒤로는 묻지 않고 바로 복사해요.
          </div>
        )}
        {p.label !== undefined && (
          <label className="info-field">
            문서 별칭
            <input ref={first} value={label} onChange={(e) => setLabel(e.target.value)} placeholder={p.folder} maxLength={60} spellCheck={false} />
          </label>
        )}
        <label className="info-field">
          {p.file ? '파일의 전체 경로' : '상세 경로'}
          <input ref={p.label === undefined ? first : undefined} className="is-path" value={path} onChange={(e) => { setPath(e.target.value); setError(null) }} placeholder={example} spellCheck={false} />
        </label>
        <div className="import-hint">
          {guessed
            ? '최근 폴더와 같은 곳에 있다고 보고 미리 채웠습니다. 다르면 고치세요.'
            : `파일 탐색기 주소 표시줄의 경로를 복사해 붙여 넣으세요${p.file ? ' (그 뒤에 \\파일 이름을 붙여서)' : ''}.${p.forCopy ? '' : ' 브라우저는 보안상 전체 경로를 알려 주지 않습니다.'}`}
        </div>
        {error && <div className="banner is-error">{error}</div>}
        <div className="info-actions">
          <button onClick={p.onClose}>{p.closeLabel ?? '취소'}</button>
          <button className="is-primary" onClick={() => void submit()}>{p.forCopy ? '저장하고 복사' : '저장'}</button>
        </div>
      </div>
    </div>
  )
}
