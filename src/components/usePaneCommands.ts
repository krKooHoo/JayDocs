import { useEffect, useRef, type RefObject } from 'react'
import { PANE_COMMAND_EVENT } from '../lib/nav'

/** 이 창(`root` = `.pane`)에 온 팔레트 명령을 받는다 (DESIGN §36). run 은 늘 마지막 렌더의 것을 부른다 */
export function usePaneCommands(root: RefObject<HTMLElement>, run: (id: string) => void) {
  const latest = useRef(run)
  latest.current = run
  useEffect(() => {
    const el = root.current
    if (!el) return
    const h = (e: Event) => latest.current((e as CustomEvent<string>).detail)
    el.addEventListener(PANE_COMMAND_EVENT, h)
    return () => el.removeEventListener(PANE_COMMAND_EVENT, h)
  }, [root])
}
