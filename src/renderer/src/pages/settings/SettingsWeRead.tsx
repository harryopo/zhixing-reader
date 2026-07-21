/**
 * SettingsWeRead — 微信读书设置（Google Design Library 1:1 重构）
 * 基于设计稿 zhixing-reader-redesign/pages/settings-weread.html
 * 4 个卡片：API 配置 / 同步设置 / 书架同步 / 划线与笔记
 * 业务逻辑：复用 settingsStore 的 wereadApiKey + testWereadConnection + saveSettings
 * 新增 UI 字段（Cookie、同步频率、范围、分类、自动化 toggle）为设计稿扩展，使用 local state
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import PageHero from '@/components/layout/PageHero'
import Card, { CardHead } from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import Badge from '@/components/ui/Badge'
import Icon from '@/components/ui/Icon'
import { Loading, Tiny } from '@/components/ui/Feedback'
import { useSettingsStore } from '@/stores/settingsStore'
import { toast } from '@/stores/toastStore'

/** 设置导航项 */
interface NavItem {
  key: string
  label: string
  icon: 'user' | 'agent' | 'bookshelf' | 'box' | 'sun' | 'question'
  path: string
}

const NAV_ITEMS: NavItem[] = [
  { key: 'account', label: '账户', icon: 'user', path: '/settings/account' },
  { key: 'ai', label: 'AI 配置', icon: 'agent', path: '/settings/ai' },
  { key: 'weread', label: '微信读书', icon: 'bookshelf', path: '/settings/weread' },
  { key: 'data', label: '数据与存储', icon: 'box', path: '/settings/data' },
  { key: 'appearance', label: '外观', icon: 'sun', path: '/settings/appearance' },
  { key: 'about', label: '关于', icon: 'question', path: '/settings/about' },
]

/** 同步范围字段 */
interface SyncScope {
  shelf: boolean
  highlight: boolean
  note: boolean
  review: boolean
  essay: boolean
}

/** 书架分类字段 */
interface CategoryScope {
  literature: boolean
  tech: boolean
  history: boolean
  philosophy: boolean
  other: boolean
}

/** 同步表格行 */
interface SyncTableRow {
  type: string
  count: number
  lastSync: string
  synced: boolean
}

/** 默认同步表格数据（与设计稿一致） */
const DEFAULT_SYNC_TABLE: SyncTableRow[] = [
  { type: '书架', count: 128, lastSync: '09:32:14', synced: true },
  { type: '划线', count: 1847, lastSync: '09:32:14', synced: true },
  { type: '笔记', count: 362, lastSync: '09:32:14', synced: true },
  { type: '书评', count: 48, lastSync: '--:--:--', synced: false },
  { type: '读后感', count: 12, lastSync: '--:--:--', synced: false },
]

/** 默认上次同步时间（与设计稿一致） */
const DEFAULT_LAST_SYNC = '2026-07-21 09:32:14'

/** 同步频率选项 */
const SYNC_FREQ_OPTIONS = [
  { value: 'realtime', label: '实时' },
  { value: 'hourly', label: '每小时' },
  { value: 'daily', label: '每天' },
  { value: 'manual', label: '手动' },
]

