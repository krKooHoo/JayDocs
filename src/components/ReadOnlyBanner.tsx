import { useState } from 'react'
import { backend } from '../lib/backend'
import { runCommand } from '../lib/commands'
import { askConfirm } from '../lib/dialogs'
import { notifyError } from '../lib/notices'
import { splitRootPath } from '../lib/roots.mjs'
import { store, useDocVersion } from '../store/documents'

/**
 * UTF-8 이 아닌 파일을 묻고 UTF-8 로 바꿔 저장한다 — 안내 막대 · 상태 줄의 인코딩 · 팔레트가 같이 쓴다.
 * 디스크의 파일을 다른 인코딩으로 덮어쓰므로 앱에서 되돌릴 수 없다 — 취소가 기본이다.
 * onBusy: 답을 받고 쓰는 동안 true. 답을 기다리는 동안 탭이 닫혔거나 이미 바뀌었으면 convertToUtf8 이 아무 일도 하지 않는다
 */
export async function confirmConvertToUtf8(path: string, onBusy?: (busy: boolean) => void): Promise<void> {
  const encoding = (store.get(path)?.encoding ?? '').toUpperCase()
  const ok = await askConfirm({
    title: 'UTF-8 로 바꿔 저장',
    message: `지금 보이는 내용 그대로 UTF-8 로 다시 저장합니다. 이 파일을 ${encoding} 로만 읽는 프로그램이 있다면 한글이 깨져 보일 수 있습니다. 계속할까요?`,
    items: [path],
    okLabel: 'UTF-8 로 저장',
    danger: true,
  })
  if (!ok) return
  onBusy?.(true)
  try { await store.convertToUtf8(path) } finally { onBusy?.(false) }
  // 바뀌면 안내 막대(와 포커스가 돌아와 있던 버튼)가 사라진다 — 포커스가 body 로 빠지면 문서 창으로
  window.setTimeout(() => { if (document.activeElement === document.body) runCommand('focusEditor') }, 0)
}

/**
 * 읽기 전용으로 연 창 위의 안내. 이유는 둘 —
 * - 읽기 전용으로 가져온 폴더 (수강생 제출물 등): 그 자리에서 읽기 전용을 끌 수 있다
 * - UTF-8 이 아닌 파일 (옛 메모장 txt, 한글 Excel 의 CSV 등): 원래 인코딩으로 되쓰지 못하므로 UTF-8 로 바꿔 저장해야 고칠 수 있다
 */
export function ReadOnlyBanner({ path }: { path: string }) {
  // 읽기 전용 이유(가져온 폴더 · 인코딩)는 이 경로의 버전에 실려 온다 — 부모 창이 다시 그리지 않아도 따라가게
  useDocVersion(path)
  const [busy, setBusy] = useState(false)
  const reason = store.readOnlyReason(path)
  if (!reason) return null

  if (reason === 'mount') {
    const alias = splitRootPath(path).alias ?? ''
    // 브라우저에 쓰기 권한을 묻는다 — 클릭 직후여야 하므로 앞에 대화상자를 끼우지 않는다 (실패만 알림 줄로)
    const unlock = async () => {
      setBusy(true)
      try { await backend().setRootReadOnly(alias, false) } catch (e) { notifyError(`바꾸지 못했습니다: ${(e as Error).message}`, { key: `readonly:${alias}` }) } finally { setBusy(false) }
    }
    return (
      <div className="banner">
        🔒 읽기 전용으로 가져온 폴더입니다 (@{alias}).
        <button onClick={() => void unlock()} disabled={busy} title="이 폴더 전체의 읽기 전용을 끈다. 저장은 바로 디스크에 쓰인다">읽기 전용 끄기</button>
      </div>
    )
  }

  const encoding = (store.get(path)?.encoding ?? '').toUpperCase()
  // 묻는 동안은 단추를 살려 둔다 — 대화상자가 닫히며 포커스를 돌려줄 곳이다
  const convert = () => confirmConvertToUtf8(path, setBusy)
  return (
    <div className="banner">
      🔒 UTF-8 이 아닌 파일입니다 ({encoding} 로 읽음) — 읽기 전용.
      <button onClick={() => void convert()} disabled={busy}>UTF-8 로 바꿔 저장</button>
    </div>
  )
}
