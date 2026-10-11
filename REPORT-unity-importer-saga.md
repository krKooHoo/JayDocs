# Unity TSV 임포터 규칙 — Project-SAGA 조사 결과

> 조사일 2026-10-11 · 대상 `Project-SAGA`(main) + JayCore `com.koohoo.core` 4.0.1(`../JayCodeCollection`) · CsvHelper **33.0.1**
> 코드는 수정하지 않았다. 판정이 CsvHelper 내부 동작에 기대는 항목은 **같은 설정을 그대로 복제한 콘솔 프로브(net8 + 같은 CsvHelper.dll)로 실제로 돌려** 확인했다 — 표에 「프로브」로 적었다. 추측은 「추측」으로 적었다.

## 먼저 알아야 할 것 (요약)

1. **질문에 나온 Google Sheets 파일(`MacroWorld - Tile_Table.tsv` 등)은 게임이 읽지 않는다.** 그것들은 `Docs/00-jay/`에 기획 원본으로 커밋돼 있을 뿐(커밋 f0eda3699 「웹에 있던 테이블들 임포트」), 코드 어디에도 그 이름이 없다.
2. 게임이 읽는 표는 `Assets/StreamingAssets/Table/<소문자_이름>.tsv` 18개이고 **형식 · 열 이름 · 타입이 Google 시트와 다르다.** 예: Google `Tile_Table`의 `TerrainType · SurfaceType · VisualKey · byte` ↔ 게임 `macro_tile`의 `Terrain · int`, `SurfaceType`/`VisualKey` 없음. District · Building · Road 표는 **게임에 없다**(Building에 가장 가까운 것은 `facility`).
3. 임포터는 **관대하고 조용하다.** 헤더 이름이 틀리면 오류 없이 기본값이 들어가고, 셀 하나가 틀리면 그 행만 경고 후 버린다. 그래서 프로젝트는 별도 정적 검사기 `.claude/tools/sheet_check.py`를 둔다.
4. **확정(Jay 2026-10-11, §10): 게임은 SagaDocs TSV를 직접 읽지 않는다.** SAGA의 `/design` 세션이 SagaDocs를 읽고 SAGA 형식으로 옮겨 쓴다. 그러니 **JayDocs 포맷 계약은 이 임포터 규칙에 묶이지 않는다** — 아래 1~9는 SAGA 쪽 사정을 알기 위한 참고다.

---

## 1. 진입점

**결론** — 런타임에 TSV를 직접 읽는다(ScriptableObject 변환 없음). 공용 리더 `Jay.FileIO.TSVReader`(CsvHelper 래퍼) → SAGA의 `DefTable<TDTO,TDef,TId>` 파생 18개 → `DataManager.LoadAsync()`가 순서대로 로드. 에디터 도구 셋은 같은 리더의 동기판으로 읽는다.

**근거**
- `JayCodeCollection/Runtime/FileIO/TSV/TSVReader.cs:66` `ReadTableAsync<T>` (런타임) · `:108` `ReadTable<T>(filePath)` (에디터)
- `Assets/10. Script/SagaCore/00. Data/DefTable.cs:61-70` 모든 표가 `ReadRowsAsync`로 읽음
- `Assets/30. Script/Data/DataManager.cs:59-82` 로드 순서(참조당하는 표 먼저)
- 에디터: `Assets/40. Tools/Editor/EntityPrefabGenerator.cs:111-116`(Key 목록 → 프리팹 생성) · `MicroSceneGenerator.cs:315` · `Assets/30. Script/MicroWorld/StageLoader.cs:108`

**읽는 표**(`const string TableName`): `unit` `enemy` `beacon` `wave` `treasure` `micro_param` `micro_tile` `micro_map_gen` `macro_tile` `macro_cell` `region` `macro_param` `roster` `injury` `resource` `facility` `process` `contract`. 질문의 Tile/Resources에 해당하는 것은 `macro_tile` · `resource`. District/Building/Road는 없음.

```csharp
// DataManager.cs:73-81
await MacroTiles.LoadAsync();
await MacroCells.LoadAsync(MacroTiles);
await Regions.LoadAsync(MicroMapGens, MacroCells);
...
await Resources.LoadAsync();
await Facilities.LoadAsync();
await Processes.LoadAsync(Resources, Treasures, Facilities);
```

## 2. 파일 찾기

