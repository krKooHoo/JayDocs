/**
 * 문서 창 막대의 단추 = 팔레트 명령 (ADOPT A6 · DESIGN §36). 한 곳에서 관리한다.
 *
 * - 창 막대 · 그리드 툴바의 단추는 여기의 id 를 `data-command` 로 달고, 툴팁은 `cmdTitle(id)` 로 만든다 — `이름 (키)`.
 * - 팔레트 명령은 Workbench 가 이 표로 등록한다. 실행은 **활성 탭의 창 하나**에만 보낸다(`lib/nav.ts` 의 `sendToPane`) —
 *   같은 표를 두 창에 열어 두었을 때 행 넣기가 두 번 되지 않게.
 * - 키는 단축키 표(`shortcuts-table.mjs`)의 `palette` 로 붙는다 — 그 키는 창(그리드 · 편집기)이 직접 받는다.
 *   표에 따로 줄이 없는 키(되돌리기 · 다시 실행)만 여기에 `keys` 로 적는다.
 * - 막대에 단추를 더하면 여기에도 넣는다 — `paneCommands.test.ts` 가 막대마다 빠진 단추를 찾는다.
 */

export type PaneScope = 'grid' | 'md'

export interface PaneCommand {
  id: string
  /** 팔레트에 보일 이름 */
  label: string
  /** 단추 툴팁 (키는 뒤에 붙는다) */
  title: string
  scope: PaneScope
  /** 표 · 글을 고친다 — 읽기 전용이면 꺼진다 */
  edits?: boolean
  /** 단축키 표에 줄이 없는 키 */
  keys?: string
}

export const PANE_COMMANDS: readonly PaneCommand[] = [
  // ---- 그리드 툴바
  { id: 'gridUndo', label: '표: 되돌리기', title: '되돌리기', scope: 'grid', keys: 'Ctrl+Z' },
  { id: 'gridRedo', label: '표: 다시 실행', title: '다시 실행', scope: 'grid', keys: 'Ctrl+Y' },
  { id: 'gridRowAbove', label: '표: 위에 행 삽입', title: '선택한 행 위에 빈 행 — 선택한 행 수만큼', scope: 'grid', edits: true },
  { id: 'gridRowBelow', label: '표: 아래에 행 삽입', title: '선택한 행 아래에 빈 행 — 선택한 행 수만큼', scope: 'grid', edits: true },
  { id: 'gridRowAppend', label: '표: 끝에 행 추가', title: '맨 끝에 빈 행', scope: 'grid', edits: true },
  { id: 'gridRowDup', label: '표: 행 복제', title: '선택한 행 복제', scope: 'grid', edits: true },
  { id: 'gridRowUp', label: '표: 행 위로 옮기기', title: '선택한 행을 한 칸 위로', scope: 'grid', edits: true },
  { id: 'gridRowDown', label: '표: 행 아래로 옮기기', title: '선택한 행을 한 칸 아래로', scope: 'grid', edits: true },
  { id: 'gridRowDel', label: '표: 행 삭제', title: '선택한 행 삭제', scope: 'grid', edits: true },
  { id: 'gridColLeft', label: '표: 왼쪽에 열 삽입', title: '선택한 열 왼쪽에 빈 열', scope: 'grid', edits: true },
  { id: 'gridColRight', label: '표: 오른쪽에 열 삽입', title: '선택한 열 오른쪽에 빈 열', scope: 'grid', edits: true },
  { id: 'gridColDel', label: '표: 열 삭제', title: '선택한 열 삭제', scope: 'grid', edits: true },
  { id: 'gridFind', label: '표: 찾기', title: '찾기', scope: 'grid' },
  { id: 'gridReplace', label: '표: 바꾸기', title: '바꾸기', scope: 'grid' },
  { id: 'gridCalcFile', label: '표: 계산식 파일 열기 · 만들기 (같은 폴더의 _Calc.tsv)', title: '계산식 파일 열기 — 없으면 만들어 연다', scope: 'grid' },
  { id: 'gridSeedHeader', label: '표: 타입 행 · 머리글 행 만들기 (빈 표)', title: '첫 줄에 머리글(CSV) · 타입 행과 머리글(TSV)을 만든다', scope: 'grid', edits: true },
  { id: 'gridTrailingNewline', label: '표: 파일 끝 개행 추가', title: '파일 끝에 개행을 넣는다. 끝 개행이 없으면 행을 덧붙일 때마다 마지막 줄이 git diff 에 같이 나온다 (.editorconfig 도 끝 개행을 요구한다)', scope: 'grid', edits: true },
  // ---- 마크다운 창 막대 — 보기 모드 (순환은 Ctrl+Shift+V, 전역 명령 cycleMdMode)
  { id: 'viewSource', label: '보기: 소스', title: '소스만', scope: 'md' },
  { id: 'viewHybrid', label: '보기: 하이브리드', title: '커서 줄은 원문, 나머지는 렌더 (Obsidian 식)', scope: 'md' },
  { id: 'viewSplit', label: '보기: 분할', title: '소스 + 미리보기', scope: 'md' },
  { id: 'viewPreview', label: '보기: 미리보기', title: '미리보기만', scope: 'md' },
]

export const PANE_COMMAND_IDS: ReadonlySet<string> = new Set(PANE_COMMANDS.map((c) => c.id))

export function paneCommand(id: string): PaneCommand | undefined {
  return PANE_COMMANDS.find((c) => c.id === id)
}
