export interface ChipsProps<T extends string> {
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
              fontSize: '0.85rem',
              fontWeight: active ? 600 : 500,
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


export { Chips }