**결론** — 정확한 이름 하나로 찾는다: `Application.streamingAssetsPath/Table/` + `TableName` + `".tsv"`. 패턴 · 접두 · 다른 확장자 없음. 대소문자는 Windows에선 무관, 대소문자 구분 파일시스템에선 깨진다(추측 — `File.Exists` 동작).

**근거** — `TSVReader.cs:68-76`, 표마다 `private const string TableName = "macro_tile";` (`MacroTileTable.cs:9`), 에디터 도구는 하드코딩 경로 `"Assets/StreamingAssets/Table/micro_tile.tsv"`(`StageLoader.cs:11`, `MicroSceneGenerator.cs:20`, `EntityPrefabGenerator.cs:19`).

```csharp
// TSVReader.cs:68-76
string basePath = isStreamingAssetPath ? Application.streamingAssetsPath : Application.persistentDataPath;
string folderPath = Path.Combine(basePath, "Table");
string filePath = Path.Combine(folderPath, tableName + ".tsv");
if (File.Exists(filePath) == false)
{
    Debug.LogError($"[TSVReader] 파일이 없습니다 — {filePath}");
    return null;
}
```

→ **`MacroWorld - Tile_Table.tsv` → `Tile_Table.tsv`, `Buidling_Table.tsv` → `Building_Table.tsv` 개명: 아무것도 깨지지 않는다.** 그 파일들은 `Docs/00-jay/`에 있고 아무도 읽지 않는다. 반대로 게임 표(`macro_tile.tsv`)의 이름을 바꾸면 그 표는 「파일이 없습니다」 오류 + 빈 표로 진행한다(`DefTable.cs:64-67`).
- 참고: `File.Exists`로 StreamingAssets를 직접 여는 방식은 Android/WebGL에서 안 된다(추측 — 그 플랫폼의 StreamingAssets는 압축/URL). Steam Windows 목표라 현재 문제 아님.

## 3. 행 처리

**결론** — **`#`로 시작하는 모든 줄은 주석**(위치 무관, 데이터 중간 포함). 헤더는 「주석 · 빈 줄을 건너뛴 뒤 첫 줄」. 그래서 Google 형식(1행 `#타입`, 2행 헤더)과 SAGA 형식(1행 `#타입`, 2행 `#설명`, 3행 헤더) 모두 통과한다(프로브). 빈 줄 · 파일 끝 개행 · 마지막 줄 개행 없음 모두 무시/허용(프로브).

**근거** — `TSVReader.cs:41-44` `AllowComments = true, Comment = '#'`. 빈 줄 무시는 CsvHelper 기본값 `IgnoreBlankLines = true`(설정에 없음 → 기본값, 프로브로 확인).

```csharp
// TSVReader.cs:41-44
// 표 파일의 주석 행. '#'으로 시작하는 라인은 파서가 건너뛴다.
// 자료형 선언 행, 구분용 빈 행처럼 사람이 읽기 위한 행을 표에 남겨 둘 수 있다.
AllowComments = true,
Comment = CommentMark,
```

함정(모두 프로브로 확인):
| 입력 | 결과 |
| :-- | :-- |
| 1행 타입 행에 `#`가 빠짐(`string\tstring…`) | 타입 행이 헤더가 됨 → 매핑되는 멤버 없음 → **모든 행이 건너뛰어짐**(표 전체 소실) |
| **Key가 `#`로 시작하는 데이터 행**(`#hashkey\t…`) | **경고 없이 주석으로 사라짐** |
| ` #indented`(앞에 공백) | 주석 아님 — 데이터 행으로 읽힘 |
| 공백만 있는 줄 / 탭만 있는 줄 | 데이터 행으로 읽힘 → 숫자 · bool 칸이 비어 행 실패(경고) 또는 Key 공백으로 `DefTable`이 건너뜀(경고, `DefTable.cs:87-91`) |
| 데이터 중간 빈 줄 | 무시 |

## 4. 열 처리

**결론** — **헤더 이름으로** 찾는다(인덱스 아님). DTO의 public 필드/프로퍼티 이름과 **대소문자 · 공백까지 정확히 일치**해야 한다. 열 순서 자유. 모르는 열(`#한글명`, `# 설명`, 아무 이름) 무시. **있어야 할 열이 없거나 헤더 철자가 틀리면 오류 없이 C# 기본값**(string `null`, int `0`, bool `false`). 같은 이름 열이 둘이면 앞 열이 이김. 타입 행의 빈 칸은 그 행 전체가 주석이라 무관.

