/**
 * 앱 대화상자 — `window.prompt` / `confirm` 대신 `await` 로 부른다 (DESIGN §24.6).
 * 여기는 줄 세우기만 한다(순수 로직). 그리는 것은 `components/DialogHost.tsx` 하나.
 *
 * - 한 번에 하나만 뜬다. 떠 있는 동안 부른 것은 줄을 서고, 앞의 것이 닫히면 차례로 뜬다.
 * - 떠 있는 동안 전역 단축키는 돌지 않는다 (`dialogOpen()` 을 App 의 전역 키 처리가 본다).
 * - 닫히면 부르던 때의 포커스로 돌아간다 (`opener`).
 */

export interface TextOptions {
  title: string
  /** 입력 칸 앞의 이름 */
  label?: string
  /** 칸 아래 작은 설명 */
  hint?: string
  value?: string
  /** 열릴 때 선택할 범위 [시작, 끝). 없으면 전체 */
  select?: [number, number]
  okLabel?: string
  /**
   * 확인을 눌렀을 때 값을 받아 처리한다 (검사 + 실제 동작).
   * 문자열을 돌려주면 그 이유를 칸 아래에 보이고 닫지 않는다. null 이면 닫는다.
   */
  submit?: (value: string) => string | null | Promise<string | null>
}

export interface ConfirmOptions {
  title: string
  message: string
  /** 본문 아래에 보일 목록 (지워질 파일, 저장 안 한 문서 …) */
  items?: string[]
  /** 목록 위의 한 줄 */
  itemsLabel?: string
  okLabel?: string
  cancelLabel?: string
  /** 되돌릴 수 없는 동작 — 기본 포커스를 취소에 두고 확인 버튼을 위험 색으로 */
  danger?: boolean
}

interface Base {
  id: number
  /** 부르던 때 포커스가 있던 곳 (브라우저 밖 — 테스트 — 에서는 null) */
  opener: unknown
}
export type DialogRequest =
  | (Base & { kind: 'text'; opts: TextOptions; resolve: (v: string | null) => void })
  | (Base & { kind: 'confirm'; opts: ConfirmOptions; resolve: (v: boolean) => void })

let queue: DialogRequest[] = []
let nextId = 1
const listeners = new Set<() => void>()

function emit() {
  for (const l of listeners) l()
}

function focused(): unknown {
  return typeof document === 'undefined' ? null : document.activeElement
}

/** 글 한 줄을 받는다. 취소하면 null */
export function askText(opts: TextOptions): Promise<string | null> {
  return new Promise((resolve) => {
    queue = [...queue, { id: nextId++, kind: 'text', opts, resolve, opener: focused() }]
    emit()
  })
}

/** 예 / 아니오. 취소(Esc · 바깥 클릭)는 false */
export function askConfirm(opts: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    queue = [...queue, { id: nextId++, kind: 'confirm', opts, resolve, opener: focused() }]
    emit()
  })
}

/** 지금 떠 있는 것 (줄의 맨 앞). 없으면 null */
export function currentDialog(): DialogRequest | null {
  return queue[0] ?? null
}

export function dialogOpen(): boolean {
  return queue.length > 0
}

/** 줄에 선 수 (떠 있는 것 포함) */
export function dialogCount(): number {
  return queue.length
}

/**
 * 떠 있는 대화상자에 답한다 — 글 입력은 값 또는 null(취소), 확인은 true / false.
 * 떠 있는 것(맨 앞)이 아니면 아무 일도 하지 않는다 (두 번 눌린 버튼, 이미 닫힌 창).
 */
export function settleDialog(id: number, value: string | boolean | null): boolean {
  const head = queue[0]
  if (!head || head.id !== id) return false
  queue = queue.slice(1)
  if (head.kind === 'text') head.resolve(typeof value === 'string' ? value : null)
  else head.resolve(value === true)
  emit()
  return true
}

export function subscribeDialogs(l: () => void): () => void {
  listeners.add(l)
  return () => { listeners.delete(l) }
}
