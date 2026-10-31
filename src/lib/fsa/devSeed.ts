import type { Workspace } from './workspace'

/**
 * 개발 전용 (`npm run dev` 의 `?opfs`): 폴더 선택 창 없이 브라우저 안 저장소(OPFS)를 문서 폴더로 쓴다.
 * 자동 화면 시험용이고, 빌드에는 들어가지 않는다.
 */
const SAMPLE: Record<string, string> = {
  'docs/개요.md': '# 개요\n\n본문 **굵게**\n\n```mermaid\ngraph LR\n  A --> B\n```\n',
  'docs/표.tsv': '#type\tstring\tint\n이름\t값\n가\t1\n나\t2\n',
  '메모.txt': '메모\r\n',
  '설정.json': '{\n  "n": 1\n}\n',
}

export async function devWorkspace(): Promise<Workspace> {
  const opfs = await navigator.storage.getDirectory()
  const primary = await opfs.getDirectoryHandle('dev-docs', { create: true })
  const mount = await opfs.getDirectoryHandle('dev-mount', { create: true })
  const put = async (root: FileSystemDirectoryHandle, rel: string, text: string) => {
    const parts = rel.split('/')
    const name = parts.pop() as string
    let d = root
    for (const p of parts) d = await d.getDirectoryHandle(p, { create: true })
    const h = await d.getFileHandle(name, { create: true })
    if ((await h.getFile()).size > 0) return
    const w = await h.createWritable()
    await w.write(text)
    await w.close()
  }
  for (const [rel, text] of Object.entries(SAMPLE)) await put(primary, rel, text)
  await put(mount, '가져온 문서.md', '# 가져온 문서\n')
  return { id: 'dev', primary, mounts: [{ alias: '가져온폴더', handle: mount, readOnly: false }], recent: [] }
}