**근거** — `TSVReader.cs:37-39,46` `HasHeaderRecord = true, MissingFieldFound = null, HeaderValidated = null, MemberTypes = Properties | Fields`. 기본 `PrepareHeaderForMatch`(변환 없음) → 정확 일치. 프로브: `key`/`S `(뒤 공백) 헤더 → 둘 다 매핑 안 됨, `Key=null`.

```csharp
// TSVReader.cs:36-39
Delimiter = "\t",
Mode = CsvMode.NoEscape,
HasHeaderRecord = true,
MissingFieldFound = null,
HeaderValidated = null,
```

구분해 둘 것(프로브):
- **헤더에 열 자체가 없음** → 기본값이 들어가고 행은 산다.
- **헤더엔 있는데 그 행의 칸 수가 모자람**(짧은 행) → 빠진 칸이 `""`로 변환 시도 → int · bool · float이면 **그 행 실패**(경고), string이면 `""`.
- 칸이 헤더보다 많음 → 남는 칸 무시.

이 「조용히 기본값」을 잡는 것이 `sheet_check.py` ⑦(헤더 집합 = DTO 필드 집합) — `.claude/tools/sheet_check.py:176-181`.

## 5. 값 파싱

공통: CsvHelper 기본 변환기 + `CultureInfo.InvariantCulture`(`TSVReader.cs:34`). `TrimOptions` 미설정(= trim 안 함). 셀 하나가 변환에 실패하면 **그 행만** 경고 후 버린다(`TSVReader.cs:48-52`). 아래 표는 전부 프로브 결과.

**bool**
| 통과 | 실패(행 버림) |
| :-- | :-- |
| `TRUE` `FALSE` `true` `True` `tRuE`(대소문자 무관) · `1` `0` · ` TRUE `(앞뒤 공백) | **빈칸** · `yes` `no` `Y` `N` `on` `2` `-1` |

**정수 / 실수** — DTO 실제 타입은 `int`·`float`뿐(byte/uint는 SAGA DTO에 없음, 프로브로 참고 확인)
| 타입 | 통과 | 실패(행 버림) |
| :-- | :-- | :-- |
| int | `-5` `+3` ` 3 ` | **빈칸** · `1.0` `1,000` `1e3` `0x10` · 범위 초과 `2147483648` |
| byte | `255` | `256` `-1` 빈칸 |
| uint | `4294967295` | `-1` 빈칸 |
| float | `1.5` `.5` ` 2.5 ` `1e3` `NaN` `Infinity` `1,000.5` | 빈칸 |

- **소수점은 `.` 고정**(Invariant). ⚠️ **`1,5`는 오류가 아니라 `15`가 된다** — 천 단위 구분자로 해석(프로브). 유럽식 소수점이 섞이면 조용히 값이 10배가 된다.
- 빈칸 기본값 없음 — 숫자 · bool 빈칸은 행 실패. 범위 검사(`MovementCost < 1` 등)는 각 Table의 `TryBuild`가 따로 한다(예 `MacroTileTable.cs:41-51`).

**enum** — CsvHelper enum 변환은 쓰지 않는다. **DTO는 enum 열을 `string`으로 받고 Table이 해석**한다(`.claude/skills/system/pipeline.md:13`). 규칙은 「`Enum.TryParse` 성공 **그리고** `value.ToString() == 원문`」 → **대소문자 · 공백 정확 일치, 숫자 금지, 쉼표 조합 금지.** 모르는 값이면 그 행을 경고 후 버림.

```csharp
// DefTable.cs:120-127
protected bool TryParseExact<TEnum>(string key, string column, string text, out TEnum value) where TEnum : struct, Enum
{
    if (Enum.TryParse(text, out value) && value.ToString() == text) return true;

    SkipRow(key, $"{column} '{text}'를 해석할 수 없습니다");
    value = default;
    return false;
}
```
(`MacroTileTable.cs:35`, `ResourceTable.cs:242`은 같은 규칙을 인라인으로.) 프로브: `Plains` ✔ · `plains` ` Plains` `Plains ` `1` `Plains, Hill` `Mars` 빈칸 ✘.

