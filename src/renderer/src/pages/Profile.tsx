/**
 * Profile — 个人档案（Google Design Library 1:1 重构）
 * 基于设计稿 zhixing-reader-redesign/pages/profile.html
 * 4 层结构：Profile header / Yearly KPI / Heat map + Type donut / Achievement badges
 * 所有数据通过 IPC 真实加载（profileStore + vocabulary + settings + stats + book）
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import PageHero from '@/components/layout/PageHero'
import Card, { CardHead } from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import Badge from '@/components/ui/Badge'
import { Loading, Trend } from '@/components/ui/Feedback'
import { useProfileStore } from '../stores/profileStore'
import { useSettingsStore } from '../stores/settingsStore'
import { toast } from '../stores/toastStore'
import { safeNum, safeStr } from '../utils/db-mapper'

/** 图表色板（与设计稿 chart-1/5/3/2 对齐） */
const CHART_COLORS = ['var(--chart-1)', 'var(--chart-5)', 'var(--chart-3)', 'var(--chart-2)']

/** 热力图尺寸：26 周 × 7 天 = 182 格 */
const HEAT_WEEKS = 26
const HEAT_DAYS = 7

/** 热力图等级阈值（按阅读秒数） */
function levelForSeconds(seconds: number): number {
  if (seconds <= 0) return 0
  if (seconds < 1800) return 1 // < 30 分钟
  if (seconds < 3600) return 2 // < 60 分钟
  if (seconds < 7200) return 3 // < 120 分钟
  return 4
}

