/**
 * 파일 탐색기 열기 (DESIGN §21). 웹 페이지는 탐색기를 직접 열 수 없어, PC 에 한 번 설치한
 * 연결 도우미(public/helper/jaydocs-explorer-setup.cmd)를 jaydocs-open: 주소로 부른다.
 * 설치 여부는 페이지에서 알 수 없으므로 사용자가 설치했다고 알려 준 것을 PC·브라우저별로 기억한다.
 */
const KEY = 'jaydocs.explorerHelper'
export const HELPER_FILE = 'helper/jaydocs-explorer-setup.cmd'
/** 눌러도 창이 넘어가지 않으면 도우미가 없다고 보고 알리는 시간 */
const NO_RESPONSE_MS = 2500
const FRAME_KEEP_MS = 60_000

export const explorerSupported = () => /Windows/.test(navigator.userAgent)

export function helperReady() {
  try { return localStorage.getItem(KEY) === '1' } catch { return false }
}

export function markHelperReady() {
  try { localStorage.setItem(KEY, '1') } catch { /* 무시 */ }
}

export const explorerUrl = (path: string) => `jaydocs-open:${encodeURIComponent(path)}`

export function openInExplorer(path: string, onNoResponse: () => void) {
  // location 을 바꾸면 beforeunload 가 불려 "저장 안 한 문서" 경고가 뜰 수 있어 iframe 으로 부른다
  const frame = document.createElement('iframe')
  frame.style.display = 'none'
  frame.src = explorerUrl(path)
  document.body.append(frame)
  // 브라우저가 앱을 열지 묻는 동안 주소를 부른 문서가 남아 있게 바로 지우지 않는다
  window.setTimeout(() => frame.remove(), FRAME_KEEP_MS)
  const timer = window.setTimeout(() => {
    window.removeEventListener('blur', answered)
    onNoResponse()
  }, NO_RESPONSE_MS)
  function answered() { window.clearTimeout(timer) }
  window.addEventListener('blur', answered, { once: true })
}
