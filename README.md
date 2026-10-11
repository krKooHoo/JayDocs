# JayDocs

Markdown(+Mermaid) 과 TSV 를 **나란히 놓고 편집**하는 경량 로컬 문서 편집기.
Node 사이드카 하나 + 브라우저 창 하나. 문서는 git 리포에 평범한 파일로 둔다. 설계는 [DESIGN.md](DESIGN.md).

> 상태: **Phase 2 완료** — 폴더 열기 · 탭/분할 · 마크다운 소스/미리보기(Mermaid) · TSV 그리드(바이트 왕복 보존 · 스키마 검증 · 한글 IME)
> · md 안에 TSV 표 임베드(`tsv-view`) · git(배지 · HEAD diff · 커밋 · 기록 · 되돌리기) · 이름 바꾸기/삭제 · 외부 변경 감지.
> Phase 3(`tsv-view` 그 자리 편집·bake, Mermaid 템플릿, 하이브리드 Live Preview, 그리드 범위 선택)은 아직 없다.

## 실행

```bash
npm install
npm run build
```

그 뒤에는 `start.cmd` 에 문서 폴더를 **끌어다 놓거나** 인자로 넘긴다.

```bat
start.cmd "C:\Users\user\SagaDocs"
```

Edge(없으면 Chrome) 앱 모드 창이 열린다. 창을 닫으면 서버도 15초 뒤 꺼진다.
주소에 붙은 `#token=…` 이 접속 키다. 터미널에 찍힌 주소를 그대로 쓰면 된다. `git` 이 PATH 에 있어야 git 기능이 켜진다.

## 쓰는 법

