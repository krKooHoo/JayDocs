# JayDocs 개발 문서

사용법은 [README](../README.md) 와 [사용 가이드](guide/) 에 있다. 이 문서는 실행 · 배포 · 개발 · 소스 구조 · 보안이다. 작업 규칙은 [CLAUDE.md](../CLAUDE.md), 설계 배경은 [DESIGN.md](../DESIGN.md)(2026-10-31 전환 뒤 구조는 §20 이후), 현재 상태와 다음 작업은 [HANDOFF.md](../HANDOFF.md), 전체 기능을 손으로 검증할 때는 [TESTCASES.md](../TESTCASES.md), 단축키 전체는 [SHORTCUTS.md](../SHORTCUTS.md).

## 실행

배포 주소를 **Edge** 에서 열고 상단의 **앱으로 설치** 를 누른다(주소창의 설치 아이콘도 같다). 그 뒤로는 시작 메뉴·작업 표시줄에서 연다.

1. **문서 폴더 열기** 로 폴더를 고르고 허용한 뒤, 문서 별칭과 상세 경로를 넣는다(건너뛰어도 된다).
2. 다른 폴더가 더 필요하면 `Ctrl+Shift+O` 로 가져온다.
3. 다음부터는 바로 열린다. 권한이 풀려 있으면 시작할 때 **허용** 을 한 번 누른다. 최근에 연 폴더는 그 화면에서 바로 고를 수 있다.

- Chrome 도 된다. 다만 Chrome 은 파일 이동 API 가 막혀 있어 이름 변경을 복사 후 삭제로 처리한다. Firefox · Safari 는 폴더를 열 수 없다.
- **탭으로 쓰면 권한이 닫을 때마다 풀릴 수 있다.** 앱으로 설치해 쓴다.
- 오프라인에서도 돈다(처음 한 번은 인터넷 필요).

### 자동 업데이트

`main` 에 push 하면 GitHub Actions(`.github/workflows/deploy.yml`)가 테스트 → 빌드 → 배포한다. 앱은 새 버전을 받아 두었다가 **모든 창을 닫고 다음에 열 때** 적용한다. 저절로 새로고침되는 일은 없다.

- **언제 확인하나**: 앱을 켤 때, 창으로 돌아올 때(10분 간격), 켜 둔 동안 1시간마다. 상단(시작 · 허용 화면은 아래쪽)의 **업데이트 확인** 이나 명령 팔레트로 바로 확인한다.
- **버튼이 바뀐다**: `업데이트 확인` → `새 버전 받는 중…` → `새 버전 적용`. 적용은 저장 안 한 문서가 있으면 막는다. 받다가 실패하면 `다시 받기` 가 뜨고 지금 버전은 그대로 돈다.
- **지금 버전**은 시작 화면과 버튼 설명에 `빌드 날짜 · 커밋` 으로 보인다.

### 배포

공개 리포 하나로 코드와 앱을 함께 관리한다. 앱 주소는 https://krkoohoo.github.io/JayDocs/ 이고, Settings → Pages 의 Source 는 GitHub Actions 다. 따로 넣을 토큰이나 설정은 없다.

## 한 곳에서 관리하는 표

- 여는 파일 형식은 `src/lib/filetypes.mjs` 한 곳에 적는다.
- 가져온 폴더의 경로 규칙(`@별칭/…`)은 `src/lib/roots.mjs` 한 곳에 적는다.
- 코드 블록에 색을 넣는 언어는 `src/lib/code/langs.ts` 한 곳에 적는다. 문법 파일이 언어마다 청크로 나와 서비스 워커가 미리 받으므로 쓰는 언어만 넣는다(DESIGN §27 CC3). 테스트가 표의 언어가 전부 실리는지 본다.
- 단축키는 `src/lib/shortcuts-table.mjs` 한 곳에 적는다. `npm run shortcuts` 가 SHORTCUTS.md 를 다시 만들고, 테스트가 둘이 같은지 본다. 브라우저가 먼저 가로채는 조합(`Ctrl+W` `Ctrl+T` `Ctrl+N` `Ctrl+Tab` `Ctrl+숫자`)은 쓰지 않는다. 새 기능을 넣을 때는 단축키 표와 팔레트 명령을 같이 넣는다.

## 사용 가이드 스크린샷

`docs/images/` 의 그림은 `npm run dev` 의 `?opfs` 화면에 게임 기획 샘플(`별빛개척지-기획`)을 넣고 헤드리스 Edge 로 찍었다(가로 1280~1600). UI 가 크게 바뀌면 같은 샘플로 다시 찍는다.

## 개발

