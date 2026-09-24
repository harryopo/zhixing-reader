/** 方法论详情面板（从 Methodologies.tsx 原样搬出，逻辑未改） */
import Button from '@/components/ui/Button'
import Icon from '@/components/ui/Icon'
import { SourceHighlights } from '@/components/SourceHighlights'
import { safeNum, safeStr, formatDateShort } from '../../utils/db-mapper'
import type { MethodologyItem } from './model'
import { IconBookOpen } from './icons'
import { getMasteryLabel, getMasteryProgress, getTriggerBadge } from './helpers'

interface MethodDetailPanelProps {
  methodology: MethodologyItem
  index: number
  bookTitle: string
  onClose: () => void
  onDelete: () => void
  onInjectChat: () => void
  onExportSkill: () => void
}

function MethodDetailPanel({
  methodology,
  index,
  bookTitle,
  onClose,
  onDelete,
  onInjectChat,
  onExportSkill,
}: MethodDetailPanelProps) {
  const pct = getMasteryProgress(methodology.masteryLevel)
  const lvl = getMasteryLabel(methodology.masteryLevel)
  const badge = getTriggerBadge(methodology, index)
  const steps = methodology.steps ?? []
  const updatedAt = methodology.updatedAt

  return (
    <>
      {/* 头部 */}
      <div
        className="md-head"
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: 'calc(var(--spacing) * 3)',
        }}
      >
        <div className="md-head-info" style={{ minWidth: 0, flex: 1 }}>
          {badge && (
            <span
              className="md-trigger"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.35rem',
                padding: '0.28rem 0.7rem',
                borderRadius: 999,
                fontSize: '0.72rem',
                fontWeight: 600,
                whiteSpace: 'nowrap',
                lineHeight: 1,
                background: badge.bg,
                color: badge.color,
              }}
            >
              {badge.text}
            </span>
          )}
          <h3
            style={{
              fontSize: '1.15rem',
              fontWeight: 700,
              margin: 'calc(var(--spacing) * 3) 0 0',
              color: 'var(--card-foreground)',
              textWrap: 'balance',
              wordBreak: 'keep-all',
              overflowWrap: 'break-word',
            }}
          >
            {safeStr(methodology.name)}
          </h3>
          {methodology.nameEn && (
            <div
              className="md-name-en"
              style={{
                fontSize: '0.78rem',
                color: 'var(--muted-foreground)',
                marginTop: '0.25rem',
                fontFamily: 'var(--font-mono)',
              }}
            >
              {safeStr(methodology.nameEn)}
            </div>
          )}
        </div>
        <button
          className="md-close"
          type="button"
          data-dom-id="detail-close"
          aria-label="关闭详情"
          onClick={onClose}
          style={{
            width: 32,
            height: 32,
            display: 'grid',
            placeItems: 'center',
            border: '1px solid var(--border)',
            background: 'var(--card)',
            color: 'var(--muted-foreground)',
            borderRadius: 'var(--radius)',
            cursor: 'pointer',
            flexShrink: 0,
            transition: 'background 0.2s ease, color 0.2s ease, border-color 0.2s ease',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'var(--sidebar-accent)'
            e.currentTarget.style.color = 'var(--sidebar-accent-foreground)'
            e.currentTarget.style.borderColor = 'var(--sidebar-border)'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'var(--card)'
            e.currentTarget.style.color = 'var(--muted-foreground)'
            e.currentTarget.style.borderColor = 'var(--border)'
          }}
        >
          <Icon name="close" size={15} />
        </button>
      </div>

      {/* 触发场景 */}
      {methodology.triggerScenario && (
        <div className="md-section" style={{ display: 'flex', flexDirection: 'column', gap: 'calc(var(--spacing) * 2.5)' }}>
          <div className="eyebrow" style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--muted-foreground)', fontWeight: 600 }}>
            触发场景
          </div>
          <p style={{ fontSize: '0.86rem', lineHeight: 1.65, color: 'var(--card-foreground)', margin: 0 }}>
            {safeStr(methodology.triggerScenario)}
          </p>
        </div>
      )}

      {/* 四步骤 */}
      {steps.length > 0 && (
        <div className="md-section" style={{ display: 'flex', flexDirection: 'column', gap: 'calc(var(--spacing) * 2.5)' }}>
          <div className="eyebrow" style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--muted-foreground)', fontWeight: 600 }}>
            四步骤
          </div>
          <div className="steps-list" style={{ display: 'flex', flexDirection: 'column', gap: 'calc(var(--spacing) * 3)' }}>
            {steps.map((step, i) => {
              // 兼容 "标题：描述" 或 "标题。描述" 格式：尝试拆分
              const sep = step.match(/[：:。]\s*/)
              const strong = sep ? step.slice(0, sep.index).trim() : ''
              const desc = sep && sep.index !== undefined ? step.slice(sep.index + sep[0].length).trim() : ''
              return (
                <div className="step-item" key={i} style={{ display: 'flex', gap: 'calc(var(--spacing) * 3)', alignItems: 'flex-start' }}>
                  <div
                    className="step-num"
                    style={{
                      width: 26,
                      height: 26,
                      borderRadius: '50%',
                      background: 'var(--primary)',
                      color: 'var(--primary-foreground)',
                      display: 'grid',
                      placeItems: 'center',
                      fontWeight: 700,
                      fontSize: '0.78rem',
                      flexShrink: 0,
                      fontFamily: 'var(--font-mono)',
                    }}
                  >
                    {i + 1}
                  </div>
                  <div className="step-content" style={{ minWidth: 0, flex: 1 }}>
                    {strong && (
                      <strong style={{ fontSize: '0.86rem', fontWeight: 600, color: 'var(--card-foreground)', display: 'block' }}>
                        {strong}
                      </strong>
                    )}
                    <p style={{ fontSize: '0.8rem', color: 'var(--muted-foreground)', marginTop: strong ? '0.2rem' : 0, lineHeight: 1.55, margin: strong ? '0.2rem 0 0' : 0 }}>
                      {desc || (strong ? '' : safeStr(step))}
                    </p>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* 输出格式 */}
      {methodology.outputFormat && (
        <div className="md-section" style={{ display: 'flex', flexDirection: 'column', gap: 'calc(var(--spacing) * 2.5)' }}>
          <div
            className="eyebrow"
            title="应用该方法论时产出的成果形式，例如文本摘要、知识卡片、思维导图、大纲等"
            style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--muted-foreground)', fontWeight: 600 }}
          >
            输出格式
          </div>
          <div
            className="md-output"
            style={{
              padding: 'calc(var(--spacing) * 3.5)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius)',
              background: 'var(--muted)',
              fontSize: '0.82rem',
              lineHeight: 1.6,
              color: 'var(--card-foreground)',
              fontFamily: 'var(--font-mono)',
            }}
          >
            {safeStr(methodology.outputFormat)}
          </div>
        </div>
      )}

      {/* 应用示例 */}
      {methodology.examples && (
        <div className="md-section" style={{ display: 'flex', flexDirection: 'column', gap: 'calc(var(--spacing) * 2.5)' }}>
          <div className="eyebrow" style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--muted-foreground)', fontWeight: 600 }}>
            应用示例
          </div>
          <div
            className="md-example"
            style={{
              padding: 'calc(var(--spacing) * 3.5)',
              border: '1px solid var(--border)',
              borderLeft: '3px solid var(--primary)',
              borderRadius: 'var(--radius)',
              background: 'var(--card)',
              fontSize: '0.82rem',
              lineHeight: 1.65,
              color: 'var(--muted-foreground)',
            }}
          >
            {safeStr(methodology.examples)}
          </div>
        </div>
      )}

      {/* 掌握度 */}
      <div className="md-section" style={{ display: 'flex', flexDirection: 'column', gap: 'calc(var(--spacing) * 2.5)' }}>
        <div className="eyebrow" style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--muted-foreground)', fontWeight: 600 }}>
          掌握度
        </div>
        <div className="md-mastery-row" style={{ display: 'flex', alignItems: 'center', gap: 'calc(var(--spacing) * 4)', flexWrap: 'wrap' }}>
          <div className="md-mastery-bar" style={{ flex: 1, minWidth: 120 }}>
            <div
              className="progress-track"
              style={{
                width: '100%',
                height: 6,
                background: 'var(--muted)',
                borderRadius: 999,
                overflow: 'hidden',
              }}
            >
              <div
                className="progress-fill"
                style={{
                  height: '100%',
                  width: `${pct}%`,
                  background: 'var(--primary)',
                  transition: 'width 0.3s ease',
                }}
              />
            </div>
          </div>
          <div
            className="md-mastery-stats"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'calc(var(--spacing) * 4)',
              fontSize: '0.78rem',
              color: 'var(--muted-foreground)',
              flexShrink: 0,
            }}
          >
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', whiteSpace: 'nowrap', fontFamily: 'var(--font-mono)' }}>
              {pct}%
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', whiteSpace: 'nowrap', fontFamily: 'var(--font-mono)' }}>
              练习 {safeNum(methodology.practiceCount)} 次
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', whiteSpace: 'nowrap', fontFamily: 'var(--font-mono)' }}>
              {lvl} · 最近 {formatDateShort(updatedAt)}
            </span>
          </div>
        </div>
      </div>

      {/* 说明（方法论自己的描述）—— 以前它被摆在「来源划线」标题下，名不副实 */}
      {methodology.description && (
        <div className="md-section" style={{ display: 'flex', flexDirection: 'column', gap: 'calc(var(--spacing) * 2)' }}>
          <div className="eyebrow" style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--muted-foreground)', fontWeight: 600 }}>
            说明
          </div>
          <p
            style={{
              margin: 0,
              fontSize: '0.86rem',
              lineHeight: 1.7,
              color: 'var(--card-foreground)',
              textWrap: 'pretty',
            }}
          >
            {safeStr(methodology.description)}
          </p>
        </div>
      )}

      {/* 出处：出自哪本书、哪几条划线 */}
      <div className="md-section" style={{ display: 'flex', flexDirection: 'column', gap: 'calc(var(--spacing) * 2.5)' }}>
        <div className="eyebrow" style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--muted-foreground)', fontWeight: 600 }}>
          出处
        </div>
        <div
          className="md-source"
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 'calc(var(--spacing) * 2.5)',
            padding: 'calc(var(--spacing) * 3.5)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius)',
            background: 'var(--popover)',
          }}
        >
          <div
            className="md-source-head"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'calc(var(--spacing) * 3)',
              fontSize: '0.8rem',
            }}
          >
            <span className="glyph" style={{ width: '1rem', flex: '0 0 1rem', color: 'var(--primary)' }}>
              <IconBookOpen size={15} />
            </span>
            <b style={{ fontWeight: 600, color: 'var(--card-foreground)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {bookTitle}
            </b>
            {methodology.createdAt && (
              <span style={{ marginLeft: 'auto', fontSize: '0.72rem', color: 'var(--muted-foreground)' }}>
                创建于 {formatDateShort(methodology.createdAt)}
              </span>
            )}
          </div>
          {/* 真正的来源划线：id 早就存在 source_highlight_ids 里，以前从没露过面 */}
          <SourceHighlights
            bookId={methodology.bookId}
            highlightIds={methodology.sourceHighlightIds ?? []}
          />
        </div>
      </div>

      {/* 操作按钮 */}
      <div
        className="md-actions"
        style={{
          display: 'flex',
          gap: 'calc(var(--spacing) * 3)',
          marginTop: 'calc(var(--spacing) * 2)',
          flexWrap: 'wrap',
          paddingTop: 'calc(var(--spacing) * 4)',
          borderTop: '1px solid var(--border)',
        }}
      >
        <Button variant="primary" onClick={onInjectChat} data-dom-id="cta-inject-chat">
          <Icon name="chat" size={15} /> 注入AI对话
        </Button>
        <Button variant="ghost" onClick={onExportSkill} data-dom-id="cta-export-skill">
          <Icon name="file" size={15} /> 导出为 Skill
        </Button>
        <Button
          variant="ghost"
          onClick={onDelete}
          data-dom-id="cta-delete"
          style={{ marginLeft: 'auto', color: 'var(--destructive)', borderColor: 'var(--destructive)' }}
        >
          <Icon name="trash" size={15} /> 删除
        </Button>
        <p className="text-sm text-gray-500" style={{ width: '100%', fontSize: '0.82rem' }}>
          方法论来自 AI 提取，暂不支持本地编辑；可删除后重新提取
        </p>
      </div>
    </>
  )
}

export { MethodDetailPanel }
