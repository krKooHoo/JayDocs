import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { describe, expect, it } from 'vitest'
import { stripBakedWithLines } from './bake'
import { rehypeSourceLines } from './sourceLines'

/** react-markdown 으로 그린 HTML. 앱의 미리보기와 같은 플러그인(remark-gfm)을 쓴다 */
function render(source: string, lines?: number[]) {
  return renderToStaticMarkup(createElement(ReactMarkdown, { remarkPlugins: [remarkGfm], rehypePlugins: [[rehypeSourceLines, { lines }]] }, source))
}

/** 최상위 조각의 [태그, data-line] 목록 (없으면 null) */
function topLevel(html: string): [string, number | null][] {
  const out: [string, number | null][] = []
  let depth = 0
  for (const m of html.matchAll(/<(\/?)([a-z][a-z0-9]*)((?:\s[^<>]*?)?)(\/?)>/g)) {
    const [, close, tag, attrs, selfClose] = m
    if (close) { depth--; continue }
    if (depth === 0) {
      const line = /\sdata-line="(\d+)"/.exec(attrs)
      out.push([tag, line ? Number(line[1]) : null])
    }
    if (!selfClose && !/^(br|hr|img|input)$/.test(tag)) depth++
  }
  return out
}

describe('rehypeSourceLines — 최상위 조각에 원문 줄 번호', () => {
  it('문단 · 제목 · 목록 · 인용 · 표 · 펜스 · 구분선', () => {
    const src = [
      '# 제목', // 1
      '',
      '문단 첫 줄', // 3
      '둘째 줄',
      '',
      '- 목록', // 6
      '  - 안쪽',
      '',
      '> 인용', // 9
      '',
      '| a | b |', // 11
      '|---|---|',
      '| 1 | 2 |',
      '',
      '```js', // 15
      'code',
      '```',
      '',
      '---', // 19
      '',
      '끝', // 21
    ].join('\n')
    expect(topLevel(render(src))).toEqual([['h1', 1], ['p', 3], ['ul', 6], ['blockquote', 9], ['table', 11], ['pre', 15], ['hr', 19], ['p', 21]])
  })

  it('안쪽 조각(목록 항목 · 표 칸)에는 찍지 않는다', () => {
    const html = render('- a\n- b\n')
    expect(html.match(/data-line/g)?.length).toBe(1)
  })

  it('HTML 블록 · 주석은 엘리먼트가 아니다 → div 로 감싸 줄 번호를 붙인다 (글자 그대로 보인다)', () => {
    const html = render('위\n\n<div class="x">\nhtml\n</div>\n\n<!-- 주석 -->\n\n아래')
    expect(topLevel(html)).toEqual([['p', 1], ['div', 3], ['div', 7], ['p', 9]])
    expect(html).toContain('&lt;div class=&quot;x&quot;&gt;')
    expect(html).toContain('&lt;!-- 주석 --&gt;')
  })

  it('각주 묶음은 만들어 낸 조각이라 위치가 없다 → data-line 없음', () => {
    const top = topLevel(render('글[^1]\n\n[^1]: 각주\n'))
    expect(top[0]).toEqual(['p', 1])
    expect(top[top.length - 1]).toEqual(['section', null])
  })

  it('lines 지도를 주면 원문 줄로 바꿔 적는다 (baked 블록을 걷어 낸 글)', () => {
    const original = ['# 제목', '', '```tsv-view', 'file: a.tsv', 'bake: true', '```', '<!-- tsv-view:baked -->', '| a |', '| - |', '| 1 |', '<!-- /tsv-view -->', '', '아래 문단'].join('\n')
    const s = stripBakedWithLines(original)
    expect(topLevel(render(s.text))).toEqual([['h1', 1], ['pre', 3], ['p', 8]])
    expect(topLevel(render(s.text, s.lines))).toEqual([['h1', 1], ['pre', 3], ['p', 13]])
  })
})
