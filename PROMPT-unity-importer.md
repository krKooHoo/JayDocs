# Unity TSV 임포터 규칙 조사 프롬프트

아래 블록을 **TSV를 읽는 클래스가 있는 Unity 프로젝트**에서 Claude에게 그대로 붙여 넣으면 된다.
결과(마크다운)를 JayDocs 세션에 돌려주면 §2 포맷 계약을 확정한다.

---

```
이 프로젝트에는 게임 데이터 TSV(탭 구분 텍스트)를 읽어 C# 객체로 만드는 클래스가 있다.
외부 도구(JayDocs)가 그 TSV를 편집할 예정이라, 임포터가 "무엇을 허용하고 무엇을 깨뜨리는지"를 정확히 알아야 한다.
코드를 읽고 아래 10개 항목을 사실 그대로 보고해 달라. 추측이면 "추측"이라고 표시하고, 근거가 되는 코드 위치(파일:줄)를 항목마다 적어 달라.
아무것도 수정하지 말 것.

조사 대상 예시 파일(Google Sheets export, 1행 = 타입 행, 2행 = 헤더, 3행~ = 데이터):

#string	string	enum	enum	bool	bool	string	byte	byte
Key	DisplayName	TerrainType	SurfaceType	Buildable	Passable	VisualKey	MovementCost	FoodCost
Plains-Grass	Plains	Plains	Grass	TRUE	TRUE	Plains-Grass	1	1
Ocean-Ocean	Ocean	Ocean	Ocean	FALSE	FALSE	Ocean-Ocean	255	255

다른 파일에는 이런 열도 있다:
#string	string			enum	enum	uint	uint	uint	byte	string
Key	DisplayName	#한글명	# 설명	AllowedTerrain	AllowedSurface	ConstructionCost	ConstructionTime	MaintenanceCost	BuildingLimit	VisualKey
Stronghold	Stronghold	영지	플레이어의 본거지	Plains, Hill	Grass, Desert, Snow, Forest	1000	1000	0	10	Stronghold
(Building 테이블에는 RequiredMaterials = "Cow[20], Wood[30]", Trait = "Trait명[Key:Value]" 같은 셀도 있다.)

보고할 항목:

1. 진입점 — TSV를 읽는 클래스·메서드 목록(파일 경로). 어떤 테이블(Tile/District/Building/Resources/Road 등)을 읽는지. 런타임에 읽는지, 에디터에서 ScriptableObject 등으로 변환해 두는지.

2. 파일 찾기 — 파일을 이름으로 찾는지(정확한 이름? 패턴? "MacroWorld - " 접두가 필요한지), 어느 폴더에서 읽는지(Resources / StreamingAssets / Addressables / 임의 경로), 확장자(.tsv / .txt / .csv).
   → "MacroWorld - Tile_Table.tsv"를 "Tile_Table.tsv"로, "Buidling_Table.tsv"를 "Building_Table.tsv"로 바꾸면 깨지는지.

3. 행 처리 — 1행(첫 셀이 '#'로 시작하는 타입 행)을 어떻게 하는지: 건너뛰는지, 타입으로 쓰는지, '#'로 시작하는 모든 행을 주석으로 보는지. 헤더 행 번호. 빈 줄·파일 끝 개행을 어떻게 하는지. 데이터 행 중간의 빈 행.

4. 열 처리 — 열을 헤더 이름으로 찾는지, 순서(인덱스)로 찾는지. 헤더가 '#'로 시작하는 열('#한글명', '# 설명')과 타입 행이 빈 열을 건너뛰는지. 모르는 열이 있으면 무시인지 오류인지. 있어야 할 열이 없으면 어떻게 되는지. 열 순서를 바꿔도 되는지.

5. 값 파싱 —
   - bool: 받아들이는 표기 전부(TRUE/FALSE, true/false, 1/0, 빈칸). 대소문자.
   - 정수/실수(byte, uint, float): 파싱 함수와 culture(소수점 '.' 고정인지), 빈 셀일 때 기본값, 범위 초과 시 동작.
   - enum: C# enum 이름과 문자열 일치 규칙(대소문자, 공백), 모르는 값일 때 동작.
   - 리스트: 구분자가 ", "인지 ","인지, 앞뒤 공백 trim 여부, 빈 리스트 표기.
   - "Cow[20], Wood[30]"과 "Trait명[Key:Value]" 형식을 파싱하는 코드가 있으면 그 문법 정의(정규식 등).
   - string: 빈 셀을 null로 보는지 ""로 보는지. 셀 안 '"' 처리(따옴표를 해석하는지, 그대로 두는지). 셀 안 탭·줄바꿈이 들어오면 어떻게 되는지.

6. 인코딩·줄바꿈 — UTF-8 BOM 유무를 처리하는지, CRLF와 LF를 모두 받는지(Split 기준 문자열).

7. 검증 — Key 중복, 다른 테이블 참조(District의 Key를 Building의 DistrictKey가 가리킴 등), enum 허용값 검사를 임포트 시점에 하는지. 실패하면 로그만 남기는지 예외인지.

8. 데이터 모델 — Tile/District/Building/Resources(있는 것만)의 C# 클래스 이름과 필드 목록(이름, 타입). 헤더 이름과 필드 이름이 정확히 같은지, 매핑 표가 따로 있는지.

9. 코드 생성 — 타입 행이나 Field 시트로부터 C# 클래스를 자동 생성하는 도구가 있는지.

10. 외부 동기화 — TSV가 지금 어떻게 프로젝트에 들어오는지(수동 복사 / 스크립트 / 서브모듈 / 심볼릭 링크). 다른 리포(SagaDocs)에 원본을 두고 가져오려면 어느 방식이 이 프로젝트에 맞는지 의견.

출력 형식: 항목별로 "결론 한 줄 → 근거(파일:줄) → 관련 코드 10줄 이내 발췌". 마지막에 "임포터가 통과시키는 최소 유효 파일" 예시를 TSV로 하나 적어 달라.
```