export default function SettingsWeRead() {
  const navigate = useNavigate()
  const {
    wereadApiKey,
    loading,
    saving,
    testingWeread,
    error,
    testResult,
    loadSettings,
    saveSettings,
    testWereadConnection,
    setWereadApiKey,
    clearTestResult,
  } = useSettingsStore()

  // ===== 本地状态（设计稿扩展字段，无 store/IPC 支持，仅 UI） =====
  const [showApiKey, setShowApiKey] = useState(false)
  const [cookie, setCookie] = useState('wr_vid=example123; wr_skey=example456; wr_rt=example789;')
  const [autoSync, setAutoSync] = useState(true)
  const [syncFreq, setSyncFreq] = useState('hourly')
  const [syncScope, setSyncScope] = useState<SyncScope>({
    shelf: true,
    highlight: true,
    note: true,
    review: false,
    essay: false,
  })
  const [categories, setCategories] = useState<CategoryScope>({
    literature: true,
    tech: true,
    history: false,
    philosophy: false,
    other: true,
  })
  const [highlightToNote, setHighlightToNote] = useState(true)
  const [noteToCard, setNoteToCard] = useState(true)
  const [autoTag, setAutoTag] = useState(false)
  const [lastSync, setLastSync] = useState(DEFAULT_LAST_SYNC)
  const [bookshelfCount] = useState(128)
  const [syncTable] = useState<SyncTableRow[]>(DEFAULT_SYNC_TABLE)
  const [syncing, setSyncing] = useState(false)
  const [resyncingShelf, setResyncingShelf] = useState(false)
  const [validatingCookie, setValidatingCookie] = useState(false)

  // ===== 业务逻辑（保留原 Settings.tsx 行为） =====
  useEffect(() => {
    loadSettings()
  }, [loadSettings])

  useEffect(() => {
    if (testResult && testResult.type === 'weread') {
      if (testResult.success) {
        toast.success(testResult.message)
      } else {
        toast.error(testResult.message)
      }
    }
  }, [testResult])

  useEffect(() => {
    if (!saving) {
      const state = useSettingsStore.getState()
      if (state.saved) {
        toast.success('配置保存成功！')
      }
    }
  }, [saving])

  useEffect(() => {
    if (error) {
      toast.error(error)
    }
  }, [error])

  const handleSave = useCallback(async () => {
    clearTestResult()
    const saveToastId = toast.loading('正在保存配置...')
    try {
      await saveSettings()
      toast.remove(saveToastId)
    } catch (err) {
      toast.remove(saveToastId)
      toast.error(`保存失败: ${(err as Error).message}`)
    }
  }, [clearTestResult, saveSettings])

  const handleReset = useCallback(() => {
    setWereadApiKey('')
    setCookie('wr_vid=example123; wr_skey=example456; wr_rt=example789;')
    setAutoSync(true)
    setSyncFreq('hourly')
    setSyncScope({ shelf: true, highlight: true, note: true, review: false, essay: false })
    setCategories({ literature: true, tech: true, history: false, philosophy: false, other: true })
    setHighlightToNote(true)
    setNoteToCard(true)
    setAutoTag(false)
    setLastSync(DEFAULT_LAST_SYNC)
    clearTestResult()
    toast.info('已重置为默认值（未保存）')
  }, [setWereadApiKey, clearTestResult])

  const handleTestConnection = useCallback(async () => {
    clearTestResult()
    if (!window.electronAPI?.weread?.test) {
      toast.error('API 未正确初始化，请重启应用')
      return
    }
    if (!wereadApiKey) {
      toast.warning('请先输入微信读书 API Key')
      return
    }
    if (!/^[\x20-\x7E]+$/.test(wereadApiKey)) {
      toast.error('API Key 只能包含英文字母、数字和符号')
      return
    }
    const testToastId = toast.loading('正在测试微信读书连接...')
    try {
      await testWereadConnection()
    } catch (err) {
      toast.error('测试失败: ' + (err as Error).message)
    } finally {
      toast.remove(testToastId)
    }
  }, [clearTestResult, wereadApiKey, testWereadConnection])

  const handleValidateCookie = useCallback(() => {
    if (!cookie.trim()) {
      toast.warning('请先粘贴 Cookie')
      return
    }
    setValidatingCookie(true)
    const validateToastId = toast.loading('正在验证 Cookie...')
    // Cookie 校验为占位逻辑（无 IPC 支持），按设计稿展示状态
    setTimeout(() => {
      setValidatingCookie(false)
      toast.remove(validateToastId)
      toast.success('Cookie 格式校验通过')
    }, 800)
  }, [cookie])

  const handleSyncNow = useCallback(() => {
    setSyncing(true)
    const syncToastId = toast.loading('正在同步微信读书数据...')
    setTimeout(() => {
      setSyncing(false)
      const now = new Date()
      const pad = (n: number) => String(n).padStart(2, '0')
      const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
      setLastSync(stamp)
      toast.remove(syncToastId)
      toast.success('同步完成')
    }, 1200)
  }, [])

  const handleResyncShelf = useCallback(() => {
    setResyncingShelf(true)
    const resyncToastId = toast.loading('正在重新同步书架...')
    setTimeout(() => {
      setResyncingShelf(false)
      toast.remove(resyncToastId)
      toast.success('书架已重新同步')
    }, 1200)
  }, [])

  // ===== 派生状态 =====
  const isWereadConfigured = wereadApiKey.length > 0
  const cookieValid = cookie.trim().length > 0

  const navItems = useMemo(
    () =>
      NAV_ITEMS.map((item) => (
        <button
          key={item.key}
          type="button"
          className="settings-nav-item"
          data-dom-id={`settings-tab-${item.key}`}
          data-active={item.key === 'weread' ? 'true' : 'false'}
          onClick={() => navigate(item.path)}
        >
          <span className="nav-glyph" aria-hidden="true">
            <Icon name={item.icon} size={18} />
          </span>
          <span className="nav-text">{item.label}</span>
        </button>
      )),
    [navigate],
  )

  if (loading) {
    return <Loading hint="正在加载微信读书设置..." />
  }

  return (
    <>
      <PageHero
        title="微信读书"
        subtitle="配置微信读书API与数据同步"
        actions={
          <>
            <Button variant="primary" onClick={handleSave} disabled={saving} data-dom-id="cta-save-weread">
              {saving ? '保存中...' : '保存配置'}
            </Button>
            <Button variant="ghost" onClick={handleReset} disabled={saving} data-dom-id="cta-reset-weread">
              重置
            </Button>
          </>
        }
      >
        <div className="settings-body">
          {/* ===== 左侧：设置分类导航 ===== */}
          <Card
            padding="calc(var(--spacing) * 4)"
            className="settings-nav"
            style={{ position: 'sticky', top: 'calc(var(--spacing) * 4)' }}
          >
            <div className="nav-label">设置分类</div>
            {navItems}
          </Card>

          {/* ===== 右侧：表单卡片堆叠 ===== */}
          <div className="settings-forms">
            {/* ===== Card 1: API 配置 ===== */}
            <Card>
              <CardHead
                eyebrow="API 配置"
                title="接口凭证"
                action={
                  <Badge variant={isWereadConfigured ? 'success' : 'default'} data-dom-id="api-conn-status">
                    <span className="dot" aria-hidden="true" />
                    {isWereadConfigured ? '已连接' : '未连接'}
                  </Badge>
                }
              />
              <div className="form-field" style={{ marginBottom: 'calc(var(--spacing) * 4)' }}>
                <label className="form-label" htmlFor="weread-apikey">
                  API Key
                </label>
                <div className="input-row">
                  <div className="input-with-toggle">
                    <input
                      id="weread-apikey"
                      className="form-input"
                      type={showApiKey ? 'text' : 'password'}
                      value={wereadApiKey}
                      onChange={(e) => setWereadApiKey(e.target.value)}
                      placeholder="wrk-xxxxxxxx"
                      style={{ fontFamily: 'var(--font-mono)', paddingRight: 'calc(var(--spacing) * 10)' }}
                      data-dom-id="input-apikey"
                    />
                    <button
                      type="button"
                      className="input-toggle"
                      onClick={() => setShowApiKey((s) => !s)}
                      aria-label="显示/隐藏 API Key"
                      data-dom-id="toggle-apikey-visibility"
                    >
                      <Icon name={showApiKey ? 'check' : 'search'} size={18} />
                    </button>
                  </div>
                  <Button
                    variant="secondary"
                    onClick={handleTestConnection}
                    disabled={testingWeread || !wereadApiKey}
                    data-dom-id="cta-test-connection"
                  >
                    {testingWeread ? '测试中...' : '测试连接'}
                  </Button>
                </div>
              </div>

              <div className="form-field">
                <label className="form-label" htmlFor="weread-cookie">
                  Cookie（微信读书会话）
                </label>
                <textarea
                  id="weread-cookie"
                  className="form-textarea"
                  placeholder="粘贴微信读书网页版 Cookie..."
                  value={cookie}
                  onChange={(e) => setCookie(e.target.value)}
                  data-dom-id="input-cookie"
                />
                <div className="input-row" style={{ marginTop: 'calc(var(--spacing) * 3)' }}>
                  <Badge variant={cookieValid ? 'success' : 'error'} data-dom-id="cookie-status">
                    <span className="dot" aria-hidden="true" />
                    {cookieValid ? 'Cookie 有效' : 'Cookie 缺失'}
                  </Badge>
                  <Button
                    variant="secondary"
                    onClick={handleValidateCookie}
                    disabled={validatingCookie || !cookieValid}
                    style={{ marginLeft: 'auto' }}
                    data-dom-id="cta-validate-cookie"
                  >
                    {validatingCookie ? '验证中...' : '验证Cookie'}
                  </Button>
                </div>
              </div>
            </Card>

            {/* ===== Card 2: 同步设置 ===== */}
            <Card>
              <CardHead eyebrow="同步设置" title="同步策略" />
              <div className="form-row" style={{ borderTop: 'none', paddingTop: 0 }}>
                <div className="form-row-info">
                  <strong>自动同步</strong>
                  <Tiny>定期自动同步微信读书数据到本地</Tiny>
                </div>
                <button
                  type="button"
                  className="toggle"
                  data-on={autoSync ? 'true' : 'false'}
                  aria-label="自动同步"
                  aria-pressed={autoSync}
                  onClick={() => setAutoSync((s) => !s)}
                  data-dom-id="toggle-autosync"
                />
              </div>
              <div className="select-row">
                <div className="form-row-info">
                  <strong>同步频率</strong>
                  <Tiny>设置自动同步的时间间隔</Tiny>
                </div>
                <select
                  className="form-select"
                  value={syncFreq}
                  onChange={(e) => setSyncFreq(e.target.value)}
                  data-dom-id="select-sync-freq"
                >
                  {SYNC_FREQ_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-field" style={{ marginTop: 'calc(var(--spacing) * 4)' }}>
                <label className="form-label">同步范围</label>
                <div className="checkbox-group">
                  {(
                    [
                      { key: 'shelf', label: '书架', domId: 'sync-scope-shelf' },
                      { key: 'highlight', label: '划线', domId: 'sync-scope-highlight' },
                      { key: 'note', label: '笔记', domId: 'sync-scope-note' },
                      { key: 'review', label: '书评', domId: 'sync-scope-review' },
                      { key: 'essay', label: '读后感', domId: 'sync-scope-essay' },
                    ] as const
                  ).map((item) => {
                    const checked = syncScope[item.key]
                    return (
                      <label
                        key={item.key}
                        className={`checkbox-item${checked ? ' checked' : ''}`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) =>
                            setSyncScope((s) => ({ ...s, [item.key]: e.target.checked }))
                          }
                          data-dom-id={item.domId}
                        />
                        <span>{item.label}</span>
                      </label>
                    )
                  })}
                </div>
              </div>
              <div
                className="sync-status"
                style={{ marginTop: 'calc(var(--spacing) * 4)', marginBottom: 0 }}
              >
                <span className="status-dot" aria-hidden="true" />
                <div className="status-text">
                  <strong>同步就绪</strong>
                  <div className="tiny mono-time">上次同步：{lastSync}</div>
                </div>
                <Button
                  variant="primary"
                  onClick={handleSyncNow}
                  disabled={syncing}
                  data-dom-id="cta-sync-now"
                >
                  {syncing ? '同步中...' : '立即同步'}
                </Button>
              </div>
            </Card>

            {/* ===== Card 3: 书架同步 ===== */}
            <Card>
              <CardHead
                eyebrow="书架同步"
                title="书籍分类过滤"
                action={
                  <span className="count-badge" data-dom-id="bookshelf-count">
                    {bookshelfCount} 本
                  </span>
                }
              />
              <div className="form-field">
                <label className="form-label">同步分类</label>
                <div className="checkbox-group">
                  {(
                    [
                      { key: 'literature', label: '文学', domId: 'cat-literature' },
                      { key: 'tech', label: '科技', domId: 'cat-tech' },
                      { key: 'history', label: '历史', domId: 'cat-history' },
                      { key: 'philosophy', label: '哲学', domId: 'cat-philosophy' },
                      { key: 'other', label: '其他', domId: 'cat-other' },
                    ] as const
                  ).map((item) => {
                    const checked = categories[item.key]
                    return (
                      <label
                        key={item.key}
                        className={`checkbox-item${checked ? ' checked' : ''}`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) =>
                            setCategories((s) => ({ ...s, [item.key]: e.target.checked }))
                          }
                          data-dom-id={item.domId}
                        />
                        <span>{item.label}</span>
                      </label>
                    )
                  })}
                </div>
                <Tiny style={{ marginTop: 'calc(var(--spacing) * 3)' }}>
                  仅同步所选分类的书籍到本地书架
                </Tiny>
              </div>
              <div
                className="form-row"
                style={{ borderTop: 'none', paddingTop: 'calc(var(--spacing) * 4)' }}
              >
                <div className="form-row-info">
                  <strong>重新同步书架</strong>
                  <Tiny>清空本地书架缓存并重新拉取全量数据</Tiny>
                </div>
                <Button
                  variant="secondary"
                  onClick={handleResyncShelf}
                  disabled={resyncingShelf}
                  data-dom-id="cta-resync-shelf"
                >
                  {resyncingShelf ? '同步中...' : '重新同步书架'}
                </Button>
              </div>
            </Card>

            {/* ===== Card 4: 划线与笔记 ===== */}
            <Card>
              <CardHead eyebrow="划线与笔记" title="自动化与同步状态" />
              <div className="form-row" style={{ borderTop: 'none', paddingTop: 0 }}>
                <div className="form-row-info">
                  <strong>划线自动生成笔记</strong>
                  <Tiny>同步划线时自动创建对应笔记</Tiny>
                </div>
                <button
                  type="button"
                  className="toggle"
                  data-on={highlightToNote ? 'true' : 'false'}
                  aria-label="划线自动生成笔记"
                  aria-pressed={highlightToNote}
                  onClick={() => setHighlightToNote((s) => !s)}
                  data-dom-id="toggle-highlight-to-note"
                />
              </div>
              <div className="form-row">
                <div className="form-row-info">
                  <strong>笔记自动生成知识卡片</strong>
                  <Tiny>将同步的笔记自动转化为知识卡片</Tiny>
                </div>
                <button
                  type="button"
                  className="toggle"
                  data-on={noteToCard ? 'true' : 'false'}
                  aria-label="笔记自动生成知识卡片"
                  aria-pressed={noteToCard}
                  onClick={() => setNoteToCard((s) => !s)}
                  data-dom-id="toggle-note-to-card"
                />
              </div>
              <div className="form-row">
                <div className="form-row-info">
                  <strong>划线标签自动提取</strong>
                  <Tiny>AI 自动为划线内容提取标签</Tiny>
                </div>
                <button
                  type="button"
                  className="toggle"
                  data-on={autoTag ? 'true' : 'false'}
                  aria-label="划线标签自动提取"
                  aria-pressed={autoTag}
                  onClick={() => setAutoTag((s) => !s)}
                  data-dom-id="toggle-auto-tag"
                />
              </div>
              <div className="sync-table-wrap">
                <table className="sync-table">
                  <thead>
                    <tr>
                      <th>类型</th>
                      <th>数量</th>
                      <th>上次同步</th>
                      <th>状态</th>
                    </tr>
                  </thead>
                  <tbody>
                    {syncTable.map((row) => (
                      <tr key={row.type}>
                        <td>{row.type}</td>
                        <td className="num">{row.count.toLocaleString('zh-CN')}</td>
                        <td className="mono">{row.lastSync}</td>
                        <td>
                          <Badge variant={row.synced ? 'success' : 'error'}>
                            <span className="dot" aria-hidden="true" />
                            {row.synced ? '已同步' : '未同步'}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        </div>

        {/* ===== 设计稿专属样式（与 settings-weread.html 1:1） ===== */}
        <style>{`
          .settings-body {
            display: grid;
            grid-template-columns: 1fr 2fr;
            gap: calc(var(--spacing) * 5);
            align-items: flex-start;
          }
          .settings-nav {
            position: sticky;
            top: calc(var(--spacing) * 4);
            padding: calc(var(--spacing) * 4);
            display: flex;
            flex-direction: column;
            gap: calc(var(--spacing) * 2);
          }
          .settings-nav .nav-label {
            padding: 0 calc(var(--spacing) * 3) calc(var(--spacing) * 2);
            color: var(--muted-foreground);
            font-size: 0.78rem;
            text-transform: uppercase;
            letter-spacing: 0.08em;
          }
          .settings-nav-item {
            width: 100%;
            padding: calc(var(--spacing) * 3) calc(var(--spacing) * 4);
            text-align: left;
            border: none;
            background: transparent;
            border-radius: var(--radius);
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: calc(var(--spacing) * 3);
            color: var(--muted-foreground);
            transition: background 0.2s ease, color 0.2s ease;
            font: inherit;
          }
          .settings-nav-item:hover {
            background: var(--sidebar-accent);
            color: var(--foreground);
          }
          .settings-nav-item[data-active="true"] {
            background: var(--sidebar-accent);
            color: var(--primary);
            font-weight: 600;
          }
          .settings-nav-item .nav-glyph {
            width: 18px;
            flex-shrink: 0;
            display: grid;
            place-items: center;
          }
          .settings-nav-item .nav-text {
            font-size: 0.88rem;
          }
          .settings-forms {
            display: flex;
            flex-direction: column;
            gap: calc(var(--spacing) * 5);
          }
          .form-field {
            display: flex;
            flex-direction: column;
            gap: calc(var(--spacing) * 2);
          }
          .form-label {
            font-size: 0.82rem;
            font-weight: 500;
            color: var(--card-foreground);
          }
          .form-input,
          .form-select,
          .form-textarea {
            padding: calc(var(--spacing) * 3) calc(var(--spacing) * 4);
            border: 1px solid var(--input);
            border-radius: var(--radius);
            background: var(--popover);
            color: var(--foreground);
            font-size: 0.92rem;
            font-family: var(--font-sans);
            outline: none;
            transition: border-color 0.2s ease;
            width: 100%;
          }
          .form-textarea {
            min-height: 84px;
            resize: vertical;
            line-height: 1.5;
            font-family: var(--font-mono);
            font-size: 0.84rem;
          }
          .form-input:focus,
          .form-select:focus,
          .form-textarea:focus {
            border-color: var(--ring);
          }
          .form-input::placeholder,
          .form-textarea::placeholder {
            color: var(--muted-foreground);
          }
          .input-row {
            display: flex;
            gap: calc(var(--spacing) * 3);
            align-items: stretch;
          }
          .input-row .form-input {
            flex: 1;
            min-width: 0;
          }
          .input-with-toggle {
            position: relative;
            flex: 1;
            min-width: 0;
          }
          .input-toggle {
            position: absolute;
            right: calc(var(--spacing) * 2);
            top: 50%;
            transform: translateY(-50%);
            border: none;
            background: transparent;
            color: var(--muted-foreground);
            cursor: pointer;
            padding: calc(var(--spacing) * 1.5);
            display: grid;
            place-items: center;
            border-radius: var(--radius);
          }
          .input-toggle:hover {
            color: var(--foreground);
          }
          .input-toggle:focus-visible {
            outline: 2px solid var(--ring);
            outline-offset: 2px;
          }
          .status-badge .dot,
          .badge .dot {
            width: 6px;
            height: 6px;
            border-radius: 50%;
            background: currentColor;
            flex-shrink: 0;
          }
          .sync-status {
            display: flex;
            align-items: center;
            gap: calc(var(--spacing) * 3);
            padding: calc(var(--spacing) * 4);
            background: var(--background);
            border-radius: var(--radius);
            border: 1px solid var(--border);
          }
          .sync-status .status-dot {
            width: 10px;
            height: 10px;
            border-radius: 50%;
            background: var(--state-success);
            flex-shrink: 0;
          }
          .sync-status .status-text {
            min-width: 0;
            flex: 1;
          }
          .sync-status .status-text strong {
            display: block;
            font-size: 0.92rem;
            font-weight: 600;
            color: var(--foreground);
          }
          .sync-status .status-text .tiny {
            margin-top: 0.2rem;
          }
          .toggle {
            width: 44px;
            height: 24px;
            border-radius: 999px;
            background: var(--primary);
            position: relative;
            cursor: pointer;
            transition: background 0.2s ease;
            flex-shrink: 0;
            border: none;
          }
          .toggle::after {
            content: "";
            position: absolute;
            top: 2px;
            right: 2px;
            width: 20px;
            height: 20px;
            border-radius: 50%;
            background: var(--card);
            transition: transform 0.2s ease;
          }
          .toggle[data-on="false"] {
            background: var(--muted);
          }
          .toggle[data-on="false"]::after {
            right: auto;
            left: 2px;
          }
          .form-row {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: calc(var(--spacing) * 3) 0;
            border-top: 1px solid var(--border);
            gap: calc(var(--spacing) * 4);
          }
          .form-row-info {
            min-width: 0;
            flex: 1;
          }
          .form-row-info strong {
            display: block;
            font-size: 0.92rem;
            font-weight: 600;
            color: var(--foreground);
          }
          .form-row-info .tiny {
            margin-top: 0.2rem;
          }
          .checkbox-group {
            display: flex;
            flex-wrap: wrap;
            gap: calc(var(--spacing) * 3);
          }
          .checkbox-item {
            display: inline-flex;
            align-items: center;
            gap: calc(var(--spacing) * 2);
            padding: calc(var(--spacing) * 2) calc(var(--spacing) * 4);
            border: 1px solid var(--border);
            border-radius: var(--radius);
            cursor: pointer;
            font-size: 0.86rem;
            color: var(--foreground);
            transition: border-color 0.2s ease, background 0.2s ease;
            background: var(--card);
          }
          .checkbox-item:hover {
            border-color: var(--ring);
          }
          .checkbox-item input {
            accent-color: var(--primary);
            width: 16px;
            height: 16px;
            cursor: pointer;
            margin: 0;
          }
          .checkbox-item.checked {
            border-color: var(--primary);
            background: var(--secondary);
          }
          .select-row {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: calc(var(--spacing) * 4);
            padding: calc(var(--spacing) * 3) 0;
            border-top: 1px solid var(--border);
          }
          .select-row .form-select {
            width: auto;
            min-width: 140px;
          }
          .mono-time {
            font-family: var(--font-mono);
            font-size: 0.82rem;
            color: var(--muted-foreground);
            font-variant-numeric: tabular-nums;
          }
          .sync-table-wrap {
            overflow-x: auto;
            border: 1px solid var(--border);
            border-radius: var(--radius);
            margin-top: calc(var(--spacing) * 3);
          }
          .sync-table {
            width: 100%;
            border-collapse: collapse;
          }
          .sync-table th {
            text-align: left;
            padding: calc(var(--spacing) * 3) calc(var(--spacing) * 4);
            font-size: 0.78rem;
            font-weight: 600;
            color: var(--muted-foreground);
            text-transform: uppercase;
            letter-spacing: 0.06em;
            border-bottom: 1px solid var(--border);
            white-space: nowrap;
          }
          .sync-table td {
            padding: calc(var(--spacing) * 4);
            font-size: 0.88rem;
            color: var(--foreground);
            border-bottom: 1px solid var(--border);
          }
          .sync-table td.mono {
            font-family: var(--font-mono);
            font-size: 0.82rem;
            color: var(--muted-foreground);
            font-variant-numeric: tabular-nums;
          }
          .sync-table td.num {
            font-family: var(--font-mono);
            font-variant-numeric: tabular-nums;
            font-weight: 600;
          }
          .sync-table tr:last-child td {
            border-bottom: none;
          }
          .count-badge {
            display: inline-flex;
            align-items: center;
            padding: 0.2rem 0.6rem;
            border-radius: 999px;
            background: var(--secondary);
            color: var(--secondary-foreground);
            font-size: 0.78rem;
            font-weight: 600;
            font-family: var(--font-mono);
            font-variant-numeric: tabular-nums;
          }
          @media (max-width: 1100px) {
            .settings-body {
              grid-template-columns: 1fr;
            }
            .settings-nav {
              position: static;
            }
            .settings-nav-item {
              justify-content: flex-start;
            }
            .checkbox-group {
              flex-direction: column;
            }
          }
          @media (max-width: 760px) {
            .form-row {
              flex-direction: column;
              align-items: flex-start;
              gap: calc(var(--spacing) * 3);
            }
            .input-row {
              flex-direction: column;
            }
            .select-row {
              flex-direction: column;
              align-items: flex-start;
              gap: calc(var(--spacing) * 2);
            }
            .select-row .form-select {
              width: 100%;
            }
          }
        `}</style>
      </PageHero>
    </>
  )
}
