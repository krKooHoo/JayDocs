import { useEffect, useRef, useState } from 'react'

/**
 * 파일 탐색기에서 파일 · 폴더를 파일 트리에 끌어다 놓기 (DESIGN §28).
 *
 * - 트리(`.tree`) 위에 놓은 것만 받는다. 놓은 항목의 핸들을 `onDrop` 에 넘긴다 — 무엇을 할지는 앱이 정한다(가져오기 창).
 * - 편집기(CodeMirror) 위에 놓는 것은 건드리지 않는다 — 편집기의 원래 동작 그대로.
 * - 그 밖의 곳에 놓으면 아무것도 하지 않고, 브라우저가 그 파일로 페이지를 바꿔 앱을 떠나는 것만 막는다.
 * - 창 전체에서 캡처 단계로 듣는다 — 트리 안의 다른 처리기보다 먼저.
 */

export type DropOver = 'tree' | 'elsewhere' | null

const hasFiles = (e: DragEvent) => !!e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files')

/** 놓는 곳 — 트리 · 편집기 · 그 밖 */
export function dropZone(target: EventTarget | null): 'tree' | 'editor' | 'elsewhere' {
  const el = target && typeof (target as Element).closest === 'function' ? (target as Element) : null
  if (el?.closest('.tree')) return 'tree'
  if (el?.closest('.cm-editor')) return 'editor'
  return 'elsewhere'
}

/**
 * drop 에 든 파일 · 폴더의 핸들. 핸들을 줄 수 없으면(브라우저가 못 하거나 파일이 아닌 것만) null.
 * 핸들은 drop 처리 안에서 바로 꺼내야 한다(끝나면 DataTransfer 가 비워진다) — 그래서 동기로 훑고 Promise 만 돌려준다.
 */
export function droppedHandles(e: DragEvent): Promise<FileSystemHandle[]> | null {
  const picks: Promise<FileSystemHandle | null>[] = []
  for (const item of Array.from(e.dataTransfer?.items ?? [])) {
    if (item.kind !== 'file' || typeof item.getAsFileSystemHandle !== 'function') continue
    picks.push(item.getAsFileSystemHandle())
  }
  if (picks.length === 0) return null
  return Promise.all(picks).then((list) => list.filter((h): h is FileSystemHandle => !!h && (h.kind === 'file' || h.kind === 'directory')))
}

/** 끌고 있는 것이 창을 벗어났다고 보는 시간 — dragover 는 창 위에 있는 동안 계속 온다 */
const OVER_MS = 400

/**
 * 트리에 놓으면 `onDrop` 을, 트리 밖(편집기 제외)에 놓으면 `onMiss` 를 부른다.
 * 돌려주는 값은 지금 파일을 끌고 있는 곳 (안내를 띄울 때 쓴다). 끄는 동안에는 그것이 파일인지 폴더인지 알 수 없다.
 */
export function useTreeDrop(onDrop: (handles: FileSystemHandle[]) => void, onMiss: () => void): DropOver {
  const [over, setOver] = useState<DropOver>(null)
  const handlers = useRef({ onDrop, onMiss })
  handlers.current = { onDrop, onMiss }

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const leave = () => {
      if (timer !== null) clearTimeout(timer)
      timer = null
      setOver(null)
    }
    const onDragOver = (e: DragEvent) => {
      if (!hasFiles(e)) return
      const zone = dropZone(e.target)
      if (zone === 'editor') { leave(); return }
      // 놓을 수 있는 곳으로 알린다 — 안 그러면 drop 이 오지 않고 브라우저가 그 파일을 열어 앱을 떠난다
      e.preventDefault()
      // 'copy' — 탐색기가 허용하는 효과다 ('link' 는 막힐 수 있다). 실제로는 복사하지 않고 원래 자리에서 연다
      if (e.dataTransfer) e.dataTransfer.dropEffect = zone === 'tree' ? 'copy' : 'none'
      setOver(zone)
      if (timer !== null) clearTimeout(timer)
      timer = setTimeout(leave, OVER_MS)
    }
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return
      const zone = dropZone(e.target)
      leave()
      if (zone === 'editor') return
      e.preventDefault()
      e.stopPropagation()
      if (zone !== 'tree') { handlers.current.onMiss(); return }
      const picked = droppedHandles(e)
      if (!picked) { handlers.current.onMiss(); return }
      void picked.then((hs) => { if (hs.length) handlers.current.onDrop(hs) })
    }
    window.addEventListener('dragover', onDragOver, true)
    window.addEventListener('drop', onDrop, true)
    return () => {
      window.removeEventListener('dragover', onDragOver, true)
      window.removeEventListener('drop', onDrop, true)
      if (timer !== null) clearTimeout(timer)
    }
  }, [])

  return over
}
