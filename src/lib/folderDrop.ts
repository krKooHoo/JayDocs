import { useEffect, useRef, useState } from 'react'

/**
 * 파일 탐색기에서 폴더를 앱 창에 끌어다 놓기 (DESIGN §28 FP1).
 * Windows 의 폴더 선택 창은 폴더만 보여 준다 — 안의 파일을 보면서 고르려면 탐색기에서 찾아 끌어다 놓는다.
 *
 * - 폴더가 든 drop 만 가로챈다. 파일만 든 drop 은 건드리지 않는다(편집기에 글 파일을 놓는 동작 등은 전과 같다).
 * - 창 전체에서 캡처 단계로 듣는다 — 편집기(CodeMirror)가 먼저 받아 폴더를 글로 읽으려 들지 않게.
 */

const hasFiles = (e: DragEvent) => !!e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files')

/**
 * drop 에 든 폴더의 핸들들. 폴더가 없으면 null.
 * 핸들은 drop 처리 안에서 바로 꺼내야 한다(끝나면 DataTransfer 가 비워진다) — 그래서 동기로 훑고 Promise 만 돌려준다.
 */
export function droppedFolders(e: DragEvent): Promise<FileSystemDirectoryHandle[]> | null {
  const picks: Promise<FileSystemHandle | null>[] = []
  for (const item of Array.from(e.dataTransfer?.items ?? [])) {
    if (item.kind !== 'file' || !item.webkitGetAsEntry?.()?.isDirectory) continue
    if (typeof item.getAsFileSystemHandle !== 'function') continue
    picks.push(item.getAsFileSystemHandle())
  }
  if (picks.length === 0) return null
  return Promise.all(picks).then((list) => list.filter((h): h is FileSystemDirectoryHandle => h?.kind === 'directory'))
}

/** 끌고 있는 것이 창을 벗어났다고 보는 시간 — dragover 는 창 위에 있는 동안 계속 온다 */
const OVER_MS = 400

/**
 * 창에 폴더를 놓으면 `onFolders` 를 부른다. 돌려주는 값은 "지금 파일 · 폴더를 창 위로 끌고 있는가" (안내를 띄울 때 쓴다).
 * 끌고 있는 동안에는 그것이 폴더인지 알 수 없다(브라우저가 놓은 뒤에만 알려 준다).
 */
export function useFolderDrop(onFolders: (dirs: FileSystemDirectoryHandle[]) => void): boolean {
  const [over, setOver] = useState(false)
  const handler = useRef(onFolders)
  handler.current = onFolders

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const leave = () => {
      if (timer !== null) clearTimeout(timer)
      timer = null
      setOver(false)
    }
    const onDragOver = (e: DragEvent) => {
      if (!hasFiles(e)) return
      // 놓을 수 있는 곳으로 알린다 — 안 그러면 편집기 밖에서는 drop 이 오지 않고 브라우저가 그 폴더를 열어 앱을 떠난다
      e.preventDefault()
      setOver(true)
      if (timer !== null) clearTimeout(timer)
      timer = setTimeout(leave, OVER_MS)
    }
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return
      leave()
      const folders = droppedFolders(e)
      if (!folders) return // 파일만 놓았다 — 전과 같게 둔다
      e.preventDefault()
      e.stopPropagation()
      void folders.then((dirs) => { if (dirs.length) handler.current(dirs) })
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
