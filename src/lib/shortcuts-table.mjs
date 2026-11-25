/**
 * JayDocs 단축키 표 — 한 곳에서 관리한다.
 * 앱(명령 팔레트 · 도움말 · 전역 키 처리)과 `SHORTCUTS.md`(`npm run shortcuts` 로 생성)가 같이 읽는다.
 * 순수 데이터라 .mjs 다 (Vite 와 Node 스크립트 둘 다 그대로 import 할 수 있게).
 *
 * keys 표기: `Ctrl+Shift+P`, `Alt+]`, `F1`, `Ctrl+Alt+=` … Mac 에서는 Ctrl 을 ⌘ 로 읽는다.
 * command 가 있으면 전역 키 처리기가 그 명령을 실행한다. 없으면 그 창(그리드·에디터·트리)이 직접 처리하는 키로, 문서용이다.
 * palette 는 그 창이 직접 받는 키의 팔레트 명령 id — 팔레트 · 단추 툴팁에 키를 보이기만 하고 전역 키로는 쓰지 않는다 (lib/paneCommands.ts).
 *
 * @typedef {{ keys: string; label: string; command?: string; palette?: string; note?: string }} Shortcut
 * @typedef {{ scope: string; intro?: string; items: Shortcut[] }} ShortcutGroup
 */

