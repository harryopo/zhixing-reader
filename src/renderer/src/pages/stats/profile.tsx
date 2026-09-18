/** 用户画像 / 偏好分类 / 阅读时段热力（从 Stats.tsx 原样搬出，逻辑未改） */
import { useMemo, useState } from 'react'
import Card, { CardHead } from '@/components/ui/Card'
import Badge from '@/components/ui/Badge'
import { Tiny } from '@/components/ui/Feedback'
import { formatReadingTime } from '../../stores/readingDataStore'
import type { PreferCategory } from '../../../../shared/types'
import { DONUT_PALETTE } from './constants'

export function deriveProfile(categories: PreferCategory[]) {
  const sorted = [...categories]
    .filter((c) => c.readingTime > 0 || c.readingCount > 0)
    .sort((a, b) => b.readingTime - a.readingTime)
  const topCat = sorted[0]
  const totalTime = sorted.reduce((s, c) => s + c.readingTime, 0)
  const totalBooks = sorted.reduce((s, c) => s + c.readingCount, 0)
  const top2 = sorted.slice(0, 2)
  const top2Time = top2.reduce((s, c) => s + c.readingTime, 0)
  const concentration = totalTime > 0 ? top2Time / totalTime : 0

  const identityLabels: { keys: string[]; label: string; desc: string }[] = [
    {
      keys: ['计算机', '编程', '科技', '互联网', '人工智能', '算法'],
      label: '技术探索者',
      desc: '热爱计算机与技术类阅读，用代码改变世界',
    },
    {
      keys: ['文学', '小说', '外国文学', '中国文学', '散文', '诗歌'],
      label: '文学爱好者',
      desc: '徜徉文字海洋，品味文学之美',
    },
    {
      keys: ['历史', '文化', '人物传记', '传记', '纪实'],
      label: '历史沉思者',
      desc: '以史为鉴，在时间长河中寻找智慧',
    },
    {
      keys: ['经济理财', '商业', '投资', '金融', '管理'],
      label: '经济洞察家',
      desc: '把握商业脉搏，洞悉经济规律',
    },
    {
      keys: ['个人成长', '心理', '励志', '人生哲学', '自我管理'],
      label: '成长修行者',
      desc: '不断自我精进，追求更好的自己',
    },
    {
      keys: ['哲学', '社会科学', '政治', '法律', '军事'],
      label: '思想深邃者',
      desc: '探索思想的边界，追寻真理的光芒',
    },
    {
      keys: ['教育', '学习', '外语', '童书', '亲子'],
      label: '终身学习者',
      desc: '学无止境，用知识武装自己',
    },
    {
      keys: ['艺术', '设计', '摄影', '音乐', '建筑'],
      label: '美学鉴赏家',
      desc: '在艺术中发现生活的诗意',
    },
    {
      keys: ['科学', '科普', '自然科学', '物理', '数学'],
      label: '科学求真者',
      desc: '探索自然规律，追问万物本质',
    },
    {
      keys: ['医学', '健康', '养生', '运动', '美食'],
      label: '健康关注者',
      desc: '关注身心健康，追求品质生活',
    },
    {
      keys: ['旅行', '地理', '生活', '休闲'],
      label: '生活家',
      desc: '热爱生活，在阅读中发现世界之美',
    },
  ]

  let identity = identityLabels[0]
  if (topCat) {
    for (const item of identityLabels) {
      if (
        item.keys.some(
          (k) => topCat.categoryTitle.includes(k) || k.includes(topCat.categoryTitle),
        )
      ) {
        identity = item
        break
      }
    }
  }

  const tags: string[] = []
  sorted.slice(0, 4).forEach((c) => {
    if (c.readingCount > 0) tags.push(c.categoryTitle)
  })

  if (concentration > 0.6) {
    tags.unshift('深度聚焦')
  } else if (concentration < 0.35 && sorted.length >= 3) {
    tags.unshift('广泛涉猎')
  }

  const profileSummary = topCat
    ? `主要沉浸在${topCat.categoryTitle}领域，${top2.length > 1 ? `同时涉猎${top2[1].categoryTitle}` : ''}，共阅读 ${totalBooks} 本书，累计 ${formatReadingTime(totalTime)}。${concentration > 0.6 ? '阅读方向高度聚焦，深度钻研。' : concentration > 0.3 ? '阅读兴趣广泛而平衡。' : '阅读口味多元，涉猎广泛。'}`
    : '开始阅读，探索你的知识边界吧。'

  const level =
    totalBooks >= 50
      ? { name: '博览群书', color: 'var(--chart-3)', bg: 'color-mix(in srgb, var(--chart-3) 18%, transparent)' }
      : totalBooks >= 20
        ? { name: '学识渊博', color: 'var(--chart-4)', bg: 'color-mix(in srgb, var(--chart-4) 14%, transparent)' }
        : totalBooks >= 10
          ? { name: '求知若渴', color: 'var(--chart-5)', bg: 'color-mix(in srgb, var(--chart-5) 14%, transparent)' }
          : totalBooks >= 5
            ? { name: '初窥门径', color: 'var(--chart-1)', bg: 'color-mix(in srgb, var(--chart-1) 14%, transparent)' }
            : { name: '初出茅庐', color: 'var(--muted-foreground)', bg: 'var(--muted)' }

  const top3Pct = sorted.slice(0, 3).map((c) => ({
    title: c.categoryTitle,
    pct: totalTime > 0 ? Math.round((c.readingTime / totalTime) * 100) : 0,
  }))

  return {
    identity,
    tags,
    profileSummary,
    totalBooks,
    totalTime,
    concentration,
    level,
    top3Pct,
    sorted,
  }
}

