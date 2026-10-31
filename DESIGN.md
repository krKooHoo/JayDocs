# JayDocs — Markdown + TSV 결합 편집기 설계

작성 2026-10-11 · 상태 **설계 확정 (같은 날 피드백 반영, §13)** · 2026-10-21 폴더 가져오기·형식 확장 추가(§18) · 위치 독립 리포 `JayDocs` (2026-10-25 `JayTools/JayDocs/` 에서 기록째 분리) · 2026-10-31 브라우저 앱 전환(§20)

> 이름: **JayDocs** — "Jay의 문서". Notion·Asana·Google Sheets를 오가던 기획 문서와 데이터를 한곳(git)에 모으는 Jay 전용 Docs라는 뜻.
> 폴더명도 `JayDocs`(리포의 `TeamBuilder`·`MemoryBoard`처럼 PascalCase).

---

## 0. 결론

> **2026-10-31 전환**: 사이드카와 git 기능을 없애고 브라우저 앱(PWA + File System Access)으로 바꿨다 — §20. 아래 §0 · §3.4 · §4 · §9 · §10 은 전환 전 기록이다.

**구현 가능하다.** "Markdown(+Mermaid)과 TSV를 나란히 놓고 편집, 가볍게, git 기반"을 전부 만족하는 기성품은 없다
(기능상 유일하게 다 되는 것은 VS Code + 확장 조합인데 무게가 Obsidian급이다). 필요한 부품은 전부 MIT로 있고,
빠진 부품(TSV 그리드·결합 문법)은 작게 직접 만드는 편이 라이브러리를 고치는 것보다 싸다.

추천 스택 한 줄:

> **Node 사이드카(`node:http`, 의존성 0, 127.0.0.1) + Vite/React 18/TS SPA + CodeMirror 6(마크다운)
> + 자체 DOM 그리드(TSV) + flexlayout-react(탭·분할) + git CLI 위임**

실행 모델은 이 리포의 다른 도구와 같다. `start.cmd` 더블클릭 → 브라우저(Edge 앱 모드) 창 하나.
메모리는 브라우저 탭 하나(50–150 MB) + node 프로세스(30–60 MB). Obsidian(700 MB~)·Notion과는 급이 다르다.

예상 규모: 핵심(Phase 0–2) **약 5–7 작업일**, 결합 기능까지(Phase 3) **약 2주**.

---

## 1. 요구사항

요청 문장을 기능으로 옮겼다. 번호는 아래 계획에서 그대로 쓴다.

### 꼭 (MVP)

| # | 요구 | 출처 |
|---|---|---|
| R1 | 로컬 git 리포 폴더를 열어 `.md` / `.tsv`를 트리에서 골라 연다 | "Git으로 문서 데이터 관리" |
| R2 | 여러 문서를 탭·분할로 **동시에** 열어 편집. 같은 파일을 두 창에 열면 동기화 | "여러 페이지를 동시에 보면서 수정" |
| R3 | Markdown 편집(소스) + 렌더 미리보기 + **Mermaid** 렌더 | "Markdown(mermaid도 사용함)" |
| R4 | TSV를 스프레드시트처럼 셀 편집. **한글 IME**, Sheets 호환 복사/붙여넣기, undo/redo, 행·열 추가/삭제 | "TSV를 동시에 수정", "뷰어가 아니라 편집기" |
| R5 | TSV 저장 시 **바이트 단위 왕복 보존** — 바꾼 셀의 행만 diff에 나온다 | git 관리 전제 |
| R6 | `*_Field.tsv`를 읽어 열 설명 툴팁 · enum 드롭다운 · 타입 검증 · Key 중복 검사 | 첨부 파일 구조 |
| R7 | git: 변경 배지, HEAD 대비 diff, 커밋, 파일 히스토리, 복원 | git 관리 전제 |
| R8 | 다른 프로그램(다른 에디터, `git checkout`/`pull`)이 파일을 바꾸면 감지 | 안전장치 |

### 다음 (v2)

| # | 요구 |
|---|---|
| R9 | 마크다운 안에 TSV 뷰를 **임베드**(`tsv-view` 블록) — 처음엔 읽기, 다음엔 그 자리에서 편집 |
| R10 | TSV → Mermaid 자동 생성(템플릿) |
| R11 | Obsidian식 Live Preview(소스 안에서 렌더되는 하이브리드) |
| R12 | 범위 선택 · 채우기 핸들 · 찾기/바꾸기 · 열 드래그 재정렬 |

### 하지 않음

실시간 협업, 클라우드 동기화, 플러그인 시스템, WYSIWYG 마크다운(diff 오염 — §5 D2), Google Sheets API 직접 연동(현 단계).

---

## 2. 첨부 TSV 실측 → 포맷 규칙

`SAGA-sheet-exports/2026-09-27/` 7개 파일을 바이트 단위로 확인했다.

| 항목 | 관찰 | 설계에 주는 의미 |
|---|---|---|
| 줄바꿈 | **CRLF** (Google Sheets export는 모든 줄이 CRLF — 처음에 LF로 잘못 적었다가 커밋 시 정정) | SagaDocs 리포는 `.gitattributes`(`* text=auto eol=lf`)로 **LF로 정규화**해 둔다. JayDocs는 파일별로 EOL을 감지해 저장 시 그대로 유지하므로(§6.1) 어느 쪽이든 diff가 깨끗하다 |
| BOM | 없음 | 있으면 보존, 없으면 추가하지 않음 |
| 따옴표 | `"` 0개 | Google Sheets TSV는 셀에 탭·줄바꿈이 없으면 따옴표를 쓰지 않는다. **RFC 4180 파서를 쓰지 말고 탭 split만** 한다(따옴표로 시작하는 셀이 오해석되는 사고 방지) |
| 열 수 | 파일 안에서 전 행 동일 — 빈 셀도 탭으로 채워져 있음 | 시트 폭만큼 trailing tab이 있다. 저장 시 열 수를 보존 |
| 타입 행 | 1행 `#string → string → enum → enum → bool → bool → string → byte → byte` | 첫 셀이 `#`로 시작하면 타입 행. 타입: `string / enum / bool / byte / uint / float`. **빈 타입 = 주석 열** |
| 헤더 행 | 2행. `#한국명`, `# 설명`처럼 `#`로 시작하는 헤더도 **주석 열** | 주석 열은 검증 제외·회색 표시, 편집은 가능 |
| 리스트 셀 | `Plains, Hill`(콤마+공백), `Cow[20], Wood[30]`, `Trait명[Key:Value]` | 셀 안 미니 문법. v1은 문자열로 두되 **enum 열의 콤마 리스트는 항목별 검증** (District의 `AllowedTerrain`이 이 경우) |
| Field 시트 | `XxxDef / 설명` 헤더로 시작하는 블록이 빈 줄로 구분되어 여러 개. District_Field는 DistrictDef·BuildingDef·RecipeDef·Trait 4블록 + `Note` 열 | 이름 규칙 `X_Field` ↔ `X_Table`로 짝을 짓는다. Field는 자유 서식이므로 **힌트로만** 쓴다(툴팁·enum 후보). 못 읽으면 기능 저하만, 오류는 아님 |
| enum 후보 | Tile_Field의 `TerrainType / 설명` 블록 아래 행들이 곧 허용 값 | **블록 이름 == 열 이름**이면 그 블록 1열을 enum 후보로 |
| 한글 | 설명·주석 열 다수 | 셀 편집 IME가 필수 요구 |
| 크기 | 최대 18열 × 109행(Building) | 수천 행까지는 DOM 그리드로 충분. 캔버스 그리드 불필요 |

### 파일 이름 짝짓기

`Tile_Table.tsv` ↔ `Tile_Field.tsv` : `_Table` ↔ `_Field` 치환(같은 폴더, 접두가 있어도 같은 규칙).
Field 블록 `TileDef`는 `Tile_` 접두와 매칭한다. 짝이 없으면 타입 행만으로 검증한다.

이 §2 규칙이 **그대로 계약**이다. 게임 임포터에 맞출 필요가 없다는 것이 §13-2에서 확인됐다.

---

## 3. 레퍼런스 조사 요약

네 갈래로 조사했다(기성품 / 마크다운 에디터 / TSV 그리드 / 셸·git·레이아웃 / 결합 문법). 상세 출처는 §15.

### 3.1 기성품으로 되나 (buy vs build)

| 도구 | 무게 | 멀티 페인 | Mermaid | TSV 편집 | git |
|---|---|---|---|---|---|
| **VS Code + Edit CSV + Markdown Preview Mermaid** | Electron 300–500 MB | ◎ | ◎ | ○ (외부 변경 미반영, 1 MB↑ 취약) | ◎ |
| SilverBullet 2.12 | Rust 서버 + PWA (가벼움) | ✗ | △ 코드위젯 API | ✗ | ○ |
| Zettlr / MarkText / Typora | Electron | △ | ◎ | ✗ | ✗ |
| Logseq / SiYuan / Trilium / AFFiNE / Anytype | Electron + 자체 DB | △ | ○ | 블록 표 | ✗ |
| Dendron(중단) / Foam | VS Code 확장 | VS Code | 확장 | 확장 | VS Code |

**결론**: 전부 되는 것은 VS Code 조합뿐인데 거부 기준(무게)에 걸린다. 자작이 정당하다.
단, 착수 전에 VS Code 조합을 하루 써 보고 무게를 실측해 볼 가치는 있다(비용 0).

### 3.2 마크다운 에디터

| 라이브러리 | 엔진 | 라운드트립 | Mermaid | 한글 IME | 판정 |
|---|---|---|---|---|---|
| **CodeMirror 6** (+lang-markdown) | 소스 | **무손실** (텍스트 = 모델) | 코드펜스 블록 위젯 | 조합 수정 30건+, open 1건(Safari) | **1순위** |
| MDXEditor 4.3 | Lexical 0.48 고정 | 정규화(mdast 재직렬화) | 커스텀 코드블록 | Lexical 수정 반영 지연 | 2순위 |
| Milkdown 7.22 | ProseMirror + remark | 정규화, 이스케이프 버그 | 플러그인 폐기 | PM 상속 | 3순위 |
| TipTap 3.31 + @tiptap/markdown | ProseMirror + marked | open 버그 57건 | 직접 | Enter 시 글자 소실 등 | 비권고 |
| Vditor 4.0 | Lute | 정규화 | 내장 | 2020 closed | 차선 |
| Monaco / Toast UI | — | — | 불가 / archived | — | 탈락 |

