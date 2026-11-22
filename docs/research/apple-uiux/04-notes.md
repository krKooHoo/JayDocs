# 04. Apple 메모(Notes) — UI/UX 조사

조사일 2026-11-22. 대상은 Mac 의 메모 앱(macOS 26 Tahoe 기준, 2026 가을의 macOS 27 변화는 따로 표시), iPad · iPhone 은 참고.
표기: **[공식]** Apple 문서에서 확인, **[리뷰]** 언론 기사, **[해석]** 내 해석, **[확인 못 함]** 찾지 못함.

## 1. 한 줄 요약

메모는 "폴더 → 목록 → 본문" 3단 레이아웃에 저장 버튼 · 파일 이름 · 형식 선택이 없는 문서 모델을 얹은 앱이다. 쓰는 사람이 정리 수고를 거의 안 들이게 (첫 줄=제목, 날짜순 자동 정렬, 고정, 태그, 스마트 폴더, 검색) 만들었고, JayDocs 는 그중 **본문 안의 구조 도구(접는 제목 · 링크 · 서식 발견성)** 와 **목록 보기(갤러리) · 고정 · 태그형 모음** 을 가져올 만하다.

## 2. 개요

- **무엇**: iCloud 로 동기화되는 Apple 의 기본 메모 앱. 글 · 체크리스트 · 표 · 사진 · PDF · 스캔 · 손글씨 · 오디오 녹음(전사) · 수식(Math Notes)을 한 노트에 섞는다. [공식] <https://support.apple.com/guide/notes/welcome/mac>
- **누구를 위한 것**: 가볍게 적고 나중에 찾는 일반 사용자. 문서 편집기가 아니라 "모아 두는 곳" 이다. [해석]
- **저장 모델**: 노트는 파일이 아니라 계정(iCloud / 이 Mac) 안의 DB 항목이다. Markdown 은 가져오기 · 내보내기로만 오간다.
- **2025~2026 변화**
  - macOS 26 Tahoe(2025-06 발표): 노트를 Markdown 파일로 **가져오기 · 내보내기**. Apple 보도자료에 한 줄로 나온다. [공식] <https://www.apple.com/newsroom/2025/06/macos-tahoe-26-makes-the-mac-more-capable-productive-and-intelligent-than-ever/>
  - 지금 Mac 사용 설명서의 "가져오기 · 내보내기" 쪽: 가져오기는 `File > Import to Notes`(Markdown · TXT · RTF · RTFD · HTML · ENEX), 폴더를 고르면 안의 텍스트 파일을 한꺼번에, "폴더 구조 유지" 옵션이 있다. 내보내기는 노트 하나를 `File > Export To` 로 PDF 또는 Markdown. 선택한 부분은 `Edit > Copy as Markdown`. [공식] <https://support.apple.com/guide/notes/import-export-and-print-notes-not201900c07/mac>
  - 가져온 Markdown 은 **서식 있는 글로 바뀌어 들어온다**. 메모는 입력 중에 Markdown 기호를 보여 주지 않는다. 표 · 체크리스트 · 첨부 · 프런트매터가 어떻게 되는지는 공식 문서에 없고, 사용자 후기에 체크박스가 안 된다는 말이 있다. [리뷰] <https://www.macrumors.com/how-to/ios-import-export-markdown-apple-notes/> (MacStories 의 시험 기사는 403 으로 못 읽었다 — [확인 못 함])
  - iOS 27 개발자 베타(2026-06): "Copy as Markdown", Markdown 붙여넣기, 구분선 삽입, 노트 안 **섹션 링크**. [리뷰] <https://www.macrumors.com/2026/06/17/ios-27-apple-notes-app-new-features/> macOS 27 에는 그리기 도구가 늘었다. [리뷰] <https://www.macrumors.com/2026/09/17/new-features-changes-macos-27/> (WWDC 2026 의 Apple 보도자료는 확인 못 함)
  - Liquid Glass 는 메모에서 절제되어 적용됐다는 평이 있다. [리뷰] <https://www.macrumors.com/guide/ios-26-notes-app-reminders-app/>

## 3. 디자인 철학

Apple 이 메모에 대해 철학을 직접 쓴 문서는 **찾지 못했다**([확인 못 함]). 아래는 공식 문서의 사실과 HIG 원칙에서 읽어 낸 것이다.

