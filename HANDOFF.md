# JayDocs 인수인계 (2026-10-11, Phase 1 완료 시점)

다른 PC의 **새 세션**에 아래 프롬프트를 그대로 붙여 넣으면 된다. 이 문서 자체가 그 세션이 처음 읽을 문서다.

---

## 새 세션용 프롬프트

```
JayTools 리포의 JayDocs 를 이어서 개발한다. 먼저 JayDocs/HANDOFF.md 를 읽고, 거기 적힌 순서로 문서를 읽은 뒤
환경을 준비하고 Phase 2 를 시작해 줘. 시작 전에 HANDOFF.md 의 "핵심 사실" 을 memory 에 저장해 둬.
```

---

## 1. 지금 상태

- **JayDocs** (`JayTools/JayDocs/`): Markdown(+Mermaid)과 TSV를 나란히 편집하는 경량 로컬 편집기. **Phase 0·1 완료·검증 끝.**
  사이드카(`server.mjs`, 의존성 0) + Vite/React 18 SPA. 탭·분할(flexlayout-react) · 파일 트리 · CodeMirror 6 마크다운 편집 · 저장 · 외부 변경 감지/충돌 배너 · 레이아웃 복원.
  **TSV는 자체 그리드로 열린다** — 바이트 왕복 보존(수정한 행만 재조립), 타입 행 + `_Field` 스키마(툴팁·enum 드롭다운·bool 체크박스·검증·Key 중복), 한글 IME, Sheets 붙여넣기, undo/redo, 행/열 조작, 열 너비.
- **SagaDocs** (별도 리포, 이 PC는 `C:\Users\user\SagaDocs`, 원래 PC는 `C:\Users\gaber\Documents\GitHub\SagaDocs`): 기획 원본. TSV 7개(LF · BOM 없음 · **끝 개행 없음**). 원격 `github.com/krKooHoo/SagaDocs`.
- 커밋·푸시 여부: 이 문서가 포함된 커밋의 로그를 본다. Phase 1 작업 시점에는 Jay 지시 전이라 **커밋하지 않았다.**

## 2. 읽을 순서 (10분)

1. `JayDocs/DESIGN.md` — §0 결론, §2 TSV 포맷 규칙(= 계약), §5 핵심 결정 D1~D7, §6 데이터 모델, §11 Phase 2 범위와 검증 조건(Phase 1 구현 메모 포함), §13 피드백 반영, §14 SagaDocs 구조.
2. `JayDocs/README.md` — 실행·개발 명령, 소스 구조, 그리드 사용법.
3. `JayDocs/REPORT-unity-importer-saga.md` — **"먼저 알아야 할 것 (요약)" 네 줄만.** 나머지는 참고용(게임 쪽 임포터 사정). JayDocs 계약과 무관하다.
4. `SagaDocs/README.md`, `SagaDocs/00-Overview/용어집.md` — 실제 데이터와 규칙.

## 3. 환경 준비

```bash
# JayTools
git pull
cd JayDocs
npm install          # node_modules 와 dist 는 커밋하지 않는다
npm run build        # dist/ 생성
npm test             # 51개 — SagaDocs 실제 파일 왕복 포함 (리포를 못 찾으면 그 항목만 건너뜀)
```

- `JayTools/.claude/launch.json` 과 `JayDocs/.claude/launch.json` 의 `--root` 를 이 PC의 SagaDocs 경로로 바꾼다 (preview 도구는 **JayTools 루트의** launch.json 을 읽는다). 지금은 `C:\Users\user\SagaDocs` 로 되어 있다.
- 확인: `npm run serve` 후 `http://127.0.0.1:5190/#token=dev` 를 열어 트리·편집·저장이 되는지. 또는 `start.cmd "<SagaDocs 경로>"`.
- Node 22+, git 필요. 설치 시점 버전: Vite 8, TypeScript 7, flexlayout-react 0.11, CodeMirror 6.43, @tanstack/react-virtual 3.14.

## 4. 핵심 사실 (memory 에 저장할 것)

