# JayDocs 인수인계 (2026-10-11, Phase 3 완료 시점)

다른 PC의 **새 세션**에 아래 프롬프트를 그대로 붙여 넣으면 된다. 이 문서 자체가 그 세션이 처음 읽을 문서다.

---

## 새 세션용 프롬프트

```
JayTools 리포의 JayDocs 를 이어서 개발한다. 먼저 JayDocs/HANDOFF.md 를 읽고, 거기 적힌 순서로 문서를 읽은 뒤
환경을 준비하고 "다음 작업" 을 시작해 줘. 시작 전에 HANDOFF.md 의 "핵심 사실" 을 memory 에 저장해 둬.
```

---

## 1. 지금 상태

- **JayDocs** (`JayTools/JayDocs/`): Markdown(+Mermaid)과 TSV를 나란히 편집하는 경량 로컬 편집기. **Phase 0·1·2·3 완료·검증 끝.**
  사이드카(`server.mjs`, 의존성 0, git CLI 위임) + Vite/React 18 SPA.
  - 탭·분할(flexlayout-react) · 파일 트리(배지, 오른쪽 클릭 이름 바꾸기/삭제) · 저장 · 외부 변경 감지/충돌 배너 · 레이아웃 복원.
  - 마크다운: CodeMirror 6 소스 + react-markdown 미리보기(소스/분할/미리보기), mermaid 동적 로드, `tsv-view` 펜스로 TSV 표 임베드(필터·정렬·열 선택, 행 클릭 → 그리드).
  - TSV: 자체 그리드 — 바이트 왕복 보존, 타입 행 + `_Field` 스키마(툴팁·enum·bool·검증·Key 중복), 한글 IME, Sheets 붙여넣기, undo/redo, 행/열 조작.
  - git: 상태 배지, HEAD diff(md 는 merge view, tsv 는 Key 셀 diff), 선택 커밋, 파일 기록, 이전 버전 보기/문서에 넣기, `git restore`.
  - Phase 3(DESIGN §11, §7): tsv-view 그 자리 편집 · `bake: true`(저장 시 파이프 표) · `render: mermaid` 템플릿(Mustache 부분집합) · 하이브리드 Live Preview(`components/hybrid.ts`, CM6 StateField 자체 구현) · 그리드 찾기/바꾸기 · 채우기 핸들 · 열 드래그.
  - 키보드·테마(DESIGN §16): 명령 팔레트 `Ctrl+Shift+P` · 빠른 열기 `Ctrl+P` · 탭/패널 키 · 트리 키보드 탐색 · 그리드 범위 선택과 Sheets 식 복사/붙여넣기/채우기 · md 여러 선택 표시 · 다크 모드. 단축키 원본은 `src/lib/shortcuts-table.mjs`, `npm run shortcuts` → `SHORTCUTS.md`(테스트가 동기화를 검사).
- **SagaDocs** (별도 리포, 이 PC는 `C:\Users\user\SagaDocs`, 원래 PC는 `C:\Users\gaber\Documents\GitHub\SagaDocs`): 기획 원본. TSV 7개(LF · BOM 없음 · 끝 개행 있음 — cbfa1ad 에서 넣음). 원격 `github.com/krKooHoo/SagaDocs`.
- 커밋·푸시 여부: 이 문서가 포함된 커밋의 로그를 본다. Phase 1 은 `b4c7597` 로 커밋·push 됨. Phase 2 와 피드백 반영은 Jay 지시 전이라 **커밋하지 않았을 수 있다** — `git status` 로 확인.

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
npm test             # 67개 — SagaDocs 실제 파일 왕복 포함 (리포를 못 찾으면 그 항목만 건너뜀)
```

- `JayTools/.claude/launch.json` 과 `JayDocs/.claude/launch.json` 의 `--root` 를 이 PC의 SagaDocs 경로로 바꾼다 (preview 도구는 **JayTools 루트의** launch.json 을 읽는다). 지금은 `C:\Users\user\SagaDocs` 로 되어 있다.
- 확인: `npm run serve` 후 `http://127.0.0.1:5190/#token=dev` 를 열어 트리·편집·저장·git 패널이 되는지. 또는 `start.cmd "<SagaDocs 경로>"`.
- **커밋 같은 git 쓰기 기능을 시험할 때는 SagaDocs 가 아니라 임시 리포**(`git archive HEAD | tar -x` 로 복사 → `git init`)에 사이드카를 하나 더 띄운다(`node server.mjs --root <임시> --port 5195 --token dev --dev --keep`). Phase 2 검증을 그렇게 했다.
- Node 22+, git 필요. 설치 시점 버전: Vite 8, TypeScript 7, flexlayout-react 0.11, CodeMirror 6.43, @codemirror/merge 6.12, react-markdown 10, remark-gfm 4, mermaid 12. (@tanstack/react-virtual 은 뺐다 — 숨은 탭에서 마운트된 그리드가 보인 뒤에도 행을 안 그리는 일이 있어 고정 높이 윈도잉을 직접 계산한다.)

