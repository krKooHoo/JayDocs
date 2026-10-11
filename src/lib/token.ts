const KEY = 'jaydocs.token'

/**
 * 사이드카가 준 토큰은 URL fragment(#token=…)로 들어온다.
 * sessionStorage 에 옮기고 주소창에서는 지운다 (새로고침해도 유지, 탭이 닫히면 사라짐).
 */
export function getToken(): string | null {
  const m = location.hash.match(/token=([^&]+)/)
  if (m) {
    sessionStorage.setItem(KEY, m[1])
    history.replaceState(null, '', location.pathname + location.search)
    return m[1]
  }
  const saved = sessionStorage.getItem(KEY)
  if (saved) return saved
  return import.meta.env.DEV ? 'dev' : null
}
