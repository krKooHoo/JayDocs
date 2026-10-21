import { useState } from 'react'
import { store } from '../store/documents'

/**
 * UTF-8 이 아닌 파일(옛 메모장 txt, 한글 Excel 의 CSV 등)을 읽기 전용으로 연 창 위의 안내.
 * 원래 인코딩으로 되쓰지는 못하므로, 고치려면 UTF-8 로 바꿔 저장해야 한다.
 */
export function EncodingBanner({ path, encoding }: { path: string; encoding: string }) {
  const [busy, setBusy] = useState(false)
  const convert = async () => {
    if (!window.confirm(`${path}\n\n지금 보이는 내용 그대로 UTF-8 로 다시 저장합니다.\n이 파일을 ${encoding.toUpperCase()} 로만 읽는 프로그램이 있다면 한글이 깨져 보일 수 있습니다. 계속할까요?`)) return
    setBusy(true)
    try { await store.convertToUtf8(path) } finally { setBusy(false) }
  }
  return (
    <div className="banner">
      🔒 UTF-8 이 아닌 파일입니다 ({encoding.toUpperCase()} 로 읽음) — 읽기 전용.
      <button onClick={() => void convert()} disabled={busy}>UTF-8 로 바꿔 저장</button>
    </div>
  )
}
