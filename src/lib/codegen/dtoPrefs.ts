/**
 * C# DTO 내보내기의 대상 경로 기억 (DESIGN §26). 문서 폴더(layoutId)마다 따로 이 브라우저의 `localStorage` 에 둔다.
 *
 * - files: 표 경로 → 내보낸 `.cs` 경로. 한 번 정하면 다음부터는 묻지 않고 그 파일을 덮어쓴다.
 * - dir: 마지막으로 내보낸 폴더 — 처음 내보내는 표의 경로를 미리 채울 때 쓴다.
 */

export interface DtoPrefs {
  dir: string | null
  files: Record<string, string>
}

function key(layoutId: string) {
  return `jaydocs.dto:${layoutId}`
}

/** 저장분(또는 아무 값)을 쓸 수 있는 모양으로 — 깨진 값은 버린다 */
export function cleanDtoPrefs(raw: unknown): DtoPrefs {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const files: Record<string, string> = {}
  if (r.files && typeof r.files === 'object' && !Array.isArray(r.files)) {
    for (const [k, v] of Object.entries(r.files as Record<string, unknown>)) {
      if (k !== '' && typeof v === 'string' && v !== '') files[k] = v
    }
  }
  return { dir: typeof r.dir === 'string' ? r.dir : null, files }
}

/** 경로의 폴더 부분 (`a/b/C.cs` → `a/b`, 폴더가 없으면 '') */
export function dirOf(path: string): string {
  const i = path.lastIndexOf('/')
  return i < 0 ? '' : path.slice(0, i)
}

/** 표를 `target` 으로 내보낸 것을 적은 새 설정 */
export function withDtoTarget(prefs: DtoPrefs, tablePath: string, target: string): DtoPrefs {
  return { dir: dirOf(target), files: { ...prefs.files, [tablePath]: target } }
}

export function loadDtoPrefs(layoutId: string): DtoPrefs {
  try {
    const raw = localStorage.getItem(key(layoutId))
    if (raw) return cleanDtoPrefs(JSON.parse(raw))
  } catch { /* 저장소를 못 쓰거나 깨진 저장분이면 빈 설정 */ }
  return { dir: null, files: {} }
}

export function rememberDtoTarget(layoutId: string, tablePath: string, target: string) {
  try {
    localStorage.setItem(key(layoutId), JSON.stringify(withDtoTarget(loadDtoPrefs(layoutId), tablePath, target)))
  } catch { /* 저장 못 해도 내보내기는 됐다 — 다음에 다시 묻는다 */ }
}
