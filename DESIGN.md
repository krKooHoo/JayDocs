# JayDocs — Markdown + TSV 결합 편집기 설계

작성 2026-10-11 · 상태 **설계 확정 (같은 날 피드백 반영, §13)** · 2026-10-21 폴더 가져오기·형식 확장 추가(§18) · 위치 독립 리포 `JayDocs` (2026-10-25 `JayTools/JayDocs/` 에서 기록째 분리) · 2026-10-31 브라우저 앱 전환(§20)

> **절 안내**: 번호는 다른 문서의 `§n` 참조 때문에 바꾸지 않았다. **§15(출처)는 맨 끝(§24 뒤)** 에 있다. 현재 구조는 §20 이후가 우선한다 — §20 브라우저 앱 전환 · §21 폴더 별칭 · 탐색기 · §22 업데이트 확인(U8~U10 증분 업데이트) · §23 하이브리드 표 칸 편집 · §24 최적화 · 키보드 흐름. 2026-10-31 전환으로 없어진 절은 맨 위에 "폐기 — §20 참조" 가 달려 있다(내용은 지우지 않았다).
>
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

> 일부 폐기 — 호스팅 · diff · TSV 셀 diff 행은 §20 참조(선택한 구현이 바뀌었다). 레이아웃 행은 그대로 유효하다.

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

> 폐기 — §20 참조. 사이드카 · git 패널 · `/api` · `/ws` 는 없어졌다. DocumentStore 와 페인 구조는 그대로 유효하다(백엔드는 `lib/fsa/fsaBackend.ts`).

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

> 폐기 — §20 참조(B1 · B2). Node 사이드카 · 고정 포트 · 토큰은 없어지고 Edge PWA + File System Access 로 바뀌었다.

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

> 폐기 — §20 참조(B10). git 기능은 앱 범위에서 뺐다. git 은 앱 밖에서 쓴다.

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