**공식으로 확인되는 것**
- 첫 줄이 제목이 되고 "저장은 자동" 이다. [공식] <https://support.apple.com/guide/notes/create-and-edit-notes-not9474646a9/mac>
- 기본 정렬은 "최근에 고친 순", 날짜 묶음(오늘 · 어제 · 지난 30일)도 설정이다. [공식] <https://support.apple.com/guide/notes/view-your-notes-apd8b73d28be/mac>
- HIG 사이드바: 계층은 두 단계까지, 사용자가 내용을 바꿀 수 있게, 숨길 수 있되 기본으로 숨기지 않는다. 깊은 구조는 split view 에 목록을 둔다. [공식] <https://developer.apple.com/design/human-interface-guidelines/sidebars>
- HIG Split view: 각 창에서 현재 선택을 계속 강조, 숨긴 창을 보이는 방법을 여럿(버튼 · 메뉴 · 키) 제공. [공식] <https://developer.apple.com/design/human-interface-guidelines/split-views>
- HIG 검색: 중요하면 주된 자리에, 검색 범위를 화면에 표시, 제안(최근 검색 등) 제공. HIG 가 예로 드는 앱이 메모다. [공식] <https://developer.apple.com/design/human-interface-guidelines/searching>
- HIG 되돌리기: 메뉴 이름에 결과를 적고("Undo Typing"), 화면 밖 변화는 그 자리로 스크롤해 보여 준다. [공식] <https://developer.apple.com/design/human-interface-guidelines/undo-and-redo>

**해석**
1. **"정리는 나중, 쓰기는 지금."** 파일 이름 · 폴더 · 저장 선택 없이 바로 쓰고, 정리 수단(고정 · 태그 · 스마트 폴더)은 뒤에 붙는다.
2. **한 가지를 여러 길로 찾게 한다.** 폴더 · 태그 · 스마트 폴더 · 검색 · 고정이 같은 노트를 다른 축으로 연다. 폴더가 유일한 위치가 아니다.
3. **서식은 문서 구조로 쓰이게 한다.** 제목 · 소제목이 접는 단위이고 링크 대상(섹션)이 된다.
4. **되돌릴 수 있는 삭제.** 30일 휴지통이 기본이다.

## 4. 핵심 UI/UX 요소

### 4.1 3단 레이아웃 + 갤러리 보기
- **무엇**: 사이드바(계정 · 폴더 · 태그) | 노트 목록 | 노트 본문. `View > Show Sidebar` 로 사이드바를 숨긴다. 목록은 `View > as List` 와 `as Gallery`(큰 미리보기 카드) 중 고른다. 폴더별 노트 수는 `View > Show Note Count`. [공식] 위 "View your notes" · <https://support.apple.com/guide/notes/customize-how-notes-appear-apd000074a4e/mac>
- **동작**: 폴더를 고르면 목록이 바뀌고, 목록에서 고르면 본문이 바뀐다. 갤러리에서는 카드를 더블클릭해야 본문이 열리고, 목록 노트를 더블클릭하면 별도 창이다. [공식]
- **왜 좋은가**: 훑기(목록/카드)와 쓰기(본문)가 한 화면에서 분리된다. 창 크기에 따라 단을 접을 수 있다(HIG 의 숨기기 원칙). [해석]

### 4.2 첫 줄이 제목 · 저장 버튼 없음
- **무엇 / 동작**: 새 노트의 첫 줄이 목록의 제목이다. 저장은 자동이고 저장 버튼 · 파일 이름 대화상자가 없다. 첫 줄의 서식(Title · Heading 등)은 설정 `New notes start with` 로 고른다. [공식]
- **왜 좋은가**: 이름 짓기 장벽이 없다. 대신 파일 시스템 이름과 제목이 분리되는 것이 비용이다(JayDocs 는 파일 이름이 곧 정체성이라 그대로는 못 쓴다, §6).

