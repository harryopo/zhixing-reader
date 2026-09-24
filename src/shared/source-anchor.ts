/**
 * 从 AI 回答的引用来源，跳回书籍详情里那条原始划线的深链约定。
 *
 * 两个方向共用一份：Chat 用它拼链接，BookDetail 用它解析并定位。
 * 链接参数与 DOM 锚点 id 只要有一处改了另一处没跟上，就会变成"点了没反应"，
 * 所以约定只留这一处。
 */

/** 引用来源 → 书籍详情的深链（页签固定划线，并带上要定位的那条划线 id） */
export function sourceHighlightLink(src: { bookId: string; highlightId: string }): string {
  const params = new URLSearchParams({ tab: 'highlights', highlight: src.highlightId })
  return `/bookshelf/${encodeURIComponent(src.bookId)}?${params.toString()}`
}

/** 划线在列表里的 DOM id（scrollIntoView 与高亮都按它找） */
export function highlightAnchorDomId(highlightId: string): string {
  return `highlight-${highlightId}`
}

/**
 * 读深链参数，决定打开哪个页签、要定位哪条划线。
 *
 * 「笔记」页签里也是划线（同一张表，按有没有写笔记区分），所以指定了
 * highlight 但页签没写时不猜页签，交给调用方按数据判断。
 */
export function readHighlightDeepLink(get: (key: string) => string | null): {
  requestedTab: string | null
  anchorHighlightId: string | null
} {
  const requestedTab = get('tab')
  const highlight = get('highlight')
  return { requestedTab, anchorHighlightId: highlight ? highlight : null }
}

/** 生词 → 每日学习里那篇文章的深链 */
export function articleDeepLink(articleId: string): string {
  return `/daily-learning?article=${encodeURIComponent(articleId)}`
}

/** 读「要看哪篇文章」的深链参数；空串当作没给 */
export function readArticleDeepLink(get: (key: string) => string | null): string | null {
  const id = get('article')
  return id ? id : null
}
