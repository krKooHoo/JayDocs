/**
 * JayDocs 단축키 표 — 한 곳에서 관리한다.
 * 앱(명령 팔레트 · 도움말 · 전역 키 처리)과 `SHORTCUTS.md`(`npm run shortcuts` 로 생성)가 같이 읽는다.
 * 순수 데이터라 .mjs 다 (Vite 와 Node 스크립트 둘 다 그대로 import 할 수 있게).
 *
 * keys 표기: `Ctrl+Shift+P`, `Alt+]`, `F1`, `Ctrl+Alt+=` … Mac 에서는 Ctrl 을 ⌘ 로 읽는다.
 * command 가 있으면 전역 키 처리기가 그 명령을 실행한다. 없으면 그 창(그리드·에디터·트리)이 직접 처리하는 키로, 문서용이다.
 *
 * @typedef {{ keys: string; label: string; command?: string; note?: string }} Shortcut
 * @typedef {{ scope: string; intro?: string; items: Shortcut[] }} ShortcutGroup
 */

/** @type {ShortcutGroup[]} */
export const SHORTCUTS = [
  {
    scope: '전역',
    intro: '어느 창에 포커스가 있든 동작한다. 브라우저가 가로채는 조합(Ctrl+W, Ctrl+T, Ctrl+N, Ctrl+Tab, Ctrl+숫자)은 피했다.',
    items: [
      { keys: 'Ctrl+Shift+P', label: '명령 팔레트 — 모든 명령을 글자로 찾아 실행', command: 'palette' },
      { keys: 'Ctrl+P', label: '빠른 열기 — 파일 이름으로 문서 열기', command: 'quickOpen' },
      { keys: 'F1', label: '단축키 도움말', command: 'help' },
      { keys: 'Ctrl+S', label: '저장', command: 'save' },
      { keys: 'Ctrl+Shift+S', label: '모두 저장', command: 'saveAll' },
      { keys: 'Ctrl+Alt+N', label: '새 파일 (트리에서 고른 폴더 아래)', command: 'newFile' },
      { keys: 'Ctrl+Alt+Shift+N', label: '새 폴더', command: 'newFolder' },
      { keys: 'Ctrl+Alt+D', label: '다크 / 라이트 전환', command: 'toggleTheme' },
      { keys: 'Esc', label: '팔레트 · 도움말 · 메뉴 · 드롭다운 닫기, 셀 편집 취소' },
    ],
  },
  {
    scope: '탭 · 패널',
    items: [
      { keys: 'Ctrl+\\', label: '현재 문서를 오른쪽 창에도 연다 (분할)', command: 'split' },
      { keys: 'Alt+]', label: '다음 탭', command: 'nextTab' },
      { keys: 'Alt+[', label: '이전 탭', command: 'prevTab' },
      { keys: 'Alt+1 … Alt+9', label: 'n번째 탭', command: 'tabN' },
      { keys: 'Alt+W', label: '탭 닫기', command: 'closeTab' },
      { keys: 'Ctrl+B', label: '파일 트리 접기 / 펴기', command: 'toggleTree' },
      { keys: 'Ctrl+J', label: 'git 패널 접기 / 펴기', command: 'toggleGit' },
      { keys: 'Ctrl+Shift+E', label: '파일 트리로 포커스', command: 'focusTree' },
      { keys: 'Ctrl+Shift+G', label: 'git 패널(커밋 메시지)로 포커스', command: 'focusGit' },
      { keys: 'Ctrl+Shift+M', label: '문서 창(편집기 · 그리드)으로 포커스', command: 'focusEditor' },
      { keys: 'Ctrl+Shift+V', label: '마크다운 보기 모드 순환: 소스 → 분할 → 미리보기', command: 'cycleMdMode' },
      { keys: 'Ctrl+Shift+F', label: '현재 문서를 HEAD 와 비교 (diff 탭)', command: 'diffActive' },
      { keys: 'Ctrl+Shift+H', label: '현재 문서의 커밋 기록 (git 패널)', command: 'historyActive' },
      { keys: 'Ctrl+Alt+Shift+D', label: 'git 패널의 변경 목록 열기', command: 'toggleGit', note: 'Ctrl+J 와 같다' },
    ],
  },
  {
    scope: '파일 트리',
    intro: '트리에 포커스가 있을 때 (Ctrl+Shift+E 또는 클릭).',
    items: [
      { keys: '↑ / ↓', label: '위 / 아래 항목' },
      { keys: '→', label: '폴더 펼치기 (파일이면 열기)' },
      { keys: '←', label: '폴더 접기 (접혀 있으면 상위 폴더로)' },
      { keys: 'Enter', label: '열기 / 폴더 펼치기·접기' },
      { keys: 'Home / End', label: '처음 / 끝' },
      { keys: 'F2', label: '이름 바꾸기 / 옮기기' },
      { keys: 'Delete', label: '삭제' },
      { keys: 'Shift+F10', label: '오른쪽 클릭 메뉴' },
    ],
  },
  {
    scope: '마크다운 (CodeMirror)',
    intro: '표준 편집 키 외에 자주 쓰는 것만. 전체는 CodeMirror 기본 키맵. 보기 모드는 소스 → 하이브리드(커서 줄만 원문) → 분할 → 미리보기 순으로 Ctrl+Shift+V.',
    items: [
      { keys: 'Ctrl+Enter (tsv-view 셀)', label: '미리보기·하이브리드의 tsv-view 에서 선택한 셀을 그리드로 연다. 셀은 더블클릭·Enter·F2 로 그 자리에서 편집, Tab/Enter 로 이동, Delete 로 비움' },
      { keys: 'Ctrl+Z / Ctrl+Y', label: '되돌리기 / 다시 실행' },
      { keys: 'Ctrl+F', label: '찾기 (패널에서 바꾸기도)' },
      { keys: 'Ctrl+D', label: '같은 단어를 하나 더 선택 (여러 커서)' },
      { keys: 'Alt+드래그', label: '사각형 선택' },
      { keys: 'Ctrl+클릭', label: '커서 추가' },
      { keys: 'Alt+↑ / Alt+↓', label: '줄 옮기기' },
      { keys: 'Shift+Alt+↓', label: '줄 복제' },
      { keys: 'Ctrl+/', label: '주석 토글' },
      { keys: 'Tab / Shift+Tab', label: '들여쓰기 / 내어쓰기' },
    ],
  },
  {
    scope: 'TSV 그리드',
    intro: 'Google Sheets · Excel 의 기본 키를 따른다. 수식은 없다.',
    items: [
      { keys: '방향키', label: '셀 이동' },
      { keys: 'Ctrl+방향키', label: '표 끝으로' },
      { keys: 'Tab / Shift+Tab', label: '오른쪽 / 왼쪽 (편집 중이면 확정 후 이동)' },
      { keys: 'Enter / Shift+Enter', label: '편집 시작, 편집 중엔 확정 후 아래 / 위' },
      { keys: 'F2', label: '기존 값 이어서 편집' },
      { keys: '글자 입력', label: '덮어쓰며 편집 시작 (한글 조합 포함)' },
      { keys: 'Esc', label: '편집 취소 · 범위 선택 해제' },
      { keys: 'Home / End', label: '행의 처음 / 끝 열' },
      { keys: 'Ctrl+Home / Ctrl+End', label: '표의 처음 / 끝' },
      { keys: 'PageUp / PageDown', label: '한 화면 위 / 아래' },
      { keys: 'Shift+방향키', label: '범위 선택 넓히기' },
      { keys: 'Ctrl+Shift+방향키', label: '표 끝까지 범위 선택' },
      { keys: 'Shift+클릭 · 드래그', label: '범위 선택' },
      { keys: 'Ctrl+A', label: '전체 선택' },
      { keys: 'Shift+Space', label: '행 전체 선택' },
      { keys: 'Ctrl+Space', label: '열 전체 선택' },
      { keys: '행 번호 / 열 글자 클릭', label: '행 / 열 선택 (Shift 로 넓히기), 왼쪽 위 모서리는 전체' },
      { keys: '열 글자 드래그', label: '열 옮기기 — 놓을 자리에 세로선. 고른 여러 열 안에서 끌면 함께 옮긴다 (확인을 묻는다)' },
      { keys: 'Ctrl+C / Ctrl+X / Ctrl+V', label: '복사 / 잘라내기 / 붙여넣기 — 범위는 TSV 블록으로, Sheets·Excel 과 호환. 한 셀을 복사해 범위에 붙이면 범위가 그 값으로 채워진다' },
      { keys: 'Delete / Backspace', label: '선택한 셀 비우기' },
      { keys: 'Ctrl+D', label: '아래로 채우기 (범위의 첫 행을 아래로, 한 행이면 위 행에서)' },
      { keys: 'Ctrl+R', label: '오른쪽으로 채우기' },
      { keys: '채우기 핸들 드래그', label: '범위 오른쪽 아래 네모를 끌어 채우기 — 값 무늬를 되풀이, 끄는 방향으로 숫자 2칸 이상이 등차면 수열을 잇는다' },
      { keys: 'Ctrl+F', label: '찾기 — 그리드 위에 찾기 막대 (활성 셀 값이 짧으면 미리 채운다)' },
      { keys: 'Ctrl+H', label: '찾기 / 바꾸기 — 막대의 바꾸기 칸으로' },
      { keys: 'F3 / Shift+F3', label: '다음 / 이전 찾기' },
      { keys: 'Enter / Shift+Enter (찾기 막대)', label: '다음 / 이전 찾기, Esc 로 막대를 닫고 그리드로' },
      { keys: 'Ctrl+Z / Ctrl+Y', label: '되돌리기 / 다시 실행 (문서 단위)' },
      { keys: 'Space', label: 'bool 셀 켜기 / 끄기' },
      { keys: 'Ctrl+Alt+=', label: '아래에 행 삽입 (선택한 행 수만큼)' },
      { keys: 'Ctrl+Alt+-', label: '선택한 행 삭제' },
      { keys: 'Ctrl+Alt+Shift+=', label: '오른쪽에 열 삽입' },
      { keys: 'Ctrl+Alt+Shift+-', label: '선택한 열 삭제' },
      { keys: 'Ctrl+Shift+D', label: '행 복제' },
      { keys: '↓ / ↑ (enum 드롭다운)', label: '후보 고르기, Enter 로 확정' },
    ],
  },
  {
    scope: 'git 패널',
    items: [
      { keys: 'Ctrl+Enter', label: '커밋 (메시지 입력란에서)' },
      { keys: 'Tab', label: '파일 행의 diff · 기록 · 되돌리기 버튼으로 이동' },
    ],
  },
  {
    scope: '팔레트 · 빠른 열기',
    items: [
      { keys: '글자 입력', label: '필터 (띄어쓰기 없이 글자 순서만 맞아도 찾는다)' },
      { keys: '↑ / ↓', label: '항목 이동' },
      { keys: 'Enter', label: '실행 / 열기' },
      { keys: 'Esc', label: '닫기' },
    ],
  },
]

/** SHORTCUTS.md 본문. 생성 스크립트와 테스트가 같이 쓴다 */
export function renderShortcutsMarkdown() {
  const lines = [
    '# JayDocs 단축키',
    '',
    '이 파일은 `src/lib/shortcuts-table.mjs` 에서 `npm run shortcuts` 로 만든다. **직접 고치지 말고 표를 고친 뒤 다시 생성**한다.',
    '앱 안에서는 `F1` 로 같은 내용을 본다. Mac 에서는 `Ctrl` 을 `⌘` 로 읽는다.',
    '',
  ]
  for (const g of SHORTCUTS) {
    lines.push(`## ${g.scope}`, '')
    if (g.intro) lines.push(g.intro, '')
    lines.push('| 키 | 동작 |', '|---|---|')
    for (const s of g.items) {
      const note = s.note ? ` _(${s.note})_` : ''
      lines.push(`| \`${s.keys.replace(/\|/g, '\\|')}\` | ${s.label}${note} |`)
    }
    lines.push('')
  }
  return lines.join('\n')
}
