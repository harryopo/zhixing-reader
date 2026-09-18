/** 导出生词本对话框（从 VocabularyPage.tsx 原样搬出，逻辑未改） */
import Button from '@/components/ui/Button'
import Modal from '@/components/ui/Modal'

// ===== 子组件：导出 Modal =====
interface ExportModalProps {
  format: 'csv' | 'anki'
  onFormatChange: (f: 'csv' | 'anki') => void
  onConfirm: () => void
  onCancel: () => void
  exporting: boolean
  count: number
}
function ExportModal({ format, onFormatChange, onConfirm, onCancel, exporting, count }: ExportModalProps) {
  const requestClose = () => {
    if (!exporting) onCancel()
  }

  return (
    <Modal
      onClose={requestClose}
      title="导出生词本"
      description={`将导出 ${count} 个生词，请选择导出格式：`}
      width={420}
      overlayStyle={{ animation: 'export-scrim-in 0.2s ease' }}
    >
      <style>{`@keyframes export-scrim-in { from { opacity: 0 } to { opacity: 1 } }`}</style>

        {/* 格式选择 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'calc(var(--spacing) * 2)' }}>
          <label
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 'calc(var(--spacing) * 3)',
              padding: 'calc(var(--spacing) * 3)',
              border: '1px solid',
              borderColor: format === 'csv' ? 'var(--primary)' : 'var(--border)',
              borderRadius: 'var(--radius)',
              cursor: 'pointer',
              background: format === 'csv' ? 'var(--popover)' : 'transparent',
              transition: 'border-color 0.2s ease, background 0.2s ease',
              font: 'inherit',
            }}
          >
            <input
              type="radio"
              name="export-format"
              value="csv"
              checked={format === 'csv'}
              onChange={() => onFormatChange('csv')}
              style={{ marginTop: '0.2rem', cursor: 'pointer' }}
            />
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
              <strong style={{ fontSize: '0.92rem', color: 'var(--card-foreground)' }}>CSV 格式</strong>
              <span style={{ fontSize: '0.78rem', color: 'var(--muted-foreground)', lineHeight: 1.5 }}>
                Excel/WPS 可直接打开，含音标、词性、释义、例句等字段（UTF-8 BOM，已防御公式注入）
              </span>
            </div>
          </label>

          <label
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 'calc(var(--spacing) * 3)',
              padding: 'calc(var(--spacing) * 3)',
              border: '1px solid',
              borderColor: format === 'anki' ? 'var(--primary)' : 'var(--border)',
              borderRadius: 'var(--radius)',
              cursor: 'pointer',
              background: format === 'anki' ? 'var(--popover)' : 'transparent',
              transition: 'border-color 0.2s ease, background 0.2s ease',
              font: 'inherit',
            }}
          >
            <input
              type="radio"
              name="export-format"
              value="anki"
              checked={format === 'anki'}
              onChange={() => onFormatChange('anki')}
              style={{ marginTop: '0.2rem', cursor: 'pointer' }}
            />
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
              <strong style={{ fontSize: '0.92rem', color: 'var(--card-foreground)' }}>Anki 格式</strong>
              <span style={{ fontSize: '0.78rem', color: 'var(--muted-foreground)', lineHeight: 1.5 }}>
                TSV 制表符分隔（front/back/tags），可直接导入 Anki（导入时勾选「字段以制表符分隔」）
              </span>
            </div>
          </label>
        </div>

        {/* 操作按钮 */}
        <div style={{ display: 'flex', gap: 'calc(var(--spacing) * 3)', justifyContent: 'flex-end' }}>
          <Button variant="ghost" onClick={onCancel} disabled={exporting}>
            取消
          </Button>
          <Button variant="primary" onClick={onConfirm} disabled={exporting}>
            {exporting ? '导出中...' : '导出'}
          </Button>
        </div>
    </Modal>
  )
}

export { ExportModal }
