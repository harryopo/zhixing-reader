/**
 * Settings — 设置总页（Google Design Library 1:1 重构）
 * 基于设计稿 zhixing-reader-redesign/pages/settings.html
 * 左侧 1fr 分类导航（sticky）+ 右侧 2fr 欢迎卡片
 *
 * T10 重构说明：
 *   - 删除 Card 1「每日学习提醒」开关（用户原话 #6：关闭每日学习提醒）
 *   - 删除 Card 5「主题与字体」卡片（用户原话 #2：与外观子页重复）
 *   - 删除 Card 1/2/3/4/6 所有表单卡片（用户原话 #10：移除无法点击的功能 / 与子页重复的占位表单）
 *   - 新增「智能体编排」分类入口（用户原话 #12：智能体编排应单独放在设置中，与 AI 模型配置区分开）
 *   - 主页改为导航 + 欢迎卡片，所有具体配置交给子页处理
 */

import { useCallback, useState, type CSSProperties, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import PageHero from '@/components/layout/PageHero'
import Card, { CardHead } from '@/components/ui/Card'
import Icon from '@/components/ui/Icon'

type SettingsTab =
  | 'account'
  | 'ai'
  | 'agent'
  | 'weread'
  | 'data'
  | 'appearance'
  | 'about'

interface NavItemDef {
  key: SettingsTab
  label: string
  desc: string
  icon: ReactNode
  path: string
}

const NAV_ITEMS: NavItemDef[] = [
  {
    key: 'account',
    label: '账户',
    desc: '个人信息、继承微信读书、功能模块',
    icon: <Icon name="user" size={18} />,
    path: '/settings/account',
  },
  {
    key: 'ai',
    label: 'AI 配置',
    desc: 'LLM 服务、RAG 配置、提示词模板',
    icon: <Icon name="agent" size={18} />,
    path: '/settings/ai',
  },
  {
    key: 'agent',
    label: '智能体编排',
    desc: '意图识别、教学策略、上下文预算（与 AI 模型配置解耦）',
    icon: <Icon name="settings" size={18} />,
    path: '/settings/agent',
  },
  {
    key: 'weread',
    label: '微信读书',
    desc: 'API 配置、同步设置、书架与划线同步',
    icon: <Icon name="bookshelf" size={18} />,
    path: '/settings/weread',
  },
  {
    key: 'data',
    label: '数据与存储',
    desc: '存储用量、缓存管理、导入导出、FSRS 参数',
    icon: <Icon name="box" size={18} />,
    path: '/settings/data',
  },
  {
    key: 'appearance',
    label: '外观',
    desc: '主题模式（深浅色切换）',
    icon: <Icon name="sun" size={18} />,
    path: '/settings/appearance',
  },
  {
    key: 'about',
    label: '关于',
    desc: '应用信息、检查更新、反馈、开源许可',
    icon: <Icon name="question" size={18} />,
    path: '/settings/about',
  },
]

const EYEBROW_STYLE: CSSProperties = {
  color: 'var(--muted-foreground)',
  fontSize: '0.78rem',
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
}

export default function Settings() {
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState<SettingsTab>('account')

  const handleNavClick = useCallback(
    (item: NavItemDef) => {
      setActiveTab(item.key)
      navigate(item.path)
    },
    [navigate],
  )

  return (
    <PageHero title="设置" subtitle="管理账户、AI、智能体、数据与外观">
      <div
        className="settings-body"
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 2fr',
          gap: 'calc(var(--spacing) * 5)',
          alignItems: 'flex-start',
        }}
      >
        {/* ===== 左：设置分类导航（sticky） ===== */}
        <aside
          className="settings-nav"
          style={{
            position: 'sticky',
            top: 'calc(var(--spacing) * 4)',
            padding: 'calc(var(--spacing) * 4)',
            display: 'flex',
            flexDirection: 'column',
            gap: 'calc(var(--spacing) * 2)',
            background: 'var(--card)',
            border: '1px solid var(--border)',
            borderRadius: 'calc(var(--radius) + 6px)',
          }}
        >
          <div className="nav-label" style={{ ...EYEBROW_STYLE, padding: '0 calc(var(--spacing) * 3) calc(var(--spacing) * 2)' }}>
            设置分类
          </div>
          {NAV_ITEMS.map((item) => {
            const isActive = activeTab === item.key
            return (
              <button
                key={item.key}
                type="button"
                data-active={isActive}
                aria-current={isActive ? 'page' : undefined}
                data-dom-id={`settings-tab-${item.key}`}
                onClick={() => handleNavClick(item)}
                style={{
                  width: '100%',
                  padding: 'calc(var(--spacing) * 3) calc(var(--spacing) * 4)',
                  textAlign: 'left',
                  border: 'none',
                  borderRadius: 'var(--radius)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'calc(var(--spacing) * 3)',
                  color: isActive ? 'var(--primary)' : 'var(--muted-foreground)',
                  fontWeight: isActive ? 600 : 400,
                  background: isActive ? 'var(--sidebar-accent)' : 'transparent',
                  transition: 'background 0.2s ease, color 0.2s ease',
                  fontFamily: 'inherit',
                  fontSize: '0.88rem',
                }}
                onMouseEnter={(e) => {
                  if (!isActive) {
                    e.currentTarget.style.background = 'var(--sidebar-accent)'
                    e.currentTarget.style.color = 'var(--foreground)'
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isActive) {
                    e.currentTarget.style.background = 'transparent'
                    e.currentTarget.style.color = 'var(--muted-foreground)'
                  }
                }}
              >
                <span style={{ width: 18, flexShrink: 0, display: 'grid', placeItems: 'center' }}>
                  {item.icon}
                </span>
                <span>{item.label}</span>
              </button>
            )
          })}
        </aside>

        {/* ===== 右：欢迎卡片 ===== */}
        <div
          className="settings-welcome"
          style={{ display: 'flex', flexDirection: 'column', gap: 'calc(var(--spacing) * 5)' }}
        >
          {/* ===== Card 1：欢迎总览 ===== */}
          <Card>
            <CardHead eyebrow="总览" title="欢迎使用知行读书设置中心" />
            <p
              className="welcome-desc"
              style={{
                fontSize: '0.92rem',
                lineHeight: 1.7,
                color: 'var(--muted-foreground)',
                margin: '0 0 calc(var(--spacing) * 5)',
                maxWidth: '60ch',
              }}
            >
              在左侧选择具体分类以配置对应模块。所有设置均通过本地数据库（sql.js）持久化，
              AI 模型与智能体编排已解耦为独立模块，方便分别维护。
            </p>

            {/* ===== 分类入口网格（点击跳转子页） ===== */}
            <div
              className="entry-grid"
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(2, 1fr)',
                gap: 'calc(var(--spacing) * 4)',
              }}
            >
              {NAV_ITEMS.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  className="entry-card"
                  data-dom-id={`entry-${item.key}`}
                  onClick={() => handleNavClick(item)}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'flex-start',
                    gap: 'calc(var(--spacing) * 3)',
                    padding: 'calc(var(--spacing) * 4)',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius)',
                    background: 'var(--card)',
                    cursor: 'pointer',
                    textAlign: 'left',
                    transition: 'border-color 0.2s ease, background 0.2s ease',
                    fontFamily: 'inherit',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = 'var(--primary)'
                    e.currentTarget.style.background = 'var(--sidebar-accent)'
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = 'var(--border)'
                    e.currentTarget.style.background = 'var(--card)'
                  }}
                  onFocus={(e) => {
                    e.currentTarget.style.borderColor = 'var(--primary)'
                  }}
                  onBlur={(e) => {
                    e.currentTarget.style.borderColor = 'var(--border)'
                  }}
                >
                  <span
                    className="entry-icon"
                    aria-hidden="true"
                    style={{
                      width: 32,
                      height: 32,
                      display: 'grid',
                      placeItems: 'center',
                      borderRadius: 'var(--radius)',
                      background: 'var(--sidebar-accent)',
                      color: 'var(--primary)',
                      flexShrink: 0,
                    }}
                  >
                    {item.icon}
                  </span>
                  <span
                    className="entry-title"
                    style={{
                      fontSize: '0.95rem',
                      fontWeight: 600,
                      color: 'var(--foreground)',
                    }}
                  >
                    {item.label}
                  </span>
                  <span
                    className="entry-desc"
                    style={{
                      fontSize: '0.82rem',
                      color: 'var(--muted-foreground)',
                      lineHeight: 1.5,
                    }}
                  >
                    {item.desc}
                  </span>
                </button>
              ))}
            </div>
          </Card>

        </div>
      </div>

      {/* ===== 响应式样式 ===== */}
      <style>{`
        @media (max-width: 1100px) {
          .settings-body { grid-template-columns: 1fr !important; }
          .settings-nav { position: static !important; }
          .entry-grid { grid-template-columns: 1fr !important; }
        }
        @media (max-width: 760px) {
          .entry-card {
            padding: calc(var(--spacing) * 3) !important;
          }
        }
      `}</style>
    </PageHero>
  )
}
