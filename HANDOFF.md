# JayDocs 인수인계 (2026-10-11, Phase 2 완료 시점)

다른 PC의 **새 세션**에 아래 프롬프트를 그대로 붙여 넣으면 된다. 이 문서 자체가 그 세션이 처음 읽을 문서다.

---

## 새 세션용 프롬프트

```
JayTools 리포의 JayDocs 를 이어서 개발한다. 먼저 JayDocs/HANDOFF.md 를 읽고, 거기 적힌 순서로 문서를 읽은 뒤
환경을 준비하고 Phase 3 을 시작해 줘. 시작 전에 HANDOFF.md 의 "핵심 사실" 을 memory 에 저장해 둬.
```

---

## 1. 지금 상태

- **JayDocs** (`JayTools/JayDocs/`): Markdown(+Mermaid)과 TSV를 나란히 편집하는 경량 로컬 편집기. **Phase 0·1·2 완료·검증 끝.**
  사이드카(`server.mjs`, 의존성 0, git CLI 위임) + Vite/React 18 SPA.
  - 탭·분할(flexlayout-react) · 파일 트리(배지, 오른쪽 클릭 이름 바꾸기/삭제) · 저장 · 외부 변경 감지/충돌 배너 · 레이아웃 복원.
  - 마크다운: CodeMirror 6 소스 + react-markdown 미리보기(소스/분할/미리보기), mermaid 동적 로드, `tsv-view` 펜스로 TSV 표 임베드(필터·정렬·열 선택, 행 클릭 → 그리드).
  - TSV: 자체 그리드 — 바이트 왕복 보존, 타입 행 + `_Field` 스키마(툴팁·enum·bool·검증·Key 중복), 한글 IME, Sheets 붙여넣기, undo/redo, 행/열 조작.
  - git: 상태 배지, HEAD diff(md 는 merge view, tsv 는 Key 셀 diff), 선택 커밋, 파일 기록, 이전 버전 보기/문서에 넣기, `git restore`.
- **SagaDocs** (별도 리포, 이 PC는 `C:\Users\user\SagaDocs`, 원래 PC는 `C:\Users\gaber\Documents\GitHub\SagaDocs`): 기획 원본. TSV 7개(LF · BOM 없음 · 끝 개행 있음 — cbfa1ad 에서 넣음). 원격 `github.com/krKooHoo/SagaDocs`.
- 커밋·푸시 여부: 이 문서가 포함된 커밋의 로그를 본다. Phase 1 은 `b4c7597` 로 커밋·push 됨. Phase 2 는 Jay 지시 전이라 **커밋하지 않았을 수 있다** — `git status` 로 확인.

## 2. 읽을 순서 (10분)

1. `JayDocs/DESIGN.md` — §0 결론, §2 TSV 포맷 규칙(= 계약), §5 핵심 결정 D1~D7, §6 데이터 모델, §7 결합 문법(Phase 3 의 bake·Mermaid 템플릿), §11 Phase 1·2 구현 메모와 Phase 3 범위, §13 피드백 반영, §14 SagaDocs 구조.
2. `JayDocs/README.md` — 실행·개발 명령, 소스 구조, 사용법(그리드 · tsv-view · git).
3. `JayDocs/REPORT-unity-importer-saga.md` — **"먼저 알아야 할 것 (요약)" 네 줄만.** 나머지는 참고용(게임 쪽 임포터 사정). JayDocs 계약과 무관하다.
4. `SagaDocs/README.md`, `SagaDocs/00-Overview/용어집.md` — 실제 데이터와 규칙.

## 3. 환경 준비

```bash
# JayTools
git pull
cd JayDocs
npm install          # node_modules 와 dist 는 커밋하지 않는다
npm run build        # dist/ 생성
npm test             # 63개 — SagaDocs 실제 파일 왕복 포함 (리포를 못 찾으면 그 항목만 건너뜀)
```