- 왼쪽 트리에서 `.md` / `.tsv` 를 클릭하면 가운데 탭으로 열린다. 탭은 끌어서 옮기거나 다른 탭셋에 붙일 수 있다. 오른쪽 클릭 → **이름 바꾸기 / 옮기기 · 삭제 · 새 파일 · 새 폴더**.
- **오른쪽에 분할** (`Ctrl+\`) — 같은 문서를 오른쪽 창에도 연다. 한쪽에서 고치면 다른 쪽도 즉시 바뀐다.
- `Ctrl+S` 저장, `Ctrl+Shift+S` 모두 저장. 탭 이름 옆 `●` 가 미저장, `M/A/?/D` 배지가 git 상태.
- 다른 프로그램이 파일을 바꾸면: 내가 손대지 않은 문서는 조용히 다시 읽고, 수정 중이던 문서는 위에 배너가 떠서 **디스크 내용 받기 / 내 내용으로 덮어쓰기** 를 고른다.
- 레이아웃(탭·분할), 열 너비, 마크다운 보기 모드는 브라우저에 남아 다음에 열 때 복원된다.

### 마크다운

- 창 위의 **소스 / 분할 / 미리보기** 로 보기 모드를 고른다. 미리보기는 GFM(표·체크박스·취소선) + ```` ```mermaid ```` 다이어그램.
- 미리보기의 `.md`/`.tsv` 링크를 누르면 그 문서가 탭으로 열린다(링크는 그 md 파일 위치 기준, `/` 로 시작하면 리포 루트 기준).
- 저장은 소스 그대로다 — 미리보기는 파일을 바꾸지 않는다.

### md 안에 TSV 표 넣기 (`tsv-view`)

````markdown
```tsv-view
file: 10-World/Tile/Tile_Table.tsv
columns: [Key, SurfaceType, Buildable, MovementCost, FoodCost]
where: TerrainType == "Peak" && MovementCost > 5
sort: -MovementCost
limit: 20
```
````

- `file` 리포 상대 경로(필수). `./`, `../` 로 시작하면 md 파일 위치 기준.
- `columns` 열 이름 목록(생략하면 주석 열을 뺀 전부). `sort` 는 `-` 접두면 내림차순, 여러 개 가능. `limit` 행 수.
- `where` 비교식: `==` `!=` `>` `<` `>=` `<=` · `in ["a", "b"]` · `not in` · `&&` `||` `!` · 괄호. 숫자끼리는 숫자로 비교. `Plains, Hill` 같은 리스트 셀은 `in` 에 항목 단위로 걸린다.
- 그리드에서 값을 바꾸면 미리보기 표가 바로 따라오고 "● 저장 전 내용" 이 붙는다. 표의 행을 누르면 그리드가 그 행으로 열린다.
- GitHub 에서는 그냥 코드 블록으로 보인다. (`bake`, `render: mermaid` 는 Phase 3.)

### TSV 그리드

- **이동** 방향키 · `Tab`/`Shift+Tab` · `Home`/`End` · `PageUp`/`PageDown` · `Ctrl+방향키` 끝으로.
- **편집** 그냥 타이핑하면 덮어쓰기, `Enter`/`F2` 는 기존 값 이어 쓰기, `Esc` 취소. `Enter` 확정 후 아래로, `Tab` 확정 후 오른쪽으로.
  한글은 조합 중에도 자모가 빠지지 않는다 (입력창 하나가 항상 떠 있고 조합이 그 안에서 시작된다).
- **지우기** `Delete`/`Backspace`. **되돌리기** `Ctrl+Z` / `Ctrl+Y` (문서 단위 — 분할 창 어디서 눌러도 같다).
- **복사/붙여넣기** `Ctrl+C` 는 활성 셀, `Ctrl+V` 는 Google Sheets·Excel 에서 복사한 블록을 활성 셀부터 채운다. 표 끝을 넘는 행은 추가, 너비를 넘는 열은 잘라 내고 알린다.
- **행/열** 툴바에서 행 삽입(위·아래·끝)·복제·삭제, 열 삽입·삭제. 열을 바꾸면 모든 행이 다시 조립되어 git diff 에 전체가 나오므로 확인을 묻는다.
- **스키마** 1행이 `#string enum bool …` 타입 행이면 2행을 헤더로 보고 고정한다. 빈 타입·`#헤더` 는 주석 열(회색).
  같은 폴더의 `X_Field.tsv`(없으면 리포 안 다른 `_Field` 의 `XDef` 블록)에서 열 설명(열 글자 위에 마우스)과 enum 허용 값을 읽는다.
  enum 셀은 입력창 아래에 후보가 뜬다 (`↓`로 고르고 `Enter`). `A, B` 리스트 열은 마지막 항목만 자동완성. bool 은 체크박스(`Space`).
  byte(0~255)·uint·float·enum 값과 Key 중복은 빨간 밑줄 + 툴팁. 저장은 막지 않는다.
- **왕복 보존** 수정한 행만 다시 조립한다. BOM·CRLF/LF·끝 개행·열 수는 파일에 있던 그대로. 끝 개행이 없는 파일은 아래 상태줄의 **끝 개행 추가** 로 한 번 넣어 두면 행을 덧붙일 때 diff 가 한 줄로 나온다.

### git (아래 **변경 (git)** 패널)

- 바뀐 `.md`/`.tsv` 목록 + 배지. 체크를 풀면 커밋에서 뺀다. 메시지를 쓰고 **커밋** (`Ctrl+Enter`). 저장하지 않은 문서가 섞여 있으면 먼저 저장할지 묻는다.
- 파일 이름(또는 **diff**) → HEAD 와 비교 탭. md 는 왼쪽 HEAD / 오른쪽 현재(편집 가능, 가운데 화살표로 청크 되돌리기). tsv 는 Key 로 행을 맞춘 셀 변경 목록, 항목을 누르면 그리드의 그 셀로.
- **되돌리기** → `git restore` (HEAD 내용으로, 저장 전 수정도 버린다). 새 파일(`?`)은 대상이 아니다.
- **기록** (또는 **현재 문서** / **전체**) → 커밋 목록. **보기** 는 그 시점 내용을 읽기 전용 탭으로, **이 버전으로** 는 그 내용을 현재 문서에 넣는다 (git 은 안 건드린다 — 저장·커밋은 따로).
- push/pull/브랜치는 없다. 터미널에서.

## 개발

```bash
npm run serve   # 사이드카: 127.0.0.1:5190, 토큰 dev, 자동 종료 없음
npm run dev     # Vite 5173 — /api 는 5190 으로 프록시. http://localhost:5173 을 연다
npm run build   # dist/ 생성 (사이드카가 서빙)
npm test        # vitest — TSV 왕복(SagaDocs 실제 파일 포함)·편집·스키마·검증·tsv-view·diff
```

빌드한 `dist/` 를 사이드카로 바로 보려면 `http://127.0.0.1:5190/#token=dev`.
`.claude/launch.json`(여기와 JayTools 루트)의 `--root` 경로는 PC마다 다르므로 clone 한 뒤 맞춘다.
테스트의 SagaDocs 왕복 항목은 `../../SagaDocs`, `C:\Users\user\SagaDocs` 등 후보 경로나 `SAGADOCS` 환경변수에서 리포를 찾고, 없으면 건너뛴다.

다른 PC에서 이어서 작업할 때는 [HANDOFF.md](HANDOFF.md).

## 구조

```
server.mjs            사이드카 — 정적 파일 + /api/tree,file,mkdir,rename,delete + /api/git/* (CLI 위임) + /api/events(SSE). 런타임 의존성 0
start.cmd             실행기
src/
  lib/backend.ts      Backend 인터페이스 + HttpBackend (토큰 헤더, 409 → ConflictError, git 메서드)
  lib/token.ts        #token=… → sessionStorage
  lib/nav.ts          창 사이 이동 — 문서 열기 · 그리드 셀 선택 요청
  lib/cm.ts           CodeMirror 공통 설정 (마크다운 창 · diff 창 · 이전 버전 보기)
  lib/md/tsvView.ts   tsv-view 펜스 파서(YAML 부분집합) · where 식 · 필터/정렬 적용
  lib/tsv/
    model.ts          TsvTable / TsvRow (불변, raw 행 보관)
    parse.ts          텍스트 → 표 (탭 split 만, 따옴표 해석 없음) · 열 때 경고
    serialize.ts      표 → 텍스트 (수정한 행만 재조립) · 셀 글자 정리
    edits.ts          setCell · 행/열 삽입·삭제·복제 · 붙여넣기 (순수 함수)
    clipboard.ts      Sheets 클립보드 TSV 파싱
    field.ts          _Field 시트의 블록 읽기
    schema.ts         타입 행 + Field 블록 → 열 스키마 (enum 후보 · 설명 · Key)
    validate.ts       셀 검증 (타입 · enum · Key 중복)
    diff.ts           두 표의 차이 (Key 로 행 맞춤)
    *.test.ts         vitest
  store/documents.ts  DocumentStore — 경로당 문서 하나 (TextDoc | TsvDoc), 창 간 동기화, undo 스택, Field 캐시, dirty·충돌·저장
  store/git.ts        git 상태 (경로 → 배지), 뭉친 새로고침, HEAD 변경 카운터
  components/
    Workbench.tsx     flexlayout-react 탭·분할·레이아웃 저장, 닫기 확인. md/tsv/diff/rev 탭, 아래 git 패널
    FileTree.tsx      파일 트리 (git 배지, 오른쪽 클릭 메뉴)
    MarkdownPane.tsx  CodeMirror 6 + 소스/분할/미리보기 모드
    PreviewPane.tsx   react-markdown + mermaid(동적) + tsv-view 표
    GitPane.tsx       변경 목록 · 커밋 · 기록 · 되돌리기
    DiffPane.tsx      HEAD 비교 (md: @codemirror/merge, tsv: 셀 diff) · 이전 버전 보기(RevPane)
    grid/Grid.tsx     자체 DOM 그리드 — 행 가상화(@tanstack/react-virtual) · 고정 헤더 · 입력 textarea 하나 · 드롭다운
    grid/GridPane.tsx 툴바(되돌리기·행/열) · 배너 · 상태줄, 스토어 ↔ Grid 연결
```

## 보안 (로컬 도구 기준)

127.0.0.1 에만 바인딩 · 모든 `/api` 요청에 토큰 · `Host`/`Origin` 검사 · 경로는 문서 폴더 아래로만(`..`, 절대 경로, 루트 밖 링크, `.git` 안 거부) · git 은 인자 배열로만 호출(셸 없음, 경로 앞 `--`).
