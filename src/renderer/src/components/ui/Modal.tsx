import { ReactNode, useEffect, useRef } from 'react'
import Icon from '@/components/ui/Icon'

/**
 * Modal — 弹层原语（对话框 / 左右抽屉）
 *
 * 统一实现：遮罩点击关闭、ESC 关闭、Tab 焦点陷阱、进入聚焦、卸载回焦、
 * role=dialog + aria-modal 无障碍语义。调用方条件渲染（挂载即打开，卸载即关闭）。
 *
 * 用法：
 *   {open && <Modal onClose={close} title="编辑资料" initialFocusRef={firstInputRef}>…</Modal>}
 *   <Modal onClose={close} variant="drawer-left" ariaLabel="历史对话" padded={false}>…</Modal>
 */

export interface ModalProps {
  onClose: () => void
  children: ReactNode
  /** 标题（渲染标准头部 + 关闭按钮） */
  title?: ReactNode
  /** 标题下方辅助说明 */
  description?: ReactNode
  variant?: 'center' | 'drawer-left' | 'drawer-right'
  /** center 为 maxWidth，drawer 为固定宽度（px）。默认 center 480 / drawer 320 */
  width?: number
  zIndex?: number
  /** 进入时优先聚焦的元素；缺省聚焦面板内第一个可聚焦元素 */
  initialFocusRef?: { current: HTMLElement | null }
  /** 无 title 时的无障碍标签（抽屉自带头部时用） */
  ariaLabel?: string
  /** 面板内边距，抽屉自管布局时置 false */
  padded?: boolean
}

const FOCUSABLE =
  'button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])'

export default function Modal({
  onClose,
  children,
  title,
  description,
  variant = 'center',
  width,
  zIndex = 1000,
  initialFocusRef,
  ariaLabel,
  padded = true,
}: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  // 用 ref 捕获最新的 onClose：调用方常传非稳定闭包，若进依赖数组会每次 render
  // 重跑挂载 effect，导致反复抢焦点/回焦抖动
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    const prevFocus = document.activeElement as HTMLElement | null
    const focusTimer = window.setTimeout(() => {
      const target =
        initialFocusRef?.current ??
        panelRef.current?.querySelector<HTMLElement>(FOCUSABLE)
      target?.focus()
    }, 0)

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCloseRef.current()
        return
      }
      if (e.key !== 'Tab') return
      const panel = panelRef.current
      if (!panel) return
      const focusables = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE))
      if (focusables.length === 0) return
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', handleKeyDown)

    return () => {
      window.clearTimeout(focusTimer)
      document.removeEventListener('keydown', handleKeyDown)
      if (prevFocus && document.contains(prevFocus)) prevFocus.focus()
    }
    // 挂载即打开、卸载即关闭（调用方条件渲染），仅跑一次
  }, [])

  const isDrawer = variant !== 'center'
  const panelWidth = width ?? (isDrawer ? 320 : 480)

  const containerStyle: React.CSSProperties = {
    position: 'fixed',
    inset: 0,
    zIndex,
    background: `rgba(0, 0, 0, ${isDrawer ? 0.35 : 0.5})`,
    display: 'flex',
    justifyContent: variant === 'drawer-right' ? 'flex-end' : variant === 'drawer-left' ? 'flex-start' : 'center',
    alignItems: isDrawer ? 'stretch' : 'center',
    padding: isDrawer ? 0 : 'calc(var(--spacing) * 4)',
  }

  const panelStyle: React.CSSProperties = {
    background: 'var(--card)',
    color: 'var(--card-foreground)',
    border: isDrawer ? 'none' : '1px solid var(--border)',
    borderRight: variant === 'drawer-left' ? '1px solid var(--border)' : undefined,
    borderLeft: variant === 'drawer-right' ? '1px solid var(--border)' : undefined,
    borderRadius: isDrawer ? 0 : 'calc(var(--radius) + 4px)',
    boxShadow: isDrawer
      ? variant === 'drawer-left'
        ? '8px 0 24px rgba(0, 0, 0, 0.08)'
        : '-8px 0 24px rgba(0, 0, 0, 0.08)'
      : 'var(--shadow-lg, 0 10px 30px rgba(0,0,0,0.18))',
    width: isDrawer ? panelWidth : '100%',
    maxWidth: isDrawer ? undefined : panelWidth,
    maxHeight: isDrawer ? '100vh' : '90vh',
    height: isDrawer ? '100%' : undefined,
    overflowY: 'auto',
    padding: padded ? 'calc(var(--spacing) * 5)' : 0,
    display: 'flex',
    flexDirection: 'column',
    gap: padded ? 'calc(var(--spacing) * 4)' : 0,
  }

  return (
    <div
      style={containerStyle}
      onClick={(e) => {
        if (e.target === e.currentTarget) onCloseRef.current()
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : ariaLabel}
        style={panelStyle}
        onClick={(e) => e.stopPropagation()}
      >
        {title && (
          <div
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              justifyContent: 'space-between',
              gap: 'calc(var(--spacing) * 3)',
            }}
          >
            <div>
              <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700, color: 'var(--foreground)' }}>
                {title}
              </h3>
              {description && (
                <div style={{ marginTop: 'calc(var(--spacing) * 1)', color: 'var(--muted-foreground)', fontSize: '0.8rem' }}>
                  {description}
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => onCloseRef.current()}
              aria-label="关闭"
              style={{
                border: 'none',
                background: 'transparent',
                color: 'var(--muted-foreground)',
                cursor: 'pointer',
                padding: '0.34rem',
                borderRadius: 'var(--radius-sm, 6px)',
                display: 'grid',
                placeItems: 'center',
                flexShrink: 0,
              }}
            >
              <Icon name="close" size={15} />
            </button>
          </div>
        )}
        {children}
      </div>
    </div>
  )
}
