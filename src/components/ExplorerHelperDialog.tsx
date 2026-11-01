import { useEffect, useRef } from 'react'
import { HELPER_FILE, markHelperReady } from '../lib/explorer'

/** 파일 탐색기 연결 도우미 안내. path 가 있으면 설치 뒤 그 경로를 바로 연다 */
export function ExplorerHelperDialog({ path, onOpen, onCopy, onClose }: { path: string | null; onOpen: (path: string) => void; onCopy: (path: string) => void; onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => { box.current?.querySelector('a')?.focus() }, [])

  const done = () => {
    markHelperReady()
    if (path) onOpen(path)
    else onClose()
  }

  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div
        className="palette import"
        role="dialog"
        aria-label="파일 탐색기 연결"
        ref={box}
        onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose() } }}
      >
        <div className="palette-title">파일 탐색기 연결 — 이 PC 에서 한 번만</div>
        <ol className="helper-steps">
          <li>
            <a className="helper-download" href={HELPER_FILE} download>연결 도우미 내려받기</a>
            <div>내려받은 파일을 실행합니다. Windows 보호 창이 뜨면 <b>추가 정보 → 실행</b>.</div>
          </li>
          <li>
            <button className="is-primary" onClick={done}>설치했습니다{path ? ' — 열기' : ''}</button>
            <div>브라우저가 앱을 열지 물으면 <b>항상 허용</b>을 체크하고 엽니다.</div>
          </li>
        </ol>
        <div className="import-hint">
          브라우저는 보안상 탐색기를 직접 열 수 없어 도우미가 대신 엽니다. 이 계정에만 설치되고(관리자 권한 불필요), 폴더를 보여 주기만 하며 파일을 실행하지 않습니다.
        </div>
        <div className="info-actions">
          {path && <button onClick={() => onCopy(path)}>경로만 복사</button>}
          <button onClick={onClose}>닫기</button>
        </div>
      </div>
    </div>
  )
}
