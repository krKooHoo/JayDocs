import { useEffect, useRef, useState } from 'react'
import { explorerSupported } from '../lib/explorer'
import { checkPath, cleanPath } from '../lib/localPath'

interface Props {
  title: string
  /** 고른 폴더의 이름 (브라우저가 알려 주는 유일한 이름) */
  folder: string
  /** 문서 별칭. 없으면(가져온 폴더) 별칭 칸을 숨긴다 */
  label?: string
  path: string
  /** 입력한 적이 없어 미리 채운 경로 */
  guess?: string
  closeLabel?: string
  onSave: (label: string, path: string) => void | Promise<void>
  onClose: () => void
}

/** 폴더의 별칭과 상세 경로 입력. 키: Enter 저장 · Esc 닫기 */
export function FolderInfoDialog(p: Props) {
  const [label, setLabel] = useState(p.label ?? '')
  const [path, setPath] = useState(p.path || p.guess || '')
  const [error, setError] = useState<string | null>(null)
  const first = useRef<HTMLInputElement>(null)
  const guessed = !p.path && !!p.guess && path === p.guess

  useEffect(() => { first.current?.focus() }, [])

  const submit = async () => {
    const clean = cleanPath(path)
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

  const example = explorerSupported() ? `C:\\Users\\이름\\Documents\\${p.folder}` : `/Users/이름/Documents/${p.folder}`

  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) p.onClose() }}>
      <div className="palette import" role="dialog" aria-label={p.title} onKeyDown={onKeyDown}>
        <div className="palette-title">{p.title} — 📁 {p.folder}</div>
        {p.label !== undefined && (
          <label className="info-field">
            문서 별칭
            <input ref={first} value={label} onChange={(e) => setLabel(e.target.value)} placeholder={p.folder} maxLength={60} spellCheck={false} />
          </label>
        )}
        <label className="info-field">
          상세 경로
          <input ref={p.label === undefined ? first : undefined} className="is-path" value={path} onChange={(e) => { setPath(e.target.value); setError(null) }} placeholder={example} spellCheck={false} />
        </label>
        <div className="import-hint">
          {guessed
            ? '최근 폴더와 같은 곳에 있다고 보고 미리 채웠습니다. 다르면 고치세요.'
            : '탐색기 주소 표시줄의 경로를 복사해 붙여 넣으세요. 브라우저는 보안상 전체 경로를 알려 주지 않습니다.'}
        </div>
        {error && <div className="banner is-error">{error}</div>}
        <div className="info-actions">
          <button onClick={p.onClose}>{p.closeLabel ?? '취소'}</button>
          <button className="is-primary" onClick={() => void submit()}>저장</button>
        </div>
      </div>
    </div>
  )
}