### 4.3 폴더 · 스마트 폴더 · 태그
- **폴더**: 계정 아래 폴더, 폴더를 다른 폴더에 끌어 넣어 하위 폴더. "모든 노트" 는 자동 폴더. 폴더를 지우면 노트가 최근 삭제됨으로 간다. [공식] <https://support.apple.com/guide/notes/add-and-remove-folders-apd558a85438/mac>
- **태그**: 본문에 `#회의록` 처럼 치면 붙는다(한 단어, `-` `_` 허용). 사이드바 아래쪽 "Tags" 에 모이고, 여러 태그를 누르면 "모두 포함 / 하나라도 포함" 을 고른다. 이름 바꾸기 · 삭제는 우클릭. [공식] <https://support.apple.com/guide/notes/use-tags-apdc88ed7f1d/mac>
- **스마트 폴더**: 조건(태그 · 만든 날 · 고친 날 · 체크리스트 · 멘션 …)을 "모두 / 하나라도" 로 묶은 **저장된 조회**. 노트 자체를 담지 않고 참조만 하므로 지워도 노트는 그대로다. 잠금 · 하위 폴더 · 공유는 안 된다. [공식] <https://support.apple.com/guide/notes/use-smart-folders-apd58edc7964/mac>
- **왜 좋은가**: 태그는 입력이 곧 분류라 비용이 없고, 스마트 폴더는 "내가 정리한 것" 이 아니라 "규칙" 이라 노트가 늘어도 유지가 쉽다. 단, 태그가 든 노트는 잠글 수 없다. [공식]

### 4.4 검색
- **무엇 / 동작**: 본문 · 첨부 파일 이름 · 첨부 PDF 본문 · 손글씨 · 스캔 문서 · 이미지 속 사물("bike")까지 찾는다. "지난주 만든 노트" 같은 자연어도 된다. 범위는 현재 계정 / 모든 계정을 고르고, 검색창을 누르면 제안(공유된 노트 · 첨부 있는 노트)이 뜬다. 잠긴 노트는 제목만, 최근 삭제됨도 결과에 든다. 한 노트 안의 찾기는 별도(`Command-F`). [공식] <https://support.apple.com/guide/notes/search-your-notes-not18ab658ed/mac>
- **왜 좋은가**: 검색 범위가 화면에 보이고(HIG), 빈 검색창에서 이미 쓸 만한 제안이 나온다. 찾기가 정리를 대신하는 앱이라 이 부분이 핵심이다. [해석]

### 4.5 고정(pin)
- **무엇 / 동작**: `File > Pin Note` 또는 노트를 오른쪽으로 쓸어 핀 버튼. 고정 노트는 목록 맨 위 "Pinned" 구역에 늘 있고, 구역 사이를 끌어 옮길 수 있다. 기기 사이에서 동기화. 최근 삭제됨 노트는 고정 불가. [공식] <https://support.apple.com/guide/notes/sort-and-pin-notes-apdb54e469b6/mac>
- **왜 좋은가**: 폴더 이동 없이 "지금 자주 쓰는 것" 을 올린다. 정렬 규칙과 독립이라 규칙을 안 건드린다. [해석]

### 4.6 체크리스트 · 표
- **체크리스트**: 툴바 버튼 또는 서식 메뉴. 원을 눌러 체크. 설정에서 "체크한 항목을 아래로 자동 정렬", `Check All / Uncheck All`, 항목 순서는 키 또는 끌기. 목록은 `*` `-` `1.` 뒤 Space 로 바로 시작한다. [공식] <https://support.apple.com/guide/notes/add-lists-apd93c815aa0/mac>
- **표**: 툴바 `Add a Table`, 처음엔 2×2. 글 문단을 골라 표로 바꾸거나 `Convert to text` 로 되돌린다. 표 안 이동 키가 따로 있다. [공식] <https://support.apple.com/guide/notes/add-a-table-apd0a136b9cc/mac>
- **왜 좋은가**: 입력 기호(`*` `-`)가 Markdown 과 같아 쓰는 손이 같다. 표는 "변환" 이 양방향이라 실수를 덜 두려워한다. [해석]