**리스트 / `Cow[20], Wood[30]` / `Trait명[Key:Value]`** — **TSV 표에는 리스트 열도, 이 문법을 파싱하는 코드도 없다.** 그런 셀은 string 필드면 원문 그대로 들어간다(프로브: `"Cow[20], Wood[30]"` 그대로). 유일한 쉼표 리스트 파서는 `MacroRoadSystem.TryParseRoadType`(`04. MacroWorld/MacroRoadSystem.cs:53-70`)인데 **TSV가 아니라 세이브(JSON)의 `RoadSave.RoadType`용**이다 — 구분자 `,`, 토큰 앞뒤 trim, 빈 문자열/null = 없음, 토큰은 enum 정확 일치.

**string** — 빈 셀은 **`""`**(null 아님), 단 **헤더에 열이 없으면 `null`**. 앞뒤 공백 보존(`"  pad  "`). `Mode = CsvMode.NoEscape`라 **따옴표를 해석하지 않는다** — `"Plains, Hill"`은 따옴표째로 들어간다. 셀 안에 탭이 들어가면 열이 밀리고, 줄바꿈이 들어가면(따옴표로 감싸도) 행이 둘로 갈라진다 → 보통 두 행 다 변환 실패(프로브). **셀 안 탭 · 줄바꿈은 표현할 방법이 없다.**

## 6. 인코딩 · 줄바꿈

**결론** — UTF-8 BOM 있어도 없어도 읽는다(`new StreamReader(path)` 기본 = UTF-8 + BOM 감지). CRLF · LF · CR 단독 모두 받는다. Split 문자열이 아니라 CsvHelper 파서가 줄을 나눈다.

**근거** — `TSVReader.cs:82` `using var reader = new StreamReader(filePath);` · 프로브: BOM · CRLF · CR 각각 통과, BOM 뒤 첫 줄이 `#`여도 주석으로 인식.

단, **프로젝트 규약은 「BOM 없음 · LF」**이고 현재 18개 파일 모두 그렇다(직접 확인: 첫 3바이트 `#st`, `\r` 0개). `sheet_check.py` ⑥이 BOM을 오류로 본다(`sheet_check.py:112-114`). `Docs/00-jay`의 Google export(`Tile_Table`로 확인)도 BOM 없음 · LF였다.

## 7. 검증

| 검사 | 언제 · 어디서 | 실패 시 |
| :-- | :-- | :-- |
| 셀 타입 변환 | 임포트(CsvHelper) | 행 버림 + `LogWarning` (`TSVReader.cs:48-52`) |
| 빈 Key · 중복 Key | 표 구성 `DefTable.Rebuild` | 행 버림 + `LogWarning`, **중복은 앞 행이 이김** (`DefTable.cs:87-97`) |
| enum 허용값 | 표 구성 `TryBuild` | 행 버림 + `LogWarning` (`DefTable.cs:120-127`) |
| 다른 표 참조(FK `<표>Key`) | 표 구성 — 참조당하는 표를 먼저 로드하고 `TryResolve` | 행 버림 + `LogWarning` (`ProcessTable.cs:36-44,69-71` · `MacroCellTable.cs:46` · `WaveTable.cs:46,52` · `RosterTable.cs:29` · `RegionTable.cs:88` · `MicroMapGenTable.cs:65-77`) |
| 행 규칙(범위 · 조합) | `TryBuild` | 행 버림 + `LogWarning` (예 `MacroTileTable.cs:41-63`) |
| 표 전체 규칙 | `Build` 끝 | `LogError` + 플래그 false, 표는 유지 (`MacroTileTable.cs:99-107` 고봉>산, `ResourceTable.cs:288-292` 필수 Role) |
| 파일 없음 · 파싱 예외 | `TSVReader` | `LogError` + `null` → 빈 표로 진행 (`TSVReader.cs:72-76,93-97`, `DefTable.cs:64-67`) |

**예외는 임포트 중엔 던지지 않는다.** 던지는 것은 나중에 코드가 없는 키를 `Resolve(key)`할 때뿐(`DefTable.cs:54-57`, `KeyNotFoundException`). 정적 검사(`sheet_check.py`)는 형식 · Key · 타입 행 · 헤더=DTO까지 하고 **FK 값 대조(⑧)는 아직 안 한다**(`sheet_check.py:22`).

## 8. 데이터 모델

