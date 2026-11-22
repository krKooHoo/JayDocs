/**
 * 창 제목 (ADOPT A3 · DESIGN §33). 작업 표시줄 · Alt+Tab · 브라우저 탭에 보인다.
 *
 *   `● 개요.md — dev-docs — JayDocs`
 *
 * - `●` 는 이 창에 저장 안 한 문서가 하나라도 있다는 뜻 — 창 단위다(macOS 닫기 버튼의 점처럼).
 *   다른 앱으로 갔다가도 저장 안 한 것을 잊지 않게. 지금 보는 문서가 깨끗해도 다른 탭이 고쳐졌으면 붙는다.
 * - 파일 이름은 활성 문서 창의 문서. 문서가 없으면 뺀다.
 * - 루트 별칭은 남긴다 — JayDocs 창이 여럿일 때 작업 표시줄에서 구분된다.
 */
export function windowTitle(opts: { rootLabel: string; activePath: string | null; dirty: boolean }): string {
  const parts: string[] = []
  if (opts.activePath) parts.push(opts.activePath.split('/').pop() || opts.activePath)
  if (opts.rootLabel) parts.push(opts.rootLabel)
  parts.push('JayDocs')
  return (opts.dirty ? '● ' : '') + parts.join(' — ')
}
