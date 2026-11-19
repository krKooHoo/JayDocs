# JayDocs 훑어보기 — 개발 계획

작성 2026-11-19 · 상태 **Phase A 완료(2026-11-19) · B~E 남음** · 확정된 결과는 구현 뒤 DESIGN 의 새 절로 옮긴다. 이 문서는 계획 · 결정 과정과 단계별 완료 메모로 남긴다.

---

## 0. 결론

**훑어보기 = 문서를 열지 않고(또는 편집하면서) 렌더된 모습을 축소해 보는 것.** Mac 의 훑어보기 · 미리보기 썸네일에서 온 생각이다.
렌더러 하나(`DocView`)를 만들고 다섯 곳에서 쓴다.

| 쓰는 곳 | 무엇 | 여는 법 |
|---|---|---|
| **새 문서 창** | 형식별 템플릿을 썸네일로 보고 골라 이름을 넣어 만든다 | `Ctrl+Alt+N` (지금의 새 파일을 바꾼다) |
| **훑어보기 패널** | md · txt 편집 중 오른쪽에 문서 전체를 축소해 띄운다. 누르면 그 자리로 커서 | `Ctrl+Alt+M` |
| **훑어보기 창** | 트리에서 파일을 열지 않고 크게 본다. `↑` `↓` 로 다음 파일 | 트리에서 `Space` |
| **폴더 훑어보기** | 폴더의 문서를 썸네일 격자로 본다 | 트리에서 폴더에 `Space` |
| **내 템플릿** | `_templates/` 폴더의 파일이 새 문서 창에 뜬다 | 폴더에 파일을 넣는다 |

쪽 나눔 · 인쇄 · PDF 는 하지 않는다(Jay, 2026-11-19 — 이 앱의 문서는 인쇄를 생각하고 만든 것이 아니다). 오른쪽 패널은 웹 페이지처럼 이어진 한 장을 스크롤한다.

어림 규모: **약 5 작업일** (Phase A~E). 재 본 값이 아니라 어림이다.

---

## 1. 지금 구조에서 걸리는 곳

| 곳 | 지금 | 바뀌어야 할 것 |
|---|---|---|
| `App.tsx` `newFile` | `askText` 로 경로 하나를 묻고 빈 파일을 만든다 | 새 문서 창(overlay `newDoc`)으로 바꾼다. 경로 검사(`names.ts`)와 만든 뒤 포커스는 그대로 쓴다 |
| `PreviewPane.tsx` 의 `components` | `Mermaid` · `TsvView` · 그림 · 링크 처리가 `PreviewPane` 안에서 만들어진다 | `DocView` 와 같이 쓰게 밖으로 뺀다 |
| 미리보기와 원문 줄 | 렌더된 조각이 원문 몇 번째 줄인지 모른다 | 최상위 조각에 원문 줄 번호를 찍는다(SK5) |
| `stripBaked` | 미리보기는 baked 표를 걷어 낸 글을 그린다 → 그린 글의 줄 번호가 원문과 어긋난다 | 걷어 낸 글의 줄 → 원문 줄 지도를 같이 돌려준다 |
| `MarkdownPane.tsx` `.md-body` | 편집기 + (분할 · 미리보기 모드면) 미리보기 | 오른쪽에 패널 띠를 붙인다. 편집기 스크롤을 구독한다 |
| `Workbench.tsx` | 문서 창(탭 묶음)이 몇 개인지 창 안에서 알 길이 없다 | 문서 창 수를 context 로 알려 준다 |
| `FileTree.tsx` `onKeyDown` | `Space` 를 쓰지 않는다 | `Space` = 훑어보기 창 열기 · 닫기 |
| 표 렌더 | 그리드는 입력 · 가상화용이라 썸네일로 못 쓴다 | 앞쪽 행만 그리는 정적 `<table>` (`lib/tsv/table.ts` 로 읽는다) |
| 안 연 파일 읽기 | 스토어의 `retain` 이 유일한 길(탭 · tsv-view 용) | 썸네일은 `backend().read` 로 직접 읽고 따로 캐시한다(SK4) |
| `filetypes.mjs` | 형식 표 | 템플릿 표가 이 표를 따른다 — 형식마다 빈 문서 · 예시가 있는지 테스트로 검사 |
| `shortcuts-table.mjs` | `Ctrl+Alt+N` = 새 파일 | 설명을 고치고 `Ctrl+Alt+M` · 트리 `Space` 를 넣는다 |

새 의존성은 없다.

---

## 2. 핵심 결정

### SK1. 그림으로 굽지 않는다 — 실제 DOM 을 CSS 로 축소

A4 너비(794px)의 상자에 문서를 그리고 `transform: scale()` 로 줄인다. 글자가 선명하고 기존 렌더러 · 테마 · Mermaid 캐시를 그대로 쓴다.
기각: 캔버스 · 이미지로 굽기 — 라이브러리가 필요하고 한글 글꼴 · Mermaid SVG 에서 깨지기 쉽다.

### SK2. 렌더러 하나 `DocView`, 두 가지 무게

- 형식별: `md` 는 react-markdown(미리보기와 같은 컴포넌트), `table` 은 정적 표(앞 60행, 열은 틀에서 잘린다), `text` 는 평문(JSON 도 색 없이 — 축소하면 색이 안 보인다).
- **rich** (새 문서 창 · 훑어보기 창 · 패널): Mermaid 와 tsv-view 를 실제로 그린다.
- **light** (폴더 훑어보기 격자): Mermaid 는 "다이어그램" 상자, tsv-view 는 파일 이름 상자로 대신한다. 파일 수십 개가 표 · 그림을 한꺼번에 불러오지 않게.
- 썸네일은 `inert` — 안의 링크 · 칸이 포커스나 클릭을 받지 않는다.

### SK3. 틀 썸네일과 맞춤 확대

- 틀 썸네일(`DocThumb`)은 세로 A4 비율(1 : 1.414)이고 문서 앞부분만 보인다. 쪽 나눔이 아니라 틀 모양이다.
- 내용이 틀보다 짧으면 키워서 채운다. 상한 **3배**. 배율은 `min(3, √(틀 높이 ÷ 내용 높이))` 로 잡고 한 번 다시 재서 맞춘다(글은 너비가 줄면 높이가 늘어난다).
- 훑어보기 패널에는 확대가 없다(틀이 없다).

### SK4. 읽기와 캐시

- 열려 있는 문서는 스토어의 내용을 그린다(저장 전 편집이 보인다). 안 연 파일은 `backend().read` 로 읽는다 — 스토어에 올리지 않는다.
- 캐시는 경로 + 수정 시각(`Backend.stat`)으로, 최근 200개.
- UTF-8 이 아닌 파일도 읽어서 보여 준다(쓰지 않으니 안전하다). 바이너리 · 5 MB 초과는 카드에 이유를 적는다.

### SK5. 원문 줄 연결 — 통째로 그리고 줄 번호만 찍는다

- rehype 플러그인 하나가 최상위 조각마다 `data-line`(원문 시작 줄)을 찍는다. txt 는 줄마다 한 조각.
- 문서는 지금 미리보기처럼 통째로 그린다. 블록별로 나눠 따로 그리면 바뀐 블록만 다시 그릴 수 있지만 참조 링크 · 각주가 블록을 넘어가면 깨진다. 느린 것이 재서 확인되면 그때 한다.
- 화면 밖 조각은 `content-visibility: auto` 로 브라우저가 건너뛴다.

### SK6. 훑어보기 패널의 자리 — 문서 창 안 오른쪽 띠

