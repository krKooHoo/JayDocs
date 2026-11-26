# JayDocs — Markdown + TSV 결합 편집기 설계

작성 2026-10-11 · 상태 **설계 확정 (같은 날 피드백 반영, §13)** · 2026-10-21 폴더 가져오기·형식 확장 추가(§18) · 위치 독립 리포 `JayDocs` (2026-10-25 `JayTools/JayDocs/` 에서 기록째 분리) · 2026-10-31 브라우저 앱 전환(§20)

> **절 안내**: 번호는 다른 문서의 `§n` 참조 때문에 바꾸지 않았다. **§15(출처)는 맨 끝(§25 뒤)** 에 있다. 현재 구조는 §20 이후가 우선한다 — §20 브라우저 앱 전환 · §21 폴더 별칭 · 탐색기 · §22 업데이트 확인(U8~U10 증분 업데이트) · §23 하이브리드 표 칸 편집 · §24 최적화 · 키보드 흐름 · §25 훑어보기. 2026-10-31 전환으로 없어진 절은 맨 위에 "폐기 — §20 참조" 가 달려 있다(내용은 지우지 않았다).
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
| 타입 행 | 1행 `#string → string → enum → enum → bool → bool → string → byte → byte` | 첫 셀이 `#`로 시작하면 타입 행. 타입: `string / enum / bool / byte / uint / int / float`(`int` 는 2026-11-20 에 더했다 — §26 CG10). **빈 타입 = 주석 열** |
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
  type: 'string' | 'enum' | 'bool' | 'byte' | 'uint' | 'int' | 'float' | 'comment';
  isKey: boolean;               // 0열이고 이름이 Key
  list: boolean;                // 값에 ", " 가 섞여 있으면 (enum 리스트)
  enumValues?: string[];        // Field 블록에서
  description?: string;         // Field 블록에서 (툴팁)
}
```

규칙 — ① 1행 첫 셀이 `#`로 시작 → 타입 행(`#` 제거) ② 2행 = 헤더 ③ 타입이 비었거나 헤더가 `#`로 시작 → `comment`
④ Field 시트: 빈 줄로 블록을 나누고, 블록 첫 행 첫 셀이 이름. 이름이 `<테이블 접두>Def`면 열 설명, 이름이 열 이름과 같으면 enum 후보
⑤ `bool`은 `TRUE/FALSE`(Sheets 출력 그대로, 대소문자 보존) ⑥ `byte` 0–255, `uint` ≥ 0 정수, `int` 부호 있는 정수(−2147483648 ~ 2147483647, `+3` 도 받는다), `float` 실수.

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

> **2026-11-22: "파일 탐색기에서 열기" 와 연결 도우미는 뺐다(§30, Jay).** 상세 경로 · 별칭 · 최근 폴더 · 전체 경로 복사는 그대로다.

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
| U11 | (2026-11-24) 앱 전체를 오류 경계(`AppErrorBoundary`, `components/CrashScreen.tsx`)로 감싼다. 렌더 오류가 나면 오류 화면 — 오류 내용, 저장 안 한 문서 목록과 **모두 저장**, **다시 불러오기** · **열린 탭을 비우고 다시 불러오기**(localStorage `jaydocs.layout.*` 지움) · **시작 화면으로**(IndexedDB 의 `current` 지움, 2초 넘게 걸리면 그냥 넘어감) · **오류 내용 복사**(버전 · UA · stack · 컴포넌트 stack), 접힌 **자세히**. 오류 경계는 `getDerivedStateFromError`(렌더 단계)에서 `store.holdDirty()` 로 저장 안 한 문서를 하나씩 더 붙잡는다 | "여러 컴퓨터에서 검은 화면만 뜬다"는 보고(원인은 아직 모름). 다크 테마는 `theme.ts` 가 켜므로 검은 화면은 "JS 는 돌았고 그 뒤 멈춤" 이다. 그런데 최상위 오류 경계가 없어 렌더 오류 하나에 React 가 트리를 통째로 내리고 배경만 남았다 — 원인도 화면에 남지 않았다. 창이 내려가며 부르는 `store.release` 는 탭 닫기라 dirty 여도 문서를 내리므로, 붙잡지 않으면 오류 화면의 저장이 아무것도 쓰지 않는다(시험에서 확인) |
| U12 | (2026-11-24) 시작 단계(작업 공간 읽기 · 권한 확인, `phase: 'loading'`)가 5초 넘게 끝나지 않으면 **시작이 늦어지고 있어요** — **시작 화면으로**(이번만 마지막 폴더를 건너뜀) · **다시 불러오기** | 전에는 이 단계가 `null` 을 그려, 끝나지 않으면 검은 화면이 계속됐다. 코드에서 멈출 경로는 찾지 못했지만(IndexedDB 는 버전 1 고정, 매번 닫는다) 막혀도 빠져나갈 길은 있어야 한다 |
| U13 | (2026-11-24) `index.html` 의 `#root` 안에 숨긴 안내(`#boot-fail`)를 두고, 인라인 스크립트가 10초 뒤 보이게 한다. React 가 처음 그릴 때 `#root` 를 비우므로 앱이 뜨면 사라진다 | 앱 JS 를 못 받거나(배포본에서 Pages 가 `index-*.css` 에 503 을 한 번 준 것을 봤다) 모듈을 불러오다 오류가 나면 아무것도 그려지지 않는다. CSS 애니메이션 대신 스크립트 — 줄인 움직임 설정이 애니메이션을 끄면 안내가 안 보일 수 있다 |
| U14 | (2026-11-25) 저장된 폴더 핸들의 `queryPermission` · `isSameEntry` 에 3초 시간 제한(`QUERY_TIMEOUT_MS`, `within`). 권한 확인이 답하지 않으면 `'timeout'` — 시작은 허용 화면으로 가고, 허용 화면은 폴더들을 한꺼번에 묻고 "이 브라우저가 폴더 권한 확인에 답하지 않았습니다" 안내를 띄운다. **허용** 은 누르면 "묻는 중…" 으로 바뀐다(권한 요청은 사용자가 답할 때까지라 제한하지 않는다). 폴더를 새로 고를 때 같은 폴더 비교가 답하지 않으면 다른 폴더로 보고, 한꺼번에 비교한다 | **검은 화면의 원인.** 검은 화면이 뜨던 PC(Chrome 탭)에서 시작 단계를 재 보니 IndexedDB 읽기는 0ms, 저장된 폴더 셋의 `queryPermission` 이 모두 4초 넘게 답하지 않았다. 앱은 이것을 시간 제한 없이 기다렸고, 예전 버전은 그동안 `null` 을 그려 검은 화면으로 남았다(U12 뒤로는 "시작이 늦어지고 있어요"). Chrome 이 왜 답하지 않는지는 모른다(알려진 버그를 찾지 못했다). 같은 폴더 비교도 같은 핸들을 쓰므로 막히면 "다른 폴더 열기" 마저 멈출 수 있어 같이 제한한다 — 그때는 같은 폴더가 최근 목록에 한 번 더 생긴다 |

확인(`vite preview` + 내장 브라우저, 빌드를 바꿔 새 버전 흉내): 최신 안내, 확인 → 받기 → 적용 → 새 버전으로 재시작, 앱을 켤 때 자동 감지, 창으로 돌아올 때 10분 전에는 안 묻고 뒤에는 감지, 받기 실패 → 다시 받기(두 번), 서버를 끈 상태의 안내와 새로고침, 저장 안 한 문서가 있으면 적용 차단, 저장 뒤 적용(문서 내용 유지). 실제 Pages 주소와 설치한 Edge 앱에서는 다음 배포 때 TC-1513 · TC-1701 로 본다.

증분 업데이트(U8~U10) 측정 — 앱 문구 한 줄만 바꾼 두 빌드: 새로 받는 파일 86개 4.75 MB(gzip 1.44) → 7개 0.20 MB(gzip 0.07, `index-*.js` + 해시 없는 6개). 앱이 라이브러리 export 하나를 새로 쓰면 8개 1.22 MB(vendor + index). `index` 청크 1,253 kB → 183 kB(JS 합계는 그대로). 확인(`vite preview`): 업데이트 · 적용 · 오프라인 · 받기 실패 · 옛 서비스 워커에서 넘어오기. **이 버전으로 넘어오는 첫 업데이트는 청크 이름이 다 바뀌어 전체(약 6 MB)를 한 번 받는다** — 줄어드는 것은 그 다음 배포부터이고, 실제 주소에서는 TC-1810 으로 본다.

U11~U13 확인(dev `?opfs` + 내장 브라우저, App 렌더에 임시로 오류를 던지는 장치를 넣었다 뺐다): 오류 화면과 첫 단추 포커스, 문서를 고친 채 오류 → 목록에 그 문서 → **모두 저장** 이 파일에 씀(붙잡기 전에는 목록만 뜨고 쓰지 않았다) → 포커스가 **다시 불러오기** 로, **열린 탭을 비우고 다시 불러오기** 뒤 탭이 파일 트리만, 시작 단계를 멈추게 한 뒤 5초에 안내 → **시작 화면으로**, 빌드본에서 `vendor-*.js` 를 뺀 복사본 → 10초 뒤 `#boot-fail`, 정상일 때는 `#boot-fail` 이 남지 않음. 스토어는 단위 테스트 1건. **못 본 것**: 검은 화면이 뜬 실제 컴퓨터(원인 미확인 — U14 에서 찾음), 설치한 앱 창, **오류 내용 복사** 의 실제 클립보드.

U14 확인(dev + 내장 브라우저, OPFS 폴더를 작업 공간으로 IndexedDB 에 넣고 `FileSystemHandle.prototype.queryPermission` · `isSameEntry` 가 답하지 않게 바꿔서): 최근 폴더를 누르면 3초 뒤 허용 화면, 6초에 안내, **허용** 을 누르면 그 폴더가 열림, 같은 폴더 비교가 답하지 않을 때 `workspaceFor` 가 3초에 새 작업 공간으로 끝남. 흉내를 지운 정상 상태에서는 같은 폴더를 2ms 에 찾고 새로 고침 뒤 허용 화면 없이 바로 열림. 단위 테스트 4건. **못 본 것**: 그 PC 에서 **허용**(권한 요청)도 답하지 않는지 — 답하지 않으면 **다른 폴더 열기** 로 다시 고른다.

## 23. 하이브리드: 표 칸 편집 · 코드 블록 (2026-11-16)