헤더 이름 = DTO public 필드 이름(글자 그대로), 매핑 표 없음(`.claude/skills/system/pipeline.md:13`). DTO → 검증 → 불변 `Def` 구조체로 옮긴다.

**`MacroTileDTO`** — `Assets/10. Script/SagaCore/04. MacroWorld/MacroTileDefine.cs` (Google `Tile_Table`에 해당)
| 필드 | 타입 | 비고 |
| :-- | :-- | :-- |
| Key | string | 소문자 (`plains`, `hill`…) |
| DisplayName | string | |
| Terrain | string → `TerrainKind` | `Plains Hill Mountain Peak Ocean` |
| Passable | bool | |
| Buildable | bool | Passable=false면 false여야 함 |
| MovementCost | int | ≥ 1, 고봉 최소 > 산 최대 |
| FoodCost | int | ≥ 0 |

Google 시트와의 차이: `TerrainType`→`Terrain`, **`SurfaceType` · `VisualKey` 없음**(그 열들은 무시되고, `Terrain`이 없으니 **모든 행이 건너뛰어진다**), `byte`→`int`, Key 표기(`Plains-Grass` vs `plains`).

**`ResourceDTO`** — `06. HomeBase/ResourceDefine.cs` (Google `Resources_Field`에 해당)
| 필드 | 타입 | 비고 |
| :-- | :-- | :-- |
| Key | string | |
| DisplayName | string | |
| Role | string → `ResourceRole` | `Food Medicine MagitechCore Currency` · 표 안 유일 |
| Tier | string → `ResourceTier` | `Consumable Refinable Currency` (`AncientCore` 금지) |
| Unit | string | |
| Starting | int | ≥ 0 |

**`FacilityDTO`** — `06. HomeBase/FacilityDefine.cs` (Building에 가장 가까움): `Key string · DisplayName string · CoreSlots int(≥0) · CoreSpeedRatio float(≥1) · UnplugCoreCost int(≥0) · UnplugDays float(≥0)`.

District · Building · Road: **DTO 없음.** 거시 칸 배치는 `MacroCellDTO`(`Key · Q int · R int · TileKey string→macro_tile`), 지역은 `RegionDTO`(Key · DisplayName · Q · R · Type · Roof · Risk · Occupant · Depletion · Discovered · Owned · MapGenKey · MapSeed). 표 사이 관계 · 열 명세의 문서 정본은 `Docs/10-design/08-data.md`.

## 9. 코드 생성

**결론** — **없다.** 타입 행이나 Field 시트에서 C# 클래스를 만드는 도구는 없고, DTO는 손으로 쓴다(`/system` 세션 규칙, `pipeline.md:13-16`). 방향이 반대인 **검사기**가 있다: `sheet_check.py`가 DTO 소스를 정규식으로 읽어 TSV 헤더 · 타입 행과 대조한다.

```python
# .claude/tools/sheet_check.py:34-38
TYPES = {"string", "int", "float", "bool", "enum"}
CS_TYPE = {"string": {"string", "enum"}, "int": {"int"}, "float": {"float"}, "bool": {"bool"}}
TABLE_NAME_RE = re.compile(r'const\s+string\s+TableName\s*=\s*"([^"]+)"')
READ_RE = re.compile(r"(?:ReadTable(?:Async)?|DefTable)\s*<\s*(\w+)\s*[>,]")
FIELD_RE = re.compile(r"^\s*public\s+(?!const\b|static\b|class\b|struct\b|enum\b)([\w<>\[\],\.]+)\s+(\w+)\s*;")
```
→ **타입 행의 허용 어휘는 `string int float bool enum` 다섯뿐.** Google 시트의 `byte` `uint`는 검사기 ⑤에서 「모르는 타입」 NG.

## 10. 외부 동기화

**지금** — TSV는 SAGA 리포에 **직접 커밋**돼 있고 `/design` 세션(TSV만 다루는 세션)과 `/system` 세션이 리포 안에서 바로 고친다. Google 시트 export는 사람이 `Docs/00-jay/`에 수동 복사(f0eda3699). 서브모듈 · 심볼릭 링크 · 동기화 스크립트 없음. 형제 리포 패턴은 이미 하나 있다 — JayCore를 `"com.koohoo.core": "file:../../JayCodeCollection"`로 참조(`Packages/manifest.json:4`).

**확정(Jay 2026-10-11)** — 연결은 **파일 복사 · 서브모듈 · 심볼릭 링크 어느 것도 아니다. 사람(세션)이 옮겨 쓴다.**

