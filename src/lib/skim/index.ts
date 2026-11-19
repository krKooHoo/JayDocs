import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react'
import { backend, type Backend } from '../backend'
import { serializeTable } from '../tsv/table'
import { store, useDocVersion } from '../../store/documents'
import { SkimReader, type SkimFile } from './reader'

/**
 * 훑어보기의 글 읽기 (PLAN-skim SK4).
 *
 *   const { status, text, error } = useSkimText(path)
 *
 * - 열려 있는 문서는 스토어의 지금 내용(저장 전 편집 포함)을 준다.
 * - 열지 않은 파일은 디스크에서 읽는다 — 스토어에 올리지 않고 `skimReader()` 의 캐시(경로 + 수정 시각, 최근 200개)에 둔다.
 * - 바깥에서 파일이 바뀌면 다시 읽는다 (backend 의 변경 알림).
 */
export * from './fit'
export * from './head'
export { SkimReader, type SkimFile, type SkimIo, type SkimReaderOptions } from './reader'

let reader: SkimReader | null = null
let boundTo: Backend | null = null

/** 앱 전체가 같이 쓰는 읽기 캐시. 작업 공간이 바뀌면(backend 가 바뀌면) 새로 만든다 */
export function skimReader(): SkimReader {
  const b = backend()
  if (!reader || boundTo !== b) {
    boundTo = b
    reader = new SkimReader({
      read: (path) => b.read(path),
      stat: (path) => b.stat(path),
      // rescan(창에 돌아옴 · 감시 끊김)은 무엇이 바뀌었는지 모른다 → null
      watch: (handler) => b.subscribe((e) => handler(e.event === 'rescan' || e.path === '' ? null : e.path)),
    })
  }
  return reader
}

/** 표 · Text 객체 → 글. 스토어의 내용은 불변 객체라 객체가 같으면 글도 같다 */
const serialized = new WeakMap<object, string>()

/**
 * 열려 있는 문서의 지금 내용 (저장 전 편집 포함). 열려 있지 않거나 아직 읽는 중이면 null.
 * md · txt · json 은 LF 로 이은 글(BOM 없음), 표는 파일에 써질 글 그대로(BOM · 줄바꿈 포함)다.
 */
export function openDocText(path: string): string | null {
  const d = store.get(path)
  if (!d || d.status !== 'ready') return null
  const key: object = d.kind === 'tsv' ? d.table : d.text
  let s = serialized.get(key)
  if (s === undefined) {
    s = d.kind === 'tsv' ? serializeTable(d.table) : d.text.toString()
    serialized.set(key, s)
  }
  return s
}

export interface SkimText {
  status: 'loading' | 'ready' | 'error'
  /** status 가 'ready' 일 때만 글. BOM · CRLF 가 남아 있을 수 있다 (`DocView` 가 알아서 맞춘다) */
  text: string | null
  /** status 가 'error' 일 때 이유 (바이너리 · 5 MB 초과 · 없는 파일 …) */
  error: string | null
  /** 어디서 온 글인가 — 'store': 열려 있는 문서(저장 전 편집 포함) · 'disk': 디스크에서 읽은 것 */
  source: 'store' | 'disk' | null
  /** 디스크 인코딩 ('disk' 일 때만). 'utf-8' 이 아니면 EUC-KR 로 읽어 보여 주는 것 */
  encoding: string | null
}

const LOADING: SkimText = { status: 'loading', text: null, error: null, source: null, encoding: null }
const noSubscription = () => () => {}

function fromFile(file: SkimFile | undefined): SkimText {
  if (!file) return LOADING
  if (file.ok) return { status: 'ready', text: file.text, error: null, source: 'disk', encoding: file.encoding }
  return { status: 'error', text: null, error: file.error, source: 'disk', encoding: null }
}

/**
 * 경로의 글. null 을 주면 아무것도 읽지 않는다(늘 'loading').
 * 돌려주는 객체는 내용이 바뀔 때만 새것이다. 열린 문서는 글자를 칠 때마다 바뀐다 — 무거운 렌더는 쓰는 쪽에서 늦춘다(디바운스).
 */
export function useSkimText(path: string | null): SkimText {
  useDocVersion(path)
  const open = path === null ? null : openDocText(path)
  const diskPath = path !== null && open === null ? path : null
  const subscribe = useCallback((l: () => void) => (diskPath === null ? noSubscription() : skimReader().subscribe(diskPath, l)), [diskPath])
  const file = useSyncExternalStore(subscribe, () => (diskPath === null ? undefined : skimReader().peek(diskPath)))
  // 처음 볼 때와 경로가 바뀔 때 수정 시각을 확인한다 (캐시가 있어도 — 닫힌 사이에 바뀌었을 수 있다)
  useEffect(() => {
    if (diskPath !== null) void skimReader().load(diskPath)
  }, [diskPath])
  return useMemo<SkimText>(
    () => (open !== null ? { status: 'ready', text: open, error: null, source: 'store', encoding: null } : diskPath === null ? LOADING : fromFile(file)),
    [open, diskPath, file],
  )
}