- `JayTools/.claude/launch.json` 과 `JayDocs/.claude/launch.json` 의 `--root` 를 이 PC의 SagaDocs 경로로 바꾼다 (preview 도구는 **JayTools 루트의** launch.json 을 읽는다). 지금은 `C:\Users\user\SagaDocs` 로 되어 있다.
- 확인: `npm run serve` 후 `http://127.0.0.1:5190/#token=dev` 를 열어 트리·편집·저장·git 패널이 되는지. 또는 `start.cmd "<SagaDocs 경로>"`.
- **커밋 같은 git 쓰기 기능을 시험할 때는 SagaDocs 가 아니라 임시 리포**(`git archive HEAD | tar -x` 로 복사 → `git init`)에 사이드카를 하나 더 띄운다(`node server.mjs --root <임시> --port 5195 --token dev --dev --keep`). Phase 2 검증을 그렇게 했다.
- Node 22+, git 필요. 설치 시점 버전: Vite 8, TypeScript 7, flexlayout-react 0.11, CodeMirror 6.43, @codemirror/merge 6.12, react-markdown 10, remark-gfm 4, mermaid 12, @tanstack/react-virtual 3.14.

## 4. 핵심 사실 (memory 에 저장할 것)

- Jay는 1인 개발. 한국어. 커밋·push는 Jay가 말할 때만. 권고는 하나로 강하게, 되돌릴 수 있는 건 정하고 알리고, 질문은 끝에 모아서.
- 기획 원본은 **git(SagaDocs)**. Notion·Asana·Sheets는 더 이상 원본이 아니다.
- **게임(Project-SAGA)은 SagaDocs TSV를 직접 읽지 않는다.** SAGA의 `/design` 세션이 읽고 게임 형식으로 옮겨 쓴다. 복사·서브모듈·링크 없음. → JayDocs 포맷은 DESIGN §2 그대로가 계약.
- 지킬 것: Key는 파일 안에서 유일, `_Field` 시트는 빈 줄로 블록 구분·첫 줄이 블록 이름(SAGA 비교 도구 기준).
- Google Sheets export TSV는 **CRLF**다. SagaDocs 리포는 `.gitattributes`로 **LF 정규화**. JayDocs는 파일별 EOL·BOM·끝 개행을 감지해 보존한다(DESIGN §6.1). 왕복 테스트는 CRLF 입력과 LF 입력 둘 다 통과.
- v1 마크다운은 소스 + 미리보기(하이브리드는 Phase 3). TSV 그리드는 **자체 제작**(DOM + 행 가상화, 라이브러리 아님 — 이유는 DESIGN §3.3/D3). 입력은 항상 떠 있는 textarea 하나가 받고 한글 조합이 그 안에서 시작된다.
- 다른 세션에 보낼 프롬프트는 작게(질문 3~5개). 이전에 10항목 조사 프롬프트가 과한 작업을 만들었다.
- Claude Code 의 Bash 도구는 명령 문자열의 백슬래시를 한 단계 벗긴다 → `sed`/`node -e`/heredoc 으로 `\\` 가 든 치환은 조용히 실패하고, CSS 처럼 따옴표·백슬래시가 섞인 heredoc 은 깨진다. 그런 편집은 Edit/Write 도구로.
- 사이드카처럼 **자체 완결적인 조각은 Opus 에이전트에 맡겨도 된다**(Phase 2 의 git API 가 그 예 — 계약을 표로 적어 주면 잘 한다). 공유 파일을 여러 에이전트가 동시에 고치는 구조는 피한다.

## 5. 다음 작업 — Phase 3 (DESIGN §11, §7)

목표: 결합 심화.

