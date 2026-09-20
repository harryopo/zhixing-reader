/**
 * Profile — 个人档案（Google Design Library 1:1 重构）
 * 基于设计稿 zhixing-reader-redesign/pages/profile.html
 * 4 层结构：Profile header / Yearly KPI / Heat map + Type donut / Achievement badges
 * 所有数据通过 IPC 真实加载（profileStore + vocabulary + settings + stats + book）
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import PageHero from '@/components/layout/PageHero'
import Card, { CardHead } from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import Badge from '@/components/ui/Badge'
import { Loading, Trend } from '@/components/ui/Feedback'
import Modal from '@/components/ui/Modal'
import { useProfileStore } from '../stores/profileStore'
import { useSettingsStore } from '../stores/settingsStore'
import { toast } from '../stores/toastStore'
import { safeNum, safeStr } from '../utils/db-mapper'
import {
  averageMinutesPerActiveDay,
  daysWithActivity,
  formatReadingDuration,
  heatLevels,
  inRange,
  lastActiveDate,
  localDateStr,
  shortDate,
  sumReadingSeconds,
  weekTrend,
} from '../../../shared/profile-stats'

/** 图表色板（与设计稿 chart-1/5/3/2 对齐） */
const CHART_COLORS = ['var(--chart-1)', 'var(--chart-5)', 'var(--chart-3)', 'var(--chart-2)']

/** 热力图尺寸：26 周 × 7 天 = 182 格 */
const HEAT_WEEKS = 26
const HEAT_DAYS = 7

interface BookRow {
  id: string
  title: string
  author: string
  cover: string
  category?: string
}

interface UserProfile {
  nickname: string
  joinedAt: string
  location: string
  bio: string
}

const DEFAULT_PROFILE: UserProfile = {
  nickname: '读书人',
  // 空串 = 没填。这里绝不能放一个「今天往前 N 天」的假日期：
  // 旧默认值 new Date(now - 287d) 会被写进 settings，于是界面长期显示
  // 「2025-11-14 加入 · 310 天」，而库里最早一条记录其实是 2026-09-02。
  joinedAt: '',
  location: '北京',
  bio: '通过阅读建立认知体系，用笔记与复习巩固成长。相信慢即是快。',
}

interface TypeSlice {
  name: string
  count: number
  pct: number
}

