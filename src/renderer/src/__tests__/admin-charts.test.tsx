/**
 * 知行读书 — AdminDashboard 图表组件完整渲染测试
 *
 * 演进历史：
 *   - P1-1（2026-07-20）：smoke test，3 个 ProviderPieChart + 2 个 theme = 5 用例
 *   - P1-4（2026-07-20）：补 role="img" aria-label 用例 = 1 用例
 *   - Phase 8 T2（2026-07-22）：扩展到 6 组件完整渲染 + formatTokens 边界 = 共 31 用例
 *
 * 测试覆盖：
 *   1. ProviderPieChart       — 空数据 / unknown 映射 / 多 provider / aria-label
 *   2. ModelBarChart          — 空数据 / 渲染 / Top10 截断 / 长名称截断 / unknown 映射
 *   3. FeatureBarChart        — 空数据 / 双 series（Token + 请求数）
 *   4. RequestPieChart        — 空数据 / request_count 占比
 *   5. TokensGauge            — 0% / 50% / 100% / >100% clamp / 副标题
 *   6. ProviderTokenBarChart  — 空数据 / 堆叠 input+output / unknown 映射 / Top6 截断
 *   7. formatTokens           — 0 / 999 / 1000 / 9999 / 100000 / 1000000 边界
 *   8. registerTailwindTheme  — 幂等 / 调色板
 *
 * mock 策略：
 *   - echarts-for-react → 简单 div + data-option JSON 序列化（避免 jsdom canvas 报错）
 *   - window.electronAPI 在 tests/setup.ts 用 Proxy mock
 *   - 测试只验证数据映射与渲染分支，不验证像素/动画
 */
// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import type { ProviderStats, FeatureStats } from '../../../types/renderer'

// 必须在 import 被测组件前 mock（vitest 提升）
vi.mock('echarts-for-react', () => ({
  default: (props: {
    option?: unknown
    style?: unknown
    'aria-label'?: string
    'aria-role'?: string
  }) => (
    <div
      data-testid="echarts-mock"
      data-option={JSON.stringify(props.option)}
      data-aria-label={props['aria-label'] ?? ''}
      data-aria-role={props['aria-role'] ?? ''}
    />
  ),
}))

import {
  ProviderPieChart,
  ModelBarChart,
  FeatureBarChart,
  RequestPieChart,
  TokensGauge,
  ProviderTokenBarChart,
  formatTokens,
} from '../admin-charts'
import { registerTailwindTheme, tailwindTheme } from '../echarts-theme-tailwind'

// ============================================================================
// 测试夹具：构造满足类型契约的最小数据
// ============================================================================

function makeProvider(over: Partial<ProviderStats> = {}): ProviderStats {
  return {
    provider: 'openai',
    model: 'gpt-4o',
    request_count: 1,
    total_input_tokens: 100,
    total_output_tokens: 50,
    total_tokens: 150,
    total_duration_ms: 1000,
    ...over,
  }
}

function makeFeature(over: Partial<FeatureStats> = {}): FeatureStats {
  return {
    feature: 'chat',
    request_count: 1,
    total_tokens: 100,
    total_input_tokens: 60,
    total_output_tokens: 40,
    total_duration_ms: 500,
    avg_duration_ms: 500,
    ...over,
  }
}

// ============================================================================
// ECharts option 类型断言工具
//   readOption 返回 unknown，使用处用 `as XxxOption` 断言为具体形状。
//   避免引入 any（项目 no-explicit-any: warn），同时保持 strict 类型安全。
// ============================================================================

/** 从 render 容器中读取 mock ECharts 的 option JSON */
function readOption(container: HTMLElement): unknown {
  const el = container.querySelector('[data-testid="echarts-mock"]')
  return JSON.parse(el?.getAttribute('data-option') ?? '{}')
}

/** 环形图 option：series[0].data = [{ name, value }] */
interface PieOption {
  series: Array<{ data: Array<{ name: string; value: number }> }>
}

