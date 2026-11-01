import { APP_VERSION, pwa, usePwa } from '../lib/pwa'

/** 지금 새 버전이 있는지 묻고 결과를 알린다. 새 버전이 있으면 버튼이 받는 중 → 적용으로 바뀐다 */
export async function checkForUpdate(notify: (msg: string | null) => void) {
  notify(null)
  const result = await pwa.checkUpdate()
  if (result === 'latest') notify(`최신 버전입니다 (${APP_VERSION})`)
  else if (result === 'offline') notify('확인하지 못했습니다 — 인터넷 연결을 확인하세요. 문서 편집은 그대로 됩니다')
}

/** 업데이트 확인 → 새 버전 받는 중 → 새 버전 적용. onApply 가 있으면 저장 여부를 거기서 먼저 확인한다 */
export function UpdateButton({ notify, onApply }: { notify: (msg: string | null) => void; onApply?: () => void }) {
  const app = usePwa()
  if (!app.canCheck) return null
  if (app.updateReady) {
    return <button className="is-primary" onClick={onApply ?? (() => app.applyUpdate())} title="모든 창을 닫았다 열어도 적용됩니다">새 버전 적용</button>
  }
  if (app.downloading) return <button disabled>새 버전 받는 중…</button>
  return (
    <button
      disabled={app.checking}
      onClick={() => void checkForUpdate(notify)}
      title={app.downloadFailed ? '새 버전 파일을 받지 못했습니다. 누르면 다시 받습니다' : `현재 버전 ${APP_VERSION}`}
    >
      {app.checking ? '확인 중…' : app.downloadFailed ? '다시 받기' : '업데이트 확인'}
    </button>
  )
}
