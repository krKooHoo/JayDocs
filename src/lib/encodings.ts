/**
 * 다른 인코딩으로 다시 열기 (ADOPT C4 · DESIGN §55). UTF-8 이 아닌 파일은 EUC-KR 로 읽는다고 짐작한다(`fsaBackend.decodeText`) —
 * 짐작이 틀렸을 때(일본어 · 중국어 · 서유럽 글, 깨진 바이트 몇 개가 든 UTF-8) 이 표에서 골라 이미 있는 바이트를 다시 해석한다.
 * 화면만 바뀐다 — 디스크는 그대로, 문서는 계속 읽기 전용(쓰기는 "UTF-8 로 바꿔 저장" 만, 디스크 바이트로 다시 검사한다).
 */
export interface EncodingChoice {
  /** 앱의 문서 인코딩 값 (`TextDecoder` 이름, 깨진 바이트 허용 UTF-8 은 `utf-8-replace`) */
  id: string
  label: string
}

export const REOPEN_ENCODINGS: readonly EncodingChoice[] = [
  { id: 'euc-kr', label: 'EUC-KR (CP949 · 한국어 Windows)' },
  { id: 'utf-8-replace', label: 'UTF-8 (깨진 바이트는 �)' },
  { id: 'shift_jis', label: 'Shift_JIS (일본어)' },
  { id: 'gbk', label: 'GBK (중국어 간체)' },
  { id: 'big5', label: 'Big5 (중국어 번체)' },
  { id: 'windows-1252', label: 'Windows-1252 (서유럽)' },
]

/** 상태 줄 · 안내 막대에 보일 짧은 이름 */
export function encodingName(id: string): string {
  if (id === 'utf-8-replace') return 'UTF-8 (깨짐 대체)'
  return id.toUpperCase()
}

/** 그 인코딩의 디코더 이름 */
export function decoderName(id: string): string {
  return id === 'utf-8-replace' ? 'utf-8' : id
}

export function isReopenEncoding(id: string): boolean {
  return REOPEN_ENCODINGS.some((e) => e.id === id)
}
