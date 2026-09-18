/** Chip 组与紧凑搜索框（从 KnowledgeCards.tsx 原样搬出，逻辑未改） */
import Icon from '@/components/ui/Icon'

interface ChipsProps<T extends string> {
  items: { key: T; label: string }[]
  value: T
  onChange: (v: T) => void
}

function Chips<T extends string>({ items, value, onChange }: ChipsProps<T>) {
  return (
    <div style={{ display: 'flex', gap: 'calc(var(--spacing) * 2)', flexWrap: 'wrap' }}>
      {items.map((item) => {
        const active = item.key === value
        return (
          <button
            key={item.key}
            type="button"
            data-dom-id={`filter-${item.key}`}
            onClick={() => onChange(item.key)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              padding: 'calc(var(--spacing) * 2.5) calc(var(--spacing) * 4)',
              border: '1px solid',
              borderColor: active ? 'var(--primary)' : 'var(--border)',
              background: active ? 'var(--primary)' : 'var(--card)',
              color: active ? 'var(--primary-foreground)' : 'var(--muted-foreground)',
              borderRadius: 'var(--radius)',
              cursor: 'pointer',
              transition:
                'background 0.2s ease, color 0.2s ease, border-color 0.2s ease, transform 0.16s ease',
              fontSize: '0.84rem',
              fontWeight: active ? 600 : 400,
              whiteSpace: 'nowrap',
              fontFamily: 'inherit',
            }}
            onMouseEnter={(e) => {
              if (!active) {
                e.currentTarget.style.background = 'var(--sidebar-accent)'
                e.currentTarget.style.color = 'var(--sidebar-accent-foreground)'
                e.currentTarget.style.borderColor = 'var(--sidebar-border)'
              }
            }}
            onMouseLeave={(e) => {
              if (!active) {
                e.currentTarget.style.background = 'var(--card)'
                e.currentTarget.style.color = 'var(--muted-foreground)'
                e.currentTarget.style.borderColor = 'var(--border)'
              }
            }}
            onMouseDown={(e) => {
              e.currentTarget.style.transform = 'scale(0.97)'
            }}
            onMouseUp={(e) => {
              e.currentTarget.style.transform = 'scale(1)'
            }}
          >
            {item.label}
          </button>
        )
      })}
    </div>
  )
}

// ===== 子组件：紧凑搜索框 =====
interface CompactSearchProps {
  value: string
  onChange: (v: string) => void
  placeholder?: string
}

function CompactSearch({ value, onChange, placeholder }: CompactSearchProps) {
  return (
    <div
      role="search"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'calc(var(--spacing) * 3)',
        width: 200,
        padding: 'calc(var(--spacing) * 2) calc(var(--spacing) * 3)',
        border: '1px solid var(--input)',
        borderRadius: 'var(--radius)',
        background: 'var(--popover)',
        color: 'var(--muted-foreground)',
      }}
    >
      <Icon name="search" size={14} />
      <input
        type="search"
        aria-label="搜索卡片"
        placeholder={placeholder ?? '搜索...'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          border: 'none',
          outline: 'none',
          background: 'transparent',
          color: 'var(--foreground)',
          width: '100%',
          fontSize: '0.82rem',
          fontFamily: 'inherit',
        }}
      />
    </div>
  )
}

export { Chips, CompactSearch }