## 4. 핵심 사실 (memory 에 저장할 것)

- Jay는 1인 개발. 한국어. 커밋·push는 Jay가 말할 때만. 권고는 하나로 강하게, 되돌릴 수 있는 건 정하고 알리고, 질문은 끝에 모아서.
- 기획 원본은 **git(SagaDocs)**. Notion·Asana·Sheets는 더 이상 원본이 아니다.
- **게임(Project-SAGA)은 SagaDocs TSV를 직접 읽지 않는다.** SAGA의 `/design` 세션이 읽고 게임 형식으로 옮겨 쓴다. 복사·서브모듈·링크 없음. → JayDocs 포맷은 DESIGN §2 그대로가 계약.
- 지킬 것: Key는 파일 안에서 유일, `_Field` 시트는 빈 줄로 블록 구분·첫 줄이 블록 이름(SAGA 비교 도구 기준).
- Google Sheets export TSV는 **CRLF**다. SagaDocs 리포는 `.gitattributes`로 **LF 정규화**. JayDocs는 파일별 EOL·BOM·끝 개행을 감지해 보존한다(DESIGN §6.1). 왕복 테스트는 CRLF 입력과 LF 입력 둘 다 통과.
- v1 마크다운은 소스 + 미리보기(하이브리드는 Phase 3). TSV 그리드는 **자체 제작**(DOM + 행 가상화, 라이브러리 아님 — 이유는 DESIGN §3.3/D3). 입력은 항상 떠 있는 textarea 하나가 받고 한글 조합이 그 안에서 시작된다.
- 다른 세션에 보낼 프롬프트는 작게(질문 3~5개). 이전에 10항목 조사 프롬프트가 과한 작업을 만들었다.
- Jay 의 사용 기준(2026-10-11 피드백): **가볍고, git 으로 바로 커밋되는 것**이 핵심 가치. 모든 작업이 키보드로 되어야 하고, 단축키는 Sheets·Excel 관행을 따르며 `SHORTCUTS.md` 에 계속 쌓는다(한 곳 `shortcuts-table.mjs` 에서 생성). 새 기능을 넣을 때 단축키 표와 팔레트 명령을 같이 넣을 것.
- Claude Code 의 Bash 도구는 명령 문자열의 백슬래시를 한 단계 벗긴다 → `sed`/`node -e`/heredoc 으로 `\\` 가 든 치환은 조용히 실패하고, CSS 처럼 따옴표·백슬래시가 섞인 heredoc 은 깨진다. 그런 편집은 Edit/Write 도구로.
- 사이드카처럼 **자체 완결적인 조각은 Opus 에이전트에 맡겨도 된다**(Phase 2 의 git API 가 그 예 — 계약을 표로 적어 주면 잘 한다). 공유 파일을 여러 에이전트가 동시에 고치는 구조는 피한다.

## 5. 다음 작업 — 사용 피드백 반영 + 남은 숙제

Phase 0~3 의 계획 범위는 끝났다. **`TESTCASES.md`(101개 TC)** 를 Jay 가 돌려 ❌/⚠ 가 나온 것부터 고친다. 그 다음은 실제로 써 보고 주는 피드백 (단축키 조합 정리를 넘겨 주기로 했다 — `src/lib/shortcuts-table.mjs` 만 고치면 앱·SHORTCUTS.md·F1 이 같이 바뀐다).