/** 柱图 option：series[].data = number[]；xAxis/yAxis.data = string[] */
interface BarOption {
  series: Array<{ name?: string; data: number[]; stack?: string }>
  xAxis?: { data: string[] }
  yAxis?: { data: string[] }
}

/** 仪表盘 option：series[0].data = [{ value }] */
interface GaugeOption {
  series: Array<{ data: Array<{ value: number }> }>
}

// ============================================================================
// 1. formatTokens — 纯函数边界测试
// ============================================================================
describe('formatTokens', () => {
  it('returns "0" for 0', () => {
    expect(formatTokens(0)).toBe('0')
  })

  it('returns original number string for 999 (below 1k threshold)', () => {
    expect(formatTokens(999)).toBe('999')
  })

  it('returns "1.0k" for 1000', () => {
    expect(formatTokens(1000)).toBe('1.0k')
  })

  it('returns "10.0k" for 9999 (toFixed(1) rounds up)', () => {
    // 9999 / 1000 = 9.999 → toFixed(1) = "10.0"
    expect(formatTokens(9999)).toBe('10.0k')
  })

  it('returns "100.0k" for 100000', () => {
    expect(formatTokens(100000)).toBe('100.0k')
  })

  it('returns "1.0M" for 1000000', () => {
    expect(formatTokens(1_000_000)).toBe('1.0M')
  })
})

// ============================================================================
// 2. ProviderPieChart — Provider Token 占比环形图
// ============================================================================
describe('ProviderPieChart', () => {
  it('empty data → renders EmptyState', () => {
    const { container } = render(<ProviderPieChart providers={[]} />)
    expect(container.textContent).toBe('暂无数据')
  })

  it('unknown provider → "未指定" 映射', () => {
    const { container } = render(
      <ProviderPieChart
        providers={[makeProvider({ provider: 'unknown', total_tokens: 100 })]}
      />,
    )
    const option = readOption(container) as PieOption
    expect(option.series[0].data[0].name).toBe('未指定')
    expect(option.series[0].data[0].value).toBe(100)
  })

  it('preserves known provider names', () => {
    const { container } = render(
      <ProviderPieChart providers={[makeProvider({ provider: 'openai', total_tokens: 50 })]} />,
    )
    const option = readOption(container) as PieOption
    expect(option.series[0].data[0].name).toBe('openai')
  })

  // ✅ P1-4 修复回归：图表必须带 role="img" + aria-label
  it('wraps chart in role="img" container with aria-label', () => {
    const { container } = render(<ProviderPieChart providers={[makeProvider()]} />)
    const figure = container.querySelector('[role="img"]')
    expect(figure).toBeTruthy()
    const ariaLabel = figure?.getAttribute('aria-label') ?? ''
    expect(ariaLabel).toContain('Provider 占比')
    expect(ariaLabel).toContain('共 1 项数据')
  })

  it('renders multiple providers in series.data with correct dataCount', () => {
    const { container } = render(
      <ProviderPieChart
        providers={[
          makeProvider({ provider: 'openai', total_tokens: 300 }),
          makeProvider({ provider: 'anthropic', total_tokens: 200 }),
          makeProvider({ provider: 'unknown', total_tokens: 100 }),
        ]}
      />,
    )
    const option = readOption(container) as PieOption
    expect(option.series[0].data).toHaveLength(3)
    expect(option.series[0].data[0].name).toBe('openai')
    expect(option.series[0].data[1].name).toBe('anthropic')
    expect(option.series[0].data[2].name).toBe('未指定')
    // aria-label dataCount 应反映 3 项
    const figure = container.querySelector('[role="img"]')
    expect(figure?.getAttribute('aria-label')).toContain('共 3 项数据')
  })
})