> 일부 폐기 — 아래 그림의 git 패널 · 배지(`M/A/?`) · `Ctrl+Enter` 커밋은 §20 B10 에서 없앴다. 나머지(탭 · 분할 · 그리드 표시)는 유효하다.

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
- 단축키: `Ctrl+S` 저장 · `Ctrl+Shift+S` 모두 저장 · `Ctrl+P` 파일 검색 · `Ctrl+\` 오른쪽에 분할 · `Ctrl+Z/Y` · `F2`/`Enter` 셀 편집 · `Esc` 취소 · `Ctrl+Enter` 커밋.
- 그리드: 헤더 2행 고정, 주석 열 회색, enum 셀은 드롭다운(리스트 셀은 다중 선택), bool은 체크박스, 오류 셀 빨간 밑줄, 열 머리 호버에 Field 설명.

---

## 9. 사이드카 API 초안

> 폐기 — §20 참조. 서버가 없어 이 API 는 없다. 같은 역할은 `Backend` 인터페이스(`lib/backend.ts`)와 `lib/fsa/fsaBackend.ts` 가 한다.

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

> 폐기 — §20 참조. `server.mjs` · `start.cmd` · `bin/jaydocs.mjs` · `npm run pack` · zip 릴리즈는 없어졌다. 현재 구조 · 실행 · 배포는 [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

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

> Phase 0 의 사이드카 · Phase 2 의 git 항목은 폐기 — §20 참조. 당시 달성 기록으로 남긴다.

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

> 사이드카 · Edge 앱 모드 · git 관련 행은 폐기 — §20 참조.

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
| 4 | 단축키를 md 로 보관, 키보드로 모든 작업 | **`src/lib/shortcuts-table.mjs` 한 곳**이 원본. `npm run shortcuts` 가 `SHORTCUTS.md` 를 만들고, 테스트가 둘이 같은지 검사한다. 앱의 F1 도움말과 전역 키 처리기(`commandByCombo`)도 같은 표를 읽는다. 키보드 전부: **명령 팔레트(Ctrl+Shift+P)** 가 등록된 모든 명령을 글자로 실행, **파일 검색(Ctrl+P, 트리 위 🔍 버튼 — 옛 이름 "빠른 열기")**, 탭 이동(Alt+[ ] / Alt+1~9 / Alt+W), 패널 접기·포커스(Ctrl+B · Ctrl+J · Ctrl+Shift+E/G/M), 트리 키보드 탐색(방향키·Enter·F2·Delete·Shift+F10), 보기 모드 순환(Ctrl+Shift+V), diff/기록(Ctrl+Shift+F/H). 브라우저가 가로채는 조합(Ctrl+W/T/N/Tab/숫자)은 피했다 |

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

> 서버 관련 내용(F2 · F3 · F7, §18.3 의 사이드카 항목, §18.4 API 전체, §18.5 의 git 항목)은 폐기 — §20 참조. 폴더 가져오기 자체는 §20 B3 · §21 로 이어진다.

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
- **재시작하면 레이아웃 등이 사라짐(TC-105·412·1211)** — 폴더별 고정 포트(D1). (§20 이후 서버와 포트가 없어졌다 — 레이아웃은 작업 공간 id 별로 저장, B3.)

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
| B10 | 없앤 것: git 패널·배지·diff·기록(표 셀 diff 포함), 탐색기에서 보기(§21 에서 도우미로 되살림), 경로 자동 완성, 절대 경로 표시(§21 에서 입력 방식으로 되살림), 명령줄 옵션, zip 릴리즈 | 브라우저에서 불가능하거나 git 과 함께 빠진다 |

### 20.1 실측 (2026-10-31, Edge 156 · Chrome 156, 임시 시험 페이지)

- 통과: `Documents\GitHub\…` 아래 폴더 선택 · 쓰기, CRLF/BOM/끝 개행/4 MB 바이트 왕복(디스크 해시 일치), 문서 형식 5종 생성, 수정 시각으로 외부 수정 감지, 저장 취소 시 원본 유지, 잠긴 파일(Excel 상황) 저장은 InvalidStateError 로 막히고 원본 유지·재시도 성공.
- 변경 감지: 수정 · 생성 · 이름 변경 · 바꿔치기 저장 1~3 ms, 삭제 약 500 ms, 200개 일괄 변경 200/200. 창이 숨겨져도 1 ms.
- 권한: Edge 탭은 다시 열면 prompt. Edge 앱은 앱에서 허용한 폴더가 재실행 뒤 granted. Chrome 은 앱 설치 후 탭·앱 모두 granted.
- 트리: SAGA `Docs`(문서 120개) 약 0.1초. `Project-SAGA` 전체는 2만 항목 제한까지 6~8초(Node 0.17초).
- `move()`: Edge 성공(사용자 동작 없이도). Chrome 은 사용자 동작이 있어도 NotAllowedError, 복사 후 삭제는 성공.
- 저장 중 `<이름>.crswap` 임시 파일이 생기고 끝나면 사라진다. 저장한 파일에 `Zone.Identifier`(ZoneId=3)가 붙는다.

### 20.2 아직 확인하지 못한 것 (TESTCASES §15)

재부팅 뒤 권한 · Edge 앱에서 폴더 여러 개 유지 · 실제 Pages 주소에서의 권한 동작 · Excel 의 제한된 보기와 신뢰할 수 있는 위치. 앱 쪽 흐름은 `?opfs`(브라우저 안 저장소)로 자동 확인했고, 실제 폴더 선택 창을 거친 앱 전체는 Jay 의 인수 시험에서 본다.

## 21. 폴더 별칭 · 상세 경로 · 최근 폴더 · 파일 탐색기 열기 (2026-11-01)

§20 B10 에서 없앤 "절대 경로 표시" 와 "탐색기에서 보기" 를 사용 피드백으로 되살렸다. 브라우저 제한은 그대로라, 경로는 사용자에게 받고 탐색기는 PC 쪽 도우미로 연다.

| # | 결정 | 근거 |
|---|---|---|
| P1 | 상세 경로는 사용자가 넣는다. 경로 끝이 고른 폴더 이름과 맞을 때만 저장(대소문자 · NFC/NFD 무시). 비어 있어도 앱은 돈다 | 브라우저는 폴더 이름만 준다. 전체 경로를 검증할 방법이 없어 끝 이름으로 오타와 다른 폴더를 거른다 |
| P2 | 입력을 줄이려고 아는 경로의 옆 폴더로 미리 채우고, 추측임을 표시한다 | 문서 폴더가 `Documents\GitHub` 처럼 한곳에 모여 있다. 틀리면 고치면 되고, 끝 이름은 맞으므로 도우미가 "경로를 열 수 없습니다" 로 알린다 |
| P3 | 최근 폴더 = 작업 공간을 `openedAt` 최근 순으로 10개. 넘치면 가장 오래된 작업 공간 기록을 지운다(폴더 · 파일은 그대로). 별칭은 자유 문구이고 앱 경로에 쓰이지 않는다 | Jay 요청. 가져온 폴더의 `@별칭` 은 앱 경로와 레이아웃의 일부라 경로만 고칠 수 있다 |
| P4 | 탐색기는 `jaydocs-open:` 주소를 사용자 계정에 등록한 연결 도우미로 연다. 설치는 PC 마다 한 번, 관리자 권한 불필요, 상주 프로세스 없음 | 웹 페이지는 탐색기를 열 수 없고 `file:` 링크도 막힌다. 서버(§20 에서 없앤 것) · 브라우저 확장보다 작다 |
| P5 | 도우미는 로컬 드라이브 경로만 받는다. 폴더는 열고, 파일은 `/select` 로 선택만 한다. `\\서버` 와 따옴표는 거부 | 어느 웹페이지든 이 주소를 부를 수 있다. 실행이 없어야 하고, 네트워크 경로는 Windows 자격 증명을 그 서버로 보낼 수 있다 |
| P6 | 도우미는 설치와 실행을 겸하는 파일 하나(배치 + JScript). wscript 로 돌아 콘솔 창이 뜨지 않는다. CRLF 는 `.gitattributes` 로 고정 | 웹에서 파일 하나로 받아야 한다. 리눅스에서 빌드해도 줄바꿈이 유지된다 |
| P7 | 주소는 숨은 iframe 으로 부른다 | `location` 을 바꾸면 `beforeunload` 가 불려 저장 안 한 문서 경고가 뜰 수 있다 |
| P8 | 설치 여부는 페이지에서 알 수 없어, "설치했습니다" 를 PC · 브라우저별로 기억한다. 눌렀는데 창이 넘어가지 않으면 2.5초 뒤 도우미를 확인하라고 알린다 | 없는 주소는 브라우저가 조용히 무시한다 |
| P9 | **전체 경로 복사** 를 함께 둔다. 탐색기 열기는 Windows 만 | 설치 없이 쓰는 길이자 Mac 에서 되는 유일한 길 |

### 21.1 확인한 것

- 도우미: 실제 wscript 와 Explorer 로 폴더 열기, 파일 선택(`문서 a&b.md`, `탐색기 시험 50%&a` 폴더), `.cmd` 파일은 실행 안 함, 없는 경로 · UNC · 상대 경로 거부. 설치와 제거는 효력 없는 시험 키(`HKCU\Software\JayDocsSetupTest`)로 돌려 등록 값과 그 명령의 동작을 확인했다.
- 앱: 내장 브라우저에 OPFS 폴더로 입력 · 검증 · 미리 채우기 · 최근 순서 · 10개 제한 · 허용 화면 · 메뉴 · 숨은 iframe 주소(`beforeunload` 0회)를 확인했다.

### 21.2 아직 확인하지 못한 것 (TESTCASES §16)

Edge 가 실제로 `jaydocs-open:` 을 도우미로 넘기는 마지막 단계(확인 창 · 항상 허용 · 앱 창에서의 동작), Explorer 창이 앞으로 나오는지, 내려받은 도우미의 Windows 보호 창, 실제 클립보드 복사(내장 브라우저는 권한이 막혀 있어 성공 경로는 대체 함수로 봤다).

## 22. 앱에서 업데이트 확인 (2026-11-01)

Jay 는 브라우저보다 설치한 앱으로 쓴다. 앱 창에는 새로고침 버튼이 없고, §20 B8 의 흐름은 새 버전을 받기 전까지 화면에 아무것도 보이지 않았다.

| # | 결정 | 근거 |
|---|---|---|
| U1 | 확인 시점: 앱을 켤 때 · 창으로 돌아올 때(10분 간격) · 1시간마다 · **업데이트 확인** 을 눌렀을 때 | 앱을 오래 켜 두는 쓰임에 맞춘다. 창 전환이 잦아 간격을 둔다 |
| U2 | 버튼 하나가 상태를 보여 준다: 업데이트 확인 → 확인 중 → 새 버전 받는 중 → 새 버전 적용. 시작 · 허용 화면에도 둔다 | 받는 일은 서비스 워커가 알아서 하므로 사용자는 진행과 적용만 보면 된다. 폴더를 열기 전에도 적용할 수 있어야 한다 |
| U3 | 받기 실패(파일 하나라도 못 받음)는 **다시 받기** 로 보여 주고, 지금 버전은 그대로 돈다 | `cache.addAll` 이 전부 아니면 전무라 서비스 워커가 버려질 뿐이다. 다시 확인하면 같은 파일을 다시 받는다 |
| U4 | 이미 최신일 때 강제로 다시 받는 기능은 **두지 않는다** | 캐시에 없는 파일은 네트워크로 받으므로 고칠 일이 드물다. 캐시를 지운 뒤 인터넷이 끊겨 있으면 앱이 뜨지 않는 위험만 는다 |
| U5 | 화면 버전은 `빌드 날짜 · 커밋 7자리`. 로컬 빌드는 `로컬 빌드` | 어느 커밋인지 바로 안다. 저장소 내용 해시(`BUILD`)는 사람이 읽을 수 없다 |
| U6 | 다른 창이 먼저 적용했으면 **새 버전 적용** 은 다시 불러오기만 한다 | 이미 활성화된 서비스 워커에는 skipWaiting 이 듣지 않아 버튼이 아무 일도 안 하게 된다 |
| U7 | 새 버전 파일은 HTTP 캐시를 건너뛰고 받는다(`cache: 'reload'`) | Pages 는 `index.html` 에도 `max-age=600` 을 준다. 10분 안에 다시 받으면 옛 `index.html` 이 새 캐시에 담겨, 적용해도 옛 화면이 열리고 "최신" 이라고 나온다. d2fb5a2 배포 뒤 실제 주소에서 발견했고 `vite preview` 에는 이 헤더가 없어 앞선 시험에 안 잡혔다. 같은 헤더의 시험 서버로 재현 후 수정을 확인했다 |
| U8 | (2026-11-17) 청크 분리: 첫 화면 라이브러리 → `vendor`, 가상 모듈(Vite 프리로드 도우미 등) → `vite-helpers`, rolldown 런타임은 rolldown 이 `rolldown-runtime` 으로 뺀다. mermaid 는 지연 로드 그대로 자동 분할 | mermaid 청크 97개 중 10개가 런타임 · 프리로드 도우미 때문에 `index` 를 import 해, 앱 한 줄만 바꿔도 86개 이름이 바뀌었다. 도우미를 vendor 와도 떼어 라이브러리 쓰임이 바뀌어도 mermaid 쪽은 남는다 |
| U9 | (2026-11-17) 새 버전 설치 때 `assets/<이름>-<8자 해시>.<확장자>` 파일은 이전 버전 캐시에 같은 주소가 있으면 복사하고, 나머지(`./` · index.html · manifest · 아이콘 · helper/)는 항상 `cache: 'reload'` 로 받는다. `public/assets/` 가 있으면 빌드를 멈춘다 | 해시 든 이름은 내용이 같을 때만 같다. public/ 의 파일은 이름이 같아도 내용이 바뀔 수 있다 |
| U10 | (2026-11-17) 하나라도 못 받으면 새 캐시를 지우고 install 을 실패시킨다(`addAll` 과 같은 결과 — U3 그대로). BUILD 해시에 `gen-sw.mjs` 자체를 넣는다 | 반쯤 찬 캐시가 activate 정리에서 "바로 전 버전" 자리를 차지하지 않게. sw 템플릿만 바뀐 빌드가 지금 쓰는 캐시 이름과 겹치지 않게 |

확인(`vite preview` + 내장 브라우저, 빌드를 바꿔 새 버전 흉내): 최신 안내, 확인 → 받기 → 적용 → 새 버전으로 재시작, 앱을 켤 때 자동 감지, 창으로 돌아올 때 10분 전에는 안 묻고 뒤에는 감지, 받기 실패 → 다시 받기(두 번), 서버를 끈 상태의 안내와 새로고침, 저장 안 한 문서가 있으면 적용 차단, 저장 뒤 적용(문서 내용 유지). 실제 Pages 주소와 설치한 Edge 앱에서는 다음 배포 때 TC-1513 · TC-1701 로 본다.

증분 업데이트(U8~U10) 측정 — 앱 문구 한 줄만 바꾼 두 빌드: 새로 받는 파일 86개 4.75 MB(gzip 1.44) → 7개 0.20 MB(gzip 0.07, `index-*.js` + 해시 없는 6개). 앱이 라이브러리 export 하나를 새로 쓰면 8개 1.22 MB(vendor + index). `index` 청크 1,253 kB → 183 kB(JS 합계는 그대로). 확인(`vite preview`): 업데이트 · 적용 · 오프라인 · 받기 실패 · 옛 서비스 워커에서 넘어오기. **이 버전으로 넘어오는 첫 업데이트는 청크 이름이 다 바뀌어 전체(약 6 MB)를 한 번 받는다** — 줄어드는 것은 그 다음 배포부터이고, 실제 주소에서는 TC-1810 으로 본다.

## 23. 하이브리드: 표 칸 편집 · 코드 블록 (2026-11-16)

하이브리드에서 표는 렌더만 되고, 고치려면 **원문** 으로 돌아가 파이프 원문을 만져야 했다. ``` 코드 블록은 원문 그대로 보였다.

