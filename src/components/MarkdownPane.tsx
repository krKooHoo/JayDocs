import { useEffect, useMemo, useRef, useState } from 'react'
import { Compartment, EditorState, Transaction } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { syntaxTree } from '@codemirror/language'
import { baseExtensions, isMarkdownPath, remote } from '../lib/cm'
import { cmdTitle, runCommand, tip } from '../lib/commands'
import { onPaneAction } from '../lib/nav'
import { isSkimPath, useSkimPanelState } from '../lib/skim/panel'
import { fileTypeOf } from '../lib/filetypes.mjs'
import { formatJson, jsonError } from '../lib/jsonText'
import { dismissNotice, notify, notifyError } from '../lib/notices'
import { setOutlineOn, useOutlineOn } from '../lib/md/outlineState'
import { store, useDocVersion } from '../store/documents'
import { PreviewPane } from './PreviewPane'
import { ReadOnlyBanner } from './ReadOnlyBanner'
import { SkimPanel } from './SkimPanel'
import { OutlinePanel } from './OutlinePanel'
import { PathBar, type PathTail } from './PathBar'
import { DocStatus } from './DocStatus'
import { usePaneCommands } from './usePaneCommands'
import { activeIndex, outlineOf } from '../lib/md/outline'
import { useDocPaneCount } from './docPanes'
import { hybrid } from './hybrid'
import { mdTableExtension } from './tableCommands'
import { readMarkdownSpot, setMdViewPath } from './mdContext'
import { registerSpotReader, type SpotReader } from '../lib/contextMenu'

type Mode = 'source' | 'hybrid' | 'preview' | 'split'
const MODES: Mode[] = ['source', 'hybrid', 'split', 'preview']

function modeKey(path: string) {
  return `jaydocs.mdmode:${path}`
}
function loadMode(path: string): Mode {
  if (!isMarkdownPath(path)) return 'source'
  try {
    const m = localStorage.getItem(modeKey(path))
    if (m === 'source' || m === 'hybrid' || m === 'preview' || m === 'split') return m
  } catch { /* 무시 */ }
  return 'source'
}