```
SagaDocs (Jay 원본 · JayDocs로 편집 · Jay 형식 TSV + md)
   │  SAGA의 /design 세션이 읽기만 한다
   ▼
/design 이 SAGA 형식으로 옮겨 쓴다 → Assets/StreamingAssets/Table/<소문자>.tsv → sheet_check.py
   (SAGA에 없는 열 · 표는 옮기지 않고 Docs/Proposals/ 보고서로 Jay에게)
```

- 이유: 두 형식이 다르다(§8 — 열 이름 · 타입 · Key 표기 · 없는 표). 기계 복사로는 게임이 읽지 못하고, 옮기는 판단(무엇을 게임 표로, 무엇을 보고서로)은 `/design`의 일이다.
- 서브모듈 · 심볼릭 링크를 쓰지 않는 이유: `Assets/` 안에 두면 Unity가 파일마다 `.meta`를 만들어 SagaDocs가 더러워진다.
- SAGA 쪽 TSV는 계속 `/design` · `/system`이 고친다. SagaDocs는 SAGA에서 읽기 전용.

**JayDocs 쪽에 주는 뜻**
- **JayDocs 포맷 계약은 Unity 임포터에 맞출 필요가 없다.** 게임이 SagaDocs TSV를 직접 읽지 않는다. 지금 Jay 형식(1행 `#타입`, 2행 헤더, `#` 열, `_Table` ↔ `_Field` 짝, `byte`/`uint` 같은 타입)을 그대로 지켜도 된다.
- 파일 이름도 자유다 — `MacroWorld - ` 접두 제거, `Buidling` → `Building` 개명 모두 안전(§2).
- Key는 파일 안에서 유일하게 둔다 — `/design`이 행을 Key로 맞춰 옮긴다.
- `DESIGN.md` §14 「운영 규칙」의 가정(「Unity 프로젝트가 `SagaDocs`를 git 서브모듈로 두고 `**/*_Table.tsv`를 읽는다」)은 이 확정으로 바꿔야 한다.

---

## 임포터가 통과시키는 최소 유효 파일

**임포터만 기준**(프로브: `#` 행 없이 헤더 + 데이터만 있어도 읽힘) — `Assets/StreamingAssets/Table/macro_tile.tsv`, UTF-8, 탭 구분:

```tsv
Key	DisplayName	Terrain	Passable	Buildable	MovementCost	FoodCost
plains	평지	Plains	true	true	1	1
```

**프로젝트 규약까지 통과**(`sheet_check.py` ①~⑦: 1행 `#`+타입, 2행 `#`+설명, 3행 헤더, BOM 없음, LF) — SAGA 시트가 실제로 쓰는 형식:

```tsv
#string	string	enum	bool	bool	int	int
#행 식별자	화면 이름	Plains · Hill · Mountain · Peak · Ocean	통과 가능	건축 가능 · 통과 불가면 false	이동 비용 · 1 이상	식량 비용 · 0 이상
Key	DisplayName	Terrain	Passable	Buildable	MovementCost	FoodCost
plains	평지	Plains	true	true	1	1
```

### SAGA 게임 시트 규칙 (참고 — `/design`이 옮겨 쓸 때 지킨다. JayDocs 계약 아님)

1. 파일: `<소문자_이름>.tsv`, UTF-8 **BOM 없음**, **LF**, 탭 구분, 따옴표 · 이스케이프 없음.
2. 1행 `#`+타입(`string int float bool enum`만), 2행 `#`+설명, 3행 헤더, 4행~ 데이터. 데이터 중간 `#` 줄은 주석.
3. 헤더 = DTO 필드 이름, 대소문자 · 공백 정확. 첫 열 `Key`(string, 비지 않음, 유일, **`#`로 시작 금지**, 앞뒤 공백 금지).
4. 셀에 탭 · 줄바꿈 금지. 앞뒤 공백 넣지 않기(string은 보존되고 enum은 실패한다).
5. bool `true`/`false`(소문자 권장, 대소문자 무관), int 정수만, float 소수점 `.` · **쉼표 금지**(`1,5`→15), 숫자 · bool 빈칸 금지.
6. enum은 C# 이름과 정확히 같은 문자열.
7. 다른 표 참조 열은 `<다른표>Key`, 값은 그 표의 Key.