/** 用户画像卡 */
export function UserProfileCard({
  categories,
  categoryWord: _categoryWord,
}: {
  categories: PreferCategory[]
  categoryWord?: string
}) {
  const profile = useMemo(() => deriveProfile(categories), [categories])

  const identityEmoji =
    profile.identity.label === '技术探索者'
      ? '💻'
      : profile.identity.label === '文学爱好者'
        ? '📖'
        : profile.identity.label === '历史沉思者'
          ? '🏛️'
          : profile.identity.label === '经济洞察家'
            ? '📊'
            : profile.identity.label === '成长修行者'
              ? '🌱'
              : profile.identity.label === '思想深邃者'
                ? '🧠'
                : profile.identity.label === '终身学习者'
                  ? '🎓'
                  : profile.identity.label === '美学鉴赏家'
                    ? '🎨'
                    : profile.identity.label === '科学求真者'
                      ? '🔬'
                      : profile.identity.label === '健康关注者'
                        ? '💪'
                        : profile.identity.label === '生活家'
                          ? '🌍'
                          : '📚'

  const ringSegments = useMemo(() => {
    if (profile.sorted.length === 0) return []
    const top = profile.sorted.slice(0, 5)
    const total = top.reduce((s, c) => s + c.readingTime, 0)
    if (total === 0) return []
    const cumPct: number[] = []
    let acc = 0
    top.forEach((c) => {
      acc += (c.readingTime / total) * 100
      cumPct.push(acc)
    })
    return top.map((c, i) => {
      const start = i === 0 ? 0 : cumPct[i - 1]
      const end = cumPct[i]
      const pct = end - start
      return {
        title: c.categoryTitle,
        pct,
        color: DONUT_PALETTE[i % DONUT_PALETTE.length],
      }
    })
  }, [profile.sorted])

  return (
    <Card>
      <CardHead eyebrow="用户画像" title={profile.identity.label} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 'calc(var(--spacing) * 3)' }}>
        <div
          style={{
            width: 48,
            height: 48,
            background: 'color-mix(in srgb, var(--primary) 14%, transparent)',
            color: 'var(--primary)',
            borderRadius: '50%',
            display: 'grid',
            placeItems: 'center',
            fontSize: '1.5rem',
            flexShrink: 0,
          }}
        >
          {identityEmoji}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <strong
            style={{
              display: 'block',
              fontSize: '1rem',
              fontWeight: 700,
              color: 'var(--foreground)',
            }}
          >
            {profile.identity.label}
          </strong>
          <span
            style={{
              display: 'inline-block',
              marginTop: '0.25rem',
              padding: '0.25rem 0.5rem',
              borderRadius: 999,
              background: profile.level.bg,
              color: profile.level.color,
              fontSize: '0.75rem',
              fontWeight: 600,
            }}
          >
            {profile.level.name}
          </span>
        </div>
      </div>
      <Tiny style={{ marginTop: 'calc(var(--spacing) * 3)' }}>{profile.identity.desc}</Tiny>

      {/* 环形图 + 列表 */}
      {ringSegments.length > 0 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'calc(var(--spacing) * 3)',
            marginTop: 'calc(var(--spacing) * 4)',
          }}
        >
          <svg width={52} height={52} viewBox="0 0 36 36" style={{ flexShrink: 0 }}>
            {ringSegments.map((seg, i) => {
              const prevEnd = ringSegments
                .slice(0, i)
                .reduce((s, s2) => s + s2.pct, 0)
              const dasharray = `${seg.pct} ${100 - seg.pct}`
              return (
                <circle
                  key={i}
                  cx="18"
                  cy="18"
                  r="15.915"
                  fill="none"
                  stroke={seg.color}
                  strokeWidth="3"
                  strokeDasharray={dasharray}
                  strokeDashoffset={`${-prevEnd}`}
                  transform="rotate(-90 18 18)"
                  style={{ transition: 'all 0.5s ease' }}
                />
              )
            })}
            <text
              x="18"
              y="18"
              textAnchor="middle"
              dominantBaseline="central"
              fontSize="8"
              fontWeight="bold"
              fill="var(--foreground)"
            >
              {profile.totalBooks}本
            </text>
          </svg>
          <div
            style={{
              flex: 1,
              minWidth: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: '0.25rem',
            }}
          >
            {ringSegments.map((seg, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
                <div
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    flexShrink: 0,
                    backgroundColor: seg.color,
                  }}
                />
                <span
                  style={{
                    fontSize: '0.7rem',
                    color: 'var(--foreground)',
                    flex: 1,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {seg.title}
                </span>
                <span
                  style={{
                    fontSize: '0.7rem',
                    color: 'var(--muted-foreground)',
                    flexShrink: 0,
                    fontFamily: 'var(--font-mono)',
                  }}
                >
                  {Math.round(seg.pct)}%
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 标签 */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '0.375rem',
          marginTop: 'calc(var(--spacing) * 3)',
        }}
      >
        {profile.tags.map((tag) => {
          const isHighlight = tag === '深度聚焦' || tag === '广泛涉猎'
          return (
            <span
              key={tag}
              style={{
                fontSize: '0.7rem',
                padding: '0.2rem 0.5rem',
                borderRadius: 999,
                background: isHighlight
                  ? 'color-mix(in srgb, var(--chart-3) 18%, transparent)'
                  : 'var(--muted)',
                color: isHighlight
                  ? 'color-mix(in srgb, var(--chart-3) 80%, var(--foreground))'
                  : 'var(--muted-foreground)',
                border: isHighlight
                  ? '1px solid color-mix(in srgb, var(--chart-3) 35%, transparent)'
                  : '1px solid var(--border)',
              }}
            >
              {tag}
            </span>
          )
        })}
      </div>

      {/* 画像总结 */}
      <div
        style={{
          borderTop: '1px solid var(--border)',
          marginTop: 'calc(var(--spacing) * 3)',
          paddingTop: 'calc(var(--spacing) * 3)',
        }}
      >
        <Tiny>{profile.profileSummary}</Tiny>
      </div>
    </Card>
  )
}

