/**
 * SearchResults — 全局搜索结果页（`/#/search?q=…`）
 *
 * 顶栏那个搜索框过去只搜书名，可读者想找的多是"我哪本书里划过这句话"。
 * 这里一次问主进程拿回五类命中（划线 / 知识卡片 / 方法论 / 文章 / 生词），
 * 每条把命中那句挪到片段中间，点一下回到它自己的位置。
 *
 * 分组名、每类上限、片段与链接的拼法都在 `src/shared/global-search.ts` 那一份里。
 */

import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import PageHero from '@/components/layout/PageHero'
import Card from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import Icon from '@/components/ui/Icon'
import { Loading, EmptyState } from '@/components/ui/Feedback'
import {
  describeSearchOutcome,
  isSearchable,
  splitByMatch,
  type GlobalSearchResult,
  type SearchGroupResult,
  type SearchHit,
} from '../../../shared/global-search'

/** 命中词描一层底色：不标出来的话，读者要在整段里自己找第二遍 */
function Highlighted({ text, query }: { text: string; query: string }) {
  return (
    <>
      {splitByMatch(text, query).map((part, i) =>
        part.hit ? (
          <mark
            key={i}
            style={{
              background: 'color-mix(in srgb, var(--primary) 22%, transparent)',
              color: 'inherit',
              padding: '0 1px',
              borderRadius: 2,
            }}
          >
            {part.text}
          </mark>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </>
  )
}

function HitRow({ hit, query }: { hit: SearchHit; query: string }) {
  const navigate = useNavigate()
  return (
    <button
      type="button"
      onClick={() => navigate(hit.link)}
      style={{
        display: 'block',
        width: '100%',
        textAlign: 'left',
        padding: 'calc(var(--spacing) * 3) calc(var(--spacing) * 4)',
        border: 'none',
        borderBottom: '1px solid var(--border)',
        background: 'transparent',
        cursor: 'pointer',
      }}
    >
      <span
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: 'calc(var(--spacing) * 2)',
          fontSize: '0.9rem',
          fontWeight: 600,
          color: 'var(--foreground)',
          wordBreak: 'keep-all',
          overflowWrap: 'break-word',
        }}
      >
        <Highlighted text={hit.title} query={query} />
        {hit.meta && (
          <span style={{ fontWeight: 400, fontSize: '0.78rem', color: 'var(--muted-foreground)' }}>
            · {hit.meta}
          </span>
        )}
      </span>
      <span
        style={{
          display: 'block',
          marginTop: 'calc(var(--spacing) * 1)',
          fontSize: '0.82rem',
          lineHeight: 1.6,
          color: 'var(--muted-foreground)',
          wordBreak: 'break-word',
        }}
      >
        <Highlighted text={hit.snippet} query={query} />
      </span>
    </button>
  )
}

function GroupSection({ group, query }: { group: SearchGroupResult; query: string }) {
  return (
    <section style={{ marginTop: 'calc(var(--spacing) * 5)' }}>
      <h3
        style={{
          margin: '0 0 calc(var(--spacing) * 2)',
          fontSize: '0.95rem',
          fontWeight: 600,
          display: 'flex',
          alignItems: 'center',
          gap: 'calc(var(--spacing) * 2)',
        }}
      >
        {group.label}
        <span style={{ fontWeight: 400, color: 'var(--muted-foreground)' }}>
          {group.hits.length} 条
        </span>
      </h3>
      <Card padding={0} style={{ overflow: 'hidden' }}>
        {group.hits.map((hit) => (
          <HitRow key={`${hit.kind}-${hit.id}`} hit={hit} query={query} />
        ))}
      </Card>
    </section>
  )
}

export default function SearchResults() {
  const [searchParams] = useSearchParams()
  const query = (searchParams.get('q') ?? '').trim()
  const [result, setResult] = useState<GlobalSearchResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = useCallback(async (q: string) => {
    setError(null)
    setLoading(true)
    try {
      setResult(await window.electronAPI.search.global(q))
    } catch (err) {
      // 失败就说失败：报"没有找到"会让人以为自己的笔记里真的没有这句
      setError((err as Error).message)
      setResult(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!isSearchable(query)) {
      setResult(null)
      setLoading(false)
      setError(null)
      return
    }
    void run(query)
  }, [query, run])

  return (
    <>
      <PageHero title="搜索" subtitle={describeSearchOutcome(query, result?.total ?? 0)} />

      {!isSearchable(query) && (
        <EmptyState
          icon={<Icon name="search" size={28} />}
          title="还没有输入关键词"
          description="在顶栏的搜索框里输入关键词，会同时找你的划线、知识卡片、方法论、文章与生词。"
        />
      )}

      {loading && <Loading hint="正在搜索…" />}

      {!loading && error && (
        <EmptyState
          icon={<Icon name="alert" size={28} />}
          title="搜索失败"
          description={error}
          action={
            <Button variant="secondary" onClick={() => void run(query)}>
              重新搜索
            </Button>
          }
        />
      )}

      {!loading && !error && result && result.total === 0 && (
        <EmptyState
          icon={<Icon name="search" size={28} />}
          title={`没有找到包含「${query}」的内容`}
          description="划线看正文与笔记，卡片看标题、正文与解读，方法论看名称、说明与步骤，文章看标题与摘要，生词看单词与释义。换个说法再试一次。"
        />
      )}

      {!loading && result?.groups.map((group) => (
        <GroupSection key={group.kind} group={group} query={query} />
      ))}
    </>
  )
}