- flexlayout 의 오른쪽 가장자리 패널이 아니라 `MarkdownPane` 안에 둔다. 저장된 레이아웃을 옮길 필요가 없고 편집기(`EditorView`)를 바로 쓴다.
- 대상은 `.md` · `.txt` (Jay 요청 범위. `.json` 은 뺀다).
- **문서 창이 하나일 때만** 보인다. 탭은 여러 개여도 된다. 분할하면 숨고 하나로 돌아오면 다시 나온다. 켬 · 끔은 앱 전체에 하나, 너비(기본 180px)는 끌어서 바꾸고 둘 다 localStorage 에 남긴다.
- 문서 전체를 A4 너비로 그려 패널 너비에 맞게 줄인 긴 한 장. 패널 안에서 스크롤한다.

### SK7. 패널과 편집기의 연결

- **클릭** → 그 조각의 원문 줄로 커서를 옮기고 편집기를 그 줄로 스크롤, 포커스는 편집기.
- **범위 상자** — 편집기가 지금 보여 주는 줄 범위를 패널에 상자로 그린다. 편집기를 스크롤하면 패널이 따라온다. 위치는 줄 → 조각 지도로 계산한다(원문 높이와 렌더 높이는 비례하지 않는다).
- **범위 상자 끌기** → 편집기 스크롤(VS Code 미니맵과 같다).
- 커서가 있는 조각 옆에 얇은 선.
- 미리보기 전용 모드는 편집기가 숨겨져 있으니 클릭 · 상자가 미리보기의 스크롤을 따른다.

### SK8. 새 문서 창

- 세 줄: **빈 문서**(형식마다 하나) · **예시**(형식마다 하나, 렌더된 썸네일 + 한 줄 설명) · **내 템플릿**(`_templates/`, 있을 때만).
- 이름 칸은 처음부터 포커스를 받는다. 처음 선택은 "빈 마크다운" → `Ctrl+Alt+N` · 이름 · `Enter` 는 지금과 같다.
- `↑` `↓` 로 템플릿을 옮긴다(이름 칸은 한 줄이라 이 키가 비어 있다). 카드 클릭도 같다. 확장자는 고른 템플릿을 따라 칸 뒤에 고정으로 보인다.
- 이름 끝에 지원 확장자를 직접 치면(`메모.txt`) 그 형식의 빈 문서로 선택이 옮겨 간다 — 지금 습관 그대로.
- 하위 폴더 경로(`a/b`) · 이름 검사 · 겹침 거부 · 읽기 전용 폴더 알림은 지금 것을 쓴다.

### SK9. 템플릿 표 — `src/lib/templates.ts` 한 곳

- 항목: `id` · `ext` · `group`(빈 문서 / 예시) · `title` · `desc` · `body`. 내용 초안은 §3.
- 새 파일은 LF · 끝 개행 · BOM 없음. **CSV 예시만 BOM** 을 붙인다(Excel 이 한글을 바로 읽게 — UTF-8 로 바꿔 저장할 때의 규칙과 같은 이유).
- TSV 는 DESIGN §2 계약(1행 타입 행, 2행 머리글, Key 유일)을 지킨다.

### SK10. 내 템플릿 — 주 폴더의 `_templates/`

- 그 폴더 바로 아래의 지원 형식 파일이 새 문서 창에 뜬다. 제목은 파일 이름, 썸네일은 실제 내용.
- 만들 때 내용을 그대로 옮긴다(EOL · BOM 까지가 목표 — §5 에서 확인). UTF-8 이 아닌 파일은 목록에서 뺀다.
- 팔레트 명령 **"현재 문서를 템플릿으로 저장"** — `_templates/` 에 복사한다.
- 가져온 폴더(`@별칭`)의 `_templates/` 는 보지 않는다.

### SK11. 훑어보기 창 — 트리에서 `Space`

- 트리 커서의 파일을 트리 옆에 크게(rich) 띄운다. **포커스는 트리에 남는다** → `↑` `↓` 는 트리 키 그대로이고 창이 커서를 따라 바뀐다.
- `Space` · `Esc` 로 닫는다. `Enter` 는 지금처럼 파일을 열고 창을 닫는다. `PageUp` `PageDown` 은 창 안을 스크롤한다(트리가 안 쓰는 키).
- 모달이 아니라서 전역 단축키를 막지 않는다.

### SK12. 폴더 훑어보기

- 트리 커서가 폴더일 때 `Space` → 같은 창에 그 폴더 바로 아래 문서의 썸네일 격자(light). 하위 폴더는 폴더 카드.
- 보이는 카드만 읽고 그린다(IntersectionObserver), 한 번에 4개까지 읽는다.
- `Tab` 으로 격자에 들어가 방향키로 고르고 `Enter` 로 연다. `Esc` 는 트리로 돌아간다.
- 팔레트 명령 "폴더 훑어보기" 는 트리에서 마지막으로 고른 폴더로 연다.

### SK13. 그 밖

- 종이 색은 앱 테마를 따른다.
- 단축키: `Ctrl+Alt+M` 훑어보기 패널 켜기 · 끄기(`toggleSkim`). 지금 표와 겹치지 않는다. Edge 앱에서 실제로 오는지는 §5.
- 기각: 쪽 나눔 · 인쇄 · PDF(Jay), 표(TSV · CSV)용 오른쪽 패널(그리드는 이어 읽는 글이 아니다), 파일 검색(`Ctrl+P`) 옆 미리보기(써 보고 필요하면).

---

## 3. 템플릿 초안

예시는 "그 형식이 이 앱에서 어떻게 보이는지"를 한눈에 보여 주는 것이 목적이다. 카드 설명(`desc`)은 썸네일 아래에 뜬다.

### 빈 문서

| 형식 | 내용 |
|---|---|
| `.md` · `.txt` | 0바이트 |
| `.json` | `{}` + 끝 개행 |
| `.tsv` | §5 확인 뒤 — 0바이트를 그리드가 잘 열면 0바이트, 아니면 가장 작은 표(`#string` / `Key`) |
| `.csv` | 위와 같이 — 0바이트 또는 머리글 한 줄 |

### 예시 — 마크다운 (`.md`)

desc: 제목 · 목록 · 표 · 그림이 있는 글. 보기 모드로 소스와 렌더를 오간다.

````markdown
# 문서 제목

마크다운 문서다. 위의 보기 모드에서 소스 · 하이브리드 · 분할 · 미리보기를 고른다.

## 글