| # | 결정 | 근거 |
|---|---|---|
| H1 | 표 칸을 누르면 그 칸만 입력 칸이 된다. 나머지 칸은 렌더된 글자(굵게·링크·코드) | 칸 하나만 원문(`**기본**`)을 보이면 서식을 잃지 않고 고칠 수 있다. 표 전체를 원문으로 바꾸는 지금 방식은 그대로 둔다(**원문** 버튼) |
| H2 | 입력은 글자마다 문서에 바로 들어간다(`input.type`). 한글 조합 중에는 보내지 않고 조합이 끝날 때 보낸다 | 되돌리기 · 저장 표시 · 분할 창 미리보기가 따로 손대지 않아도 따라온다. 조합 중에 문서를 바꾸면 조합이 깨진다 |
| H3 | 바꾸는 범위는 **그 칸의 글자뿐** (`lib/md/tableEdit.ts`). 다른 칸의 정렬 공백, 앞뒤 `\|` 유무는 그대로. 빈 칸에 넣으면 ` x `, 줄에 없는 칸은 줄 끝에 덧붙인다. 입력한 `\|` 는 `\\|` 로 | diff 가 칸 하나로 끝난다. 표를 통째로 다시 쓰면 손으로 맞춘 정렬이 매번 깨진다 |
| H4 | 문서가 바뀌어도 표 위젯 DOM 은 다시 만들지 않는다(`WidgetType.updateDOM`). 같은 React 트리에 새 원문만 넘긴다 | 다시 만들면 입력 칸이 사라져 포커스와 조합이 끊긴다 |
| H5 | 키: Tab / Shift+Tab 다음·이전 칸(마지막 칸에서 Tab 은 새 행), Enter · ↓ 아래 칸(마지막 행이면 표를 떠난다), ↑ 위 칸, Esc 에디터로. Ctrl+Z / Y 는 문서 되돌리기(스크롤은 그대로). 위젯 머리의 **＋ 행** 으로도 행을 붙인다 | Sheets · Notion 과 같은 손버릇. 되돌리기는 커서(표 밖)로 화면이 튀지 않게 `scrollSnapshot` 으로 붙든다 |
| H6 | 열 추가 · 삭제, 행 삭제 · 이동은 **넣지 않는다** — 원문에서 | 요청은 "글자 입력". 구조 편집은 정렬행(`:---:`)까지 맞춰야 해 따로 다룬다 |
| H7 | ``` 코드 블록(mermaid · tsv-view 제외)은 위젯으로 바꾸지 않는다. 글자는 그대로 두고 줄마다 미리보기의 `pre` 모양(고정폭 · 코드 배경 · 둥근 모서리)을 입힌다. 커서가 밖이면 펜스 줄은 언어 이름만 작게, 닫는 펜스는 비운다 | 위젯으로 바꾸면 고칠 때마다 원문으로 돌아가야 한다(mermaid 처럼). 줄 장식이면 코드를 그 자리에서 CodeMirror 그대로 고친다 — 한글 조합 · 되돌리기 · 찾기가 다 된다. 펜스 줄을 없애지 않고 줄여만 두어 커서가 들어올 때 화면이 덜 움직인다 |
| H8 | 코드 블록 문법 색은 **넣지 않는다** | 미리보기도 색이 없다. 넣으려면 `@codemirror/language-data`(언어별 지연 로드) 의존성이 는다 |

확인(dev `?opfs` + 내장 브라우저): 빈 칸에 입력 → 문서 반영 · 저장 표시, Tab 으로 다음 칸 → 마지막 칸에서 새 행, 칸에서 Ctrl+Z(새 행째 되돌림 → 포커스가 에디터로) · Ctrl+Y, Esc, 칸에서 Ctrl+S 저장, 한글 조합 흉내(조합 중엔 문서 그대로, 끝나면 반영), 코드 블록 안 클릭 → 펜스가 보이고 그 자리 편집, 밖이면 언어 이름만, mermaid 위젯 그대로, 라이트 · 다크. 실제 IME(키보드로 한글 입력)는 직접 쳐 봐야 한다.

## 24. 최적화 · 키보드 흐름 (2026-11-17)

리포 · 코드 · 단축키 · UI · UX 를 한 번 훑어 나온 것 가운데 1차 묶음. 서로 다른 파일을 만지는 다섯 갈래(미리보기 · 하이브리드, 키보드, 그리드 · 계산식, 서비스 워커, 리포 정리)로 나눠 고쳤다. 서비스 워커 쪽 결정은 §22 U8~U10.

### 24.1 스토어 · 미리보기 · 하이브리드

| # | 결정 | 근거 |
|---|---|---|
| P1 | 그 자리 보기(tsv-view)가 놓은 **저장 안 한 문서는 스토어에 남는다** — `store.release(path, { keepDirty: true })`. tsv-view 만 이렇게 놓는다. 저장하거나 디스크 내용을 받으면 그때 내린다 | tsv-view 에서 칸을 고친 뒤 md 탭을 닫거나 소스 모드로 바꾸면 표를 쥔 창이 없어 문서가 내려가고 편집이 사라졌다. 남은 문서는 "모두 저장" 개수 · beforeunload · 트리 ● 에 들고, 트리에서 열면 고친 내용이 보인다 |
| P2 | 탭(그리드 · md 창)의 release 는 지금처럼 dirty 여도 내린다 | 탭은 닫기 확인("버리고 닫을까요?")을 거친다. 모든 release 가 dirty 를 남기면 "버리고 닫기" 가 안 버려진다 |
| P3 | 문서를 내리는 결정은 마이크로태스크 하나 뒤. 그 사이 다시 retain 하면 취소 | StrictMode 의 effect 두 번 실행(retain → release → retain)에서 남겨 둔 편집을 잃었다 |
| P4 | 미리보기: 디바운스를 `d.text`(불변 Text 객체)에 걸고 `toString` · `stripBaked` 는 memo 안에서, `<ReactMarkdown>` 엘리먼트는 `useMemo`. `REMARK_PLUGINS` 는 모듈 상수 | 스토어 버전이 바뀔 때마다(글자마다) 전체를 다시 파싱했다. 300줄 md 에 10글자: 22회 303 ms → 2회 37 ms |
| P5 | mermaid SVG 는 모듈 수준 LRU 캐시(40개, 키 `테마 + 코드`). 꺼낼 때 SVG 안 id 를 새로 매긴다 | 글자를 칠 때마다 그림을 다시 그렸다. id 를 새로 매기지 않으면 같은 그림이 두 곳에 떴을 때 marker id 가 겹친다 |
| P6 | 하이브리드 표 `Cell` 은 `memo` | 8열 × 25행 표에서 한 글자당 칸 렌더 207회 → 0회 |
| P7 | 하이브리드 블록 위젯은 margin 을 쓰지 않는다 — 바깥 `.cm-hybrid-block` 은 padding, 테두리는 안쪽 `.cm-hybrid-box` | CM 높이 맵이 margin 을 세지 않아 블록이 여럿 보이면 ↑ 가 멀리 점프했다(TC-210) |
| P8 | tsv-view `where` 의 열 이름은 유니코드 글자(`\p{L}`) · 숫자로 시작할 수 있다 (`지형 == "산"`, `3층 == "예"`) | 한글 열 이름을 못 읽었다(TC-1308) |
| P9 | bake: `where` 가 틀리면 그 펜스는 건너뛰고 기존 baked 표를 둔다(오류 배너만). 없는 열(`columns`) 오류는 예전처럼 남은 열로 쓴다 | 걸러지지 않은 표를 그대로 써 넣었다(TC-1309) |

남은 빈틈: P1 로 창 없이 남은 표가 바깥에서 바뀌어 충돌하면 "모두 저장" 이 그 파일을 건너뛴다. 트리에서 열면 충돌 배너가 뜨므로 데이터는 잃지 않는다.

### 24.2 그리드 · 계산식

| # | 결정 | 근거 |
|---|---|---|
| P10 | lookup 대상 표는 키 → 행 색인(`LookupIndex`)을 한 번 만들어 쓴다. 캐시 조회가 `lookupTables` 보다 먼저 | 행마다 대상 표를 훑었다. 300행 × lookup(300×20): 셀 확정 179 → 13 ms, F9 180~200 → 12~14 ms |
| P11 | enum 허용 값 `Set` 은 열 객체당 한 번(`WeakMap`) | 셀마다 새로 만들었다 |
| P12 | `stabilizeSchema(prev, next)` — 내용이 같은 열 객체는 이전 것을 재사용한다 | 셀 하나를 고칠 때마다 스키마 객체가 새로 생겨 보이는 행 전부의 `memo` 가 깨졌다 |
| P13 | 그리드 찾기 입력은 `useDeferredValue` 로 미루고, 세는 동안 개수 칸은 `…` | 2만 행 표에서 글자마다 45~65 ms 가 입력을 막았다 → 2 ms |
| P14 | 증분 검증은 **아직 안 넣었다** | 2만 × 30 표의 셀 확정 135 ms 는 대부분 `validateTable` 전체 재검증. 평소 규모(300 × 20)는 14 ms 라 급하지 않다 |

수치는 모두 dev 빌드(React 개발 모드), 내장 브라우저에서 페인트를 뺀 값이다. 2만 × 30: 셀 확정 266 → 135 ms, 스크롤 19.7 → 8.2 ms. 300 × 20: 셀 확정 30 → 14 ms.

### 24.3 키보드 흐름

| # | 결정 | 근거 |
|---|---|---|
| K1 | `F6` / `Shift+F6` 으로 트리 → 문서 있는 탭 묶음을 차례로 돈다 (`nextPane` / `prevPane`) | 분할한 창 사이를 키보드로 오갈 방법이 없었다. Windows 의 창 영역 이동 키와 같다 |
| K2 | 탭으로 포커스를 줄 때 창은 **탭 id** 로 찾는다(문서 창을 `data-tab-id` 로 감쌈). 경로로 찾지 않는다 | 같은 문서를 분할해 두면 경로가 같아 엉뚱한 창이 포커스를 가져갔다 |
| K3 | 팔레트로 명령을 실행한 뒤 포커스가 body 이고 다른 오버레이가 없으면 편집기로 돌려준다. JSON 정렬 버튼도 편집기로 돌려준다 | 명령 직후의 Ctrl+Z 가 숨은 다른 탭을 되돌렸다(TC-1108 · 801) |
| K4 | 트리 메뉴: 열리면 첫 항목에 포커스, ↑↓ · Home / End · Enter, Esc 는 트리로 복귀. 새 파일 · 새 폴더(`Ctrl+Alt+N`)는 트리에서 마지막으로 고른 폴더에 만든다 | `Shift+F10` 으로 열어도 방향키가 안 먹었고, 닫으면 포커스가 body 로 빠졌다 |
| K5 | 마크다운 찾기 패널은 한글(`EditorState.phrases`), 위쪽(`search({ top: true })`). `Ctrl+Shift+Z` 다시 실행 추가 | 그리드 찾기는 한글 · 위쪽인데 마크다운만 영어 · 아래쪽이었다 |
| K6 | 버튼 툴팁의 단축키는 명령 표에서 가져온다 — `tip('문구', '명령id')`. 도움말(F1)에 검색 칸 | 툴팁에 손으로 적은 키가 표와 어긋났다(모드 순환 순서 등) |

`F6` 이 Edge 설치 앱 창에서 브라우저에 먼저 가로채이는지는 아직 못 봤다(TC-1809). 가로채이면 키를 바꾼다. 미리보기 전용 모드는 포커스를 받을 곳이 없어 K1 순환에서 편집기가 보이는 모드만 완전하다 — 다음 묶음.

### 24.4 다음 묶음 (아직 안 함)

1. ~~**스토어 경로별 구독**~~ — 끝(2026-11-17, §24.5). 전역 버전 하나를 모든 창이 구독해 키 하나에 앱 전체가 다시 그려지던 것.
2. ~~**대화상자 · 알림 통일**~~ — 끝(2026-11-17, §24.6). `window.prompt` / `alert` / `confirm` 26곳을 앱 대화상자와 알림 줄로, 알림 네 갈래(배너 · 상태 글자 · notice · alert)를 한 규칙으로. 열 조작 확인 창은 알림 + 되돌리기로.
3. **남은 UX** — 미리보기 전용 모드 포커스, 탭을 눌렀을 때 그 창으로 포커스, 탭이 없을 때의 빈 화면 안내, 팔레트 최근 순, 트리 펼침 상태 저장, 아이콘 · 중복 버튼 정리, 증분 검증(P14), 린트(oxlint — typescript-eslint 는 TypeScript 7 을 지원하지 않는다).

### 24.5 스토어 경로별 구독 (2026-11-17, 2차 묶음 ①)

`store/documents.ts` 는 전역 버전 숫자 하나를 올렸고 `useStoreVersion()` 을 부르는 여섯 곳(App · Workbench · MarkdownPane · PreviewPane · TsvView · GridPane)이 모두 다시 그려졌다. §24.1 · §24.2 의 memo 는 그 비용만 줄였다. 전역 버전과 `useStoreVersion()` 을 없애고, 무엇이 바뀌었는지에 따라 따로 알린다. 화면에 보이는 동작은 바꾸지 않았다.

| # | 결정 | 근거 |
|---|---|---|
| P15 | 구독은 네 갈래: **경로**(`subscribePath` / `pathVersion`), **dirty 집합**(`subscribeDirty` / `dirtySnapshot`), **Field**(`subscribeFields`), **트리**(`subscribeTree`). 문서를 고치는 모든 곳은 끝에 `touch(path)` 하나를 부른다 | 창이 읽는 값은 이 넷으로 나뉜다 — 문서 하나의 상태, 여러 문서에 걸친 dirty, 스키마에 쓰는 Field 파일들(`fieldFiles()`), 파일이 있는지(`hasPath()`) |
| P16 | `useSyncExternalStore` 의 스냅샷은 경로별 **버전 숫자**. 숫자는 스토어 전체에서 하나씩 올라가는 일련번호에서 받고, 경로별 값은 지우지 않는다. 여러 경로(`useDocVersions`)는 버전을 이은 문자열 | 매번 새 객체를 주면 무한 렌더. 경로마다 0 부터 세면 문서가 내려갔다 다시 열릴 때 같은 값이 다시 나와 변경을 놓친다. 남는 것은 열어 본 경로마다 숫자 하나 |
| P17 | dirty 집합은 `touch` 가 **그 경로만** 다시 따져, 구성이 달라질 때만 새 `Set` 을 만들고 알린다. 닫기 전 경고 · 이름 바꾸기 · 삭제를 막는 `anyDirty()` · `dirtyPaths()` 는 예전처럼 그 자리에서 센다 | "모두 저장 (N)" · 트리와 탭의 ● 는 글자를 더 쳐도 그대로다. 데이터를 지키는 검사는 구독용 값에 기대지 않게 둘을 나눴다(테스트가 두 값이 같은지 본다) |
| P18 | 창은 **읽는 것만** 구독한다 — MarkdownPane · PreviewPane · ReadOnlyBanner: 자기 경로. TsvView: 표 파일 + Field. GridPane: 표 + Field + 트리 + 계산식 파일 + lookup 대상 표들. App: dirty 집합. Workbench: dirty 집합 + 활성 문서(P20) | 미리보기의 `tsv-view` 는 표 파일을, 그리드는 `_Field` · `X_Calc.tsv` · lookup 대상 표를 읽는다. 열려 있지 않은 표(보조 표 캐시)도 읽히거나 바깥에서 바뀌면 같은 경로로 알린다 |
| P19 | **넓게 남긴 구독**: ① Field 문서는 무엇이 바뀌든(저장 중 표시까지) `fieldFiles()` 를 읽는 모든 그리드 · tsv-view 를 깨운다. ② 가져온 폴더의 읽기 전용이 바뀌면 열린 문서 전부를 깨운다. ③ dirty 집합이나 활성 문서가 바뀌면 Workbench 가 다시 그려지고 탭 내용 전부가 한 번 다시 그려진다 | ① 어느 표가 어느 Field 블록을 쓰는지는 리포 전체를 훑어 정해져 가려내기 어렵다. `fieldFiles()` 가 같은 배열을 주면 스키마를 다시 유도하지 않으니 렌더 한 번으로 끝난다. ② 드문 일이다. ③ flexlayout 이 부모가 다시 그려질 때 탭 내용을 통째로 무효화한다 — 글자마다가 아니라 첫 편집 · 저장 · 탭 전환 때뿐이다. 갱신이 빠지는 것보다 렌더가 한 번 더 도는 쪽을 골랐다 |
| P20 | Workbench 는 모델이 바뀔 때(`onModelChange`) 활성 문서 경로를 state 로 받는다. 트리의 강조는 이 값을 쓴다 | flexlayout 0.11 은 탭 내용(`TabContentRenderer`, memo)을 부모가 다시 그려질 때만 다시 그린다. 트리 강조는 스토어가 바뀔 때마다 Workbench 가 다시 그려져서 (늦게) 따라오고 있었다 — 수정 전에도 탭 제목을 눌러 창을 바꾸면 다음 스토어 변경까지 강조가 옛 문서에 남았다. 그 렌더가 없어지므로 직접 받는다 |
| P21 | 바깥에서 바뀐 보조 표를 다시 읽다 실패하면(지워짐) 그 경로를 한 번 깨운다(`ensureAux(path, true)` — `handleExternal` 만). 트리에서 사라진 파일의 캐시를 버릴 때도 깨운다 | 예전에는 다음 전역 변경 때 저절로 반영됐다. 평소 읽기 실패까지 알리면 렌더 → `auxTable` → 실패 → 알림이 돈다 |

렌더 횟수(dev `?opfs`, 내장 브라우저. 창 셋 — `아이템.md` 분할(안에 `tsv-view`) · `Item_Table.tsv` 그리드 · `개요.md` 분할. 글자 · 셀을 60 ms 간격으로 10번, 커밋된 렌더를 셌다):

| 동작 | 전 | 후 |
|---|---|---|
| `개요.md` 에 10글자 | 열 개 컴포넌트가 10~11회씩, 합 101 | `개요.md` 의 MarkdownPane 10 · PreviewPane 11, 나머지 0 — 합 21 |
| `아이템.md` 에 10글자 | 합 102 | 그 문서의 MarkdownPane 10 · PreviewPane 11 · TsvView 1, 나머지 0 — 합 22 |
| `Item_Table.tsv` 셀 10번 | 합 100 | GridPane 10 · Grid 10 · 그 표를 보는 TsvView 10, 나머지 0 — 합 30 |

"전" 의 열 개는 Workspace · Workbench · FileTree · MarkdownPane ×2 · PreviewPane ×2 · TsvView · GridPane · Grid. 깨끗한 문서의 첫 편집과 저장은 dirty 집합이 바뀌어 전체가 한 번 더 그려진다(P19 ③). 시간(ms)은 재지 않았다 — 렌더 횟수만 쟀다.

확인(dev `?opfs` + 내장 브라우저, DOM 과 스토어 상태를 읽어 확인): 같은 md 를 두 창에 열고 양쪽에서 입력 → 서로와 미리보기가 따라옴, 표를 고치면 `tsv-view`(미리보기 · 하이브리드)가 갱신 · "● 저장 전 내용", 탭 · 트리의 ● 와 "모두 저장 (N)" 켜짐 → 저장 · 되돌리기로 꺼짐, 계산식 "바뀔 셀" · `F9` · `Ctrl+Z`, 계산식 문서 · Field 문서를 고치면 그리드의 바뀔 셀 · 오류 수가 따라옴, lookup 대상 표를 바깥에서 고치면 바뀔 셀이 따라옴, 바깥에서 바뀐 md(받기 · 충돌 배너 · 디스크 내용 받기 · 덮어쓰기), 가져온 폴더 읽기 전용 켜기 · 끄기, bake, `tsv-view` 편집 뒤 소스 모드(TC-1805 · 1806), 트리 강조가 탭 이동 · `F6` 을 따라옴, 콘솔 오류 없음. 못 본 것: 실제 폴더(File System Access 선택 창), 실제 키보드 입력과 한글 IME(입력은 편집기 트랜잭션 · 키 이벤트를 스크립트로 보냈다), 화면 캡처(내장 브라우저 창이 가려져 그림은 못 남겼다), 2만 행 표 · 긴 문서에서의 체감.

같이 고친 것(P22): 계산식 · lookup 대상 · Field 표를 **탭으로 열어 고치고 저장한 뒤 탭을 닫으면**, 그 표를 보조 표로 읽는 그리드가 열기 전에 읽어 둔 옛 캐시로 돌아갔다(스토어 `drop` 이 보조 표 캐시를 그대로 두고, 내 저장은 수정 시각이 같아 `handleExternal` 이 건너뛴다) — 옛 계산식으로 `F9` 를 누르면 틀린 값이 써진다. 경로별 구독 전에도 같았다. 이제 `drop` 이 캐시를 내려가는 문서의 "디스크와 같은 표"(`savedTable`)로 바꾼다. 충돌 중이거나 다 읽지 못한 문서였으면 캐시를 버려 다시 읽게 한다. 다시 읽지 않고 바꿔 넣는 이유는 읽는 동안 Field 가 잠깐 빠져 스키마가 흔들리지 않게 하려는 것이다.

### 24.6 대화상자 · 알림 (2026-11-17, 2차 묶음 ②)

브라우저 기본 창(`window.prompt` / `alert` / `confirm`)이 26곳에 있었다. 앱 테마를 따르지 않고, 이름 바꾸기에서 확장자 앞만 선택하는 처리를 못 하고, 틀린 이름을 넣으면 창이 닫힌 뒤 `alert` 로 알려 처음부터 다시 쳐야 했고, 떠 있는 동안 페이지가 멈췄다. 알림은 네 갈래(창 위 배너 · 창 막대의 상태 글자 · App 과 그리드 · 마크다운 창이 따로 가진 notice · `alert`)로 흩어져 있었다. `src` 에 `window.prompt` / `alert` / `confirm` 은 이제 없다.

**전(26곳)과 후**

| 곳 | 전 | 후 |
|---|---|---|
| App 새 파일 · 새 폴더 · 이름 바꾸기 (3) | `prompt` 로 경로 | 이름 입력 대화상자 (N2) |
| App 확장자 검사 2 · 만들기 실패 2 · 바꾸기 실패 1 (5) | 창이 닫힌 뒤 `alert` | 대화상자를 닫지 않고 칸 아래에 이유 (N2) |
| App 파일 · 폴더 지우기 (1) | `confirm` | 확인 대화상자 — 취소가 기본, 폴더면 안의 문서 목록 (N3) |
| App 막힘 — 저장 안 한 문서가 있어 이름 바꾸기 · 지우기 · 해제 · 읽기 전용 · 폴더 바꾸기 · 업데이트 적용을 안 함 (6), 폴더 이름 바꾸기 안내 (1) | `alert` | 남는 알림 + 저장 안 한 문서 목록. 막는 조건은 그대로 (N5) |
| App 실패 — 지우기 · 해제 · 읽기 전용 전환 (3), ReadOnlyBanner 읽기 전용 끄기 실패 (1) | `alert` | 남는 알림 (N5) |
| ReadOnlyBanner UTF-8 로 바꿔 저장 (1) | `confirm` | 확인 대화상자 — 취소가 기본 (N3) |
| Workbench 저장 안 한 탭 닫기 (1) — `Alt+W` · 팔레트 · 탭의 × | `confirm` (동기) | 확인 대화상자 — 취소가 기본. 탭의 × 는 동작을 막아 두고 답을 받은 뒤 닫는다 (N3) |
| GridPane 열 넣기 · 지우기 (1), 열 옮기기 (1), 모든 행 지우기 (1), Grid 붙일 표가 더 넓을 때 열 늘리기 (1) | `confirm` | 묻지 않고 실행 + 알림에 "되돌리기" (N6) |

알림 네 갈래: **배너**(충돌 · 읽기 전용 · 읽기 오류 · 열 때 경고 · bake 오류 · 계산식 오류 — 문서 창 위, 가져오기 · 폴더 정보 창 안의 오류)와 **상태 글자**(저장됨 / ● 수정됨 / 저장 중… / 충돌 / 읽기 전용, JSON ✓ / 오류)는 그대로다. App 의 `notice`(오른쪽 아래, 6초 — 가져옴 · 해제함 · 경로 복사 · 업데이트 확인 결과), GridPane 의 `notice`(툴바 오른쪽, 4초 — 붙여넣기 · 찾기 · 계산식 결과 · 읽기 전용), MarkdownPane 의 `notice`(배너 모양 — JSON 정렬 실패), `alert` 는 알림 줄 하나로 합쳤다. 상단 막대의 "오류: …"(트리를 읽다 생긴 문제)는 계속 남는 상태라 그대로 두었다.

| # | 결정 | 근거 |
|---|---|---|
| N1 | 대화상자는 `lib/dialogs.ts` 의 `await askText()` · `await askConfirm()` 둘, 그리는 곳은 `DialogHost` 하나(App 맨 위 — 시작 화면에서도 있다). **한 번에 하나만** 뜨고 나머지는 줄을 선다. `alert` 를 대신하는 세 번째 함수는 만들지 않았다 | 알리기만 하는 것은 전부 알림 줄로 갔다(N4). 쓰는 곳 없는 함수를 두지 않는다. 줄 세우기는 순수 로직이라 테스트로 덮는다 |
| N2 | 이름 입력: 열리면 **마지막 `/` 뒤부터 확장자 앞까지** 선택한다(`nameStemRange`). 검사(`lib/names.ts` — 빈 값 · 금지 문자 `< > : " \| ? *` · `.` `..` · 점 · 공백으로 끝남 · `.git` · 확장자 · 이미 있는 이름)와 **실제 동작(만들기 · 바꾸기)을 창의 `submit` 안에서** 한다. 안 되면 닫지 않고 칸 아래에 이유를 보인다 | 바로 치면 폴더와 확장자는 남는다. 틀린 이름을 다시 치지 않고 고친다. "이미 있는 이름" 은 트리로 본다(대소문자 무시 — Windows) — 마지막 판단은 여전히 `fsaBackend` 가 하고(덮어쓰지 않는다) 그 오류도 같은 자리에 보인다 |
| N3 | 되돌릴 수 없는 확인(지우기 · 저장 안 한 탭 닫기 · UTF-8 로 바꿔 저장)은 **처음 포커스가 취소**, 확인 버튼은 위험 색, `role="alertdialog"`. 본문에 대상(경로, 폴더면 트리에 보이는 문서 목록)을 보인다 | `Enter` 를 습관으로 눌러도 지워지지 않는다. `Tab` 또는 `→` 로 옮겨 누른다 |
| N4 | 키: `Enter` 확인(입력 칸 · 포커스 있는 버튼) · `Esc` 취소 · `Tab` 은 창 안에서만 돈다 · `←` `→` 버튼 이동. 떠 있는 동안 **전역 단축키는 돌지 않고 키는 삼킨다**(`dialogOpen()` — App 의 전역 키 처리). 닫히면 **부르던 때의 포커스**로, 그 자리가 없어졌으면(닫힌 탭 · 사라진 팔레트) 문서 창으로 | 뒤에서 `Ctrl+S` · `F6` 이 돌면 묻는 중인 대상이 바뀐다. 삼키지 않으면 `Ctrl+S` · `Ctrl+P` 가 브라우저의 저장 · 인쇄 창을 띄운다. 포커스 규칙은 K3 과 같다. 포커스가 창 밖으로 나가면(`focusin`) 도로 가져온다 |
| N5 | **알림 규칙** — 배너: 그 문서에 붙어 계속 남는 상태. 상태 글자: 저장 상태. **알림 줄**(`lib/notices.ts` `notify` / `notifyError`, `NoticeHost` 하나, 오른쪽 아래): 방금 한 동작의 결과와 실패. 대화상자: 답이 필요한 것만. 알림 줄에서 **안 된 것(파일 작업 실패 · 막힘)은 닫을 때까지 남고**(×, `Ctrl+Alt+X`, 같은 곳의 다음 알림), 된 것과 가벼운 되먹임(붙여넣음 · 찾지 못함)은 5초(버튼이 달리면 10초) 뒤 사라진다. 같은 곳(key)의 알림은 하나만, 모두 합쳐 넷까지. 실패는 `role="alert"`, 나머지는 `role="status"` | 실패를 못 보고 지나치지 않게. 그리드에서 연달아 붙여 넣어도 쌓이지 않게. 이름 입력 창이 떠 있는 동안의 실패만 예외로 창 안에 보인다(N2) |
| N6 | 그리드의 **되돌릴 수 있는 큰 조작은 묻지 않는다** — 열 넣기 · 지우기 · 옮기기, 모든 행 지우기, 붙일 표가 더 넓어 열이 느는 붙여넣기. 바로 실행하고 알림에 같은 사실("모든 행이 다시 조립되어 git diff 에 전체 행이 나옵니다")과 **되돌리기** 버튼을 단다. 행 지우기 · 모두 바꾸기 · 계산식 적용 알림에도 같은 버튼 | 모두 `Ctrl+Z` 한 번으로 돌아온다. 묻는 창은 `Enter` 로 넘기게 될 뿐이다. 버튼은 그 편집 직후의 표일 때만 되돌린다 — 표가 또 바뀌면(`Ctrl+Z` · 다른 편집) 알림을 내린다. 읽기 전용이라 안 고쳐졌으면 버튼을 달지 않는다 |
| N7 | **기본 창을 남긴 곳** — 창을 닫을 때의 `beforeunload` 경고(브라우저만 띄울 수 있다). 그 밖에는 없다 | 클릭 직후여야 하는 동작(읽기 전용 끄기의 쓰기 권한 요청, 파일 탐색기 열기, 폴더 선택 창) **앞에는 원래 기본 창이 없었다** — 실패했을 때의 `alert` 뿐이라 알림 줄로 옮겨도 사용자 동작(user activation)이 끊기지 않는다. 그런 동작 앞에 대화상자를 새로 끼우지 않는다 |
| N8 | 새 명령 `dismissNotices`(알림 모두 닫기, `Ctrl+Alt+X`). 단축키 표에 "대화상자 · 알림" 구역 | 남는 알림을 키보드로 닫는다. 되돌리기 버튼이 하는 일은 `Ctrl+Z` 가 한다 |