```bash
npm run dev     # Vite 5173. http://127.0.0.1:5173 을 Edge/Chrome 에서 연다 (포트를 바꾸려면 `-- --port 5177 --strictPort`)
npm run build   # 타입 검사 + dist/ + sw.js
npm test        # vitest — 파일 처리(메모리 파일 시스템)·TSV 왕복·편집·스키마·검증·tsv-view·계산식
npm run lint    # oxlint (기본 규칙). 경고만 낸다 — 지금 25건, 버그는 없다(DESIGN §24.7 X12). 배포 워크플로에는 없다
```

- 폴더 선택 창은 자동화가 못 누른다. 화면 시험은 `http://127.0.0.1:5173/?opfs` (개발 전용) — 브라우저 안 저장소를 문서 폴더로 쓴다. 변경 감지도 실제로 돈다. 샘플 문서는 `src/lib/fsa/devSeed.ts` 에 있다: 타입 행 · enum · bool · Key 검증 오류가 든 `data/Item/Item_Table.tsv` + `Item_Field.tsv` + `Item_Calc.tsv`, 그 표를 `tsv-view` 로 임베드한 `docs/아이템.md`. 샘플은 **파일이 비어 있을 때만** 쓴다 — 샘플을 고친 뒤에는 브라우저 저장소(OPFS)를 지우고 다시 연다.
- 빌드본(서비스 워커 포함)은 `npx vite preview`. `.claude/launch.json` 에 둘 다 있다.
- 테스트의 SagaDocs 항목은 `../SagaDocs`(이 리포 옆), `C:\Users\user\SagaDocs` 등 후보 경로나 `SAGADOCS` 환경변수에서 리포를 찾는다. 리포가 없거나, 왕복 항목은 TSV 가 하나도 없을 때, 스키마 항목은 `10-World/Tile/Tile_Field.tsv` 등 필요한 파일이 없을 때 건너뛴다(실패가 아니다).

현재 상태와 다음 작업은 [HANDOFF.md](../HANDOFF.md). 전체 기능을 손으로 검증할 때는 [TESTCASES.md](../TESTCASES.md).

## 구조

