# JayDocs 인수인계 (2026-10-11, Phase 0 완료 시점)

다른 PC의 **새 세션**에 아래 프롬프트를 그대로 붙여 넣으면 된다. 이 문서 자체가 그 세션이 처음 읽을 문서다.

---

## 새 세션용 프롬프트

```
JayTools 리포의 JayDocs 를 이어서 개발한다. 먼저 JayDocs/HANDOFF.md 를 읽고, 거기 적힌 순서로 문서를 읽은 뒤
환경을 준비하고 Phase 1 을 시작해 줘. 시작 전에 HANDOFF.md 의 "핵심 사실" 을 memory 에 저장해 둬.
```

---

## 1. 지금 상태

- **JayDocs** (`JayTools/JayDocs/`): Markdown(+Mermaid)과 TSV를 나란히 편집하는 경량 로컬 편집기. **Phase 0 완료·검증 끝.**
  사이드카(`server.mjs`, 의존성 0) + Vite/React 18 SPA. 탭·분할(flexlayout-react) · 파일 트리 · CodeMirror 6 마크다운 편집 · 저장 · 외부 변경 감지/충돌 배너 · 레이아웃 복원. TSV는 아직 **일반 텍스트**로 열린다.
- **SagaDocs** (별도 리포, `<GitHub 폴더>/SagaDocs`, `Project-SAGA` 옆): 기획 원본. Google Sheets export 7개 TSV를 도메인 폴더로 이주·개명 완료(`Tile_Table.tsv`, `Building_Table.tsv` …). README·용어집·Tile.md 샘플·작업 일지 있음.
- 커밋·푸시 완료 시점: 이 문서가 포함된 커밋.

## 2. 읽을 순서 (10분)

1. `JayDocs/DESIGN.md` — §0 결론, §2 TSV 포맷 규칙(= 계약), §5 핵심 결정 D1~D7, §6 데이터 모델(특히 6.1 TSV 왕복 규칙), §11 Phase 1 범위와 검증 조건, §13 피드백 반영, §14 SagaDocs 구조.
2. `JayDocs/README.md` — 실행·개발 명령, 소스 구조.
3. `JayDocs/REPORT-unity-importer-saga.md` — **"먼저 알아야 할 것 (요약)" 네 줄만.** 나머지는 참고용(게임 쪽 임포터 사정). JayDocs 계약과 무관하다.
4. `SagaDocs/README.md`, `SagaDocs/00-Overview/용어집.md` — 실제 데이터와 규칙.

## 3. 환경 준비

```bash
# JayTools
git pull
cd JayDocs
npm install          # node_modules 와 dist 는 커밋하지 않는다
npm run build        # dist/ 생성
# SagaDocs 는 Project-SAGA 옆에 clone (GitHub 리포가 없으면 §6 참고)
```

- `JayTools/.claude/launch.json` 과 `JayDocs/.claude/launch.json` 의 `--root` 를 이 PC의 SagaDocs 경로로 바꾼다 (preview 도구는 **JayTools 루트의** launch.json 을 읽는다).
- 확인: `npm run serve` 후 `http://127.0.0.1:5190/#token=dev` 를 열어 트리·편집·저장이 되는지. 또는 `start.cmd "<SagaDocs 경로>"`.
- Node 22+, git 필요. 설치 시점 버전: Vite 8, TypeScript 7, flexlayout-react 0.11, CodeMirror 6.43.

## 4. 핵심 사실 (memory 에 저장할 것)

