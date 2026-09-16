/**
 * RetrievalPanel — Agent「调取知识库」可视化面板
 *
 * agent 运行时展示各路知识库检索（书籍笔记 RAG / 知识卡片 / 方法论 / 记忆 / 用户画像）：
 *   - start 阶段：正在调取…（脉冲指示）
 *   - done 阶段：逐路展示 命中数 / 检索方式 / 相关度 / 可展开片段预览
 * 让 RAG / 知识库调取过程对用户可见（此前只存在于后端日志）。
 */
import { useState, type CSSProperties } from 'react'
import Icon, { IconName } from '@/components/ui/Icon'
import type { RetrievalState, RetrievalSource } from '../../stores/chatStore'

const SOURCE_ICONS: Record<string, IconName> = {
  book: 'bookshelf',
  knowledgeCard: 'cards',
  methodology: 'methodology',
  memory: 'notes',
  userProfile: 'profile',
}

const METHOD_LABELS: Record<string, string> = {
  // 检索现在只有本地 BM25 一条路（2026-09-16 起）
  local: '本地检索',
  semantic: '语义检索（已停用）',
  keyword: '关键词',
  relevance: '相关度',
  profile: '画像',
}

function MethodBadge({ method }: { method?: string }) {
  if (!method) return null
  return (
    <span
      style={{
        fontSize: '0.7rem',
        padding: '1px 6px',
        borderRadius: 999,
        background: 'var(--muted)',
        color: 'var(--muted-foreground)',
        border: '1px solid var(--border)',
        whiteSpace: 'nowrap',
      }}
    >
      {METHOD_LABELS[method] ?? method}
    </span>
  )
}

function SourceRow({ source }: { source: RetrievalSource }) {
  const [expanded, setExpanded] = useState(false)
  const previews = source.previews ?? []
  const hasPreviews = previews.length > 0
  const icon = SOURCE_ICONS[source.name] ?? 'search'
  const scoreText =
    typeof source.topScore === 'number' && source.topScore > 0
      ? ` · ${Math.round(source.topScore * 100)}%`
      : ''

  return (
    <div>
      <button
        type="button"
        onClick={() => hasPreviews && setExpanded((v) => !v)}
        disabled={!hasPreviews}
        aria-expanded={hasPreviews ? expanded : undefined}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'calc(var(--spacing) * 2)',
          width: '100%',
          padding: 'calc(var(--spacing) * 1.5) 0',
          border: 'none',
          background: 'transparent',
          color: source.used ? 'var(--foreground)' : 'var(--muted-foreground)',
          cursor: hasPreviews ? 'pointer' : 'default',
          textAlign: 'left',
          font: 'inherit',
          fontSize: '0.82rem',
          opacity: source.used ? 1 : 0.6,
        }}
      >
        <Icon name={icon} size={14} />
        <span style={{ fontWeight: 500 }}>{source.label}</span>
        <MethodBadge method={source.method} />
        <span style={{ marginLeft: 'auto', color: 'var(--muted-foreground)', whiteSpace: 'nowrap' }}>
          {source.used ? `${source.itemCount} 条命中${scoreText}` : '无命中'}
        </span>
        {hasPreviews && (
          <Icon name={expanded ? 'chevron-up' : 'chevron-down'} size={14} />
        )}
      </button>
      {expanded && hasPreviews && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 'calc(var(--spacing) * 2)',
            padding: 'calc(var(--spacing) * 2) 0 calc(var(--spacing) * 2) calc(var(--spacing) * 6)',
          }}
        >
          {previews.map((p, i) => (
            <div
              key={i}
              style={{
                borderLeft: '2px solid var(--border)',
                paddingLeft: 'calc(var(--spacing) * 3)',
                fontSize: '0.78rem',
              }}
            >
              {p.title && (
                <div style={{ fontWeight: 500, color: 'var(--foreground)' }}>{p.title}</div>
              )}
              {p.snippet && (
                <div style={{ color: 'var(--muted-foreground)' }}>{p.snippet}</div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default function RetrievalPanel({ retrieval }: { retrieval: RetrievalState | null }) {
  if (!retrieval) return null

  const panelStyle: CSSProperties = {
    border: '1px solid var(--border)',
    borderRadius: 'calc(var(--radius) + 4px)',
    background: 'var(--card)',
    padding: 'calc(var(--spacing) * 3) calc(var(--spacing) * 4)',
    fontSize: '0.82rem',
    maxWidth: 560,
  }

  if (retrieval.stage === 'start') {
    return (
      <div style={{ ...panelStyle, display: 'flex', alignItems: 'center', gap: 'calc(var(--spacing) * 2)', color: 'var(--muted-foreground)' }}>
        <span
          aria-hidden
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: 'var(--primary)',
            animation: 'retrieval-pulse 1s ease-in-out infinite',
          }}
        />
        <Icon name="search" size={14} />
        <span>正在调取知识库…</span>
        <style>{`@keyframes retrieval-pulse { 0%,100% { opacity: 0.3 } 50% { opacity: 1 } }`}</style>
      </div>
    )
  }

  const sources = retrieval.sources
  if (sources.length === 0) return null
  const usedCount = sources.filter((s) => s.used).length

  return (
    <div style={panelStyle}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'calc(var(--spacing) * 2)',
          paddingBottom: 'calc(var(--spacing) * 2)',
          marginBottom: 'calc(var(--spacing) * 1)',
          borderBottom: '1px solid var(--border)',
          color: 'var(--foreground)',
        }}
      >
        <Icon name="search" size={14} />
        <span style={{ fontWeight: 600 }}>调取知识库</span>
        <span style={{ marginLeft: 'auto', color: 'var(--muted-foreground)', fontSize: '0.78rem' }}>
          {usedCount}/{sources.length} 路命中
        </span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {sources.map((s) => (
          <SourceRow key={s.name} source={s} />
        ))}
      </div>
    </div>
  )
}