// ============================================================================
// 3. ModelBarChart — Model 用量 Top 10 水平柱图
// ============================================================================
describe('ModelBarChart', () => {
  it('empty data → renders EmptyState', () => {
    const { container } = render(<ModelBarChart providers={[]} />)
    expect(container.textContent).toBe('暂无数据')
  })

  it('renders model list with values (reversed for horizontal bar)', () => {
    const { container } = render(
      <ModelBarChart
        providers={[
          makeProvider({ model: 'gpt-4o', total_tokens: 1000 }),
          makeProvider({ model: 'claude-3', total_tokens: 500 }),
        ]}
      />,
    )
    const option = readOption(container) as BarOption
    // 源码：yAxis.data = data.map(d => d.name).reverse()
    // 原 data 顺序 [gpt-4o, claude-3] → reverse → [claude-3, gpt-4o]
    expect(option.yAxis?.data).toEqual(['claude-3', 'gpt-4o'])
    expect(option.series[0].data).toEqual([500, 1000])
  })

  it('limits to top 10 models (slice 0..10)', () => {
    const providers: ProviderStats[] = Array.from({ length: 12 }, (_, i) =>
      makeProvider({ model: `model-${i}`, total_tokens: 100 - i }),
    )
    const { container } = render(<ModelBarChart providers={providers} />)
    const option = readOption(container) as BarOption
    expect(option.yAxis?.data).toHaveLength(10)
    expect(option.series[0].data).toHaveLength(10)
  })

  it('truncates model names longer than 14 chars with ellipsis', () => {
    const longModel = 'very-long-model-name-1234'
    const { container } = render(
      <ModelBarChart providers={[makeProvider({ model: longModel, total_tokens: 100 })]} />,
    )
    const option = readOption(container) as BarOption
    const name = option.yAxis?.data[0] ?? ''
    expect(name.endsWith('…')).toBe(true)
    expect(name.length).toBe(15) // 14 字符 + …
  })

  it('maps unknown model to "未指定"', () => {
    const { container } = render(
      <ModelBarChart providers={[makeProvider({ model: 'unknown', total_tokens: 100 })]} />,
    )
    const option = readOption(container) as BarOption
    expect(option.yAxis?.data[0]).toBe('未指定')
  })
})

// ============================================================================
// 4. FeatureBarChart — Feature Token + 请求数（双 Y 轴垂直柱图）
// ============================================================================
describe('FeatureBarChart', () => {
  it('empty data → renders EmptyState', () => {
    const { container } = render(<FeatureBarChart features={[]} />)
    expect(container.textContent).toBe('暂无数据')
  })

  it('renders feature list with Token + 请求数 dual series', () => {
    const { container } = render(
      <FeatureBarChart
        features={[
          makeFeature({ feature: 'chat', total_tokens: 1000, request_count: 50 }),
          makeFeature({ feature: 'review', total_tokens: 500, request_count: 25 }),
        ]}
      />,
    )
    const option = readOption(container) as BarOption
    expect(option.xAxis?.data).toEqual(['chat', 'review'])
    expect(option.series[0].name).toBe('Token')
    expect(option.series[0].data).toEqual([1000, 500])
    expect(option.series[1].name).toBe('请求数')
    expect(option.series[1].data).toEqual([50, 25])
  })
})

// ============================================================================
// 5. RequestPieChart — Feature 请求数占比环形图
// ============================================================================
describe('RequestPieChart', () => {
  it('empty data → renders EmptyState', () => {
    const { container } = render(<RequestPieChart features={[]} />)
    expect(container.textContent).toBe('暂无数据')
  })

  it('renders request_count as pie values', () => {
    const { container } = render(
      <RequestPieChart
        features={[
          makeFeature({ feature: 'chat', request_count: 80 }),
          makeFeature({ feature: 'review', request_count: 20 }),
        ]}
      />,
    )
    const option = readOption(container) as PieOption
    expect(option.series[0].data).toHaveLength(2)
    expect(option.series[0].data[0]).toEqual({ name: 'chat', value: 80 })
    expect(option.series[0].data[1]).toEqual({ name: 'review', value: 20 })
  })
})