### 4.7 접을 수 있는 제목 섹션 · 서식 메뉴 · 블록 인용
- **무엇 / 동작**: 서식 버튼(`Format Text`) → 문단 스타일: Heading · Subheading(**접기/펴기 버튼이 생긴다**), 블록 인용, 목록 등. `Title`/`Body` 이름은 단축키 문서에 나온다. 첫 줄 이후 Heading 을 쓰면 그 아래가 접히는 단위가 된다. 구분선은 `Insert Divider Line`. 서식은 모두 툴바 · 메뉴 · 단축키 세 길로 닿는다. [공식] <https://support.apple.com/guide/notes/format-notes-apd1955d3b21/mac> ("Aa" 라는 이름은 이 페이지에 없다 — iPhone · iPad 의 서식 버튼 이름으로 알려져 있으나 Mac 문서에서는 [확인 못 함])
- **왜 좋은가**: 긴 노트를 제목 단위로 접어 개요처럼 본다. 목차 패널을 따로 두지 않고 문서 자체가 개요가 된다. [해석]

### 4.8 빠른 메모(Quick Note)
- **무엇 / 동작**: `Fn/Globe+Q` 또는 화면 모서리(기본 오른쪽 아래)에서 어느 앱에서든 작은 창이 뜬다. Safari 에서는 `Share > Add to Quick Note` 로 링크를 붙이고 모서리에 썸네일이 남는다. "Quick Notes" 폴더는 빠른 메모가 생긴 뒤에만 보인다. 잠금은 안 된다. [공식] <https://support.apple.com/guide/notes/create-a-quick-note-apdf028f7034/mac>
- **왜 좋은가**: "기록 시작까지의 클릭 수" 를 0 에 가깝게. 폴더 선택 없이 쓰고 나중에 옮긴다. [해석]

### 4.9 링크 (백링크는 확인 못 함)
- **무엇 / 동작**: 본문에 `>>` 를 치고 노트 제목을 고르면 노트 링크, `/` 로 그 노트 안의 섹션까지 고른다(`Edit > Add Link`, Command-K). 대상 노트 이름을 바꾸면 제목으로 만든 링크는 갱신된다. 백링크 화면은 공식 문서에서 **확인 못 함**. [공식] <https://support.apple.com/guide/notes/add-links-apde615d29c2/mac>
- **왜 좋은가**: 입력 중에 `>>` 한 번으로 링크가 되어 흐름이 끊기지 않는다. [해석]

### 4.10 최근 삭제됨(휴지통)
- **무엇 / 동작**: 지운 노트는 30일 "Recently Deleted" 에 머문다. 폴더는 지운 노트가 있을 때만 사이드바에 나타난다. 다른 폴더로 끌어 놓으면 복구. iCloud 는 30일 뒤 기기에서 사라지고 40일 뒤 영구 삭제. 노트 내용을 전부 지워 영구 삭제도 가능. 검색에는 포함, 고정은 불가. [공식] <https://support.apple.com/guide/notes/delete-a-note-not5585d71a8/mac>
- **왜 좋은가**: 삭제 확인 창 없이도 안전하다. "되돌리기가 있어서 묻지 않는다" 는 모델이다. [해석]

### 4.11 공유 · 잠금
- **공유**: `Share > Send a Copy`(정지된 사본) 와 `Share a Link`(같이 편집). 권한은 편집 / 보기 · 내려받기, 링크 접근은 "고른 사람 / 링크가 있는 누구나". 폴더 단위 공유, `@` 멘션, 활동 기록 표시. [공식] <https://support.apple.com/guide/notes/share-notes-and-collaborate-apd4e6e2c9a6/mac>
- **잠금**: 로그인 암호 또는 별도 암호(+Touch ID). 잠긴 노트는 목록에 제목만 보이고 사용 후 자동으로 다시 잠긴다. 공유 노트 · 오디오/PDF/동영상 첨부 · 태그 든 노트는 잠글 수 없다. 암호를 잊으면 Apple 도 복구 못 한다. [공식] <https://support.apple.com/guide/notes/lock-your-notes-not28c5f5468/mac>
- **JayDocs 와의 거리**: 로컬 파일 앱이라 둘 다 해당 없음(§6).

### 4.12 빈 상태
- 빈 창 자체의 문구 · 화면은 공식 문서에서 **확인 못 함**. 확인되는 것은 **필요가 생기기 전에는 폴더를 보이지 않는다**는 점(Recently Deleted · Quick Notes · 태그). [공식 · 해석] 빈 상태를 "안내 문구" 가 아니라 "구조가 안 보임" 으로 처리한다.