**핵심**: WYSIWYG 세 계열(ProseMirror·Lexical·Slate)은 모두 "파일 → AST → 파일" 재직렬화를 거쳐
**건드리지 않은 줄까지 diff에 나온다.** 한글 조합은 마크 경계·Enter에서 깨지는 이슈가 2026년에도 열려 있다.
CodeMirror 6는 두 문제를 구조적으로 피한다(Obsidian Live Preview도 CM6 위에서 돈다).
CM6 위에 하이브리드 렌더를 얹는 React 베이스로 `@atomic-editor/editor`(MIT, 154★)가 있고,
Mermaid 위젯 참고 구현은 `codemirror-markdown-hybrid`(MIT)에 있다.

### 3.3 TSV 그리드

| 라이브러리 | 라이선스 | 한글 IME | 범위 복붙 | 검증/드롭다운 | Undo | 판정 |
|---|---|---|---|---|---|---|
| Glide Data Grid 6.0 | MIT | ⚠ type-to-edit에서 첫 자모 유실(#1175 무응답) | ◎ | ◎ | ✗ | 라이브러리 중 1위 |
| RevoGrid 4.28 | MIT core | △ 직접 검증 필요 | ◎ | ○ | Pro 유료 | 2위 |
| react-datasheet-grid 4.11 | MIT | ✗ #340 open | ◎ | △ | ✗ | fork 전제 |
| react-data-grid 7 beta | MIT | ✗ #1702 (2019~) | △ 범위 선택 없음 | △ | ✗ | 탈락 |
| Handsontable 18 | **비상업만 무료** | ◎ | ◎ | ◎ | ◎ | 라이선스 탈락 |
| AG Grid / MUI X Community | MIT | ○ | **유료 티어** | ○ | 유료 | 탈락 |
| jspreadsheet CE | MIT | ✗ "PRO만 지원" | ◎ | ◎ | ○ | 탈락 |
| Univer / Fortune-sheet | Apache/MIT | ◎ | ◎ | ◎ | ◎ | 1 MB↑ 워크북 모델, 과잉 |

**핵심**: 한글 IME 결함은 "선택된 셀에 바로 타이핑하면 에디터가 열리는" 경로에서 공통으로 터진다
(keydown의 `key === "Process"`를 첫 글자로 넘기다 자모가 사라짐). 왕복 보존은 어떤 라이브러리도 책임지지 않는다.
두 핵심 요구를 라이브러리가 보장하지 못하므로, 이 데이터 규모(≤ 수천 행)에서는 **자체 DOM 그리드(2.5–4k LOC)가
Glide 채택+패치와 동급 이상**이라는 결론이다. 어느 쪽이든 상태·undo·직렬화는 우리 코드에 있어야 한다.

### 3.4 셸 · git · 레이아웃

| 영역 | 후보 | 권고 |
|---|---|---|
| 호스팅 | 브라우저+File System Access API / **Node 사이드카** / Tauri / Electron / Bun 단일 exe / VS Code 확장 | **Node 사이드카** — Node 22가 이미 있고, 진짜 git CLI를 쓰므로 isomorphic-git의 CRLF(autocrlf 미구현)·성능·훅 문제가 통째로 사라진다. Tauri는 Rust+MSVC 툴체인·SmartScreen, Electron은 무게로 제외 |
| diff 표시 | diff2html 12.7 KB / **@codemirror/merge** 87 KB / react-diff-viewer 51 KB+emotion / @git-diff-view 330 KB | CM6를 쓰면 `@codemirror/merge`가 거의 공짜(청크 되돌리기 포함). 히스토리 diff는 diff2html |
| TSV 셀 diff | daff 1.4(MIT, 44 KB, deps 0) / 자작 | Key 열이 있으니 "Key로 행 매칭 → 셀 비교" 자작 50줄. daff는 3-way가 필요해질 때 |
| 레이아웃 | dockview 87 KB / **flexlayout-react** 53 KB·deps 0 / react-mosaic / rc-dock / react-resizable-panels 19 KB(분할만) | **flexlayout-react** — 탭+분할+드래그 도킹+JSON 저장, 의존성 0, ARIA·키보드 명시 |

### 3.5 결합 문법 선행 사례

| 방식 | 예 | GitHub에서 보일 때 |
|---|---|---|
| **코드펜스 + YAML 본문** | Obsidian csv-table(`csvtable` 펜스: source/columns/filter/sortBy), SilverBullet `query` 펜스 + **"Bake" 버튼**(쿼리를 정적 결과로 치환) | 코드 블록 — 무해 |
| 코드펜스 + info string 속성 | pandoc-placetable `{.table file="x.csv"}` | 코드 블록 |
| 디렉티브/쇼트코드 | remark-directive `::include{file=x}`, Quarto, Hugo, mkdocs-table-reader | 본문에 글자 찌꺼기 |
| 위키 임베드 | Obsidian/Foam/Dendron `![[file]]`, Obsidian Bases(`.base` YAML 뷰 정의) | 링크 텍스트 |

게임 툴링 쪽에서 베낄 것(CastleDB): enum 드롭다운, 다른 시트의 Key를 참조하는 `TRef` 자동완성, 열별 documentation 툴팁,
그룹 구분선(separators), 고유 ID 중복 검사. 타입 행 관행은 Luban(`##type`)·ExcelToUnity(`#` 주석)·BakingSheet(`$` 주석)와
사용자 포맷이 같은 계열이라, **1·2행을 바이트 그대로 보존**하는 것이 파이프라인 호환의 핵심이다.
스키마 포맷은 Frictionless Table Schema가 Field 시트를 담기에 충분히 맞는다(enum/unique/foreignKeys/description).

---

## 4. 아키텍처

```mermaid
flowchart LR
  subgraph Browser["브라우저 창 (msedge --app=…)"]
    L[flexlayout-react<br/>탭 · 분할 · 레이아웃 JSON]
    S[(DocumentStore<br/>path → Doc<br/>undo/redo · dirty)]
    MD[MarkdownPane<br/>CodeMirror 6]
    PV[PreviewPane<br/>react-markdown + mermaid]
    GR[GridPane<br/>자체 DOM 그리드]
    GT[GitPane<br/>status · diff · commit · log]
    TR[FileTree]
    L --> TR & MD & PV & GR & GT
    MD <--> S
    GR <--> S
    PV --> S
  end
  subgraph Sidecar["node server.mjs  (127.0.0.1:포트, 토큰)"]
    API["/api/fs · /api/git (REST)"]
    WS["/ws (파일 변경 이벤트)"]
    FS[(문서 리포 폴더)]
    G[git CLI]
    API --> FS
    API --> G
    WS -. fs.watch .-> FS
  end
  S <-->|fetch| API
  WS -->|변경 알림| S
```

세 층이다.

1. **사이드카** — 정적 파일 서빙 + 파일/폴더 API + git CLI 호출 + 파일 감시. 의존성 0(`node:http`, `node:fs`, `node:child_process`).
2. **DocumentStore** — 열린 문서의 단일 진실. 경로별로 문서 하나, 창이 몇 개 열려 있든 같은 객체를 바라본다(R2).
   undo/redo는 문서 단위. 저장은 "현재 상태 → 직렬화 → PUT". 외부 변경 이벤트가 오면 dirty 여부에 따라 자동 재로드 또는 충돌 배너(R8).
3. **페인** — 문서 종류와 보기 방식의 조합. `md`는 소스(CM6) / 미리보기 / 분할, `tsv`는 그리드. 페인은 상태를 갖지 않고 Store만 바라본다.

---

## 5. 핵심 결정 (ADR)

각 항목: 결정 · 근거 · 기각한 대안 · 되돌리기 비용.

### D1. 셸 = Node 사이드카 + 브라우저

- **결정** `node server.mjs --root <폴더> --open` 이 `127.0.0.1:<포트>`에 뜨고 Edge 앱 모드 창을 연다. 포트는 문서 폴더 경로로 정한 고정값(43000~44999)이고, 쓰이고 있으면 임의 포트 — 브라우저 저장소(레이아웃·열 너비·보기 모드·테마)가 오리진별이라 실행마다 포트가 바뀌면 다시 열 때마다 처음 상태가 된다(2026-10-25 TC-105 에서 발견, §19).
- **근거** Node 22·git 2.45·Edge/Chrome이 이미 설치되어 있다. 진짜 git CLI를 쓰므로 사용자의 autocrlf·credential helper·hooks가 그대로 동작한다.
  파일 감시는 `fs.watch({recursive:true})`가 Windows에서 네이티브로 된다. 실행 모델이 `python -m http.server` 습관과 같다.
- **보안** 127.0.0.1만 바인딩, 시작 시 난수 토큰을 URL fragment로 전달해 요청 헤더로 검사, `Host`/`Origin` 검사(DNS rebinding 방지), 요청 경로를 root 아래로 정규화(`..` 차단). 로컬 도구로는 이 넷이면 충분하다.
- **기각** 순수 브라우저+File System Access API: git을 isomorphic-git으로 돌려야 하는데 autocrlf 미구현으로 Windows에서 CRLF 파일이 전부 modified로 보이는 함정, `file://`에서 권한 핸들 지속 불확실. Tauri: Rust+MSVC 툴체인과 첫 빌드 수 분, 미서명 exe SmartScreen. Electron: 거부 사유와 동일.
- **되돌리기** 파일/git 접근은 `Backend` 인터페이스 하나 뒤에 둔다. 나중에 FSA 백엔드(브라우저 전용 모드)나 `bun build --compile`(Node 없는 PC 배포)을 붙일 수 있다.

### D2. 마크다운 = CodeMirror 6 소스 편집 + 별도 미리보기 (v1), 하이브리드 Live Preview는 v2

- **결정** 페인마다 소스 / 미리보기 / 좌우 분할을 토글. 저장은 `view.state.doc.toString()` 그대로.
- **근거** §3.2. git diff를 0으로 만드는 유일한 방식이고 한글 IME가 가장 검증된 에디터다. 미리보기 분리는 구현 리스크가 거의 없다.
- **v2** `@atomic-editor/editor`를 베이스로 평가해 하이브리드(활성 줄은 raw, 나머지는 렌더)를 얹는다. Mermaid·`tsv-view` 펜스는 블록 위젯. 조합 중(`view.composing`)에는 활성 줄 decoration 갱신을 보류한다.
- **기각** MDXEditor/Milkdown/TipTap — 재직렬화 diff + 한글 이슈. Vditor — 23 MB, 명령형, 정규화.
- **되돌리기** 미리보기 렌더러(react-markdown)는 하이브리드가 들어와도 그대로 쓴다(미리보기 전용 보기·인쇄).

### D3. TSV 그리드 = 자체 제작 (DOM + 행 가상화)

- **결정** `string[][]` 위에 DOM 표를 그리고 `@tanstack/react-virtual`(3 KB)로 행 윈도잉. 편집은 셀 위 `<textarea>` 하나,
  `isComposing` 가드로 IME를 근본 해결. 붙여넣기는 `text/plain`의 TSV를 그대로 해석(Sheets·Excel 호환).
- **근거** §3.3. 라이브러리를 써도 IME 패치·undo·직렬화·검증 렌더를 우리가 써야 하고, 캔버스 그리드(Glide)는 검증 밑줄·툴팁·주석 열 회색 같은 표현을 캔버스로 다시 그려야 한다. 데이터가 ≤ 수천 행이라 DOM으로 충분하다.
- **범위 통제** v1 기능 목록을 §11 Phase 1에 고정한다. 범위 선택·채우기 핸들·열 드래그 재정렬·찾기/바꾸기는 Phase 3.
- **탈출구** Phase 1이 예산의 2배를 넘기면 RevoGrid(MIT core, 2026-10 활발)로 교체. 그리드는 `GridPane` 컴포넌트 하나 뒤에 있어 교체 비용이 낮다.
- **기각** Handsontable(업무용은 유료), AG Grid/MUI X(범위 복붙·undo 유료), jspreadsheet CE(IME는 PRO만).

### D4. 레이아웃 = flexlayout-react

- **결정** 왼쪽 파일 트리(border), 가운데 탭셋(분할 자유), 아래 git 패널(border). 레이아웃 JSON은 `localStorage`에 root 경로별로 저장(리포를 더럽히지 않음).
- **근거** 탭+분할+드래그 도킹+직렬화를 의존성 0·53 KB로 제공, 키보드/ARIA 명시. React 18 지원.
- **기각** dockview(87 KB, 플로팅·팝아웃은 지금 불필요), react-resizable-panels(탭·도킹 없음), golden-layout(React 바인딩 없음, 2022 정체).
- **되돌리기** 페인은 레이아웃 라이브러리를 모른다(`{type, path, mode}` 레코드만). 교체 시 Layout 컴포넌트 하나만 바뀐다.

### D5. git = CLI 위임, 앱은 다섯 가지만

- **결정** ① 트리·탭에 상태 배지(`git status --porcelain=v2`) ② 현재 파일 vs HEAD — md는 `@codemirror/merge`(청크 되돌리기), tsv는 Key 매칭 셀 diff ③ 선택 파일 커밋(메시지 입력) ④ `git log --follow`로 파일 히스토리, 특정 버전 열기(`git show REV:path`) ⑤ 복원(`git restore`).
- **근거** 문서 편집기에 필요한 git은 이 다섯이고 전부 CLI 출력 파싱으로 끝난다. push/pull/브랜치는 v2에 버튼 하나로 위임.
- **기각** isomorphic-git(D1), 전용 diff 라이브러리(CM6가 있으니 불필요).

### D6. 결합 문법 = `tsv-view` 코드펜스 + YAML 본문

- **결정** §7. `tsv`(인라인 데이터 리터럴)와 `tsv-view`(파일 참조)를 분리. GitHub에서는 YAML 코드 블록으로 무해하게 보인다. 선택적 `bake`로 정적 파이프 표를 함께 저장.
- **근거** §3.5. 선행 사례 중 GitHub 열화가 가장 깨끗하고(코드 블록), 옵션이 늘어도 YAML이라 이스케이프 문제가 없다. info string 방식은 따옴표·공백이 취약하고 Obsidian 관행상 `tsv` 펜스는 인라인 데이터로 쓰인다.
- **기각** 디렉티브(GitHub에 찌꺼기), `![[ ]]`(산문 전용 관행과 충돌), MyST csv-table(필터·열 선택이 표준에 없어 어차피 확장).

### D7. 스키마 = 타입 행 + Field 시트에서 **런타임 유도**, 파일 생성은 v2 옵션

- **결정** 별도 스키마 파일 없이 열 때마다 유도한다(§6.2). v2에서 `X_Table.schema.json`(Frictionless Table Schema) 내보내기를 옵션으로.
- **근거** Field 시트는 Google Sheets에서 관리되는 자유 서식이라 파생 파일을 커밋하면 두 원본이 생긴다. 지금은 가볍게.
- **되돌리기** 유도 결과가 이미 Table Schema 형태의 객체라, 파일로 쓰는 것은 `JSON.stringify` 한 줄이다.

---

## 6. 데이터 모델과 왕복 규칙

### 6.1 TSV 문서

```ts
interface TsvDoc {
  kind: 'tsv'; path: string;
  bom: boolean; eol: '\n' | '\r\n'; trailingNewline: boolean;
  width: number;            // 열 수 (파일 내 최대 탭 수 + 1)
  rows: TsvRow[];           // 타입 행·헤더 행 포함, 원본 순서
  schema: TableSchema;      // §6.2
  history: UndoStack;       // 문서 단위
}
interface TsvRow { raw: string | null; cells: string[] }   // raw !== null 이면 미수정, 저장 시 raw 그대로
```

- **파싱** `split(/\r?\n/)` → 행마다 `split('\t')`. 따옴표는 해석하지 않는다(§2). 첫 줄 앞 BOM, 마지막 줄 뒤 개행 유무, EOL 종류를 기록.
- **직렬화** `rows.map(r => r.raw ?? pad(r.cells, width).join('\t')).join(eol) + (trailingNewline ? eol : '')`.
  **수정한 행만 재조립**하므로 건드리지 않은 행은 바이트가 같다. 새 행은 `width`만큼 탭으로 채운다.
- **셀 수정** `cells[c] = v; raw = null`. 행 삽입/삭제/이동은 배열 조작. 열 삽입/삭제는 모든 행을 dirty로 만든다(불가피하며, 사용자에게 "전체 행이 diff에 나옵니다" 경고).
- **왕복 테스트** 첨부 7개 파일을 열고 바로 저장 → 바이트 동일. 셀 하나 수정 → `git diff`에 그 행만.
- **경고** 셀에 탭/줄바꿈이 들어오면 저장을 막고 알린다(TSV로 표현 불가). 따옴표로 시작하는 셀은 파일 열 때 경고 한 번.

### 6.2 스키마 유도

```ts
interface ColumnSchema {
  index: number; name: string;
  type: 'string' | 'enum' | 'bool' | 'byte' | 'uint' | 'float' | 'comment';
  isKey: boolean;               // 0열이고 이름이 Key
  list: boolean;                // 값에 ", " 가 섞여 있으면 (enum 리스트)
  enumValues?: string[];        // Field 블록에서
  description?: string;         // Field 블록에서 (툴팁)
}
```

규칙 — ① 1행 첫 셀이 `#`로 시작 → 타입 행(`#` 제거) ② 2행 = 헤더 ③ 타입이 비었거나 헤더가 `#`로 시작 → `comment`
④ Field 시트: 빈 줄로 블록을 나누고, 블록 첫 행 첫 셀이 이름. 이름이 `<테이블 접두>Def`면 열 설명, 이름이 열 이름과 같으면 enum 후보
⑤ `bool`은 `TRUE/FALSE`(Sheets 출력 그대로, 대소문자 보존) ⑥ `byte` 0–255, `uint` ≥ 0 정수, `float` 실수.

검증은 셀 단위로 즉시(빨간 밑줄 + 툴팁), 저장을 막지는 않는다(기획 중간 상태를 저장할 수 있어야 함). 열 요약에 오류 수를 표시.

### 6.3 마크다운 문서

`{ kind: 'md', path, state: EditorState }` — CM6 상태가 곧 모델. undo/redo는 CM6 history. 저장은 텍스트 그대로.

### 6.4 외부 변경

사이드카가 `fs.watch`로 변경을 WebSocket으로 알린다. 저장 직후 자기 변경은 mtime으로 무시.
열린 문서가 깨끗하면 조용히 재로드, dirty면 상단 배너 "디스크에서 바뀜 — [다시 읽기] [내 것 유지]".
저장 API는 `baseMtime`을 함께 보내고 디스크가 더 새로우면 409 — 덮어쓰기 사고 방지.

---

## 7. 결합 문법 (`tsv-view`)

### 7.1 표 임베드

````markdown
## 고봉(Peak) 타일

이동·식량 비용이 산보다 크고 지구를 세울 수 없다.

```tsv-view
file: MacroWorld - Tile_Table.tsv
columns: [Key, SurfaceType, Buildable, MovementCost, FoodCost]
where: TerrainType == "Peak"
sort: -MovementCost
```
````

- `file` 리포 상대 경로(필수) · `columns` 열 선택(생략 시 주석 열 제외 전부) · `where` 단순 비교식(`==`, `!=`, `>`, `<`, `in [..]`, `&&`, `||`) · `sort` `-`접두면 내림차순 · `limit`.
- **v1(Phase 2)**: 미리보기에서 표로 렌더. 행 클릭 → 그 TSV를 그리드 페인으로 열고 해당 행으로 스크롤.
- **v2(Phase 3)**: 그 자리에서 편집. 같은 `TsvDoc`을 바라보므로 그리드 페인과 즉시 동기화된다. 필터로 숨은 행은 건드리지 않는다.
- `bake: true`면 저장 시 펜스 바로 아래에 `<!-- tsv-view:baked -->` … `<!-- /tsv-view -->` 사이에 파이프 표를 다시 생성한다. GitHub에서도 진짜 표가 보인다. 대가는 파생 내용이 diff에 섞이는 것 — 기본값은 꺼짐.

### 7.2 Mermaid 생성

````markdown
```tsv-view
file: MacroWorld - Buidling_Table.tsv
where: DistrictKey == "Agricultural-District"
render: mermaid
template: |
  flowchart LR
  {{#each rows}}
  {{Key}}["{{DisplayName}}"]
  {{#each RequiredBuildingKey.list}}{{this}} --> {{../Key}}
  {{/each}}{{/each}}
```
````

- `template`는 Mustache 수준(`{{col}}`, `{{#each}}`, `{{#if}}`, `.list`는 콤마 분리)만 지원. 100줄 안팎의 자체 구현.
- 생성 결과는 `mermaid.parse(text, {suppressErrors:true})`로 먼저 검증, 실패하면 생성된 텍스트와 오류를 그대로 보여 준다.
- 일반 `mermaid` 펜스는 그대로 렌더(동적 `import('mermaid')`, 169 KB gz, 다이어그램별 lazy chunk).

---

## 8. 화면

```
┌ 파일 트리 ─┬─ 탭셋 A ─────────────────────┬─ 탭셋 B ────────────────┐
│ docs/      │ [타일 기획.md ●] [지구.md]     │ [Tile_Table.tsv ●]        │
│  타일.md ● │                               │ Key | DisplayName | Terr… │
│ data/      │ ## 고봉(Peak) 타일            │ Peak-Snow | Peak | Peak … │
│  Tile_…  ● │ 이동·식량 비용이…              │ Peak-Lava | Peak | Peak … │
│            │ ┌ tsv-view ───────────────┐    │                           │
│            │ │ Key  Surface  Move  Food │    │  ⓘ MovementCost: 이동 비용. │
│            │ │ Peak-Snow  Snow  9  6    │    │    길찾기에서 사용         │
│            │ └──────────────────────────┘    │                           │
├────────────┴───────────────────────────────┴───────────────────────────┤
│ git  M docs/타일.md  M data/Tile_Table.tsv   [diff] [커밋 메시지…] [커밋] │
└────────────────────────────────────────────────────────────────────────┘
```

- 탭 제목 옆 `●` = 미저장, 트리 배지 `M/A/?` = git 상태.
- 단축키: `Ctrl+S` 저장 · `Ctrl+Shift+S` 모두 저장 · `Ctrl+P` 빠른 열기 · `Ctrl+\` 오른쪽에 분할 · `Ctrl+Z/Y` · `F2`/`Enter` 셀 편집 · `Esc` 취소 · `Ctrl+Enter` 커밋.
- 그리드: 헤더 2행 고정, 주석 열 회색, enum 셀은 드롭다운(리스트 셀은 다중 선택), bool은 체크박스, 오류 셀 빨간 밑줄, 열 머리 호버에 Field 설명.

---

## 9. 사이드카 API 초안

| 메서드 | 경로 | 역할 |
|---|---|---|
| GET | `/api/tree` | `.md/.tsv` 트리(`.git`, `node_modules` 제외) + git 상태 배지 |
| GET | `/api/file?path=` | `{ text, mtime }` |
| PUT | `/api/file?path=` | 본문 `{ text, baseMtime }` → 디스크가 더 새로우면 `409` |
| GET | `/api/git/status` | `--porcelain=v2` 파싱 결과 |
| GET | `/api/git/show?path=&rev=HEAD` | 그 리비전의 파일 내용 |
| GET | `/api/git/log?path=` | `[{hash, date, author, subject}]` (`--follow`) |
| POST | `/api/git/commit` | `{ paths, message }` → `git add` + `git commit` |
| POST | `/api/git/restore` | `{ path }` |
| WS | `/ws` | `{ type: 'change', path }` |

모든 요청에 `X-Token` 헤더. 경로는 root 아래로 정규화하고 심볼릭 링크는 따르지 않는다.
(2026-10-21) 가져온 폴더·인코딩·폴더 고르기 API 는 §18.4.

---

## 10. 프로젝트 구조 · 빌드 · 실행

```
JayDocs/
  package.json            react 18 · vite · typescript · @codemirror/* · flexlayout-react · react-markdown · mermaid(동적) · @tanstack/react-virtual · vitest
  server.mjs              사이드카 (런타임 의존성 0)
  start.cmd               node server.mjs --root "%~1" --open   (폴더를 끌어다 놓거나 인자로)
  vite.config.ts
  src/
    main.tsx  App.tsx
    lib/
      backend.ts          Backend 인터페이스 + HttpBackend
      tsv/  parse.ts  serialize.ts  schema.ts  field.ts  validate.ts  diff.ts
      md/   tsvView.ts(블록 파서·where 평가)  template.ts(mermaid 템플릿)  mermaid.ts(동적 로드·캐시)
      store/ documents.ts  undo.ts
    components/
      Layout.tsx  FileTree.tsx  MarkdownPane.tsx  PreviewPane.tsx  GitPane.tsx
      grid/  Grid.tsx  Cell.tsx  CellEditor.tsx  Selection.ts  Clipboard.ts  editors/(Enum, Bool)
  tests/                  tsv 왕복(첨부 7개 파일 고정 픽스처) · field 파싱 · where 식 · 템플릿
  dist/                   vite build 결과 (사이드카가 서빙)
```

- `npm run dev` — Vite 개발 서버가 `/api`를 사이드카로 프록시. `npm run build` → `dist/`.
- 배포 형태는 `JayDocs/` 폴더 그대로(`dist/` + `server.mjs` + `start.cmd`). Node만 있으면 된다.
  - (2026-10-13 추가) 다른 리포에서도 쓰기: `bin/jaydocs.mjs` + package.json `bin` → `npm link` 한 번이면 어디서나 `jaydocs [폴더]`. 다른 PC 로는 `npm run pack` 이 `release/jaydocs/`(+zip)를 만든다 — node_modules 없이 Node 22+ 만. `--ignore a,b` 로 큰 폴더를 트리·감시에서 뺀다. 창 제목은 `<폴더 이름> — JayDocs`.
- 이 리포의 관행대로 README에 사용법을 적고, 루트 README 도구 목록에 한 줄 추가한다.

---

## 11. 단계별 계획

각 Phase 끝에 "검증" 조건을 통과해야 다음으로 간다. 기간은 집중 작업일 기준의 추정이다.

### Phase 0 — 뼈대 (1일)  → R1, R2 일부  ✅ 2026-10-11 완료

실제 구현에서 설계와 달라진 점: 변경 알림은 WebSocket 대신 **SSE**(`/api/events`, 서버→클라이언트만 필요하고 의존성 0으로 끝남). 파일 감시는 chokidar 없이 `fs.watch({recursive:true})`.
`rename`/`delete` API 는 Phase 2 로 미룸. 빌드 도구는 설치 시점의 최신(Vite 8, TypeScript 7, flexlayout-react 0.11).

- `server.mjs`: tree/file/put, 토큰, `fs.watch` → WS, `--open`.
- SPA: flexlayout 레이아웃, 파일 트리, `.md` 탭 열기(CM6 + lang-markdown), 저장, dirty 표시, 같은 파일 두 창 동기화.
- 문서 리포 초기화(§14): `SagaDocs` 리포를 만들고 export 7개 파일을 폴더 구조에 맞게 옮긴다. (처음엔 `D:\SagaDocs`에 만들었다가 §13-2 결과에 따라 같은 날 `C:\Users\gaber\Documents\GitHub\SagaDocs`로 옮기고 파일 이름을 정리했다.)
- **검증** `SagaDocs`를 열어 md를 만들고 저장, 두 창에서 같은 문서가 같이 바뀐다.

### Phase 1 — TSV (2–3일)  → R4, R5, R6  ✅ 2026-10-11 완료

구현 메모(설계와 다르거나 설계가 비워 둔 부분):
- 표는 **불변 스냅샷** — 편집마다 새 `TsvTable`, 바뀐 행만 새 객체. undo/redo 는 이전 표 객체를 쌓는 것이고, 저장된 스냅샷과 **같은 객체면 깨끗한 상태**(되돌려서 저장 시점으로 오면 다시 깨끗). 300단계.
- 입력은 그리드 위에 항상 떠 있는 `<textarea>` 하나. 선택만 된 상태에선 1×1 투명으로 활성 셀 위에 있고, `input`/`compositionstart` 가 오면 편집 모드로 커진다. 한글 조합이 textarea 안에서 시작되므로 첫 자모 유실이 구조적으로 없다. `isComposing`/`keyCode 229` 동안은 키를 가로채지 않는다.
- Field 찾기: 같은 폴더 `X_Field` → 리포 안 모든 `_Field` 의 `XDef` 블록(§14 운영 규칙). 열린 Field 문서는 편집 중 내용이 바로 반영. enum 블록이 없으면 **열에 있는 값**을 후보로만 쓰고 검증은 안 한다.
- 섞인 줄바꿈은 다수 쪽으로 통일하고 열 때 경고. 셀에 들어온 탭·줄바꿈은 확정 때 공백으로 바꾸고 알린다(저장을 막는 대신).
- SagaDocs 파일들이 끝 개행이 없어 행을 덧붙이면 diff 가 2줄로 난다 → 상태줄에 **끝 개행 추가** 버튼. 범위 선택은 Phase 3 그대로.
- (Phase 3 뒤 정정) 행 가상화는 `@tanstack/react-virtual` 대신 **직접 계산**한다 — 행 높이가 고정이라 15줄이면 되고, 숨은 탭(복원된 레이아웃)에서 마운트된 그리드가 보이게 된 뒤에도 높이 0 으로 남아 행을 안 그리던 문제가 사라졌다. 보이는 높이를 모르면 창 높이로 잡아 어떤 경우에도 행이 비지 않는다.

- `parse/serialize` + 왕복 테스트(첨부 7개 파일 바이트 동일).
- 그리드 v1: 행 가상화, 키보드 이동(방향키·Tab·Enter), 셀 편집(`F2`/`Enter`/타이핑, **IME**), undo/redo, Sheets 복사/붙여넣기(단일·다중 셀), 행 삽입/삭제/복제, 열 삽입/삭제, 헤더 2행 고정, 열 너비 조절, 주석 열 회색.
- 스키마: 타입 행 + Field 블록 유도, 툴팁, enum 드롭다운(리스트 포함), bool 체크박스, byte/uint/float 검증, Key 중복.
- **검증** Tile_Table에 Peak 행 하나 추가 → `git diff`가 그 한 줄. 한글 설명 셀에 타이핑해도 자모가 안 빠진다. Sheets에서 3×3 복사 → 붙여넣기.

### Phase 2 — 미리보기 · git · 결합(읽기) (2일)  → R3, R7, R8, R9 읽기  ✅ 2026-10-11 완료

구현 메모:
- 미리보기는 react-markdown 10 + remark-gfm. mermaid 12 는 `import()` 로 첫 다이어그램 때만 내려받는다(lazy chunk, ELK 등 레이아웃 엔진은 그 안에서 또 나뉜다). 소스/분할/미리보기 모드는 문서별로 localStorage 에 남는다.
- `tsv-view` 본문은 YAML 전체가 아니라 **작은 부분집합**(스칼라 · `[a, b]` · 블록 목록 · `|` 블록)만 자체 파싱. `where` 는 토크나이저 + 재귀 하강(`== != > < >= <= in / not in && || ! ()`), 숫자끼리는 숫자 비교, 리스트 셀은 `in` 에 항목 단위로 걸린다. `file` 은 리포 상대, `./`·`../` 면 md 기준. 마크다운 링크는 md 기준(`/` 면 리포 루트).
- tsv-view 는 스토어의 같은 `TsvDoc` 을 바라보므로 그리드 수정이 바로 보이고 "● 저장 전 내용" 을 표시한다. 행 클릭 → `nav.openPath(path, {r, c})` 로 그리드 탭을 열고 그 행을 활성화.
- git 은 사이드카가 CLI 를 `execFile` 로 호출(`-z` 포맷, `--` 구분, `GIT_LITERAL_PATHSPECS`, 커밋 메시지는 stdin). `commit --only -- <paths>` 로 고른 파일만. `restore` 는 HEAD 에 있는 파일만. ROOT 가 리포의 하위 폴더여도 경로를 변환한다.
- diff: md 는 `@codemirror/merge` MergeView(왼쪽 HEAD 읽기 전용, 오른쪽은 스토어와 동기화된 편집 가능 뷰, 청크 되돌리기 화살표). tsv 는 `lib/tsv/diff.ts` 가 Key 로 행을 맞춰 셀 변경을 나열, 항목 클릭 → 그리드의 그 셀로.
- "이 버전으로" 는 git 을 건드리지 않고 그 리비전 내용을 **문서에 넣기만** 한다(저장은 사용자가). "되돌리기" 는 `git restore` + 문서 재로드.
- 이름 바꾸기/삭제는 트리 오른쪽 클릭. 저장 전 문서가 걸려 있으면 거부. 열린 탭은 경로를 따라 바꾸거나 닫는다. 사이드카는 `.git` 경로를 모든 API 에서 거부한다.
- 레이아웃: 기존 localStorage 레이아웃에 아래쪽 git 패널(border)이 없으면 덧붙인다(버전 올리지 않음).

- PreviewPane(react-markdown + mermaid 동적 로드), 페인 모드 소스/미리보기/분할.
- `tsv-view` 블록: 파서, `where`/`columns`/`sort`, 읽기 전용 표, 행 클릭 → 그리드 열기.
- git: 배지, HEAD diff(md는 `@codemirror/merge`, tsv는 Key 매칭 셀 diff), 커밋, 로그, 특정 버전 보기, 복원. 외부 변경 배너·409 처리.
- **검증** 기획 md 안에서 Peak 행 표가 보이고, 그리드에서 값을 바꾸면 미리보기가 따라온다. 커밋 → 로그 → 이전 버전 열기 → 복원.

### Phase 3 — 결합 심화 (3일+)  → R9 편집, R10, R11, R12  ✅ 2026-10-11 완료

구현 메모:
- **그 자리 편집**: 미리보기·하이브리드의 tsv-view 표는 그리드와 같은 방식(숨은 textarea 하나, IME 가드)으로 셀을 고친다. 같은 `TsvDoc` 에 `store.editTable` 로 넣으니 그리드·다른 창·bake 가 즉시 같은 표를 본다. 필터로 숨은 행은 건드리지 않는다. enum 드롭다운·검증 밑줄은 그리드 전용(표에는 밑줄만).
- **bake**: `lib/md/bake.ts` 가 펜스와 기존 baked 블록을 찾아 원문 오프셋 기준 변경 목록을 만들고, `store.save` 가 md 저장 직전에 참조 TSV(열려 있으면 저장 전 표, 아니면 디스크)를 모아 `ChangeSet` 으로 문서에 적용한다. 표가 같으면 변경 없음(diff 깨끗). 미리보기는 `stripBaked` 로 블록을 숨긴다. CM 텍스트는 \n 이므로 bake 도 \n, 파일 EOL 은 직렬화에서 복원.
- **Mermaid 템플릿**: `lib/md/template.ts` — Mustache 부분집합(`each`·`if/else`·`this`·`../`·`@index`·`.list`·`.id`·`.length`, 주석, standalone 줄 제거) 150줄. 루트는 `{ rows, file, count }`, 행은 열 이름 → 값 레코드. 생성 텍스트는 Mermaid 컴포넌트가 `mermaid.parse` 로 검증.
- **하이브리드 Live Preview**: `@atomic-editor/editor` 를 들이지 않고 `components/hybrid.ts` 에 CM6 **StateField** 장식으로 자체 구현(블록 위젯은 ViewPlugin 으로 못 넣는다). 커서 줄은 원문, 다른 줄의 `HeaderMark`·`EmphasisMark`·`CodeMark`·`StrikethroughMark`·링크 표식/URL·`QuoteMark` 를 `Decoration.replace` 로 숨기고, `ListMark` 는 • 위젯, 인용은 줄 장식. ```mermaid·```tsv-view 펜스는 커서 밖이면 블록 위젯(React root 로 미리보기와 같은 컴포넌트, `ignoreEvent: true`)으로 바꾸고 "원문" 버튼이 `posAtDOM` 으로 커서를 펜스로 옮긴다. 조합 중(`input.type.compose`)엔 재계산 없이 `map` 만. 파서가 뷰포트 밖을 아직 안 읽었을 수 있어 `ensureSyntaxTree(…, 300ms)` 로 끝까지 파싱.
- **그리드 추가**: 찾기/바꾸기 바(Ctrl+F/H, `lib/tsv/find.ts`), 채우기 핸들(패턴 반복·등차수열), 열 글자 드래그 재정렬(`moveColumns`) — 에이전트 위임분, 메모는 그 커밋 메시지와 README.

- `tsv-view` 그 자리에서 편집, `bake`.
- Mermaid 템플릿(`render: mermaid`).
- 하이브리드 Live Preview(`@atomic-editor/editor` 평가 후 채택 또는 자체 decoration).
- 그리드: 범위 선택, 채우기 핸들, 찾기/바꾸기, 열 드래그 재정렬.

---

## 12. 리스크와 대응

| 리스크 | 대응 |
|---|---|
| 자체 그리드 범위 확대 | Phase 1 목록 고정. 예산 2배 초과 시 RevoGrid로 교체(D3 탈출구) |
| CM6 위젯과 한글 조합 충돌(v2 하이브리드) | 활성 줄은 raw 유지, `view.composing` 동안 decoration 갱신 보류. v1은 미리보기 분리라 해당 없음 |
| 다른 에디터나 `git pull`이 열린 파일을 바꿈 | R8 감지 + 409. 원본은 git이므로(§13-1) Sheets 재export 병합은 범위 밖 |
| SagaDocs 형식과 게임 표 형식이 어긋남 | 해당 없음 — 게임은 SagaDocs를 직접 읽지 않고 `/design` 세션이 옮겨 쓴다(§13-2). JayDocs는 §2 형식만 지키면 된다 |
| Field 시트가 자유 서식이라 못 읽는 경우 | 휴리스틱 실패 = 툴팁/enum 없음일 뿐. 타입 행만으로 검증은 계속됨 |
| flexlayout-react 단일 메인테이너 | 페인은 레이아웃을 모르므로 교체 비용 낮음(D4) |
| Edge 앱 모드가 없는 환경 | 일반 탭으로 연다. Chrome도 `--app` 지원 |
| 사이드카 포트 충돌·좀비 프로세스 | 폴더별 고정 포트가 쓰이고 있으면 임의 포트로 + 브라우저 창이 닫히면 heartbeat 끊김으로 자동 종료 |

---

## 13. 피드백 반영 (2026-10-11)

| # | 질문 | 답 | 설계에 반영 |
|---|---|---|---|
| 1 | 원본은 어디인가 | **git.** Notion·Asana·Sheets를 오가는 게 불편해서 나만의 원본이 필요. git + GitHub로 관리 | Sheets 재export 병합 기능 **제외**. export 파일은 1회 이주(§14). daff 불필요. 원격은 GitHub — v2에 push/pull 버튼 |
| 2 | Unity 임포터 | SAGA 쪽 조사 보고서 (2026-10-31 리포에서 삭제, 커밋 기록에 남아 있음, 같은 날). **게임은 SagaDocs TSV를 직접 읽지 않는다.** SAGA의 `/design` 세션이 SagaDocs를 읽고 게임 형식(`Assets/StreamingAssets/Table/<소문자>.tsv`)으로 옮겨 쓴다. 복사·서브모듈·심볼릭 링크 없음 | **해결.** §2 포맷이 그대로 계약이다(임포터에 맞출 필요 없음). 파일 이름 자유 → `MacroWorld - ` 접두 제거, `Buidling`→`Building` 개명 완료. 지킬 것 두 가지: Key는 파일 안에서 유일, `_Field`는 빈 줄로 블록을 나누고 블록 첫 줄이 블록 이름(SAGA 비교 도구가 이 기준으로 읽는다). SagaDocs 위치는 SAGA 옆 `C:\Users\gaber\Documents\GitHub\SagaDocs` |
| 3 | 문서 리포 구조 | md와 TSV를 같은 폴더에. Obsidian처럼 계층 구조. 트리·파일 관리는 위임 | §14 구조 제안 |
| 4 | v1 마크다운 보기 | 권장안(소스 + 미리보기)으로 진행 | D2 확정 |
| 5 | 사용자 범위 | 1인 개발, 혼자 사용 | 커밋 author는 git config 그대로. 동시 편집·설치 안내·권한 기능 전부 제외 |
| 6 | 이름 | `Jay` 접두 + "문서 편집기" | **JayDocs** |

이미 정하고 알린 것(되돌리기 쉬움): React 18(sprint-timeline과 통일), 레이아웃은 localStorage, v1에 브라우저 전용(FSA) 모드 없음, 스키마 파일 없이 런타임 유도, 문서 리포 이름 `SagaDocs`.

---

## 14. 문서 리포 구조 제안 (`SagaDocs`)

JayDocs(도구)와 SagaDocs(내용)는 **별개의 리포**다. 도구는 자기 리포(처음엔 JayTools 안, 2026-10-25 독립)에, 기획 원본은 자기 리포에 두어야 도구를 바꿔도 기획 히스토리가 깨끗하다.

### 원칙

1. **도메인별 폴더, 한 폴더 안에 기획 md와 그 데이터 TSV가 같이 산다.** `Tile/` 하나를 열면 기획·테이블·필드 설명이 다 보인다(Obsidian 방식, 요청 3).
2. **숫자 접두로 순서를 고정**한다(`10-World`). 파일 탐색기·GitHub·JayDocs 트리에서 같은 순서로 보인다.
3. **TSV 이름에서 `MacroWorld - ` 접두를 뺀다.** 이 접두는 Google Sheets 스프레드시트 이름이고, 원본이 git이 된 지금은 의미가 없다. `Buidling`(오타)도 `Building`으로 바로잡는다. (게임이 이 파일을 직접 읽지 않으므로 안전 — §13-2)
4. **`_Table` ↔ `_Field` 짝은 같은 폴더**에 둔다. JayDocs가 이 규칙으로 스키마를 찾는다(§2).
5. 폴더 이름은 영어(Unity 쪽 경로·키와 일치), 문서 제목과 본문은 한국어.

### 트리

```
SagaDocs/                          git 리포 (GitHub: Jay/SagaDocs, private) · 로컬 C:\Users\gaber\Documents\GitHub\SagaDocs (Project-SAGA 옆)
  README.md                        리포 안내 · 폴더 규칙 · JayDocs로 여는 법
  .gitattributes                   *.md *.tsv text eol=lf   (Windows에서도 LF 고정 → 왕복 보존·diff 안정)
  .editorconfig                    다른 에디터로 열어도 탭·LF 유지
  00-Overview/
    SAGA 개요.md                   한 장 요약, 핵심 루프
    용어집.md                      Key 명명 규칙(단어 사이 `-`), 타입 행 규칙(§2) — "계약" 문서
    로드맵.md
  10-World/
    Tile/
      Tile.md                      지형·표면 기획 (tsv-view로 Tile_Table 임베드)
      Tile_Table.tsv
      Tile_Field.tsv
    Road/
      Road.md
      Road_Field.tsv
    Resources/
      Resources.md
      Resources_Field.tsv          (Resources_Table은 아직 없음 — 만들 때 여기)
  20-Settlement/
    District/
      District.md
      District_Table.tsv
      District_Field.tsv           (DistrictDef·BuildingDef·RecipeDef·Trait 블록 포함 — 그대로 둔다)
    Building/
      Building.md
      Building_Table.tsv           (export의 Buidling_Table)
    Recipe/
      Recipe.md                    (Recipe_Table은 아직 없음)
  30-Economy/                      자원 흐름 · 생산 · 유지비 — mermaid 다이어그램 위주
  40-Characters/
  50-Systems/                      길찾기 · 틱 · 이벤트 등 규칙 문서
  90-Journal/
    2026-10-11.md                  작업 일지 (Asana 대체 — 할 일·결정 기록)
  _assets/                         md에 붙이는 이미지
```

### 운영 규칙

- **한 폴더 = 한 도메인 = 한 기획 md + 0~n개의 TSV.** TSV가 둘 이상 필요하면(예: Building 하위 Recipe) 하위 폴더를 판다.
- `District_Field.tsv`처럼 한 Field 시트가 여러 테이블(District·Building·Recipe)을 설명하는 경우는 **그대로 둔다.** JayDocs는 블록 이름(`BuildingDef`)으로 다른 폴더의 테이블도 찾는다(§6.2 ④를 "같은 폴더 → 리포 전체" 순으로 확장).
- 커밋 단위는 "기획 한 가지"(예: `Peak 타일 추가`). JayDocs의 커밋 패널이 바뀐 md·tsv를 같이 담는다.
- **게임과의 연결은 사람(세션)이 한다.** SAGA의 `/design` 세션이 SagaDocs를 읽기만 하고 게임 형식으로 옮겨 쓴다. 복사 스크립트·서브모듈·심볼릭 링크는 쓰지 않는다(`Assets/` 안에 두면 Unity가 `.meta`를 만들어 리포가 더러워진다). SagaDocs는 SAGA 쪽에서 읽기 전용.
- `/design`이 Key로 행을 맞춰 옮기므로 **Key는 파일 안에서 유일**해야 하고, `_Field`의 **블록(빈 줄 구분, 첫 줄 = 블록 이름)** 형식은 SAGA 비교 도구가 변화를 읽는 기준이라 유지한다.
- 이주 절차(Phase 0 끝에 1회): export 7개 파일을 위 위치로 복사·개명 → `git init` → `git add -A` → 첫 커밋 `Google Sheets export 2026-09-27 이주` → GitHub private 리포에 push.

---

## 16. 피드백 2차 반영 (2026-10-11, Phase 2 사용 후)

Jay 의 첫 사용 소감: "가벼워서 좋다, git 으로 바로 커밋되는 게 매우 좋다." 요청 네 가지와 반영.

| # | 요청 | 반영 |
|---|---|---|
| 1 | TSV: Sheets·Excel 기본 단축키, 복사/붙여넣기 (수식은 다음) | 그리드에 **범위 선택**(Shift+방향키·드래그·행번호/열글자 클릭·Ctrl+A·Shift+Space·Ctrl+Space)을 넣고 Ctrl+C/X/V 를 **범위 블록**으로. 한 셀을 복사해 범위에 붙이면 채우기. Delete 범위 비우기, Ctrl+D/R 채우기, Ctrl+Alt+= / - 행 삽입·삭제(Shift 면 열), Ctrl+Shift+D 행 복제. Phase 3 에 남긴 것: 채우기 핸들, 찾기/바꾸기, 열 드래그 재정렬, 수식 |
| 2 | md: 여러 문자열 선택 표시 | 원인 둘 — ① `drawSelection` 은 선택을 글자 **뒤** 레이어에 그리는데 활성 줄 배경이 불투명해 가려졌다 → 활성 줄·선택 색을 반투명 변수로. ② `allowMultipleSelections` 가 없어 Ctrl+D(같은 단어 추가 선택)·Ctrl+클릭이 한 선택으로 합쳐졌다 → 켬. 선택 일치 하이라이트·검색 일치 색도 변수화 |
| 3 | 다크 모드 | 색을 전부 CSS 변수로 모으고 `<html data-theme>` 로 전환(Ctrl+Alt+D, 상단 버튼, 팔레트). 처음엔 OS 설정, 이후 localStorage. flexlayout 은 light.css 의 `--flexlayout-color-*` 변수를 덮어쓰고, CodeMirror·merge view·mermaid(`theme: dark`)도 따라간다 |
| 4 | 단축키를 md 로 보관, 키보드로 모든 작업 | **`src/lib/shortcuts-table.mjs` 한 곳**이 원본. `npm run shortcuts` 가 `SHORTCUTS.md` 를 만들고, 테스트가 둘이 같은지 검사한다. 앱의 F1 도움말과 전역 키 처리기(`commandByCombo`)도 같은 표를 읽는다. 키보드 전부: **명령 팔레트(Ctrl+Shift+P)** 가 등록된 모든 명령을 글자로 실행, **빠른 열기(Ctrl+P)**, 탭 이동(Alt+[ ] / Alt+1~9 / Alt+W), 패널 접기·포커스(Ctrl+B · Ctrl+J · Ctrl+Shift+E/G/M), 트리 키보드 탐색(방향키·Enter·F2·Delete·Shift+F10), 보기 모드 순환(Ctrl+Shift+V), diff/기록(Ctrl+Shift+F/H). 브라우저가 가로채는 조합(Ctrl+W/T/N/Tab/숫자)은 피했다 |

구조: 명령은 `lib/commands.ts` 레지스트리에 창이 마운트될 때 등록(`registerCommands`)하고, 전역 keydown(버블 단계, 창이 preventDefault 한 키는 건너뜀)이 표의 키 → 명령으로 실행한다. 특정 창에 시키는 일(보기 모드·포커스)은 `nav.paneAction(path, …)` 로 보낸다.

---

## 17. 계산식 (2026-10-11, 권고안 b 채택)

Jay 가 미뤄 둔 "수식" 을 넣으려면 파일 계약(§2: 셀은 값 그대로, SAGA `/design` 이 그대로 읽는다)과 부딪힌다. 두 안 중 **(b)** 로 갔다.

| 안 | 내용 | 판정 |
|---|---|---|
| (a) 셀 원문에 `=A*2` | 그리드에서만 계산해 보여 줌 | 파일을 읽는 쪽이 식을 본다 — 계약 위반. 기각 |
| **(b) 식은 별도 파일, 결과를 값 열에 써 넣기** | `X_Calc.tsv` 에 `Target / Formula`, 그리드의 **계산(F9)** 이 결과를 표에 쓴다 | 파일엔 값만 남는다. 채택 |

- **파일**: `X_Table.tsv` 옆 `X_Calc.tsv`. 헤더 `Target	Formula	#메모`, 규칙은 `열이름` (전 행) 또는 `열이름[Key]` (한 행). 타입 행이 없는 보통 TSV 라 그리드에서 그대로 편집한다. SagaDocs 규칙에는 새 파일 종류지만 `/design` 은 `_Table`/`_Field` 만 읽으므로 무해하다.
- **식** (`lib/calc/expr.ts`, 250줄): 숫자·문자열·열 참조·사칙·비교·논리·삼항·함수·`lookup(파일, 키, 열)`. 값은 문자열이되 숫자로 읽히면 숫자. 결과는 숫자면 소수 찌꺼기 제거, 불은 TRUE/FALSE.
- **계산** (`lib/calc/calc.ts`): 규칙 전부를 행마다 평가, 규칙이 규칙 결과를 읽을 수 있어 값이 안정될 때까지 최대 5바퀴. 결과는 **stale 맵**(지금 값 ≠ 계산값)으로 먼저 보여 주고(파란 띠·노란 배경·툴팁), F9 가 바뀐 셀만 `setCells` 한 번으로 써 넣는다(되돌리기 한 단계). 자동 적용은 하지 않는다 — Jay 가 눌러야 파일이 바뀐다.
- **스토어**: Field 캐시를 보조 표 캐시(`auxTable`)로 일반화해 Calc 파일과 lookup 대상 표도 같은 길로 읽는다. 열려 있으면 저장 전 표를 우선하므로 Calc 파일을 고치는 즉시 바뀔 셀 수가 따라온다.
- 하지 않은 것: 식 자동완성, 순환 참조 감지(5바퀴 뒤 멈춤), 행 간 집계(sum 등 — 필요하면 `lookup` 처럼 표 단위 함수로).

---

## 18. 폴더 가져오기 · 형식 확장 (2026-10-21)

계획·결정 과정·단계별 완료 메모는 [PLAN-folder-import.md](PLAN-folder-import.md). 여기에는 확정된 결과만 적는다.

### 18.1 요구 (Jay, 2026-10-21)

| # | 요구 | 답으로 정해진 것 |
|---|---|---|
| R13 | 특정 경로의 폴더를 Import | **연결(마운트)** — 복사하지 않고 원래 자리에서 열고 고친다. 대상은 수업 자료 · Unity 프로젝트 문서 · 수강생 제출물 |
| R14 | Import 한 곳의 md · tsv · txt 등을 열고 편집 | 형식 표로 `.md` `.tsv` `.csv` `.txt` `.json`. json·csv 는 "이번에 같이" |
| R15 | (R13 에서 나옴) 보기만 할 폴더 보호 | 읽기 전용 가져오기. 가져온 폴더의 **git 은 하지 않는다**(Jay: "일단 필요 없음") |

### 18.2 결정

| # | 결정 | 근거 · 대가 |
|---|---|---|
| F1 | 경로 = 주 폴더는 그대로, 가져온 폴더는 `@별칭/…` (`src/lib/roots.mjs`, 사이드카와 공유) | 기존 경로·레이아웃·tsv-view·테스트가 하나도 안 바뀐다. 주 폴더 최상위 `@이름` 폴더와 같은 별칭은 거부 |
| F2 | 목록은 `~/.jaydocs/workspaces.json` 에 주 폴더 실제 경로별로 (`mounts` · `recent`). `--mount` 는 이번 실행만, `--config` 로 파일 바꾸기 | 리포를 더럽히지 않는다(D4 와 같은 원칙). 서버가 경로를 허가해야 하므로 localStorage 가 아니라 서버 쪽 |
| F3 | 폴더 고르기 = 경로 붙여넣기 + 사이드카 자동 완성(`/api/fs/dirs`) + Windows 폴더 창(`/api/fs/pick`, PowerShell WinForms) | 브라우저는 폴더의 절대 경로를 주지 않는다. 키보드만으로 끝나는 길이 기본 |
| F4 | 겹치는 폴더(주 폴더·다른 마운트를 품거나 그 안)·드라이브 전체·사용자 폴더 전체 거부. 마운트는 Unity 폴더(`Library` `Temp` `Logs` `obj` `Build(s)` `UserSettings` `MemoryCaptures`)를 빼고 **문서 없는 폴더는 숨기고** 2만 항목에서 멈춘다 | 같은 파일이 두 경로로 열리면 스토어 동기화가 깨진다. Unity Assets 같은 큰 트리 대비 |
| F5 | 형식 표 `src/lib/filetypes.mjs` 한 곳 (`kind`: md · table · text, `lang`, `codec`) | 사이드카·트리·창·새 파일 검사가 같은 표를 읽는다. 형식 추가 = 한 줄 |
| F6 | UTF-8 이 아니면 EUC-KR 로 읽고 **읽기 전용**, "UTF-8 로 바꿔 저장"(CSV 는 BOM 붙임). NUL·UTF-16·5 MB 초과는 열지 않음. 사이드카도 convert 없이 덮어쓰지 않음 | 예전엔 CP949 파일을 열어 저장하면 한글이 조용히 깨졌다. CP949 인코더가 없어 원래 인코딩으로 되쓰지는 않는다 |
| F7 | git 은 주 폴더만 — 가져온 경로는 git API 가 400, 배지·diff·기록 명령 없음 | 가져온 폴더 저장은 되돌릴 수 없다 → 읽기 전용 옵션과 대화창 안내로 보완 |
| F8 | CSV = 같은 그리드·같은 표 모델(`TsvTable.format`), 읽기·쓰기만 `lib/tsv/csv.ts`(RFC 4180). 레코드 원문 + `quoted[]` 로 왕복 보존. 타입 행 없는 CSV 는 첫 줄을 머리글로 | 그리드·되돌리기·찾기·채우기를 다시 만들 필요가 없다. `_Field`·계산식은 TSV 전용으로 둔다 |
| F9 | JSON 은 텍스트 창 + 구문 강조 + 문법 검사, 정렬은 명령으로만, 내용이 바뀌는 정렬(`1.0`, 큰 정수, 중복 키, 숫자 키 순서)은 거부 | 자동 정렬은 diff 를 통째로 바꾼다 |

### 18.3 구조에 생긴 것

- **사이드카**: `PRIMARY` + `MOUNTS`(별칭 → `{ abs, real, readOnly, persist, watcher }`). `resolveSafe(appPath)` → `{ abs, rel, inner, root }`, 쓰기는 `resolveWritable`(읽기 전용 403), git 은 `primaryOnly`. 감시는 루트마다 `watchRoot`(폴더가 사라져도 프로세스는 산다). `decodeText`·`readTextFile` 이 인코딩·바이너리·크기를 본다.
- **스토어**: `encoding` · `setMounts` · `readOnlyReason(path)`(`'mount' | 'encoding' | null`) · `convertToUtf8`. 표 읽기·쓰기는 `lib/tsv/table.ts`(`parseTable(text, path)` · `serializeTable` · `tableOpenWarnings` · `sanitizeFor`).
- **루트 안 해석**: tsv-view `file:` · `/` 링크 · 이미지 · `_Field` 찾기 · 계산식 `lookup` 은 그 문서가 속한 루트 안에서 (`inRootOf`, `sameRoot`). `../` 는 루트 밖으로 못 나간다.
- **화면**: 트리 맨 아래 `@별칭` 노드(🔗/🔒)와 오른쪽 클릭(읽기 전용 · 새로 고침 · 해제 · 탐색기에서 보기), 가져오기 창(`Ctrl+Shift+O`), `ReadOnlyBanner`, 오른쪽 아래 알림. 팔레트에 폴더별 해제·읽기 전용 명령(동적 등록).
- **클립보드**: 줄바꿈·탭이 든 칸만 Sheets·Excel 관행대로 `"…"` 로 주고받는다(그 밖의 `"` 는 글자 그대로 — §2 규칙 유지).

### 18.4 API 추가 (§9 에 더해)

| 메서드 | 경로 | 역할 |
|---|---|---|
| GET | `/api/tree` | 응답에 `mounts: [{ alias, path, readOnly, persist, truncated, entries, error }]` 추가 |
| GET | `/api/file` | 응답에 `encoding` 추가. 415(바이너리·UTF-16) · 413(5 MB 초과) |
| PUT | `/api/file` | 본문 `convert: true` 일 때만 UTF-8 아닌 파일을 덮어쓴다. 읽기 전용 폴더면 403 |
| GET · POST · PATCH · DELETE | `/api/roots` | 목록(+ `recent` · `missing` · `platform`) · 가져오기 `{ path, alias?, readOnly? }` · `?alias=` 읽기 전용 `{ readOnly }` · 해제 |
| POST | `/api/roots/forget` | 최근·못 찾은 목록에서 지우기 `{ path }` |
| GET | `/api/fs/dirs?prefix=` | 하위 폴더 자동 완성(최대 50, 빈 입력이면 드라이브) |
| POST | `/api/fs/pick` | Windows 폴더 고르기 창 → `{ path \| null }` |
| POST | `/api/reveal` | 탐색기에서 보기 `{ path }` (파일은 선택한 채, `@별칭` 은 그 폴더) |

### 18.5 하지 않은 것 · 알려진 한계

- 가져온 폴더의 git(필요해지면 루트별 `rev-parse --show-toplevel` + 리포별 묶음 패널, 약 1일 — PLAN F7 끝).
- 세미콜론 CSV, CSV 의 `_Field`·계산식, `.yaml`·`.mmd` 형식(형식 표에 한 줄씩이면 된다).
- git diff·이전 버전 보기는 `git show` 를 UTF-8 로 읽는다 — CP949 파일의 diff 는 깨져 보인다(변환 저장 뒤엔 정상).
- 자동으로 시험하지 못한 것: PowerShell 폴더 창, 탐색기 열기, 실제 Excel 과의 복사·붙여넣기와 Excel 에서 열기(TC-1203 · 1214 · 1304 · 1305 · 1307).

---

## 19. 머리글 있는 표 붙여넣기 · TC 뒤 수정 (2026-10-25)

TC 156개를 Jay 기억 + Claude 자동 실행으로 채운 뒤(결과는 TESTCASES.md) 데이터를 잃는 ❌ 넷을 고치고, Jay 가 요청한 붙여넣기 기능을 넣었다.

### 19.1 마크다운 표 → 그리드 붙여넣기

| # | 결정 | 근거 |
|---|---|---|
| T1 | **머리글이 있는 표만** 새 경로로: 클립보드 `text/plain` 이 통째로 GFM 파이프 표(머리글 줄 + 구분 줄 + 행)이거나, `text/html` 에 표가 하나 있고 첫 행이 전부 `<th>` 일 때 (`lib/tsv/mdTable.ts`) | Sheets·Excel 은 text/plain 에 탭이 있고 HTML 은 `<td>` 만 써서 걸리지 않는다 → 예전 TSV 붙여넣기(TC-306·403·404) 그대로. md 소스에서 복사한 표, 미리보기·하이브리드에서 복사한 표(브라우저가 HTML 을 같이 준다), GitHub 에서 복사한 표가 같은 결과 |
| T2 | 칸 읽기: 앞뒤 파이프 떼기, 역슬래시로 이스케이프한 파이프는 글자 파이프로, 앞뒤 공백 정리, `<br>` → 칸 안 줄바꿈, 칸 수는 머리글에 맞춤(GFM). 빈 줄·`<!-- … -->` 줄은 건너뜀. tsv-view 표의 줄 번호 칸(`.tsv-view-rownum`)은 뺀다 | bake 가 파이프를 이스케이프하고 줄바꿈을 `<br>` 로 쓰므로(§7) baked 표를 그대로 다시 붙일 수 있다 |
| T3 | 머리글 자리: 활성 행이 **머리글 행이거나 그 위**면 md 머리글은 머리글 행(타입 행 TSV 2행, CSV 1행)에, 데이터는 그 아래부터. **본문**이면 데이터는 활성 행부터, 머리글은 대상 열의 머리글 칸이 **비어 있을 때만** 채운다. 머리글 행이 없는 표(타입 행 없는 TSV)나 빈 표는 머리글도 한 행으로 넣는다 | 본문에 붙일 때 있는 열 이름을 md 쪽 이름으로 덮어쓰면 스키마(`_Field` 블록 짝)가 깨진다. 새로 늘어난 열은 비어 있으니 md 이름이 들어간다 |
| T4 | 표가 넓으면 **끝에 열을 늘린다**(타입 행이 있으면 새 열 타입 `string` — 빈 타입은 주석 열이 되므로). 행은 예전처럼 늘린다. 행이 있는 표에서 열을 늘릴 때는 열 삽입과 같은 확인(git diff 전체 행)을 묻고, 취소하면 예전처럼 잘라 낸다 | 열 삽입은 모든 행을 다시 조립한다(§6.1). Sheets 붙여넣기는 여전히 잘라 낸다 — 열이 늘어나는 건 머리글이 있어 열 이름을 알 때만 |
| T5 | 값은 형식 규칙대로 다듬는다(`sanitizeFor`: TSV 는 탭·줄바꿈 → 공백, CSV 는 칸 안 줄바꿈 유지). 되돌리기 한 번. 붙인 범위를 선택 | 편집 확정·찾아 바꾸기와 같은 규칙 |

### 19.2 TC 에서 나온 ❌ 수정

- **열 삭제 크래시(TC-307·408)** — 열 너비 배열을 effect 가 아니라 렌더 중에 표 너비에 맞춘다(`Grid.tsx`). 덧붙여 그리드를 `PaneErrorBoundary` 로 감쌌다: 렌더 오류가 나도 GridPane 이 남아 문서를 붙잡고 있으므로 flexlayout 오류 화면 → Retry 로 저장 안 한 편집을 잃지 않는다.
- **Alt+W·팔레트 탭 닫기(TC-904)** — `model.doAction` 은 Layout 의 `onAction` 을 거치지 않는다. 저장 확인(`confirmCloseTab`)을 둘이 같이 쓴다.
- **붙여넣기 칸 줄바꿈(TC-1310)** — 붙여넣는 모든 칸이 `sanitizeFor` 를 거친다(위 T5).
- **재시작하면 레이아웃 등이 사라짐(TC-105·412·1211)** — 폴더별 고정 포트(D1).

## 20. 브라우저 앱 전환 (2026-10-31)

Jay 혼자 쓰고 git 은 앱 밖에서 충분하다는 판단으로, 사이드카와 git 기능을 없애고 **Pages 에 배포한 PWA 가 File System Access API 로 로컬 폴더를 직접 읽고 쓰는** 구조로 바꿨다. 이 절이 §0 · §3.4 · §4 · §9 · §10 · §18 의 서버·git 관련 내용보다 우선한다. 요구사항 R7(git)은 앱 범위에서 뺐다.

계기: 실행 파일처럼 보이지 않아 찾기 어렵고, 콘솔 창이 함께 뜨고, 릴리즈마다 손으로 패치해야 했다.

| # | 결정 | 근거 |
|---|---|---|
| B1 | 호스팅: **Node 사이드카 → 정적 PWA** | §3.4 · §5 에서 뺀 이유(isomorphic-git 의 CRLF, `file://` 권한)가 git 제거와 https 배포로 사라졌다. 콘솔·프로세스 관리가 통째로 없어지고, 설치하면 시작 메뉴·전용 창·아이콘이 생긴다 |
| B2 | 기준 브라우저: **Edge PWA** (Chrome 도 동작) | 실측(아래). Edge 는 `move()` 가 되고, Chrome 은 NotAllowedError |
| B3 | 작업 공간 = 주 폴더 + 가져온 폴더, 핸들을 IndexedDB 에 주 폴더별로 저장. 경로 규칙 `@별칭/…` 은 그대로 | 트리·탭·bake 코드를 안 바꾼다. 폴더마다 포트로 나누던 레이아웃은 작업 공간 id 로 나눈다 |
| B4 | 권한이 없으면 시작할 때 허용 화면. 클릭 한 번에 남은 폴더를 차례로 묻고, 브라우저가 막으면 다시 누른다 | 재부팅 뒤 권한이 풀려도 불편에 그치고 데이터 위험은 없다 |
| B5 | 이름 변경: **이름 목록으로 대상 검사**(대소문자 무시) → `move()` → 막히면 복사·바이트 확인·삭제. 대소문자만 바꿀 때는 임시 이름을 거친다 | 실측: Edge `move()` 는 있는 파일을 경고 없이 덮어쓴다. 복사 대상이 곧 원본이 되는 경우 내용을 잃지 않게 |
| B6 | 폴더 이름 변경은 **뺀다**(탐색기에서). 트리는 변경 감지로 따라온다 | 폴더 이동 API 가 없다. 복사 후 삭제는 중간 실패 위험이 크다 |
| B7 | 변경 감지: `FileSystemObserver`, 경로별 150ms 뭉치기, `.crswap` 제외. **창에 돌아올 때 항상 다시 확인**하고, API 가 없으면 5초 주기 | 저장 한 번에 이벤트 4건이 온다. 내 저장은 기존처럼 수정 시각이 같아 걸러진다. 절전 등으로 놓친 변경을 잡는다 |
| B8 | 자동 업데이트: 빌드 때 `sw.js` 생성, 전체 사전 캐시. 새 버전은 대기하다 모든 창이 닫히면 적용, **새 버전 적용** 은 저장 안 한 문서가 있으면 막는다. 직전 버전 캐시는 남긴다 | 편집 중 새로고침 금지. 열려 있는 옛 창이 나중에 불러올 조각을 잃지 않게 |
| B9 | 배포: 이 공개 리포에서 GitHub Actions 로 Pages 에 바로 배포. 주소 `krkoohoo.github.io/JayDocs/` | Jay 결정: 별도 조직·토큰 관리 없이 한 리포로 간다. 대가로 위키·`portfolio-test` 와 오리진을 공유하므로, 그 사이트의 스크립트가 허용한 폴더에 접근할 수 있다. 2026-10-31 첫 화면 기준 외부 스크립트 없음(포트폴리오는 외부 CSS 뿐). 두 사이트에 외부 코드를 넣지 않는 것을 규칙으로 둔다 |
| B10 | 없앤 것: git 패널·배지·diff·기록(표 셀 diff 포함), 탐색기에서 보기, 경로 자동 완성, 절대 경로 표시, 명령줄 옵션, zip 릴리즈 | 브라우저에서 불가능하거나 git 과 함께 빠진다 |

### 20.1 실측 (2026-10-31, Edge 156 · Chrome 156, 임시 시험 페이지)

- 통과: `Documents\GitHub\…` 아래 폴더 선택 · 쓰기, CRLF/BOM/끝 개행/4 MB 바이트 왕복(디스크 해시 일치), 문서 형식 5종 생성, 수정 시각으로 외부 수정 감지, 저장 취소 시 원본 유지, 잠긴 파일(Excel 상황) 저장은 InvalidStateError 로 막히고 원본 유지·재시도 성공.
- 변경 감지: 수정 · 생성 · 이름 변경 · 바꿔치기 저장 1~3 ms, 삭제 약 500 ms, 200개 일괄 변경 200/200. 창이 숨겨져도 1 ms.
- 권한: Edge 탭은 다시 열면 prompt. Edge 앱은 앱에서 허용한 폴더가 재실행 뒤 granted. Chrome 은 앱 설치 후 탭·앱 모두 granted.
- 트리: SAGA `Docs`(문서 120개) 약 0.1초. `Project-SAGA` 전체는 2만 항목 제한까지 6~8초(Node 0.17초).
- `move()`: Edge 성공(사용자 동작 없이도). Chrome 은 사용자 동작이 있어도 NotAllowedError, 복사 후 삭제는 성공.
- 저장 중 `<이름>.crswap` 임시 파일이 생기고 끝나면 사라진다. 저장한 파일에 `Zone.Identifier`(ZoneId=3)가 붙는다.

### 20.2 아직 확인하지 못한 것 (TESTCASES §15)

재부팅 뒤 권한 · Edge 앱에서 폴더 여러 개 유지 · 실제 Pages 주소에서의 권한 동작 · Excel 의 제한된 보기와 신뢰할 수 있는 위치. 앱 쪽 흐름은 `?opfs`(브라우저 안 저장소)로 자동 확인했고, 실제 폴더 선택 창을 거친 앱 전체는 Jay 의 인수 시험에서 본다.

## 15. 출처

- 기성품: VS Code mermaid 확장 https://github.com/mjbvz/vscode-markdown-mermaid · Edit CSV https://github.com/janisdd/vscode-edit-csv · SilverBullet https://docs.silverbullet.md/CHANGELOG · Obsidian 메모리 보고 https://forum.obsidian.md/t/question-about-obsidian-software-performance/75588
- 마크다운: CodeMirror changelog https://codemirror.net/docs/changelog/ · composition 이슈 https://github.com/codemirror/dev/issues?q=is%3Aissue+composition · @atomic-editor/editor https://github.com/kenforthewin/atomic-editor · codemirror-markdown-hybrid https://github.com/tiagosimoes/codemirror-markdown-hybrid · ProseMirror changelog https://prosemirror.net/docs/changelog/ · TipTap markdown https://tiptap.dev/blog/release-notes/introducing-bidirectional-markdown-support-in-tiptap · Milkdown https://github.com/Milkdown/milkdown · MDXEditor code blocks https://mdxeditor.dev/editor/docs/code-blocks · mdast-util-to-markdown https://github.com/syntax-tree/mdast-util-to-markdown
- Mermaid: usage https://mermaid.js.org/config/usage.html · 크기 https://bundlephobia.com/api/size?package=mermaid
- 그리드: Glide https://github.com/glideapps/glide-data-grid (IME #1175) · RevoGrid https://github.com/revolist/revogrid · react-datasheet-grid https://github.com/nick-keller/react-datasheet-grid (#340, #387) · react-data-grid #1702 · Handsontable 라이선스 https://handsontable.com/licensing · AG Grid clipboard https://www.ag-grid.com/react-data-grid/clipboard/ · MUI X clipboard https://mui.com/x/react-data-grid/clipboard/ · jspreadsheet CE #1724 · PapaParse https://www.papaparse.com/docs · csv-parse raw https://csv.js.org/parse/options/raw/
- 전환(§20): 파일 이동 https://groups.google.com/a/chromium.org/g/blink-dev/c/ogS8CeyZ3n8/m/UyYqFPZVAAAJ · Pages 요금제 https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits · 파일 연결 https://learn.microsoft.com/microsoft-edge/progressive-web-apps-chromium/how-to/handle-files
- 셸: FSA https://web.dev/articles/files/open-a-directory · 영구 권한 https://developer.chrome.com/blog/persistent-permissions-for-the-file-system-access-api · FileSystemObserver https://developer.mozilla.org/en-US/docs/Web/API/FileSystemObserver · isomorphic-git https://github.com/isomorphic-git/isomorphic-git · Tauri 요구사항 https://v2.tauri.app/start/prerequisites/ · 서명 https://v2.tauri.app/distribute/sign/windows/ · 단일 exe 크기 https://notes.billmill.org/dev_blog/2026/02/updated_SEA_benchmarks.html
- git UI: @codemirror/merge https://github.com/codemirror/merge · diff2html https://github.com/rtfpessoa/diff2html · daff https://github.com/paulfitz/daff
- 레이아웃: FlexLayout https://github.com/caplin/FlexLayout · dockview https://dockview.dev/ · react-resizable-panels https://github.com/bvaughn/react-resizable-panels
- 결합 문법: Obsidian csv-table https://github.com/coddingtonbear/obsidian-csv-table · SilverBullet Live Queries https://v1.silverbullet.md/Live%20Queries · pandoc-placetable https://github.com/mb21/pandoc-placetable · MyST csv-table https://myst-parser.readthedocs.io/en/latest/syntax/tables.html · Obsidian Bases https://help.obsidian.md/bases/syntax · remark-directive https://github.com/remarkjs/remark-directive · GitHub CSV 렌더 https://docs.github.com/en/enterprise-server@2.19/github/managing-files-in-a-repository/rendering-csv-and-tsv-data
- 게임 툴링: CastleDB https://github.com/ncannasse/castle · Luban https://github.com/focus-creative-games/luban · ExcelToUnity https://github.com/hnb-rabear/excel-to-unity · BakingSheet https://openupm.com/packages/com.cathei.bakingsheet/ · Table Schema https://datapackage.org/standard/table-schema/
