import { useMemo, useSyncExternalStore, type CSSProperties, type HTMLAttributes } from 'react'
import { codeVersion, isPlainToken, onCodeReady, tokenClass, tokenizeCode, type CodeToken } from '../lib/code/highlight'

/**
 * 미리보기의 코드 블록 — 언어에 맞춰 색을 넣는다 (DESIGN §27).
 * 문법을 받는 동안 · 너무 긴 블록은 색 없이 같은 글을 보인다. DOM 의 글자는 색이 있든 없든 같다(복사한 내용이 같다).
 */
export function CodeBlock({ lang, code, ...rest }: { lang: string; code: string } & HTMLAttributes<HTMLElement>) {
  const version = useSyncExternalStore(onCodeReady, codeVersion, codeVersion)
  // react-markdown 이 문서를 다시 그려도 글이 같으면 다시 나누지 않는다
  const lines = useMemo(() => tokenizeCode(code, lang), [code, lang, version])
  if (!lines) return <code {...rest}>{code + '\n'}</code>
  return (
    <code {...rest}>
      {lines.map((line, i) => (
        <span key={i}>
          {line.map((t, j) => (isPlainToken(t) ? t.text : <span key={j} className={tokenClass(t)} style={styleOf(t)}>{t.text}</span>))}
          {'\n'}
        </span>
      ))}
    </code>
  )
}

function styleOf(t: CodeToken): CSSProperties {
  const s: Record<string, string> = {}
  if (t.light) s['--tk-l'] = t.light
  if (t.dark) s['--tk-d'] = t.dark
  return s as CSSProperties
}