// ============================================================================
// 6. TokensGauge — Token 用量综合仪表盘（cap = 5M）
// ============================================================================
describe('TokensGauge', () => {
  it('renders 0% when totalTokens = 0', () => {
    const { container } = render(<TokensGauge totalTokens={0} />)
    const option = readOption(container) as GaugeOption
    expect(option.series[0].data[0].value).toBe(0)
  })

  it('renders 50% when totalTokens = 2.5M (half of 5M cap)', () => {
    const { container } = render(<TokensGauge totalTokens={2_500_000} />)
    const option = readOption(container) as GaugeOption
    expect(option.series[0].data[0].value).toBe(50)
  })

  it('renders exactly 100% when totalTokens = 5M (cap reached)', () => {
    const { container } = render(<TokensGauge totalTokens={5_000_000} />)
    const option = readOption(container) as GaugeOption
    expect(option.series[0].data[0].value).toBe(100)
  })

  it('clamps to 100% when totalTokens exceeds cap (Math.min)', () => {
    const { container } = render(<TokensGauge totalTokens={10_000_000} />)
    const option = readOption(container) as GaugeOption
    // 源码：const pct = Math.min(100, (totalTokens / cap) * 100) → Math.min(100, 200) = 100
    expect(option.series[0].data[0].value).toBe(100)
  })

  it('renders relative-cap subtitle text below gauge', () => {
    const { container } = render(<TokensGauge totalTokens={0} />)
    expect(container.textContent).toContain('相对参考容量 5M Token')
  })
})

// ============================================================================
// 7. ProviderTokenBarChart — Provider 输入/输出 Token 堆叠柱图
// ============================================================================
describe('ProviderTokenBarChart', () => {
  it('empty data → renders EmptyState', () => {
    const { container } = render(<ProviderTokenBarChart providers={[]} />)
    expect(container.textContent).toBe('暂无数据')
  })

  it('renders stacked input + output tokens per provider', () => {
    const { container } = render(
      <ProviderTokenBarChart
        providers={[
          makeProvider({
            provider: 'openai',
            total_input_tokens: 300,
            total_output_tokens: 100,
          }),
          makeProvider({
            provider: 'anthropic',
            total_input_tokens: 200,
            total_output_tokens: 50,
          }),
        ]}
      />,
    )
    const option = readOption(container) as BarOption
    expect(option.xAxis?.data).toEqual(['openai', 'anthropic'])
    expect(option.series[0].name).toBe('输入 Token')
    expect(option.series[0].data).toEqual([300, 200])
    expect(option.series[1].name).toBe('输出 Token')
    expect(option.series[1].data).toEqual([100, 50])
    // 两个 series 都用同一 stack 名（堆叠）
    expect(option.series[0].stack).toBe('tokens')
    expect(option.series[1].stack).toBe('tokens')
  })

  it('maps unknown provider to "未指定"', () => {
    const { container } = render(
      <ProviderTokenBarChart providers={[makeProvider({ provider: 'unknown' })]} />,
    )
    const option = readOption(container) as BarOption
    expect(option.xAxis?.data[0]).toBe('未指定')
  })

  it('limits to top 6 providers (slice 0..6)', () => {
    const providers: ProviderStats[] = Array.from({ length: 8 }, (_, i) =>
      makeProvider({ provider: `p${i}` }),
    )
    const { container } = render(<ProviderTokenBarChart providers={providers} />)
    const option = readOption(container) as BarOption
    expect(option.xAxis?.data).toHaveLength(6)
  })
})

// ============================================================================
// 8. registerTailwindTheme — ECharts 主题注册（保留原有 smoke test）
// ============================================================================
describe('registerTailwindTheme', () => {
  it('is idempotent — 多次调用不抛错且只生效一次', () => {
    expect(() => {
      registerTailwindTheme()
      registerTailwindTheme()
      registerTailwindTheme()
    }).not.toThrow()
  })

  it('exposes a non-empty color palette', () => {
    expect(Array.isArray(tailwindTheme.color)).toBe(true)
    expect(tailwindTheme.color.length).toBeGreaterThanOrEqual(8)
    // 第一个颜色应为 emerald-500（#10b981）
    expect(tailwindTheme.color[0]).toBe('#10b981')
  })
})
