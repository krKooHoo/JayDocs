import { useSyncExternalStore } from 'react'
import { dismissNotice, noticeList, runNoticeAction, subscribeNotices } from '../lib/notices'

/** 목록이 길면 앞의 몇 줄만 */
const MAX_ITEMS = 6

/**
 * 알림 줄을 그리는 곳 (하나, 화면 오른쪽 아래). `lib/notices.ts` 의 `notify` · `notifyError` 가 넣은 것을 보인다.
 * 실패(error)는 닫을 때까지 남고 스크린 리더가 바로 읽는다(alert). 나머지는 몇 초 뒤 사라진다(status).
 */
export function NoticeHost() {
  const list = useSyncExternalStore(subscribeNotices, noticeList)
  return (
    <div className="notices" role="region" aria-label="알림">
      {list.map((n) => (
        <div key={n.id} className={'toast' + (n.kind === 'error' ? ' is-error' : '')} role={n.kind === 'error' ? 'alert' : 'status'}>
          <div className="toast-text">
            {n.text}
            {n.items && (
              <ul className="toast-items">
                {n.items.slice(0, MAX_ITEMS).map((it) => <li key={it}>{it}</li>)}
                {n.items.length > MAX_ITEMS && <li className="muted">… 외 {n.items.length - MAX_ITEMS}개</li>}
              </ul>
            )}
          </div>
          {n.action && <button className="toast-action" onClick={() => runNoticeAction(n.id)} title={n.action.hint}>{n.action.label}</button>}
          <button className="toast-close" onClick={() => dismissNotice(n.id)} title="알림 닫기" aria-label="알림 닫기">×</button>
        </div>
      ))}
    </div>
  )
}
