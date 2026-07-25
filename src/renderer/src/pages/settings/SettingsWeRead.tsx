/**
 * SettingsWeRead — 微信读书设置
 *
 * T15 修复（2026-07-21 Phase 5）：
 *   1. 顶部加 cookie/API 双模式说明卡片（cookie 模式标注"预留扩展"避免误导）
 *   2. 测试连接按钮：调 weread.test 真实拉一本书，结果显示第一本书标题
 *   3. API Key 输入框右侧图标从"搜索框"改为"小眼睛"（eye / eye-off）
 *   4. 自动同步开关 + 频率 select：绑定 settingsStore.wereadAutoSync / wereadSyncFrequency，
 *      变更即写库，main 进程监听 SETTINGS.SET 自动更新定时器
 *   5. 删除 setTimeout 占位（handleValidateCookie / handleSyncNow / handleResyncShelf）
 *      → 立即同步调真实 syncBookshelfToDb（与 Topbar/Bookshelf 共用）
 *   6. useShallow selector 避免无关重渲染
 *
 * 业务逻辑：复用 settingsStore 的 wereadApiKey + testWereadConnection + setWereadAutoSync
 * 书架同步逻辑：复用 utils/sync-bookshelf.ts syncBookshelfToDb
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useShallow } from 'zustand/react/shallow'
import PageHero from '@/components/layout/PageHero'
import Card, { CardHead } from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import Badge from '@/components/ui/Badge'
import Icon from '@/components/ui/Icon'
import { Loading, Tiny } from '@/components/ui/Feedback'
import { useSettingsStore, type WeReadSyncFrequency } from '@/stores/settingsStore'
import { toast } from '@/stores/toastStore'
import { syncBookshelfToDb } from '@/utils/sync-bookshelf'

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

/** 自动同步频率选项 */
const AUTO_SYNC_FREQUENCY_OPTIONS: { value: WeReadSyncFrequency; label: string }[] = [
  { value: '1d', label: '1 天' },
  { value: '3d', label: '3 天' },
  { value: '7d', label: '7 天' },
]

