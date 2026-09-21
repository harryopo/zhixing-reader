/** 调用记录表（从 TokenUsage.tsx 原样搬出，逻辑未改） */
import Icon from '@/components/ui/Icon'
import { EmptyState } from '@/components/ui/Feedback'
import { formatTimeAgo } from '../../utils/db-mapper'
import type { TokenRecord } from '../../../../types/renderer'
import { FEATURE_LABELS } from './constants'
import { formatTokensFull, getModelColor, getModelDisplayName } from './format'
import { spinnerStyle } from './styles'

export function RequestLogTable({ records, loading }: { records: TokenRecord[]; loading: boolean }) {
  if (loading && records.length === 0) {
    return (
      <div
        style={{
          padding: 'calc(var(--spacing) * 8)',
          textAlign: 'center',
        }}
      >
        <span style={spinnerStyle} />
      </div>
    )
  }
  if (records.length === 0) {
    return (
      <EmptyState
        icon={<Icon name="token" size={24} />}
        title="暂无调用记录"
        description="使用 AI 功能后将自动记录 Token 消耗"
      />
    )
  }
  return (
    <>
      {/* 表头 */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1.5fr 1fr 0.8fr 0.8fr 0.7fr',
          gap: 'calc(var(--spacing) * 3)',
          padding: '0 calc(var(--spacing) * 4) calc(var(--spacing) * 2)',
          fontSize: '0.78rem',
          color: 'var(--muted-foreground)',
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
        }}
      >
        <span>会话</span>
        <span>模型</span>
        <span>输入 tokens</span>
        <span>输出 tokens</span>
        <span>时间</span>
      </div>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 'calc(var(--spacing) * 2)',
        }}
      >
        {records.map((record) => {
          const modelColor = getModelColor(record.model)
          return (
            <div
              key={record.id}
              // 这一行原来是 role="button" + tabIndex + 手型光标 + 悬停描边，
              // 但**没有任何点击行为**（键盘回车也没反应）—— 视觉和语义都在承诺一个不存在的功能。
              // 现在老老实实当一行数据。
              style={{
                display: 'grid',
                gridTemplateColumns: '1.5fr 1fr 0.8fr 0.8fr 0.7fr',
                gap: 'calc(var(--spacing) * 3)',
                alignItems: 'center',
                background: 'var(--background)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius)',
                padding: 'calc(var(--spacing) * 3.5) calc(var(--spacing) * 4)',
                transition: 'border-color 0.2s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = 'var(--ring)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = 'var(--border)'
              }}
            >
              <span
                style={{
                  minWidth: 0,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  fontSize: '0.88rem',
                  color: 'var(--foreground)',
                }}
              >
                {FEATURE_LABELS[record.feature] || record.feature}
              </span>
              <span>
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    padding: '0.2rem 0.6rem',
                    borderRadius: 999,
                    background: modelColor,
                    color: 'var(--primary-foreground)',
                    fontSize: '0.72rem',
                    fontWeight: 500,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {getModelDisplayName(record.model)}
                </span>
              </span>
              <span
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '0.85rem',
                  whiteSpace: 'nowrap',
                  color: 'var(--foreground)',
                }}
              >
                {formatTokensFull(record.input_tokens)}
              </span>
              <span
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '0.85rem',
                  whiteSpace: 'nowrap',
                  color: 'var(--foreground)',
                }}
              >
                {formatTokensFull(record.output_tokens)}
              </span>
              <span
                style={{
                  fontSize: '0.8rem',
                  color: 'var(--muted-foreground)',
                  whiteSpace: 'nowrap',
                }}
              >
                {formatTimeAgo(record.created_at)}
              </span>
            </div>
          )
        })}
      </div>
    </>
  )
}