하이브리드에서 표는 렌더만 되고, 고치려면 **원문** 으로 돌아가 파이프 원문을 만져야 했다. ``` 코드 블록은 원문 그대로 보였다.

| # | 결정 | 근거 |
|---|---|---|
| H1 | 표 칸을 누르면 그 칸만 입력 칸이 된다. 나머지 칸은 렌더된 글자(굵게·링크·코드) | 칸 하나만 원문(`**기본**`)을 보이면 서식을 잃지 않고 고칠 수 있다. 표 전체를 원문으로 바꾸는 지금 방식은 그대로 둔다(**원문** 버튼) |
| H2 | 입력은 글자마다 문서에 바로 들어간다(`input.type`). 한글 조합 중에는 보내지 않고 조합이 끝날 때 보낸다 | 되돌리기 · 저장 표시 · 분할 창 미리보기가 따로 손대지 않아도 따라온다. 조합 중에 문서를 바꾸면 조합이 깨진다 |
| H3 | 바꾸는 범위는 **그 칸의 글자뿐** (`lib/md/tableEdit.ts`). 다른 칸의 정렬 공백, 앞뒤 `\|` 유무는 그대로. 빈 칸에 넣으면 ` x `, 줄에 없는 칸은 줄 끝에 덧붙인다. 입력한 `\|` 는 `\\|` 로 | diff 가 칸 하나로 끝난다. 표를 통째로 다시 쓰면 손으로 맞춘 정렬이 매번 깨진다 |
| H4 | 문서가 바뀌어도 표 위젯 DOM 은 다시 만들지 않는다(`WidgetType.updateDOM`). 같은 React 트리에 새 원문만 넘긴다 | 다시 만들면 입력 칸이 사라져 포커스와 조합이 끊긴다 |
| H5 | 키: Tab / Shift+Tab 다음·이전 칸(마지막 칸에서 Tab 은 새 행), Enter · ↓ 아래 칸(마지막 행이면 표를 떠난다), ↑ 위 칸, Esc 에디터로. Ctrl+Z / Y 는 문서 되돌리기(스크롤은 그대로). 위젯 머리의 **＋ 행** 으로도 행을 붙인다 | Sheets · Notion 과 같은 손버릇. 되돌리기는 커서(표 밖)로 화면이 튀지 않게 `scrollSnapshot` 으로 붙든다 |
| H6 | ~~열 추가 · 삭제, 행 삭제 · 이동은 넣지 않는다~~ → 2026-11-22 H9 로 바꿈 (행 이동은 여전히 없다) | 요청은 "글자 입력". 구조 편집은 정렬행(`:---:`)까지 맞춰야 해 따로 다룬다 |
| H9 | 행 · 열 넣기 · 지우기 (2026-11-22). 키는 그리드와 같다 — `Ctrl+Alt+=` 아래에 행, `Ctrl+Alt+Shift+=` 오른쪽에 열, `Ctrl+Alt+-` 행 지우기, `Ctrl+Alt+Shift+-` 열 지우기. 하이브리드 표 칸과 **소스 모드 · 원문의 표 안 커서** 둘 다. 팔레트 "마크다운 표: …" 는 마지막으로 쓴 마크다운 편집기에서 — 하이브리드 칸을 고치다 열었으면 그 칸, 아니면 커서. 위젯 머리에 **＋ 열**(끝에 붙임). 바꾸는 것은 그 행 줄, 또는 줄마다 그 열의 칸 하나(구분선은 `---`, 다른 칸의 정렬 공백 · 정렬 표시 그대로). 머리글 행 · 하나 남은 열은 못 지운다. 동작 하나가 되돌리기 한 번 | 원칙 1(키보드) · 3(표는 1급). 그리드와 같은 키여야 손이 헷갈리지 않는다. 정렬행은 칸 하나 넣고 빼는 것으로 충분했다 (`lib/md/tableEdit.ts` 의 `tableOpChanges`) |
| H10 | 칸 글자는 칸 너비 안에서 줄을 바꾼다 — 렌더된 칸 · 고치는 칸 모두 (`word-break: keep-all` + `overflow-wrap: anywhere`). 고치는 칸은 input 대신 textarea 를 보이지 않는 글자 상자 위에 덮는다. 칸마다 최소 폭 = 칸 글이 한 줄에 들어갈 만큼(10em 까지 어림). 그래도 넓으면 표가 가로로 스크롤 | 글자 길이만큼 넓어지는 input(`field-sizing: content`)이 열 하나로 표를 다 차지해 다른 열이 한 글자 폭으로 눌리고 행이 세로로 길어졌다(2026-11-22 Jay 스크린샷). 최소 폭이 없으면 긴 칸 옆의 짧은 칸이 꺾인다 |
| H11 | 빈 줄에 `\|\|\|` 를 치면 빈 표(2열 · 본문 1행)가 된다. 하이브리드는 표 아래로 커서를 두고 머리글 첫 칸을, 소스는 그 칸에 커서. 앞 줄이 글이면 빈 줄을 하나 넣는다(문단에 붙지 않게). 코드 블록 · 표 · HTML 블록 안은 그대로. `|` 를 친 것과 표로 바꾼 것을 되돌리기 두 단계로 나눠, Ctrl+Z 한 번이면 `\|\|\|` 로 돌아간다 | 원칙 7 의 "자동 치환" 과 부딪힐 수 있어 좁혔다: 줄 전체가 정확히 `\|\|\|` 일 때만, 사용자가 친 순간에만, 한 번에 되돌릴 수 있게. 평문에서 `\|\|\|` 한 줄을 쓸 일은 거의 없다 |
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

`F6` 이 Edge 설치 앱 창에서 브라우저에 먼저 가로채이는지는 아직 못 봤다(TC-1809). 가로채이면 키를 바꾼다. 미리보기 전용 모드는 포커스를 받을 곳이 없어 K1 순환에서 편집기가 보이는 모드만 완전했다 — §24.7 X2 에서 미리보기가 포커스를 받게 했다.

### 24.4 다음 묶음 (아직 안 함)

1. ~~**스토어 경로별 구독**~~ — 끝(2026-11-17, §24.5). 전역 버전 하나를 모든 창이 구독해 키 하나에 앱 전체가 다시 그려지던 것.
2. ~~**대화상자 · 알림 통일**~~ — 끝(2026-11-17, §24.6). `window.prompt` / `alert` / `confirm` 26곳을 앱 대화상자와 알림 줄로, 알림 네 갈래(배너 · 상태 글자 · notice · alert)를 한 규칙으로. 열 조작 확인 창은 알림 + 되돌리기로.
3. ~~**남은 UX**~~ — 끝(2026-11-19, §24.7). **한 것**: 탭 제목 클릭 포커스, 미리보기 전용 모드 포커스, 빈 화면 안내와 갈 곳 없는 포커스, 새 파일 뒤 포커스 · 이름 바꾼 뒤 트리 커서, 떠 있는 창 뒤의 전역 단축키 막기, 팔레트 최근 순, 트리 펼침 상태 저장, 같은 트리로 다시 그리지 않기, 읽기 전용 폴더의 사전 차단, 중복 버튼 정리, 감시 없는 브라우저의 보조 표 다시 확인, 린트(oxlint). **안 한 것**: 증분 검증(P14) — 시간만 쟀다(X13). 넣을지는 Jay 가 정한다.

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

### 24.7 남은 UX — 포커스 흐름 · 팔레트 · 트리 · 정리 (2026-11-19, 2차 묶음 ③)

§24.3 의 포커스 규칙(K1~K3)이 닿지 않던 곳을 메웠다: 탭 제목을 마우스로 눌렀을 때, 미리보기 전용 모드, 문서 탭이 하나도 없을 때, 팔레트 · 도움말 같은 창이 떠 있을 때. 새 명령 · 새 단축키는 없다(단축키 표의 설명만 늘렸다). 새 의존성은 `oxlint`(dev) 하나.

**포커스 흐름**

| # | 결정 | 근거 |
|---|---|---|
| X1 | **탭 제목을 누르면 그 창으로 포커스** — 탭 이동 명령과 같은 `focusTabPane(tabId)`. 두 길로 잡는다: ① Layout 이 내는 `SELECT_TAB`(`onAction` — 고르지 않은 탭 클릭, 넘친 탭 목록, 탭 줄에서 `Enter`) ② Layout 을 감싼 `display: contents` 요소의 `click`(이미 골라진 탭의 제목 — 이때 Layout 은 아무 동작도 내지 않는다). × 는 뺀다 | 포커스가 탭 버튼에 남아 바로 친 글자가 편집기로 가지 않았다. 끌어 옮기기는 `click` 을 내지 않고 `MOVE_NODE` 라 건드리지 않는다. `model.doAction` 으로 부른 선택(탭 이동 명령)은 `onAction` 을 거치지 않아 겹치지 않는다 |
| X2 | **미리보기 전용 모드는 미리보기(`.preview`, `tabIndex=0`)가 포커스를 받는다.** `focusTabPane` 은 그 탭의 후보(편집기 본문 · 그리드 입력 칸 · 미리보기) 가운데 **보이는 첫 번째**에 준다 — 분할 모드는 편집기, 미리보기 전용은 미리보기. `F6` · `Ctrl+Shift+M` · 탭 이동 · 탭 제목 클릭이 모두 이 길이다. 보기 모드를 바꾸면(`Ctrl+Shift+V` · 모드 버튼) 바뀐 화면이 그려진 뒤 그 모드의 자리로 포커스를 옮긴다. 미리보기에 포커스가 있을 때 `↑` `↓`(40px) · `PageUp` `PageDown` · `Space` · `Home` `End` 로 스크롤 — 키를 직접 처리한다 | 편집기가 숨겨져 포커스가 body 로 빠졌다. 브라우저 기본 스크롤에 맡겨도 되지만 부드러운 스크롤이 가려진 창에서 늦게 따라와 확인이 안 됐다 — 직접 옮기면 바로 움직이고 시험할 수 있다. 안의 `tsv-view` 칸 · 링크에 포커스가 있을 때는 손대지 않는다(`target === currentTarget`) |
| X3 | **문서 탭이 없으면 포커스는 트리로**, 트리가 접혀 있으면 억지로 펴지 않고 **빈 화면 안내**(`.empty-pane`, `tabIndex=0`)로. `focusEditor` 명령 안에 넣었다 — 활성 탭 묶음이 비었으면 문서가 있는 다른 묶음, 그것도 없으면 트리 / 안내. 탭이 닫힌 뒤(`DELETE_TAB`) 포커스가 body 면 `focusEditor` 를 부른다. 트리에 포커스가 있을 때 트리를 접어도(`Ctrl+B`) 같다. 빈 화면 안내는 Layout 의 `onTabSetPlaceHolder` — 파일 트리 · 파일 검색 · 명령 팔레트 · 새 파일 · 도움말 버튼과 키(`keysOf()` 로 표에서 가져온다) | 대화상자 · 팔레트가 닫힐 때(K3 · N4)와 탭을 닫을 때 모두 `focusEditor` 로 모이므로 한 곳만 고치면 된다. 깨끗한 탭을 `Alt+W` · × 로 닫으면 포커스가 body 에 남던 것도 같이 없어졌다(남은 탭의 문서 창으로 간다) |
| X4 | **새 파일을 만들면 그 문서의 편집기로 포커스** — `openFile(path, true)`. 막 만든 파일은 읽힌 뒤에야 편집기가 생겨 약 1초까지 기다린다. 파일 검색으로 연 파일도 같은 길. **이름을 바꾸면 트리 커서가 바뀐 파일에 남는다** — `lib/nav.ts` 의 `setTreeCursor(path)`(트리가 접힌 상위 폴더를 펴고 커서를 옮긴다). 커서의 항목이 사라지면(지우기) 같은 자리의 항목으로 옮긴다 | N2 에서는 대화상자가 부르던 곳(트리)으로 돌려줬다 — 새 파일은 바로 치려는 것이다. 트리 커서는 트리 안의 state(경로)라 이름이 바뀌면 가리킬 행이 없어져 `↓` 가 맨 위부터 갔다(TC-807). 트리에서 `Enter` 로 연 파일은 예전처럼 포커스가 트리에 남는다(이어서 훑어볼 수 있게) |
| X5 | **팔레트 · 파일 검색 · 도움말 · 폴더 가져오기 · 폴더 정보 · 탐색기 연결 도우미가 떠 있는 동안 전역 단축키는 돌지 않고 키는 삼킨다** — 대화상자(N4)와 같은 규칙. 예외는 창을 여닫는 키: ① **그 창을 연 키를 다시 누르면 닫는다**(`Ctrl+Shift+P` · `Ctrl+P` · `F1` · `Ctrl+Shift+O`) ② 찾아보는 창 셋(팔레트 · 파일 검색 · 도움말)끼리는 서로의 키로 넘어간다. `Esc` 는 창이 직접 받는다 | 뒤에서 `Ctrl+S` · `F6` · `Alt+W` 가 돌았다. 고치기 전 동작: 다른 창의 키는 그 창으로 바꿨고(입력 중이던 가져오기 · 폴더 정보 창도 버리고), 같은 창의 키는 아무 일도 없었다. ②는 그대로 두되 입력을 받는 창에서는 막았고, ①은 새로 넣었다(아무 일도 없던 키에 닫기를 줬다) |

**팔레트 · 트리**

| # | 결정 | 근거 |
|---|---|---|
| X6 | **팔레트 최근 순** — 검색어가 없으면 최근에 **팔레트로 실행한 명령**(20개) · 최근에 **연 파일**(30개)이 위에 오고 "최근" 표시가 붙는다. 검색어가 있으면 지금 점수가 먼저고 같은 점수 안에서만 최근 것이 먼저. `localStorage` — 명령은 앱 전체에 하나(`jaydocs.recent.commands`), 파일은 문서 폴더별(`jaydocs.recent.files:<layoutId>`). 지금 못 쓰는 명령은 올리지 않고, 없어진 파일은 목록에 없으니 저절로 빠진다(기록은 지우지 않는다 — 가져온 폴더가 잠깐 빠졌다 돌아올 수 있다). 순수 로직은 `lib/recents.ts` | 단축키로 실행한 명령은 세지 않는다 — `Ctrl+S` 가 늘 맨 위에 오면 쓸모가 없다. 파일은 여는 길이 하나(`Workbench.openFile`)라 트리 · 검색 · 링크로 연 것이 다 든다 |
| X7 | **트리 펼침 상태 저장** — 펼친 폴더 목록을 문서 폴더별로 `localStorage`(`jaydocs.tree.expanded:<layoutId>`)에. 저장분이 없으면(처음) 전부 펼친다. **펼친 쪽**을 적는다. 트리에서 없어진 폴더는 목록과 저장분에서 뺀다. `lib/treeState.ts` | 접은 쪽을 적으면 새로 생긴 폴더가 다음에 열 때 펼쳐져 나와, 한 번 연 뒤 생긴 폴더(접힌 채로 나온다)와 어긋난다. 빈 트리(아직 못 읽음)일 때는 저장하지 않는다 |
| X8 | **`refreshTree` 는 내용이 같으면 state 를 바꾸지 않는다** — 트리와 가져온 폴더 목록(화면이 쓰는 값만)을 JSON 으로 비교한다. 스토어(`setTree` · `setMounts`)는 스스로 달라진 것만 알리므로 늘 부른다 | 창에 포커스가 돌아올 때마다(감시가 없으면 5초마다) 새 배열을 넣어 Workspace 아래가 통째로 다시 그려졌다. 가져온 폴더 목록이 새 배열이면 폴더별 팔레트 명령도 다시 등록됐다 |
| X9 | **읽기 전용으로 가져온 폴더에서 새 파일 · 새 폴더 · 이름 바꾸기 · 지우기는 대화상자를 띄우기 전에 알림 줄로 막는다**(`store.readOnlyReason(path) === 'mount'`) | 이름을 다 치고 확인을 누른 뒤에야 백엔드가 거부했다(TC-1206). 오른쪽 클릭 메뉴는 원래 그 항목을 숨긴다 — 키(`F2` · `Delete` · `Ctrl+Alt+N`)와 `＋파일` 버튼이 빠져 있었다. 마지막 판단은 여전히 백엔드가 한다. UTF-8 이 아닌 파일의 이름 바꾸기 · 지우기는 막지 않는다(내용을 쓰지 않는다) |

**정리**

X10 — 버튼 조사. 상단 막대와 창 막대에서 같은 일을 하는 것, 글자 · 이모지 · 기호가 섞인 것:

| 곳 | 버튼 | 같은 일을 하는 다른 길 | 한 일 |
|---|---|---|---|
| 상단 | 저장 | 창 막대 "저장"(그 문서, 켜짐 · 꺼짐이 보인다) · `Ctrl+S` · 팔레트 | **뺐다** — 분할했을 때 어느 문서인지 상단 버튼은 알 수 없다 |
| 상단 | 오른쪽에 분할 | 창 막대 "오른쪽에 분할" · `Ctrl+\` · 팔레트 · 탭 끌기 | **뺐다** |
| 상단 | 명령 ⌘ | `Ctrl+Shift+P` | 남기고 글자만 "명령" 으로 — `⌘` 는 Mac 의 키 표시라 Windows 에서 뜻이 없다 |
| 상단 | 모두 저장 (N) | `Ctrl+Shift+S` · 팔레트 | 그대로 — 저장 안 한 문서 수를 보여 주는 곳이 여기뿐 |
| 상단 | 📂 가져오기 · ☀ / ☾ · ? | `Ctrl+Shift+O` · `Ctrl+Alt+D` · `F1` · 팔레트 | 그대로(후보) — 이모지 · 기호만 있는 버튼. 글자로 통일할지는 정하지 않았다 |
| 창 막대(그리드) | 저장 · 오른쪽에 분할 | — | 툴팁의 키를 손으로 적은 것(`Ctrl+S`, `Ctrl+\`)을 `tip()` 으로(K6) |
| 트리 | ＋파일 · ＋폴더 · ↻ · 🔍 파일 검색 | `Ctrl+Alt+N` · `Ctrl+Alt+Shift+N` · 팔레트("파일 트리 새로고침") · `Ctrl+P` | 그대로(후보) — 기호만 있는 버튼(`↻`) |
| 그리드 툴바 | ↶ ↷ · ＋위 ＋아래 ＋끝 · 복제 · 삭제 · ＋왼쪽 ＋오른쪽 · 찾기 | 대부분 키가 있다. **`＋위` · `＋끝` · `＋왼쪽` 은 버튼뿐이다** — 키도 팔레트 명령도 없다(이번 범위 밖, 남은 일) | 그대로 — 겹치는 버튼이 아니다 |

없앤 것은 둘 다 마우스(창 막대) · 키보드 경로가 남는다. `WorkbenchHandle.splitActive` 는 쓰는 곳이 없어져 뺐다.

| # | 결정 | 근거 |
|---|---|---|
| X11 | **`rescan` 때 보조 표 캐시도 다시 확인한다** — `store.recheckOpen()` 이 열린 문서와 함께 `auxCache`(계산식 · lookup 대상 · Field)의 각 경로를 `backend().stat(path)`(수정 시각만, 내용은 읽지 않는다)로 보고, 달라졌거나 지워졌으면 `handleExternal` 과 같은 길로 다시 읽는다. `Backend` 에 `stat` 을 넣었다 | 감시(`FileSystemObserver`)가 없는 브라우저는 5초마다 · 창에 돌아올 때 `rescan` 만 온다. 열린 문서만 다시 봐서, 바깥에서 고친 계산식 · Field 가 그 표를 탭으로 열기 전에는 반영되지 않았다. Field 파일은 리포 전체의 것이 캐시에 들어 있어 5초마다 내용을 다 읽으면 과하다 — `stat` 은 파일 핸들의 `lastModified` 만 읽는다 |
| X12 | **린트는 oxlint**, `npm run lint`(= `oxlint src scripts vite.config.ts`), 규칙은 기본값(설정 파일 없음). 배포 워크플로에는 넣지 않았다 | typescript-eslint 는 TypeScript 7 을 지원하지 않는다. 처음 돌린 결과: 오류 0 · 경고 25 — `unicorn/no-useless-spread` 7(스토어가 알리는 동안 구독자 집합이 바뀌어도 되게 일부러 복사한다 5 + 테스트용 가짜 2) · `unicorn/no-new-array` 6(길이를 주는 `new Array(n)`) · `no-unused-vars` 4(react-markdown 의 `node` 를 DOM 으로 넘기지 않으려 꺼내 버리는 것) · `no-control-regex` 4(파일 이름 금지 문자) · `typescript/no-this-alias` 2 · `require-yield` 2(둘 다 테스트). **버그는 없어 코드는 고치지 않았다.** 소스의 `eslint-disable` 주석(react-hooks)은 oxlint 기본 규칙과 무관해 그대로 뒀다 |
| X13 | **증분 검증(P14)은 넣지 않았다.** 셀 하나를 확정할 때 도는 것을 따로 쟀다(아래) | 넣을지는 Jay 가 정한다 |

X13 측정 — Node 22.18 · Ryzen 7 2700X, vitest 안에서 `setCell` → `deriveSchema` + `stabilizeSchema` → `validateTable` 을 15번, 중앙값. 표는 타입 행이 있고 열이 string · enum(Field 없음) · bool · uint · float 로 섞인 것, 오류 없음. React 와 화면 그리기는 들어 있지 않다:

| 표 | `setCell` | 스키마 유도 | `validateTable` |
|---|---|---|---|
| 2만 × 30 | 0.04 ms | 12 ms | **55 ms** |
| 2,000 × 30 | 0.01 ms | 1.2 ms | 5.1 ms |
| 300 × 20 | 0.00 ms | 0.13 ms | 0.50 ms |

검증은 셀 수에 비례한다(60만 셀에 55 ms — 셀마다 정규식 한두 번). §24.2 의 "셀 확정 135 ms"(dev 빌드 · 브라우저)의 절반쯤이 검증 + 스키마 유도인 셈이다. 증분으로 바꾸면 2만 행 표에서 셀 확정이 약 55 ms 줄고, 평소 규모(300 × 20)에서는 0.5 ms 라 차이가 없다. 브라우저 안에서는 재지 않았다.

확인(dev `?opfs` 포트 5186 + 내장 브라우저, 실제 키 입력 · 클릭과 `document.activeElement` · DOM 을 읽어 확인): 탭 제목 클릭(고르지 않은 탭 · 이미 골라진 탭 · 분할한 다른 묶음의 탭 · 그리드 탭) 뒤 바로 친 글자가 그 문서에 들어감, `Ctrl+Shift+V` 로 소스 → 하이브리드 → 분할(편집기) → 미리보기(미리보기) → 소스(편집기), 미리보기에서 `Home` 0 · `↓`×3 120 · `PageDown` · `↑` · `End` 끝 · `PageUp`, `F6` 으로 트리 ↔ 미리보기, `Ctrl+Shift+M` · `Alt+]` · `Alt+[` 가 미리보기로, 탭을 다 닫으면 트리로 + 빈 화면 안내, 트리를 접은 채로는 안내 영역으로(`Ctrl+Shift+M` · 팔레트 `Esc` · 트리에서 `Ctrl+B`), 새 파일 → 편집기 포커스 → 바로 입력, `F2` 뒤 트리 커서가 바뀐 파일에 · `↑` `↓` 가 그 자리부터, `Delete` 뒤 같은 자리의 항목으로, 팔레트가 떠 있을 때 `Ctrl+S`(저장 안 됨) · `F6` · `Alt+W`(탭 그대로), `Ctrl+P` · `F1` 로 넘어가기, `F1` · `Ctrl+Shift+P` 다시 눌러 닫기, 가져오기 창에서 `Ctrl+Shift+P` · `Ctrl+S` 가 안 먹음, 팔레트 최근 순(명령 · 파일, 지운 파일은 빠짐, 새로 고침 뒤에도), 트리 접은 폴더가 새로 고침 뒤에도 접혀 있음, 같은 트리로 새로 고침하면 트리가 다시 그려지지 않고(렌더 횟수 4 → 4) 파일이 생기면 그려짐, 읽기 전용 폴더에서 `F2` · `Ctrl+Alt+N` · `Delete` → 대화상자 없이 알림, 상단 · 창 막대 버튼 목록, 새로 고친 뒤 콘솔 오류 없음. **못 본 것**: 탭을 끌어 옮기기(내장 브라우저의 끌기가 HTML5 드래그를 일으키지 못했다 — 코드로만: 끌기는 `click` · `SELECT_TAB` 을 내지 않는다), 넘친 탭 목록에서 고르기 · 탭 줄에서 `Enter`, 실제 폴더(선택 창 · 권한), 감시가 없는 브라우저에서 보조 표가 실제로 따라오는지(X11 은 스토어 테스트 3건과 백엔드 테스트 1건으로만), Edge 설치 앱, 실제 한글 IME, 화면 캡처로 본 모양은 빈 화면 안내 한 장뿐(밝게 · 어둡게 둘 다 보지는 않았다).

## 25. 훑어보기 (2026-11-19)

문서를 열지 않고(또는 편집하면서) 렌더된 모습을 축소해 본다. Mac 의 훑어보기 · 미리보기 썸네일에서 온 생각(Jay). 계획 · 결정 과정 · 단계별 완료 메모 · 잰 숫자의 전체는 `PLAN-skim.md` 에 있고, 여기에는 확정된 결과만 적는다. 다섯 단계(A 공통 코어 → B 새 문서 창 · C 패널 · D 훑어보기 창 → E 폴더 격자)를 하위 세션이 워크트리에서 나눠 만들어 `main` 에 선형으로 합쳤다. 새 의존성은 없다.

| 쓰는 곳 | 무엇 | 여는 법 | 코드 |
|---|---|---|---|
| 새 문서 창 | 빈 문서 · 예시 · 내 템플릿을 카드로 보고 골라 이름을 넣어 만든다 | `Ctrl+Alt+N` · 트리 ＋파일 · 빈 화면 "새 파일" | `NewDocDialog.tsx` · `lib/templates.ts` |
| 훑어보기 패널 | md · txt 편집 중 오른쪽에 문서 전체를 축소해 띄운다 | `Ctrl+Alt+M` · 창 막대 "훑어보기" | `SkimPanel.tsx` · `lib/skim/lineMap.ts` · `panel.ts` |
| 훑어보기 창 | 트리 커서의 파일을 열지 않고 크게 본다 | 트리에서 `Space` · 팔레트 "훑어보기" | `QuickLook.tsx` |
| 폴더 훑어보기 | 폴더의 문서를 썸네일 격자로 | 트리에서 폴더에 `Space` · 팔레트 "폴더 훑어보기" | `QuickLook.tsx`(`QuickLookFolder`) · `lib/skim/grid.ts` |
| 내 템플릿 | 주 폴더의 `_templates/` 파일이 새 문서 창에 뜬다 | 폴더에 파일을 넣거나 팔레트 "현재 문서를 템플릿으로 저장…" | `lib/templates.ts` |

### 25.1 공통

| # | 결정 | 근거 |
|---|---|---|
| SK1 | **그림으로 굽지 않는다.** A4 너비(794px) 상자에 실제 DOM 을 그려 `transform: scale()` 로 줄인다 | 글자가 선명하고 기존 렌더러 · 테마 · Mermaid 캐시를 그대로 쓴다. 캔버스로 굽는 길은 라이브러리가 필요하고 한글 글꼴 · SVG 에서 깨지기 쉽다 |
| SK2 | **렌더러 하나 `DocView`**(`components/DocView.tsx`) — md 는 미리보기와 같은 컴포넌트(`PreviewPane.tsx` 의 `mdComponents()`), 표는 앞 60행 · 40열의 정적 표, txt · json 은 색 없는 평문. 무게 둘: **rich**(Mermaid · tsv-view 를 실제로) / **light**(상자로 대신 — 폴더 격자) | 격자의 파일 수십 개가 표 · 그림을 한꺼번에 불러오지 않게. rich 의 tsv-view 는 그 표를 스토어에 올린다 |
| SK3 | **틀 썸네일 `DocThumb`** — 세로 A4 비율, 문서 앞부분(200줄)만. 내용이 틀보다 짧으면 **3배까지 키운다.** 처음 배율은 `min(3, √(틀 ÷ 내용))`, 한 번 더 재서 "좁히면 얼마나 길어지는가"로 맞춘다(`lib/skim/fit.ts`). 안은 `inert` | 표 · 짧은 줄은 좁혀도 높이가 그대로라, 넓이가 유지된다고 보는 식으로는 틀의 75% 만 찼다 |
| SK4 | **읽기** — 열린 문서는 스토어의 지금 내용(저장 전 편집 포함), 안 연 파일은 `backend().read` 로 직접(스토어에 올리지 않는다). 캐시는 경로 + 수정 시각, 200개, 한 번에 4개(`lib/skim/reader.ts`). UTF-8 이 아닌 파일도 보여 준다 | 쓰지 않으니 안전하다 |
| SK5 | **원문 줄** — rehype 플러그인(`lib/md/sourceLines.ts`)이 최상위 조각에 `data-line` 을 찍는다. baked 표를 걷어 낸 글의 줄은 `stripBakedWithLines` 로 원문 줄로 되돌린다. txt 는 줄마다 한 조각. 문서는 통째로 그린다(블록별 렌더는 하지 않았다) | 블록별로 나누면 참조 링크 · 각주가 블록을 넘을 때 깨진다. HTML 블록 · Mermaid · tsv-view 펜스는 줄 번호를 잃어 `<div data-line>` 으로 감싸고, 각주 묶음에는 줄 번호가 없다 → 줄 → 조각은 "그 줄 이하에서 가장 큰 `data-line`" |
| SK13 | 종이 색은 앱 테마를 따른다. **쪽 나눔 · 인쇄 · PDF 는 하지 않는다**(Jay — 이 앱의 문서는 인쇄를 생각하고 만든 것이 아니다). 표(TSV · CSV)용 패널도 없다 | 그리드는 이어 읽는 글이 아니다 |

### 25.2 새 문서 창 · 템플릿

| # | 결정 | 근거 |
|---|---|---|
| SK8 | 세 줄(빈 문서 · 예시 · 내 템플릿). **이름 칸이 처음부터 포커스**를 받고 처음 선택은 "빈 마크다운" → `Ctrl+Alt+N` · 이름 · `Enter` 가 전과 같은 결과. `↑` `↓` 로 템플릿을 옮기고 확장자는 칸 뒤에 고정. 이름 끝에 확장자를 직접 치면 그 형식의 빈 문서로(고른 템플릿과 형식이 다를 때만). 카드 두 번 누르기 = 만들기. 떠 있는 동안 전역 단축키는 막히고 `Ctrl+Alt+N` 을 다시 누르면 닫힌다 | 지금 습관을 그대로 둔다. 이름 칸에는 폴더가 들어 있고(`docs/새 문서`) 이름 부분만 선택된다 |
| SK9 | **템플릿 표는 `lib/templates.ts` 한 곳** — 형식마다 빈 문서 · 예시 하나(테스트가 형식 표와 맞는지 본다). 새 파일은 LF · 끝 개행 · BOM 없음, **CSV 예시만 BOM**. **빈 TSV · CSV 는 0바이트가 아니라 그리드의 "행 만들기" 버튼과 같은 가장 작은 표**(`seedTypedTable` · `seedHeaderTable`) | 0바이트 표는 열리지만 버튼을 누르기 전에는 입력할 칸이 없다. TSV 예시의 enum 열은 `FoodGroup` — `Category` 는 같은 루트의 `_Field` 블록과 겹쳐 검증 오류가 났다 |
| SK10 | **내 템플릿** — 주 폴더 루트의 `_templates/` 바로 아래 지원 형식 파일. 만들 때 `read` 한 글을 그대로 `write`(UTF-8 파일은 BOM · 줄바꿈까지 바이트가 같다). UTF-8 이 아닌 파일 · 못 읽는 파일 · 하위 폴더 · 가져온 폴더의 `_templates/` 는 뺀다. 팔레트 "현재 문서를 템플릿으로 저장…" 은 저장하면 써질 글(`store.fileText`)을 쓰고 원본은 저장하지 않는다 | UTF-8 이 아닌 파일은 다시 쓰면 UTF-8 이 된다(§18 의 덮어쓰기 금지와 같은 이유) |

### 25.3 훑어보기 패널

| # | 결정 | 근거 |
|---|---|---|
| SK6 | **문서 창 안 오른쪽 띠**(`MarkdownPane` 안, flexlayout 가장자리 패널이 아니다). 대상은 `.md` · `.txt`. **문서 창이 하나일 때만** 보인다(`docPanes.ts` 의 context) — 분할하면 숨고 돌아오면 다시 나온다. 켬 · 끔은 앱 전체에 하나, 너비 120~400px(기본 180), 둘 다 localStorage. **기본값은 꺼짐** | 저장된 레이아웃을 옮길 필요가 없고 편집기를 바로 쓴다. 업데이트했을 때 화면이 저절로 바뀌지 않게 꺼 둔다 |
| SK7 | **클릭 → 커서**(그 조각의 첫 줄, 포커스는 편집기). **범위 상자**는 편집기가 보여 주는 줄 범위, 끌면 편집기가 스크롤된다(4px 안쪽은 클릭). 커서가 든 조각 옆에 얇은 선. 줄 ↔ 위치는 조각 사이를 고르게 나눠 계산한다(`lib/skim/lineMap.ts`). 패널을 휠로 굴리면 따라오기를 멈추고 편집기가 움직이면 다시 따라온다 | 원문 높이와 렌더 높이는 비례하지 않는다. 안이 `inert` 라 클릭한 줄은 이벤트의 target 이 아니라 높이로 찾는다 |
| SK14 | **미리보기 전용 모드**에서는 패널이 보일 때만 미리보기에도 `data-line` 을 찍어(`PreviewPane` 의 `lines`) 같은 지도를 쓴다. 클릭하면 미리보기가 그 조각으로 스크롤된다 | 그 밖에는 미리보기 DOM 이 전과 같다 |
| SK15 | **큰 문서는 자동 갱신을 멈춘다** — 다시 그리는 데 400ms(처음은 800ms) 넘게 걸리면 멈추고 안내 + "새로 고침"(팔레트 "훑어보기 패널 새로 고침"). 새로 고친 렌더가 200ms 아래로 내려와야 다시 자동. 디바운스는 300ms ~ 마지막 렌더의 3배(상한 1500ms) | 잰 값(개발 · 배포 빌드, 내장 브라우저): 2천 줄 md 약 390ms, 5천 줄 약 1초 — 그동안 입력이 멎는다. 기계 부하에 따라 2배쯤 달라졌다 |

### 25.4 훑어보기 창 · 폴더 훑어보기

| # | 결정 | 근거 |
|---|---|---|
| SK11 | 트리에서 `Space` 로 열고 `Space` · `Esc` 로 닫는다. **포커스는 트리에 남는다** — `↑` `↓` 는 트리 키 그대로이고 창이 100ms 늦게 커서를 따라간다. 모달이 아니다(전역 단축키를 막지 않는다). 포커스가 트리 · 창 밖으로 가면 닫힌다. `PageUp` `PageDown` 은 창을 한 화면씩, `Ctrl+↑` `Ctrl+↓` 는 조금씩(60px, 커서는 그대로 — Jay 요청 2026-11-20) 스크롤한다. 창이 떠 있을 때 `Enter` · `→` 로 파일을 열면 창이 닫히고 **편집기로 포커스**(창이 없을 때의 `Enter` 는 전처럼 트리에 남는다). 파일은 문서 전체를 `inert` 로 | Mac 의 훑어보기와 같은 흐름. 그림 파일은 트리에 보이지 않아 대상이 아니다 |
| SK12 | 폴더면 **바로 아래 항목의 썸네일 격자**(light), 하위 폴더는 폴더 카드. 창은 폴더일 때만 넓다(최대 900px). **보이는 카드만 그린다** — 화면 위아래 한 화면 안에 오면 그리고 세 화면 밖으로 나가면 다시 비운다. 트리에서 `Tab` 으로 격자에 들어가 방향키 · `Home` `End` · `PageUp` `PageDown` 으로 고르고, `Enter` 는 문서 열기 / 폴더로 들어가기(트리 커서도 그 폴더로), `Backspace` 는 상위 폴더, `Esc` · `Shift+Tab` 은 트리로 | 다 남기면 300장에 DOM 이 약 3만 개로 늘 것으로 어림했다. 비우면 끝까지 넘겨도 썸네일 80장 · DOM 9.7천 |
| SK17 | **창 크기와 배율은 사용자가 바꾸고, 이 브라우저에 남는다**(2026-11-20, Jay 요청 — `lib/skim/look.ts`, localStorage `jaydocs.quicklook`). **크기**: 오른쪽 · 아래 가장자리와 모서리를 끌거나 `Shift+방향키`(40px), 두 번 누르면 처음 크기. 너비는 파일 · 폴더가 따로, 높이는 같이. 저장하는 것은 원한 크기이고 그릴 때 화면 안으로 줄인다. **배율**: `Ctrl+=` · `Ctrl+-` · `Ctrl+휠` · 머리의 − ＋(50 ~ 300%, 12단계). 파일은 CSS `zoom`(너비 안에서 다시 줄바꿈), 폴더 격자는 카드 너비(100% 는 너비를 고르게 채우고, 그 밖은 140px × 배율로 고정) — 둘을 따로 기억한다. 키는 창이 떠 있을 때만 듣는다. 팔레트 "훑어보기 창 크기 · 배율 처음으로" | 문서 배율 150% 가 카드 크기 150% 를 뜻하지 않는다. 격자가 늘 너비를 채우면 열 수가 바뀔 때만 카드 크기가 달라져 한 단계가 눈에 보이지 않았다. `Ctrl+0` 은 쓰지 않는다(브라우저가 가로채는 `Ctrl+숫자`). 창이 없을 때 `Ctrl+=` · `Ctrl+-` 는 브라우저의 페이지 확대 그대로다 |
| SK16 | **주 폴더 루트**는 트리에 항목이 없어 `FileTree` 가 가짜 항목 `(루트)` 를 만들어 준다. 팔레트 "폴더 훑어보기" 는 트리에서 고른 폴더(파일이면 부모, 없으면 루트)로 열고 트리 커서를 그 폴더로 옮긴다 | 창은 트리 커서의 항목을 보여 주는 구조다 |

잰 값(개발 빌드 · OPFS · 가려진 내장 브라우저, 문서 300개 · 7.8 MB · 500 KB 표 12개 포함): 창은 32~35ms 에 뜨고 첫 화면 33장은 약 480ms, 썸네일 하나는 10~19ms 라 큰 파일이 섞여도 멎지 않았다. 그래서 큰 표의 앞부분만 읽는 옵션은 넣지 않았다(표는 60행만 그리지만 읽고 파싱하는 것은 파일 전체다).

**이 브라우저에 남는 사용자 설정**(2026-11-20 에 훑어 확인 — 전부 localStorage, 리포 · 문서 폴더에는 아무것도 쓰지 않는다): 탭 · 분할 · 트리 너비(`jaydocs.layout.v1:<작업 공간>`), 트리 펼침(`jaydocs.tree.expanded:<작업 공간>`), 표의 열 너비(`jaydocs.colw:<경로>`), 마크다운 보기 모드(`jaydocs.mdmode:<경로>`), 테마(`jaydocs.theme`), 최근 명령 · 파일(`jaydocs.recent.*`), 훑어보기 패널 켬 · 너비(`jaydocs.skim.on` · `jaydocs.skim.width`), 훑어보기 창 크기 · 배율(`jaydocs.quicklook`). 사용자가 끌어서 바꿀 수 있는 크기 가운데 저장되지 않는 것은 없다. 분할 보기 모드의 편집기 : 미리보기 비율은 끌어서 바꾸는 기능 자체가 없다(반반 고정).

### 25.5 확인하지 못한 것 (TESTCASES §19)

- 실제 폴더(File System Access) — 전부 OPFS 로만 봤다. 수강생 제출물 폴더의 속도는 Jay 가 본다.
- 실제 한글 조합(새 문서 창의 이름 칸, 패널이 켜진 채의 입력), 마우스 휠, 스크롤 중 프레임 수 — 내장 브라우저 창이 가려져 있어 못 봤다.
- 설치한 Edge 앱에서 `Ctrl+Alt+M` 이 페이지까지 오는지.
- 패널의 자동 갱신 멈춤은 개발 빌드에서만 봤다. 그림이 든 md 의 썸네일 · 패널.

## 26. C# DTO 내보내기 (2026-11-20)

표(TSV · CSV)의 머리글로 C# DTO 클래스 파일을 만든다(Jay 요청). 같이 검토한 세 가지 — C# → 표, JSON → C#, C# → JSON — 는 넣지 않았다(§26.3).

쓰는 쪽의 파이프라인은 **표 → DTO → Def → Table** 이다(Jay). DTO 는 표 한 행을 그대로 담는 그릇이고 함수가 없다. 리더(CsvHelper)가 머리글 이름과 필드 이름을 글자 그대로 맞추며, 틀리면 오류 없이 기본값이 들어간다 — 이 기능은 그 옮겨 적기를 없앤다. 타입 해석 · 에셋 참조는 Def 를 만드는 쪽의 일이라 DTO 에는 넣지 않는다.

| # | 결정 | 근거 |
|---|---|---|
| CG1 | **필드 자료형은 `int` · `float` · `string` 셋뿐.** enum · bool(`T`/`F`) · 경로 · 매크로는 전부 `string` | Jay 의 DTO 규약. enum 을 DTO 에서 쓰지 않는다. 실수는 처음에 `string` 으로 했다가 같은 날 `float` 로 바꿨다(Jay) |
| CG2 | **타입 행이 있으면 적힌 대로** — `int` · `byte` · `uint`(· `short` · `ushort` · `sbyte`)는 `int`, `float`(· `double`)는 `float`, 나머지 낱말은 `string`, 빈 칸은 주석 열이라 뺀다. **없으면 데이터로 정한다** — 그 열의 모든 데이터 칸이 int 범위의 정수면 `int`, 모든 칸이 숫자이고 소수점 · 지수가 든 칸이 있으면 `float`, 그 밖에는 `string`. 빈 칸이 하나라도 있거나 데이터 행이 없으면 `string`, int 범위를 넘는 정수만 있는 열도 `string` | 리더는 숫자 열의 빈 칸에서 그 행을 버린다 — 빈 칸이 있는 열은 `string` 으로 받아야 산다. 큰 정수를 `float` 로 받으면 자릿수를 잃는다. `1,5` · `NaN` · `Infinity` 는 숫자로 보지 않는다(리더는 `1,5` 를 15 로 읽는다) |
| CG3 | **행을 읽는 규칙은 리더와 같다** — 첫 칸이 `#` 로 시작하는 줄은 주석(1행이 `#타입` 꼴이면 타입 행), 주석 · 빈 줄을 건너뛴 첫 줄이 머리글, 그 아래의 주석 · 빈 줄이 아닌 줄이 데이터. 생성기는 `deriveSchema` 가 아니라 칸을 직접 읽는다(`analyzeDto`) | §2 계약(1행 타입 · 2행 머리글), 머리글만 있는 표, `#타입 / #설명 / 머리글` 3행 표가 같은 규칙으로 읽힌다. 3행 표는 그리드에서 `#설명` 줄이 머리글 행으로 보인다(§2 는 2행이 머리글) — 내보내기만 3행을 안다 |
| CG10 | **타입 행에 `int` 를 더했다(§2 계약 확장, Jay 2026-11-20).** 부호 있는 정수, int 범위. 숫자 열로 다룬다(오른쪽 맞춤 · bake 표의 정렬 — `isNumericType`). 지금까지의 파일은 그대로 읽힌다 | DTO 가 `int` 를 쓴다. 그전에는 타입 행에 `int` 가 하나라도 있으면 타입 행으로 보지 않아 표 전체가 검증 · 고정 행 없이 열렸다 |
| CG4 | 머리글이 `#` 로 시작하거나 빈 열은 조용히 뺀다. **C# 이름으로 못 쓰는 머리글(공백 · 기호 · 숫자로 시작 · 앞뒤 공백), 앞 열과 이름이 같은 열, 타입 칸이 빈 열은 빼고 알린다** — 알림 줄과 파일 머리 주석에. 예약어는 `@` 를 붙인다. 한글 이름은 그대로 쓴다 | 이름을 고쳐 쓰면 머리글과 필드가 어긋나 리더가 조용히 기본값을 넣는다 |
| CG5 | 열 설명은 `/// <summary>` 로 — `_Field` 의 `표이름Def` 블록(§6.2), 없으면 타입 행과 머리글 사이의 주석 줄(3행 표의 `#설명`) | |
| CG6 | **파일 이름 = 클래스 이름.** 기본값은 표 이름에서 — `_Table` 을 떼고 낱말 첫 글자를 대문자로, 마지막 낱말의 흔한 영어 복수형을 단수로, 끝에 `DTO`(`enemies.tsv` → `EnemyDTO`, `wave_meta.tsv` → `WaveMetaDTO`, `Tile_Table.tsv` → `TileDTO`). 대화상자에 미리 채울 뿐이고 고칠 수 있다. 네임스페이스 · `partial` · 속성은 붙이지 않는다 | 복수형 규칙은 어림이다(`series` 같은 것은 틀린다) |
| CG7 | **경로는 표마다 한 번 묻고 기억한다**(localStorage `jaydocs.dto:<작업 공간>` — 표 경로 → `.cs` 경로, 마지막 폴더). `Ctrl+Alt+E` 는 기억한 경로가 있으면 묻지 않고 덮어쓴다. 팔레트 "경로 · 클래스 이름 바꾸기…" 는 다시 묻는다. 쓸 수 있는 곳은 주 폴더와 (읽기 전용이 아닌) 가져온 폴더 안(`@별칭/…`) | 표를 고칠 때마다 다시 내보내는 것이 주된 흐름이다. 리포 · 문서 폴더에는 설정 파일을 만들지 않는다(§25.4 끝의 목록과 같은 원칙) |
| CG8 | **덮어쓰기** — 첫 줄 근처에 `<auto-generated>` 표식이 있는 파일만 묻지 않고 덮어쓴다. 표식이 없으면(손으로 쓴 파일) 묻는다(기본 포커스는 취소). **내용이 같으면 쓰지 않는다** — 소스에 날짜를 넣지 않아 같은 표면 같은 글이 나온다. 이미 있는 파일의 줄바꿈 · BOM 을 따르고, 새 파일은 표의 줄바꿈 · BOM 없음 | 다시 쓰면 Unity 가 다시 컴파일한다. 읽지 못한 기존 파일은 백엔드의 낙관적 잠금이 막는다(덮어쓰지 않는다) |
| CG9 | 저장 전 편집도 들어간다(스토어의 지금 표). `.cs` 는 형식 표(`filetypes.mjs`)에 넣지 않았다 — 트리에 보이지 않고 열 수 없다 | 여는 형식을 늘리는 것은 다른 결정이다 |

코드: `lib/codegen/csharpDto.ts`(순수 함수 — `analyzeDto` · `renderDto` · `defaultDtoClassName` · `checkDtoPath`), `lib/codegen/dtoPrefs.ts`, `App.tsx` 의 `exportDto`. 명령 `exportDto`(`Ctrl+Alt+E`) · `exportDtoAs`(팔레트). 새 의존성은 없다.

### 26.1 확인한 것

`npm test` 434(생성기 17건 · `int` 검증 1건) · `npm run build` · `npm run lint`(새 경고 없음). `#int string int float string` 타입 행의 표: 그리드가 타입 있는 표로 열고("스키마: 타입 행만") `int` 열의 `1.5` 에 "정수여야 합니다", `-60` 은 통과, 내보내면 `int ID` · `int MaxHp` · `float Speed` · `string` 둘. 아래는 `float` 를 넣기 전에 본 것이다. dev `?opfs` + 내장 브라우저: `Item_Table.tsv` 에서 `Ctrl+Alt+E` → 대화상자에 `data/Item/ItemDTO.cs` 가 채워짐 → 틀린 이름(`Item DTO.cs`)은 닫지 않고 칸 아래에 이유 → `out/Scripts/ItemDTO.cs` 로 만들어짐(없는 폴더 포함, `_Field` 설명이 주석으로, `uint` 열 둘이 `int`) → 다시 누르면 묻지 않고 "바뀐 것이 없어 다시 쓰지 않았습니다"(수정 시각 그대로) → 그 파일을 표식 없는 CRLF 파일로 바꿔 놓고 누르면 확인 창(포커스는 취소, `Esc` 면 그대로) → 덮어쓰면 표식이 생기고 CRLF 유지 → 포커스는 그리드로. 팔레트에 두 명령.

### 26.2 확인하지 못한 것 (TESTCASES §20)

- 실제 폴더 — Unity 프로젝트를 가져온 폴더(`@별칭/Assets/…`)에 쓰기, Unity 가 그 파일을 받아 컴파일하는지, `.meta` 가 유지되는지.
- 만든 DTO 로 실제 리더(`TSVReader` · CsvHelper)가 표를 읽는지.
- 설치한 Edge 앱에서 `Ctrl+Alt+E` 가 페이지까지 오는지(내장 브라우저에서는 `KeyboardEvent` 를 dispatch 했다).
- 읽기 전용 폴더 · UTF-8 이 아닌 기존 파일에 쓰려 할 때의 알림(코드로만).

### 26.3 넣지 않은 것

| 기능 | 이유 |
|---|---|
| C# DTO → 표 | 결과가 타입 행 · 머리글뿐인 빈 표라 덮어쓰면 데이터 행이 사라진다. 표가 원본이다(§13-1). 브라우저에는 C# 파서가 없어 평평한 DTO 만 읽을 수 있다 |
| JSON → C# DTO | 샘플 하나로는 타입을 정할 수 없는 곳이 많고(`1` 과 `1.0`, `null`, 빈 배열), IDE 가 이미 한다 |
| C# DTO → JSON | 기본값 뼈대만 나온다. Unity 의 `JsonUtility.ToJson(new T(), true)` 가 직렬화 규칙까지 맞게 낸다 |

## 27. 코드 블록의 색 (2026-11-21)

마크다운의 ```` ``` ```` 코드 블록에 언어별 색을 넣는다(Jay 요청 — "Visual Studio 기준의 색과 스타일", 하이브리드와 미리보기에). 그전에는 코드 상자 배경만 있었다.

후보 다섯을 Jay 가 준 C# 조각(14줄)으로 재고 골랐다(Node 에서 잼, 크기는 esbuild 로 묶어 gzip):

| 후보 | 타입 · 메서드 · 변수 구분 | 더 실리는 크기(gz) | 조각 하나 | 2천 줄 블록 |
|---|---|---|---|---|
| **Shiki** (VS Code 의 TextMate 문법 · 테마) | 셋 다 | 약 67 kB | 2.5 ms | 205 ms |
| Prism | 타입 · 메서드만(변수 · 매개변수는 평문) | 9.5 kB | 0.2 ms | 6.5 ms |
| CodeMirror legacy 모드(clike) | 키워드 · 내장 타입 · 주석 · 문자열만 | 7.6 kB | 0.6 ms | 12 ms |
| highlight.js | 메서드 호출을 못 잡는다 | 9.8 kB | — | — |
| `@replit/codemirror-lang-csharp` | 거의 모든 이름을 타입으로 칠한다 | 48 kB | — | — |

| # | 결정 | 근거 |
|---|---|---|
| CC1 | **Shiki** 를 쓴다(`shiki` 4.6, 새 의존성). 정규식 엔진은 JS 엔진(`shiki/engine/javascript`) — wasm 을 싣지 않는다 | Jay 의 스크린샷과 같은 색이 나온 것은 Shiki 뿐이다(키워드 `#569CD6` · 타입 `#4EC9B0` · 메서드 `#DCDCAA` · 변수 `#9CDCFE` · 주석 `#6A9955`). 표의 언어 19개가 JS 엔진에서 전부 돈다(테스트가 검사) |
| CC2 | **테마는 앱 테마를 따른다** — 밝으면 `light-plus`, 어두우면 `dark-plus`. 토큰마다 두 색을 다 들고(`--tk-l` · `--tk-d`) `styles.css` 의 `.tk` 가 고른다. 코드 상자의 배경(`--code-bg`)과 기본 글자색은 그대로 두고, 테마의 기본 글자색인 토큰에는 색을 넣지 않는다 | 테마를 바꿀 때 다시 나누거나 다시 그리지 않는다. 한 번에 두 테마로 나누므로 나누는 시간은 두 배다(조각 하나 5 ms) |
| CC3 | **색을 넣는 언어는 표 하나(`src/lib/code/langs.ts`)에 적는다** — C# · HLSL · ShaderLab · JSON · JSONC · YAML · XML · HTML · CSS · JS · TS · Python · Lua · 셸 · PowerShell · 배치 · INI · SQL · Diff. 별칭(```` ```cs ```` ```` ```c# ```` ```` ```bash ````)도 거기에. 표에 없는 언어는 전처럼 색 없이 보인다 | 서비스 워커가 `dist` 의 파일을 전부 미리 받는다 — Shiki 의 문법 200여 개를 다 넣으면 설치 · 업데이트가 무거워진다. C++ 문법은 혼자 530 kB 라 뺐다(한 줄이면 넣는다) |
| CC4 | **넣는 곳** — 미리보기 · 훑어보기 창과 패널(`components/CodeBlock.tsx`), 편집기의 소스 · 하이브리드(`lib/code/cmColors.ts`). **썸네일(폴더 훑어보기 · 새 문서 창)에는 넣지 않는다.** `.json` 파일 창의 강조(lezer)는 그대로다 | 썸네일 격자가 문법을 받고 나누느라 느려지지 않게(§25 SK2 의 `light`) |
| CC5 | **편집기는 글자를 치는 동안 있던 색의 위치만 옮기고, 입력이 90 ms 멈추면 다시 나눈다.** 보이는 범위에 걸친 블록만 나눈다. 한글 조합 중에는 장식을 바꾸지 않는다. 결과는 (언어, 글) 로 300개까지 기억한다. **400줄 또는 4만 자를 넘는 블록은 색을 넣지 않는다** | 하이브리드는 글자 · 커서가 바뀔 때마다 장식을 통째로 다시 만든다 — 거기서 나누면 긴 블록의 입력이 밀린다. 그래서 `hybrid.ts` 와 따로 도는 `ViewPlugin` 으로 뒀다(줄 장식 = 상자 모양은 `hybrid.ts`, 글자 색은 `cmColors.ts`) |
| CC6 | **Shiki 본체 · 테마 · 문법은 코드 블록을 처음 그릴 때 받는다**(mermaid 와 같은 방식, 언어마다 청크 하나). 받는 동안은 색 없이 보이다가 칠해진다. 받지 못하거나 나누다 실패하면 색 없이 보이고 콘솔에만 남긴다 | 앱 시작에 실리는 것이 없다 — `vendor` 는 gz 340 kB 그대로다 |
| CC7 | 인용 · 목록 안의 펜스는 줄 앞 표식(`>` · 들여쓰기)을 빼고 나누고 색의 위치는 문서 기준으로 되돌린다 | lezer 의 `CodeText` 가 줄마다 표식 뒤부터다 |
| CC8 | 단축키 · 팔레트 명령은 없다 | 켜고 끄는 동작이 없는 표시다 |

코드: `lib/code/langs.ts`(언어 표 · `codeLangOf`), `lib/code/highlight.ts`(Shiki 지연 로드 · `tokenizeCode` · 기억 · 상한), `lib/code/cmColors.ts`(편집기 확장 `codeColors` — `lib/cm.ts` 의 `baseExtensions` 가 마크다운 창에 넣는다), `components/CodeBlock.tsx`(미리보기 — `PreviewPane.tsx` 의 `mdComponents` 가 쓴다), `styles.css` 의 `.tk`.

### 27.1 확인한 것

`npm test` 447(새 13건 — 언어 표 · 표의 언어가 전부 실리는지 · C# 조각의 색 · 상한 · 편집기 위치) · `npm run build` · `npm run lint`(새 경고 없음). 빌드: Shiki `core` 95 kB(gz 30) · `engine-javascript` 58 kB(gz 20) · 테마 둘 19 kB(gz 4) · `csharp` 91 kB(gz 11) 가 따로 떨어진 청크로 나오고 `vendor` 는 gz 339.97 kB 그대로. `dist` 는 파일 102 → 128개, 6.6 → 7.7 MB.

dev `?opfs` + 내장 브라우저(`docs/코드.md` 샘플): 소스 · 하이브리드 · 분할의 미리보기 · 훑어보기 창에서 C# 조각이 같은 색(어두운 테마 `private` `#569CD6` · `UniTaskVoid` `#4EC9B0` · `ResolveTurnAsync` `#DCDCAA` · `playerId` `#9CDCFE`, 밝은 테마 `#0000FF` · `#267F99` · `#795E26`), 테마를 바꾸면 다시 그리지 않고 색만 바뀜, 인용 안의 ```` ```json ```` 도 칠해짐, 표에 없는 ```` ```cobol ```` 은 색 없음, 블록 안에 줄을 넣으면 바로는 색이 없다가 멈춘 뒤 칠해지고 미리보기도 따라옴. 콘솔 오류 없음.

입력 지연(개발 빌드, 분할 모드, 390줄 C# 블록): 글자 하나의 처리 시간 중앙값이 색 있는 블록 0.9 ms · 색 없는 블록 0.7 ms. 입력이 멈춘 뒤 다시 나누는 긴 작업이 113 ms 한 번(미리보기 다시 그리기 포함).

### 27.2 확인하지 못한 것 (TESTCASES §21)

- 실제 한글 IME 로 코드 블록 안에서 조합하는 동안 색 · 조합이 온전한지(자동화는 조합을 못 흉내 낸다).
- 빌드본의 화면 — `?opfs` 가 개발 전용이라 빌드본은 청크가 나뉘는 것까지만 봤다. 설치한 앱이 업데이트 때 받는 파일 수.
- 썸네일에 색이 없는 것은 코드로만(`weight === 'rich'`).
- 실제 수업 자료(긴 C# · ShaderLab)에서 색이 맞는지.

## 28. 파일 · 폴더를 트리에 끌어다 놓아 가져오기 · 파일 하나 가져오기 (2026-11-22)

Jay 요청 — 파일 탐색기에서 파일이나 폴더를 끌어다 하이어라키(파일 트리)에 추가. 뜻은 **복사가 아니라 `@별칭` 으로 가져오기**(Jay). 2026-11-21 에 "폴더를 고를 때 안의 문서 보기" 와 함께 넣었다가 뺀 폴더 끌어다 놓기(`62b0a03` → `f956d90`)와 같은 길이지만, 이번에는 트리에 놓는 것만 받고 파일 하나도 가져온다. 그때 남긴 "파일 하나 가져오기는 넣지 않는다(옆 파일을 못 읽는다)" 는 이번 요청으로 바뀌었다 — 옆 파일을 못 읽는 한계는 그대로 두고 알린다.

| # | 결정 | 근거 |
|---|---|---|
| DR1 | **파일 트리(`.tree`) 위에 놓은 것만 받는다.** 놓으면 가져오기 창이 그것으로 뜨고 포커스는 **가져오기** — `Enter` 한 번으로 끝난다(별칭 · 읽기 전용 · 상세 경로는 고를 수 있다). 끄는 동안 트리를 칠하고 창 아래에 안내를 띄운다(`lib/treeDrop.ts`, `DataTransferItem.getAsFileSystemHandle()`) | "트리에 추가" 가 요청이다. 바로 가져오지 않고 창을 거치는 것은 읽기 전용을 고를 자리가 있어야 해서다(수강생 제출물) |
| DR2 | **편집기 위에 놓는 것은 건드리지 않는다.** 그 밖의 곳(창 막대 · 빈 화면)에 놓으면 아무것도 하지 않고 "파일 트리에 놓으면 가져옵니다" 알림 — 브라우저가 그 파일로 페이지를 바꿔 앱을 떠나는 것도 막는다 | 편집기의 원래 동작을 바꾸지 않는다. 전에는 편집기 밖에 놓으면 앱을 떠났다 |
| DR3 | **하나씩 가져온다.** 여럿을 놓으면 첫 항목만 고르고 알린다 | 가져오기 창은 하나씩이다 |
| DR4 | **이미 열려 있는 곳 안의 것이면 가져오지 않는다** — 파일은 그 탭을 열고, 폴더는 트리 커서를 거기로(`Backend.pathOf`) | 겹치는 가져오기는 어차피 거부된다. 놓은 사람이 원하는 것은 그 항목을 보는 것이다 |
| DR5 | **파일 하나를 `@별칭` 으로 가져온다** — 트리에 `@별칭` 과 그 아래 그 파일 하나. 별칭은 확장자를 뗀 이름. 여는 형식(`filetypes.mjs`)만 받는다. 저장 · 읽기 전용 · 해제 · 최근 목록 · 권한 · 상세 경로(파일의 전체 경로) · 변경 감지는 폴더와 같다 | 백엔드는 그 파일 하나만 든 가짜 폴더(`SingleFileDir`)로 다뤄 트리 · 읽기 · 저장 코드를 그대로 쓴다. IndexedDB 에는 파일 핸들을 그대로 남긴다 |
| DR6 | **가져온 파일 안에서는 그 파일을 고쳐 저장하는 것만 된다.** 새 파일 · 새 폴더 · 이름 바꾸기 · 지우기는 대화상자 전에 알림 줄로 막고(`store.inFileRoot`), 백엔드도 거부한다. 옆 파일(그림 · `tsv-view` · `_Field`)은 읽지 못한다 — 가져오기 창에 적어 두었다 | 브라우저는 파일 핸들에서 그 폴더로 올라가게 해 주지 않는다. 옆 파일이 필요하면 폴더째 가져온다 |
| DR7 | 가져온 파일이 든 폴더를 가져오면 겹침으로 거부한다(파일을 먼저 해제) | 같은 파일이 두 경로로 열리면 저장 충돌이 난다 |
| DR8 | 가져오기 창에 **폴더 고르기…** 와 **파일 고르기…** 를 둘 다 둔다. 읽기 전용을 바꿔도 고른 것을 버리지 않는다 — 권한은 가져올 때 그 모드로 묻는다 | 끌어다 놓은 뒤 읽기 전용을 켜도 다시 고를 필요가 없다 |
| DR9 | 키보드: **`Ctrl+Alt+I` 파일 가져오기**(가져오기 창, 포커스는 **파일 고르기…**), 팔레트 "파일 가져오기…". 폴더는 전처럼 `Ctrl+Shift+O`. 처음 계획한 `Ctrl+Alt+Shift+I`(폴더 추가)는 `Ctrl+Shift+O` 와 같은 일이라 두지 않았다 | 같은 명령에 키 둘을 두지 않는다 |

코드: `lib/treeDrop.ts`(놓는 곳 · 핸들 꺼내기 · `useTreeDrop`), `App.tsx` 의 `onTreeDrop`, `components/ImportDialog.tsx`, `lib/fsa/fsaBackend.ts`(`SingleFileDir` · `rootOf` · `pathOf` · `addRoot`), `store/documents.ts` 의 `inFileRoot`.

### 28.1 확인한 것

`npm test` 470(이 절 새 13건 — 파일 가져오기 9 · 파일 감시 1 · 끌어다 놓기 3) · `npm run build` · `npm run lint`(새 경고 없음).

dev `?opfs` + 내장 브라우저(브라우저 안 저장소에 바깥 폴더 · 파일을 만들고 그 핸들을 든 `dragover` · `drop` 이벤트를 dispatch): 트리 위로 끌면 트리가 칠해지고 안내가 뜸 → 폴더를 놓으면 가져오기 창이 그 폴더로, 포커스는 **가져오기**, `Enter` 로 트리에 `@수업자료` → 파일을 놓으면 별칭 칸에 `제출`, 가져오면 `@제출` 아래 `제출.md` 하나 → 열어 고치고 `Ctrl+S` 하면 원래 파일에 써짐 → `@제출` 에서 **＋파일** 은 알림으로 막힘 → 주 폴더 안의 파일을 놓으면 그 탭이 열림 → 그림 파일은 "여는 문서 형식이 아닙니다" → 창 막대에 놓으면 안내만 → `Ctrl+Alt+I` 는 창을 열고 포커스가 **파일 고르기…**, 다시 누르면 닫힘.

### 28.2 확인하지 못한 것 (TESTCASES §22)

- **실제 파일 탐색기에서 끌어다 놓기** — 자동화는 OS 의 끌기를 못 한다. 놓은 핸들의 권한 흐름(가져올 때 쓰기를 묻는다)도 같이.
- 실제 파일 선택 창(`showOpenFilePicker`).
- 재시작 뒤 가져온 파일의 권한(허용 화면에서 파일도 다시 묻는지)과 설치한 Edge 앱 창에 놓기.
- 실제 폴더에서 가져온 파일을 다른 프로그램이 고쳤을 때 알림(파일 하나를 보는 `FileSystemObserver`).

## 29. 하이브리드 목차 (2026-11-22)

Jay 요청 — 노션 · 위키처럼 마크다운 문서 왼쪽에 목차. 하이브리드 모드에서만 보이면 된다(Jay). 마크다운 문서에만.

| # | 결정 | 근거 |
|---|---|---|
| OL1 | 마크다운 창이 **하이브리드 모드일 때만** `.md-body` 왼쪽에 240px 띠(`components/OutlinePanel.tsx`). 단계마다 들여 쓰고 왼쪽에 세로선. 가장 높은 단계는 본문 글자색, 아래 단계는 흐린 색 | Jay 의 그림. 훑어보기 패널(오른쪽)과 같이 켤 수 있다 |
| OL2 | 제목은 **편집기의 구문 트리**(lezer markdown)에서 뽑는다 — ATX · Setext, 인용 · 목록 안의 제목도. 코드 펜스 안의 `#` 은 빠진다. 제목 글의 표식(`**` · `` ` `` · 링크 · 닫는 `#`)은 뗀다(`lib/md/outline.ts`) | 정규식으로는 펜스 안의 `#` 이 잡힌다 |
| OL3 | 글이 바뀌면 150 ms 에 한 번 다시 뽑는다. 내용이 같으면 다시 그리지 않는다 | 치는 동안에도 따라오되 매 글자마다는 아니게 |
| OL4 | **지금 절** — 편집기 스크롤의 맨 위(12px 아래) 줄이 든 절의 제목을 칠하고, 띠 안에서 보이게 한다 | 그림의 1.5 처럼. 편집기 아래에 40vh 여백이 있어 마지막 제목도 맨 위까지 올라온다 |
| OL5 | 누르면 그 제목을 편집기 맨 위로 올리고 커서를 제목 글 앞에 둔다. 포커스는 편집기 | 훑어보기 패널을 누를 때와 같다 |
| OL6 | 켬 · 끔은 앱 전체에 하나, localStorage(`jaydocs.outline.on`), **기본은 켜짐**. 창 막대의 **목차** 버튼(하이브리드일 때만 보인다) · 팔레트 "목차 보이기 / 숨기기" | 요청한 기능이라 켜 둔다 |
| OL7 | 창이 600px 보다 좁으면 숨긴다(CSS container query) | 본문이 너무 좁아지지 않게. 분할한 창에서도 넓으면 보인다 |
| OL8 | 키보드: **`Ctrl+Alt+T`** 목차로 포커스(꺼져 있으면 켠다, 목차에서 다시 누르면 편집기로), 목차 안에서 `↑` `↓` `Home` `End` `PageUp` `PageDown` 고르기 · `Enter` 가서 편집기로 · `Space` 가기만 · `Esc` 편집기로. 하이브리드가 아니면 알림(보기 모드 순환은 `Ctrl+Shift+V`) | 모든 작업이 키보드로. `T` = TOC |

코드: `lib/md/outline.ts`(`outlineOf` · `activeIndex` · `plainHeading`), `lib/md/outlineState.ts`, `components/OutlinePanel.tsx` · `.css`, `MarkdownPane.tsx`(띠 · 버튼 · `focusOutline`), `Workbench.tsx`(명령 `focusOutline` · `toggleOutline`).

### 29.1 확인한 것

`npm test` — 이 절 새 10건(제목 단계 · 펜스 안 `#` · Setext · 표식 떼기 · 인용 · 목록 · 지금 절). dev `?opfs` + 내장 브라우저(제목 20개 · 펜스가 든 시험 문서): 하이브리드에서만 띠가 보임, 펜스 안의 `#` 은 빠짐, 제목을 누르면 맨 위로 오고 칠해짐, 편집기를 스크롤하면 칠한 제목이 따라감, `Ctrl+Alt+T` → `↑` → `Space` → `Esc` 흐름, 소스 모드로 바꾸면 띠와 버튼이 사라짐, **목차** 버튼으로 끄고 켬.

### 29.2 확인하지 못한 것 (TESTCASES §23)

- 실제 한글 IME 로 제목을 치는 동안 목차가 갱신되며 조합이 깨지지 않는지.
- 아주 긴 문서(제목 수백 개 · 수만 줄)에서 치는 동안의 입력 지연.
- 밝은 테마의 색 · 설치한 Edge 앱에서 `Ctrl+Alt+T`.

## 30. 파일 탐색기 열기 삭제 · 전체 경로 복사 정리 (2026-11-22)

Jay 요청 — "파일 탐색기에서 열기" 를 뺀다. 그리고 "전체 경로 복사를 누르면 가져오기 창이 뜨는 것 같다 — 브라우저 앱은 경로 복사가 안 되나?"

**점검 결과**: 경로 복사는 된다. 다만 브라우저(File System Access API)는 보안상 폴더의 전체 경로를 알려 주지 않아, 사용자가 한 번 넣은 **상세 경로**(§21 P1)에 앱 경로를 붙여 만든다. 상세 경로가 없으면 그것을 묻는 "폴더 정보" 창을 띄웠는데, 이 창이 가져오기 창과 같은 모양 · 같은 클래스(`palette import`)이고 제목도 "문서 폴더 정보" 라 가져오기 창으로 보였다. 또 내장 브라우저처럼 클립보드 쓰기 권한이 막힌 곳에서는 `navigator.clipboard.writeText` 가 실패해 "복사하지 못했습니다" 로 끝났다.

| # | 결정 | 근거 |
|---|---|---|
| X1 | **파일 탐색기에서 열기를 뺀다** — 트리 메뉴 항목, 팔레트 "파일 탐색기에서 문서 폴더 열기" · "파일 탐색기 연결 도우미…", `lib/explorer.ts`, `ExplorerHelperDialog.tsx`, `public/helper/jaydocs-explorer-setup.cmd` | Jay. PC 에 도우미를 깔아야 하는 기능이었다 |
| X2 | 경로를 몰라 묻는 창은 **제목 "전체 경로 복사"**, 경로 칸만(별칭 칸 없음), "브라우저 앱은 보안상 전체 경로를 알 수 없어요 — 한 번 알려 주면 기억" 설명, 버튼 **저장하고 복사**. 경로를 비우면 저장하지 않는다 | 무엇을 왜 묻는지 보이게. 가져오기와 헷갈리지 않게 |
| X3 | 복사는 Clipboard API → 막히면 `execCommand('copy')`(`lib/copyText.ts`). 둘 다 안 되면 경로를 알림에 보여 직접 복사하게 한다 | 권한 · 포커스에 따라 API 가 막히는 환경이 있다. 내장 브라우저에서 두 번째 방식으로 복사되는 것을 확인했다 |
| X4 | 팔레트 **현재 문서의 전체 경로 복사**(단축키 없음) | 메뉴(마우스 · `Shift+F10`) 말고도 키보드로. 자주 쓰지 않아 키는 두지 않는다 |
| X5 | 가져온 파일(§28)의 경로 창은 "파일의 전체 경로" 를 받는다. 제목도 "가져온 파일 정보" | 파일 하나만 가져온 곳은 상세 경로가 곧 그 파일의 경로다 |

Jay 의 PC 에 설치된 연결 도우미는 그대로 남는다 — 지우려면 `%LOCALAPPDATA%\JayDocs\jaydocs-explorer.cmd /uninstall`(또는 레지스트리 `HKCU\Software\Classes\jaydocs-open` 과 그 폴더를 지운다). 남겨 둬도 JayDocs 가 부르지 않는다. localStorage 의 `jaydocs.explorerHelper` 도 쓰지 않는다.

### 30.1 확인한 것

`npm test` 469(탐색기 주소 테스트 1건 삭제) · `npm run build`(`dist/helper/` 없음) · `npm run lint`(새 경고 없음). dev `?opfs` + 내장 브라우저: 메뉴에 탐색기 항목 없음 → 상세 경로 없이 **전체 경로 복사** → "전체 경로 복사 — 📁 dev-docs" 창 → 경로를 넣고 `Enter` → "경로를 복사했습니다: D:\Docs\dev-docs\docs\개요.md"(Clipboard API 는 `denied`, 두 번째 방식으로) → 다시 누르면 묻지 않고 복사.

### 30.2 확인하지 못한 것 (TESTCASES §24)

- 설치한 Edge 앱에서 복사 → 붙여 넣기(TC-2408). Edge 는 보통 Clipboard API 가 된다.

## 31. 경로 막대 (2026-11-23)

UI/UX 개편 A1(`docs/research/apple-uiux/ADOPT.md`). 원칙 확인: 1 · 4 · 5 맞음, 2 주의(아래 PB6 · PB7), 나머지 상관없음.

| # | 결정 | 근거 |
|---|---|---|
| PB1 | 문서 창 막대의 경로 글자(`pane-path`)를 **경로 막대**로 바꾼다 — `루트 › 폴더 › … › 파일 › 마지막 단계`. 새 줄을 더하지 않는다 | 창 막대가 이미 탭과 편집기 사이의 한 줄이다. 세로 자리를 늘리지 않는다 |
| PB2 | 루트는 주 폴더면 문서 별칭(§21), 가져온 폴더면 `@별칭` | 트리 머리와 같은 이름 |
| PB3 | 마지막 단계: 마크다운은 **커서가 든 절의 제목**(미리보기 전용 모드에서는 없다 — 편집기가 숨는다), 표는 **활성 셀의 열**(`A · 이름`), `_Field` 시트는 활성 셀이 든 **블록**(블록 사이 빈 줄은 위 블록). txt · json 은 없다 | ADOPT A1. 목차 띠(§29)는 스크롤 맨 위의 절, 경로 막대는 커서의 절 |
| PB4 | 단계를 누르면(키보드 `Enter` · `↓` · `Space`) 목록이 뜬다. 루트 · 폴더 · 파일 단계는 **같은 폴더의 항목**(트리 순서 — 폴더 먼저), 루트 단계는 주 폴더 + 가져온 폴더. 목록에서 폴더는 안으로 들어가고(`→` 도) `←` · `Backspace`(거르는 글자가 없을 때) · 머리의 `↑` 는 상위로. 파일은 열고 그 창으로 포커스(`openPath(…, true)`) | Xcode 점프 바 · Finder 경로 막대. 트리를 펼치지 않고 이웃으로 간다 |
| PB5 | 목록 맨 위에 입력 칸 — 글자를 치면 거른다(팔레트와 같은 `lib/match.ts`). 지금 문서가 있는 항목은 굵게, 처음 커서도 거기 | 글자로 거르기는 팔레트 · 파일 검색과 같은 손 |
| PB6 | 폴더 목록은 **목록을 열 때만** 트리의 파일 경로(`store.filePaths()`)에서 뽑는다. 한 번에 300개까지 그리고 나머지는 "N개 더 — 글자로 거르세요" | 평소 비용 0. Unity 폴더(2만 항목)에서도 가볍게 |
| PB7 | 제목은 `lib/md/outline.ts` 를 같이 쓴다 — 같은 글 · 같은(또는 더 자란) 구문 트리면 뽑아 둔 것을 돌려준다(캐시). 경로 막대는 글 · 커서가 바뀌면 120 ms 에 한 번, **구문 트리를 기다리지 않고**(budget 0) 지금 트리로 본다. 목록을 열 때만 50 ms 기다린다 | 치는 동안 입력이 밀리지 않게. 커서 위쪽은 이미 읽혀 있다 |
| PB8 | 키: **`Ctrl+Shift+.`** 경로 막대로 포커스 — 활성 문서 창의 막대, 마지막 단계에서 시작(VS Code 와 같은 키). 막대 안 `← / →` · `Home / End` 단계, `Esc` 는 목록을 닫고, 목록이 없으면 편집기 · 그리드로. 팔레트 "경로 막대로 포커스". F6 순서에는 넣지 않는다(문서 창의 일부) | ADOPT A1 · 단축키 규칙(`Ctrl+Shift+` = 영역으로) |
| PB9 | 좁으면 앞 단계부터 `…` 로 줄고, 더 좁으면 앞이 잘린다(`justify-content: flex-end`) — 파일 이름과 마지막 단계가 끝까지 보인다 | ADOPT A1 "앞 단계를 접는다" |
| PB10 | 키보드 포커스가 있는 단계는 **강조색 블록**(`--accent` 바탕 · `--badge-fg` 글자), 목록이 열린 단계는 연한 블록(`--accent-soft`). 외곽선은 쓰지 않는다 | Jay(2026-11-23) — 공통 외곽선은 막대의 `overflow: hidden` 에 잘려 괄호처럼만 보여 너무 약했다 |

코드: `lib/pathbar.ts`(`crumbsOf` · `listDir` · `listRoots` · `parentDir` · `filterByLabel`), `lib/match.ts`(팔레트에서 옮김), `components/PathBar.tsx` · `.css`, `MarkdownPane.tsx`(제목 단계 · `pathPing`), `GridPane.tsx`(열 · 블록 단계), `Workbench.tsx`(명령 `focusPathBar`), `lib/md/outline.ts`(캐시), `lib/nav.ts`(`openPath` 의 `focus`), `store.filePaths()`.

### 31.1 확인한 것

`npm test` — 이 절 새 11건(`pathbar.test.ts`: 단계 · 목록 · 루트 · 상위 · 거르기). dev `?opfs` + 내장 브라우저(`Ctrl+Shift+.` 는 이벤트로): md · csv · `_Field` 의 마지막 단계, `Ctrl+Shift+.` → `←` → `Enter` → `→` 로 폴더 안 → 글자 거르기 → `Enter` 로 csv 열기(그리드에 포커스), 열 목록에서 `메모` → 활성 셀 D, `_Field` 블록 목록 → Category 행, `Home` → 루트 목록(주 폴더 · `@가져온폴더`) → 세 단계 내려가 `Item_Field.tsv` 열기, 제목 3개(단계 들여쓰기 · 지금 절 굵게) → 첫 제목으로, 가져온 폴더 문서의 루트 단계를 마우스로, 밖을 누르면 목록이 닫힘, `Esc` 로 그리드, 560px · 900px 너비. 콘솔 오류 없음.

### 31.2 확인하지 못한 것 (TESTCASES §25)

- 설치한 Edge 앱에서 `Ctrl+Shift+.` 가 앱에 오는지 — HANDOFF 의 "먼저 시험".
- 실제 한글 IME 로 목록을 거를 때(자동화는 글자를 바로 넣는다).
- 실제 폴더 · 큰 폴더(Unity)에서 목록을 여는 속도, 긴 문서에서 치는 동안의 지연.

## 32. 문서 상태 줄 (2026-11-23)

UI/UX 개편 A2(`docs/research/apple-uiux/ADOPT.md`). 원칙 확인: 1 · 3 · 7 맞음(키보드 사용자도 열 정보를 본다, 표 확인을 문서에 쓰지 않고 한다, 표시만 한다), 2 주의(SS4), 나머지 상관없음.

| # | 결정 | 근거 |
|---|---|---|
| SS1 | 모든 문서 창(마크다운 · txt · json · 표)의 맨 아래에 한 줄(`components/DocStatus.tsx`). `[자리 정보 …] [선택 요약] [창이 넣는 것] [LF · BOM 없음] [UTF-8] [저장됨]` | ADOPT A2. 그리드에만 있던 아래 줄(`grid-foot`)을 모든 형식으로 넓혔다 |
| SS2 | 저장 상태 글자(`저장됨` · `● 수정됨` · `저장 중…` · `충돌` · `🔒 읽기 전용`)는 **위 창 막대에서 이 줄로 옮긴다**. 위에는 **저장** 단추만 남는다 | 한 곳에만 둔다. 위 막대는 경로 막대(§31)가 넓게 쓴다 |
| SS3 | 그리드의 자리 정보: 활성 셀 이름(`C7`) · 열 이름 · 타입(타입 행이 있는 표만, `#` 뗌, 주석 열 · 리스트 표시) · **검증 오류**(빨강 `⚠`) · Field 설명. 넘치면 끝이 `…` | 지금은 마우스 툴팁에만 있던 정보 |
| SS4 | **선택 요약**: 여러 칸을 고르면 개수(비지 않은 칸) · 합 · 평균 · 최소 · 최대. 머리글 행은 뺀다. 숫자는 타입 행이 있는 표면 숫자 타입 열(byte · uint · int · float)만, 없는 표(CSV 등)는 숫자로 읽히는 칸(Sheets 와 같다). 20만 칸이 넘으면 세지 않고 "N칸 — 요약은 200,000칸까지"(`lib/tsv/summary.ts`) | Numbers · Sheets 의 아래쪽 빠른 계산. string 열의 `001` 같은 키가 합에 섞이지 않게. 큰 표 전체 선택에서 멈추지 않게 |
| SS5 | 보일 계산은 팔레트 **선택 요약: 합 보이기 / 숨기기** 등 다섯 개로 켜고 끈다(이름이 지금 상태를 따라간다). 기본은 개수 · 합 · 평균, localStorage `jaydocs.selSummary` | ADOPT A2 "선택 요약에 보일 계산 고르기" — 여러 개 고르는 새 창 대신 팔레트 명령. 키는 주지 않는다(드문 동작) |
| SS6 | 그리드가 그 밖에 넣는 것: 표 크기 · 오류 수 · 스키마 · 계산식 · **끝 개행 추가** 단추(예전 아래 줄과 같다) | 있던 것을 잃지 않는다 |
| SS7 | 인코딩이 UTF-8 이 아니면 인코딩이 **단추**가 된다 — 누르면 "UTF-8 로 바꿔 저장" 확인(안내 막대와 같은 함수 `confirmConvertToUtf8`). 팔레트에도 **UTF-8 로 바꿔 저장** | ADOPT A2 "항목을 누르면 관련 명령". 버튼은 팔레트에도(A6) |
| SS8 | 좁은 창(줄이 560px 미만)에서는 줄바꿈 · 표 크기 · 스키마 · 계산식 · "오류 없음" 을 숨긴다(container query). 인코딩 · 저장 상태는 줄지 않고 늘 보인다 — 자리 정보와 선택 요약이 `…` 로 줄어든다 | 저장 안 한 것을 놓치지 않게 |

"다른 인코딩으로 다시 열기" 는 C4 에서 넣는다. 마크다운의 자리 정보(줄 · 칸 · 글자 수)는 ADOPT 에 없어 넣지 않았다.

코드: `components/DocStatus.tsx` · `.css`, `lib/tsv/summary.ts`(`summarizeRange` · `summaryParts` · `formatNumber` · 보일 계산), `Grid.tsx`(`onRangeChange`), `GridPane.tsx`(자리 정보 · 요약 · `grid-foot` 삭제), `MarkdownPane.tsx`, `ReadOnlyBanner.tsx`(`confirmConvertToUtf8`), `Workbench.tsx`(명령 `selSummary:*` · `convertUtf8`).

### 32.1 확인한 것

`npm test` — 이 절 새 6건(`summary.test.ts`: 머리글 빼기 · 숫자 타입 열만 · 타입 행 없는 표 · 범위 밖 · 상한 · 보일 글 · 숫자 모양). dev `?opfs` + 내장 브라우저: `Item_Field.tsv`(`A1 … 12행 × 3열 · 오류 없음 · 스키마 없음 · LF · BOM 없음 · UTF-8 · 저장됨`), `Item_Table.tsv` 의 `A1 Key string 아이템 고유 키` · `C7` 의 `⚠ 허용되지 않은 값: Weapn`, E3:F9 선택 → `개수 14 · 합 434 · 평균 31`(손으로 계산한 값과 같다), 팔레트 "선택 요약: 최대 보이기" → `최대 120` · localStorage, `목록.csv`(타입 행 없음) C2:C4 → `합 14`, `개요.md` 의 `LF · BOM 없음 · UTF-8 · 저장됨`, 셀을 고치면 `● 수정됨` → `Ctrl+Z` 로 `저장됨`, EUC-KR 로 쓴 시험 파일 → `CRLF · BOM 없음 · [EUC-KR] · 🔒 읽기 전용`, 단추 → 확인창 → `Esc` 로 단추에 포커스(시험 파일은 지웠다), 창 너비 640 · 520px 에서 인코딩 · 저장 상태가 남음. 콘솔 오류 없음.

### 32.2 확인하지 못한 것 (TESTCASES §26)

- 실제 폴더의 큰 표(2만 행)에서 열 · 전체 선택 때의 반응.
- 실제 CP949 파일을 "UTF-8 로 저장" 까지 — 바꾸는 동작은 예전 안내 막대와 같은 함수다.
- 밝은 테마의 색.

## 33. 창 제목의 수정됨 표시 (2026-11-23)

UI/UX 개편 A3(`docs/research/apple-uiux/ADOPT.md`). 원칙 확인: 7 맞음(수동 저장 모델의 약점 — 다른 창으로 가면 저장 안 한 것을 잊음 — 을 줄인다), 2 주의(WT3), 나머지 상관없음.

| # | 결정 | 근거 |
|---|---|---|
| WT1 | 창 제목은 `● 개요.md — 문서 별칭 — JayDocs`(`lib/title.ts`). 활성 문서 창의 파일 이름, 문서가 없으면 `문서 별칭 — JayDocs`. 문서 별칭은 남긴다 | 예전엔 별칭만 썼다(`src/App.tsx` 의 `showRootName`, 지웠다). 별칭은 JayDocs 창이 여럿일 때 작업 표시줄에서 구분된다 |
| WT2 | `●` 는 **이 창에 저장 안 한 문서가 하나라도 있으면** 붙는다 — 지금 보는 문서가 깨끗해도 다른 탭이 고쳐졌으면 붙는다 | 창 단위 표시(macOS 닫기 버튼의 점, TextEdit). 목적이 "다른 앱으로 갔을 때 잊지 않기" 라 어느 탭이든 알려야 한다. 어느 문서인지는 탭 · 트리의 `●` 와 "모두 저장 (N)" 이 보인다 |
| WT3 | 제목은 활성 문서 · 저장 안 한 문서의 있고 없음 · 문서 별칭이 바뀔 때만 쓴다. 글자를 칠 때마다 쓰지 않는다. 활성 문서는 Workbench 가 `onActiveDocChange` 로 알리고 App 은 state 로 두지 않는다 | 탭을 바꿀 때마다 앱 전체가 다시 그려지지 않게 |

### 33.1 확인한 것

`npm test` — 새 4건(`title.test.ts`). dev `?opfs` + 내장 브라우저(`document.title`): 열 때 `Item_Table.tsv — dev-docs — JayDocs`, 셀을 고치면 `● Item_Table.tsv — …`, 다른 탭을 누르면 `● 가져온 문서.md — …`(다른 탭이 고쳐져 있어 `●` 가 남음), 돌아와 `Ctrl+Z` 면 `●` 가 사라짐. 콘솔 오류 없음.

### 33.2 확인하지 못한 것 (TESTCASES §27)

- 설치한 Edge 앱의 창 제목 · 작업 표시줄 · `Alt+Tab` 에 보이는 모양(Edge 가 앱 이름을 앞에 붙이는지).

## 34. 마지막 저장 상태로 되돌리기 (2026-11-23)

UI/UX 개편 A4(`docs/research/apple-uiux/ADOPT.md`). 원칙 확인: 7 맞음(앱 안 사본을 만들지 않고 저장한 상태가 기준점), 1 맞음(팔레트), 나머지 상관없음.

| # | 결정 | 근거 |
|---|---|---|
| RV1 | 팔레트 **마지막 저장 상태로 되돌리기 — 저장 안 한 수정 버림 (Ctrl+Z 로 다시)**. 활성 문서에 저장 안 한 수정이 있을 때만 켜진다. 키는 주지 않는다 | ADOPT A4 — 드문 동작. TextEdit · Pages 의 Revert To → Last Saved |
| RV2 | **묻지 않는다** — 되돌린 것 자체가 되돌리기 한 단계라 `Ctrl+Z` 한 번이면 고친 상태로 돌아간다. 알림 줄에 그 사실을 적는다 | HIG: 되돌릴 수 있는 동작은 묻지 않는다 |
| RV3 | 기준은 **마지막으로 저장(또는 연) 내용**(`savedText` · `savedTable`) — 디스크를 다시 읽지 않는다. 충돌 중(디스크가 바뀜)이면 꺼진다 — 그때는 배너의 "디스크 내용 받기 (내 수정 버림)" | 충돌 처리와 겹치지 않게. 문구는 배너와 같은 "수정 버림" |
| RV4 | 글 문서(md · txt · json): **활성 탭의 편집기**에 보통 트랜잭션 하나로 넣는다 — 바뀐 곳(앞 · 뒤의 같은 부분을 뺀 가운데)만 바꾼다(`lib/revert.ts`). 같은 문서가 두 창에 열려 있어도 되돌리기 기록은 활성 창에 남는다 | 편집기의 되돌리기 기록에 남아야 `Ctrl+Z` 가 된다. 바뀐 곳만 바꿔 커서 · 스크롤이 덜 흔들린다 |
| RV5 | 표: `store.revertTable` — 저장한 스냅샷을 되돌리기 스택에 한 단계로 올린다. 읽기 전용이어도 된다(고친 것을 버리는 일) | 표의 되돌리기는 문서 단위 스택 |
| RV6 | 되돌린 뒤 포커스는 그 창(편집기 · 그리드) | 바로 `Ctrl+Z` 를 누를 수 있게 |

코드: `lib/revert.ts`(`revertChange` · `revertTextInView`), `store.revertTable`, `Workbench.tsx`(명령 `revertToSaved`).

### 34.1 확인한 것

`npm test` — 새 6건(`revert.test.ts` 4: 바뀐 곳만 · 더한 글 · 지운 글 · 아무 두 글. `documents.test.ts` 2: 표 되돌리기와 `Ctrl+Z`, 고친 것이 없을 때). dev `?opfs` + 내장 브라우저: `개요.md` 의 두 곳(첫 줄 · 끝)을 고침 → 팔레트로 되돌리기 → 저장한 글 · `저장됨` · 창 제목의 `●` 사라짐 · 편집기에 포커스 · 알림 → `Ctrl+Z` 한 번에 두 곳 모두 돌아옴. 고친 것이 없으면 명령이 흐리게. `목록.csv` 의 두 칸 → 되돌리기 → 원래 값, 그리드에 포커스 → `Ctrl+Z` 로 고친 값. 콘솔 오류 없음.

### 34.2 확인하지 못한 것 (TESTCASES §28)

- 같은 문서를 두 창에 연 채 되돌리기(다른 창에도 바로 반영되는지 — 스토어가 같은 변경을 보낸다).
- 미리보기 전용 모드에서 되돌린 뒤의 `Ctrl+Z`(포커스가 미리보기에 있다).

## 35. 빈 폴더 · 빈 화면 안내 (2026-11-23)

UI/UX 개편 A5(`docs/research/apple-uiux/ADOPT.md`). 원칙 확인: 1 맞음(안내에 단축키), 5 맞음(빈 곳에서 멈추지 않는다), 나머지 상관없음.

| # | 결정 | 근거 |
|---|---|---|
| EM1 | 폴더 격자(훑어보기)에서 폴더가 비었으면 "이 폴더는 비어 있습니다", 하위 폴더만 있으면 "이 폴더 바로 아래에는 문서가 없습니다" 아래에 **새 문서** 단추 — 그 폴더 아래에 새 문서 창. 빈 폴더에서는 격자의 `Enter` 도 새 문서(고를 카드가 없다), 하위 폴더만 있을 때의 `Enter` 는 그대로 카드를 고른다(단추에 `Ctrl+Alt+N` 을 적는다) | ADOPT A5. HIG 온보딩 — 한 번의 안내보다 상황별 안내 |
| EM2 | 읽기 전용으로 가져온 폴더 · 파일 하나만 가져온 곳은 단추 대신 **이유**(🔒 … — 트리에서 오른쪽 클릭 → 읽기 전용 끄기) | 누를 수 없는 단추를 보이지 않는다. 새 문서 창의 막힘(`blockedReadOnly`)과 같은 규칙 |
| EM3 | 파일 트리가 비었으면(문서가 하나도 없는 폴더) **새 문서** · **폴더 가져오기** 단추와 키, "파일 탐색기에서 끌어다 놓아도 됩니다" | 처음 연 빈 폴더에서 할 일 |
| EM4 | 문서가 없는 빈 창의 안내는 **새 문서**(예전 "새 파일" — 새 문서 창 이름과 맞춤)를 맨 위로, 팔레트에 "모든 명령" 설명 | 이미 있던 안내(§24.7 X3)를 ADOPT 순서로 |
| EM5 | 안내의 단추는 `Tab` 순서에 넣지 않는다 — 키보드는 적힌 키로 | 트리 · 격자의 키 흐름을 바꾸지 않는다 |

말투는 앱의 다른 안내와 같은 합니다체("비어 있습니다")로 했다 — ADOPT 의 예문은 해요체였다.

코드: `QuickLook.tsx`(`onNewFile` · 빈 폴더 안내 · `Enter`), `QuickLook.css`, `FileTree.tsx`(빈 트리 · `onNewFile` 전달), `Workbench.tsx`(빈 창 안내), `styles.css`, `shortcuts-table.mjs`(폴더 격자 `Enter`).

### 35.1 확인한 것

`npm test` · `npm run build`. dev `?opfs` + 내장 브라우저(시험용 폴더를 OPFS 에 만들었다가 지웠다): 빈 폴더 → 트리 `Space` → `Tab` → "이 폴더는 비어 있습니다" + **새 문서 Enter** → `Enter` 로 새 문서 창(위치 `빈폴더/`) → `Esc`. 읽기 전용으로 바꾼 `@가져온폴더` 의 하위 폴더만 있는 폴더 → 이유만 보이고 단추 없음. 탭을 모두 닫은 빈 창 → 새 문서 · 파일 트리 · 파일 검색 · 명령 팔레트 · 단축키 도움말(키와 함께). 콘솔 오류 없음.

### 35.2 확인하지 못한 것 (TESTCASES §29)

- 문서가 하나도 없는 실제 폴더를 열었을 때의 트리 안내(OPFS 샘플은 비울 수 없다).

## 36. 막대 단추 = 팔레트 명령 · 툴팁 단축키 (2026-11-23)

UI/UX 개편 A6(`docs/research/apple-uiux/ADOPT.md`). 원칙 확인: 1 맞음(모든 동작이 팔레트에, 단축키를 툴팁에서 발견), 6 맞음(표기를 한 곳에서 만든다), 나머지 상관없음.

**점검 결과**: ADOPT 가 적은 그리드 `＋위` · `＋끝` · `＋왼쪽` 과 보기 모드 4개만이 아니라, **그리드 툴바의 단추는 하나도 팔레트 명령이 없었다** — 그리드가 키를 직접 받아서다. 충돌 배너의 두 단추도 없었다. 창 막대(저장 · 분할 · 목차 · 훑어보기 · JSON 정렬) · 앱 머리 · 트리 막대는 이미 있었다.

| # | 결정 | 근거 |
|---|---|---|
| PC1 | 창 막대 · 그리드 툴바 단추의 명령을 한 표(`lib/paneCommands.ts`)에 둔다 — id · 팔레트 이름(`표: 위에 행 삽입` · `보기: 하이브리드` …) · 툴팁 설명 · 고치는 명령인지. 그리드 15개(되돌리기 · 다시 실행 · 행 5 · 열 3 · 찾기 · 바꾸기 · 계산식 파일 · 머리글 행 만들기 · 끝 개행), 보기 모드 4개 | 팔레트가 Mac 메뉴 막대 역할 — 모든 동작이 있어야 한다. 단추와 명령이 같은 처리(`runPane`)를 부른다 |
| PC2 | 팔레트 명령은 **활성 탭의 창 하나**에만 보낸다(`nav.sendToPane` → 그 탭의 `.pane` 에 이벤트, `usePaneCommands`). 경로로 보내는 `paneAction` 은 같은 문서의 모든 창에 가서, 같은 표를 두 창에 열면 행 넣기가 두 번 된다 | 같은 표를 두 창에 열고 "표: 위에 행 삽입" → 한 번만 들어가는 것을 확인 |
| PC3 | 툴팁은 `설명 (키)` 한 형식 — `cmdTitle(id)` 가 만든다. 키는 단축키 표에서: 그 창이 직접 받는 키는 표의 줄에 **`palette: 'id'`** 를 달아 팔레트 · 툴팁에 보이기만 한다(전역 키로는 쓰지 않는다). 표에 줄이 없는 되돌리기 · 다시 실행만 `paneCommands.ts` 의 `keys` | 손으로 적은 키가 표와 어긋나지 않게. `command` 로 달면 전역 키 처리기가 그 키를 다른 창에서도 가로챈다 |
| PC4 | 고치는 명령은 읽기 전용 문서에서 꺼진다. 보기 모드는 마크다운에서만 | 팔레트에 흐리게 보인다 |
| PC5 | 충돌 배너의 두 선택도 팔레트에 — "충돌: 디스크 내용 받기 (내 수정 버림)" · "충돌: 내 내용으로 덮어쓰기"(충돌 중일 때만) | 배너 단추도 단추다 |
| PC6 | **빠짐 검사 테스트**(`paneCommands.test.ts`): 앱 머리 · 트리 막대 · 창 막대 · 그리드 툴바 구간의 `<button` 은 모두 `data-command="id"` 를 달아야 하고, 그 id 는 등록된 명령이어야 한다. `paneCommands.ts` 의 명령은 모두 단추가 있어야 한다(찾기 단추가 함께 맡는 바꾸기만 빼고) | ADOPT A6 "빠짐을 다시 막는다" |

하지 않은 것: 맥락 메뉴의 단축키 표기(A6 의 3 — K1 에서), 트리 문맥 메뉴의 항목(이름 바꾸기 · 지우기 · 전체 경로 복사)은 트리 커서에 대한 동작이라 키(`F2` · `Delete` · `Shift+F10`)로 닿고 팔레트에는 넣지 않았다(K1 의 맥락 메뉴에서 다시 본다). 찾기 막대(이전 · 다음 · 바꾸기 · 모두 바꾸기)는 막대 안의 키로 닿는다.

코드: `lib/paneCommands.ts` · `.test.ts`, `lib/commands.ts`(`cmdTitle` · `palette` 키), `lib/nav.ts`(`sendToPane`), `components/usePaneCommands.ts`, `GridPane.tsx`(`runPane` · 툴바), `MarkdownPane.tsx`(보기 모드), `Workbench.tsx`(등록), `shortcuts-table.mjs`(`palette`), `App.tsx` · `FileTree.tsx`(`data-command`).

### 36.1 확인한 것

`npm test` — 새 7건(`paneCommands.test.ts`). dev `?opfs` + 내장 브라우저: 같은 `코드.md` 를 두 창에 연 채 팔레트 "보기: 하이브리드" → 활성 창만 바뀜, 같은 `목록.csv` 를 두 창에 연 채 팔레트 "표: 위에 행 삽입" → 이벤트 한 번 · 행 하나(4 → 5), "표: 되돌리기"(`Ctrl+Z` 표시)로 4, 툴바 툴팁 `선택한 행 아래에 빈 행 — 선택한 행 수만큼 (Ctrl+Alt+=)` 등. 콘솔 오류 없음. (처음엔 "11행 들어감" 으로 보였는데, 머리글 위에 행을 넣어 열 이름이 빈 `A1` 뒤에 `5행` 이 붙은 상태 줄 글을 시험 스크립트가 `15행` 으로 읽은 것이었다 — 앱 문제 아님.)

### 36.2 확인하지 못한 것 (TESTCASES §30)

- 팔레트의 계산식 파일 · 머리글 행 만들기 · 끝 개행 · 충돌 명령(코드로만).

## 37. 접근성 설정 존중 · 글자 대비 (2026-11-23)

UI/UX 개편 A7(`docs/research/apple-uiux/ADOPT.md`). 원칙 확인: 6 맞음(Windows 고대비 · 대비 설정, Mac 대비 증가 · 동작 줄이기 모두), 2 맞음(CSS 만 — 비용 없음), 나머지 상관없음.

| # | 결정 | 근거 |
|---|---|---|
| AX1 | 흐린 글자(`--muted`)를 진하게: 라이트 `#6e7781 → #59636e`, 다크 `#8c95a3 → #959eac`. 흐린 글자가 놓이는 모든 바탕(바탕 · 떠 있는 것 · 패널 · hover · 고른 행 · 코드)에서 4.5:1 이상 — 라이트는 4.9~6.1, 다크는 4.9~6.9 | 예전 라이트는 흰 바탕에서만 4.55 이고 패널 4.24 · 고른 행 3.65 로 AA 아래였다. 다크도 고른 행 4.37 |
| AX2 | **대비 검사 테스트**(`contrast.test.ts`): `styles.css` 의 테마 변수를 읽어 본문 · 흐린 글자 × 바탕 8가지, 강조 · 수정됨 · 오류 글자 × 바탕 · 패널을 WCAG 식으로 잰다. 4.5 아래면 실패 | 색을 바꾸다 다시 기준 밑으로 가지 않게 |
| AX3 | `prefers-reduced-motion: reduce` — 모든 전환 · 애니메이션을 끈다(flexlayout 의 전환, 편집기 커서 깜박임은 한 번 뒤 멈춘 채 보인다) | 우리 CSS 에는 움직임이 없고, 들어온 라이브러리의 것이다 |
| AX4 | `prefers-contrast: more` — 흐린 글자 · 테두리를 더 진하게(라이트 `#3d444d` · `#8c959f`, 다크 `#c4cad3` · `#5a6475`), 포커스 외곽선 3px, 활성 셀 외곽선 3px | Windows 대비 설정 · Mac "대비 증가" |
| AX5 | `forced-colors: active`(Windows 고대비 테마) — 바탕색 · 상자 그림자는 시스템 색으로 덮여 사라진다. 그것으로만 보이던 표시를 외곽선 · 시스템 색(`Highlight` · `HighlightText` · `CanvasText`)으로: 트리 · 빈 창 · 미리보기 · 목차의 포커스, 경로 막대 포커스, 팔레트 · 경로 목록 · enum 드롭다운의 고른 항목, 트리 커서 · 현재 문서, 목차 지금 절, 문맥 메뉴 포커스, 폴더 격자 카드, 그리드 범위 · 오류 · 활성 셀(활성 셀이 마지막에 이긴다), 켜진 보기 모드 · 목차 · 훑어보기 단추 | 고대비에서 포커스 · 선택을 잃지 않게. 컴포넌트 CSS 가 뒤에 읽혀 더 구체적인 선택자를 쓰므로 이 묶음은 `:root` 를 앞에 붙여 이긴다 |

코드: `styles.css`(변수 · 끝의 세 `@media`), `lib/contrast.test.ts`.

### 37.1 확인한 것

`npm test` — 새 5건(`contrast.test.ts`, 예전 색이면 라이트 패널 4.24 에서 실패). `npm run build`. dev `?opfs` + 내장 브라우저: 세 `@media` 묶음이 읽힘(규칙 1 · 4 · 9개), 다크 `--muted` `#959eac`, 라이트 `#59636e`(트리 머리 글자의 계산된 색 `rgb(89, 99, 110)`), 라이트 화면. 콘솔 오류 없음.

### 37.2 확인하지 못한 것 (TESTCASES §31)

내장 브라우저는 `prefers-reduced-motion` · `prefers-contrast` · `forced-colors` 를 흉내 내지 못한다 — 세 설정을 실제로 켠 화면은 Jay 가 본다(Windows 고대비 테마 · 대비 설정 · 애니메이션 끄기, Mac 대비 증가 · 동작 줄이기).

## 38. 오른쪽 창에 열기 · 훑어보기 창의 열기 단추 (2026-11-23)

UI/UX 개편 A8(`docs/research/apple-uiux/ADOPT.md`). 원칙 확인: 1 맞음(이미 있는 키를 단추로 드러내고 `Ctrl+Enter` 를 더함), 3 맞음(보던 문서를 옆 창에 바로), 나머지 상관없음.

| # | 결정 | 근거 |
|---|---|---|
| OS1 | **오른쪽 창에 열기**(`Workbench.openFileSide`): 다른 탭 묶음이 있으면 거기에 — 활성 묶음 다음 것(오른쪽) 먼저, 없으면 앞의 것. 그 묶음에 이미 열려 있으면 그 탭을 고른다. 다른 묶음이 없으면 오른쪽에 새로 나눈다. 포커스는 연 창 | VS Code 의 "옆에 열기" 와 같다. 나눌 때마다 묶음이 늘지 않게 |
| OS2 | 키 **`Ctrl+Enter`** — 트리(파일 커서) · 훑어보기 창(트리에 포커스가 있을 때) · 폴더 격자의 문서 카드. 폴더에서는 아무것도 하지 않는다(트리는 그냥 `Enter` 와 같다). 훑어보기 창은 닫힌다 | ADOPT A8 · 단축키 표 "새 단축키 한눈에". tsv-view 셀의 `Ctrl+Enter`(그리드로 열기)와 뜻이 이어진다. 파일 검색의 `Ctrl+Enter` 는 B1 에서 |
| OS3 | 훑어보기 창 머리(파일을 볼 때)에 **열기** · **오른쪽에 열기** 단추. 포커스를 받지 않는다 — 누르면 창이 닫히고 그 문서 창으로 | Quick Look 의 "다음 앱으로 열기" 단추. 키를 모르는 사람도 닿는다 |
| OS4 | 팔레트 **파일 트리 커서의 파일을 오른쪽 창에 열기**(키 표시 `Ctrl+Enter` — 단축키 표의 `palette`, 트리가 키를 직접 받는다) | 새 기능은 팔레트 명령과 함께 |

코드: `Workbench.tsx`(`openFileSide` · 명령 `openTreeCursorSide`), `FileTree.tsx`(`onOpenSide` · `openFrom` · `Ctrl+Enter`), `QuickLook.tsx`(머리 단추 · 격자 `Ctrl+Enter` · `onOpenFile`), `QuickLook.css`, `lib/nav.ts`(`requestTreeOpenSide`), `shortcuts-table.mjs`.

### 38.1 확인한 것

`npm test` · `npm run build`. dev `?opfs` + 내장 브라우저(`Ctrl+Enter` 는 이벤트로도): 문서 하나만 연 채 `목록.csv` 를 훑어보기 → 머리의 **오른쪽에 열기** → 오른쪽에 새 묶음, 그리드에 포커스, 창 닫힘. 트리 커서 `표.tsv` 에서 `Ctrl+Enter` → 새로 나누지 않고 다른 묶음에. `docs` 폴더 격자의 `개요.md` 카드에서 `Ctrl+Enter` → 다른 묶음에, 편집기에 포커스. 팔레트 명령(`Ctrl+Enter` 표시) → 다른 묶음에. 폴더를 볼 때는 열기 단추가 없다. 콘솔 오류 없음.

### 38.2 확인하지 못한 것 (TESTCASES §32)

- 설치한 Edge 앱에서 트리의 `Ctrl+Enter`(브라우저가 가로채지 않는지).
- 묶음이 셋 이상일 때의 고르는 차례.

## 39. Mermaid 확대 · 이동 · 맞춤 (2026-11-23)

UI/UX 개편 A9(`docs/research/apple-uiux/ADOPT.md`). 원칙 확인: 5 맞음(흐름도 · 구조도가 결론 문서의 재료), 1 맞음(키로 다 된다), 2 맞음(라이브러리 없이 `transform` — 그리기 비용 그대로), 나머지 상관없음.

| # | 결정 | 근거 |
|---|---|---|
| MZ1 | 그린 다이어그램(`Mermaid` → `MermaidView`, `PreviewPane.tsx`)에 확대 · 축소 · 끌어 옮기기 · 맞춤. 미리보기 · 하이브리드 위젯 · tsv-view 의 mermaid 가 같은 컴포넌트를 쓴다 | 한 곳에서 |
| MZ2 | 상태는 `translate(x, y) scale(s)` 하나, 계산은 `lib/md/diagramZoom.ts`(순수 함수). 배율 0.25 ~ 8, 한 번에 1.25 배. **맞춤** = s 1 · 자리 0 — 상자 너비에 맞춘 원래 크기. 1 로 돌아오면 자리도 맞춤으로 | ADOPT A9 "라이브러리 없이" |
| MZ3 | 상자 높이는 맞춤일 때 그대로 — 확대하면 그 틀 안에서 본다 | 문서가 아래로 밀리지 않는다. 작은 다이어그램은 틀이 낮아 크게 확대하면 조금만 보인다(옮겨 본다) |
| MZ4 | 키(상자에 포커스가 있을 때): `Ctrl+=` · `Ctrl+-` 확대 · 축소(가운데 기준), 방향키 옮기기(Shift 4배), `Home` 맞춤, `Esc` 편집기(하이브리드) · 미리보기로. `Ctrl+휠` 은 포커스가 있을 때만 가로챈다(포인터 자리 기준) — 아니면 브라우저 페이지 확대 그대로. 확대한 동안 끌어 옮긴다(맞춤에서는 끌지 않는다) | ADOPT A9. 훑어보기 창과 같은 확대 키. `Ctrl+0` 은 브라우저 키라 쓰지 않고 `Home` |
| MZ5 | 상자는 미리보기에서 `Tab` 으로, 하이브리드에서 클릭으로 포커스를 받는다(하이브리드 위젯은 편집기가 이벤트를 무시한다 — 위젯 안의 방향키가 커서를 옮기지 않는다) | 키보드로 닿게 |
| MZ6 | 오른쪽 위 `− 100% ＋`(가운데는 맞춤) — 마우스를 올리거나 포커스 · 확대 중일 때만 보인다. 포커스를 받지 않는다. 썸네일 · 훑어보기 창 · 훑어보기 패널(inert)에서는 숨는다 | 읽기만 하는 곳에 단추를 그리지 않는다 |
| MZ7 | 다이어그램 글을 고치면 맞춤으로(MZ8 의 열쇠가 달라진다). 테마만 바뀌면 그대로 | 새 그림에 옛 자리를 쓰지 않는다 |
| MZ8 | **확대 상태를 기억한다**(Jay 요청, 2026-11-23) — 이 브라우저의 localStorage(`jaydocs.diagramZoom`)에, 열쇠는 **문서 경로 + 다이어그램 글의 지문**. 문서를 닫았다 열어도 그대로. 자리는 상자 너비 · 높이에 대한 비율로 남겨, 창 너비가 바뀌거나 미리보기 ↔ 하이브리드처럼 상자가 달라도 같은 곳이 보인다. 맞춤(`Home` · 가운데 숫자)이면 지운다. 최근 300개만. 끌거나 키를 누르는 동안은 쓰지 않고 멈춘 뒤 0.3초에. 썸네일 · 훑어보기(inert)는 기억을 읽지 않고 늘 맞춤 | 원칙 7 — 파일(`.md`)에는 쓰지 않는다(파일 안에 숨긴 메타데이터 금지). 화면 상태는 앱에 남겨도 된다(열 너비 · 보기 모드와 같다). 다른 브라우저 · PC 에서는 처음 상태, 파일 이름을 바꾸면 잊는다. 같은 문서를 두 창에 열면 같은 기억을 쓴다 |

팔레트 명령은 두지 않았다 — 포커스한 다이어그램에만 뜻이 있는 동작이고(팔레트를 열면 포커스가 빠진다), 훑어보기 창의 확대와 같이 그 자리의 키 · 단추로 닿는다. 단축키 표 · F1 에 적었다.

코드: `lib/md/diagramZoom.ts`(계산 · 기억하기) · `.test.ts`, `PreviewPane.tsx`(`MermaidView` · `Mermaid` 의 `docPath`), `hybrid.ts`(위젯에 문서 경로), `styles.css`(`.mermaid-*`), `shortcuts-table.mjs`.

### 39.1 확인한 것

`npm test` — 새 9건(`diagramZoom.test.ts`: 가운데 기준 확대 · 되돌아오면 맞춤 · 한계 · 옮기기 · 키 · 기억하기 4건 — 열쇠 · 비율 · 남기고 지우기 · 최근 300개와 깨진 값). 기억하기(MZ8): 미리보기에서 156% 로 옮긴 뒤 문서를 닫고 다시 열면 같은 배율 · 자리, 하이브리드(상자 410px)로 바꾸면 같은 비율의 자리, `Home` 이면 기억이 지워져 미리보기도 맞춤. dev `?opfs` + 내장 브라우저(키 · 휠은 이벤트로): 미리보기 `Tab` → 다이어그램 포커스 → `Ctrl+=` 두 번(156%) → `→` 옮김 → `Ctrl+휠` 확대(페이지 확대 막힘) → `Home` 맞춤 → `Esc` 미리보기로. 포커스가 없을 때 `Ctrl+휠` 은 가로채지 않음. `＋` 단추 두 번 → 끌어 옮김. 하이브리드: 클릭 → `Ctrl+=` · `↓` 는 다이어그램만(문서 `저장됨` 그대로) → `Esc` 편집기로. 콘솔 오류 없음.

### 39.2 확인하지 못한 것 (TESTCASES §33)

- 실제 마우스 휠 · 트랙패드 핀치(트랙패드 핀치는 `Ctrl+휠` 로 온다 — 포커스가 있을 때만 다이어그램 확대).
- 큰 다이어그램(노드 수십 개)에서 끌기의 부드러움, 설치한 Edge 앱.

## 40. 맥락 메뉴 (Alt+Enter) (2026-11-26)

UI/UX 개편 K1(`docs/research/apple-uiux/ADOPT.md`), 단축키 규칙 3(`PRINCIPLES.md`). 원칙 확인: 1 맞음(마우스 없이 자리의 동작, 메뉴가 단축키를 가르친다 — 항목은 모두 팔레트에도 있다), 2 맞음(목록은 열 때만 계산, 새 라이브러리 없음 — 팔레트 틀 재사용), 3 맞음(그 창의 커서 · 선택에만 돈다. 다른 창의 상태는 그대로), 6 맞음(`Alt+Enter` 는 Mac 에서 Option+Return, 오른쪽 클릭은 Ctrl+클릭도 같다), 4 · 5 · 7 상관없음(파일 바이트를 건드리지 않는다).

| # | 결정 | 근거 |
|---|---|---|
| CM1 | **자리 판단 함수**는 `src/lib/contextMenu.ts` — 자리(spot) → 그 자리에서 쓸 수 있는 명령 id 목록. 영역마다 하나: `gridContextIds` · `treeContextIds` · `markdownContextIds` · `tabContextIds` · `appContextIds`, 묶어서 `contextIds(spot)`. 순수 함수 | K7 단축키 안내 창이 같은 함수를 쓴다(아래). 테스트할 수 있게 |
| CM2 | **자리 읽기**: 영역의 컴포넌트가 제 바깥 요소에 `registerSpotReader(el, fn)` 를 걸고, `spotAt(요소, 클릭 자리?)` 가 요소에서 위로 올라가며 처음 만난 영역의 자리를 돌려준다(읽기 함수가 null 이면 더 위로, 아무 데도 아니면 `app`). 그리드 = `GridPane`(고른 범위 · 편집 중 · 읽기 전용 · 빈 표 · 열 전체), 트리 = `FileTree`(커서 항목 · 가져온 폴더 · 읽기 전용), 마크다운 = `MarkdownPane` + `mdContext.ts`(커서 구문의 표 · 링크 · tsv-view · mermaid, 미리보기에서 포커스한 링크 · tsv-view), 탭 = `Workbench`(탭 제목) | 자리를 아는 것은 그 컴포넌트다. 앱(메뉴)은 영역을 몰라도 된다 |
| CM3 | **메뉴 전용 동작은 없다.** 항목은 등록부(`lib/commands.ts`)의 명령 중 지금 등록되어 있고 `enabled()` 인 것만(`availableContextCommands`), 순서는 자리 판단 함수의 순서. 이름 · 키는 팔레트와 같다(키는 단축키 표 — 창이 직접 받는 키는 `palette:` 로). 메뉴에 넣으려고 새로 만든 팔레트 명령: 트리 `treeRename` · `treeDelete` · `treeCopyPath`, `copyRootPath`, `editRoot:별칭`, `closeOtherTabs`, `openLinkAtCursor` · `openLinkAtCursorSide` · `openTsvViewGrid`, 그리드 `gridFillDown` · `gridFillRight`(막대 단추 없음 — `paneCommands.ts` 의 `noButton`), 메뉴 자체 `contextMenu` | ADOPT K1 "메뉴의 모든 항목은 팔레트에도 있다". `contextMenu.test.ts` 가 자리 판단 함수의 id 가 모두 소스에 등록된 명령인지 검사한다 |
| CM4 | 메뉴 틀은 팔레트(`Palette.tsx`)에 `anchor` 를 준 것 — 자리 옆에 작게(어둡게 덮지 않는다), 받은 순서 그대로(거를 때는 점수 → 순서), 항목 옆 `<kbd>` 단축키, 화면 밖으로 나가지 않게(아래가 모자라면 위로). 거르기는 `match.ts` 그대로 | 거르기 · ↑↓ · Enter · Esc 를 한 번만 만든다 |
| CM5 | 여는 길: `Alt+Enter` · `Shift+F10`(단축키 표의 전역 명령 `contextMenu`), 키보드의 메뉴 키, 오른쪽 클릭(앱의 `contextmenu` 처리). 키보드로 열면 커서(편집기 `coordsAtPos`) · 활성 셀(입력 칸) · 트리 항목 · 탭 제목 아래에, 오른쪽 클릭이면 누른 자리에. 메뉴가 떠 있을 때 `Alt+Enter` · `Shift+F10` · 메뉴 키는 닫는다. 팔레트에서 "맥락 메뉴" 를 고르면 팔레트를 열기 전의 자리 메뉴 | 단축키 규칙 3 |
| CM6 | 브라우저 메뉴를 남기는 곳: **Shift+오른쪽 클릭**, 입력 칸(찾기 막대 · 대화상자 · 팔레트 — 그리드 · tsv-view 의 셀 입력은 빼고), 작업대 밖(위 막대). 키보드로 연 뒤 0.4초 안에 브라우저가 이어서 내는 `contextmenu` 는 삼킨다 | 편집기에서 오른쪽 클릭이 브라우저의 붙여넣기 · 맞춤법 메뉴를 잃는다 — Shift 로 닿게 남긴다(되돌릴 수 있는 결정) |
| CM7 | 오른쪽 클릭은 자리를 먼저 옮긴다: 트리 = 누른 항목으로 커서 · 고른 폴더(빈 자리면 주 폴더 루트), 그리드 = 고른 범위 밖을 누르면 그 셀 · 행 · 열을 고른다(Excel 과 같다, `Grid.tsx` 의 오른쪽 `mousedown`), 편집기 = 고른 범위 밖이면 그 자리로 커서(하이브리드의 표 · 다이어그램 · tsv-view 위젯 위는 그대로), 탭 = 그 탭을 활성으로 | 메뉴의 명령은 "지금 자리"(커서 · 활성 탭)에 돈다 |
| CM8 | 포커스: `Esc` · 바깥 클릭 → 연 자리로. 항목 실행 → **연 자리로 먼저 돌린 뒤** 명령을 돌린다 — 명령이 지금 자리를 읽고, 명령이 띄운 대화상자는 닫히면 그 자리로 돌아간다. 연 자리가 없어졌으면 문서 창으로 | 포커스 예측(원칙 1). 팔레트의 `pickCommand` 와 같은 뒷처리 |
| CM9 | `Alt+Enter` 를 Enter 로 먹던 곳은 Alt 가 붙으면 넘긴다: 트리 · 그리드(편집 중 아님) · 목차 · 경로 막대 · 미리보기 tsv-view 셀 · 팔레트. **그리드 셀 편집 중은 그대로**(CSV 칸 안 줄바꿈, TSV 는 Enter 와 같은 확정) — 메뉴가 뜨지 않는다(`gridContextIds` 도 편집 중이면 빈 목록). 하이브리드 표 칸 편집 중의 `Alt+Enter` 는 지금처럼 칸 이동(Enter 와 같다) — ADOPT 대로 그 기능이 자리 잡은 뒤 맞춘다. 훑어보기 창의 폴더 격자도 Enter 그대로 | Excel 관행(편집 중 Alt+Enter = 줄바꿈) |
| CM10 | 항목 순서: **자리의 명령 → 문서 명령 → 문서 어디서나**(저장 · 마지막 저장 상태로 되돌리기 · 오른쪽에 분할 · 경로 복사 · UTF-8 로 바꿔 저장). 그리드는 열 전체를 골랐으면 열 명령이 먼저, 빈 표는 "타입 행 · 머리글 만들기" 가 맨 위. 마크다운은 지금 보기 모드를 빼고 나머지 셋, 하이브리드면 목차. 읽기 전용이면 고치는 명령을 뺀다(등록부의 `enabled()` 도 끄지만, K7 처럼 등록부 없이 볼 때를 위해 함수에서도) | 자주 쓰는 것이 위 |
| CM11 | **트리의 예전 `Shift+F10` 메뉴(`.ctx-menu`)를 이 메뉴로 합쳤다.** 항목은 전부 남았고(훑어보기 · 새 파일 · 새 폴더 · 이름 바꾸기 · 전체 경로 복사 · 상세 경로 편집 · 삭제 · 읽기 전용 · 새로 고침 · 해제), 더한 것: 오른쪽 창에 열기(파일), 폴더 훑어보기, 폴더의 이름 바꾸기(`F2` 와 같게), 파일에서도 그 폴더에 새 파일 · 새 폴더, 루트의 폴더 가져오기. 항목 이름이 팔레트 이름이라 전보다 길다 | 한 메뉴 · 한 키 |
| CM12 | 링크 · tsv-view 의 "지금" 은 미리보기의 링크 · tsv-view 에 포커스가 있으면 그것(`data-doc-link` · `data-tsv-file`, `PreviewPane.tsx`), 아니면 포커스가 든(없으면 마지막) 마크다운 편집기의 커서 구문. 문서 링크만(바깥 주소 · `#제목` 은 빼고) | 팔레트에서 불러도 같은 대상 |

빠진 것(ADOPT K1 초안 중): **Mermaid**(크게 보기 · 맞춤) — 팔레트 명령이 없다(§39: 포커스한 다이어그램의 키 · 단추로만). 넣으려면 "마지막으로 포커스한 다이어그램" 에 도는 팔레트 명령이 먼저 있어야 한다. 아직 없는 기능 — 표 정렬 · 거르기 · 열 숨기기 · 폭 맞춤(E1), 제목 접기 · 절 옮기기 · 단계(C1 · C2), 다른 인코딩으로 다시 열기 · 보이지 않는 문자(C4), 탭 유지 · 아래로 분할(D2 · D4), 고정(B4) — 은 그 기능이 들어올 때 자리 판단 함수에 id 를 더한다. 훑어보기 창 · 폴더 격자(본문 끝에 붙는 창)는 영역 자리가 없어 `app` 자리(새 문서 · 파일 검색 · 팔레트 …)가 뜬다.

**K7 단축키 안내 창에서 쓰는 법**: `spotAt(document.activeElement)` 로 자리를 읽고 `spot.zone` · `contextIds(spot)`(또는 `availableContextCommands(spot)`)로 그 자리의 명령 · 키를 고른다. 자리 읽기의 `point` 는 넘기지 않는다(넘기면 커서 · 선택을 옮긴다).

코드: `lib/contextMenu.ts`(자리 · 판단 함수 · 자리 읽기) · `.test.ts`, `components/mdContext.ts`(마크다운 자리 · 링크 · tsv-view), `App.tsx`(메뉴 열기 · 닫기 · 오른쪽 클릭 · 메뉴 키, `contextMenu` · `copyRootPath` · `editRoot:별칭`), `Palette.tsx`(`anchor`), `FileTree.tsx`(예전 메뉴 삭제, 자리 읽기, 커서 명령), `grid/GridPane.tsx` · `grid/Grid.tsx`(자리 읽기, 채우기 명령, 오른쪽 클릭 선택, `Alt+Enter` 넘김), `MarkdownPane.tsx`, `Workbench.tsx`(탭 자리, `closeOtherTabs` · 링크 · tsv-view 명령), `PreviewPane.tsx`(`data-doc-link` · `data-tsv-file`), `tableCommands.ts`(`lastMdView`), `lib/commands.ts`(`getCommand`), `lib/paneCommands.ts`(`noButton`), `shortcuts-table.mjs`, `styles.css`(`.is-menu`, `.ctx-menu` 삭제).

### 40.1 확인한 것

`npm test` — 새 11건(`contextMenu.test.ts`: 자리 판단 함수의 id 가 모두 등록된 명령 · 한 자리에 같은 명령이 두 번 나오지 않음 · 그리드 편집 중 빈 목록 · 열 전체면 열 명령 먼저 · 빈 표 · 읽기 전용 · 트리(파일 · 가져온 폴더 루트 · 주 폴더 루트 · 읽기 전용 · 파일 하나 가져온 곳) · 마크다운 순서 · 탭 · 키 표기 · 자리 읽기), `paneCommands.test.ts` 는 단추 없는 명령을 빼고 그대로 통과. `npm run build`, `npm run lint`(새 경고 없음). dev `?opfs`(5181) + 내장 브라우저(키 · 오른쪽 클릭은 이벤트로): 트리 `Alt+Enter`(커서 폴더 · 파일) · 오른쪽 클릭(누른 항목으로 커서, 트리 빈 자리 = 루트 메뉴, `@가져온폴더` 루트 = 상세 경로 · 읽기 전용 · 해제) → 글자로 거르기 → `Esc` 로 트리에 포커스 → "오른쪽 창에 열기" 실행. 편집기: 커서가 링크 위 → "커서의 링크 열기" 로 그 문서가 열림, 표 안 → "마크다운 표: 아래에 행 넣기" 로 행이 늘어남, tsv-view 펜스 안 → 그리드로 열림(포커스 그리드), `Shift+F10` 도 같은 메뉴. 분할 모드 미리보기의 링크에 포커스 → 링크 항목. 그리드: `Alt+Enter`(행 명령 먼저) · `Ctrl+Space` 뒤(열 명령 먼저, 제목 `A열`) · `F2` 편집 중 `Alt+Enter` 는 메뉴 없이 확정 · 셀 오른쪽 클릭이 그 셀을 고르고 연다. 탭 제목 오른쪽 클릭 → 그 탭이 활성 → "다른 탭 닫기". 팔레트 "맥락 메뉴" → 팔레트를 열기 전 자리(트리)의 메뉴. 콘솔 오류 없음.

### 40.2 확인하지 못한 것 (TESTCASES §34)

- 실제 키보드의 `Alt+Enter` · `Shift+F10` · 메뉴 키, 실제 오른쪽 클릭(특히 메뉴 키 뒤 브라우저 `contextmenu` 를 삼키는지, Windows 에서 `contextmenu` 가 mouseup 에 오는 때의 선택 이동), Mac 의 Option+Return · Ctrl+클릭.
- 실제 한글 IME 조합 중의 `Alt+Enter`, 설치한 Edge 앱, 실제 폴더.
- 자동화 창은 `document.hasFocus()` 가 false 라 편집기의 `focusin` 이 오지 않는다 — 표 명령 확인은 `focusin` 을 직접 보냈다(링크 · tsv-view 는 포커스한 편집기를 직접 찾게 해 없이도 된다).

## 41. 행 · 열 넣기 · 지우기를 선택에 따라 (2026-11-26)

UI/UX 개편 K2(`docs/research/apple-uiux/ADOPT.md`). 원칙 확인: 1 맞음(단축키 규칙 1 — 네 키 `Ctrl+Alt+Shift+= / -` 를 없앰, 규칙 4 — 그리드 · 마크다운 표가 같은 키), 7 맞음(편집 동작은 그대로, 키만 바뀜), 나머지 상관없음.

| # | 결정 | 근거 |
|---|---|---|
| RC1 | 그리드의 `Ctrl+Alt+=` · `Ctrl+Alt+-` 하나로 — **열 전체를 고른 상태**면 열을 오른쪽에 넣고 · 지우고, 아니면 행을 아래에 넣고 · 지운다. 고른 열 · 행 수만큼 | Excel 도 열 전체를 고르고 삽입하면 열이 들어간다 |
| RC2 | "열 전체를 고른 상태" 는 **`Ctrl+Space` · 열 글자 클릭(Shift 로 넓히기 포함)으로 고른 범위가 그대로일 때**만(`Grid.tsx` 의 `colPick`). 범위만 보고(첫 행 ~ 끝 행) 판단하지 않는다. `Ctrl+A`(전체)는 행 | 행이 한두 개인 표에서 셀 몇 개를 고른 것이 열 선택으로 잡히지 않게 |
| RC3 | 열을 넣으면 **넣은 열이 골라진 채**, 지우면 **그 자리의 열이 골라진 채**(끝 열을 지웠으면 새 끝 열) 남는다 | Excel 과 같다. 한 번 더 누르면 계속 열이 들어가고 · 지워진다 — 앞 동작 뒤에 선택이 풀려 갑자기 행이 지워지지 않게 |
| RC4 | `Ctrl+Alt+Shift+=` · `Ctrl+Alt+Shift+-` 를 그리드와 마크다운 표(DESIGN §23 H9, `lib/md/tableEdit.ts` 의 `TABLE_OP_KEYS`) 양쪽에서 **없앤다** — 눌러도 아무것도 하지 않는다 | 단축키 규칙 1(키는 셋까지) |
| RC5 | 마크다운 표에는 열 선택이 없으니 열 넣기 · 지우기는 **키 없이** 팔레트 "마크다운 표: 오른쪽에 열 넣기" · "마크다운 표: 열 지우기" 로(맥락 메뉴는 K1). 행 키(`Ctrl+Alt+= / -`)는 그대로 | ADOPT K2 |
| RC6 | 팔레트 명령(`gridColRight` · `gridColDel` 등)은 그대로. 키 표시만 `열 전체 선택 + Ctrl+Alt+=` · `열 전체 선택 + Ctrl+Alt+-` 로(단축키 표의 `palette`) | 명령 id 를 바꾸면 맥락 메뉴(K1)와 겹친다 |

코드: `Grid.tsx`(`colPick` · `isWholeCols` · 키 분기), `GridPane.tsx`(`colOp` 가 바꿨는지 돌려준다), `lib/md/tableEdit.ts`(`TABLE_OP_KEYS`), `Workbench.tsx`(`MD_TABLE_COMMANDS` 의 열 키 표시 없앰), `hybrid.ts`(＋ 열 툴팁), `shortcuts-table.mjs`.

### 41.1 확인한 것

`npm test` · `npm run build`. dev `?opfs` + 내장 브라우저(키는 이벤트로), `docs/표.tsv`: 열 글자 B 클릭 → `Ctrl+Alt+=` 두 번 → 열이 C · D 에 들어가고 넣은 열이 골라짐 → `Ctrl+Alt+-` 두 번 → 3열로, 그 자리의 열이 골라짐. `Ctrl+Alt+Shift+=` 는 아무것도 하지 않음. `↓` 로 셀 하나를 고른 뒤 `Ctrl+Alt+=` · `-` 는 행. 되돌리기로 샘플 원래대로.

### 41.2 확인하지 못한 것 (TESTCASES §35)

- 마크다운 표에서 `Ctrl+Alt+Shift+= / -` 가 아무것도 하지 않는지 — 화면으로는 보지 않았다(키 표에서 뺀 것만 코드로).
- Mac(⌘⌥=)과 설치한 Edge 앱.

## 42. 행 옮기기 · 복제 키를 마크다운과 맞추기 (2026-11-26)

UI/UX 개편 K5(`docs/research/apple-uiux/ADOPT.md`). 원칙 확인: 1 맞음(키 · 팔레트 · 막대 단추가 같이 들어감, 단축키 규칙 4 — 마크다운의 줄 옮기기 · 복제와 같은 키), 5 맞음(표의 순서를 정리하는 구조 잡기), 6 맞음(`Alt+↑ / ↓` 는 Chrome · Edge 가 가로채지 않는다, Mac 은 Option), 7 맞음(행 객체를 그대로 옮겨 원문이 남는다 — 아래 RM2), 2 · 3 · 4 상관없음.

| # | 결정 | 근거 |
|---|---|---|
| RM1 | 그리드에서 `Alt+↑ / Alt+↓` = 고른 행(들)을 한 칸 위 / 아래로(**새 기능**). 선택(열 범위 포함)이 행을 따라간다. 셀 편집 중에는 받지 않는다(칸 안 커서) | 마크다운의 줄 옮기기 · 목차의 절 옮기기와 같은 키 |
| RM2 | 옮기기는 **행 객체를 그대로** 자리만 바꾼다(`lib/tsv/edits.ts` 의 `moveRows`) — `raw` 가 남아 저장하면 그 줄의 바이트가 그대로다. 행 하나를 옮기면 diff 에는 **그 행과 자리를 바꾼 이웃 한 행만**, 여러 행이면 고른 행과 이웃 한 행. CSV 의 따옴표 · 칸 안 줄바꿈도 원문 그대로. 끝 개행이 없는 파일에서 마지막 행이 바뀌어도 그 두 줄뿐 | 포맷 계약(§2) · 원칙 7. 테스트 `rowMove.test.ts`(바이트 왕복 · diff 범위 · CRLF · BOM · CSV) |
| RM3 | 동작 하나가 `edit` 한 번 = 되돌리기 한 번 | 되돌리기 한 번에 한 동작 |
| RM4 | 머리글 · 타입 행(`schema.headerRows`)은 옮기지 않고(고르면 알림), 본문 첫 행은 그 위로 올라가지 않는다(조용히). 표 끝에서도 조용히 | VS Code 처럼 끝에서는 아무 일도 없다 |
| RM5 | **`_Field` 시트**는 빈 줄로 나눈 블록의 **항목만, 그 블록 안에서** 옮긴다. 블록 이름 줄(블록 첫 행) · 빈 줄은 옮기지 않고(고르면 알림), 항목이 블록 이름 줄 · 빈 줄을 넘지 않는다(조용히). 블록 순서를 바꾸는 것은 하지 않는다 | 블록 이름 줄을 옮기면 블록 경계가 바뀌어 다른 블록의 항목이 딸려 간다(`parseFieldBlocks` 가 빈 줄 · 첫 행으로 읽는다). 항목을 다른 블록으로 보내려면 잘라내 붙이기 |
| RM6 | `Shift+Alt+↓` = 행 복제 — 고른 행 아래에 붙이고 **복제본을 고른다**. `Shift+Alt+↑` = 복제하고 선택은 그대로(위쪽 원본 자리). 복제본은 새 줄이고 원본 행은 그대로 | 마크다운(CodeMirror)의 줄 복제 · 위로 복제와 같다 |
| RM7 | `Ctrl+Shift+D`(행 복제)를 **없앤다**. 그리드에서 누르면 아무것도 고치지 않고 "행 복제는 Shift+Alt+↓ 로 바뀌었습니다" 를 알린다 | 흘려보내면 Chrome 의 "모든 탭을 북마크에 추가" 가 뜬다. 손에 익은 키를 새 키로 이끈다 |
| RM8 | 팔레트 "표: 행 위로 옮기기" · "표: 행 아래로 옮기기"(`gridRowUp` · `gridRowDown`), 그리드 막대의 행 무리에 ↑ · ↓ 단추(`data-command`). "표: 행 복제" 의 키 표시는 `Shift+Alt+↓` | 새 기능은 팔레트 명령과 함께. 막대 단추 = 팔레트 명령(§36) |

K2 의 열 키 표시는 `열 전체 선택 + Ctrl+Alt+= / -` 로 고쳤다(툴팁의 괄호가 겹쳐서).

코드: `lib/tsv/edits.ts`(`moveRows` · `canMoveRows`) · `rowMove.test.ts`, `Grid.tsx`(키 · `shiftRows`), `GridPane.tsx`(`rowOp` 의 `moveUp` · `moveDown` · `dupKeep`, 막대 단추), `lib/paneCommands.ts`, `shortcuts-table.mjs`.

### 42.1 확인한 것

`npm test` — 새 14건(`rowMove.test.ts`). dev `?opfs` + 내장 브라우저(키는 이벤트로): `docs/표.tsv` 의 `나` 에서 `Alt+↑` → `가` 와 자리 바꿈 · 선택이 따라감 → 한 번 더는 머리글 아래라 그대로 → `Alt+↓` 로 돌아옴 → `Shift+Alt+↓` 복제(복제본 고름) → `Shift+Alt+↑` 복제(선택 그대로) → `Ctrl+Shift+D` 는 알림만 → `Ctrl+Z` 네 번이 한 동작씩 되돌려 원래대로(수정됨 표시 없음). `data/Item/Item_Field.tsv`: 블록 첫 항목 `Key` 의 `Alt+↑` · 끝 항목 `Upkeep` 의 `Alt+↓` · 다음 블록 첫 항목 `Weapon` 의 `Alt+↑` 는 그대로, 블록 이름 줄 `Category` 는 알림, `Armor` 의 `Alt+↑` 는 블록 안에서 옮겨짐 → 되돌림. 막대 단추 툴팁에 키.

### 42.2 확인하지 못한 것 (TESTCASES §36)

- 실제 폴더에 저장한 뒤의 `git diff`(테스트로는 두 줄만).
- Mac 의 Option+↑ / ↓, 설치한 Edge 앱.

## 43. 새 폴더는 새 문서 창에서 (2026-11-26)

UI/UX 개편 K3(`docs/research/apple-uiux/ADOPT.md`). 원칙 확인: 1 맞음(단축키 규칙 1 — 네 키 `Ctrl+Alt+Shift+N` 을 없앤다, 규칙 2 — 새 폴더는 새 문서보다 드물다), 2 맞음(창 하나에서 이름만 치면 된다), 7 맞음(빈 폴더 하나를 만들 뿐), 나머지 상관없음.

| # | 결정 | 근거 |
|---|---|---|
| NF1 | 새 문서 창(`Ctrl+Alt+N`)의 이름이 `/` (또는 `\`)로 끝나면 문서 대신 **폴더**를 만든다. 칸 오른쪽 표시가 확장자 대신 `📁 폴더`, 단추가 **폴더 만들기** 가 된다. 창 안내 문구에 "끝에 `/` 를 치면(`자료/`) 폴더를 만듭니다" | 이미 있는 "이름 끝 `.txt` 면 그 형식" 과 같은 문법. 경로를 `/` 로 끝내는 것은 폴더라는 뜻이 이미 널리 쓰인다(VS Code 새 파일 입력 · 셸) |
| NF2 | 검사는 트리의 새 폴더와 같다(`checkEntryPath` kind `dir` — 이미 있는 이름 · 빈 이름 · 절대 경로 · 못 쓰는 글자). 읽기 전용으로 가져온 폴더 · 파일 하나만 가져온 곳은 새 문서와 같은 문구로 막는다 — 창을 열 때(트리에서 고른 폴더)는 알림 줄에, 창 안에서 그런 곳의 경로를 친 경우는 칸 아래에 | 새 문서와 같은 규칙. 창을 연 뒤 다른 `@별칭` 을 쳐도 백엔드가 거부하기 전에 이유를 보인다 |
| NF3 | 만들면 창을 닫고 트리를 새로 읽고 알림 줄에 "폴더를 만들었습니다: …". 포커스는 창을 열기 전 자리로(열 문서가 없다) | 새 폴더 대화상자와 같다 |
| NF4 | **`Ctrl+Alt+Shift+N` 을 없앴다.** 트리의 ＋폴더 · 오른쪽 클릭 · 팔레트 "새 폴더"(`newFolder`)는 그대로 | ADOPT K3 |

코드: `lib/templates.ts`(`newFolderPath`) · `.test.ts`, `NewDocDialog.tsx`(`onCreateFolder` · 칸 표시 · 단추 · 안내), `App.tsx`(`createFolderFromDialog` · `readOnlyProblem`), `shortcuts-table.mjs`, `docs/guide/getting-started.md`.

### 43.1 확인한 것

`npm test`(새 1건 — `newFolderPath`) · `npm run build` · `npm run lint`(새 경고 없음). dev `?opfs` + 내장 브라우저(키는 이벤트로): `Ctrl+Alt+N` → `docs/시험폴더K3/` → 칸 표시 `📁 폴더` · 단추 `폴더 만들기` → `Enter` → 창 닫힘, 트리에 폴더, 알림, 포커스 트리. 같은 이름 다시 → "이미 있는 이름", `/` 만 → "이름을 입력하세요", `a:b/` → 절대 경로 거부. `@가져온폴더` 를 읽기 전용으로 켜고 `@가져온폴더/시험K3/` → 칸 아래에 읽기 전용 문구. `Ctrl+Alt+Shift+N` → 아무것도 열리지 않음. 시험한 폴더는 지웠다.

### 43.2 확인하지 못한 것 (TESTCASES §37)

- 실제 폴더(디스크)에서 만들기 · 한글 조합 중 `/` 입력.

## 44. 가져오기를 하나로 (2026-11-26)

UI/UX 개편 K4(`docs/research/apple-uiux/ADOPT.md`). 원칙 확인: 1 맞음(단축키 규칙 4 — 같은 "가져오기" 는 같은 키, 규칙 6 — Mac 의 ⌘⌥I 가 Chrome 개발자 도구와 겹치던 문제가 없어진다), 4 맞음(흩어진 곳을 끌어오는 길이 하나), 나머지 상관없음.

| # | 결정 | 근거 |
|---|---|---|
| IM1 | `Ctrl+Shift+O`(`importFolder`)가 가져오기 창을 연다 — 창 안의 **폴더 고르기…** · **파일 고르기…** 중 고른다(처음 포커스는 폴더 고르기). 끌어다 놓기는 그대로 | ADOPT K4. 창은 이미 두 단추를 갖고 있었다 |
| IM2 | **`Ctrl+Alt+I`(`importFile`)의 키를 없앴다.** 팔레트 "파일 가져오기…" 는 **남긴다** — 같은 창을 **파일 고르기…** 에 포커스를 두고 연다 | 키는 하나로 줄이되, 팔레트에서 "파일" 로 찾는 사람이 닿는 길은 둔다(규칙 2 — 키 없는 동작은 팔레트로). 창이 하나라 동작이 갈라지지 않는다. 선택 창을 바로 띄우지 않는 것은 그대로(읽기 전용을 먼저 고를 수 있게) |
| IM3 | 이름을 "가져오기" 로 맞췄다 — 팔레트 `가져오기… (폴더 · 파일)`, 맨 위 📂 단추 툴팁, 빈 트리 안내의 단추 | 창이 폴더 · 파일 둘 다 받는다 |

코드: `App.tsx`(명령 이름 · 툴팁 · 창이 떠 있을 때 `importFile` 키로 닫던 예외 삭제), `ImportDialog.tsx`(주석), `FileTree.tsx`(빈 트리 단추), `shortcuts-table.mjs`, `docs/guide/workspace.md`.

### 44.1 확인한 것

dev `?opfs` + 내장 브라우저(키는 이벤트로): `Ctrl+Shift+O` → 가져오기 창, 포커스 **폴더 고르기…** → 다시 `Ctrl+Shift+O` 로 닫힘. 팔레트 명령 `importFile` → 같은 창, 포커스 **파일 고르기…**. `Ctrl+Alt+I` → 아무것도 열리지 않음. 팔레트에 `가져오기… (폴더 · 파일)` 옆 `Ctrl+Shift+O`, "파일 가져오기…" 는 키 없음.

### 44.2 확인하지 못한 것 (TESTCASES §38)

- 실제 폴더 · 파일 선택 창(자동화가 못 누른다)과 그 뒤의 가져오기, 파일 탐색기에서 끌어다 놓기.

## 45. 마크다운에서도 `Ctrl+H` 로 바꾸기 (2026-11-26)

UI/UX 개편 K6(`docs/research/apple-uiux/ADOPT.md`). 원칙 확인: 1 맞음(단축키 규칙 4 — 그리드의 `Ctrl+H` 와 같은 뜻, 규칙 5 — Word · VS Code(Windows) · Sheets 의 바꾸기 키), 3 맞음(글과 표가 같은 키), 나머지 상관없음.

**지금까지의 `Ctrl+H`(확인)**: 편집기 keymap(`lib/cm.ts`)에 `Mod-h` 가 없었다. CodeMirror 의 `Ctrl-h`(글자 지우기)는 Mac 전용 emacs 키라 Windows 에서는 편집기가 받지 않고, 키가 브라우저로 가 **방문 기록**이 열렸다(Edge · Chrome 의 `Ctrl+H`). 코드와 CodeMirror 소스로 확인했다 — 자동화의 이벤트로는 브라우저 동작이 일어나지 않아 화면으로는 못 봤다.

| # | 결정 | 근거 |
|---|---|---|
| RP1 | 편집기에서 `Ctrl+H` → 찾기 패널을 열고 **바꾸기 칸**에 포커스(`openReplacePanel`). 찾을 말은 `Ctrl+F` 와 같이 선택한 글로 채운다. 패널 안(찾기 · 바꾸기 칸)에서 눌러도 같다. 브라우저 기본 동작(방문 기록)은 막힌다 | ADOPT K6. 그리드 `Ctrl+H`(`gridReplace`) 와 같은 뜻 |
| RP2 | `baseExtensions` 에 넣어 **소스 · 하이브리드 · 분할**, **.txt · .json** 편집기가 모두 같다. 읽기 전용 편집기는 바꾸기 칸이 없어 찾기 칸에 둔다 | 같은 편집기, 한 곳에서 |
| RP3 | 팔레트 **편집기: 찾기**(`Ctrl+F`) · **편집기: 바꾸기**(`Ctrl+H`) — 새 창 명령 범위 `editor`(.md · .txt · .json). 창 막대에 단추는 두지 않는다(`noButton` — 막대 단추 검사에서 뺀다). 미리보기 전용 모드면 알림 줄에 이유 | 새 기능은 팔레트 명령과 함께. 막대는 좁고 키 · 팔레트로 닿는다 |
| RP4 | Mac 에서는 `Mod-h` = ⌘H 다. ⌘H 는 macOS 가 앱 가리기로 먼저 받을 수 있다 — 그리드의 `Ctrl+H` 와 같은 처지 | 키 처리 규칙(⌘ 를 Ctrl 로)과 같게 둔다. Mac 확인은 아직 |

코드: `lib/cm.ts`(`openReplacePanel` · keymap), `lib/paneCommands.ts`(범위 `editor` · `noButton` · 두 명령) · `.test.ts`, `Workbench.tsx`(범위 판단), `MarkdownPane.tsx`(명령 받기), `shortcuts-table.mjs`, `docs/guide/markdown.md`.

### 45.1 확인한 것

`npm test` · `npm run build` · `npm run lint`. dev `?opfs` + 내장 브라우저(키는 이벤트로): `개요.md` 소스 · 하이브리드, `메모.txt`, `설정.json` 에서 `Ctrl+H` → 키가 막히고(`defaultPrevented`) 패널이 열려 포커스가 바꾸기 칸. 찾기 칸에서 `Ctrl+H` → 바꾸기 칸. 팔레트 "편집기: 바꾸기" → 바꾸기 칸, "편집기: 찾기" → 찾기 칸, 키 표시 `Ctrl+F` · `Ctrl+H`. 미리보기 전용 모드에서 팔레트 → 알림. 콘솔 오류 없음.

### 45.2 확인하지 못한 것 (TESTCASES §39)

- 실제 키(브라우저 방문 기록이 더는 열리지 않는지)와 설치한 Edge 앱, Mac 의 ⌘H.
- **하이브리드 표 칸을 편집하는 중**(`HybridTable` 의 textarea)에는 편집기가 키를 받지 않아(위젯 `ignoreEvent`) `Ctrl+H` 가 여전히 브라우저로 간다 — `Ctrl+F` 도 전부터 같다. 표 칸 키는 K2 와 같은 파일이라 이 절에서는 고치지 않았다.

## 46. 단축키 안내 창 (Shift+F1) (2026-11-26)

UI/UX 개편 K7(`docs/research/apple-uiux/ADOPT.md`). 원칙 확인: 1 맞음(마우스 대신 키를 익히게 하는 것이 목적), 2 주의 → 포커스가 다른 자리로 옮겨 갈 때만 다시 그린다(KH4), 3 주의 → 작게 · 접을 수 있게 · 좁은 창에서 숨김 · 목차 띠를 피한다(KH6), 6 맞음(Mac 은 ⌘ 표기), 7 맞음(표시뿐, 켬 · 접힘은 화면 설정), 4 · 5 상관없음.

**학습 사다리**: 안내 창(이 자리의 자주 쓰는 키, 늘 보임) → `Alt+Enter`(이 자리의 모든 동작, §40) → `F1`(전체 표). 셋 다 단축키 표(`shortcuts-table.mjs`) 하나에서 나온다.

| # | 결정 | 근거 |
|---|---|---|
| KH1 | **자리**: K1 의 `spotAt(document.activeElement)`(키보드 자리라 point 없이)에 영역보다 좁은 자리를 더해 하나로 정한다(`lib/keyHints.ts` `hintPlace`) — 앱 · 탭 · 파일 트리 · 훑어보기 창(트리에 포커스 + 창이 떠 있음) · 폴더 격자 · 경로 막대 · 목차 · 편집기 · 마크다운 표 칸 · 미리보기(미리보기 전용 모드 · 분할의 미리보기) · 표 · 표(열을 골랐을 때) · 표(셀 편집 중). 좁은 자리는 DOM(`.path-bar` · `.outline-panel` · `.quicklook` · `.preview`)에서 읽는다 | ADOPT K7 "자리 판단은 K1 과 같은 함수". 메뉴와 안내 창이 같은 자리를 본다 |
| KH2 | **데이터**: 단축키 표의 줄에 `hint: { at, label, keys?, when? }` 를 단다 — at: 보일 자리(여럿 가능), label: 짧은 이름(24자 이하, 테스트), keys: 안내 창 표기(없으면 표의 keys 에서 끝의 "(목차)" 같은 자리 표기를 뺀 것), when: 자리 조건(markdown · hybrid · mermaid · writable). 안내 창 전용 줄은 하나만 더했다 — 그리드 "Alt+Enter (셀 편집 중)" 칸 안 줄바꿈 · 확정 | ADOPT 의 `where` · `hint` 를 한 칸으로. keys 칸의 괄호 표기는 F1 · SHORTCUTS.md 에서 그대로 쓰므로 옮기지 않고 안내 창에서만 뗀다 |
| KH3 | **고르기**: 자리의 줄을 표 순서대로, 제 구역(그리드 · 마크다운 · 파일 트리 …)의 줄이 전역 · 탭 줄보다 먼저, 최대 **8줄**. 표 칸 → 편집기, 열 선택 → 표, 훑어보기 창 → 트리 순으로 이어 채우고 같은 키는 앞의 것만(열을 골랐으면 `Ctrl+Alt+=` 는 "오른쪽에 열 넣기" 하나). 팔레트 명령이 달린 줄은 **그 자리의 맥락 메뉴(`contextIds`)에 그 명령이 있을 때만** — 읽기 전용 표 · 가져온 폴더 루트에서 행 넣기 · 이름 바꾸기가 빠진다. 전역 명령 줄은 등록부에서 지금 쓸 수 있을 때만 | 메뉴에 없는 동작을 안내하지 않는다 |
| KH4 | **다시 그리기**: `focusin` · 클릭한 뒤 · 키를 놓고 350 ms 쉰 뒤에만 자리를 다시 읽고, 보일 줄이 바뀌었을 때만 그린다. 글자를 칠 때마다 그리지 않는다 | 원칙 2. 키를 놓은 뒤 읽는 것은 커서가 표 칸 · 목차로 들어가는 것처럼 포커스는 그대로인 자리 바뀜 때문 |
| KH5 | 맨 아래 두 줄: **`Alt+Enter` 이 자리의 모든 동작 · `F1` 전체 표**(키는 표에서). 셀 편집 중에는 `Alt+Enter` 가 칸 안 줄바꿈이라 F1 만 | 학습 사다리 |
| KH6 | **자리 · 모양**: 문서 창 영역의 왼쪽 아래 — 파일 트리 오른쪽 끝 + 10px(트리를 접으면 화면 왼쪽), 하이브리드 목차 띠가 그 자리에 있으면 띠의 오른쪽. 문서 상태 줄 위(bottom 32px), 폭 250px, 글자 12px. 머리 `⌨ 자리 이름` + ▾ 접기 · × 끄기. 창 폭 900px 미만이면 숨는다. 오른쪽 아래는 알림 줄 자리라 피한다 | ADOPT K7 원칙 3 |
| KH7 | **숨을 때**: 대화상자 · 팔레트 · 맥락 메뉴 · 파일 검색 · 도움말 · 가져오기 · 새 문서 창이 떠 있을 때(그 창 안에 키 안내가 있다), 폴더를 고르기 전(시작 화면) | 겹쳐 보이지 않게 |
| KH8 | **포커스를 받지 않는다**: 단추는 `tabIndex=-1`, 누를 때 포커스를 빼앗지 않는다(`mousedown` 기본 동작 막음). 알림 영역(aria-live)이 아니다 — 스크린 리더가 자리 바뀔 때마다 읽지 않는다. `aside aria-label="단축키 안내"` | ADOPT K7. 키보드로는 `Shift+F1` 로 켜고 끈다 |
| KH9 | **켜고 끄기**: `Shift+F1`(전역 `toggleKeyHints`), 팔레트 **단축키 안내 창 켜기 / 끄기**, F1 도움말 머리의 **안내 창 끄기 / 켜기** 단추, 안내 창의 ×. 끄면 알림 줄에 "Shift+F1 로 다시 켭니다". **처음엔 켜짐**, 켬 · 접힘은 이 브라우저의 localStorage(`jaydocs.keyHints.on` · `.folded`). 켜면 접힘도 푼다 | ADOPT K7 기본값. `F1` 가족의 두 키 |
| KH10 | **다음엔 …**: 단축키가 있는 단추(`data-command`, §36)를 **마우스로** 누르면 안내 창 머리 아래에 "다음엔 `Ctrl+F` 표: 찾기" 를 5초 보인다. 키보드로 누른 단추(`detail === 0`)는 보이지 않는다 | ADOPT K7 "더하면 좋은 것" — JetBrains Key Promoter X. 막대 단추 = 팔레트 명령이라 키를 표에서 찾는다 |
| KH11 | Mac 은 표기만 `Ctrl` → `⌘`(`navigator.platform`). 키 처리는 이미 ⌘ 를 Ctrl 로 받는다(`lib/keys.ts`) | 원칙 6 |

코드: `lib/keyHints.ts`(자리 · 고르기 · 맨 아래 줄 · 켬 상태) · `.test.ts`, `components/KeyHints.tsx` · `.css`, `shortcuts-table.mjs`(`hint` 61줄 · `Shift+F1` · 그리드 "Alt+Enter (셀 편집 중)"), `App.tsx`(명령 · 그리기), `HelpDialog.tsx`(단추).

### 46.1 확인한 것

`npm test` · `npm run build` · `npm run lint`. dev `?opfs` + 내장 브라우저(실제 클릭 · 키 입력은 자동화): 빈 화면(앱) → 트리 → `Space` 훑어보기 창 → 표(`표.tsv`) → `F2` 셀 편집 중(맨 아래 `Alt+Enter` 없음) → `Ctrl+Space` 열 선택(`Ctrl+Alt+=` 오른쪽에 열 넣기) → 편집기(소스는 목차 줄 없음, 하이브리드는 `Ctrl+Alt+T`) → `Ctrl+Alt+T` 목차 → `Ctrl+Shift+.` 경로 막대 → 미리보기 전용 모드 → `|||` 로 만든 마크다운 표 칸. 자리마다 줄이 바뀐다. 그리드 툴바 "찾기" 클릭 → "다음엔 Ctrl+F 표: 찾기". `Shift+F1` 끄기(알림 · localStorage 0) · 켜기, 팔레트가 떠 있으면 숨음, F1 도움말 단추로 끄고 켜기, ▾ 접기 · 펴기. 하이브리드 목차 띠 오른쪽으로 비켜 선다. 콘솔 오류 없음.

### 46.2 확인하지 못한 것 · 남은 것 (TESTCASES §40)

- 설치한 Edge 앱에서 `Shift+F1` 이 앱에 오는지, Mac 의 ⌘ 표기, 실제 한글 IME 조합 중에 다시 그리지 않는지.
- 안내 창은 문서 창의 왼쪽 아래 글 · 표를 가린다 — 하이브리드 표를 문서 끝에서 고칠 때 표 위에 겹치는 것을 봤다. 접거나(▾) 끄면 된다. 써 보고 자리를 옮길지 정한다.
- 자주 쓰는 키의 고르기는 표의 순서다 — 써 보고 줄을 바꾼다(`hint` 만 고치면 된다).

## 15. 출처

- 기성품: VS Code mermaid 확장 https://github.com/mjbvz/vscode-markdown-mermaid · Edit CSV https://github.com/janisdd/vscode-edit-csv · SilverBullet https://docs.silverbullet.md/CHANGELOG · Obsidian 메모리 보고 https://forum.obsidian.md/t/question-about-obsidian-software-performance/75588
- 마크다운: CodeMirror changelog https://codemirror.net/docs/changelog/ · composition 이슈 https://github.com/codemirror/dev/issues?q=is%3Aissue+composition · @atomic-editor/editor https://github.com/kenforthewin/atomic-editor · codemirror-markdown-hybrid https://github.com/tiagosimoes/codemirror-markdown-hybrid · ProseMirror changelog https://prosemirror.net/docs/changelog/ · TipTap markdown https://tiptap.dev/blog/release-notes/introducing-bidirectional-markdown-support-in-tiptap · Milkdown https://github.com/Milkdown/milkdown · MDXEditor code blocks https://mdxeditor.dev/editor/docs/code-blocks · mdast-util-to-markdown https://github.com/syntax-tree/mdast-util-to-markdown
- 코드 색(§27): Shiki https://shiki.style/ · JS 정규식 엔진 https://shiki.style/guide/regex-engines
- Mermaid: usage https://mermaid.js.org/config/usage.html · 크기 https://bundlephobia.com/api/size?package=mermaid
- 그리드: Glide https://github.com/glideapps/glide-data-grid (IME #1175) · RevoGrid https://github.com/revolist/revogrid · react-datasheet-grid https://github.com/nick-keller/react-datasheet-grid (#340, #387) · react-data-grid #1702 · Handsontable 라이선스 https://handsontable.com/licensing · AG Grid clipboard https://www.ag-grid.com/react-data-grid/clipboard/ · MUI X clipboard https://mui.com/x/react-data-grid/clipboard/ · jspreadsheet CE #1724 · PapaParse https://www.papaparse.com/docs · csv-parse raw https://csv.js.org/parse/options/raw/
- 전환(§20): 파일 이동 https://groups.google.com/a/chromium.org/g/blink-dev/c/ogS8CeyZ3n8/m/UyYqFPZVAAAJ · Pages 요금제 https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits · 파일 연결 https://learn.microsoft.com/microsoft-edge/progressive-web-apps-chromium/how-to/handle-files
- 셸: FSA https://web.dev/articles/files/open-a-directory · 영구 권한 https://developer.chrome.com/blog/persistent-permissions-for-the-file-system-access-api · FileSystemObserver https://developer.mozilla.org/en-US/docs/Web/API/FileSystemObserver · isomorphic-git https://github.com/isomorphic-git/isomorphic-git · Tauri 요구사항 https://v2.tauri.app/start/prerequisites/ · 서명 https://v2.tauri.app/distribute/sign/windows/ · 단일 exe 크기 https://notes.billmill.org/dev_blog/2026/02/updated_SEA_benchmarks.html
- git UI: @codemirror/merge https://github.com/codemirror/merge · diff2html https://github.com/rtfpessoa/diff2html · daff https://github.com/paulfitz/daff
- 레이아웃: FlexLayout https://github.com/caplin/FlexLayout · dockview https://dockview.dev/ · react-resizable-panels https://github.com/bvaughn/react-resizable-panels
- 결합 문법: Obsidian csv-table https://github.com/coddingtonbear/obsidian-csv-table · SilverBullet Live Queries https://v1.silverbullet.md/Live%20Queries · pandoc-placetable https://github.com/mb21/pandoc-placetable · MyST csv-table https://myst-parser.readthedocs.io/en/latest/syntax/tables.html · Obsidian Bases https://help.obsidian.md/bases/syntax · remark-directive https://github.com/remarkjs/remark-directive · GitHub CSV 렌더 https://docs.github.com/en/enterprise-server@2.19/github/managing-files-in-a-repository/rendering-csv-and-tsv-data
- 게임 툴링: CastleDB https://github.com/ncannasse/castle · Luban https://github.com/focus-creative-games/luban · ExcelToUnity https://github.com/hnb-rabear/excel-to-unity · BakingSheet https://openupm.com/packages/com.cathei.bakingsheet/ · Table Schema https://datapackage.org/standard/table-schema/
