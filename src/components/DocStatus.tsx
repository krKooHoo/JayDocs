import type { ReactNode } from 'react'
import { store } from '../store/documents'
import { confirmConvertToUtf8 } from './ReadOnlyBanner'
import './DocStatus.css'

/**
 * 문서 상태 줄 (ADOPT A2 · DESIGN §32). 모든 문서 창의 맨 아래 한 줄.
 *
 *   [자리 정보 ……………………] [선택 요약] [창이 넣는 것] [LF · BOM 없음] [UTF-8] [저장됨]
 *
 * - 자리 정보는 창이 넣는다 — 그리드는 활성 셀의 이름 · 열 · 타입 · 검증 오류 · Field 설명. 넘치면 끝이 `…` 로 잘린다.
 * - 줄바꿈 · BOM · 인코딩 · 저장 상태는 스토어의 문서에서 읽는다. 표시만 하고 파일에 쓰지 않는다.
 * - UTF-8 이 아닌 파일은 인코딩이 단추가 된다 — 누르면 "UTF-8 로 바꿔 저장" (안내 막대 · 팔레트와 같다).
 * - 좁은 창에서는 `ds-opt` 항목(줄바꿈 · 표 크기 · 스키마 …)을 숨긴다 (container query).
 * - 이 컴포넌트는 구독하지 않는다 — 부모 창이 `useDocVersion(path)` 로 이미 다시 그린다.
 */
interface Props {
  path: string
  /** 왼쪽 자리 정보 */
  cell?: ReactNode
  /** 선택 요약 조각 (`개수 4` · `합 14`). 비었으면 없다 */
  summary?: readonly string[] | null
  /** 인코딩 앞에 창이 더 넣을 것 (그리드의 오류 수 · 스키마 · 끝 개행 추가) */
  extra?: ReactNode
}

export function DocStatus({ path, cell, summary, extra }: Props) {
  const d = store.get(path)
  if (!d || d.status !== 'ready') return null
  const readOnly = store.isReadOnly(path)
  const dirty = store.isDirty(path)
  const status = d.saving ? '저장 중…' : d.conflict ? '충돌' : readOnly ? '🔒 읽기 전용' : dirty ? '● 수정됨' : '저장됨'
  const eol = d.kind === 'tsv' ? d.table.eol : d.eol
  const bom = d.kind === 'tsv' ? d.table.bom : d.bom
  const encoding = d.encoding.toUpperCase()
  const utf8 = d.encoding === 'utf-8'

  return (
    <div className="doc-status" aria-label="문서 상태">
      <div className="ds-cell">{cell}</div>
      {summary && summary.length > 0 && (
        <span className="ds-summary" title="선택 요약 — 보일 계산은 팔레트의 '선택 요약: …' 로 고른다">{summary.join(' · ')}</span>
      )}
      {extra}
      <span className="ds-item ds-opt" title="줄바꿈 · BOM — 저장할 때 그대로 지킨다">
        {eol === '\r\n' ? 'CRLF' : 'LF'} · {bom ? 'BOM' : 'BOM 없음'}
      </span>
      {utf8 ? (
        <span className="ds-item" title="인코딩">UTF-8</span>
      ) : (
        <button className="ds-btn is-warn" onClick={() => void confirmConvertToUtf8(path)} title={`${encoding} 로 읽은 파일 — 읽기 전용. 눌러서 UTF-8 로 바꿔 저장 (팔레트에도 있다)`}>
          {encoding}
        </button>
      )}
      <span className={'ds-item ds-save' + (dirty ? ' is-dirty' : '')}>{status}</span>
    </div>
  )
}