export function MarkdownPane({ path, onSplit }: { path: string; onSplit: () => void }) {
  useDocVersion(path)
  const host = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  /** 훑어보기 패널에 넘기는 편집기 — 편집기가 만들어지고 없어질 때 패널이 다시 그려지게 state 로도 둔다 */
  const [skimView, setSkimView] = useState<EditorView | null>(null)
  /** 편집기가 바뀌면(글 · 커서 · 줄 높이) 부를 함수 — 훑어보기 패널이 넣는다 */
  const skimPing = useRef<(() => void) | null>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  /** 글 · 구문 트리가 바뀌면 부를 함수 — 목차 띠가 넣는다 (DESIGN §29) */
  const outlinePing = useRef<(() => void) | null>(null)
  /** 글 · 커서 · 구문 트리가 바뀌면 부를 함수 — 경로 막대의 마지막 단계(커서가 든 절의 제목)를 따라가게 (DESIGN §31) */
  const pathPing = useRef<(() => void) | null>(null)
  /** 목차로 포커스를 옮기는 함수 — 목차 띠가 넣는다. 띠가 숨겨져 있으면 false */
  const outlineFocus = useRef<(() => boolean) | null>(null)
  const hybridComp = useRef(new Compartment())
  const [mode, setModeState] = useState<Mode>(() => loadMode(path))
  /** 보기 모드 순환(전역 명령)이 지금 모드를 읽는 곳 — 구독 클로저가 낡은 값을 보지 않게 */
  const modeRef = useRef<Mode>(mode)
  modeRef.current = mode
  const root = useRef<HTMLDivElement>(null)
  /** 이 창에서 포커스를 받는 곳 — 편집기. 미리보기 전용 모드는 편집기가 숨겨지므로 미리보기 영역 (DESIGN §24.7 X2) */
  const focusPane = () => {
    if (modeRef.current === 'preview') root.current?.querySelector<HTMLElement>('.preview')?.focus()
    else viewRef.current?.focus()
  }
  /** 모드를 바꾼 뒤 포커스를 줄 것 — 바뀐 화면이 그려진 다음(아래 effect)에 준다 */
  const wantFocus = useRef(false)
  /** 보기 모드를 바꾸고 (버튼 · Ctrl+Shift+V) 포커스를 그 모드의 자리로 옮긴다. 버튼에 포커스가 남으면 바로 친 글자 · 방향키가 문서로 가지 않는다 */
  const setMode = (m: Mode) => {
    if (m === modeRef.current) { focusPane(); return }
    wantFocus.current = true
    modeRef.current = m
    setModeState(m)
    try { localStorage.setItem(modeKey(path), m) } catch { /* 무시 */ }
  }
  useEffect(() => {
    if (!wantFocus.current) return
    wantFocus.current = false
    focusPane()
  }, [mode])

  useEffect(() => {
    store.retain(path)
    return () => store.release(path)
  }, [path])
  useEffect(() => { setModeState(loadMode(path)) }, [path])

  // 팔레트의 보기 모드 명령 (DESIGN §36) — 활성 탭의 이 창에만 온다
  usePaneCommands(root, (id) => {
    if (!isMarkdownPath(path)) return
    if (id === 'viewSource') setMode('source')
    else if (id === 'viewHybrid') setMode('hybrid')
    else if (id === 'viewSplit') setMode('split')
    else if (id === 'viewPreview') setMode('preview')
  })

  // 전역 명령(보기 모드 순환 · 포커스)
  useEffect(() => onPaneAction(path, (a) => {
    if (a === 'cycleMdMode' && isMarkdownPath(path)) setMode(MODES[(MODES.indexOf(modeRef.current) + 1) % MODES.length])
    if (a === 'focus') window.setTimeout(focusPane, 0)
    if (a === 'formatJson') formatActive()
    if (a === 'focusOutline') focusOutline()
  }), [path])

  /** 목차로 포커스 (Ctrl+Alt+T). 꺼져 있으면 켠다. 이미 목차에 있으면 편집기로 돌아간다 */
  function focusOutline() {
    if (!isMarkdownPath(path)) return
    if (modeRef.current !== 'hybrid') { notify('목차는 하이브리드 모드에서 보입니다 — 보기 모드 순환은 Ctrl+Shift+V', { key: 'outline' }); return }
    if (root.current?.querySelector('.outline-list')?.contains(document.activeElement)) { focusPane(); return }
    setOutlineOn(true)
    // 켠 띠가 그려진 다음에
    window.setTimeout(() => {
      if (outlineFocus.current?.()) dismissNotice('outline')
      else notify('창이 좁아 목차를 숨겼습니다 — 창을 넓히면 보입니다', { key: 'outline' })
    }, 0)
  }

  const d = store.get(path)
  const ready = d?.status === 'ready' && d.kind === 'text'
  const readOnly = store.isReadOnly(path)
  const isMd = isMarkdownPath(path)
  const isJson = fileTypeOf(path)?.lang === 'json'

  /** JSON 정렬 — 에디터 트랜잭션으로 넣어 Ctrl+Z 로 되돌릴 수 있게 */
  function formatActive() {
    const view = viewRef.current
    if (!view || fileTypeOf(path)?.lang !== 'json' || store.isReadOnly(path)) return
    const before = view.state.doc.toString()
    const r = formatJson(before)
    // 정렬 실패(문법 오류)는 알림 줄에 남는다. 다음에 성공하면 내린다
    const key = `json:${path}`
    if (!r.ok) { notifyError(r.error, { key }); view.focus(); return }
    dismissNotice(key)
    if (r.text !== before) view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: r.text } })
    // 정렬 버튼을 누르면 포커스가 버튼에 남아 바로 누른 Ctrl+Z 가 이 편집기로 오지 않는다 (TC-1108)
    view.focus()
  }

  const docText = d?.kind === 'text' ? d.text : null
  const jsonErr = useMemo(() => (isJson && docText ? jsonError(docText.toString()) : null), [isJson, docText])

  useEffect(() => {
    if (!ready || !host.current) return
    const doc = store.get(path)
    if (!doc || doc.kind !== 'text') return
    const source = Symbol(path)
    const view = new EditorView({
      state: EditorState.create({
        doc: doc.text,
        extensions: [
          ...baseExtensions(path, { save: () => void store.save(path), readOnly }),
          hybridComp.current.of(isMd && loadMode(path) === 'hybrid' ? hybrid(path) : []),
          isMd ? mdTableExtension() : [],
          EditorView.updateListener.of((u) => {
            if (u.docChanged || u.selectionSet || u.geometryChanged) skimPing.current?.()
            const treeMoved = u.docChanged || syntaxTree(u.state) !== syntaxTree(u.startState)
            if (outlinePing.current && treeMoved) outlinePing.current()
            if (pathPing.current && (treeMoved || u.selectionSet)) pathPing.current()
            if (!u.docChanged) return
            for (const tr of u.transactions) {
              if (tr.docChanged && !tr.annotation(remote)) store.applyChanges(path, tr.changes, source)
            }
          }),
        ],
      }),
      parent: host.current,
    })
    viewRef.current = view
    setMdViewPath(view, path)
    setSkimView(view)
    const unsubscribe = store.onChanges(path, (changes, from) => {
      if (from === source) return
      view.dispatch({ changes, annotations: [remote.of(true), Transaction.addToHistory.of(false)] })
    })
    return () => {
      unsubscribe()
      view.destroy()
      viewRef.current = null
      setSkimView(null)
    }
  }, [ready, path, isMd, readOnly])

  // 하이브리드 장식 켜고 끄기
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    view.dispatch({ effects: hybridComp.current.reconfigure(isMd && mode === 'hybrid' ? hybrid(path) : []) })
  }, [mode, path, isMd])

  // 맥락 메뉴의 자리 (DESIGN §40) — 커서 · 포커스의 표 · 링크 · tsv-view · 다이어그램
  const spotRef = useRef<SpotReader>(() => null)
  spotRef.current = (target, point) => (ready
    ? readMarkdownSpot(viewRef.current, target, point, { path, markdown: isMd, json: isJson, readOnly: store.isReadOnly(path), mode: modeRef.current })
    : null)
  useEffect(() => {
    const el = root.current
    return el ? registerSpotReader(el, (t, pt) => spotRef.current(t, pt)) : undefined
  }, [])

  const dirty = store.isDirty(path)
  const bakeErrors = d?.kind === 'text' ? d.bakeErrors : []

  // 훑어보기 패널 (PLAN-skim SK6): md · txt 에만, 켜져 있고 문서 창이 하나일 때만 보인다
  const skimmable = isSkimPath(path)
  const skimOn = useSkimPanelState().on
  const paneCount = useDocPaneCount()
  const skimShown = skimmable && skimOn && paneCount === 1 && ready

  // 목차 띠 (DESIGN §29): 마크다운 · 하이브리드 모드에서만, 켜져 있을 때
  const outlineOn = useOutlineOn()
  const outlineShown = isMd && mode === 'hybrid' && outlineOn && ready

  // 경로 막대의 마지막 단계 (DESIGN §31): 커서가 든 절의 제목. 미리보기 전용 모드는 편집기가 숨어 있어 두지 않는다
  const headingTail = isMd && mode !== 'preview'
  const [heading, setHeading] = useState<string | null>(null)
  useEffect(() => {
    const view = skimView
    if (!view || !headingTail) { setHeading(null); return }
    let timer: ReturnType<typeof setTimeout> | null = null
    const update = () => {
      timer = null
      // 기다리지 않고 지금 트리로 — 커서 위쪽은 이미 읽혀 있다. 같은 글이면 목차 띠가 뽑은 것을 같이 쓴다
      const items = outlineOf(view.state, 0)
      const i = activeIndex(items, view.state.doc.lineAt(view.state.selection.main.head).number)
      setHeading(i >= 0 ? items[i].text || '(빈 제목)' : null)
    }
    update()
    pathPing.current = () => { if (timer === null) timer = setTimeout(update, 120) }
    return () => {
      pathPing.current = null
      if (timer !== null) clearTimeout(timer)
    }
  }, [skimView, headingTail])

  const pathTail: PathTail | null = headingTail && skimView ? {
    name: '제목',
    label: heading,
    empty: '제목 없음',
    list: () => {
      const view = skimView
      const items = outlineOf(view.state)
      const minLevel = items.reduce((m, it) => Math.min(m, it.level), 6)
      return {
        current: activeIndex(items, view.state.doc.lineAt(view.state.selection.main.head).number),
        items: items.map((it) => ({
          label: it.text || '(빈 제목)',
          depth: it.level - minLevel,
          // 목차 띠와 같다 — 제목을 편집기 맨 위로, 커서는 제목 글 앞
          run: () => {
            const len = view.state.doc.length
            view.dispatch({ selection: { anchor: Math.min(it.textFrom, len) }, effects: EditorView.scrollIntoView(Math.min(it.from, len), { y: 'start', yMargin: 4 }) })
            view.focus()
          },
        })),
      }
    },
  } : null

  return (
    <div className="pane" ref={root}>
      {/* 명령 막대 — 단추마다 data-command (lib/paneCommands.ts, paneCommands.test) */}
      <div className="pane-bar">
        <PathBar path={path} tail={pathTail} onExit={focusPane} />
        {isMd && (
          <span className="seg" title={tip('보기 모드 — 순환', 'cycleMdMode')}>
            <button data-command="viewSource" className={mode === 'source' ? 'is-on' : ''} onClick={() => setMode('source')} title={cmdTitle('viewSource')}>소스</button>
            <button data-command="viewHybrid" className={mode === 'hybrid' ? 'is-on' : ''} onClick={() => setMode('hybrid')} title={cmdTitle('viewHybrid')}>하이브리드</button>
            <button data-command="viewSplit" className={mode === 'split' ? 'is-on' : ''} onClick={() => setMode('split')} title={cmdTitle('viewSplit')}>분할</button>
            <button data-command="viewPreview" className={mode === 'preview' ? 'is-on' : ''} onClick={() => setMode('preview')} title={cmdTitle('viewPreview')}>미리보기</button>
          </span>
        )}
        {isJson && (
          <>
            <span className={'pane-status' + (jsonErr ? ' is-err' : '')} title={jsonErr ?? 'JSON 문법 이상 없음'}>{jsonErr ? 'JSON 오류' : 'JSON ✓'}</span>
            <button data-command="formatJson" onClick={formatActive} disabled={readOnly} title={tip('들여쓰기 2칸으로 정렬 — Ctrl+Z 로 되돌린다', 'formatJson')}>정렬</button>
          </>
        )}
        {isMd && mode === 'hybrid' && (
          <button
            data-command="toggleOutline"
            className={'outline-toggle' + (outlineOn ? ' is-on' : '')}
            aria-pressed={outlineOn}
            onClick={() => { setOutlineOn(!outlineOn); focusPane() }}
            title={tip('목차 보이기 / 숨기기 — 하이브리드 모드에서 왼쪽에 제목 목록을 띄운다', 'toggleOutline')}
          >
            목차
          </button>
        )}
        {skimmable && (
          <button
            data-command="toggleSkim"
            className={'skim-toggle' + (skimOn ? ' is-on' : '')}
            aria-pressed={skimOn}
            onClick={() => { runCommand('toggleSkim'); focusPane() }}
            title={tip('훑어보기 패널 켜기 / 끄기 — 문서 전체를 오른쪽에 축소해 띄운다. 문서 창이 하나일 때만 보인다', 'toggleSkim')}
          >
            훑어보기
          </button>
        )}
        <button data-command="save" onClick={() => void store.save(path)} disabled={!dirty || !!d?.conflict || !!d?.saving} title={tip('저장', 'save')}>저장</button>
        <button data-command="split" onClick={onSplit} title={tip('이 문서를 오른쪽 창에도 연다', 'split')}>오른쪽에 분할</button>
      </div>
      {d?.conflict && (
        <div className="banner">
          디스크의 파일이 바뀌었습니다. 어느 쪽을 쓸까요?
          <button data-command="conflictTakeDisk" onClick={() => store.takeDisk(path)}>디스크 내용 받기 (내 수정 버림)</button>
          <button data-command="conflictOverwrite" onClick={() => void store.overwrite(path)}>내 내용으로 덮어쓰기</button>
        </div>
      )}
      {readOnly && <ReadOnlyBanner path={path} />}
      {d?.status === 'error' && <div className="banner is-error">{d.error}</div>}
      {d?.status === 'ready' && d.error && !d.conflict && <div className="banner is-error">{d.error}</div>}
      {bakeErrors.map((e) => <div key={e} className="banner">{e}</div>)}
      {d?.status === 'loading' && <div className="pane-empty">불러오는 중…</div>}
      <div className={'md-body is-' + mode} ref={bodyRef}>
        {/* key 는 형제끼리 달라야 한다 — 목차 · 훑어보기가 같은 key(path)면 모드를 바꿀 때마다 목차가 지워지지 않고 쌓였다 */}
        {outlineShown && <OutlinePanel key={'outline:' + path} view={skimView} ping={outlinePing} focusRef={outlineFocus} />}
        <div className="editor-host" ref={host} style={{ display: mode === 'preview' ? 'none' : undefined }} />
        {/* lines: 미리보기 전용 모드에서 훑어보기 패널이 미리보기의 스크롤 위치를 줄로 바꾸는 데 쓴다. 그때만 찍는다 */}
        {(mode === 'split' || mode === 'preview') && ready && <PreviewPane path={path} lines={mode === 'preview' && skimShown} />}
        {skimShown && <SkimPanel key={'skim:' + path} path={path} mode={mode} view={skimView} ping={skimPing} body={bodyRef} />}
      </div>
      <DocStatus path={path} />
    </div>
  )
}