- Jay는 1인 개발. 한국어. 커밋·push는 Jay가 말할 때만. 권고는 하나로 강하게, 되돌릴 수 있는 건 정하고 알리고, 질문은 끝에 모아서.
- 기획 원본은 **git(SagaDocs)**. Notion·Asana·Sheets는 더 이상 원본이 아니다.
- **게임(Project-SAGA)은 SagaDocs TSV를 직접 읽지 않는다.** SAGA의 `/design` 세션이 읽고 게임 형식으로 옮겨 쓴다. 복사·서브모듈·링크 없음. → JayDocs 포맷은 DESIGN §2 그대로가 계약.
- 지킬 것: Key는 파일 안에서 유일, `_Field` 시트는 빈 줄로 블록 구분·첫 줄이 블록 이름(SAGA 비교 도구 기준).
- Google Sheets export TSV는 **CRLF**다. SagaDocs 리포는 `.gitattributes`로 **LF 정규화**. JayDocs는 파일별 EOL을 감지해 보존한다(DESIGN §6.1) — Phase 1 왕복 테스트는 CRLF 입력과 LF 입력 둘 다 넣을 것.
- v1 마크다운은 소스 + 미리보기(하이브리드는 Phase 3). TSV 그리드는 **자체 제작**(DOM + 행 가상화, 라이브러리 아님 — 이유는 DESIGN §3.3/D3).
- 다른 세션에 보낼 프롬프트는 작게(질문 3~5개). 이전에 10항목 조사 프롬프트가 과한 작업을 만들었다.

## 5. 다음 작업 — Phase 1 (DESIGN §11)

목표: TSV를 스프레드시트처럼 편집하되 **바이트 단위 왕복 보존**.

1. `src/lib/tsv/parse.ts`, `serialize.ts` — `split(/\r?\n/)` + `split('\t')`, 따옴표 해석 없음. 행마다 `raw` 보관, 수정한 행만 재조립, BOM·EOL·끝 개행·열 수 보존. **vitest로 SagaDocs의 7개 TSV 왕복 = 바이트 동일** 을 먼저 통과시킨다.
2. `schema.ts`, `field.ts`, `validate.ts` — 타입 행 + `_Field` 블록에서 열 스키마 유도(DESIGN §6.2). enum 후보·설명 툴팁·bool·byte/uint/float·Key 중복·리스트 셀(`Plains, Hill`).
3. `components/grid/` — 행 가상화(`@tanstack/react-virtual`), 키보드 이동, 셀 편집(`F2`/`Enter`/타이핑, **한글 IME: `isComposing` 가드**), undo/redo(문서 단위), Sheets 복사/붙여넣기(`text/plain` TSV), 행 삽입/삭제/복제, 열 삽입/삭제, 헤더 2행 고정, 열 너비, 주석 열 회색, enum 드롭다운, bool 체크박스, 오류 밑줄.
4. `DocumentStore`에 `TsvDoc` 추가(지금은 md 텍스트 문서만). `Workbench`에서 `.tsv`는 `GridPane`으로.
5. 검증: Tile_Table에 Peak 행 추가 → `git diff` 한 줄. 한글 설명 셀 타이핑에서 자모 유실 없음. Sheets 3×3 복사→붙여넣기.

범위 통제: 범위 선택·채우기 핸들·찾기/바꾸기·열 드래그 재정렬은 Phase 3. Phase 1이 예산 2배를 넘기면 RevoGrid로 교체(D3 탈출구).

## 6. 알려진 상태·주의

- 새 파일/새 폴더는 `window.prompt`. 이름 바꾸기·삭제 API 없음(Phase 2).
- 번들 890 KB(gz 287 KB) — flexlayout 몫이 큼. 나중에 줄일 여지.
- 레이아웃은 `localStorage`에 root 경로별 저장. 경로가 다른 PC에서는 새 레이아웃으로 시작한다.
- SagaDocs GitHub 원격: 이 PC에는 `gh`가 없어 리포를 만들지 못했을 수 있다. 커밋 로그에 push 여부가 적혀 있다. 없으면 GitHub에서 private 리포 `SagaDocs`를 만들고 `git remote add origin <url> && git push -u origin main`.
- Phase 0에서 설계와 달라진 점: WebSocket 대신 SSE, chokidar 대신 `fs.watch`. DESIGN §11 Phase 0 참고.