/** @type {ShortcutGroup[]} */
export const SHORTCUTS = [
  {
    scope: '전역',
    intro: '어느 창에 포커스가 있든 동작한다. 브라우저가 가로채는 조합(Ctrl+W, Ctrl+T, Ctrl+N, Ctrl+Tab, Ctrl+숫자)은 피했다.',
    items: [
      { keys: 'Ctrl+Shift+P', label: '명령 팔레트 — 모든 명령을 글자로 찾아 실행', command: 'palette' },
      { keys: 'Ctrl+P', label: '파일 검색 — 파일 이름으로 찾아 열기 (파일 트리 위 🔍 버튼)', command: 'fileSearch' },
      { keys: 'F1', label: '단축키 도움말 — 열리면 검색 칸에 포커스, 글자를 치면 키 · 설명으로 거른다', command: 'help' },
      { keys: 'Ctrl+S', label: '저장', command: 'save' },
      { keys: 'Ctrl+Shift+S', label: '모두 저장', command: 'saveAll' },
      { keys: 'Ctrl+Alt+N', label: '새 문서 창 — 빈 문서 · 예시 · 내 템플릿(_templates/)에서 골라 이름을 넣어 만든다 (트리에서 고른 폴더 아래)', command: 'newFile' },
      { keys: 'Ctrl+Alt+Shift+N', label: '새 폴더 (트리에서 고른 폴더 아래)', command: 'newFolder' },
      { keys: 'Ctrl+Shift+O', label: '폴더 가져오기 — 다른 폴더를 원래 자리에서 @별칭 으로 열기 (해제·읽기 전용은 트리 오른쪽 클릭 또는 팔레트). 파일 탐색기에서 폴더를 파일 트리에 끌어다 놓아도 된다', command: 'importFolder' },
      { keys: 'Ctrl+Alt+I', label: '파일 가져오기 — 파일 하나를 원래 자리에서 @별칭 으로 열기 (그 파일을 고치는 것만 된다). 파일 탐색기에서 파일을 파일 트리에 끌어다 놓아도 된다', command: 'importFile' },
      { keys: 'Ctrl+Alt+D', label: '다크 / 라이트 전환', command: 'toggleTheme' },
      { keys: 'Esc', label: '팔레트 · 도움말 · 대화상자 · 메뉴 · 드롭다운 닫기, 셀 편집 취소' },
    ],
  },
  {
    scope: '대화상자 · 알림',
    intro: '이름 입력(새 파일 · 새 폴더 · 이름 바꾸기)과 확인(지우기 · 저장 안 한 탭 닫기 · UTF-8 로 바꿔 저장)은 앱 대화상자로 뜬다. 떠 있는 동안 전역 단축키는 동작하지 않고, 닫히면 포커스가 열기 전 자리로 돌아간다. 방금 한 동작의 결과와 실패는 오른쪽 아래 알림 줄에 뜬다 — 실패는 닫을 때까지 남는다.',
    items: [
      { keys: 'Enter', label: '확인 — 입력 칸에서는 그대로 확인, 버튼에서는 그 버튼. 지우기 · 버리기처럼 되돌릴 수 없는 확인은 처음 포커스가 취소에 있다' },
      { keys: 'Esc', label: '취소' },
      { keys: 'Tab / Shift+Tab', label: '입력 칸 · 버튼 사이 이동 (대화상자 밖으로 나가지 않는다)' },
      { keys: '← / →', label: '버튼 사이 이동' },
      { keys: 'Ctrl+Alt+X', label: '알림 모두 닫기', command: 'dismissNotices' },
    ],
  },
  {
    scope: '새 문서 창',
    intro: 'Ctrl+Alt+N · 트리의 ＋파일 · 빈 화면의 "새 파일" 로 연다. 포커스는 늘 이름 칸에 있고(기본 이름 "새 문서" 가 선택되어 있다) 처음 선택은 빈 마크다운이라, 이름을 치고 Enter 면 빈 .md 가 생긴다. 확장자는 고른 템플릿을 따르고, 이름 끝에 .txt 처럼 치면 그 형식의 빈 문서로 옮겨 간다. 주 폴더의 _templates/ 바로 아래 파일은 "내 템플릿" 줄에 뜬다 (팔레트의 "현재 문서를 템플릿으로 저장" 으로 넣는다). 떠 있는 동안 전역 단축키는 동작하지 않는다.',
    items: [
      { keys: '↑ / ↓', label: '템플릿 고르기 — 빈 문서 → 예시 → 내 템플릿 줄을 넘어 이어진다 (카드 클릭도 같고, 두 번 누르면 만든다)' },
      { keys: 'Enter', label: '만들기 — 틀린 이름 · 이미 있는 이름이면 닫지 않고 칸 아래에 이유. 한글 조합 중의 Enter 는 조합 확정' },
      { keys: 'Esc', label: '닫기' },
      { keys: 'Ctrl+Alt+N (창이 떠 있을 때)', label: '닫기 — 연 키를 다시 누르면 닫는다' },
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
      { keys: 'Ctrl+Shift+E', label: '파일 트리로 포커스', command: 'focusTree' },
      { keys: 'Ctrl+Shift+M', label: '문서 창(편집기 · 그리드 · 미리보기 전용 모드면 미리보기)으로 포커스 — 열린 문서가 없으면 파일 트리로', command: 'focusEditor' },
      { keys: 'Ctrl+Shift+.', label: '경로 막대로 포커스 — 문서 창 막대의 `루트 › 폴더 › 파일 › 제목` 줄. 마지막 단계(마크다운은 커서가 든 절의 제목, 표는 활성 셀의 열, _Field 는 블록)에서 시작한다. 단계를 마우스로 눌러도 목록이 뜬다', command: 'focusPathBar' },
      { keys: '← / → · Home / End (경로 막대)', label: '단계 옮기기' },
      { keys: 'Enter · ↓ (경로 막대)', label: '그 단계의 목록 — 폴더 · 파일은 같은 폴더의 항목, 마지막 단계는 제목 · 열 · 블록. 글자를 치면 거른다' },
      { keys: 'Enter (경로 막대 목록)', label: '파일은 열고 그 창으로, 폴더는 안으로 들어간다 (→ 도 같다). 제목 · 열 · 블록은 그 자리로 가서 편집기 · 그리드로' },
      { keys: '← · Backspace (경로 막대 목록)', label: '상위 폴더 — 거르는 글자가 없을 때. 루트 위는 주 폴더와 가져온 폴더 목록' },
      { keys: 'Esc (경로 막대)', label: '목록을 닫는다. 목록이 없으면 편집기 · 그리드로 돌아간다' },
      { keys: 'F6', label: '다음 영역으로 포커스 — 파일 트리 → 탭 묶음들 (분할한 창 사이를 옮긴다)', command: 'nextPane' },
      { keys: 'Shift+F6', label: '이전 영역으로 포커스', command: 'prevPane' },
      { keys: 'Ctrl+Shift+V', label: '마크다운 보기 모드 순환: 소스 → 하이브리드 → 분할 → 미리보기', command: 'cycleMdMode' },
      { keys: 'Ctrl+Alt+M', label: '훑어보기 패널 켜기 / 끄기 — .md · .txt 창의 오른쪽에 문서 전체를 축소해 띄운다 (문서 창이 하나일 때만 보인다). 누르면 그 자리로 커서, 상자는 편집기가 보여 주는 범위 — 끌면 스크롤. 다시 그리는 데 오래 걸리는 큰 문서는 자동으로 다시 그리지 않는다 — 패널의 "새로 고침" 또는 팔레트의 "훑어보기 패널 새로 고침"', command: 'toggleSkim' },
      { keys: 'Ctrl+Alt+T', label: '목차로 포커스 — 마크다운 창이 하이브리드 모드일 때 왼쪽에 뜨는 제목 목록(꺼져 있으면 켠다, 목차에서 다시 누르면 편집기로). 지금 보이는 절의 제목이 칠해지고, 누르면 그 제목으로 간다. 보이기 / 숨기기는 창 막대의 "목차" 버튼 또는 팔레트의 "목차 보이기 / 숨기기". 창이 좁으면 숨는다', command: 'focusOutline' },
      { keys: '↑ / ↓ · Home / End · PageUp / PageDown (목차)', label: '제목 고르기' },
      { keys: 'Enter (목차)', label: '고른 제목으로 가서 편집기로 — 제목이 편집기 맨 위에 오고 커서는 제목 글 앞' },
      { keys: 'Space (목차)', label: '고른 제목으로 가고 목차에 남기' },
      { keys: 'Esc (목차)', label: '편집기로 돌아가기' },
      { keys: '← / → (훑어보기 패널 너비 손잡이)', label: '패널 넓히기 / 좁히기 — 손잡이는 패널 왼쪽 가장자리, Shift 를 누르면 크게, Home / End 는 가장 넓게 / 좁게. 팔레트의 "훑어보기 패널 넓히기 / 좁히기" 도 같다' },
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
      { keys: 'Ctrl+Enter', label: '오른쪽 창에 열기 — 분할한 옆 창에(없으면 오른쪽으로 나눈다), 포커스는 그 창. 훑어보기 창 · 폴더 격자의 문서 카드에서도 같고, 훑어보기 창 머리의 "열기" · "오른쪽에 열기" 단추도 같다. 팔레트 "파일 트리 커서의 파일을 오른쪽 창에 열기"', palette: 'openTreeCursorSide' },
      { keys: 'Home / End', label: '처음 / 끝' },
      { keys: 'F2', label: '파일 이름 바꾸기 / 옮기기' },
      { keys: 'Delete', label: '삭제' },
      { keys: 'Shift+F10', label: '오른쪽 클릭 메뉴 — 열리면 첫 항목에 포커스, ↑ / ↓ 이동, Enter 실행, Esc 로 닫고 트리로 돌아간다' },
      { keys: 'Space', label: '훑어보기 — 커서의 파일을 열지 않고 트리 오른쪽에 크게 본다 (폴더면 바로 아래 항목의 썸네일 격자). 포커스는 트리에 남아 ↑ / ↓ 로 넘겨 보고, Space · Esc 로 닫는다. Enter 로 파일을 열면 닫히고, 트리 밖으로 포커스가 가도 닫힌다. 팔레트 "훑어보기" 도 같다' },
      { keys: 'Ctrl+↑ / Ctrl+↓', label: '훑어보기 창 안을 조금씩 위 / 아래로 — 커서는 그대로, 누르고 있으면 이어서 스크롤한다 (창이 없을 때는 ↑ / ↓ 와 같다)' },
      { keys: 'PageUp / PageDown', label: '훑어보기 창 안을 한 화면 위 / 아래로 (마우스 휠도 된다)' },
      { keys: 'Ctrl+= / Ctrl+- (훑어보기 창)', label: '확대 / 축소 — 문서는 글자 크기, 폴더 격자는 카드 크기 (따로 기억한다). Ctrl+휠 · 창 머리의 − ＋ 도 같고, 가운데 숫자를 누르면 100% 로. 창이 없을 때는 브라우저의 페이지 확대 그대로' },
      { keys: 'Shift+방향키 (훑어보기 창)', label: '창 크기 — → / ← 는 너비, ↓ / ↑ 는 높이. 오른쪽 · 아래 가장자리와 모서리를 끌어도 되고, 두 번 누르면 처음 크기. 크기와 배율은 이 브라우저에 남는다 (팔레트 "훑어보기 창 크기 · 배율 처음으로")' },
      { keys: 'Tab (훑어보기 창이 폴더일 때)', label: '폴더 훑어보기 — 폴더의 바로 아래 항목이 썸네일 격자로 뜬다. Tab 으로 격자의 첫 카드에 들어간다 (카드 클릭도 된다). 팔레트 "폴더 훑어보기" 는 트리에서 고른 폴더(루트 포함)로 열고 바로 격자에 들어간다' },
      { keys: '방향키 · Home / End · PageUp / PageDown (폴더 격자)', label: '카드 고르기 — ↑ / ↓ 는 한 줄, Home / End 는 처음 / 끝, PageUp / PageDown 은 한 화면' },
      { keys: 'Enter (폴더 격자)', label: '문서 카드는 열고 창을 닫는다 (편집기로). 폴더 카드는 그 폴더로 들어간다 — 트리 커서도 따라간다. 더블클릭도 같다. 빈 폴더에서는 그 폴더에 새 문서 (읽기 전용으로 가져온 폴더는 이유를 보인다)' },
      { keys: 'Backspace (폴더 격자)', label: '상위 폴더로 (맨 위 단계의 폴더에서는 루트로)' },
      { keys: 'Esc / Shift+Tab (폴더 격자)', label: '트리로 돌아간다 — 창은 열린 채' },
    ],
  },
  {
    scope: '마크다운 (CodeMirror)',
    intro: '표준 편집 키 외에 자주 쓰는 것만. 전체는 CodeMirror 기본 키맵. 보기 모드는 소스 → 하이브리드(커서 줄만 원문) → 분할 → 미리보기 순으로 Ctrl+Shift+V.',
    items: [
      { keys: 'Ctrl+Enter (tsv-view 셀)', label: '미리보기·하이브리드의 tsv-view 에서 선택한 셀을 그리드로 연다. 셀은 더블클릭·Enter·F2 로 그 자리에서 편집, Tab/Enter 로 이동, Delete 로 비움' },
      { keys: '↑ / ↓ · PageUp / PageDown · Home / End · Space (미리보기 전용 모드)', label: '미리보기 스크롤 — 미리보기 전용 모드에서는 미리보기가 포커스를 받는다 (F6 · 탭 이동 · Ctrl+Shift+M 도 미리보기로). Ctrl+Shift+V 로 소스로 돌면 편집기로 돌아온다' },
      { keys: '|||', label: '빈 줄에 치면 빈 표(2열 · 본문 1행)가 된다 — 하이브리드는 머리글 첫 칸, 소스는 그 칸에 커서. 코드 블록 · 표 안은 그대로, Ctrl+Z 한 번이면 친 글자로 돌아간다' },
      { keys: 'Tab / Shift+Tab · Enter / Shift+Enter · ↑ / ↓ (하이브리드 표 칸)', label: '다음 / 이전 칸 (마지막 칸에서 Tab 은 새 행) · 아래 / 위 칸 (마지막 행에서 아래는 표를 떠난다). 칸 글자는 칸 너비에서 줄을 바꾼다. Esc 는 편집기로' },
      { keys: 'Ctrl+Alt+= (표)', label: '아래에 행 넣기 — 하이브리드 표 칸 또는 표 안의 커서 기준 (머리글에서는 본문 첫 행). 그리드와 같은 키, 팔레트 "마크다운 표: …" 도 같다. 위젯 머리의 ＋ 행 · ＋ 열 은 끝에 붙인다' },
      { keys: 'Ctrl+Alt+Shift+= (표)', label: '오른쪽에 열 넣기' },
      { keys: 'Ctrl+Alt+- (표)', label: '행 지우기 (머리글 행은 못 지운다)' },
      { keys: 'Ctrl+Alt+Shift+- (표)', label: '열 지우기 (하나 남은 열은 못 지운다)' },
      { keys: 'Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z', label: '되돌리기 / 다시 실행 (다시 실행은 둘 중 아무거나)' },
      { keys: 'Ctrl+F', label: '찾기 — 편집기 위에 찾기 패널 (바꾸기도)' },
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
      { keys: '열 글자 드래그', label: '열 옮기기 — 놓을 자리에 세로선. 고른 여러 열 안에서 끌면 함께 옮긴다 (묻지 않고 옮기고, 알림의 되돌리기나 Ctrl+Z 로 되돌린다)' },
      { keys: 'Ctrl+C / Ctrl+X / Ctrl+V', label: '복사 / 잘라내기 / 붙여넣기 — 범위는 TSV 블록으로, Sheets·Excel 과 호환. 한 셀을 복사해 범위에 붙이면 범위가 그 값으로 채워진다. 마크다운 표·미리보기 표를 붙이면 머리글은 머리글 행으로, 모자라는 열·행은 늘린다' },
      { keys: 'Delete / Backspace', label: '선택한 셀 비우기' },
      { keys: 'Ctrl+D', label: '아래로 채우기 (범위의 첫 행을 아래로, 한 행이면 위 행에서)' },
      { keys: 'Ctrl+R', label: '오른쪽으로 채우기' },
      { keys: '채우기 핸들 드래그', label: '범위 오른쪽 아래 네모를 끌어 채우기 — 값 무늬를 되풀이, 끄는 방향으로 숫자 2칸 이상이 등차면 수열을 잇는다' },
      { keys: 'Ctrl+F', label: '찾기 — 그리드 위에 찾기 막대 (활성 셀 값이 짧으면 미리 채운다)', palette: 'gridFind' },
      { keys: 'Ctrl+H', label: '찾기 / 바꾸기 — 막대의 바꾸기 칸으로', palette: 'gridReplace' },
      { keys: 'F3 / Shift+F3', label: '다음 / 이전 찾기' },
      { keys: 'Enter / Shift+Enter (찾기 막대)', label: '다음 / 이전 찾기, Esc 로 막대를 닫고 그리드로' },
      { keys: 'Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z', label: '되돌리기 / 다시 실행 (문서 단위, 다시 실행은 둘 중 아무거나)' },
      { keys: 'Space', label: 'bool 셀 켜기 / 끄기' },
      { keys: 'Ctrl+Alt+=', label: '아래에 행 삽입 (선택한 행 수만큼)', palette: 'gridRowBelow' },
      { keys: 'Ctrl+Alt+-', label: '선택한 행 삭제', palette: 'gridRowDel' },
      { keys: 'Ctrl+Alt+Shift+=', label: '오른쪽에 열 삽입 (묻지 않는다 — 알림의 되돌리기나 Ctrl+Z)', palette: 'gridColRight' },
      { keys: 'Ctrl+Alt+Shift+-', label: '선택한 열 삭제 (묻지 않는다 — 알림의 되돌리기나 Ctrl+Z)', palette: 'gridColDel' },
      { keys: 'Ctrl+Shift+D', label: '행 복제', palette: 'gridRowDup' },
      { keys: '↓ / ↑ (enum 드롭다운)', label: '후보 고르기, Enter 로 확정' },
      { keys: 'F9', label: '계산식 적용 — 같은 폴더 `X_Calc.tsv` 의 식을 평가해 값 열에 써 넣는다 (바뀔 셀은 미리 노란 밑줄)', command: 'calc' },
      { keys: 'Ctrl+Alt+E', label: 'C# DTO 내보내기 — 표의 머리글로 DTO 클래스(.cs)를 만든다. 정수 열은 int, 실수 열은 float, 나머지는 string. 처음에만 경로를 묻고(파일 이름이 클래스 이름) 그 뒤로는 묻지 않고 덮어쓴다 — 경로를 바꾸려면 팔레트의 "C# DTO 내보내기 — 경로 · 클래스 이름 바꾸기"', command: 'exportDto' },
    ],
  },
  {
    scope: '팔레트 · 파일 검색',
    intro: '검색어가 없으면 최근에 팔레트로 실행한 명령 · 최근에 연 파일이 위에 온다("최근" 표시). 팔레트 · 파일 검색 · 도움말 · 폴더 가져오기 같은 창이 떠 있는 동안에는 대화상자와 같이 전역 단축키(저장 · 창 이동 · 탭 닫기 …)가 동작하지 않는다.',
    items: [
      { keys: '글자 입력', label: '필터 (띄어쓰기 없이 글자 순서만 맞아도 찾는다). 순위가 같으면 최근 것이 먼저' },
      { keys: '↑ / ↓', label: '항목 이동' },
      { keys: 'Enter', label: '실행 / 열기' },
      { keys: 'Esc', label: '닫기' },
      { keys: 'Ctrl+Shift+P / Ctrl+P / F1 (창이 떠 있을 때)', label: '그 창을 연 키를 다시 누르면 닫는다. 팔레트 · 파일 검색 · 도움말끼리는 서로의 키로 바로 넘어간다 (폴더 가져오기는 Ctrl+Shift+O 로 닫는다)' },
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