### 4.13 단축키를 보여 주는 방식 (목록은 조사 제외)
- 사용 설명서의 단축키 쪽은 General · Edit notes · Navigate in tables 로 묶은 2열 표이고 제스처(쓸기)도 같은 표에 둔다. [공식] <https://support.apple.com/guide/notes/keyboard-shortcuts-and-gestures-apd46c25187e/mac>
- 앱 안에서는 **메뉴 항목 옆에 단축키가 나란히 표시**되는 macOS 관행이 발견 통로다. 툴바 버튼 · 메뉴 · 키가 같은 명령을 가리킨다. [해석]
- JayDocs 는 이미 F1 도움말 · 팔레트가 있어 이 부분은 충분하다.

## 5. JayDocs 에 가져올 만한 것

JayDocs 의 지금 UI: 파일 트리 · 탭/분할 · 팔레트(`Ctrl+Shift+P`) · 파일 검색(`Ctrl+P`) · 새 문서 창 · 4가지 md 보기 모드 · 하이브리드 목차(`Ctrl+Alt+T`) · 훑어보기 창/폴더 썸네일 격자(트리 `Space`) · 알림줄.

| 요소 | 우선순위 | JayDocs 의 어느 화면 | 웹 PWA 구현 방법 | 주의 |
|---|---|---|---|---|
| **목차에서 제목 접기** (메모의 접는 Heading) | **높음** | 하이브리드 목차 · 에디터. HANDOFF 에도 "절 접기" 후보로 남아 있다 | CodeMirror 6 `foldService` + `foldGutter`/`codeFolding` 로 `#` 제목 아래 범위를 접고, 목차 항목 옆에 접기 표시. 단축키는 CM 기본(`Ctrl+Shift+[`) 을 표에 올림 | 접힘은 화면 상태일 뿐 파일을 바꾸지 않는다. 접힌 상태를 복원할지(저장) 정할 것 |
| **폴더 훑어보기 갤러리 → 목록/카드 전환** | **높음** | 폴더 훑어보기 격자(이미 있음) · 트리 | 격자 · 목록 두 보기 토글과 정렬(이름 · 수정일) · 날짜 묶음 머리글("오늘 · 어제 · 지난 30일") 추가 | 수정 시각은 `File.lastModified` 로 충분. 큰 폴더는 가상화 필요(이미 썸네일 로딩이 있음) |
| **고정(Pinned)** | **높음** | 파일 트리 위쪽 구역 · 파일 검색 · 팔레트 | 고정 경로 목록을 localStorage(작업 공간별)에 저장하고 트리 맨 위 "고정" 줄로 표시, 팔레트 "파일 고정/해제" | 파일 이름 바꾸기 · 이동 시 고정 경로 갱신 필요. 가져온 폴더(`@별칭`)의 경로도 구분해 저장 |
| **파일 검색의 빈 입력 제안** (최근 · 고정 · 범위 표시) | 중간 | `Ctrl+P` 파일 검색 | 입력 전에 "고정 → 최근" 순 표시(이미 최근 기록 있음), 검색 범위 칩(현재 폴더 / 전체) 추가 | HIG 가 말하는 "범위를 화면에 보인다" 와 같다. 본문 검색은 별도 기능(HANDOFF 의 `Ctrl+Alt+F` 후보)이고 이 표의 범위가 아니다 |
| **본문 검색 + 스마트 폴더형 저장 검색** | 중간 | 새 전체 검색 창 | 폴더 전체를 읽어 문자열 색인(메모리) → 결과 목록. 저장된 조회는 localStorage 에 `조건` 만 저장하고 트리의 "저장된 검색" 구역으로 | 스마트 폴더는 **조회를 저장**하는 개념이라 파일 모델과 충돌하지 않는다. 대량 폴더의 색인 비용, 읽기 전용 · 비UTF-8 파일 제외 |
| **태그형 모음** (`#태그` 를 본문에서 수집) | 중간 | 트리 아래 "태그" 구역 · 검색 | 본문 `#단어` 를 정규식으로 모아 사이드 구역 · 필터. 코드 블록 · 제목 `#` 은 제외 | Markdown 의 `# 제목` 과 `#태그` 가 섞이므로 `#` 뒤 공백 유무 규칙을 못박을 것. 태그 형식을 파일에 새로 강제하지 않는다 |
| **노트 링크 `>>` 입력 보조** | 중간 | 에디터 자동완성 | `>>` 를 치면 폴더 안 문서 후보 창(CM6 autocompletion), 고르면 `[제목](상대경로)` 삽입. `/` 로 대상의 제목 고르기 | 결과는 표준 Markdown 링크여야 한다(이식성). 파일 이름을 바꾸면 링크가 깨지는 문제는 메모처럼 갱신해 주지 못한다 — 백링크 · 링크 갱신은 별도 기능이라 따로 판단 |
| **체크리스트 편의** (체크한 항목 아래로 정렬, 전체 체크/해제) | 낮음 | 하이브리드의 할 일 체크박스 | 해당 목록 블록만 대상으로 하는 명령을 팔레트에 | 파일의 줄 순서를 바꾸는 편집이므로 되돌리기 알림과 함께. 자동 정렬은 "항상" 이 아니라 명령으로만 |
| **서식 메뉴의 발견성** | 낮음 | md 창 막대 | 제목 · 인용 · 목록 · 표를 한 드롭다운에 단축키와 같이 표시(메뉴 옆에 키를 적는 macOS 관행). 이미 팔레트 · F1 이 있어 필요가 작다 | 글자 키 단독 단축키 금지 규칙 유지 |
| **되돌리기 이름 표시** (HIG: "Undo Typing") | 낮음 | 알림 줄의 되돌리기 | 알림 문구에 "열 삭제를 되돌립니다" 처럼 결과를 적고, 되돌린 뒤 그 위치로 스크롤 | 이미 알림 되돌리기가 있어 문구 정리 수준 |
| **빈 상태 정리**: 쓸 일이 생기기 전에는 구조를 안 보임 | 낮음 | 트리의 빈 구역 · 가져온 폴더 | `_templates/` 처럼 파일이 있을 때만 구역을 보인다(이미 그렇게 동작) | 빈 상태의 안내 문구는 Apple 문서에서 확인 못 함 — 근거 없이 따라 만들지 않는다 |

