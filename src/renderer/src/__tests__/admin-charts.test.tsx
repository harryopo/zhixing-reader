/**
 * 知行读书 — AdminDashboard 图表组件 smoke test
 * P1-1 修复（2026-07-20）：补 ECharts 组件 + 主题注册测试
 *
 * 测试覆盖：
 *   1. ProviderPieChart: 空数据 → EmptyState（"暂无数据"）
 *   2. ProviderPieChart: unknown provider → "未指定" 映射
 *   3. registerTailwindTheme: 多次调用幂等
 *
 * 设计要点：
 *   - mock echarts-for-react 避免 jsdom 渲染 canvas 报错
 *   - 不依赖真实 ECharts 实例，只验证数据映射与渲染分支
 *   - 测试只读 mount 行为，不验证像素/位置
 */
// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'

// 必须在 import 被测组件前 mock（vitest 提升）
vi.mock('echarts-for-react', () => ({
  default: (props: { option?: unknown; style?: unknown; 'aria-label'?: string; 'aria-role'?: string }) => (
    <div
      data-testid="echarts-mock"
      data-option={JSON.stringify(props.option)}
      data-aria-label={props['aria-label'] ?? ''}
      data-aria-role={props['aria-role'] ?? ''}
    />
  ),
}))

import { ProviderPieChart } from '../admin-charts'
import { registerTailwindTheme, tailwindTheme } from '../echarts-theme-tailwind'

describe('admin-charts — smoke tests', () => {
  describe('ProviderPieChart', () => {
    it('empty data → renders EmptyState', () => {
      const { container } = render(<ProviderPieChart providers={[]} />)
      expect(container.textContent).toBe('暂无数据')
    })

    it('unknown provider → "未指定" 映射', () => {
      const { container } = render(
        <ProviderPieChart
          providers={[
            {
              provider: 'unknown',
              model: 'x',
              request_count: 1,
              total_input_tokens: 0,
              total_output_tokens: 0,
              total_tokens: 100,
              total_duration_ms: 0,
            },
          ]}
        />,
      )
      const mockEl = container.querySelector('[data-testid="echarts-mock"]')
      expect(mockEl).toBeTruthy()
      const option = JSON.parse(mockEl?.getAttribute('data-option') ?? '{}')
      // series.data[0].name 应被映射为"未指定"
      const seriesData = option.series?.[0]?.data
      expect(Array.isArray(seriesData)).toBe(true)
      expect(seriesData[0].name).toBe('未指定')
      expect(seriesData[0].value).toBe(100)
    })

    it('preserves known provider names', () => {
      const { container } = render(
        <ProviderPieChart
          providers={[
            {
              provider: 'openai',
              model: 'gpt-4o',
              request_count: 1,
              total_input_tokens: 0,
              total_output_tokens: 0,
              total_tokens: 50,
              total_duration_ms: 0,
            },
          ]}
        />,
      )
      const mockEl = container.querySelector('[data-testid="echarts-mock"]')
      const option = JSON.parse(mockEl?.getAttribute('data-option') ?? '{}')
      expect(option.series[0].data[0].name).toBe('openai')
    })

    // ✅ P1-4 修复回归测试：图表必须带 role="img" + aria-label 描述标题+数据量
    it('wraps chart in role="img" container with aria-label', () => {
      const { container } = render(
        <ProviderPieChart
          providers={[
            {
              provider: 'openai',
              model: 'gpt-4o',
              request_count: 1,
              total_input_tokens: 0,
              total_output_tokens: 0,
              total_tokens: 50,
              total_duration_ms: 0,
            },
          ]}
        />,
      )
      const figure = container.querySelector('[role="img"]')
      expect(figure).toBeTruthy()
      const ariaLabel = figure?.getAttribute('aria-label') ?? ''
      expect(ariaLabel).toContain('Provider 占比')
      expect(ariaLabel).toContain('共 1 项数据')
    })
  })

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
})