동기 호출이 `await` 로 바뀐 데 따른 것: 지우기는 답을 받은 뒤 저장 안 한 문서를 **다시** 보고, 이름 바꾸기는 `submit` 안에서 다시 본다(트리도 그때의 것). 탭 닫기는 답을 받은 뒤 탭이 아직 있는지 본다. UTF-8 변환은 답을 기다리는 동안 탭이 닫혔으면 `convertToUtf8` 이 아무 일도 하지 않는다. Workspace 는 내려가지 않으므로(폴더를 바꾸면 페이지를 다시 읽는다) 언마운트 뒤에 이어 도는 흐름은 ReadOnlyBanner 하나뿐이다.

달라진 동작: ① 붙일 표가 더 넓을 때 "취소하면 넘치는 열은 잘라 낸다" 는 선택지가 없어졌다 — 늘 늘리고, 싫으면 되돌린다. ② 새 파일 이름이 트리에 안 보이던 파일과 겹치면 "이미 있는 파일입니다" 로 알린다(전에는 "디스크의 파일이 더 새롭습니다"). ③ 이름의 앞뒤 공백을 뗀다. ④ 저장 안 한 탭을 닫은 뒤 포커스가 남은 탭의 문서 창으로 간다(전에는 body).

확인(dev `?opfs` + 내장 브라우저, 키 입력과 `document.activeElement` · DOM 을 읽어 확인): 새 파일(`Ctrl+Alt+N`, 이름만 선택됨, 이미 있는 이름 거부 → 고쳐서 만들기 → 트리로 포커스), 팔레트로 새 폴더(닫힌 뒤 문서 창으로), `F2` 이름 바꾸기(확장자 앞만 선택, 중복 · 금지 문자 · 빈 값 거부, `Esc`), `Delete` 지우기(취소가 기본 — `Enter` 로는 안 지워짐, `→` `Enter` 로 지움, 폴더는 문서 목록), 저장 안 한 탭 닫기(`Alt+W` 와 탭의 ×, 떠 있는 동안 `Ctrl+S` · `F6` · `Ctrl+Shift+P` 가 안 먹음, `Tab` 이 창 안에서 돎), 저장 안 한 문서의 `F2` · 폴더 `F2` · 문서 폴더 바꾸기 → 남는 알림 → `Ctrl+Alt+X`, 열 삭제 뒤 `Ctrl+Z` 와 되돌리기 버튼, 모든 행 삭제, 넓은 마크다운 표 붙여넣기(열 2개 추가 → 되돌리기), CP949 파일의 UTF-8 변환(취소가 기본, 변환 뒤 디스크 바이트), JSON 정렬 실패 알림이 성공하면 내려감, 밝게 · 어둡게, 콘솔 오류 없음. **못 본 것**: 실제 폴더(File System Access 선택 창 · 권한 요청 — 읽기 전용 끄기), Edge 설치 앱에서 `Ctrl+Alt+X`, 대화상자 입력 칸의 실제 한글 IME(조합 중 `Enter`), 열 글자 끌어 옮기기(같은 `edit` + 알림 경로지만 끌기는 안 해 봄), 업데이트 적용 막힘 · 해제 · 읽기 전용 전환 실패 알림(코드로만), 스크린 리더. 내장 브라우저의 키 입력이 `Ctrl+Alt+Shift+-` · `Ctrl+Alt+D` 를 그대로 보내지 못해 그 둘은 키 이벤트를 스크립트로 보냈다.

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