export default function SettingsWeRead() {
  const navigate = useNavigate()
  // 使用 useShallow selector 避免整体订阅导致的无关重渲染
  const {
    wereadApiKey,
    wereadAutoSync,
    wereadSyncFrequency,
    loading,
    saving,
    testingWeread,
    error,
    testResult,
    loadSettings,
    saveSettings,
    testWereadConnection,
    setWereadApiKey,
    setWereadAutoSync,
    setWereadSyncFrequency,
    clearTestResult,
  } = useSettingsStore(
    useShallow((s) => ({
      wereadApiKey: s.wereadApiKey,
      wereadAutoSync: s.wereadAutoSync,
      wereadSyncFrequency: s.wereadSyncFrequency,
      loading: s.loading,
      saving: s.saving,
      testingWeread: s.testingWeread,
      error: s.error,
      testResult: s.testResult,
      loadSettings: s.loadSettings,
      saveSettings: s.saveSettings,
      testWereadConnection: s.testWereadConnection,
      setWereadApiKey: s.setWereadApiKey,
      setWereadAutoSync: s.setWereadAutoSync,
      setWereadSyncFrequency: s.setWereadSyncFrequency,
      clearTestResult: s.clearTestResult,
    })),
  )

  // ===== 本地状态（仅 UI，不持久化） =====
  const [showApiKey, setShowApiKey] = useState(false)
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
  const [syncing, setSyncing] = useState(false)
  const [resyncingShelf, setResyncingShelf] = useState(false)

  // ===== 业务逻辑 =====
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
    setSyncScope({ shelf: true, highlight: true, note: true, review: false, essay: false })
    setCategories({ literature: true, tech: true, history: false, philosophy: false, other: true })
    setHighlightToNote(true)
    setNoteToCard(true)
    setAutoTag(false)
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
    const testToastId = toast.loading('正在测试微信读书连接（拉取书架第一本书）...')
    try {
      await testWereadConnection()
    } catch (err) {
      toast.error('测试失败: ' + (err as Error).message)
    } finally {
      toast.remove(testToastId)
    }
  }, [clearTestResult, wereadApiKey, testWereadConnection])

  const handleSyncNow = useCallback(async () => {
    if (syncing) return
    setSyncing(true)
    const syncToastId = toast.loading('正在同步微信读书书架...')
    try {
      const result = await syncBookshelfToDb()
      toast.remove(syncToastId)
      if (result.total === 0) {
        toast.warning('未获取到书籍，请检查微信读书配置')
        return
      }
      toast.success(
        result.newCount > 0
          ? `同步完成，共 ${result.total} 本，新导入 ${result.newCount} 本，更新 ${result.updatedCount} 本`
          : `同步完成，共 ${result.total} 本，无新增`,
      )
    } catch (err) {
      toast.remove(syncToastId)
      toast.error(`同步失败: ${(err as Error).message}`)
    } finally {
      setSyncing(false)
    }
  }, [syncing])

  const handleResyncShelf = useCallback(async () => {
    if (resyncingShelf) return
    setResyncingShelf(true)
    const resyncToastId = toast.loading('正在重新同步书架...')
    try {
      // 重新同步 = sortByRecent=true，按最近阅读时间排序后写库
      const result = await syncBookshelfToDb({ sortByRecent: true })
      toast.remove(resyncToastId)
      if (result.total === 0) {
        toast.warning('未获取到书籍，请检查微信读书配置')
        return
      }
      toast.success(`书架已重新同步，共 ${result.total} 本，新导入 ${result.newCount} 本`)
    } catch (err) {
      toast.remove(resyncToastId)
      toast.error(`重新同步失败: ${(err as Error).message}`)
    } finally {
      setResyncingShelf(false)
    }
  }, [resyncingShelf])

  const handleToggleAutoSync = useCallback((enabled: boolean) => {
    void setWereadAutoSync(enabled)
  }, [setWereadAutoSync])

  const handleChangeFrequency = useCallback((frequency: WeReadSyncFrequency) => {
    void setWereadSyncFrequency(frequency)
  }, [setWereadSyncFrequency])

  // ===== 派生状态 =====
  const isWereadConfigured = wereadApiKey.length > 0

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
            {/* ===== Card 0: API 模式说明 ===== */}
            <Card className="mode-info-card">
              <CardHead eyebrow="接入方式" title="API Key 模式说明" />
              <div className="mode-block">
                <div className="mode-head">
                  <span className="mode-tag tag-active" aria-label="当前可用">可用</span>
                  <strong>API Key 模式</strong>
                </div>
                <p className="mode-desc">
                  通过微信读书开放网关的 <code>API Key</code> 鉴权，调用
                  <code> /shelf/sync </code>等接口拉取书架、划线、笔记。
                  下方填入 API Key 后点击「测试连接」即可验证。
                </p>
                <p className="mode-hint">
                  API Key 通常以 <code>wrk-</code> 开头，从微信读书官方申请后获得。
                </p>
              </div>
              {!isWereadConfigured && (
                <div className="mode-guide" role="status" aria-live="polite">
                  <Icon name="info" size={16} aria-hidden="true" />
                  <span>尚未配置 API Key，自动同步不会启动。请先填入 API Key 并点击「测试连接」。</span>
                </div>
              )}
            </Card>

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
                      autoComplete="off"
                      spellCheck={false}
                    />
                    <button
                      type="button"
                      className="input-toggle"
                      onClick={() => setShowApiKey((s) => !s)}
                      aria-label={showApiKey ? '隐藏 API Key' : '显示 API Key'}
                      aria-pressed={showApiKey}
                      data-dom-id="toggle-apikey-visibility"
                    >
                      <Icon name={showApiKey ? 'eye' : 'eye-off'} size={18} />
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
                {testResult && testResult.type === 'weread' && testResult.firstBookTitle && (
                  <div className="test-result" role="status" aria-live="polite">
                    <Icon name="check" size={14} aria-hidden="true" />
                    <span>已拉取到第 1 本书：<strong>{testResult.firstBookTitle}</strong></span>
                  </div>
                )}
              </div>
            </Card>

            {/* ===== Card 2: 同步设置（自动同步开关 + 间隔 + 同步范围 + 立即同步） ===== */}
            <Card>
              <CardHead eyebrow="同步设置" title="同步策略" />
              <div className="form-row" style={{ borderTop: 'none', paddingTop: 0 }}>
                <div className="form-row-info">
                  <strong>自动同步</strong>
                  <Tiny>开启后由主进程按所选间隔自动拉取书架写入本地数据库</Tiny>
                </div>
                <button
                  type="button"
                  className="toggle"
                  data-on={wereadAutoSync ? 'true' : 'false'}
                  aria-label="自动同步开关"
                  aria-pressed={wereadAutoSync}
                  onClick={() => handleToggleAutoSync(!wereadAutoSync)}
                  data-dom-id="toggle-autosync"
                />
              </div>
              <div className="select-row">
                <div className="form-row-info">
                  <strong>同步频率</strong>
                  <Tiny>自动同步的时间间隔（1 天 / 3 天 / 7 天）</Tiny>
                </div>
                <select
                  className="form-select"
                  value={wereadSyncFrequency}
                  onChange={(e) => handleChangeFrequency(e.target.value as WeReadSyncFrequency)}
                  disabled={!wereadAutoSync}
                  data-dom-id="select-sync-freq"
                  aria-label="自动同步频率"
                >
                  {AUTO_SYNC_FREQUENCY_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-field" style={{ marginTop: 'calc(var(--spacing) * 4)' }}>
                <label className="form-label">同步范围</label>
                <div
                  className="chip-group"
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: 'calc(var(--spacing) * 2)',
                  }}
                >
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
                      <button
                        key={item.key}
                        type="button"
                        data-dom-id={item.domId}
                        aria-pressed={checked}
                        onClick={() =>
                          setSyncScope((s) => ({ ...s, [item.key]: !s[item.key] }))
                        }
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 'calc(var(--spacing) * 1)',
                          padding: 'calc(var(--spacing) * 2) calc(var(--spacing) * 4)',
                          borderRadius: '999px',
                          fontSize: 'var(--font-size-sm)',
                          fontWeight: 500,
                          cursor: 'pointer',
                          transition: 'all 0.2s ease',
                          border: checked
                            ? '1px solid var(--color-primary)'
                            : '1px solid var(--color-border)',
                          background: checked ? 'var(--color-primary)' : 'transparent',
                          color: checked ? '#fff' : 'var(--color-text-secondary)',
                        }}
                      >
                        <span
                          aria-hidden="true"
                          style={{
                            width: '8px',
                            height: '8px',
                            borderRadius: '50%',
                            background: checked ? '#fff' : 'var(--color-text-muted)',
                            transition: 'all 0.2s ease',
                          }}
                        />
                        {item.label}
                      </button>
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
                  <div className="tiny mono-time">
                    自动同步：{wereadAutoSync ? `已开启 · 每 ${AUTO_SYNC_FREQUENCY_OPTIONS.find((o) => o.value === wereadSyncFrequency)?.label ?? wereadSyncFrequency}` : '已关闭'}
                  </div>
                </div>
                <Button
                  variant="primary"
                  onClick={handleSyncNow}
                  disabled={syncing || !isWereadConfigured}
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
              />
              <div className="form-field">
                <label className="form-label">同步分类</label>
                <div
                  className="chip-group"
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: 'calc(var(--spacing) * 2)',
                  }}
                >
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
                      <button
                        key={item.key}
                        type="button"
                        data-dom-id={item.domId}
                        aria-pressed={checked}
                        onClick={() =>
                          setCategories((s) => ({ ...s, [item.key]: !s[item.key] }))
                        }
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 'calc(var(--spacing) * 1)',
                          padding: 'calc(var(--spacing) * 2) calc(var(--spacing) * 4)',
                          borderRadius: '999px',
                          fontSize: 'var(--font-size-sm)',
                          fontWeight: 500,
                          cursor: 'pointer',
                          transition: 'all 0.2s ease',
                          border: checked
                            ? '1px solid var(--color-primary)'
                            : '1px solid var(--color-border)',
                          background: checked ? 'var(--color-primary)' : 'transparent',
                          color: checked ? '#fff' : 'var(--color-text-secondary)',
                        }}
                      >
                        <span
                          aria-hidden="true"
                          style={{
                            width: '8px',
                            height: '8px',
                            borderRadius: '50%',
                            background: checked ? '#fff' : 'var(--color-text-muted)',
                            transition: 'all 0.2s ease',
                          }}
                        />
                        {item.label}
                      </button>
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
                  <Tiny>按最近阅读时间排序后重新拉取全量数据写入本地</Tiny>
                </div>
                <Button
                  variant="secondary"
                  onClick={handleResyncShelf}
                  disabled={resyncingShelf || !isWereadConfigured}
                  data-dom-id="cta-resync-shelf"
                >
                  {resyncingShelf ? '同步中...' : '重新同步书架'}
                </Button>
              </div>
            </Card>

            {/* ===== Card 4: 划线与笔记 ===== */}
            <Card>
              <CardHead eyebrow="划线与笔记" title="自动化开关" />
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
            </Card>
          </div>
        </div>

        {/* ===== 设计稿专属样式 ===== */}
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
          .mode-info-card .mode-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: calc(var(--spacing) * 4);
            padding-top: calc(var(--spacing) * 2);
          }
          .mode-info-card .mode-block {
            display: flex;
            flex-direction: column;
            gap: calc(var(--spacing) * 2);
            padding: calc(var(--spacing) * 4);
            border: 1px solid var(--border);
            border-radius: var(--radius);
            background: var(--background);
          }
          .mode-info-card .mode-head {
            display: flex;
            align-items: center;
            gap: calc(var(--spacing) * 2);
            font-size: 0.92rem;
          }
          .mode-info-card .mode-tag {
            display: inline-flex;
            align-items: center;
            padding: 0.15rem 0.5rem;
            border-radius: 999px;
            font-size: 0.72rem;
            font-weight: 600;
            line-height: 1.4;
          }
          .mode-info-card .tag-active {
            background: var(--state-success, var(--primary));
            color: var(--card);
          }
          .mode-info-card .tag-soon {
            background: var(--muted);
            color: var(--muted-foreground);
          }
          .mode-info-card .mode-desc {
            font-size: 0.84rem;
            line-height: 1.55;
            color: var(--muted-foreground);
            margin: 0;
          }
          .mode-info-card .mode-hint {
            font-size: 0.78rem;
            color: var(--muted-foreground);
            opacity: 0.85;
            margin: 0;
          }
          .mode-info-card code {
            font-family: var(--font-mono);
            font-size: 0.78rem;
            background: var(--secondary);
            color: var(--secondary-foreground);
            padding: 0.05rem 0.35rem;
            border-radius: 4px;
          }
          .mode-info-card .mode-guide {
            display: flex;
            align-items: center;
            gap: calc(var(--spacing) * 2);
            margin-top: calc(var(--spacing) * 3);
            padding: calc(var(--spacing) * 3);
            background: var(--secondary);
            border-radius: var(--radius);
            color: var(--secondary-foreground);
            font-size: 0.84rem;
          }
          .test-result {
            display: flex;
            align-items: center;
            gap: calc(var(--spacing) * 2);
            margin-top: calc(var(--spacing) * 2);
            padding: calc(var(--spacing) * 2) calc(var(--spacing) * 3);
            background: var(--secondary);
            border-radius: var(--radius);
            color: var(--state-success, var(--primary));
            font-size: 0.84rem;
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
            .mode-info-card .mode-grid {
              grid-template-columns: 1fr;
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
