import { useEffect, useState } from 'react'
import { backend, type TreeEntry } from '../lib/backend'
import { sourceLineOf } from '../lib/md/sourceLines'
import { toggleTheme, useTheme } from '../lib/theme'
import { useTreeVersion } from '../store/documents'
import { DocFileView, DocThumb, DocView, type DocWeight } from './DocView'
import './SkimDemo.css'

/**
 * 확인용 임시 화면 (PLAN-skim Phase A). 개발 빌드(`npm run dev`)의 `?opfs&skimdemo` 에서만 뜬다 — App.tsx 가 그때만 불러온다.
 * 작업 공간의 모든 문서를 `DocThumb` 격자로 보여 주고, 하나를 누르면 아래에 `DocFileView`(줄 번호 표시)로 크게 그린다.
 *
 * **Phase B~E 가 들어오면 지운다**: 이 파일, `SkimDemo.css`, App.tsx 의 `SkimDemo` 두 곳.
 */

/** 파일이 아닌 글(`text` prop)로 그리는 썸네일 — 긴 문서(끝이 잘린다) · 빈 문서 · 없는 파일 */
const LONG_MD = ['# 긴 문서', '', '틀을 넘는 문서는 앞부분만 보이고 잘린다.', '', ...Array.from({ length: 80 }, (_, i) => `## ${i + 1}절\n\n문단 ${i + 1}. ${'가나다라마바사 '.repeat(12)}\n`)].join('\n')
const EXTRA: { name: string; path: string; text?: string }[] = [
  { name: '(글) 긴 문서.md', path: '긴 문서.md', text: LONG_MD },
  { name: '(글) 빈 문서.md', path: '빈 문서.md', text: '' },
  { name: '(없는 파일) 없음.md', path: '없음-skimdemo.md' },
]

function allFiles(entries: TreeEntry[], out: string[] = []): string[] {
  for (const e of entries) {
    if (e.type === 'dir') allFiles(e.children ?? [], out)
    else out.push(e.path)
  }
  return out
}

export default function SkimDemo() {
  const theme = useTheme()
  const treeVersion = useTreeVersion()
  const [shown, setShown] = useState(true)
  const [weight, setWeight] = useState<DocWeight>('rich')
  const [size, setSize] = useState(180)
  const [paths, setPaths] = useState<string[]>([])
  const [picked, setPicked] = useState<string | null>(null)
  const [line, setLine] = useState<number | null>(null)

  useEffect(() => {
    let alive = true
    backend().tree()
      .then((t) => { if (alive) setPaths([...allFiles(t.entries), ...t.mounts.flatMap((m) => allFiles(m.entries))]) })
      .catch((e) => console.warn('skimdemo: 트리를 읽지 못했습니다', e))
    return () => { alive = false }
  }, [treeVersion, shown])

  if (!shown) return <button className="skim-demo-open" onClick={() => setShown(true)}>훑어보기 확인 화면</button>
  const extra = EXTRA.find((x) => x.path === picked)
  return (
    <div className="skim-demo">
      <div className="skim-demo-bar">
        <h1>훑어보기 확인 화면 (임시)</h1>
        <span className="seg">
          <button className={weight === 'rich' ? 'is-on' : ''} onClick={() => setWeight('rich')}>rich</button>
          <button className={weight === 'light' ? 'is-on' : ''} onClick={() => setWeight('light')}>light</button>
        </span>
        <label>크기 <input type="range" min={100} max={400} step={10} value={size} onChange={(e) => setSize(Number(e.target.value))} /> {size}px</label>
        <button onClick={toggleTheme}>{theme === 'dark' ? '라이트로' : '다크로'}</button>
        <button onClick={() => setShown(false)}>숨기기 (앱으로)</button>
        <span className="muted">문서 {paths.length}개 + 글 {EXTRA.length}개</span>
      </div>
      <div className="skim-demo-grid" style={{ gridTemplateColumns: `repeat(auto-fill, ${size}px)` }}>
        {[...paths.map((p) => ({ name: p, path: p, text: undefined as string | undefined })), ...EXTRA].map((x) => (
          <button key={x.name} className={'skim-demo-card' + (picked === x.path ? ' is-on' : '')} title={x.name} onClick={() => { setPicked(x.path); setLine(null) }}>
            <DocThumb path={x.path} text={x.text} weight={weight} />
            <div className="skim-demo-name">{x.name}</div>
          </button>
        ))}
      </div>
      {picked !== null && (
        <>
          <div className="skim-demo-bar">
            <h1>{picked}</h1>
            <span className="muted">DocView · lines 켬 — 왼쪽 숫자가 data-line(원문 줄). 조각을 누르면 줄 번호를 읽는다: {line ?? '—'}</span>
          </div>
          <div className="skim-demo-full" onClick={(e) => setLine(sourceLineOf(e.target as Element, e.currentTarget))}>
            {extra?.text !== undefined
              ? <DocView path={picked} text={extra.text} weight={weight} lines />
              : <DocFileView path={picked} weight={weight} lines />}
          </div>
        </>
      )}
    </div>
  )
}
