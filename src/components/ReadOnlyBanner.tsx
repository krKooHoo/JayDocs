import { useState } from 'react'
import { backend } from '../lib/backend'
import { splitRootPath } from '../lib/roots.mjs'
import { store } from '../store/documents'

/**
 * 읽기 전용으로 연 창 위의 안내. 이유는 둘 —
 * - 읽기 전용으로 가져온 폴더 (수강생 제출물 등): 그 자리에서 읽기 전용을 끌 수 있다
 * - UTF-8 이 아닌 파일 (옛 메모장 txt, 한글 Excel 의 CSV 등): 원래 인코딩으로 되쓰지 못하므로 UTF-8 로 바꿔 저장해야 고칠 수 있다
 */
export function ReadOnlyBanner({ path }: { path: string }) {
  const [busy, setBusy] = useState(false)
  const reason = store.readOnlyReason(path)
  if (!reason) return null

  if (reason === 'mount') {
    const alias = splitRootPath(path).alias ?? ''
    const unlock = async () => {
      setBusy(true)
      try { await backend().setRootReadOnly(alias, false) } catch (e) { window.alert(`바꾸지 못했습니다: ${(e as Error).message}`) } finally { setBusy(false) }
    }
    return (
      <div className="banner">
        🔒 읽기 전용으로 가져온 폴더입니다 (@{alias}).
        <button onClick={() => void unlock()} disabled={busy} title="이 폴더 전체의 읽기 전용을 끈다. 저장은 바로 디스크에 쓰인다">읽기 전용 끄기</button>
      </div>
    )
  }

  const encoding = (store.get(path)?.encoding ?? '').toUpperCase()
  const convert = async () => {
    if (!window.confirm(`${path}\n\n지금 보이는 내용 그대로 UTF-8 로 다시 저장합니다.\n이 파일을 ${encoding} 로만 읽는 프로그램이 있다면 한글이 깨져 보일 수 있습니다. 계속할까요?`)) return
    setBusy(true)
    try { await store.convertToUtf8(path) } finally { setBusy(false) }
  }
  return (
    <div className="banner">
      🔒 UTF-8 이 아닌 파일입니다 ({encoding} 로 읽음) — 읽기 전용.
      <button onClick={() => void convert()} disabled={busy}>UTF-8 로 바꿔 저장</button>
    </div>
  )
}
