/** 模型统计 / 功能统计两块列表（从 TokenUsage.tsx 原样搬出，逻辑未改） */
import Icon from '@/components/ui/Icon'
import { EmptyState } from '@/components/ui/Feedback'
import type { FeatureStats, ProviderStats } from '../../../../types/renderer'
import { FEATURE_LABELS } from './constants'
import { formatDuration, getModelColor, getModelDisplayName, formatTokens } from './format'
import { providerBadgeStyle, spinnerStyle } from './styles'

export function ProviderStatsList({ stats, loading }: { stats: ProviderStats[]; loading: boolean }) {
  if (loading && stats.length === 0) {
    return (
      <div style={{ padding: 'calc(var(--spacing) * 8)', textAlign: 'center' }}>
        <span style={spinnerStyle} />
      </div>
    )
  }
  if (stats.length === 0) {
    return <EmptyState icon={<Icon name="token" size={24} />} title="暂无统计数据" />
  }
  const maxTokens = Math.max(...stats.map((s) => s.total_tokens), 1)
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'calc(var(--spacing) * 3)',
      }}
    >
      {stats.map((s, i) => {
        const barPct = (s.total_tokens / maxTokens) * 100
        const color = getModelColor(s.model)
        return (
          <div
            key={`${s.provider}-${s.model}-${i}`}
            style={{
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius)',
              padding: 'calc(var(--spacing) * 4)',
              background: 'var(--background)',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 'calc(var(--spacing) * 2)',
                gap: 'calc(var(--spacing) * 2)',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'calc(var(--spacing) * 2)',
                  minWidth: 0,
                }}
              >
                <span style={providerBadgeStyle}>{s.provider}</span>
                <span
                  style={{
                    fontSize: '0.92rem',
                    fontWeight: 500,
                    color: 'var(--foreground)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {getModelDisplayName(s.model)}
                </span>
              </div>
              <span style={{ fontSize: '0.78rem', color: 'var(--muted-foreground)' }}>
                {s.request_count} 次请求
              </span>
            </div>
            <div
              style={{
                position: 'relative',
                height: 8,
                borderRadius: 999,
                background: 'var(--muted)',
                overflow: 'hidden',
                marginBottom: 'calc(var(--spacing) * 2)',
              }}
            >
              <div
                style={{
                  position: 'absolute',
                  top: 0,
                  bottom: 0,
                  left: 0,
                  background: color,
                  borderRadius: 999,
                  transition: 'width 0.5s ease',
                  width: `${Math.max(barPct, 1)}%`,
                }}
              />
            </div>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                fontSize: '0.78rem',
                color: 'var(--muted-foreground)',
              }}
            >
              <div style={{ display: 'flex', gap: 'calc(var(--spacing) * 4)' }}>
                <span>入 {formatTokens(s.total_input_tokens)}</span>
                <span>出 {formatTokens(s.total_output_tokens)}</span>
              </div>
              <span style={{ fontWeight: 600, color: 'var(--foreground)' }}>
                {formatTokens(s.total_tokens)}
              </span>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ===== 子组件：功能统计列表（保留原 FeatureStatsCard 业务） =====
export function FeatureStatsList({ stats, loading }: { stats: FeatureStats[]; loading: boolean }) {
  if (loading && stats.length === 0) {
    return (
      <div style={{ padding: 'calc(var(--spacing) * 8)', textAlign: 'center' }}>
        <span style={spinnerStyle} />
      </div>
    )
  }
  if (stats.length === 0) {
    return <EmptyState icon={<Icon name="token" size={24} />} title="暂无统计数据" />
  }
  const featureColors: Record<string, string> = {
    chat: 'var(--chart-1)',
    generateCards: 'var(--chart-3)',
    generateSummary: 'var(--chart-5)',
    explain: 'var(--chart-4)',
  }
  const maxTokens = Math.max(...stats.map((s) => s.total_tokens), 1)
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
        gap: 'calc(var(--spacing) * 3)',
      }}
    >
      {stats.map((s) => {
        const barPct = (s.total_tokens / maxTokens) * 100
        const color = featureColors[s.feature] || 'var(--primary)'
        return (
          <div
            key={s.feature}
            style={{
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius)',
              padding: 'calc(var(--spacing) * 4)',
              background: 'var(--background)',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 'calc(var(--spacing) * 3)',
                gap: 'calc(var(--spacing) * 2)',
              }}
            >
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  padding: '0.2rem 0.6rem',
                  borderRadius: 999,
                  background: `color-mix(in srgb, ${color} 14%, transparent)`,
                  color: color,
                  fontSize: '0.72rem',
                  fontWeight: 600,
                  whiteSpace: 'nowrap',
                }}
              >
                {FEATURE_LABELS[s.feature] || s.feature}
              </span>
              <span style={{ fontSize: '0.78rem', color: 'var(--muted-foreground)' }}>
                {s.request_count} 次
              </span>
            </div>
            <div
              style={{
                position: 'relative',
                height: 8,
                borderRadius: 999,
                background: 'var(--muted)',
                overflow: 'hidden',
                marginBottom: 'calc(var(--spacing) * 2)',
              }}
            >
              <div
                style={{
                  position: 'absolute',
                  top: 0,
                  bottom: 0,
                  left: 0,
                  background: color,
                  borderRadius: 999,
                  transition: 'width 0.5s ease',
                  width: `${Math.max(barPct, 1)}%`,
                }}
              />
            </div>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                fontSize: '0.78rem',
                color: 'var(--muted-foreground)',
                gap: 'calc(var(--spacing) * 2)',
              }}
            >
              <div style={{ display: 'flex', gap: 'calc(var(--spacing) * 3)' }}>
                <span>入 {formatTokens(s.total_input_tokens)}</span>
                <span>出 {formatTokens(s.total_output_tokens)}</span>
              </div>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'calc(var(--spacing) * 2)',
                }}
              >
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.25rem',
                  }}
                >
                  <Icon name="refresh" size={12} />
                  {s.avg_duration_ms > 0 ? formatDuration(Math.round(s.avg_duration_ms)) : '-'}
                </span>
                <span style={{ fontWeight: 600, color: 'var(--foreground)' }}>
                  {formatTokens(s.total_tokens)}
                </span>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

