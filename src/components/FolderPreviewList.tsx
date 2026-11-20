import { useEffect, useState } from 'react'
import { previewFolder, type FolderPreview } from '../lib/fsa/fsaBackend'
import { DOC_EXTS_LABEL, FILE_TYPES, fileTypeOf } from '../lib/filetypes.mjs'

/** 목록에 보이는 최대 수 — 나머지는 "외 n개" */
const SHOWN_MAX = 200

/** "문서 12개 — 마크다운 5 · TSV 표 4 · JSON 3". 형식 표(filetypes.mjs)의 순서대로 */
export function previewSummary(p: FolderPreview): string {
  if (p.files.length === 0) return ''
  const parts = FILE_TYPES.filter((t) => p.byExt[t.ext]).map((t) => `${t.label} ${p.byExt[t.ext]}`)
  return `문서 ${p.files.length}개${p.truncated ? ' 이상' : ''} — ${parts.join(' · ')}`
}

type State = { kind: 'loading' } | { kind: 'ready'; data: FolderPreview } | { kind: 'error'; message: string }

/**
 * 고른 폴더(아직 열지 않음)에 든 문서의 수와 목록 (DESIGN §28).
 * Windows 의 폴더 선택 창은 폴더만 보여 주므로, 고른 바로 뒤에 "맞는 폴더인가" 를 여기서 본다.
 * `asMount`: 가져온 폴더의 규칙으로 훑는다(Unity 폴더 제외). 주 폴더로 열 폴더면 false.
 */
export function FolderPreviewList({ handle, asMount = true }: { handle: FileSystemDirectoryHandle; asMount?: boolean }) {
  const [state, setState] = useState<State>({ kind: 'loading' })

  useEffect(() => {
    let stale = false
    setState({ kind: 'loading' })
    previewFolder(handle, asMount).then(
      (data) => { if (!stale) setState({ kind: 'ready', data }) },
      (e) => { if (!stale) setState({ kind: 'error', message: (e as Error).message }) },
    )
    return () => { stale = true }
  }, [handle, asMount])

  if (state.kind === 'loading') return <div className="folder-preview is-note" aria-live="polite">📁 {handle.name} 을 훑는 중…</div>
  // 못 훑어도 가져오기는 해 볼 수 있다 (가져올 때 권한을 다시 묻는다)
  if (state.kind === 'error') return <div className="folder-preview is-note" aria-live="polite">이 폴더의 문서를 미리 보지 못했습니다 — {state.message}</div>
  const p = state.data
  if (p.files.length === 0) {
    return <div className="folder-preview banner is-error" aria-live="polite">이 폴더에는 여는 문서가 없습니다 ({DOC_EXTS_LABEL}). 다른 폴더를 고르세요.</div>
  }
  return (
    <div className="folder-preview" aria-live="polite">
      <div className="folder-preview-summary">{previewSummary(p)}{p.truncated ? ' (항목이 많아 다 훑지 못했습니다)' : ''}</div>
      <ul className="folder-preview-list" tabIndex={0} aria-label="이 폴더의 문서">
        {p.files.slice(0, SHOWN_MAX).map((f) => (
          <li key={f} title={f}><span className="folder-preview-icon">{fileTypeOf(f)?.icon}</span>{f}</li>
        ))}
        {p.files.length > SHOWN_MAX && <li className="is-more">… 외 {p.files.length - SHOWN_MAX}개</li>}
      </ul>
    </div>
  )
}