**굵게**, *기울임*, `코드`, [링크](https://example.com)

- 목록
- [ ] 할 일
- [x] 끝낸 일

> 인용

## 표

| 이름 | 값 |
|---|---|
| 가 | 1 |
| 나 | 2 |

## 그림

```mermaid
graph LR
  기획 --> 제작 --> 검수
```

## 표 파일 연결

`tsv-view` 코드 블록에 `file: 표.tsv` 를 적으면 표 파일의 내용이 이 자리에 보인다.
````

### 예시 — TSV 표 (`.tsv`)

desc: 타입이 있는 표. 1행은 타입, 2행은 머리글, Key 는 파일 안에서 유일하다.

칸 사이는 탭이다. 타입이 빈 마지막 열은 주석 열.

```
#string	string	enum	bool	uint	float	
Key	DisplayName	Category	Enabled	Count	Rate	#메모
Apple	사과	Fruit	TRUE	10	0.5	1행은 타입, 2행은 머리글
Carrot	당근	Vegetable	TRUE	4	1.25	Key 는 파일 안에서 유일
Salt	소금	Etc	FALSE	0	0	머리글이 # 로 시작하면 주석 열
```

### 예시 — CSV 표 (`.csv`)

desc: Excel 과 주고받는 표. 첫 줄이 머리글이다.

```
이름,분류,수량,메모
사과,과일,10,"쉼표, 줄바꿈이 든 칸은 따옴표로 감싼다"
당근,채소,4,
소금,기타,0,Alt+Enter 로 칸 안에서 줄을 바꾼다
```

### 예시 — 텍스트 (`.txt`)

desc: 꾸밈 없는 글. 쓴 그대로 저장된다.

```
메모

꾸밈 없는 글이다. 쓴 그대로 저장된다.
- 줄바꿈과 띄어쓰기가 그대로 남는다.
- 제목 · 표 · 그림이 필요하면 마크다운(.md)으로 만든다.
```

### 예시 — JSON (`.json`)

desc: 설정 · 데이터. 문법을 검사하고 "정렬"로 들여쓰기를 맞춘다.

```json
{
  "name": "예시",
  "version": 1,
  "enabled": true,
  "tags": ["a", "b"],
  "size": { "width": 1920, "height": 1080 }
}
```

후보(지금은 안 넣는다): `X_Table` + `X_Field` + `X_Calc` 를 한 번에 만드는 표 묶음 — 파일 여러 개를 만드는 템플릿은 창의 흐름이 달라진다.

---

## 4. 단계

단계마다 단축키 표 · 팔레트 명령 · `TESTCASES.md` 절을 같이 넣고, 배포할 때 `PATCHNOTES.md` 를 쓴다.

### Phase A — 공통 코어 (어림 1일)

- `DocView`(md · table · text, rich / light) — `PreviewPane` 의 컴포넌트를 밖으로 빼서 같이 쓴다.
- `DocThumb`(A4 틀 · 축소 · 맞춤 확대). 배율 계산은 순수 함수 + 테스트.
- 줄 번호 찍기(rehype) + `stripBaked` 줄 지도 + 테스트.
- 읽기 · 캐시(`lib/skim/` — 경로 + 수정 시각).
- 끝난 모습: `?opfs` 에서 샘플 문서 전부가 썸네일로 뜬다(확인용 임시 화면).

#### Phase A 완료 메모 (2026-11-19)

`npm test` 341 통과 · 2 skip(SagaDocs), `npm run build` 성공, `npm run lint` 는 새 버그성 경고 없음(새 경고는 `lib/skim/reader*.ts` 의 `no-useless-spread` 4건 — 도는 중에 바뀌는 집합을 복사해 도는 것으로, 스토어와 같은 쓰임이다).
내장 브라우저 `http://127.0.0.1:5173/?opfs&skimdemo` 에서 확인: 샘플 10개(md 3 · tsv 4 · csv 1 · txt 1 · json 1)가 썸네일로 뜨고, 짧은 문서는 3배로 커지고(`메모.txt` 글자 4.9px → 14.7px, 틀 288px 기준), 긴 문서는 앞부분만 보인다. 라이트 · 다크 둘 다 봤다. 기존 미리보기(분할 · 미리보기 모드, Mermaid, tsv-view 칸 편집)는 전과 같다 — 미리보기 DOM 에 `data-line` 이나 새 상자가 생기지 않는다.

**만든 · 고친 파일**

| 파일 | 내용 |
|---|---|
| `src/components/DocView.tsx` (새) | `DocView` · `DocFileView` · `DocThumb` · `DocNote` |
| `src/components/PreviewPane.tsx` | `mdComponents(mdPath, weight)` 를 밖으로 뺐다. `PreviewPane` 은 그것을 부른다 |
| `src/lib/md/bake.ts` | `stripBakedWithLines` 추가 (`stripBaked` 는 그대로) |
| `src/lib/md/sourceLines.ts` (새) | `rehypeSourceLines` · `sourceLineOf` · `LINE_ATTR` |
| `src/lib/skim/fit.ts` (새) | 배율 계산(순수 함수) |
| `src/lib/skim/head.ts` (새) | `normalizeText` · `headText` |
| `src/lib/skim/reader.ts` (새) | `SkimReader` — 경로 + 수정 시각 캐시 |
| `src/lib/skim/index.ts` (새) | `skimReader()` · `openDocText()` · `useSkimText()` + 위 셋을 다시 내보낸다 |
| `src/styles.css` | `.doc-view` · `.doc-text` · `.doc-table` · `.doc-stub` · `.doc-note` · `.doc-thumb*` |
| `src/components/SkimDemo.tsx` · `SkimDemo.css` (새, **임시**) | 확인용 화면. `App.tsx` 가 개발 빌드의 `?skimdemo` 에서만 불러온다 |
| `src/App.tsx` | 임시 화면 연결 두 곳(`SkimDemo` 상수, `App` 의 한 줄) |
| `src/lib/fsa/devSeed.ts` | 샘플에 `docs/목록.csv` 추가 |
| 테스트 (새) | `lib/md/sourceLines.test.ts` · `lib/skim/{fit,head,reader}.test.ts`, `lib/md/bake.test.ts` 에 줄 지도 5건 |

**공개 모양**

```ts
// components/DocView.tsx
type DocWeight = 'rich' | 'light'          // rich: Mermaid · tsv-view 를 실제로 · light: 상자("다이어그램", "⊞ 파일 이름")

interface DocViewProps {
  path: string        // 앱 경로. 확장자로 형식을 정하고 md 의 상대 링크 · 그림 · tsv-view 의 기준. 실제 파일이 아니어도 된다(템플릿)
  text: string        // 그릴 글. BOM · CRLF 가 있어도 된다
  weight?: DocWeight  // 기본 'rich'
  lines?: boolean     // data-line(원문 줄, 1부터)을 찍는다 — md 는 최상위 조각, txt · json 은 줄마다. 표에는 없다
  maxLines?: number   // 앞 N줄만 (md · 평문). md 는 펜스 한가운데에서 자르지 않는다
  className?: string
}
const DocView: React.MemoExoticComponent<(p: DocViewProps) => JSX.Element>

type DocFileViewProps = Omit<DocViewProps, 'text'>
function DocFileView(p: DocFileViewProps): JSX.Element   // 경로를 읽어(useSkimText) 그린다. 읽는 중 · 못 읽으면 DocNote

interface DocThumbProps {
  path: string
  text?: string       // 주면 파일을 읽지 않고 이 글을 그린다(템플릿). 없으면 path 를 읽는다
  weight?: DocWeight  // 기본 'rich'
  maxLines?: number   // 기본 THUMB_MAX_LINES(200)
  className?: string
}
function DocThumb(p: DocThumbProps): JSX.Element          // 너비는 부모를 채운다(100%), 높이는 aspect-ratio 1 : 1.414

function DocNote(p: { kind?: 'info' | 'error'; children: ReactNode; className?: string }): JSX.Element
const TABLE_MAX_ROWS = 60, TABLE_MAX_COLS = 40, THUMB_MAX_LINES = 200

// components/PreviewPane.tsx
type MdWeight = 'rich' | 'light'
function mdComponents(mdPath: string, weight?: MdWeight): Components   // react-markdown 의 components. useMemo 로 잡아 쓴다

// lib/skim (index.ts)
interface SkimText {
  status: 'loading' | 'ready' | 'error'
  text: string | null               // 'ready' 일 때만. BOM · CRLF 가 남아 있을 수 있다
  error: string | null              // 'error' 일 때 이유
  source: 'store' | 'disk' | null   // store = 열려 있는 문서(저장 전 편집 포함)
  encoding: string | null           // 'disk' 일 때 디스크 인코딩
}
function useSkimText(path: string | null): SkimText     // null 이면 읽지 않는다
function openDocText(path: string): string | null       // 열려 있는 문서의 지금 내용. 아니면 null
function skimReader(): SkimReader                       // 앱 전체가 같이 쓰는 캐시 (backend 가 바뀌면 새로 만든다)

class SkimReader {
  constructor(io: SkimIo, opts?: { max?: number; concurrency?: number })   // 기본 200개 · 한 번에 4개
  peek(path: string): SkimFile | undefined         // 캐시만 본다
  load(path: string): Promise<SkimFile>            // stat → 수정 시각이 같으면 캐시, 다르면 다시 읽는다. 거부하지 않는다
  subscribe(path: string, l: () => void): () => void
  clear(path?: string): void
  readonly size: number
}
type SkimFile = { ok: true; text: string; mtime: number; encoding: string } | { ok: false; error: string; mtime: number | null }

// lib/skim/fit.ts
const PAGE_WIDTH = 794, PAGE_RATIO = 1.414, PAGE_HEIGHT = 1123, MAX_ZOOM = 3
function firstZoom(contentHeight: number, pageHeight?: number, max?: number): number
function refineZoom(contentHeight: number, zoom: number, heightAtZoom: number, pageHeight?: number, max?: number): number
function thumbLayout(frameWidth: number, zoom?: number, pageWidth?: number): { width: number; scale: number }

// lib/skim/head.ts
function normalizeText(raw: string): string                                   // BOM 떼고 LF 로. 줄 번호는 편집기와 같다
function headText(text: string, maxLines: number, kind?: 'md' | 'text'): string

// lib/md/bake.ts
function stripBakedWithLines(text: string): { text: string; lines: number[] }  // lines[i] = 걷어 낸 글 (i+1)번째 줄의 원문 줄

// lib/md/sourceLines.ts
const LINE_ATTR = 'data-line'
function rehypeSourceLines(options?: { lines?: readonly number[] | null }): (tree) => void
function sourceLineOf(el: Element | null, within?: Element | null): number | null   // 클릭한 요소에서 위로 올라가며 줄 번호를 읽는다
```

**계획과 달라진 점**

- **다시 재는 식(SK3)**: 처음 배율은 계획대로 `min(3, √(틀 ÷ 내용))`. 다시 잴 때는 두 번 잰 높이로 "좁히면 얼마나 길어지는가"(높이 ∝ 배율^k)를 구해 `(틀 ÷ 내용)^(1 ÷ (k+1))` 로 맞춘다. 재는 횟수는 계획과 같다(한 번 더). 이유: 표 · 짧은 줄은 좁혀도 높이가 그대로라, 넓이가 유지된다고 보는 식으로는 틀의 75% 쯤만 찼다(`Item_Field.tsv`). 바꾼 뒤 96%.
- **`DocFileView` · `DocNote` 를 더했다**: `DocView` 는 글을 받는 순수 렌더러로 두고, "읽을 수 없는 파일의 이유 상자"는 읽는 쪽(`DocFileView` · `DocThumb`)이 그린다. `DocView` 자체는 모르는 확장자일 때만 상자를 낸다.
- **`maxLines`**: 썸네일이 긴 문서를 통째로 그리지 않게 앞 200줄만 그린다(틀에 보이는 것은 60줄 안쪽). 계획에는 없던 것. 잘린 뒤쪽의 참조 링크 정의 · 각주는 썸네일에 반영되지 않는다.
- **`mdComponents` 는 `PreviewPane.tsx` 안에 그대로 둔다**(새 파일로 옮기지 않았다): `Mermaid` · `TsvView` 가 거기 있고 `hybrid.ts` 가 거기서 가져다 쓴다. 옮기면 400줄이 움직인다.
- **줄 번호를 잃는 조각을 감싼다**: HTML 블록과 Mermaid · tsv-view 펜스는 `lines` 를 켰을 때만 `<div data-line>` 으로 감싼다(§5 넷째 항목). 끄면 DOM 이 미리보기와 같다.
- **표의 `data-line` 은 없다**: 패널 대상이 md · txt 라서(SK6). CSV 는 레코드가 여러 줄일 수 있어 행 = 줄도 아니다.
- **임시 화면의 CSS 는 `SkimDemo.css`** 로 뗐다(그 화면만 불러온다). `styles.css` 에 두면 배포 CSS 에 들어간다. 빌드 뒤 `dist` 에 `skimdemo` · `skim-demo` · `SkimDemo` 가 없는 것을 확인했다.
- **CRLF**: `stripBaked` 는 CRLF 글에서 `\r` 을 남긴다(원래 동작, 앱의 편집기 글은 늘 LF 라 드러나지 않았다). 디스크에서 읽은 글은 CRLF 일 수 있어 `DocView` 가 먼저 `normalizeText` 로 맞춘다. `stripBaked` 는 건드리지 않았다.

**다음 단계가 알아야 할 것**

- **B (새 문서 창)**: 템플릿 썸네일은 `<DocThumb path={'예시' + ext} text={body} />` — `path` 는 형식만 정하면 된다. 썸네일 안은 `inert` 라 클릭 · 포커스는 `DocThumb` 을 감싼 요소가 받는다. `_templates/` 의 파일은 `<DocThumb path={경로} />`. 못 읽은 파일은 틀 안에 이유가 뜬다. UTF-8 인지는 `useSkimText(path).encoding` 또는 `backend().read(path).encoding`.
- **C (패널)**: `DocThumb` 이 아니라 `DocView` 를 직접 쓴다 — `PAGE_WIDTH`(794px) 상자에 `<DocView path text lines />` 를 넣고 `transform: scale(패널 너비 ÷ 794)`, `transform-origin: 0 0`. transform 은 자리를 줄이지 않으므로 바깥 상자에 `높이 = 내용 높이 × scale` 을 직접 준다(`DocThumb` 의 `fit` 참고). 글은 `useSkimText(path)` (열린 문서라 `source: 'store'`, 글자를 칠 때마다 바뀐다 → 디바운스는 패널이 한다. `PreviewPane` 은 150ms). 클릭한 곳의 줄은 `sourceLineOf(e.target, 패널)`. `data-line` 이 없는 조각(각주 묶음, 조각 사이 빈 곳)이 있으니 줄 → 조각은 "그 줄 이하에서 가장 큰 `data-line`". txt 는 줄마다 `<div data-line>` 이라 수천 줄이면 DOM 이 그만큼 생긴다 — SK5 의 `content-visibility: auto` 는 여기서 넣는다(Phase A 에는 넣지 않았다: 높이를 어림값으로 만들어 `DocThumb` 의 재기를 틀리게 한다. 패널 쪽 선택자에만 건다).
- **D (훑어보기 창)**: `<DocFileView path weight="rich" />` 를 스크롤 상자에 넣으면 된다. 안의 링크 · tsv-view 는 살아 있다(누르면 열리고, 칸을 고칠 수 있다) — 막으려면 `inert` 를 건다.
- **E (폴더 격자)**: `<DocThumb path weight="light" />`. 읽기는 이미 한 번에 4개로 줄을 선다(`SkimReader` 의 `concurrency`). "보이는 카드만"(IntersectionObserver)은 격자가 한다 — 안 보이는 카드는 `DocThumb` 을 그리지 않으면 읽지도 않는다. 표는 60행만 그리지만 **읽고 파싱하는 것은 파일 전체**다. 큰 표가 많은 폴더에서 느리면 여기를 본다.
- `DocThumb` 은 틀 너비가 0 이면(숨은 탭 · `display: none`) 맞추지 않고, 보이게 되면 `ResizeObserver` 로 맞춘다. 내용 높이가 뒤늦게 바뀌어도(Mermaid · 그림 · tsv-view) 다시 맞춘다.
- `rich` 의 tsv-view 는 그 표를 스토어에 올린다(`store.retain`). 썸네일 수십 개에는 `light` 를 쓴다.
- 캐시는 `backend()` 의 변경 알림을 **구독 중인 경로만** 다시 확인한다. 나머지는 다음에 볼 때 수정 시각으로 걸러진다.
- 임시 화면을 지울 때: `SkimDemo.tsx` · `SkimDemo.css` · `App.tsx` 의 `SkimDemo` 두 곳. `lazy` · `Suspense` import 도 같이.

**확인하지 못한 것**

- 실제 폴더(File System Access)에서의 읽기 · 변경 알림 — OPFS 로만 봤다.
- 큰 파일 · 파일 수백 개에서의 속도. 재지 않았다.
- `mdComponents` 의 `light` 분기와 줄 번호 상자는 브라우저로만 봤다(자동 테스트 없음 — `PreviewPane.tsx` 는 불러올 때 `document` 를 써서 vitest 의 node 환경에서 못 불러온다).
- 그림이 든 md 의 썸네일(샘플에 그림이 없다).

### Phase B — 새 문서 창 · 템플릿 (어림 1일)

- `templates.ts`(§3) + 형식 표와 맞는지 테스트 · TSV 예시가 §2 계약대로 읽히는지 테스트.
- `NewDocDialog` — `newFile` 을 바꾼다. 빈 화면 안내의 "새 파일" 도 같은 창.
- `_templates/` 읽기 · "현재 문서를 템플릿으로 저장".

#### Phase B 완료 메모 (2026-11-19)

`npm test` 356 통과 · 2 skip(SagaDocs), `npm run build` 성공, `npm run lint` 는 새 파일(`templates.ts` · `NewDocDialog.tsx` · `App.tsx`)에 경고 없음(`store/documents.ts` 의 `no-useless-spread` 는 원래 있던 것이 줄 번호만 밀렸다).
내장 브라우저 `http://127.0.0.1:5174/?opfs` 에서 확인: 다섯 형식의 빈 문서 · 예시 10개를 만들어 디스크 바이트가 템플릿 글과 같은 것(CSV 예시만 `ef bb bf` 로 시작), 예시 TSV 가 그리드에 "오류 없음", 빈 TSV 는 `3행 × 2열`(타입 행 · `Key` · 빈 행), 빈 CSV 는 `2행 × 3열` 로 바로 입력할 칸이 있는 것, `↑` `↓` 이동 · 확장자 직접 입력 · 틀린 이름 · 겹치는 이름(대소문자만 달라도) · `Esc` · `Ctrl+Alt+N` 다시 누르면 닫힘 · 떠 있는 동안 `Ctrl+S` · `Ctrl+Shift+P` 막힘, 트리 ＋파일 · 오른쪽 클릭 "＋ 새 파일" · 빈 화면 "새 파일" 이 같은 창을 여는 것(트리에서 고른 폴더가 `docs/새 문서` 로 들어가고 `새 문서` 만 선택), `_templates/` 카드와 만들기(BOM · CRLF 파일이 바이트 그대로), "현재 문서를 템플릿으로 저장"(md · csv), 라이트 · 다크. 스크린샷은 공유 메모 폴더의 `phaseB-*.jpg`.

**만든 · 고친 파일**

| 파일 | 내용 |
|---|---|
| `src/lib/templates.ts` (새) | 템플릿 표 `TEMPLATES` · `blankTemplateFor` · 이름 칸 → 경로(`typedExt` · `newDocPath` · `stripTypedExt`) · 내 템플릿(`TEMPLATES_DIR` · `userTemplatePaths` · `fileNameOf`) |
| `src/lib/templates.test.ts` (새) | 15건 — 형식마다 blank · sample, LF · 끝 개행 · BOM, 빈 표 = 그리드 버튼과 같은 표, TSV 예시 §2 계약 · 검증 오류 0, CSV 왕복, JSON 문법, 경로 계산, `_templates/` 목록 |
| `src/components/NewDocDialog.tsx` · `.css` (새) | 새 문서 창 |
| `src/App.tsx` | overlay `newDoc`(+ `OVERLAY_COMMAND`), `newFile` → 창 열기, `createDoc`, `saveAsTemplate` + 팔레트 명령, 창 그리기. `DOC_EXTS_LABEL` import 를 뺐다(쓰는 곳이 없어졌다) |
| `src/store/documents.ts` | `store.fileText(path)` — 저장하면 써질 글(BOM · 줄바꿈 · 저장 전 편집 포함). 템플릿으로 저장이 쓴다 |
| `src/lib/shortcuts-table.mjs` · `SHORTCUTS.md` | `Ctrl+Alt+N` 설명, "새 문서 창" 묶음(`↑ / ↓` · `Enter` · `Esc` · 다시 누르면 닫기)을 "대화상자 · 알림" 바로 뒤에 |

**계획과 달라진 점**

- **TSV 예시의 enum 열 이름 `Category` → `FoodGroup`**: enum 후보는 같은 루트의 모든 `_Field` 파일에서 열 이름과 같은 블록을 찾는다(`schema.ts` `findBlock`). 개발 샘플 `Item_Field.tsv` 에 `Category` 블록이 있어 예시를 만들자 그리드가 "오류 3"(Fruit · Vegetable · Etc 는 허용되지 않은 값)을 냈다. 게임 데이터 폴더에서 흔히 겹칠 이름이라 바꿨다. 테스트가 `Category` · `Type` 블록이 있어도 오류 0 인지 본다.
- **빈 표의 내용**(§5 첫 항목의 결정): 그리드 버튼과 같은 함수(`seedTypedTable` · `seedHeaderTable`)로 만들고 끝 개행만 붙였다 — TSV `#string⇥string` / `Key⇥` / `⇥` (3행 × 2열), CSV `,,` / `,,` (2행 × 3열, BOM 없음).
- **이름 칸에 폴더가 들어 있다**: 칸의 값은 `docs/새 문서` 이고 `새 문서` 만 선택된다(지금의 `docs/새 문서.md` 에서 확장자만 칸 뒤 고정 글자로 뺐다). 폴더 부분을 지우거나 바꿔 다른 곳에 만들 수 있는 지금 동작을 그대로 두려는 것. 칸 위에 "트리에서 고른 폴더: docs" 를 적는다.
- **확장자를 직접 쳤을 때**: 고른 템플릿과 형식이 다를 때만 빈 문서로 옮긴다. 예시 TSV 를 고른 채 `표.tsv` 를 치면 예시 TSV 그대로다(빈 TSV 로 옮기면 고른 것을 잃는다). 확장자를 친 동안은 칸 뒤의 고정 확장자를 숨긴다. 친 확장자와 다른 형식으로 `↑` `↓` 하면 친 확장자를 떼어 낸다(확장자는 늘 템플릿을 따른다).
- **카드 두 번 누르기 = 만들기**: 계획에 없던 것. 한 번 누르기는 선택만.
- **만든 뒤에는 포커스를 돌려주지 않는다**: 취소(`Esc` · 바깥 클릭 · 취소 버튼)는 부르던 곳(트리 등)으로 돌려준다. 만들었을 때도 돌려주면, 열린 문서가 없을 때의 "트리로"(`focusEditor` 의 60ms 늦은 포커스)가 새 문서의 편집기 포커스보다 늦게 도착해 트리가 포커스를 가져갔다(실제로 봤다). 만든 문서의 편집기가 받는다.
- **선택 · 이름 · 만드는 중을 ref 로도 든다**: 다시 그리기 전에 `↓` 가 여러 번 오면(키 반복) 한 칸만 움직였다(자동화로 봤다). 키 처리는 ref 를 읽는다.
- **내 템플릿에서 읽지 못하는 파일**(바이너리 · 5 MB 초과)도 UTF-8 이 아닌 파일처럼 목록에서 뺀다. 하위 폴더(`_templates/sub/…`)는 보지 않는다. `_Templates` 처럼 대소문자가 달라도 같은 폴더로 본다(Windows). 템플릿으로 저장할 때 폴더가 이미 있으면 그 이름 그대로 쓴다.
- **템플릿으로 저장의 이름**: `/` 를 넣으면 거부한다(바로 아래만 카드로 뜨니까). 이름 검사 · 겹침은 새 파일과 같다(`checkEntryPath`). 쓰는 글은 저장하면 써질 글 그대로(BOM · 줄바꿈 · 저장 전 편집 포함)이고, 원본 문서는 저장되지 않은 채 남는다. 명령은 열린 문서가 있을 때만 켜진다.
- **창 위치**: 다른 창(`.overlay` 의 위 10vh)보다 위(4vh)에서 시작한다 — 카드 줄이 길다. `:has()` 를 썼다(Chromium · Edge 는 된다).

**TC 초안** (번호는 주 세션이 붙인다)

- `Ctrl+Alt+N` → 새 문서 창. 이름 칸에 포커스, `새 문서` 가 선택되어 있고 "빈 마크다운" 카드가 골라져 있다. 이름을 치고 `Enter` → 빈 `.md` 가 생겨 편집기에 포커스가 간다(지금과 같은 결과).
- 트리에서 폴더를 고르고 `Ctrl+Alt+N` (또는 ＋파일, 오른쪽 클릭 "＋ 새 파일", 빈 화면 "새 파일") → 칸이 `그폴더/새 문서` 이고 `새 문서` 만 선택. 칸 위에 "트리에서 고른 폴더: …".
- `↓` 를 누르면 빈 TSV → 빈 CSV → … → 예시 마크다운 → … → 내 템플릿으로 줄을 넘어 옮겨 가고, 칸 뒤의 확장자가 따라 바뀐다. `↑` 는 거꾸로. 처음 · 끝에서 멈춘다.
- 카드를 한 번 누르면 선택만 바뀌고 포커스는 이름 칸에 남는다. 두 번 누르면 그 템플릿으로 만든다.
- 이름 끝에 `.txt` 를 치면 "빈 텍스트" 로 옮겨 가고 칸 뒤의 확장자가 사라진다. 그 상태로 `↓` → 친 `.txt` 가 떨어지고 새 템플릿의 확장자가 붙는다.
- 각 예시로 만들면: 마크다운은 제목 · 목록 · 표 · Mermaid 그림, TSV 는 그리드에 "오류 없음"(5행 × 7열), CSV 는 그리드 4행 × 4열이고 파일이 BOM 으로 시작, 텍스트 · JSON 은 편집기.
- 빈 TSV 로 만들면 그리드에 타입 행 · `Key` 행 · 빈 행(3행 × 2열)이 있어 바로 입력할 수 있다. 빈 CSV 는 빈 머리글 행 + 빈 행(2행 × 3열). 빈 JSON 은 `{}`.
- 이미 있는 이름(대소문자만 달라도) → 창이 닫히지 않고 칸 아래에 "이미 있는 이름입니다: …". 빈 이름 · 쓸 수 없는 글자 · `docs/` 처럼 `/` 로 끝나는 이름도 칸 아래에 이유.
- 읽기 전용으로 가져온 폴더를 고르고 `Ctrl+Alt+N` → 창이 뜨지 않고 알림 줄에 이유(지금과 같다).
- 창이 떠 있을 때 `Ctrl+S` · `Ctrl+Shift+P` 는 아무것도 하지 않고, `Ctrl+Alt+N` 은 창을 닫는다. `Esc` 도 닫고 포커스가 열기 전 자리(트리 등)로 돌아간다.
- 주 폴더에 `_templates/` 를 만들고 `.md` 를 넣으면 새 문서 창에 "내 템플릿" 줄이 생기고 그 파일의 썸네일 · 파일 이름 카드가 뜬다. 골라 만들면 내용이 바이트 그대로(BOM · CRLF 포함) 복사된다. EUC-KR 파일 · `_templates/하위폴더/` 의 파일 · 가져온 폴더의 `_templates/` 는 뜨지 않는다.
- 문서를 고치고(저장하지 않고) 팔레트 → "현재 문서를 템플릿으로 저장…" → 이름 칸에 지금 파일 이름(이름 부분 선택). `Enter` → 알림 줄 "템플릿으로 저장했습니다: _templates/…", 트리에 `_templates/` 가 생긴다. 그 파일에 고친 내용이 들어 있고 원본은 여전히 저장 안 됨(●). 같은 이름으로 다시 하면 "이미 있는 이름입니다", 이름에 `/` 를 넣으면 거부.
- 라이트 · 다크 모두 카드 · 선택 테두리 · 오류 글자가 보인다.

**확인하지 못한 것**

- **한글 조합 중 `Enter` · `↑` `↓`**: 자동화로 실제 IME 를 못 본다. 코드는 `isComposing` · keyCode 229 면 아무것도 하지 않는다(대화상자와 같은 처리).
- 실제 폴더(File System Access)에서 만들기 · `_templates/` — OPFS 로만 봤다.
- 읽기 전용으로 가져온 폴더에서의 알림 — 코드는 그대로(창을 띄우기 전에 `blockedReadOnly`)이지만 브라우저로는 보지 않았다.
- 내장 브라우저 창이 숨겨져 있는 동안은 포커스 이벤트가 오지 않아, 포커스 확인(만든 뒤 편집기 · 그리드로)은 창이 보일 때 실제 키로 본 몇 번이 전부다(빈 md · 열린 문서가 있을 때와 없을 때). 형식마다(그리드 `grid-input` · 텍스트 `cm-content`)는 자동화 키로 봤다.
- 낮은 창(높이 540px 쯤)에서는 예시 카드 한 장이 목록 칸보다 길어 설명 끝이 잘려 보인다. 스크롤은 된다.
- 내 템플릿이 많을 때(수십 개) — 카드마다 `rich` 썸네일을 그린다. 재지 않았다.
- Edge 설치 앱에서 `Ctrl+Alt+N` 은 지금도 쓰던 키라 따로 보지 않았다.

### Phase C — 훑어보기 패널 (어림 1.5일)

- `SkimPanel` — md 먼저, 다음 txt. 문서 창 수 context.
- 클릭 → 커서, 범위 상자, 끌기, 따라 스크롤(SK7).
- 긴 문서에서 타이핑 지연을 잰다. 느리면 디바운스를 늘리고, 그래도 느리면 블록별 렌더(SK5).

#### Phase C 완료 메모 (2026-11-19)

**상태: 구현 · 커밋됨.** 내장 브라우저 `http://127.0.0.1:5175/?opfs` 에서 확인했다("자동 갱신 멈춤"과 `lines` 켠 미리보기의 tsv-view 칸 편집은 두 번째 회차에 확인). 스크린샷은 공유 노트 폴더의 `phaseC-*.jpg` 7장(소스 · 하이브리드 · 분할 · 미리보기 · txt · 라이트 · 자동 갱신 멈춤).

**만든 · 고친 파일**

| 파일 | 내용 |
|---|---|
| `src/components/SkimPanel.tsx` · `SkimPanel.css` (새) | 패널. 축소 · 범위 상자 · 커서 선 · 클릭 · 끌기 · 너비 손잡이 · 자동 갱신 멈춤 |
| `src/lib/skim/lineMap.ts` · `lineMap.test.ts` (새) | 줄 ↔ 위치 지도(순수 함수) + 테스트 29건 |
| `src/lib/skim/panel.ts` (새) | 켬 · 끔 · 너비 · 새로 고침(localStorage `jaydocs.skim.on` · `jaydocs.skim.width`), `isSkimPath` |
| `src/components/docPanes.ts` (새) | `DocPaneCountContext` · `useDocPaneCount` |
| `src/components/Workbench.tsx` | 문서 창 수를 세어 context 로, 명령 `toggleSkim` · `skimWider` · `skimNarrower` · `refreshSkim` |
| `src/components/MarkdownPane.tsx` | 패널 붙이기, 막대의 "훑어보기" 버튼, 편집기 변화를 패널에 알리기 |
| `src/components/PreviewPane.tsx` | `lines` prop (미리보기 전용 모드 + 패널이 보일 때만 `data-line` 을 찍는다) |
| `src/lib/shortcuts-table.mjs` · `SHORTCUTS.md` | "탭 · 패널" 묶음에 두 줄 |

**계획과 달라진 점**

- **기본값은 꺼짐.** 업데이트했을 때 화면이 저절로 바뀌지 않게. 막대의 "훑어보기" 버튼이 늘 보인다.
- **클릭한 줄은 `sourceLineOf` 가 아니라 높이로 찾는다.** 안이 `inert` 라 이벤트의 target 이 조각이 아니다 → `blockLineAtY`(그 높이의 조각, 빈 곳이면 위쪽에서 가장 가까운 조각). 결과는 같다(조각의 시작 줄).
- **범위 상자 · 끌기는 조각 사이를 고르게 나눈다**(줄을 소수로). 긴 펜스 · 목록에서 상자가 뛰지 않는다.
- **미리보기 전용 모드**: 미리보기 DOM 을 바꾸는 쪽을 골랐다 — `PreviewPane` 에 `lines` 를 주면 `rehypeSourceLines` 로 `data-line` 을 찍고 같은 지도 계산을 쓴다. 그 모드에서 패널이 보일 때만 켜진다(그 밖에는 DOM 이 전과 같다). 클릭하면 미리보기가 그 조각으로 스크롤되고(위 12px 여유) 숨은 편집기의 커서도 옮겨 둔다. 켜면 HTML 블록 · Mermaid · tsv-view 가 `<div data-line>` 으로 한 겹 싸인다.
- **패널의 스크롤 막대는 숨겼다**(휠로 굴린다). 좁은 띠에서 자리를 먹는다.
- **패널을 휠로 굴리면 따라오기를 멈추고**, 편집기가 움직이면(스크롤 · 커서 · 입력) 다시 따라온다.
- **자동 갱신 멈춤은 크기가 아니라 잰 시간으로 정한다**: 다시 그리는 데 400ms(처음 그릴 때는 800ms) 넘게 걸리면 멈추고 안내 + "새로 고침"(팔레트 "훑어보기 패널 새로 고침"). 한번 멈춘 문서는 새로 고친 렌더가 200ms 아래로 내려와야 다시 자동으로 돈다(경계의 문서가 켜졌다 꺼졌다 하지 않게). 멈춤은 문서(탭)마다 따로다. 디바운스는 300ms ~ 마지막 렌더 시간의 3배(상한 1500ms).
  - **확인(2026-11-19, 개발 빌드)**: 5,001줄 — 열자마자 멈춤(안내 + 버튼 꺼짐), 15글자를 쳐도 다시 그리지 않고(입력 중앙값 10.7ms · 가장 길게 30ms, 그 뒤 3초 동안 멎은 구간 없음) 안내에 "바뀐 내용이 있습니다"와 버튼이 켜진다. 버튼 · 팔레트 모두 지금 내용으로 다시 그리고 멈춘 채로 남는다. 4,500줄 — 처음 684ms 라 열 때는 자동, 첫 편집의 렌더가 566ms 라 그때 멈춘다. 3,300줄(경계) — 처음 448ms 자동 → 첫 편집 413ms 에 멈춤 → 새로 고침 세 번(431 · 441 · 410ms) 모두 멈춘 채. 2,001줄 — 편집 여섯 번(231 ~ 284ms) 내내 자동, 디바운스 600 ~ 800ms. 멈춘 문서를 200줄로 줄이고 새로 고치면(32ms) 자동으로 돌아온다. 300줄 · `개요.md` 는 다른 탭이 멈춰 있어도 300ms 뒤에 따라온다.
- **켰는데 안 보이는 경우 알림을 띄운다**(분할 중 · md · txt 가 아닌 문서).
- 팔레트 명령 "훑어보기 패널 넓히기 / 좁히기"를 더했다(손잡이에 Tab 으로 가기 어렵다 — 편집기가 Tab 을 쓴다).

**잰 숫자** (이 기계 · 내장 브라우저 · 창이 숨겨진 상태. 문서는 제목 · 문단 · 목록 · 표 · 코드를 섞어 만든 것)

| 문서 | 조각 | 한 글자 입력 (끔 → 켬, 중앙값) | 패널 다시 그리기 (렌더 + 배치) |
|---|---|---|---|
| md 2,001줄 (40 KB) | 483 | 배포 빌드 2.7 → 7.2 ms | 배포 351 + 38 ms · 개발 284 + 17 ms |
| md 5,001줄 (102 KB) | 1,209 | 배포 빌드 3.8 → 10.9 ms | 배포 944 + 76 ms · 개발 702 + 26 ms |
| txt 10,001줄 (511 KB) | 10,001 | 개발 빌드 1.1 → 7.5 ms | 개발 71 + 61 ms |

- 배포 빌드 숫자는 `?opfs` 만 연 임시 빌드에서 쟀다(자동 갱신 멈춤을 넣기 전의 코드). 입력은 `execCommand('insertText')`, 개발 빌드는 `view.dispatch`.
- 입력이 느려지는 몫은 패널 코드가 아니라 **브라우저의 배치 한 번에 드는 시간이 보이는 상자 수에 비례해 늘어서**다 — 패널과 무관한 `<div>` 1만 개를 화면에 두기만 해도 배치 한 번이 0.3 → 3.4 ms 가 됐다. 자동화 브라우저만의 성질인지(접근성 트리 등) 보통 Edge 에서도 같은지는 확인하지 못했다.
- 스크롤 한 번의 패널 처리(프레임을 흉내 내서 잼): md 2천 · 5천 줄 0.1 ms, txt 1만 줄 8 ms(위와 같은 이유). **스크롤 중 프레임 수는 재지 못했다** — 창이 숨겨져 프레임이 돌지 않았다.
- 5천 줄 md 는 다시 그릴 때마다 약 1초 멎는다 → 자동 갱신 멈춤이 필요했다. 2천 줄(약 390ms)은 경계에 있다.
- 같은 문서도 잴 때마다 다르다: 두 번째 회차(개발 빌드)에는 2,001줄이 231 ~ 308ms, 5,001줄이 처음 열 때 2,235ms(그 뒤 새로 고침도 2.3 ~ 2.5초)였다. 다른 세션이 같이 돌던 기계라 부하 탓으로 보이지만 확인하지는 않았다.

**TC 초안**

- md · txt 창 막대에 "훑어보기" 버튼이 있고 json · 표 창에는 없다. 누르거나 `Ctrl+Alt+M` 을 누르면 오른쪽에 패널이 뜨고 버튼이 켜진 모양이 된다. 포커스는 편집기에 남는다.
- 패널에 문서 전체가 축소돼 보인다(Mermaid · tsv-view 포함). 다크 · 라이트를 따른다.
- 분할하면 패널이 숨고, 분할한 창을 닫으면 다시 나온다. 분할 중에 켜면 "문서 창이 하나일 때만 보입니다" 알림이 뜬다.
- 패널의 조각을 누르면 편집기 커서가 그 조각의 첫 줄로 가고 그 줄이 화면 가운데로 온다. 포커스는 편집기. baked 표 뒤의 문단을 눌러도 원문 줄이 맞다.
- 편집기를 스크롤하면 상자가 움직이고, 상자가 패널 밖으로 나가면 패널이 따라온다.
- 상자를 끌면 편집기가 스크롤된다(커서는 그대로). 4px 안쪽으로 움직이면 클릭이다.
- 커서가 든 조각 왼쪽에 얇은 선이 보인다(미리보기 전용 모드에는 없다).
- 글을 고치면 잠시 뒤 패널이 바뀐다(저장 전 내용).
- 소스 · 하이브리드 · 분할 · 미리보기 모드 모두에서 위가 된다. 미리보기 전용 모드에서는 상자가 미리보기의 스크롤을 따르고, 누르면 미리보기가 그 조각으로 간다.
- 패널 왼쪽 가장자리를 끌면 너비가 120 ~ 400px 에서 바뀐다. 손잡이에 포커스를 주고 `←` `→`(Shift 는 크게, Home · End)도 된다. 다시 열어도 너비 · 켬이 남는다.
- 아주 긴 md(이 기계에서는 5천 줄)는 패널 위에 "문서가 커서 자동으로 다시 그리지 않습니다"와 "새로 고침"이 뜬다. 글을 고치면 "바뀐 내용이 있습니다"가 붙고 버튼이 켜진다. 누르거나 팔레트 "훑어보기 패널 새로 고침"을 실행하면 지금 내용으로 바뀐다. 멈춘 동안 타이핑은 멎지 않는다.
- 멈춘 문서의 글을 많이 지우고 새로 고치면 안내가 사라지고 다시 자동으로 따라온다. 다른 탭의 작은 문서는 그와 무관하게 따라온다.
- 미리보기 전용 모드 + 패널에서 tsv-view 칸을 더블클릭해 고치고 Enter 로 확정하면 표 문서가 바뀌고("● 저장 전 내용") 선택이 아래 칸으로 간다. `Ctrl+Z` 로 되돌아간다. 패널 안의 표도 같이 바뀐다.

**합칠 때 겹칠 수 있는 곳**

- `Workbench.tsx`: import 3줄, `countDocPanes`, `paneCount` · `toggleSkim`, 명령 목록 끝 4줄 + deps, `onModelChange` 한 줄, `Layout` 을 Provider 로 감쌈. Phase D 가 같은 명령 목록에 한 줄을 넣었다.
- `shortcuts-table.mjs`: "탭 · 패널" 묶음 끝 두 줄 → 합친 뒤 `npm run shortcuts`.
- `App.tsx` · `commands.ts` · `nav.ts` · `styles.css` · `DocView.tsx` · `sourceLines.ts` 는 건드리지 않았다.

**확인하지 못한 것**

- 자동 갱신 멈춤은 개발 빌드에서만 봤다(배포 빌드에서는 안 봤다). 새로 고침 버튼은 스크립트의 `click()` 으로 눌렀다 — 실제 마우스로 눌렀을 때 포커스가 편집기에 남는지는 안 봤다.
- 스크롤 중 프레임 수, 보통 브라우저에서의 입력 시간(위 표는 숨은 자동화 창에서 잰 것).
- `content-visibility: auto` 가 실제로 화면 밖 조각을 건너뛰는지 — 프레임이 돌지 않아 못 봤다.
- 실제 마우스 휠로 패널 굴리기, 터치, 실제 한글 IME 입력 중의 패널.
- 그림이 든 md, 실제 폴더.
- `lines` 가 켜진 미리보기의 tsv-view 칸 편집은 확인했다(실제 더블클릭 · 입력 · Enter · `Ctrl+Z` · `↑`, 입력 칸이 고른 칸 위에 정확히 겹친다). 그 미리보기의 Mermaid · HTML 블록은 그려지는 것만 봤다.
- 후보: txt 를 줄 묶음(예: 50줄)으로 싸면 보이는 상자 수가 줄어 배치 · 재기가 빨라진다(`DocView` 를 고쳐야 해서 하지 않았다).

### Phase D — 훑어보기 창 (어림 0.5일)

- 트리 `Space` · 커서 따라가기 · 닫기(SK11).

### Phase E — 폴더 훑어보기 (어림 1일)

- 격자 · 지연 읽기 · 키보드(SK12).

A 가 끝나야 나머지가 시작된다. B · C · D 는 서로 기대지 않지만 `App.tsx` · `shortcuts-table.mjs` 를 같이 건드린다. E 는 D 의 창을 쓴다.

---

## 5. 확인하지 못한 것 (구현하며 본다)

- 0바이트 `.tsv` · `.csv` 를 그리드가 어떻게 여는지 → 빈 표 템플릿의 내용.
  - **확인(2026-11-19, Phase A · 내장 브라우저 `?opfs`)**: 오류 없이 열린다. 칸이 하나도 없는 빈 그리드(`0행 × 0열`)가 뜨고, 도구 줄에 TSV 는 **"타입 행·헤더 행 만들기"**, CSV 는 **"머리글 행 만들기"** 버튼이 나온다(`GridPane.tsx` 의 `table.rows.length === 0` 분기 → `seedTypedTable` / `seedHeaderTable`). 그 버튼을 누르기 전에는 입력할 칸이 없다. → 권고: 빈 표 템플릿은 0바이트가 아니라 그 버튼이 만드는 것과 같은 가장 작은 표로 한다(TSV: `#string⇥string` / `Key⇥` / 빈 행, CSV: 빈 머리글 행 + 빈 행, 3열). 정하는 것은 Phase B.
  - **결정(Phase B)**: 권고대로 했다. `templates.ts` 가 그 두 함수로 만들고 끝 개행을 붙인다 — TSV `#string⇥string\nKey⇥\n⇥\n`, CSV `,,\n,,\n`.
- `backend().write` 에 BOM 이 든 글을 넘기면 그대로 써지는지(CSV 예시).
  - **확인(2026-11-19)**: 그대로 써진다. `backend().write('…csv', '﻿이름,값\r\n가,1\r\n', null)` 뒤 OPFS 파일의 바이트가 `ef bb bf …` 로 시작하고 `0d 0a` 로 끝났다. 쓰기는 문자열을 그대로 `createWritable().write()` 에 넘긴다(`fsaBackend.ts` `writeAll`) — 줄바꿈도 바꾸지 않는다.
- `backend().read` 가 BOM · EOL 을 글에 남기는지(`_templates/` 를 바이트 그대로 옮길 수 있는지).
  - **확인(2026-11-19)**: 남긴다. 위 파일을 `backend().read` 로 읽은 글이 쓴 글과 같았다(맨 앞 `U+FEFF`, CRLF 그대로). 디코더가 `ignoreBOM: true` 라 BOM 을 떼지 않는다(`fsaBackend.test.ts` "BOM 과 줄바꿈을 그대로 돌려준다" 도 같은 것을 본다). → UTF-8 파일은 `read` 한 글을 `write` 하면 바이트가 같다. **UTF-8 이 아닌 파일은 안 된다** — EUC-KR 로 풀어 읽은 글이라 다시 쓰면 UTF-8 이 된다(`encoding !== 'utf-8'` 로 가려낸다 — SK10 의 "목록에서 뺀다" 와 맞다).
- react-markdown 의 최상위 조각에 원문 위치가 늘 있는지(HTML 블록 등).
  - **확인(2026-11-19, `sourceLines.test.ts`)**: 늘 있지는 않다. ① 문단 · 제목 · 목록 · 인용 · 표 · 펜스 · 구분선은 엘리먼트이고 위치가 있다. ② **HTML 블록 · 주석**은 rehype 단계에서 엘리먼트가 아니라 `raw` 노드다(위치는 있다). react-markdown 이 뒤에 글자 그대로의 텍스트로 바꾸므로 속성을 붙일 곳이 없다 → 플러그인이 `<div data-line>` 으로 감싼다. ③ **각주 묶음**(`<section data-footnotes>`)은 만들어 낸 조각이라 위치가 없다 → `data-line` 없음. ④ **Mermaid · tsv-view 펜스**는 `<pre>` 없이 그리므로 `<pre>` 에 찍힌 줄 번호가 사라진다 → `mdComponents` 가 줄 번호가 있을 때만 `<div data-line>` 으로 감싼다(미리보기의 DOM 은 그대로). → 줄에서 조각을 찾을 때는 "그 줄 이하에서 가장 큰 `data-line`" 으로 찾는다.
- 긴 md(수천 줄)의 패널 렌더 시간.
  - **확인(2026-11-19, Phase C · 내장 브라우저, 배포 빌드)**: 2,001줄 약 390ms, 5,001줄 약 1,020ms(렌더 + 배치). 그동안 입력이 멎는다 → 400ms 를 넘는 문서는 자동으로 다시 그리지 않고 "새로 고침"을 기다리게 했다. 자세한 것은 §4 "Phase C 완료 메모".
- `Ctrl+Alt+M` 이 Edge 설치 앱에서 페이지까지 오는지.
- 실제 폴더의 수강생 제출물 폴더(파일 수백 개)에서 폴더 훑어보기 속도 — Jay 가 실제 폴더로 본다.
