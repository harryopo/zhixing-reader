// 知行读书 — 「假控件 / 假数字」防回归扫描
//
// 这一批不是逻辑 bug，是界面上摆着但背后没有真数据的东西：
//   · 「难度衰减」输入框：FSRS-6.0 的 decay 是算法常数，引擎从不读 fsrsDifficultyDecay
//   · 存储条的分母 512 MB：写死的常量，应用从来没有容量上限
//   · 顶栏「N 张卡片待复习」：用 card.getDue(100) 的长度当计数，堆到几百张永远显示 100
//   · 复习 CSV：读的是 SM-2 时代不存在的字段名，五列常年空白
// 修法都是「砍掉或换成真实来源」，所以守卫也只需盯住源代码：这些写法不许回来。
// 与 design-tokens / brand-assets 的扫描测试同一套路子。

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

const ROOT = join(__dirname, '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

const SETTINGS = 'src/renderer/src/pages/settings/SettingsData.tsx'
const SETTINGS_UTILS = 'src/renderer/src/pages/settings/data-utils.ts'
const TOPBAR = 'src/renderer/src/components/layout/Topbar.tsx'
const REVIEW_IO = 'src/renderer/src/pages/settings/use-data-io.ts'
const KC_ARTICLE = 'src/renderer/src/pages/knowledge-cards/KnowledgeCardArticle.tsx'
const DAILY_LEARNING = 'src/renderer/src/pages/DailyLearning.tsx'
const SETTINGS_AGENT = 'src/renderer/src/pages/settings/SettingsAgent.tsx'

describe('假控件不许回来', () => {
  it('设置页不再出现「难度衰减」（引擎不读这个值，改了没反应）', () => {
    const src = read(SETTINGS)
    expect(src).not.toContain('fsrsDifficultyDecay')
    expect(src).not.toContain('handleChangeDecay')
    expect(read(SETTINGS_UTILS)).not.toMatch(/decay:/)
  })

  it('存储用量不再编造容量上限', () => {
    expect(read(SETTINGS)).not.toContain('STORAGE_CAP_MB')
    expect(read(SETTINGS_UTILS)).not.toContain('STORAGE_CAP_MB')
  })

  it('顶栏的待复习数走队列计数，不再拿被截断的列表长度当数字', () => {
    const src = read(TOPBAR)
    expect(src).toContain('getQueueStats')
    expect(src).not.toMatch(/card\.getDue\(\s*\d+\s*\)\s*\.catch\(\(\)\s*=>\s*\[\]\)/)
  })

  it('复习 CSV 交给 REVIEW_CSV_COLUMNS，不再手写一遍字段名', () => {
    const src = read(REVIEW_IO)
    expect(src).toContain('buildReviewCsv')
    for (const dead of ['ease_factor', 'easeFactor', 'quality', 'reviewedAt']) {
      expect(src).not.toContain(dead)
    }
  })

  it('知识卡片不再显示「复习 N 次」（review_count 没有任何写入方）', () => {
    expect(read(KC_ARTICLE)).not.toContain('复习 {safeNum(card.reviewCount)} 次')
  })

  it('每日学习取文章/生词必须显式给 limit，不能用主进程默认的 50 / 200', () => {
    const src = read(DAILY_LEARNING)
    expect(src).toMatch(/article\.getAll\(FULL_LIST_LIMIT\)/)
    expect(src).toMatch(/vocabulary\.getAll\(FULL_LIST_LIMIT\)/)
  })

  it('策略映射条数跟着 INTENT_META 走，不写死', () => {
    const src = read(SETTINGS_AGENT)
    expect(src).toContain('{INTENT_META.length} 条映射')
  })
})