/** 偏好分类条形图 */
export function CategoryBreakdown({ categories }: { categories: PreferCategory[] }) {
  const sorted = useMemo(() => {
    return [...categories]
      .filter((c) => c.readingTime > 0)
      .sort((a, b) => b.readingTime - a.readingTime)
      .slice(0, 8)
  }, [categories])

  const totalTime = useMemo(() => sorted.reduce((s, c) => s + c.readingTime, 0), [sorted])

  if (sorted.length === 0) return null

  return (
    <Card>
      <CardHead eyebrow="偏好分类" title="时长分布" />
      {/* 顶部堆叠条 */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: 'calc(var(--spacing) * 4)' }}>
        {sorted.slice(0, 5).map((cat, i) => {
          const pct = totalTime > 0 ? Math.round((cat.readingTime / totalTime) * 100) : 0
          return (
            <div
              key={cat.categoryId}
              style={{
                height: 8,
                borderRadius: 999,
                width: `${Math.max(pct, 3)}%`,
                backgroundColor: DONUT_PALETTE[i % DONUT_PALETTE.length],
                transition: 'width 0.5s ease',
              }}
              title={`${cat.categoryTitle} ${pct}%`}
            />
          )
        })}
      </div>
      {/* 分类列表 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
        {sorted.map((cat, i) => {
          const maxTime = sorted[0].readingTime
          const barPct = maxTime > 0 ? (cat.readingTime / maxTime) * 100 : 0
          const sharePct = totalTime > 0 ? Math.round((cat.readingTime / totalTime) * 100) : 0
          return (
            <div key={cat.categoryId} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <div
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  flexShrink: 0,
                  backgroundColor: DONUT_PALETTE[i % DONUT_PALETTE.length],
                }}
              />
              <span
                style={{
                  fontSize: '0.75rem',
                  color: 'var(--foreground)',
                  width: 56,
                  flexShrink: 0,
                  fontWeight: 600,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {cat.categoryTitle}
              </span>
              <div
                style={{
                  flex: 1,
                  background: 'var(--muted)',
                  borderRadius: 999,
                  height: 8,
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    height: 8,
                    borderRadius: 999,
                    width: `${Math.max(barPct, 3)}%`,
                    backgroundColor: DONUT_PALETTE[i % DONUT_PALETTE.length],
                    transition: 'width 0.5s ease',
                  }}
                />
              </div>
              <span
                style={{
                  fontSize: '0.7rem',
                  color: 'var(--muted-foreground)',
                  width: 40,
                  textAlign: 'right',
                  flexShrink: 0,
                  fontFamily: 'var(--font-mono)',
                }}
              >
                {sharePct}%
              </span>
              <span
                style={{
                  fontSize: '0.7rem',
                  color: 'var(--muted-foreground)',
                  width: 56,
                  textAlign: 'right',
                  flexShrink: 0,
                }}
              >
                {formatReadingTime(cat.readingTime)}
              </span>
            </div>
          )
        })}
      </div>
    </Card>
  )
}

/** 阅读时段柱状图（24 小时分布） */
export function ReadingTimeHeatmap({
  preferTime,
  preferTimeWord,
}: {
  preferTime: number[]
  preferTimeWord?: string
}) {
  const [hoveredHour, setHoveredHour] = useState<number | null>(null)
  const maxSeconds = useMemo(() => Math.max(...preferTime, 1), [preferTime])

  const currentHour = useMemo(() => new Date().getHours(), [])
  const peakHourIdx = useMemo(() => {
    let maxIdx = 0
    preferTime.forEach((s, i) => {
      if (s > preferTime[maxIdx]) maxIdx = i
    })
    return maxIdx
  }, [preferTime])

  return (
    <Card>
      <CardHead
        eyebrow="阅读时段"
        title="24 小时分布"
        action={
          preferTimeWord ? (
            <Badge variant="ok">{preferTimeWord}</Badge>
          ) : undefined
        }
      />
      <div
        style={{
          display: 'flex',
          alignItems: 'end',
          gap: 3,
          height: 96,
          marginTop: 'calc(var(--spacing) * 4)',
        }}
      >
        {preferTime.map((seconds, i) => {
          const height = maxSeconds > 0 ? (seconds / maxSeconds) * 100 : 0
          const hourLabel = (6 + i) % 24
          const isActive = currentHour === hourLabel
          const isPeak = i === peakHourIdx
          const isHovered = hoveredHour === i
          const bg = isHovered
            ? 'var(--chart-4)'
            : isPeak
              ? 'var(--chart-5)'
              : isActive
                ? 'color-mix(in srgb, var(--primary) 70%, var(--muted))'
                : 'var(--chart-1)'
          const opacity = isHovered || isPeak || isActive ? 1 : 0.7
          return (
            <div
              key={i}
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 2,
                cursor: 'pointer',
              }}
              onMouseEnter={() => setHoveredHour(i)}
              onMouseLeave={() => setHoveredHour(null)}
            >
              <div
                style={{
                  width: '100%',
                  borderTopLeftRadius: 999,
                  borderTopRightRadius: 999,
                  minHeight: 2,
                  height: `${Math.max(height, 2)}%`,
                  backgroundColor: bg,
                  opacity,
                  transition: 'opacity 0.2s ease, background 0.2s ease',
                }}
              />
              {i % 6 === 0 && (
                <span
                  style={{
                    fontSize: '0.72rem',
                    color: isActive ? 'var(--primary)' : 'var(--muted-foreground)',
                    fontWeight: isActive ? 700 : 400,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {hourLabel}:00
                </span>
              )}
            </div>
          )
        })}
      </div>
      {peakHourIdx >= 0 && preferTime[peakHourIdx] > 0 && (
        <div
          style={{
            marginTop: 'calc(var(--spacing) * 3)',
            fontSize: '0.78rem',
            color: 'var(--muted-foreground)',
            textAlign: 'center',
          }}
        >
          高峰时段 {(6 + peakHourIdx) % 24}:00，累计 {formatReadingTime(preferTime[peakHourIdx])}
        </div>
      )}
    </Card>
  )

}
