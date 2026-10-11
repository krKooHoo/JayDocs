# JayDocs

Markdown(+Mermaid) 과 TSV 를 **나란히 놓고 편집**하는 경량 로컬 문서 편집기.
Node 사이드카 하나 + 브라우저 창 하나. 문서는 git 리포에 평범한 파일로 둔다. 설계는 [DESIGN.md](DESIGN.md).

> 상태: **Phase 0** (뼈대) — 폴더 열기 · 탭/분할 · 마크다운 편집 · 저장 · 외부 변경 감지.
> TSV 그리드(Phase 1), 미리보기·git(Phase 2), 임베드·Mermaid 생성(Phase 3)은 아직 없다. TSV 는 지금은 일반 텍스트로 열린다.

## 실행

```bash
npm install
npm run build
```

그 뒤에는 `start.cmd` 에 문서 폴더를 **끌어다 놓거나** 인자로 넘긴다.

```bat
start.cmd "C:\Users\gaber\Documents\GitHub\SagaDocs"
```

Edge(없으면 Chrome) 앱 모드 창이 열린다. 창을 닫으면 서버도 15초 뒤 꺼진다.
주소에 붙은 `#token=…` 이 접속 키다. 터미널에 찍힌 주소를 그대로 쓰면 된다.

## 쓰는 법

- 왼쪽 트리에서 `.md` / `.tsv` 를 클릭하면 가운데 탭으로 열린다. 탭은 끌어서 옮기거나 다른 탭셋에 붙일 수 있다.
- **오른쪽에 분할** (`Ctrl+\`) — 같은 문서를 오른쪽 창에도 연다. 한쪽에서 고치면 다른 쪽도 즉시 바뀐다.
- `Ctrl+S` 저장, `Ctrl+Shift+S` 모두 저장. 탭 이름 옆 `●` 가 미저장 표시.
- 다른 프로그램이 파일을 바꾸면: 내가 손대지 않은 문서는 조용히 다시 읽고, 수정 중이던 문서는 위에 배너가 떠서 **디스크 내용 받기 / 내 내용으로 덮어쓰기** 를 고른다.
- `＋파일` / `＋폴더` 는 트리에서 마지막으로 고른 폴더 아래에 만든다.
- 레이아웃(탭·분할)은 브라우저에 남아 다음에 열 때 복원된다.

## 개발

```bash
npm run serve   # 사이드카: 127.0.0.1:5190, 토큰 dev, 자동 종료 없음
npm run dev     # Vite 5173 — /api 는 5190 으로 프록시. http://localhost:5173 을 연다
npm run build   # dist/ 생성 (사이드카가 서빙)
npm test        # vitest
```

빌드한 `dist/` 를 사이드카로 바로 보려면 `http://127.0.0.1:5190/#token=dev`.
`.claude/launch.json`(여기와 JayTools 루트)의 `--root` 경로는 PC마다 다르므로 clone 한 뒤 맞춘다.

다른 PC에서 이어서 작업할 때는 [HANDOFF.md](HANDOFF.md).

## 구조

```
server.mjs            사이드카 — 정적 파일 + /api/tree,file,mkdir + /api/events(SSE). 런타임 의존성 0
start.cmd             실행기
src/
  lib/backend.ts      Backend 인터페이스 + HttpBackend (토큰 헤더, 409 → ConflictError)
  lib/token.ts        #token=… → sessionStorage
  store/documents.ts  DocumentStore — 경로당 문서 하나, ChangeSet 으로 창 간 동기화, dirty·충돌·저장
  components/
    Workbench.tsx     flexlayout-react 탭·분할·레이아웃 저장, 닫기 확인
    FileTree.tsx      파일 트리
    MarkdownPane.tsx  CodeMirror 6 (.md 는 마크다운 하이라이트, 그 외는 일반 텍스트)
```

## 보안 (로컬 도구 기준)

127.0.0.1 에만 바인딩 · 모든 `/api` 요청에 토큰 · `Host`/`Origin` 검사 · 경로는 문서 폴더 아래로만(`..`, 절대 경로, 루트 밖 링크 거부).