```
public/               manifest · 앱 아이콘 · 파일 탐색기 연결 도우미(helper/)
scripts/gen-sw.mjs    npm run build 끝에 dist/sw.js 생성 (오프라인 · 자동 업데이트)
scripts/gen-shortcuts.mjs  npm run shortcuts — SHORTCUTS.md 생성
.github/workflows/deploy.yml  main push → 테스트 · 빌드 → GitHub Pages 배포
src/
  lib/backend.ts      Backend 인터페이스, ConflictError
  lib/fsa/fsaBackend.ts  File System Access 구현 — 트리 · 읽기(인코딩 감지 · 바이너리/크기 거부) · 저장(낙관적 잠금) · 이름 변경(덮어쓰기 검사, move 실패 시 복사) · 변경 감지(FileSystemObserver, 뭉치기) · 가져온 폴더
  lib/fsa/workspace.ts   작업 공간(주 폴더 + 가져온 폴더 · 별칭 · 상세 경로) · IndexedDB 저장 · 최근 10개 · 권한 묻기
  lib/localPath.ts    상세 경로 다듬기 · 검사 · 앱 경로와 합치기 · 미리 채울 값
  lib/explorer.ts     파일 탐색기 열기 (jaydocs-open: → 연결 도우미)
  lib/fsa/fake.ts     시험용 메모리 파일 시스템
  lib/fsa/devSeed.ts  개발 전용 `?opfs` — 폴더 선택 창 없이 브라우저 저장소로 화면 시험 (스키마 · 계산식 · tsv-view 샘플 포함)
  lib/pwa.ts          앱 설치 · 서비스 워커 등록 · 새 버전 안내
  lib/nav.ts          창 사이 이동 — 문서 열기 · 그리드 셀 선택 요청
  lib/dialogs.ts      앱 대화상자 — `await askText()` · `askConfirm()` (줄 세우기). 그리는 것은 components/DialogHost.tsx (DESIGN §24.6)
  lib/notices.ts      알림 줄 — `notify()` · `notifyError()` (실패는 남고 안내는 사라진다, 되돌리기 버튼). 그리는 것은 components/NoticeHost.tsx
  lib/names.ts        새 파일 · 새 폴더 · 이름 바꾸기에서 입력한 경로 검사 · 처음 선택할 범위(확장자 앞)
  lib/filetypes.mjs   여는 파일 형식 표 (확장자 → md / table / text, 아이콘)
  lib/roots.mjs       가져온 폴더 경로 규칙 (`@별칭/…` 나누기·합치기, 같은 루트 안 경로, 별칭 규칙, 기본 무시 폴더)
  lib/jsonText.ts     JSON 문법 확인 · 정렬 (내용이 바뀌는 정렬은 거부)
  lib/cm.ts           CodeMirror 공통 설정 (마크다운 창 · 평문/JSON 창)
  lib/md/tsvView.ts   tsv-view 펜스 파서(YAML 부분집합) · where 식 · 필터/정렬 적용
  lib/md/template.ts  Mermaid 생성용 Mustache 부분집합 (each · if · .list · .id)
  lib/md/bake.ts      bake — 펜스 찾기 · 파이프 표 생성 · 저장 시 변경 계산 · baked 를 걷어 낸 글의 줄 → 원문 줄
  lib/md/sourceLines.ts  렌더된 조각에 원문 줄 번호(`data-line`)를 찍는 rehype 플러그인 (훑어보기 패널)
  lib/templates.ts    새 문서 템플릿 표 (형식마다 빈 문서 · 예시) · 이름 칸 → 경로 · 내 템플릿(`_templates/`) 목록
  lib/skim/           훑어보기 (DESIGN §25)
    index.ts          `useSkimText(path)` — 열린 문서는 스토어, 안 연 파일은 디스크에서
    reader.ts         읽기 캐시 (경로 + 수정 시각, 200개, 한 번에 4개)
    fit.ts            썸네일 배율 (A4 틀 · 짧은 문서는 3배까지)
    head.ts           앞 N줄만 자르기 · BOM · 줄바꿈 맞추기
    lineMap.ts        패널의 줄 ↔ 위치 지도
    panel.ts          패널 켬 · 끔 · 너비 (localStorage)
    grid.ts           폴더 격자의 열 수 · 방향키 이동
    look.ts           훑어보기 창의 크기 · 배율 (localStorage) · 확대 / 크기 키
  lib/tsv/
    model.ts          TsvTable / TsvRow (불변, raw 행 보관)
    parse.ts          텍스트 → 표 (탭 split 만, 따옴표 해석 없음) · 열 때 경고
    serialize.ts      표 → 텍스트 (수정한 행만 재조립) · 셀 글자 정리
    csv.ts            CSV (RFC 4180) ↔ 같은 표 모델 — 레코드 원문·따옴표 칸 보존, 고친 레코드만 재조립
    table.ts          경로의 형식(tsv/csv)에 따라 읽기·쓰기·열 때 경고·셀 정리 — 스토어·bake 가 부른다
    edits.ts          setCell · 행/열 삽입·삭제·복제 · 붙여넣기 (순수 함수)
    clipboard.ts      Sheets 클립보드 TSV 파싱·만들기 (줄바꿈 든 칸만 따옴표)
    mdTable.ts        머리글 있는 표 읽기 — 마크다운 파이프 표 · <th> HTML 표 (DESIGN §19)
    field.ts          _Field 시트의 블록 읽기
    schema.ts         타입 행 + Field 블록 → 열 스키마 (enum 후보 · 설명 · Key)
    validate.ts       셀 검증 (타입 · enum · Key 중복)
  lib/calc/
    expr.ts           계산식 토크나이저 · 파서 · 평가기 (함수 · lookup)
    calc.ts           X_Calc.tsv 규칙 읽기 · 계산 · 적용 (stale 판정)
  lib/code/           마크다운 코드 블록의 색 (DESIGN §27) — Shiki 를 코드 블록을 처음 그릴 때 받는다
    langs.ts          색을 넣는 언어 표 (id · 별칭 · 문법 받기) · 펜스의 언어 표기 읽기(`codeLangOf`)
    highlight.ts      Shiki 지연 로드 · 줄/토큰으로 나누기(`tokenizeCode`, 밝은 · 어두운 색을 같이) · 기억 · 400줄 상한
    cmColors.ts       편집기 확장(`codeColors`) — 보이는 블록에 mark 장식, 입력이 멈추면 다시 나눈다
  lib/codegen/        표 → C# DTO (DESIGN §26). 파일 쓰기는 `App.tsx` 의 `exportDto`
    csharpDto.ts      머리글 · 타입 읽기(`analyzeDto`) · C# 소스(`renderDto`) · 기본 클래스 이름 · 경로 검사
    dtoPrefs.ts       표마다 내보낸 `.cs` 경로 기억 (localStorage)
    *.test.ts         vitest
  store/documents.ts  DocumentStore — 경로당 문서 하나 (TextDoc | TsvDoc), 창 간 동기화, undo 스택, Field 캐시, dirty·충돌·저장. 화면은 경로별로 구독한다(`useDocVersion` 등, DESIGN §24.5)
  components/
    Workbench.tsx     flexlayout-react 탭·분할·레이아웃 저장, 닫기 확인
    FileTree.tsx      파일 트리 (오른쪽 클릭 메뉴, 가져온 폴더 `@별칭` 노드)
    ImportDialog.tsx  폴더 가져오기 창 (폴더 선택 · 별칭 · 상세 경로 · 읽기 전용 · 최근 폴더)
    StartScreen.tsx   시작 화면 (문서 폴더 열기 · 최근 폴더) · 권한 다시 허용 화면
    UpdateButton.tsx  업데이트 확인 → 받는 중 → 적용 버튼
    FolderInfoDialog.tsx  문서 별칭 · 상세 경로 입력 창
    ExplorerHelperDialog.tsx  파일 탐색기 연결 도우미 안내
    MarkdownPane.tsx  CodeMirror 6 + 소스/하이브리드/분할/미리보기 모드. md 가 아니면 평문(txt) · JSON(강조·검사·정렬)
    ReadOnlyBanner.tsx 읽기 전용 배너 — 읽기 전용 가져온 폴더("읽기 전용 끄기") · UTF-8 아닌 파일("UTF-8 로 바꿔 저장")
    PreviewPane.tsx   react-markdown + mermaid(동적) + tsv-view 표(그 자리 편집 · 템플릿 렌더)
    CodeBlock.tsx     미리보기의 코드 블록 — 언어에 맞춰 색을 넣는다 (lib/code/)
    DocView.tsx       훑어보기 공통 렌더러 — `DocView`(md · 표 · 평문) · `DocFileView`(읽어서 그림) · `DocThumb`(A4 틀 썸네일)
    NewDocDialog.tsx  새 문서 창 — 빈 문서 · 예시 · 내 템플릿 카드, 이름 칸
    SkimPanel.tsx     훑어보기 패널 — 문서 창 오른쪽의 축소된 문서, 클릭 → 커서, 범위 상자
    QuickLook.tsx     훑어보기 창 — 트리 `Space`. 파일은 문서, 폴더는 썸네일 격자
    docPanes.ts       문서 창 수 context (패널은 문서 창이 하나일 때만 보인다)
    hybrid.ts         하이브리드 Live Preview — CM6 StateField 장식 (표식 숨김 · 펜스 블록 위젯 · 코드 상자)
    HybridTable.tsx   하이브리드 표 위젯 — 칸을 눌러 그 자리에서 고친다 (lib/md/tableEdit.ts)
    grid/Grid.tsx     자체 DOM 그리드 — 행 윈도잉(고정 높이, 직접 계산) · 고정 헤더 · 입력 textarea 하나 · 드롭다운 · 범위 선택 · 채우기 핸들 · 열 드래그
    grid/GridPane.tsx 툴바(되돌리기·행/열) · 배너 · 상태줄, 스토어 ↔ Grid 연결
    PaneErrorBoundary.tsx 창 안쪽 렌더 오류를 잡아 저장 안 한 편집을 지킨다 (그리드)
```