## 6. 맞지 않아 가져오지 않을 것과 이유

JayDocs 는 **사용자의 실제 폴더 안 `.md` 파일을 그대로** 편집한다. 노트 DB · 계정 · 클라우드가 없다.

| 요소 | 이유 |
|---|---|
| **첫 줄이 제목이 되는 모델** | 파일 이름이 정체성이고 트리 · 별칭 · 링크 · Git 이 그것에 의존한다. 제목만 보이게 하는 "표시" 로는 쓸 수 있으나(훑어보기 카드) 이름 바꾸기를 대신할 수 없다 |
| **저장 버튼 없는 완전 자동 저장** | `CLAUDE.md` 의 계약(바꾼 셀의 행만 diff, 외부 변경 충돌 배너, 저장 확인) 과 충돌한다. 사용자가 Git 에 올리는 파일이라 의도하지 않은 저장은 위험하다. 지금의 `Ctrl+S` 와 저장 확인이 맞다 |
| **폴더를 가상으로 만드는 모음 · 노트가 여러 폴더에** | 실제 폴더 구조가 곧 위치다. 가상 폴더는 "스마트 폴더형 저장 검색"(§5)까지만 |
| **계정 · iCloud 동기화 · 공유 링크 · 공동 편집 · 멘션 · 활동 기록** | 서버가 없다. 동기화는 사용자의 폴더 동기화 도구(OneDrive · Git 등)의 몫 |
| **잠금(암호 노트)** | 파일을 암호화하면 평문 `.md` · TSV 계약이 깨지고 다른 도구가 못 읽는다. 공개 리포 규칙과도 맞지 않는다 |
| **최근 삭제됨 30일 휴지통** | File System Access API 는 OS 휴지통으로 보내지 못하고 `removeEntry` 는 영구 삭제다. 앱이 만드는 `.trash/` 는 사용자의 폴더에 흔적을 남긴다. 지금처럼 **삭제 전 확인 대화상자**가 안전하다. 넣는다면 별도 결정(DESIGN)이 필요한 큰 일이라 이 보고서에서는 가져올 것 목록에 넣지 않는다 |
| **손글씨 · 그리기 · 스캔 · 오디오 전사 · Math Notes · Writing Tools** | 이 앱의 문서 형식이 아니다(텍스트 중심) |
| **Markdown 을 서식 있는 글로 바꾸는 가져오기** | JayDocs 는 Markdown 이 원본이라 변환 단계가 없다. 오히려 JayDocs 의 하이브리드 모드가 메모에 없는 장점(기호를 볼 수 있다)이다 |
| **Quick Note(전역 단축키 · 모서리 창)** | 웹 PWA 는 다른 앱 위에 뜨는 창을 못 만든다. 대신 앱 안의 `Ctrl+Alt+N` 이 새 문서 창으로 같은 역할을 한다(빈 문서 바로 만들기) |
| **갤러리의 첨부 중심 카드** | JayDocs 의 카드는 문서 썸네일이라 이미 있다. 첨부 브라우저는 필요 없다 |