남은 숙제:
1. ~~수식~~ — (b) 안으로 구현했다: `X_Calc.tsv` 의 규칙을 F9 로 값 열에 써 넣는다(`lib/calc/`). 남은 것: 식 자동완성, Calc 파일 전용 편집 UI(지금은 보통 그리드).
2. **하이브리드 다듬기 2차** — 제목 크기 단계, 코드 펜스(일반 언어) 꾸밈, 각주, 표 안 편집. 지금은 표식 숨김 · 목록/인용 · 할 일 체크박스 · 이미지 · GFM 표/펜스 블록 위젯까지.
3. 번들 1.2 MB(gz 390 KB) — flexlayout·react-markdown·CM 몫. 필요하면 mermaid 처럼 react-markdown 도 지연 로드.
4. `npm audit` 가 mermaid 의존성 경고를 낸다(로컬 도구라 보류).

이번 라운드(Phase 3 뒤)에 끝낸 것: 계산식(`X_Calc.tsv`, DESIGN §17), 이미지 미리보기(`/api/raw`, 미리보기·하이브리드), git push/pull 버튼(upstream·ahead/behind 는 `status --branch` 의 `# branch.ab`), 하이브리드의 GFM 표 위젯·이미지·할 일 체크박스.


## 6. 알려진 상태·주의

- 하이브리드 모드는 한글 조합 중(input.type.compose) 장식을 다시 계산하지 않는다. 실제 키보드로 한글을 쳐서 조합이 안 깨지는지 한 번 확인할 것(자동화로는 조합을 못 흉내 낸다).
- bake 는 md 저장 때만 돈다. TSV 만 고치고 md 를 저장하지 않으면 baked 표는 그대로다(미리보기는 살아 있는 표를 보여 준다). tsv-view 의 `file` 을 못 읽으면 배너로 알리고 그 펜스는 건너뛴다.
- 계산식은 **F9/계산 버튼을 눌러야** 표에 써진다(자동 아님). Calc 파일이 있는 표는 식이 걸린 셀에 파란 띠, 바뀔 셀은 노란 배경. lookup 대상 표는 스토어 `auxTable` 로 읽어 둔다.
- 전역 단축키는 버블 단계 keydown 으로 처리한다 — 에디터·그리드가 먼저 `preventDefault` 한 키는 건드리지 않는다. 글자 키 단독 단축키는 두지 않는다(입력 중 충돌). 브라우저 예약 조합(Ctrl+W/T/N/Tab/숫자)은 페이지가 못 받는다.
- 자동화 테스트에서 패널 포커스 명령 뒤 바로 키를 보내면 포커스 이동(한 프레임)보다 앞설 수 있다. 사람 속도에서는 문제 없다.
- enum 열에 Field 블록이 없으면(예: District `AllowedTerrain`) **열에 이미 있는 값**을 후보로 보여 주고 검증은 하지 않는다. 툴팁에 "(열에 있는 값)" 으로 표시.
- `Building_Table` 의 열 설명은 다른 폴더의 `District_Field.tsv` 안 `BuildingDef` 블록에서 온다(리포 전체의 `_Field` 를 훑는다). 열린 Field 문서는 저장 전 편집 내용이 바로 스키마에 반영된다.
- 한글 IME 는 composition 이벤트를 흉내 낸 자동 테스트로 확인했다. 실제 키보드로도 한 번 쳐 보는 것이 좋다(브라우저 자동화는 IME 를 거치지 않는다).
- git: `commit --only -- <paths>` 라 머지 중에는 부분 커밋이 안 된다(git 의 제한). 되돌리기는 HEAD 에 있는 파일만. ROOT 가 리포의 하위 폴더여도 동작한다. 리포가 아니면 패널이 "git 리포가 아닙니다".
- 새 파일/새 폴더/이름 바꾸기는 `window.prompt`. 저장 전 문서는 이름 바꾸기·삭제를 거부한다.
- 레이아웃·열 너비·md 보기 모드는 `localStorage`에 root 경로별 저장. 경로가 다른 PC에서는 새 레이아웃으로 시작한다. Phase 1 레이아웃에는 git 패널이 없으므로 로드할 때 덧붙인다.
- 자동화 테스트에서 flexlayout 의 숨은 탭은 높이 0 이라 그리드 행이 안 그려진다 → 보이는 창만 고르고, 탭을 바꾼 뒤 행이 그려질 때까지 기다릴 것.
- Phase 0에서 설계와 달라진 점: WebSocket 대신 SSE, chokidar 대신 `fs.watch`. Phase 1·2 구현 메모는 DESIGN §11.