/** 格式化阅读时长（中文长格式，保留原逻辑） */
function formatTime(seconds: number): string {
  if (seconds < 60) return `${seconds}秒`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}分钟`
  return `${Math.floor(seconds / 3600)}小时${Math.floor((seconds % 3600) / 60)}分钟`
}

interface BookRow {
  id: string
  title: string
  author: string
  cover: string
  category?: string
}

interface DailyStatsRow {
  date: string
  readingTime: number
  readingTimeSeconds?: number
}

interface UserProfile {
  nickname: string
  joinedAt: string
  location: string
  bio: string
}

const DEFAULT_PROFILE: UserProfile = {
  nickname: '读书人',
  joinedAt: new Date(Date.now() - 287 * 86400000).toISOString(),
  location: '北京',
  bio: '通过阅读建立认知体系，用笔记与复习巩固成长。相信慢即是快。',
}

interface TypeSlice {
  name: string
  count: number
  pct: number
}

export default function Profile() {
  const { stats, achievements, loading, error, fetchStats } = useProfileStore()

  // 成绩勋章显示开关（settingsStore 持久化）
  const profileBadgesEnabled = useSettingsStore((s) => s.profileBadgesEnabled)
  const setProfileBadgesEnabled = useSettingsStore((s) => s.setProfileBadgesEnabled)
  const loadSettings = useSettingsStore((s) => s.loadSettings)

  // 扩展数据源：生词数 / 用户设置 / 半年热力数据 / 类型分布
  const [vocabCount, setVocabCount] = useState(0)
  const [profile, setProfile] = useState<UserProfile>(DEFAULT_PROFILE)
  const [heatLevels, setHeatLevels] = useState<number[]>(() => Array(HEAT_WEEKS * HEAT_DAYS).fill(0))
  const [typeDist, setTypeDist] = useState<TypeSlice[]>([])

  // 编辑资料 Modal 状态
  const [editModalOpen, setEditModalOpen] = useState(false)
  const [editForm, setEditForm] = useState<UserProfile>(DEFAULT_PROFILE)
  const [editSaving, setEditSaving] = useState(false)
  const editModalRef = useRef<HTMLDivElement>(null)
  const editFirstInputRef = useRef<HTMLInputElement>(null)

  // 确保全局设置（含 profileBadgesEnabled）已加载
  useEffect(() => {
    void loadSettings()
  }, [loadSettings])

  useEffect(() => {
    fetchStats()
  }, [fetchStats])

  // 加载扩展数据（独立 effect，避免阻塞 profileStore 首屏）
  useEffect(() => {
    const loadExtras = async () => {
      const api = window.electronAPI
      if (!api) return

      // 1. 生词总数
      try {
        const vocabStats = await api.vocabulary.getStats()
        const row = vocabStats as unknown as Record<string, unknown>
        setVocabCount(safeNum(row.total ?? row.totalCount ?? row.count ?? 0))
      } catch {
        /* 非致命：保持默认 0 */
      }

      // 2. 用户设置（昵称 / 加入日期 / 城市 / 简介）
      try {
        const [nickname, joinedAt, location, bio] = await Promise.all([
          api.settings.get('userNickname'),
          api.settings.get('userJoinedAt'),
          api.settings.get('userLocation'),
          api.settings.get('userBio'),
        ])
        setProfile({
          nickname: safeStr(nickname) || DEFAULT_PROFILE.nickname,
          joinedAt: safeStr(joinedAt) || DEFAULT_PROFILE.joinedAt,
          location: safeStr(location) || DEFAULT_PROFILE.location,
          bio: safeStr(bio) || DEFAULT_PROFILE.bio,
        })
      } catch {
        /* 非致命：保持默认 */
      }

      // 3. 半年热力数据（过去 26 周 = 182 天）
      try {
        const today = new Date()
        const end = today.toISOString().split('T')[0]
        const start = new Date(today.getTime() - (HEAT_WEEKS * 7 - 1) * 86400000)
          .toISOString()
          .split('T')[0]
        const range = (await api.stats.getRange(start, end)) as unknown as DailyStatsRow[]
        const levels = Array(HEAT_WEEKS * HEAT_DAYS).fill(0)
        const startMs = new Date(start).getTime()
        for (const row of range ?? []) {
          const seconds = safeNum(
            row.readingTime ?? row.readingTimeSeconds ?? 0,
          )
          const dayIdx = Math.floor(
            (new Date(row.date).getTime() - startMs) / 86400000,
          )
          if (dayIdx >= 0 && dayIdx < levels.length) {
            levels[dayIdx] = levelForSeconds(seconds)
          }
        }
        setHeatLevels(levels)
      } catch {
        /* 非致命：保持全 0 */
      }

      // 4. 类型分布（基于 book.getAll 的 category 字段聚合）
      try {
        const books = (await api.book.getAll()) as unknown as BookRow[]
        const grouped = new Map<string, number>()
        for (const b of books ?? []) {
          const cat = safeStr(b.category) || '其他'
          grouped.set(cat, (grouped.get(cat) ?? 0) + 1)
        }
        const sorted = Array.from(grouped.entries()).sort((a, b) => b[1] - a[1])
        const totalBooks = books?.length ?? 0
        if (totalBooks > 0) {
          const top3 = sorted.slice(0, 3)
          const restCount = sorted.slice(3).reduce((s, [, n]) => s + n, 0)
          const slices: TypeSlice[] = top3.map(([name, count]) => ({
            name,
            count,
            pct: Math.round((count / totalBooks) * 100),
          }))
          if (restCount > 0) {
            slices.push({ name: '其他', count: restCount, pct: Math.round((restCount / totalBooks) * 100) })
          }
          setTypeDist(slices)
        }
      } catch {
        /* 非致命：保持空数组 */
      }
    }
    loadExtras()
  }, [])

  // ===== 派生数据 =====
  const unlockedAchievements = useMemo(
    () => achievements.filter((a) => a.unlockedAt),
    [achievements],
  )

  const joinedDays = useMemo(() => {
    const ms = Date.now() - new Date(profile.joinedAt).getTime()
    return Math.max(0, Math.floor(ms / 86400000))
  }, [profile.joinedAt])

  const joinedDateStr = useMemo(() => {
    const d = new Date(profile.joinedAt)
    if (isNaN(d.getTime())) return '—'
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }, [profile.joinedAt])

  const yearlyReadingHours = useMemo(
    () => Math.floor(stats.totalReadingTime / 3600),
    [stats.totalReadingTime],
  )

  const avgDailyMinutes = useMemo(
    () => Math.floor(stats.averageDailyReadingTime / 60),
    [stats.averageDailyReadingTime],
  )

  // 类型分布 conic-gradient 字符串
  const donutGradient = useMemo(() => {
    if (typeDist.length === 0) return 'conic-gradient(var(--muted) 0 100%)'
    const stops = typeDist.map((slice, i) => {
      const color = CHART_COLORS[i % CHART_COLORS.length]
      const start = i === 0 ? 0 : typeDist.slice(0, i).reduce((s, x) => s + x.pct, 0)
      const end = start + slice.pct
      return `${color} ${start}% ${end}%`
    })
    return `conic-gradient(${stops.join(', ')})`
  }, [typeDist])

  // ===== 编辑资料 Modal =====
  const openEditModal = () => {
    // 打开时把当前 profile 复制到 editForm，避免编辑过程中污染展示数据
    setEditForm({ ...profile })
    setEditModalOpen(true)
  }

  const closeEditModal = () => {
    setEditModalOpen(false)
  }

  const handleSaveEdit = async () => {
    setEditSaving(true)
    try {
      const api = window.electronAPI
      if (api) {
        await Promise.all([
          api.settings.set('userNickname', editForm.nickname),
          api.settings.set('userJoinedAt', editForm.joinedAt),
          api.settings.set('userLocation', editForm.location),
          api.settings.set('userBio', editForm.bio),
        ])
      }
      setProfile({ ...editForm })
      toast.success('资料已保存')
      setEditModalOpen(false)
    } catch (err) {
      toast.error(`保存失败: ${(err as Error).message}`)
    } finally {
      setEditSaving(false)
    }
  }

  // ESC 关闭 Modal + 焦点 trap
  useEffect(() => {
    if (!editModalOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setEditModalOpen(false)
        return
      }
      if (e.key !== 'Tab') return
      const panel = editModalRef.current
      if (!panel) return
      const focusables = panel.querySelectorAll<HTMLElement>(
        'button, a, input, select, textarea, [tabindex]:not([tabindex="-1"])',
      )
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
    window.addEventListener('keydown', handleKeyDown)
    // 进入时聚焦第一个输入框；退出时由调用方恢复焦点
    const t = window.setTimeout(() => editFirstInputRef.current?.focus(), 0)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.clearTimeout(t)
    }
  }, [editModalOpen])

  // ===== 分享按钮：生成分享文本并复制到剪贴板 =====
  const handleShare = async () => {
    const lines = [
      `「${profile.nickname}」的知行读书档案`,
      `加入 ${joinedDateStr} · 已坚持 ${stats.currentStreak} 天`,
      `藏书 ${stats.totalBooks} 本 · 完成 ${stats.finishedBooks} 本 · 笔记 ${stats.totalHighlights} 条`,
      `复习 ${stats.totalReviews} 次 · 卡片 ${stats.totalCards} 张 · 生词 ${vocabCount} 个`,
      `年度阅读 ${yearlyReadingHours} 小时 · 日均 ${avgDailyMinutes} 分钟`,
      '— 来自「知行读书」阅读成长工作台',
    ]
    const text = lines.join('\n')
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text)
      } else {
        // 回退方案：临时 textarea + execCommand
        const ta = document.createElement('textarea')
        ta.value = text
        ta.style.position = 'fixed'
        ta.style.opacity = '0'
        document.body.appendChild(ta)
        ta.select()
        document.execCommand('copy')
        document.body.removeChild(ta)
      }
      toast.success('分享文本已复制到剪贴板')
    } catch (err) {
      toast.error(`复制失败: ${(err as Error).message}`)
    }
  }

  // ===== 加载与错误状态 =====
  if (loading) {
    return <Loading hint="正在加载个人档案..." />
  }

  if (error) {
    return (
      <div
        style={{
          padding: 'calc(var(--spacing) * 12) calc(var(--spacing) * 6)',
          textAlign: 'center',
          color: 'var(--destructive)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 'calc(var(--spacing) * 4)',
        }}
      >
        <p style={{ margin: 0, fontSize: '0.95rem' }}>加载失败: {error}</p>
        <Button variant="primary" onClick={fetchStats}>重试</Button>
      </div>
    )
  }

  return (
    <>
      <PageHero
        title="个人档案"
        subtitle={`知行读书 · 加入 ${joinedDays} 天`}
        actions={
          <>
            <Button variant="secondary" data-dom-id="cta-edit" onClick={openEditModal}>编辑资料</Button>
            <Button variant="ghost" data-dom-id="cta-share" onClick={handleShare}>分享</Button>
          </>
        }
      >
        {/* ===== Layer 1: Profile header card ===== */}
        <Card padding="calc(var(--spacing) * 6)">
          <div
            className="profile-header"
            style={{
              display: 'grid',
              gridTemplateColumns: 'auto 1fr auto',
              gap: 'calc(var(--spacing) * 5)',
              alignItems: 'center',
            }}
          >
            <div
              className="avatar-large"
              style={{
                width: 96,
                height: 96,
                borderRadius: '50%',
                background: 'var(--primary)',
                color: 'var(--primary-foreground)',
                display: 'grid',
                placeItems: 'center',
                fontSize: '2rem',
                fontWeight: 700,
                flexShrink: 0,
              }}
              aria-label="用户头像"
            >
              {profile.nickname.charAt(0) || '读'}
            </div>

            <div
              className="profile-info"
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 'calc(var(--spacing) * 2)',
                minWidth: 0,
              }}
            >
              <h3
                style={{
                  fontSize: '1.5rem',
                  fontWeight: 700,
                  margin: 0,
                  textWrap: 'balance',
                  wordBreak: 'keep-all',
                  color: 'var(--foreground)',
                }}
              >
                {profile.nickname}
              </h3>
              <div
                className="profile-meta"
                style={{
                  display: 'flex',
                  gap: 'calc(var(--spacing) * 4)',
                  fontSize: '0.88rem',
                  color: 'var(--muted-foreground)',
                  fontFamily: 'var(--font-mono)',
                  flexWrap: 'wrap',
                }}
              >
                <span>{joinedDateStr} 加入</span>
                <span>{profile.location}</span>
                <span>GMT+8</span>
              </div>
              <p
                className="profile-bio"
                style={{
                  fontSize: '0.92rem',
                  lineHeight: 1.6,
                  color: 'var(--card-foreground)',
                  margin: 'calc(var(--spacing) * 2) 0 0',
                  maxWidth: '52ch',
                }}
              >
                {profile.bio}
              </p>
            </div>

            <div
              className="profile-stats"
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gap: 'calc(var(--spacing) * 4)',
                textAlign: 'center',
                minWidth: 260,
              }}
            >
              {[
                { label: '藏书', value: stats.totalBooks },
                { label: '卡片', value: stats.totalCards },
                { label: '生词', value: vocabCount },
              ].map((s) => (
                <div key={s.label} className="stat-mini">
                  <div
                    style={{
                      color: 'var(--muted-foreground)',
                      fontSize: '0.78rem',
                      textTransform: 'uppercase',
                      letterSpacing: '0.08em',
                    }}
                  >
                    {s.label}
                  </div>
                  <strong
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: '1.4rem',
                      display: 'block',
                      marginTop: '0.3rem',
                      color: 'var(--foreground)',
                    }}
                  >
                    {s.value}
                  </strong>
                </div>
              ))}
            </div>
          </div>
        </Card>

        {/* ===== Layer 2: Yearly KPI grid ===== */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
            gap: 'calc(var(--spacing) * 4)',
          }}
        >
          <Card interactive>
            <div
              style={{
                color: 'var(--muted-foreground)',
                fontSize: '0.78rem',
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
              }}
            >
              年度阅读
            </div>
            <div
              style={{
                fontSize: '1.8rem',
                fontWeight: 700,
                margin: '0.45rem 0',
                fontFamily: 'var(--font-mono)',
                color: 'var(--foreground)',
              }}
            >
              {yearlyReadingHours}h
            </div>
            <Trend kind="up">↑ 日均 {avgDailyMinutes}min</Trend>
          </Card>

          <Card interactive>
            <div
              style={{
                color: 'var(--muted-foreground)',
                fontSize: '0.78rem',
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
              }}
            >
              完成书籍
            </div>
            <div
              style={{
                fontSize: '1.8rem',
                fontWeight: 700,
                margin: '0.45rem 0',
                fontFamily: 'var(--font-mono)',
                color: 'var(--foreground)',
              }}
            >
              {stats.finishedBooks}
            </div>
            <Trend kind="up">↑ 目标 15 本</Trend>
          </Card>

          <Card interactive>
            <div
              style={{
                color: 'var(--muted-foreground)',
                fontSize: '0.78rem',
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
              }}
            >
              复习卡片
            </div>
            <div
              style={{
                fontSize: '1.8rem',
                fontWeight: 700,
                margin: '0.45rem 0',
                fontFamily: 'var(--font-mono)',
                color: 'var(--foreground)',
              }}
            >
              {stats.totalReviews.toLocaleString('zh-CN')}
            </div>
            <Trend kind="default">
              {stats.totalReviews > 0 ? `累计 ${formatTime(stats.totalReadingTime)}` : '尚未开始复习'}
            </Trend>
          </Card>

          <Card interactive>
            <div
              style={{
                color: 'var(--muted-foreground)',
                fontSize: '0.78rem',
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
              }}
            >
              连续打卡
            </div>
            <div
              style={{
                fontSize: '1.8rem',
                fontWeight: 700,
                margin: '0.45rem 0',
                fontFamily: 'var(--font-mono)',
                color: 'var(--foreground)',
              }}
            >
              {stats.currentStreak} 天
            </div>
            <Trend kind={stats.currentStreak > 0 ? 'up' : 'default'}>
              {stats.currentStreak > 0
                ? `↑ 最长 ${stats.longestStreak} 天`
                : '今日未打卡'}
            </Trend>
          </Card>
        </div>

        {/* ===== Layer 3: Heat map + Type donut ===== */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1.3fr 1fr',
            gap: 'calc(var(--spacing) * 4)',
          }}
        >
          {/* 阅读热力图 */}
          <Card>
            <CardHead
              eyebrow="阅读热力"
              title={`${new Date().getFullYear()} 全年`}
              action={<Badge variant="ok">活跃</Badge>}
            />
            <div
              className="heat-grid-year"
              style={{
                display: 'grid',
                gridTemplateColumns: `repeat(${HEAT_WEEKS}, 1fr)`,
                gap: 2,
                marginTop: 'calc(var(--spacing) * 4)',
              }}
              aria-label={`近 ${HEAT_WEEKS} 周阅读热力图`}
            >
              {Array.from({ length: HEAT_DAYS }).map((_, r) =>
                Array.from({ length: HEAT_WEEKS }).map((__, c) => {
                  const dayIdx = r + c * HEAT_DAYS
                  const level = heatLevels[dayIdx] ?? 0
                  return (
                    <div
                      key={`${r}-${c}`}
                      className="heat-cell"
                      data-level={level}
                      title={`第 ${c + 1} 周 · 等级 ${level}`}
                    />
                  )
                }),
              )}
            </div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'calc(var(--spacing) * 2)',
                marginTop: 'calc(var(--spacing) * 4)',
                fontSize: '0.78rem',
                color: 'var(--muted-foreground)',
              }}
            >
              <span>少</span>
              <div style={{ display: 'flex', gap: 2 }}>
                {[0, 1, 2, 3, 4].map((lvl) => (
                  <span
                    key={lvl}
                    className="heat-cell"
                    data-level={lvl}
                    style={{ width: 12, height: 12 }}
                  />
                ))}
              </div>
              <span>多</span>
            </div>
          </Card>

          {/* 类型分布甜甜圈 */}
          <Card>
            <CardHead eyebrow="类型分布" title="年度占比" />
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '120px 1fr',
                gap: 'calc(var(--spacing) * 4)',
                alignItems: 'center',
                marginTop: 'calc(var(--spacing) * 4)',
              }}
            >
              <div
                style={{
                  width: 120,
                  height: 120,
                  borderRadius: '50%',
                  background: donutGradient,
                  position: 'relative',
                }}
                aria-label={`藏书类型分布：${typeDist.map((t) => `${t.name} ${t.pct}%`).join('，')}`}
              >
                <div
                  style={{
                    position: 'absolute',
                    inset: 20,
                    borderRadius: '50%',
                    background: 'var(--card)',
                  }}
                />
                <div
                  style={{
                    position: 'absolute',
                    inset: 0,
                    display: 'grid',
                    placeItems: 'center',
                    zIndex: 1,
                    fontWeight: 700,
                    fontSize: '0.95rem',
                    color: 'var(--foreground)',
                  }}
                >
                  {stats.totalBooks} 本
                </div>
              </div>
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 'calc(var(--spacing) * 2)',
                }}
              >
                {typeDist.length === 0 ? (
                  <span style={{ fontSize: '0.88rem', color: 'var(--muted-foreground)' }}>
                    暂无类型数据
                  </span>
                ) : (
                  typeDist.map((slice, i) => (
                    <div
                      key={slice.name}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        gap: 'calc(var(--spacing) * 3)',
                        padding: 'calc(var(--spacing) * 2) 0',
                        borderTop: '1px solid var(--border)',
                      }}
                    >
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.4rem',
                          fontSize: '0.88rem',
                          color: 'var(--foreground)',
                        }}
                      >
                        <i
                          style={{
                            width: '0.72rem',
                            height: '0.72rem',
                            borderRadius: '50%',
                            background: CHART_COLORS[i % CHART_COLORS.length],
                            display: 'block',
                          }}
                        />
                        {slice.name}
                      </span>
                      <strong
                        style={{
                          fontSize: '0.88rem',
                          fontFamily: 'var(--font-mono)',
                          color: 'var(--foreground)',
                        }}
                      >
                        {slice.pct}%
                      </strong>
                    </div>
                  ))
                )}
              </div>
            </div>
          </Card>
        </div>

        {/* ===== Layer 4: Achievement badges（可关闭） ===== */}
        {profileBadgesEnabled && (
        <Card padding="calc(var(--spacing) * 5)">
          <CardHead
            eyebrow="成就徽章"
            title={`已获得 ${unlockedAchievements.length} / ${achievements.length}`}
            action={
              <>
                <Button variant="ghost" data-dom-id="cta-all-badges">查看全部</Button>
                <Button
                  variant="ghost"
                  data-dom-id="cta-toggle-badges"
                  onClick={() => void setProfileBadgesEnabled(false)}
                  title="隐藏成绩勋章区域"
                >
                  隐藏
                </Button>
              </>
            }
          />
          {unlockedAchievements.length === 0 ? (
            <div
              style={{
                padding: 'calc(var(--spacing) * 8) 0',
                textAlign: 'center',
                color: 'var(--muted-foreground)',
                fontSize: '0.92rem',
              }}
            >
              还没有解锁成就，继续阅读吧。
            </div>
          ) : (
            <div
              className="badge-grid"
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(4, 1fr)',
                gap: 'calc(var(--spacing) * 4)',
              }}
            >
              {unlockedAchievements.slice(0, 8).map((achievement, i) => {
              const color = CHART_COLORS[i % CHART_COLORS.length]
              return (
                <div
                  key={achievement.id}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 'calc(var(--spacing) * 2)',
                    padding: 'calc(var(--spacing) * 4)',
                    border: '1px solid var(--border)',
                    borderRadius: 'calc(var(--radius) + 4px)',
                    background: 'var(--background)',
                    textAlign: 'center',
                  }}
                >
                  <div
                    style={{
                      width: 56,
                      height: 56,
                      borderRadius: '50%',
                      display: 'grid',
                      placeItems: 'center',
                      fontSize: '1.4rem',
                      fontWeight: 700,
                      background: color,
                      color: 'var(--primary-foreground)',
                    }}
                    aria-label={`成就：${achievement.name}`}
                  >
                    {/* 移除 emoji（achievement.icon），改用成就名称首字符，避免不同平台 emoji 渲染差异 */}
                    {achievement.name.charAt(0)}
                  </div>
                  <div
                    style={{
                      fontSize: '0.88rem',
                      fontWeight: 600,
                      color: 'var(--card-foreground)',
                    }}
                  >
                    {achievement.name}
                  </div>
                  <div
                    style={{
                      fontSize: '0.72rem',
                      color: 'var(--muted-foreground)',
                      textAlign: 'center',
                    }}
                  >
                    {achievement.description}
                  </div>
                </div>
              )
              })}
            </div>
          )}
        </Card>
        )}
        {!profileBadgesEnabled && (
          <Card padding="calc(var(--spacing) * 4)">
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 'calc(var(--spacing) * 4)',
                flexWrap: 'wrap',
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: '0.78rem', color: 'var(--muted-foreground)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                  成就徽章
                </div>
                <div style={{ fontSize: '0.92rem', color: 'var(--foreground)', marginTop: '0.3rem' }}>
                  成绩勋章已隐藏
                </div>
              </div>
              <Button
                variant="ghost"
                data-dom-id="cta-show-badges"
                onClick={() => void setProfileBadgesEnabled(true)}
              >
                显示勋章
              </Button>
            </div>
          </Card>
        )}

        {/* ===== 设计稿专属样式：热力图色阶 ===== */}
        <style>{`
          .heat-cell {
            width: 100%;
            aspect-ratio: 1;
            border-radius: 2px;
          }
          .heat-cell[data-level="0"] { background: var(--muted); }
          .heat-cell[data-level="1"] { background: color-mix(in srgb, var(--chart-1) 25%, var(--muted)); }
          .heat-cell[data-level="2"] { background: color-mix(in srgb, var(--chart-1) 50%, var(--muted)); }
          .heat-cell[data-level="3"] { background: color-mix(in srgb, var(--chart-1) 75%, var(--muted)); }
          .heat-cell[data-level="4"] { background: var(--chart-1); }
          @media (max-width: 1100px) {
            .profile-header { grid-template-columns: auto 1fr !important; }
            .profile-header .profile-stats { grid-column: 1 / -1; }
            .badge-grid { grid-template-columns: repeat(2, 1fr) !important; }
          }
          @media (max-width: 760px) {
            .profile-header { grid-template-columns: 1fr !important; text-align: center; }
            .profile-header .avatar-large { margin: 0 auto; }
            .profile-header .profile-meta { justify-content: center; }
            .profile-header .profile-info { align-items: center; }
          }
        `}</style>
      </PageHero>

      {/* ===== 编辑资料 Modal ===== */}
      {editModalOpen && (
        <>
          {/* 遮罩层：点击关闭 */}
          <div
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0, 0, 0, 0.5)',
              zIndex: 50,
            }}
            onClick={closeEditModal}
            aria-hidden="true"
          />
          <div
            ref={editModalRef}
            role="dialog"
            aria-modal="true"
            aria-label="编辑资料"
            style={{
              position: 'fixed',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              width: 'min(92vw, 480px)',
              maxHeight: '90vh',
              overflowY: 'auto',
              background: 'var(--card)',
              color: 'var(--card-foreground)',
              border: '1px solid var(--border)',
              borderRadius: 'calc(var(--radius) + 4px)',
              boxShadow: 'var(--shadow-lg, 0 10px 30px rgba(0,0,0,0.18))',
              zIndex: 60,
              padding: 'calc(var(--spacing) * 5)',
              display: 'flex',
              flexDirection: 'column',
              gap: 'calc(var(--spacing) * 4)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'calc(var(--spacing) * 3)' }}>
              <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700, color: 'var(--foreground)' }}>
                编辑资料
              </h3>
              <button
                type="button"
                onClick={closeEditModal}
                aria-label="关闭"
                style={{
                  border: 'none',
                  background: 'transparent',
                  color: 'var(--muted-foreground)',
                  cursor: 'pointer',
                  padding: '0.34rem',
                  borderRadius: 'var(--radius-sm)',
                  display: 'grid',
                  placeItems: 'center',
                }}
              >
                ✕
              </button>
            </div>

            {/* 昵称 */}
            <label style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', fontSize: '0.85rem', color: 'var(--foreground)' }}>
              <span>昵称</span>
              <input
                ref={editFirstInputRef}
                type="text"
                value={editForm.nickname}
                onChange={(e) => setEditForm((f) => ({ ...f, nickname: e.target.value }))}
                maxLength={24}
                style={{
                  padding: '0.55rem 0.7rem',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-sm)',
                  background: 'var(--background)',
                  color: 'var(--foreground)',
                  fontSize: '0.92rem',
                }}
              />
            </label>

            {/* 加入日期 */}
            <label style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', fontSize: '0.85rem', color: 'var(--foreground)' }}>
              <span>加入日期（YYYY-MM-DD 或 ISO）</span>
              <input
                type="text"
                value={editForm.joinedAt}
                onChange={(e) => setEditForm((f) => ({ ...f, joinedAt: e.target.value }))}
                placeholder="2024-01-01"
                style={{
                  padding: '0.55rem 0.7rem',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-sm)',
                  background: 'var(--background)',
                  color: 'var(--foreground)',
                  fontSize: '0.92rem',
                  fontFamily: 'var(--font-mono)',
                }}
              />
            </label>

            {/* 城市 */}
            <label style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', fontSize: '0.85rem', color: 'var(--foreground)' }}>
              <span>城市</span>
              <input
                type="text"
                value={editForm.location}
                onChange={(e) => setEditForm((f) => ({ ...f, location: e.target.value }))}
                maxLength={32}
                style={{
                  padding: '0.55rem 0.7rem',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-sm)',
                  background: 'var(--background)',
                  color: 'var(--foreground)',
                  fontSize: '0.92rem',
                }}
              />
            </label>

            {/* 简介 */}
            <label style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', fontSize: '0.85rem', color: 'var(--foreground)' }}>
              <span>简介</span>
              <textarea
                value={editForm.bio}
                onChange={(e) => setEditForm((f) => ({ ...f, bio: e.target.value }))}
                maxLength={200}
                rows={3}
                style={{
                  padding: '0.55rem 0.7rem',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-sm)',
                  background: 'var(--background)',
                  color: 'var(--foreground)',
                  fontSize: '0.92rem',
                  resize: 'vertical',
                  fontFamily: 'inherit',
                }}
              />
            </label>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'calc(var(--spacing) * 3)', marginTop: 'calc(var(--spacing) * 2)' }}>
              <Button variant="ghost" onClick={closeEditModal} disabled={editSaving}>取消</Button>
              <Button variant="primary" onClick={handleSaveEdit} disabled={editSaving}>
                {editSaving ? '保存中...' : '保存'}
              </Button>
            </div>
          </div>
        </>
      )}
    </>
  )
}