export default function Profile() {
  const navigate = useNavigate()
  const { stats, achievements, loading, error, fetchStats } = useProfileStore()

  // 成绩勋章显示开关（settingsStore 持久化）
  const profileBadgesEnabled = useSettingsStore((s) => s.profileBadgesEnabled)
  const setProfileBadgesEnabled = useSettingsStore((s) => s.setProfileBadgesEnabled)
  const loadSettings = useSettingsStore((s) => s.loadSettings)

  // 微信读书同步的头像 / 昵称
  const userAvatarUrl = useSettingsStore((s) => s.userAvatarUrl)
  const userNickname = useSettingsStore((s) => s.userNickname)
  const syncingProfile = useSettingsStore((s) => s.syncingProfile)
  const syncWeReadUserProfile = useSettingsStore((s) => s.syncWeReadUserProfile)

  // 扩展数据源：生词数 / 用户设置 / 类型分布（热力图直接由 profileStore.dailyRows 现算）
  const [vocabCount, setVocabCount] = useState(0)
  const [profile, setProfile] = useState<UserProfile>(DEFAULT_PROFILE)
  const [typeDist, setTypeDist] = useState<TypeSlice[]>([])

  // 编辑资料 Modal 状态
  const [editModalOpen, setEditModalOpen] = useState(false)
  const [editForm, setEditForm] = useState<UserProfile>(DEFAULT_PROFILE)
  const [editSaving, setEditSaving] = useState(false)
  const [avatarError, setAvatarError] = useState(false)
  const editFirstInputRef = useRef<HTMLInputElement>(null)

  // 确保全局设置（含 profileBadgesEnabled）已加载
  useEffect(() => {
    void loadSettings()
  }, [loadSettings])

  useEffect(() => {
    fetchStats()
  }, [fetchStats])

  // settingsStore 中的昵称同步到本地展示态
  useEffect(() => {
    if (userNickname) {
      setProfile((p) => ({ ...p, nickname: userNickname }))
    }
  }, [userNickname])

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

      // 2. 用户设置（昵称 / 加入日期 / 城市 / 简介 / 头像）
      try {
        const [nickname, joinedAt, location, bio, avatarUrl] = await Promise.all([
          api.settings.get('userNickname'),
          api.settings.get('userJoinedAt'),
          api.settings.get('userLocation'),
          api.settings.get('userBio'),
          api.settings.get('userAvatarUrl'),
        ])
        setProfile({
          nickname: safeStr(nickname) || safeStr(userNickname) || DEFAULT_PROFILE.nickname,
          joinedAt: safeStr(joinedAt),
          location: safeStr(location) || '',
          bio: safeStr(bio) || '',
        })
        if (safeStr(avatarUrl)) {
          setAvatarError(false)
        }
      } catch {
        /* 非致命：保持默认 */
      }

      // 3. 类型分布（基于 book.getAll 的 category 字段聚合）
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

  // 「加入日期」只有两个合法来源：用户自己填的，或库里最早一条记录。
  // 两个都没有就显示「—」，绝不拿今天倒推一个天数出来。
  const joinedDateStr = useMemo(() => {
    const manual = profile.joinedAt.slice(0, 10)
    if (/^\d{4}-\d{2}-\d{2}$/.test(manual)) return manual
    return stats.firstRecordAt?.slice(0, 10) ?? ''
  }, [profile.joinedAt, stats.firstRecordAt])

  const joinedDays = useMemo(() => {
    if (!joinedDateStr) return 0
    const ms = Date.now() - new Date(`${joinedDateStr}T00:00:00`).getTime()
    // 首日算第 1 天：9 月 2 日开始记录，9 月 20 日就是第 19 天
    return Math.max(1, Math.floor(ms / 86400000) + 1)
  }, [joinedDateStr])

  const today = useMemo(() => localDateStr(new Date()), [])

  // 原先写死 GMT+8：换台机器就成假信息
  const tzOffset = -new Date().getTimezoneOffset() / 60
  const tzLabel = `GMT${tzOffset >= 0 ? '+' : ''}${tzOffset}`

  /** 年度 KPI 只看今年：取数窗口为迁就 26 周热力图可能跨到去年 */
  const yearlyRows = useMemo(
    () => inRange(stats.dailyRows, `${today.slice(0, 4)}-01-01`, today),
    [stats.dailyRows, today]
  )

  const yearlyReadingText = useMemo(
    () => formatReadingDuration(sumReadingSeconds(yearlyRows)),
    [yearlyRows]
  )

  const activeReadingDays = daysWithActivity(yearlyRows)
  const avgDailyMinutes = averageMinutesPerActiveDay(yearlyRows)
  const readingTrend = weekTrend(stats.dailyRows, today)
  const lastReadDay = shortDate(lastActiveDate(stats.dailyRows))
  const lastReview = shortDate(stats.lastReviewAt)

  /** 热力格：由 profileStore 已取到的逐日明细现算，不再单独发一次 IPC */
  const heat = useMemo(
    () => heatLevels(stats.dailyRows, today, HEAT_WEEKS),
    [stats.dailyRows, today]
  )
  const heatActiveDays = heat.filter((l) => l > 0).length

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

  // Modal 的 ESC 关闭 / 焦点陷阱 / 进出聚焦由 ui/Modal 原语负责

  // ===== 从微信读书同步头像 / 昵称 =====
  const handleSyncWeReadProfile = async () => {
    const result = await syncWeReadUserProfile()
    if (result.success) {
      toast.success(result.message)
      // store 已更新 userAvatarUrl / userNickname；刷新本地 profile 显示
      if (userNickname) {
        setProfile((p) => ({ ...p, nickname: userNickname }))
      }
      if (userAvatarUrl) {
        setAvatarError(false)
      }
    } else {
      toast.error(result.message)
    }
  }

  // ===== 分享按钮：生成分享文本并复制到剪贴板 =====
  const handleShare = async () => {
    const lines = [
      `「${profile.nickname}」的知行读书档案`,
      `加入 ${joinedDateStr || '—'} · 连续 ${stats.currentStreak} 天`,
      `藏书 ${stats.totalBooks} 本 · 完成 ${stats.finishedBooks} 本 · 笔记 ${stats.totalHighlights} 条`,
      `复习 ${stats.totalReviews} 次 · 卡片 ${stats.totalCards} 张 · 生词 ${vocabCount} 个`,
      `今年阅读 ${yearlyReadingText} · ${activeReadingDays} 天有读 · 平均每天 ${avgDailyMinutes} 分钟`,
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
        subtitle={joinedDateStr ? `知行读书 · 已记录 ${joinedDays} 天` : '知行读书'}
        actions={
          <>
            <Button
              variant="secondary"
              data-dom-id="cta-sync-weread"
              onClick={() => void handleSyncWeReadProfile()}
              disabled={syncingProfile}
            >
              {syncingProfile ? '同步中...' : '同步微信读书'}
            </Button>
            <Button variant="secondary" data-dom-id="cta-edit" onClick={openEditModal}>编辑资料</Button>
            {/* 这个按钮实际只是把一段文本写进剪贴板（没有分享面板/链接/文件），
            原来叫「分享」名不副实，改成它真正做的事。 */}
        <Button variant="ghost" data-dom-id="cta-share" onClick={handleShare}>复制档案摘要</Button>
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
            {userAvatarUrl && !avatarError ? (
              <img
                src={userAvatarUrl}
                alt="用户头像"
                className="avatar-large"
                onError={() => setAvatarError(true)}
                style={{
                  width: 96,
                  height: 96,
                  borderRadius: '50%',
                  objectFit: 'cover',
                  border: '2px solid var(--border)',
                  flexShrink: 0,
                }}
              />
            ) : (
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
                {(userNickname || profile.nickname).charAt(0) || '读'}
              </div>
            )}

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
                <span>{joinedDateStr ? `${joinedDateStr} 开始记录` : '还没有阅读记录'}</span>
                {profile.location && <span>{profile.location}</span>}
                <span>{tzLabel}</span>
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
                {profile.bio || '还没有个人简介，点击「编辑资料」写一句吧。'}
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
          <Card interactive onClick={() => navigate('/stats')}>
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
              {yearlyReadingText}
            </div>
            <Trend kind={readingTrend === 'up' ? 'up' : readingTrend === 'down' ? 'down' : 'default'}>
              {activeReadingDays > 0
                ? `${readingTrend === 'up' ? '↑ ' : readingTrend === 'down' ? '↓ ' : ''}${activeReadingDays} 天有读 · 日均 ${avgDailyMinutes} 分钟`
                : '今年还没有阅读记录'}
            </Trend>
          </Card>

          <Card interactive onClick={() => navigate('/stats')}>
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
          </Card>

          <Card interactive onClick={() => navigate('/stats')}>
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
              {stats.totalReviews > 0
                ? `覆盖 ${stats.reviewedCards} 张卡${lastReview ? ` · 最近 ${lastReview}` : ''}`
                : '尚未开始复习'}
            </Trend>
          </Card>

          <Card interactive onClick={() => navigate('/stats')}>
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
                ? `最长 ${stats.longestStreak} 天`
                : lastReadDay
                  ? `上次阅读 ${lastReadDay}`
                  : '还没有阅读记录'}
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
              title={`近 ${HEAT_WEEKS} 周`}
              action={
                <Badge variant={heatActiveDays > 0 ? 'ok' : 'default'}>
                  {heatActiveDays > 0 ? `${heatActiveDays} 天有读` : '近半年没读'}
                </Badge>
              }
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
                  const level = heat[dayIdx] ?? 0
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
        <Modal
          onClose={closeEditModal}
          title="编辑资料"
          initialFocusRef={editFirstInputRef}
          width={480}
        >
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
        </Modal>
      )}
    </>
  )
}