## 보안

- **문서는 올라가지 않는다.** 서버가 없고, 코드는 브라우저 안에서 돌며 파일을 직접 읽고 쓴다. 공개되는 것은 앱 코드뿐이다.
- 배포된 코드는 허용한 폴더를 고칠 수 있다. **GitHub 2단계 인증 필수.** 라이브러리는 번들에 넣고 lockfile 로 고정하며, 실행 중에 CDN 에서 코드를 받지 않는다.
- 같은 주소(`krkoohoo.github.io`)의 다른 페이지는 저장소와 폴더 핸들을 함께 볼 수 있다. 위키와 `portfolio-test` 가 여기에 있으니 **두 사이트에 외부 스크립트나 다른 사람의 코드를 넣지 않는다.** 넣어야 한다면 JayDocs 를 먼저 다른 주소로 옮긴다.
- 연결 도우미를 설치하면 어느 웹페이지든 `jaydocs-open:` 주소를 부를 수 있다. 그래서 도우미는 로컬 드라이브 경로의 폴더를 보여 주거나 파일을 선택해 보여 주기만 하고, 파일을 실행하지 않으며, 네트워크 경로(`\\서버`)는 거부한다. 브라우저도 처음에 앱을 열지 묻는다.
- 경로는 허용한 폴더 아래로만(`..`, 절대 경로, `.git` 안 거부). 쓰기는 읽기 전용 폴더에서 막힌다.
- 삭제는 휴지통으로 가지 않는다. 앱이 그렇게 묻는다.