## 7. 출처

Apple 공식 (support.apple.com — Mac용 메모 사용 설명서)
- <https://support.apple.com/guide/notes/welcome/mac>
- <https://support.apple.com/guide/notes/get-started-apd441e46563/mac>
- <https://support.apple.com/guide/notes/create-and-edit-notes-not9474646a9/mac>
- <https://support.apple.com/guide/notes/view-your-notes-apd8b73d28be/mac>
- <https://support.apple.com/guide/notes/customize-how-notes-appear-apd000074a4e/mac>
- <https://support.apple.com/guide/notes/format-notes-apd1955d3b21/mac>
- <https://support.apple.com/guide/notes/add-lists-apd93c815aa0/mac>
- <https://support.apple.com/guide/notes/add-a-table-apd0a136b9cc/mac>
- <https://support.apple.com/guide/notes/add-links-apde615d29c2/mac>
- <https://support.apple.com/guide/notes/add-and-remove-folders-apd558a85438/mac>
- <https://support.apple.com/guide/notes/use-tags-apdc88ed7f1d/mac>
- <https://support.apple.com/guide/notes/use-smart-folders-apd58edc7964/mac>
- <https://support.apple.com/guide/notes/sort-and-pin-notes-apdb54e469b6/mac>
- <https://support.apple.com/guide/notes/search-your-notes-not18ab658ed/mac>
- <https://support.apple.com/guide/notes/lock-your-notes-not28c5f5468/mac>
- <https://support.apple.com/guide/notes/share-notes-and-collaborate-apd4e6e2c9a6/mac>
- <https://support.apple.com/guide/notes/delete-a-note-not5585d71a8/mac>
- <https://support.apple.com/guide/notes/create-a-quick-note-apdf028f7034/mac>
- <https://support.apple.com/guide/notes/import-export-and-print-notes-not201900c07/mac>
- <https://support.apple.com/guide/notes/keyboard-shortcuts-and-gestures-apd46c25187e/mac>

Apple 공식 (그 밖)
- <https://www.apple.com/newsroom/2025/06/macos-tahoe-26-makes-the-mac-more-capable-productive-and-intelligent-than-ever/>
- <https://developer.apple.com/design/human-interface-guidelines/sidebars>
- <https://developer.apple.com/design/human-interface-guidelines/split-views>
- <https://developer.apple.com/design/human-interface-guidelines/searching>
- <https://developer.apple.com/design/human-interface-guidelines/undo-and-redo>
  (HIG 본문은 HTML 이 비어 `developer.apple.com/tutorials/data/design/human-interface-guidelines/<쪽>.json` 으로 읽었다)

언론
- <https://www.macrumors.com/how-to/ios-import-export-markdown-apple-notes/>
- <https://www.macrumors.com/2026/06/17/ios-27-apple-notes-app-new-features/>
- <https://www.macrumors.com/2026/09/17/new-features-changes-macos-27/>
- <https://www.macrumors.com/guide/ios-26-notes-app-reminders-app/>

확인 못 함: MacStories 의 Markdown 시험 기사(403), Apple 의 메모 디자인 철학 문서, 빈 상태 화면, 백링크, WWDC 2026 Apple 보도자료의 메모 항목, 갤러리/목록 보기의 세부 옵션(미리보기 줄 수 등).