- Jay는 1인 개발. 한국어. 커밋·push는 Jay가 말할 때만. 권고는 하나로 강하게, 되돌릴 수 있는 건 정하고 알리고, 질문은 끝에 모아서.
- 기획 원본은 **git(SagaDocs)**. Notion·Asana·Sheets는 더 이상 원본이 아니다.
- **게임(Project-SAGA)은 SagaDocs TSV를 직접 읽지 않는다.** SAGA의 `/design` 세션이 읽고 게임 형식으로 옮겨 쓴다. 복사·서브모듈·링크 없음. → JayDocs 포맷은 DESIGN §2 그대로가 계약.
- 지킬 것: Key는 파일 안에서 유일, `_Field` 시트는 빈 줄로 블록 구분·첫 줄이 블록 이름(SAGA 비교 도구 기준).
- Google Sheets export TSV는 **CRLF**다. SagaDocs 리포는 `.gitattributes`로 **LF 정규화**. JayDocs는 파일별 EOL·BOM·끝 개행을 감지해 보존한다(DESIGN §6.1). 왕복 테스트는 CRLF 입력과 LF 입력 둘 다 통과.
- v1 마크다운은 소스 + 미리보기(하이브리드는 Phase 3). TSV 그리드는 **자체 제작**(DOM + 행 가상화, 라이브러리 아님 — 이유는 DESIGN §3.3/D3). 입력은 항상 떠 있는 textarea 하나가 받고 한글 조합이 그 안에서 시작된다.
- 다른 세션에 보낼 프롬프트는 작게(질문 3~5개). 이전에 10항목 조사 프롬프트가 과한 작업을 만들었다.
- Claude Code 의 Bash 도구는 명령 문자열의 백슬래시를 한 단계 벗긴다 → `sed`/`node -e` 로 `\\` 가 든 치환은 조용히 실패한다. 백슬래시가 든 편집은 Edit 도구로.

## 5. 다음 작업 — Phase 2 (DESIGN §11)

목표: 미리보기 · git · 결합(읽기).

1. **PreviewPane** — react-markdown(+remark-gfm) + mermaid 동적 로드. 페인 모드 소스/미리보기/분할. 스토어 텍스트가 바뀌면 미리보기가 따라온다.
2. **`tsv-view` 블록** (DESIGN §7) — YAML 본문 파서, `file`/`columns`/`where`/`sort`, 읽기 전용 표. 행 클릭 → 그리드 탭 열기. 그리드에서 값을 바꾸면 미리보기도 따라온다 (스토어 `fieldFiles()` 처럼 열린 TsvDoc 을 우선 쓴다).
3. **git** (D5) — 사이드카에 `/api/git/status|diff|commit|log|show|restore` (CLI 위임). 트리·탭 상태 배지. HEAD diff: md 는 `@codemirror/merge`, tsv 는 Key 매칭 셀 diff(자작 50줄). 커밋 패널, 파일 히스토리, 특정 버전 열기, 복원.
4. 사이드카에 `rename`/`delete` API (Phase 0 에서 미룸).
5. **검증**: 기획 md(`SagaDocs/10-World/Tile/Tile.md`) 안에서 Tile_Table 표가 보이고, 그리드에서 값을 바꾸면 미리보기가 따라온다. 커밋 → 로그 → 이전 버전 열기 → 복원.

범위 통제: `tsv-view` 그 자리에서 편집·`bake`·Mermaid 템플릿·하이브리드 Live Preview·범위 선택·채우기 핸들·찾기/바꾸기·열 드래그 재정렬은 Phase 3.

## 6. 알려진 상태·주의

- SagaDocs TSV 7개는 **끝 개행이 없다**. 그래서 행을 덧붙이면 git diff 가 마지막 줄까지 2줄로 나온다(`\ No newline at end of file`). 그리드 상태줄의 **끝 개행 추가** 버튼으로 파일당 한 번 넣어 두면 그 뒤로는 1줄 diff. `.editorconfig` 도 `insert_final_newline = true` 다. 7개를 한 번에 정리하는 커밋은 Jay 가 정한다.
- 그리드 범위 선택은 없다(Phase 3). 복사는 활성 셀 하나, 붙여넣기는 블록. 행 복사는 툴바의 복제.
- enum 열에 Field 블록이 없으면(예: District `AllowedTerrain`) **열에 이미 있는 값**을 후보로 보여 주고 검증은 하지 않는다. 툴팁에 "(열에 있는 값)" 으로 표시.
- `Building_Table` 의 열 설명은 다른 폴더의 `District_Field.tsv` 안 `BuildingDef` 블록에서 온다(리포 전체의 `_Field` 를 훑는다). 열린 Field 문서는 저장 전 편집 내용이 바로 스키마에 반영된다.
- 한글 IME 는 composition 이벤트를 흉내 낸 자동 테스트로 확인했다. **실제 키보드로 한 번 더** 쳐 보는 것이 좋다(브라우저 자동화는 IME 를 거치지 않는다).
- 새 파일/새 폴더는 `window.prompt`. 이름 바꾸기·삭제 API 없음(Phase 2).
- 번들 943 KB(gz 304 KB) — flexlayout 몫이 큼. 나중에 줄일 여지.
- 레이아웃·열 너비는 `localStorage`에 root 경로별 저장. 경로가 다른 PC에서는 새 레이아웃으로 시작한다.
- Phase 0에서 설계와 달라진 점: WebSocket 대신 SSE, chokidar 대신 `fs.watch`. Phase 1 구현 메모는 DESIGN §11.
