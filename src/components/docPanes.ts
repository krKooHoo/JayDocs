import { createContext, useContext } from 'react'

/**
 * 문서 창(탭이 든 탭 묶음)의 수. `Workbench` 가 레이아웃이 바뀔 때 세어 넣는다 — 수가 달라질 때만 값이 바뀐다.
 * 문서 창 안의 것(훑어보기 패널 — PLAN-skim SK6)이 "창이 하나뿐인가"를 알 때 쓴다. `Workbench` 밖에서는 1.
 */
export const DocPaneCountContext = createContext(1)

export function useDocPaneCount(): number {
  return useContext(DocPaneCountContext)
}