1. **`tsv-view` 그 자리 편집** — 미리보기 표의 셀을 더블클릭해 고치면 같은 `TsvDoc` 에 `store.editTable` 로 반영(필터로 숨은 행은 건드리지 않는다). 그리드의 셀 편집기(textarea + IME 가드)를 재사용할 것.
2. **`bake: true`** — 저장 시 펜스 바로 아래 `<!-- tsv-view:baked -->` … `<!-- /tsv-view -->` 사이에 파이프 표를 다시 생성(DESIGN §7.1). 저장 경로에서 md 텍스트를 가공하므로 `store.save` 앞단에 훅을 둔다. 기본값 꺼짐.
3. **Mermaid 템플릿** (`render: mermaid`, `template: |`) — Mustache 수준(`{{col}}`, `{{#each}}`, `{{#if}}`, `.list`)만 자체 구현(100줄 안팎), `mermaid.parse` 로 검증 후 렌더, 실패하면 생성 텍스트와 오류를 그대로 보여 준다(DESIGN §7.2).
4. **하이브리드 Live Preview** — `@atomic-editor/editor` 평가 후 채택 또는 CM6 decoration 자체 구현. 활성 줄은 raw, 나머지는 렌더. `view.composing` 동안 decoration 갱신 보류.
5. **그리드**: 범위 선택(Shift+방향키/드래그) + 범위 복사·붙여넣기·지우기, 채우기 핸들, 찾기/바꾸기, 열 드래그 재정렬.
6. **검증**: Tile.md 의 tsv-view 에서 셀을 고치면 그리드·파일에 반영. bake 켠 문서를 GitHub 에서 보면 진짜 표. 템플릿으로 Building → District 흐름도가 그려진다. 한글 입력이 하이브리드 모드에서도 안 깨진다.

작은 것들(남은 숙제): 번들 1.16 MB(gz 372 KB) — flexlayout·react-markdown 몫. `Ctrl+P` 빠른 열기(DESIGN §8). 이미지(`_assets/`) 미리보기 — 사이드카가 지금은 `.md/.tsv` 만 서빙한다. `npm audit` 가 mermaid 쪽 의존성 경고를 낸다(로컬 도구라 보류).

## 6. 알려진 상태·주의

- 그리드 범위 선택은 없다(Phase 3). 복사는 활성 셀 하나, 붙여넣기는 블록. 행 복사는 툴바의 복제.
- enum 열에 Field 블록이 없으면(예: District `AllowedTerrain`) **열에 이미 있는 값**을 후보로 보여 주고 검증은 하지 않는다. 툴팁에 "(열에 있는 값)" 으로 표시.
- `Building_Table` 의 열 설명은 다른 폴더의 `District_Field.tsv` 안 `BuildingDef` 블록에서 온다(리포 전체의 `_Field` 를 훑는다). 열린 Field 문서는 저장 전 편집 내용이 바로 스키마에 반영된다.
- 한글 IME 는 composition 이벤트를 흉내 낸 자동 테스트로 확인했다. 실제 키보드로도 한 번 쳐 보는 것이 좋다(브라우저 자동화는 IME 를 거치지 않는다).
- git: `commit --only -- <paths>` 라 머지 중에는 부분 커밋이 안 된다(git 의 제한). 되돌리기는 HEAD 에 있는 파일만. ROOT 가 리포의 하위 폴더여도 동작한다. 리포가 아니면 패널이 "git 리포가 아닙니다".
- 새 파일/새 폴더/이름 바꾸기는 `window.prompt`. 저장 전 문서는 이름 바꾸기·삭제를 거부한다.
- 레이아웃·열 너비·md 보기 모드는 `localStorage`에 root 경로별 저장. 경로가 다른 PC에서는 새 레이아웃으로 시작한다. Phase 1 레이아웃에는 git 패널이 없으므로 로드할 때 덧붙인다.
- 자동화 테스트에서 flexlayout 의 숨은 탭은 높이 0 이라 그리드 행이 안 그려진다 → 보이는 창만 고르고, 탭을 바꾼 뒤 행이 그려질 때까지 기다릴 것.
- Phase 0에서 설계와 달라진 점: WebSocket 대신 SSE, chokidar 대신 `fs.watch`. Phase 1·2 구현 메모는 DESIGN §11.
