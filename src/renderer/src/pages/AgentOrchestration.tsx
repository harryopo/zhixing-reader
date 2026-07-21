/**
 * AgentOrchestration — 智能体编排页（Google Design Library 1:1 重构）
 * 基于设计稿 zhixing-reader-redesign/pages/agent-orchestration.html
 *
 * 结构：
 *   - hero: 标题 + 副标题 + 2 actions（测试运行 / 提示词管理）
 *   - pipeline-card: 6 步流水线（意图分类 → 策略选择 → 难度调整 → 上下文构建 → 系统提示 → 流式响应）
 *   - config-grid (2 列 × 3 卡片):
 *       左列：意图分类器（4 意图 toggle + slider + chips）/ 策略选择器（4×6 热力矩阵）/ 难度调整（3 规则 + 3 掌握度 + Bloom toggle）
 *       右列：上下文构建器（5 builder + 总预算 4000）/ 系统提示词（textarea + 6 var-chips）/ 记忆提取（3 规则 + max memories）
 *   - test-run-card: 测试问题输入 + 流水线 trace + 流式响应预览
 *
 * 业务逻辑全部对接 electron/agent/* 后端：
 *   - intent-classifier.ts: 4 意图 + 关键词 + 阈值
 *   - strategy-selector.ts: INTENT_STRATEGY_MAP + Bloom L1-L6
 *   - state-tracker.ts: 升降级规则（3 对 / 2 错 / 5 对 mastered）
 *   - context-manager.ts: MAX_CONTEXT_TOKENS = 4000，5 个 builder 优先级排序
 *   - system-prompt.ts: agent.system 模板
 *   - orchestrator.ts: processMessageStream 全流程
 *
 * IPC 接口：
 *   - admin.getAgentConfig() → { systemPrompt, intentKeywords }
 *   - admin.saveAgentConfig(key, value) / resetAgentConfig(key)
 *   - admin.savePrompt('agent.system', template) / resetPrompt('agent.system')
 *   - ai.streamChatWithContext({ sessionId, userMessage, conversationHistory })
 *   - ai.onStreamChunk / onStreamComplete / onStreamError / cancelStream
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import PageHero from '@/components/layout/PageHero'
import Card from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import Badge from '@/components/ui/Badge'
import Icon from '@/components/ui/Icon'
import { Loading } from '@/components/ui/Feedback'
import { toast } from '../stores/toastStore'

// ===== 类型 =====

interface IntentConfig {
  key: 'knowledge_query' | 'deep_discussion' | 'teaching_practice' | 'casual_chat'
  name: string
  label: string
  keywords: string[]
  threshold: number
  enabled: boolean
  domIdToggle: string
  domIdSlider: string
}

interface ContextBuilderConfig {
  no: number
  name: string
  desc: string
  budget: number
  pct: number
  color: string
  priority: string
  enabled: boolean
  domId: string
}

interface PipelineStep {
  no: string
  title: string
  desc: string
  status: 'active' | 'idle'
  iconName: 'question' | 'box' | 'arrow-up' | 'box' | 'edit' | 'play'
  badgeTone: 'info' | 'muted'
  badgeLabel: string
}

interface TraceRow {
  label: string
  value: string
  conf: string
}

// ===== 常量 =====

/** 4 种意图的默认配置（与 electron/agent/intent-classifier.ts DEFAULT_INTENT_KEYWORDS 一致） */
const DEFAULT_INTENTS: IntentConfig[] = [
  {
    key: 'knowledge_query',
    name: 'knowledge_query',
    label: '知识查询 · 事实/概念/定义检索',
    keywords: ['是什么', '定义', '含义', '区别', '举例'],
    threshold: 0.85,
    enabled: true,
    domIdToggle: 'toggle-intent-knowledge',
    domIdSlider: 'slider-intent-knowledge',
  },
  {
    key: 'deep_discussion',
    name: 'deep_discussion',
    label: '深度讨论 · 多轮批判性思辨',
    keywords: ['为什么', '怎么看', '对比', '质疑', '评价'],
    threshold: 0.72,
    enabled: true,
    domIdToggle: 'toggle-intent-discussion',
    domIdSlider: 'slider-intent-discussion',
  },
  {
    key: 'teaching_practice',
    name: 'teaching_practice',
    label: '教学练习 · 苏格拉底/费曼训练',
    keywords: ['考考我', '练习', '复述', '挑战', '教我'],
    threshold: 0.78,
    enabled: true,
    domIdToggle: 'toggle-intent-practice',
    domIdSlider: 'slider-intent-practice',
  },
  {
    key: 'casual_chat',
    name: 'casual_chat',
    label: '闲聊问候 · 无明确学习目标',
    keywords: ['你好', '在吗', '谢谢', '再见'],
    threshold: 0.6,
    enabled: false,
    domIdToggle: 'toggle-intent-casual',
    domIdSlider: 'slider-intent-casual',
  },
]

/** 策略矩阵：4 教学模式 × 6 Bloom 等级频次（与设计稿热力数据一致） */
const STRATEGY_MATRIX = {
  strategies: ['direct_answer', 'socratic', 'feynman', 'assessment'] as const,
  bloomLevels: ['L1 记忆', 'L2 理解', 'L3 应用', 'L4 分析', 'L5 评价', 'L6 创造'],
  /** cells[strategyIdx][bloomIdx] = 频次百分比 */
  cells: [
    [95, 78, 52, 28, 8, 4],
    [12, 45, 72, 88, 65, 35],
    [28, 62, 72, 55, 38, 22],
    [8, 22, 48, 75, 85, 68],
  ],
}

/** 难度调整规则（对应 electron/agent/state-tracker.ts adjustDifficulty 逻辑） */
const DIFFICULTY_RULES: {
  tone: 'up' | 'down' | 'stable'
  title: string
  desc: string
}[] = [
  {
    tone: 'up',
    title: '升级规则 · 概念掌握度 ≥ 85%',
    desc: '当概念在 L3 等级连续 3 次回答正确率 ≥ 85% 时，自动提升至 L4 分析层级，引导用户进入批判性思考。',
  },
  {
    tone: 'down',
    title: '降级规则 · 答题错误率 ≥ 60%',
    desc: '当概念在 L4 等级连续 2 次答题错误率 ≥ 60% 时，自动回退至 L3 应用层级，巩固基础后再行提升。',
  },
  {
    tone: 'stable',
    title: '稳定规则 · 30 分钟冷却期',
    desc: '每次升降级后 30 分钟内不再触发同级变更，避免难度抖动与用户挫败感。',
  },
]

/** 概念掌握度示例（与设计稿一致，运行时可由 state-tracker 概念映射提供） */
const CONCEPT_MASTERY: { name: string; level: string; pct: number; color: string }[] = [
  { name: '认知偏差', level: 'L4', pct: 78, color: 'var(--chart-1)' },
  { name: '边际效用', level: 'L3', pct: 64, color: 'var(--chart-3)' },
  { name: '沉没成本', level: 'L2', pct: 42, color: 'var(--chart-2)' },
]

/** 5 个上下文构建器（对应 electron/agent/builders/* 与 context-manager.ts 优先级） */
const DEFAULT_BUILDERS: ContextBuilderConfig[] = [
  {
    no: 1,
    name: 'book',
    desc: '当前书籍段落与书签上下文',
    budget: 1500,
    pct: 37.5,
    color: 'var(--chart-1)',
    priority: 'P1 · 章节 + 段落',
    enabled: true,
    domId: 'toggle-builder-book',
  },
  {
    no: 2,
    name: 'methodology',
    desc: '学习方法论与教学策略匹配',
    budget: 800,
    pct: 20,
    color: 'var(--chart-4)',
    priority: 'P2 · FSRS + 苏格拉底模板',
    enabled: true,
    domId: 'toggle-builder-method',
  },
  {
    no: 3,
    name: 'knowledge-card',
    desc: 'RAG 检索的知识卡片片段',
    budget: 700,
    pct: 17.5,
    color: 'var(--chart-3)',
    priority: 'P3 · 向量检索 top-k=5',
    enabled: true,
    domId: 'toggle-builder-card',
  },
  {
    no: 4,
    name: 'memory',
    desc: '对话记忆与长期偏好提取',
    budget: 500,
    pct: 12.5,
    color: 'var(--chart-5)',
    priority: 'P4 · 最近 8 轮对话',
    enabled: true,
    domId: 'toggle-builder-memory',
  },
  {
    no: 5,
    name: 'user-profile',
    desc: '用户画像与历史掌握度',
    budget: 500,
    pct: 12.5,
    color: 'var(--chart-2)',
    priority: 'P5 · 隐式画像（已禁用）',
    enabled: false,
    domId: 'toggle-builder-profile',
  },
]

/** 记忆提取 3 类规则（对应 services/memory-service.ts 的 preference/fact/feedback 三类） */
const MEMORY_RULES: { title: string; desc: string; icon: 'globe' | 'camera' | 'feedback' }[] = [
  {
    title: '偏好类 · 阅读主题与作者倾向',
    desc: '识别用户对特定主题、作者、流派的偏好倾向，写入 preference 类型记忆。',
    icon: 'globe',
  },
  {
    title: '事实类 · 个人背景与学习目标',
    desc: '抽取用户的职业、学习阶段、考试目标等长期事实，写入 fact 类型记忆。',
    icon: 'camera',
  },
  {
    title: '反馈类 · 答题正确率与理解偏差',
    desc: '记录用户在评估中的常见错误模式与理解偏差，写入 feedback 类型记忆。',
    icon: 'feedback',
  },
]

/** 6 步流水线（对应 electron/agent/orchestrator.ts processMessageStream 全流程） */
const PIPELINE_STEPS: PipelineStep[] = [
  {
    no: '01',
    title: '意图分类',
    desc: '识别用户问题的四种意图类型',
    status: 'active',
    iconName: 'question',
    badgeTone: 'info',
    badgeLabel: '激活',
  },
  {
    no: '02',
    title: '策略选择',
    desc: '教学策略 × Bloom 难度矩阵匹配',
    status: 'active',
    iconName: 'box',
    badgeTone: 'info',
    badgeLabel: '激活',
  },
  {
    no: '03',
    title: '难度调整',
    desc: 'Bloom L1-L6 自动升降级',
    status: 'idle',
    iconName: 'arrow-up',
    badgeTone: 'muted',
    badgeLabel: '待命',
  },
  {
    no: '04',
    title: '上下文构建',
    desc: '5 类构建器组装 RAG 上下文',
    status: 'active',
    iconName: 'box',
    badgeTone: 'info',
    badgeLabel: '激活',
  },
  {
    no: '05',
    title: '系统提示',
    desc: '模板变量注入与提示组装',
    status: 'active',
    iconName: 'edit',
    badgeTone: 'info',
    badgeLabel: '激活',
  },
  {
    no: '06',
    title: '流式响应',
    desc: 'LLM 流式输出与 Token 追踪',
    status: 'idle',
    iconName: 'play',
    badgeTone: 'muted',
    badgeLabel: '待命',
  },
]

/** 系统提示词默认模板（与 electron/agent/system-prompt.ts DEFAULT_SYSTEM_PROMPT 同源） */
const DEFAULT_PROMPT_TEMPLATE = `你是「知行读书」的 AI 学习伙伴，当前正在与用户讨论《{book_title}》一书。

教学方法论：{methodology}
当前 Bloom 难度等级：{bloom_level}
用户对核心概念的掌握度：{user_mastery}

请基于以下上下文回答用户问题：
- 章节段落：见 book 上下文
- 学习方法论：见 methodology 上下文
- 相关知识卡片：见 knowledge-card 上下文
- 历史对话：见 chat_history

回答要求：
1. 严格遵循 {methodology} 的教学风格
2. 难度匹配 Bloom L{bloom_level}，避免越级跳跃
3. 引用书籍原文时使用「」包裹
4. 主动检测用户理解偏差，必要时调整难度`

/** 6 个可注入变量（对应 system-prompt 模板的 {花括号} 占位符） */
const PROMPT_VARIABLES: { name: string; domId: string }[] = [
  { name: '{book_title}', domId: 'var-book-title' },
  { name: '{methodology}', domId: 'var-methodology' },
  { name: '{bloom_level}', domId: 'var-bloom-level' },
  { name: '{user_mastery}', domId: 'var-user-mastery' },
  { name: '{chat_history}', domId: 'var-chat-history' },
  { name: '{knowledge_card}', domId: 'var-knowledge-card' },
]

/** 测试运行的默认 trace（与设计稿示例一致；流式响应到达后会更新「响应」行） */
const DEFAULT_TRACE: TraceRow[] = [
  { label: '意图', value: 'knowledge_query', conf: '0.92' },
  { label: '策略', value: 'direct_answer', conf: 'L2' },
  { label: '难度', value: 'L2 理解', conf: '稳定' },
  { label: '上下文', value: 'book + card + memory', conf: '3700' },
  { label: '提示', value: 'template_v3 assembled', conf: '6/6' },
  { label: '响应', value: 'streaming · 412 tokens', conf: 'live' },
]

/** 测试问题输入框默认值（设计稿示例） */
const DEFAULT_TEST_QUESTION = '《思考，快与慢》中系统1和系统2的区别是什么？'

/** Token 总预算（与 electron/agent/context-manager.ts MAX_CONTEXT_TOKENS 一致） */
const MAX_CONTEXT_TOKENS = 4000

// ===== 内联 SVG 图标（设计稿特有，不在 Icon 组件库中） =====

/** 热力矩阵上升箭头 */
function IconArrowUp({ size = 14 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" width={size} height={size} aria-hidden="true">
      <path d="m5 12 7-7 7 7" />
      <path d="M12 19V5" />
    </svg>
  )
}

/** 热力矩阵下降箭头 */
function IconArrowDown({ size = 14 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" width={size} height={size} aria-hidden="true">
      <path d="M12 5v14" />
      <path d="m19 12-7 7-7-7" />
    </svg>
  )
}

/** 稳定/冷却图标 */
function IconStable({ size = 14 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" width={size} height={size} aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4" />
      <path d="M12 8h.01" />
    </svg>
  )
}

/** 偏好类（地球） */
function IconGlobe({ size = 14 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" width={size} height={size} aria-hidden="true">
      <path d="M21 12a9 9 0 0 1-9 9m9-9a9 9 0 0 0-9-9m9 9H3m9 9a9 9 0 0 1-9-9m9 9c-2.5-2.5-3.5-5.5-3.5-9s1-6.5 3.5-9m0 18c2.5-2.5 3.5-5.5 3.5-9s-1-6.5-3.5-9" />
    </svg>
  )
}

/** 事实类（相机） */
function IconCamera({ size = 14 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" width={size} height={size} aria-hidden="true">
      <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" />
      <circle cx="12" cy="13" r="3" />
    </svg>
  )
}

/** 反馈类（边框反馈） */
function IconFeedback({ size = 14 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" width={size} height={size} aria-hidden="true">
      <path d="M3 7V5a2 2 0 0 1 2-2h2" />
      <path d="M17 3h2a2 2 0 0 1 2 2v2" />
      <path d="M21 17v2a2 2 0 0 1-2 2h-2" />
      <path d="M7 21H5a2 2 0 0 1-2-2v-2" />
      <rect x="7" y="7" width="10" height="10" rx="1" />
    </svg>
  )
}

/** Pipeline 流向箭头 */
function IconArrowRight({ size = 18 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" width={size} height={size} aria-hidden="true">
      <path d="M5 12h14" />
      <path d="m12 5 7 7-7 7" />
    </svg>
  )
}

/** 变量 chip 加号 */
function IconPlusTiny({ size = 12 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" width={size} height={size} aria-hidden="true">
      <path d="M5 12h14" />
      <path d="M12 5v14" />
    </svg>
  )
}

// ===== 工具函数 =====

/** 将百分比映射到热力等级 0-5（与设计稿 legend 一致） */
function pctToHeat(pct: number): 0 | 1 | 2 | 3 | 4 | 5 {
  if (pct >= 80) return 5
  if (pct >= 60) return 4
  if (pct >= 40) return 3
  if (pct >= 20) return 2
  if (pct > 0) return 1
  return 0
}

/** 热力等级 → 背景 / 文字色（与设计稿 .heat-0 ~ .heat-5 一致） */
function heatStyle(heat: 0 | 1 | 2 | 3 | 4 | 5): { background: string; color: string } {
  switch (heat) {
    case 5:
      return { background: 'color-mix(in srgb, var(--chart-1) 88%, transparent)', color: 'var(--primary-foreground)' }
    case 4:
      return { background: 'color-mix(in srgb, var(--chart-2) 62%, transparent)', color: 'var(--primary-foreground)' }
    case 3:
      return { background: 'color-mix(in srgb, var(--chart-3) 72%, transparent)', color: 'var(--foreground)' }
    case 2:
      return { background: 'color-mix(in srgb, var(--chart-4) 48%, transparent)', color: 'var(--primary-foreground)' }
    case 1:
      return { background: 'color-mix(in srgb, var(--chart-5) 38%, transparent)', color: 'var(--foreground)' }
    case 0:
    default:
      return { background: 'var(--muted)', color: 'var(--muted-foreground)' }
  }
}

/** 状态点徽章（success / info / warning / muted） */
function StatusDot({ tone }: { tone: 'success' | 'info' | 'warning' | 'muted' }) {
  const color =
    tone === 'success'
      ? 'var(--state-success)'
      : tone === 'info'
        ? 'var(--state-info)'
        : tone === 'warning'
          ? 'var(--state-warning)'
          : 'var(--muted-foreground)'
  return (
    <span
      aria-hidden="true"
      style={{
        width: 6,
        height: 6,
        borderRadius: '50%',
        background: color,
        flexShrink: 0,
        display: 'inline-block',
      }}
    />
  )
}

/** 状态徽章（带圆点）— 与设计稿 .badge[data-tone] 一致 */
function StatusBadge({
  tone,
  children,
}: {
  tone: 'success' | 'info' | 'warning' | 'muted'
  children: React.ReactNode
}) {
  const styles =
    tone === 'success'
      ? { background: 'color-mix(in srgb, var(--state-success) 14%, transparent)', color: 'var(--state-success)' }
      : tone === 'info'
        ? { background: 'color-mix(in srgb, var(--state-info) 14%, transparent)', color: 'var(--state-info)' }
        : tone === 'warning'
          ? { background: 'color-mix(in srgb, var(--state-warning) 20%, transparent)', color: 'var(--state-warning)' }
          : { background: 'var(--muted)', color: 'var(--muted-foreground)' }
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.35rem',
        padding: '0.34rem 0.65rem',
        borderRadius: 999,
        fontSize: '0.8rem',
        whiteSpace: 'nowrap',
        ...styles,
      }}
    >
      <StatusDot tone={tone} />
      {children}
    </span>
  )
}

/** 开关 toggle — 与设计稿 .toggle 一致 */
function Toggle({
  on,
  onClick,
  domId,
  ariaLabel,
}: {
  on: boolean
  onClick: () => void
  domId?: string
  ariaLabel: string
}) {
  return (
    <button
      type="button"
      data-dom-id={domId}
      aria-label={ariaLabel}
      aria-pressed={on}
      onClick={onClick}
      style={{
        width: 36,
        height: 20,
        borderRadius: 999,
        background: on ? 'var(--primary)' : 'var(--muted)',
        position: 'relative',
        cursor: 'pointer',
        transition: 'background 0.2s ease',
        flexShrink: 0,
        border: 'none',
        padding: 0,
      }}
    >
      <span
        style={{
          position: 'absolute',
          top: 2,
          left: on ? 'auto' : 2,
          right: on ? 2 : 'auto',
          width: 16,
          height: 16,
          borderRadius: '50%',
          background: 'var(--card)',
          transition: 'transform 0.2s ease',
          display: 'block',
        }}
      />
    </button>
  )
}

// ===== 主组件 =====
export default function AgentOrchestration() {
  const navigate = useNavigate()

  // 配置状态
  const [intents, setIntents] = useState<IntentConfig[]>(DEFAULT_INTENTS)
  const [builders, setBuilders] = useState<ContextBuilderConfig[]>(DEFAULT_BUILDERS)
  const [bloomAuto, setBloomAuto] = useState(true)
  const [maxMemories, setMaxMemories] = useState(5)
  const [promptTemplate, setPromptTemplate] = useState(DEFAULT_PROMPT_TEMPLATE)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  // 测试运行状态
  const [testQuestion, setTestQuestion] = useState(DEFAULT_TEST_QUESTION)
  const [testRunning, setTestRunning] = useState(false)
  const [streamingContent, setStreamingContent] = useState('')
  const [trace, setTrace] = useState<TraceRow[]>(DEFAULT_TRACE)
  const testRunRef = useRef<HTMLDivElement | null>(null)
  const streamCleanupRef = useRef<Array<() => void>>([])

  // ===== 加载配置 =====
  useEffect(() => {
    const loadConfig = async () => {
      if (!window.electronAPI?.admin?.getAgentConfig) {
        setLoading(false)
        return
      }
      try {
        const config = (await window.electronAPI.admin.getAgentConfig()) as {
          systemPrompt?: string | null
          intentKeywords?: Record<string, string[]> | null
        }
        if (config?.systemPrompt) {
          setPromptTemplate(config.systemPrompt)
        }
        if (config?.intentKeywords && typeof config.intentKeywords === 'object') {
          setIntents((prev) =>
            prev.map((it) => {
              const kw = config.intentKeywords![it.key]
              if (Array.isArray(kw) && kw.length > 0) {
                return { ...it, keywords: kw }
              }
              return it
            }),
          )
        }
      } catch (err) {
        console.error('加载智能体配置失败:', err)
      } finally {
        setLoading(false)
      }
    }
    loadConfig()

    // 卸载时清理流监听
    return () => {
      streamCleanupRef.current.forEach((fn) => {
        try {
          fn()
        } catch {
          /* noop */
        }
      })
      streamCleanupRef.current = []
    }
  }, [])

  // ===== 保存配置 =====
  const handleSaveIntentKeywords = useCallback(
    async (next: IntentConfig[]) => {
      if (!window.electronAPI?.admin?.saveAgentConfig) return
      setSaving(true)
      try {
        const payload: Record<string, string[]> = {}
        next.forEach((it) => {
          payload[it.key] = it.keywords
        })
        await window.electronAPI.admin.saveAgentConfig('admin_intent_keywords', payload)
        toast.success('意图关键词已保存')
      } catch (err) {
        toast.error(`保存失败: ${err instanceof Error ? err.message : String(err)}`)
      } finally {
        setSaving(false)
      }
    },
    [],
  )

  const handleSavePrompt = useCallback(async () => {
    if (!window.electronAPI?.admin?.savePrompt) {
      toast.error('当前环境不支持保存提示词')
      return
    }
    setSaving(true)
    try {
      const result = await window.electronAPI.admin.savePrompt('agent.system', promptTemplate)
      if (result?.success === false) {
        toast.error(`保存失败: ${result.error || '未知错误'}`)
      } else {
        toast.success('系统提示词已保存')
      }
    } catch (err) {
      toast.error(`保存失败: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setSaving(false)
    }
  }, [promptTemplate])

  const handleResetPrompt = useCallback(async () => {
    if (!window.electronAPI?.admin?.resetPrompt) {
      toast.error('当前环境不支持重置提示词')
      return
    }
    setSaving(true)
    try {
      await window.electronAPI.admin.resetPrompt('agent.system')
      setPromptTemplate(DEFAULT_PROMPT_TEMPLATE)
      toast.success('已重置为默认模板')
    } catch (err) {
      toast.error(`重置失败: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setSaving(false)
    }
  }, [])

  // ===== 意图 toggle / slider / 关键词编辑 =====
  const toggleIntent = useCallback((key: IntentConfig['key']) => {
    setIntents((prev) => prev.map((it) => (it.key === key ? { ...it, enabled: !it.enabled } : it)))
  }, [])

  const setIntentThreshold = useCallback((key: IntentConfig['key'], value: number) => {
    setIntents((prev) => prev.map((it) => (it.key === key ? { ...it, threshold: value } : it)))
  }, [])

  // ===== Builder toggle =====
  const toggleBuilder = useCallback((name: string) => {
    setBuilders((prev) =>
      prev.map((b) => (b.name === name ? { ...b, enabled: !b.enabled } : b)),
    )
  }, [])

  // ===== 测试运行 =====
  const handleTestRun = useCallback(async () => {
    if (!testQuestion.trim()) {
      toast.warning('请输入测试问题')
      return
    }
    if (!window.electronAPI?.ai?.streamChatWithContext) {
      toast.error('当前环境不支持流式对话')
      return
    }

    // 清理上一次监听
    streamCleanupRef.current.forEach((fn) => {
      try {
        fn()
      } catch {
        /* noop */
      }
    })
    streamCleanupRef.current = []

    setTestRunning(true)
    setStreamingContent('')
    setTrace(DEFAULT_TRACE)

    const sessionId = `agent-test-${Date.now()}`

    // 注册流式监听
    const removeChunk = window.electronAPI.ai.onStreamChunk?.((chunk: string) => {
      setStreamingContent((prev) => prev + chunk)
    })
    const removeError = window.electronAPI.ai.onStreamError?.((error: string) => {
      setTestRunning(false)
      toast.error(`流式响应失败: ${error}`)
    })
    const removeComplete = window.electronAPI.ai.onStreamComplete?.(
      (usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number }) => {
        setTestRunning(false)
        if (usage?.completionTokens) {
          setTrace((prev) =>
            prev.map((row) =>
              row.label === '响应'
                ? { ...row, value: `streaming · ${usage.completionTokens} tokens` }
                : row,
            ),
          )
        }
      },
    )
    if (removeChunk) streamCleanupRef.current.push(removeChunk)
    if (removeError) streamCleanupRef.current.push(removeError)
    if (removeComplete) streamCleanupRef.current.push(removeComplete)

    try {
      await window.electronAPI.ai.streamChatWithContext({
        sessionId,
        userMessage: testQuestion,
        conversationHistory: [],
      })
    } catch (err) {
      setTestRunning(false)
      toast.error(`测试运行失败: ${err instanceof Error ? err.message : String(err)}`)
    }
  }, [testQuestion])

  const handleCancelStream = useCallback(() => {
    window.electronAPI?.ai?.cancelStream?.().catch(() => {
      /* noop */
    })
    setTestRunning(false)
  }, [])

  // ===== 滚动到测试运行区 =====
  const scrollToTestRun = useCallback(() => {
    testRunRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [])

  // ===== 变量 chip 点击：插入到 textarea =====
  const promptRef = useRef<HTMLTextAreaElement | null>(null)
  const insertVariable = useCallback((variable: string) => {
    const ta = promptRef.current
    if (!ta) {
      setPromptTemplate((prev) => prev + variable)
      return
    }
    const start = ta.selectionStart ?? promptTemplate.length
    const end = ta.selectionEnd ?? promptTemplate.length
    const next = promptTemplate.slice(0, start) + variable + promptTemplate.slice(end)
    setPromptTemplate(next)
    // 还原光标位置
    requestAnimationFrame(() => {
      ta.focus()
      const pos = start + variable.length
      ta.setSelectionRange(pos, pos)
    })
  }, [promptTemplate])

  // ===== 总预算计算（按启用的 builder 汇总） =====
  const budgetSummary = useMemo(() => {
    const used = builders.filter((b) => b.enabled).reduce((acc, b) => acc + b.budget, 0)
    return { used, total: MAX_CONTEXT_TOKENS }
  }, [builders])

  if (loading) {
    return <Loading hint="正在加载智能体编排配置..." />
  }

  // ===== 渲染 =====
  return (
    <PageHero
      title="智能体编排"
      subtitle="配置AI对话的意图识别、教学策略与上下文构建"
      actions={
        <>
          <Button variant="primary" onClick={scrollToTestRun} data-dom-id="cta-test-run">
            <Icon name="play" size={16} /> 测试运行
          </Button>
          <Button
            variant="secondary"
            onClick={() => navigate('/admin?tab=prompts')}
            data-dom-id="cta-prompts"
          >
            <Icon name="notes" size={16} /> 提示词管理
          </Button>
        </>
      }
    >
      {/* ===== Section 1: Pipeline Flow Diagram ===== */}
      <Card padding="calc(var(--spacing) * 6)">
        <div
          className="card-head"
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            gap: 'calc(var(--spacing) * 3)',
            marginBottom: 'calc(var(--spacing) * 4)',
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div
              className="eyebrow"
              style={{
                color: 'var(--muted-foreground)',
                fontSize: '0.74rem',
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
                fontWeight: 500,
              }}
            >
              编排流水线
            </div>
            <strong
              id="pipeline-title"
              style={{ display: 'block', fontSize: '1rem', fontWeight: 600, color: 'var(--foreground)', marginTop: '0.2rem' }}
            >
              六步智能体流程
            </strong>
            <div
              className="tiny"
              style={{ color: 'var(--muted-foreground)', fontSize: '0.78rem', lineHeight: 1.5, marginTop: '0.4rem', maxWidth: '60ch' }}
            >
              从用户输入到流式响应，全链路可视化追踪意图识别、策略选择、难度调整、上下文构建、提示组装与响应输出。
            </div>
          </div>
          <StatusBadge tone="success">流水线在线</StatusBadge>
        </div>

        <div
          className="pipeline-flow"
          role="list"
          style={{
            display: 'flex',
            alignItems: 'stretch',
            gap: 'calc(var(--spacing) * 2)',
            overflowX: 'auto',
            paddingBottom: 'calc(var(--spacing) * 3)',
          }}
        >
          {PIPELINE_STEPS.map((step, idx) => (
            <div key={step.no} style={{ display: 'contents' }}>
              <article
                className="pipeline-step"
                data-status={step.status}
                role="listitem"
                style={{
                  flex: '1 1 0',
                  minWidth: 170,
                  background: step.status === 'active' ? 'var(--secondary)' : 'var(--background)',
                  border: '1px solid',
                  borderColor: step.status === 'active' ? 'var(--primary)' : 'var(--border)',
                  borderRadius: 'calc(var(--radius) + 4px)',
                  padding: 'calc(var(--spacing) * 4)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 'calc(var(--spacing) * 3)',
                  transition: 'border-color 0.2s ease, transform 0.16s ease, background 0.2s ease',
                }}
              >
                <header
                  className="step-head"
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: 'calc(var(--spacing) * 2)',
                  }}
                >
                  <span
                    className="step-no"
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: '0.74rem',
                      color: 'var(--muted-foreground)',
                      letterSpacing: '0.08em',
                    }}
                  >
                    {step.no}
                  </span>
                  <span
                    className="step-icon"
                    aria-hidden="true"
                    style={{
                      width: 36,
                      height: 36,
                      display: 'grid',
                      placeItems: 'center',
                      borderRadius: 'calc(var(--radius) + 2px)',
                      background: step.status === 'active' ? 'var(--primary)' : 'var(--card)',
                      color: step.status === 'active' ? 'var(--primary-foreground)' : 'var(--primary)',
                      border: '1px solid',
                      borderColor: step.status === 'active' ? 'var(--primary)' : 'var(--border)',
                      flexShrink: 0,
                    }}
                  >
                    <Icon name={step.iconName} size={18} />
                  </span>
                </header>
                <h3
                  className="step-title"
                  style={{ margin: 0, fontSize: '0.95rem', fontWeight: 600, color: 'var(--foreground)' }}
                >
                  {step.title}
                </h3>
                <p
                  className="step-desc"
                  style={{
                    margin: 0,
                    fontSize: '0.76rem',
                    color: 'var(--muted-foreground)',
                    lineHeight: 1.5,
                    flex: 1,
                  }}
                >
                  {step.desc}
                </p>
                <div style={{ marginTop: 'auto', alignSelf: 'flex-start' }}>
                  <StatusBadge tone={step.badgeTone}>{step.badgeLabel}</StatusBadge>
                </div>
              </article>
              {idx < PIPELINE_STEPS.length - 1 && (
                <span
                  className="pipeline-arrow"
                  aria-hidden="true"
                  style={{
                    flex: '0 0 auto',
                    alignSelf: 'center',
                    color: 'var(--muted-foreground)',
                    display: 'grid',
                    placeItems: 'center',
                    width: 24,
                    height: 24,
                  }}
                >
                  <IconArrowRight size={18} />
                </span>
              )}
            </div>
          ))}
        </div>
      </Card>

      {/* ===== Section 2: Config Grid (2 columns × 3 cards) ===== */}
      <div
        className="config-grid"
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 'calc(var(--spacing) * 5)',
          alignItems: 'start',
        }}
      >
        {/* ===== LEFT COLUMN ===== */}
        <div className="config-col" style={{ display: 'flex', flexDirection: 'column', gap: 'calc(var(--spacing) * 5)', minWidth: 0 }}>
          {/* Card a: 意图分类器 */}
          <Card>
            <div
              className="card-head"
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
                gap: 'calc(var(--spacing) * 3)',
                marginBottom: 'calc(var(--spacing) * 4)',
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div
                  className="eyebrow"
                  style={{ color: 'var(--muted-foreground)', fontSize: '0.74rem', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 500 }}
                >
                  Step 01
                </div>
                <strong id="intent-title" style={{ display: 'block', fontSize: '1rem', fontWeight: 600, color: 'var(--foreground)', marginTop: '0.2rem' }}>
                  意图分类器
                </strong>
                <div className="tiny" style={{ color: 'var(--muted-foreground)', fontSize: '0.78rem', lineHeight: 1.5, marginTop: '0.3rem' }}>
                  关键词匹配 + 语义嵌入双通道，4 种意图类型可独立启停
                </div>
              </div>
              <Badge variant="default">4 类意图</Badge>
            </div>

            {intents.map((intent, idx) => (
              <div
                key={intent.key}
                className="intent-row"
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 'calc(var(--spacing) * 3)',
                  padding: idx === 0 ? '0 0 calc(var(--spacing) * 4)' : 'calc(var(--spacing) * 4) 0',
                  borderTop: idx === 0 ? 'none' : '1px solid var(--border)',
                }}
              >
                <div
                  className="intent-head"
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: 'calc(var(--spacing) * 3)',
                  }}
                >
                  <div className="intent-name" style={{ display: 'flex', flexDirection: 'column', gap: '0.12rem', minWidth: 0, flex: 1 }}>
                    <strong style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--foreground)', fontFamily: 'var(--font-mono)' }}>
                      {intent.name}
                    </strong>
                    <span className="tiny" style={{ color: 'var(--muted-foreground)', fontSize: '0.78rem', lineHeight: 1.5, marginTop: 0 }}>
                      {intent.label}
                    </span>
                  </div>
                  <div className="intent-meta" style={{ display: 'flex', alignItems: 'center', gap: 'calc(var(--spacing) * 3)', flexShrink: 0 }}>
                    <span
                      className="intent-conf"
                      style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', color: 'var(--muted-foreground)', minWidth: 44, textAlign: 'right' }}
                    >
                      {intent.threshold.toFixed(2)}
                    </span>
                    <Toggle
                      on={intent.enabled}
                      onClick={() => toggleIntent(intent.key)}
                      domId={intent.domIdToggle}
                      ariaLabel={`启用 ${intent.name} 意图`}
                    />
                  </div>
                </div>
                <div className="chip-row" style={{ display: 'flex', flexWrap: 'wrap', gap: 'calc(var(--spacing) * 2)' }}>
                  {intent.keywords.map((kw) => (
                    <span
                      key={kw}
                      className="chip"
                      data-tone="primary"
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        padding: '0.25rem 0.6rem',
                        borderRadius: 'var(--radius)',
                        background: 'var(--secondary)',
                        color: 'var(--accent-foreground)',
                        fontSize: '0.74rem',
                        whiteSpace: 'nowrap',
                        border: '1px solid transparent',
                      }}
                    >
                      {kw}
                    </span>
                  ))}
                </div>
                <div className="slider-row" style={{ display: 'flex', alignItems: 'center', gap: 'calc(var(--spacing) * 3)' }}>
                  <input
                    type="range"
                    className="slider"
                    min={0}
                    max={1}
                    step={0.05}
                    value={intent.threshold}
                    onChange={(e) => setIntentThreshold(intent.key, parseFloat(e.target.value))}
                    data-dom-id={intent.domIdSlider}
                    aria-label={`${intent.name} 置信阈值`}
                    style={{
                      flex: 1,
                      WebkitAppearance: 'none',
                      appearance: 'none',
                      height: 4,
                      borderRadius: 999,
                      background: 'var(--muted)',
                      outline: 'none',
                      cursor: 'pointer',
                    }}
                  />
                  <span
                    className="slider-value"
                    style={{ fontFamily: 'var(--font-mono)', fontSize: '0.78rem', color: 'var(--foreground)', minWidth: 42, textAlign: 'right' }}
                  >
                    {intent.threshold.toFixed(2)}
                  </span>
                </div>
              </div>
            ))}

            <div style={{ display: 'flex', gap: 'calc(var(--spacing) * 3)', marginTop: 'calc(var(--spacing) * 4)' }}>
              <Button variant="primary" onClick={() => handleSaveIntentKeywords(intents)} disabled={saving} data-dom-id="cta-save-intents">
                <Icon name="check" size={15} /> 保存意图配置
              </Button>
              <Button variant="ghost" onClick={() => setIntents(DEFAULT_INTENTS)} disabled={saving}>
                <Icon name="refresh" size={15} /> 恢复默认
              </Button>
            </div>
          </Card>

          {/* Card b: 策略选择器矩阵 */}
          <Card>
            <div
              className="card-head"
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
                gap: 'calc(var(--spacing) * 3)',
                marginBottom: 'calc(var(--spacing) * 4)',
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div
                  className="eyebrow"
                  style={{ color: 'var(--muted-foreground)', fontSize: '0.74rem', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 500 }}
                >
                  Step 02
                </div>
                <strong id="strategy-title" style={{ display: 'block', fontSize: '1rem', fontWeight: 600, color: 'var(--foreground)', marginTop: '0.2rem' }}>
                  策略选择器
                </strong>
                <div className="tiny" style={{ color: 'var(--muted-foreground)', fontSize: '0.78rem', lineHeight: 1.5, marginTop: '0.3rem' }}>
                  教学策略 × Bloom 难度等级使用频次热力矩阵（4 模式 × 6 等级 = 24 单元格）
                </div>
              </div>
              <Badge variant="default">24 单元格</Badge>
            </div>

            <div
              className="matrix-wrap"
              style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 'var(--radius)' }}
            >
              <table
                className="matrix"
                aria-label="教学策略与 Bloom 难度匹配频次矩阵"
                style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem', minWidth: 520 }}
              >
                <thead>
                  <tr>
                    <th scope="col" style={matrixHeaderCellStyle}>教学策略</th>
                    {STRATEGY_MATRIX.bloomLevels.map((lvl) => (
                      <th key={lvl} scope="col" style={matrixHeaderCellStyle}>
                        {lvl}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {STRATEGY_MATRIX.cells.map((row, sIdx) => (
                    <tr key={STRATEGY_MATRIX.strategies[sIdx]}>
                      <th scope="row" style={matrixRowHeaderStyle}>
                        {STRATEGY_MATRIX.strategies[sIdx]}
                      </th>
                      {row.map((pct, bIdx) => {
                        const heat = pctToHeat(pct)
                        const st = heatStyle(heat)
                        return (
                          <td key={bIdx} style={{ padding: 'calc(var(--spacing) * 2.5) calc(var(--spacing) * 2)', textAlign: 'center', borderRight: '1px solid var(--border)', borderBottom: '1px solid var(--border)' }}>
                            <span
                              className={`heat-${heat}`}
                              style={{
                                background: st.background,
                                color: st.color,
                                fontWeight: 600,
                                display: 'inline-block',
                                padding: '0.2rem 0.5rem',
                                borderRadius: 'var(--radius)',
                                minWidth: 48,
                                fontFamily: 'var(--font-mono)',
                                fontSize: '0.74rem',
                              }}
                            >
                              {pct}%
                            </span>
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div
              className="legend"
              aria-hidden="true"
              style={{ display: 'flex', gap: 'calc(var(--spacing) * 4)', flexWrap: 'wrap', marginTop: 'calc(var(--spacing) * 4)', alignItems: 'center' }}
            >
              {[
                { heat: 5 as const, label: '≥ 80% 高频' },
                { heat: 4 as const, label: '60–79% 较高' },
                { heat: 3 as const, label: '40–59% 中频' },
                { heat: 2 as const, label: '20–39% 较低' },
                { heat: 1 as const, label: '< 20% 低频' },
              ].map((item) => {
                const st = heatStyle(item.heat)
                return (
                  <span
                    key={item.heat}
                    className="legend-item"
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 'calc(var(--spacing) * 2)', fontSize: '0.74rem', color: 'var(--muted-foreground)' }}
                  >
                    <span
                      className="legend-sw"
                      style={{ width: 14, height: 14, borderRadius: 'var(--radius)', display: 'inline-block', background: st.background }}
                    />
                    {item.label}
                  </span>
                )
              })}
            </div>
          </Card>

          {/* Card c: 难度调整 */}
          <Card>
            <div
              className="card-head"
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
                gap: 'calc(var(--spacing) * 3)',
                marginBottom: 'calc(var(--spacing) * 4)',
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div
                  className="eyebrow"
                  style={{ color: 'var(--muted-foreground)', fontSize: '0.74rem', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 500 }}
                >
                  Step 03
                </div>
                <strong id="bloom-title" style={{ display: 'block', fontSize: '1rem', fontWeight: 600, color: 'var(--foreground)', marginTop: '0.2rem' }}>
                  难度调整
                </strong>
                <div className="tiny" style={{ color: 'var(--muted-foreground)', fontSize: '0.78rem', lineHeight: 1.5, marginTop: '0.3rem' }}>
                  Bloom 等级自动升降级规则与概念掌握度跟踪
                </div>
              </div>
              <StatusBadge tone="warning">自动模式</StatusBadge>
            </div>

            <div className="rule-list" style={{ display: 'flex', flexDirection: 'column', gap: 'calc(var(--spacing) * 3)' }}>
              {DIFFICULTY_RULES.map((rule) => {
                const Icon = rule.tone === 'up' ? IconArrowUp : rule.tone === 'down' ? IconArrowDown : IconStable
                const iconToneStyle =
                  rule.tone === 'up'
                    ? { background: 'color-mix(in srgb, var(--state-success) 18%, transparent)', color: 'var(--state-success)' }
                    : rule.tone === 'down'
                      ? { background: 'color-mix(in srgb, var(--state-warning) 22%, transparent)', color: 'var(--state-warning)' }
                      : { background: 'var(--secondary)', color: 'var(--accent-foreground)' }
                return (
                  <div
                    key={rule.title}
                    className="rule-item"
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 'calc(var(--spacing) * 3)',
                      padding: 'calc(var(--spacing) * 3.5)',
                      background: 'var(--background)',
                      border: '1px solid var(--border)',
                      borderRadius: 'var(--radius)',
                    }}
                  >
                    <span
                      className="rule-icon"
                      data-tone={rule.tone === 'up' ? 'up' : rule.tone === 'down' ? 'down' : undefined}
                      aria-hidden="true"
                      style={{
                        width: 26,
                        height: 26,
                        flexShrink: 0,
                        display: 'grid',
                        placeItems: 'center',
                        borderRadius: '50%',
                        ...iconToneStyle,
                      }}
                    >
                      <Icon size={14} />
                    </span>
                    <div className="rule-info" style={{ flex: 1, minWidth: 0 }}>
                      <strong style={{ display: 'block', fontSize: '0.86rem', fontWeight: 600, color: 'var(--foreground)' }}>
                        {rule.title}
                      </strong>
                      <p className="tiny" style={{ color: 'var(--muted-foreground)', fontSize: '0.78rem', lineHeight: 1.5, marginTop: '0.15rem', margin: '0.15rem 0 0' }}>
                        {rule.desc}
                      </p>
                    </div>
                  </div>
                )
              })}
            </div>

            <div className="rule-list" style={{ display: 'flex', flexDirection: 'column', gap: 'calc(var(--spacing) * 3)', marginTop: 'calc(var(--spacing) * 5)' }}>
              {CONCEPT_MASTERY.map((m) => (
                <div
                  key={m.name}
                  className="mastery-row"
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 'calc(var(--spacing) * 2)',
                    padding: 'calc(var(--spacing) * 3.5)',
                    background: 'var(--background)',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius)',
                  }}
                >
                  <div
                    className="mastery-head"
                    style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'calc(var(--spacing) * 3)' }}
                  >
                    <span className="mastery-name" style={{ fontSize: '0.86rem', fontWeight: 600, color: 'var(--foreground)' }}>
                      {m.name}
                    </span>
                    <span className="mastery-pct" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', color: 'var(--muted-foreground)' }}>
                      {m.level} · {m.pct}%
                    </span>
                  </div>
                  <div
                    className="mastery-bar"
                    aria-hidden="true"
                    style={{ height: 6, background: 'var(--muted)', borderRadius: 999, overflow: 'hidden' }}
                  >
                    <span
                      className="mastery-fill"
                      style={{ display: 'block', height: '100%', width: `${m.pct}%`, background: m.color, borderRadius: 999, transition: 'width 0.3s ease' }}
                    />
                  </div>
                </div>
              ))}
            </div>

            <div
              className="mem-field"
              style={{ borderTop: '1px solid var(--border)', marginTop: 'calc(var(--spacing) * 5)', paddingTop: 'calc(var(--spacing) * 4)', display: 'flex', alignItems: 'center', gap: 'calc(var(--spacing) * 3)' }}
            >
              <span className="mem-field-label" style={{ fontSize: '0.86rem', color: 'var(--muted-foreground)', flex: 1 }}>
                自动难度调整
              </span>
              <Toggle
                on={bloomAuto}
                onClick={() => setBloomAuto((v) => !v)}
                domId="toggle-bloom-auto"
                ariaLabel="启用 Bloom 自动调整"
              />
            </div>
          </Card>
        </div>

        {/* ===== RIGHT COLUMN ===== */}
        <div className="config-col" style={{ display: 'flex', flexDirection: 'column', gap: 'calc(var(--spacing) * 5)', minWidth: 0 }}>
          {/* Card d: 上下文构建器 */}
          <Card>
            <div
              className="card-head"
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
                gap: 'calc(var(--spacing) * 3)',
                marginBottom: 'calc(var(--spacing) * 4)',
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div
                  className="eyebrow"
                  style={{ color: 'var(--muted-foreground)', fontSize: '0.74rem', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 500 }}
                >
                  Step 04
                </div>
                <strong id="context-title" style={{ display: 'block', fontSize: '1rem', fontWeight: 600, color: 'var(--foreground)', marginTop: '0.2rem' }}>
                  上下文构建器
                </strong>
                <div className="tiny" style={{ color: 'var(--muted-foreground)', fontSize: '0.78rem', lineHeight: 1.5, marginTop: '0.3rem' }}>
                  5 类构建器组装 RAG 上下文，总预算 {MAX_CONTEXT_TOKENS} tokens
                </div>
              </div>
              <Badge variant="default">5 构建器</Badge>
            </div>

            {builders.map((b, idx) => (
              <div
                key={b.name}
                className="builder-row"
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 'calc(var(--spacing) * 3)',
                  padding: idx === 0 ? '0 0 calc(var(--spacing) * 4)' : 'calc(var(--spacing) * 4) 0',
                  borderTop: idx === 0 ? 'none' : '1px solid var(--border)',
                }}
              >
                <div
                  className="builder-head"
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: 'calc(var(--spacing) * 3)',
                  }}
                >
                  <div className="builder-info" style={{ display: 'flex', alignItems: 'center', gap: 'calc(var(--spacing) * 3)', minWidth: 0, flex: 1 }}>
                    <span
                      className="builder-no"
                      style={{
                        width: 26,
                        height: 26,
                        borderRadius: '50%',
                        background: 'var(--secondary)',
                        color: 'var(--accent-foreground)',
                        display: 'grid',
                        placeItems: 'center',
                        fontSize: '0.74rem',
                        fontWeight: 600,
                        flexShrink: 0,
                        fontFamily: 'var(--font-mono)',
                      }}
                    >
                      {b.no}
                    </span>
                    <div className="builder-name" style={{ display: 'flex', flexDirection: 'column', gap: '0.1rem', minWidth: 0 }}>
                      <strong style={{ fontSize: '0.88rem', fontWeight: 600, color: 'var(--foreground)' }}>{b.name}</strong>
                      <span className="tiny" style={{ color: 'var(--muted-foreground)', fontSize: '0.78rem', lineHeight: 1.5, marginTop: 0 }}>
                        {b.desc}
                      </span>
                    </div>
                  </div>
                  <span
                    className="builder-budget"
                    style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', color: 'var(--foreground)', minWidth: 60, textAlign: 'right', flexShrink: 0 }}
                  >
                    {b.budget}
                  </span>
                  <Toggle
                    on={b.enabled}
                    onClick={() => toggleBuilder(b.name)}
                    domId={b.domId}
                    ariaLabel={`启用 ${b.name} 构建器`}
                  />
                </div>
                <div
                  className="alloc-bar"
                  aria-hidden="true"
                  style={{ height: 8, background: 'var(--muted)', borderRadius: 999, overflow: 'hidden', display: 'flex' }}
                >
                  <span
                    className="alloc-seg"
                    style={{ height: '100%', width: `${b.pct}%`, background: b.color, transition: 'width 0.2s ease' }}
                  />
                </div>
                <div
                  className="alloc-meta"
                  style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'calc(var(--spacing) * 3)', fontSize: '0.74rem', color: 'var(--muted-foreground)' }}
                >
                  <span>{b.priority}</span>
                  <strong style={{ fontFamily: 'var(--font-mono)', color: 'var(--foreground)', fontWeight: 500 }}>
                    {b.pct.toFixed(1)}%
                  </strong>
                </div>
              </div>
            ))}

            <div
              className="budget-total"
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: 'calc(var(--spacing) * 3.5)',
                background: 'var(--muted)',
                borderRadius: 'var(--radius)',
                marginTop: 'calc(var(--spacing) * 4)',
                fontSize: '0.82rem',
              }}
            >
              <span>Token 预算总计</span>
              <strong style={{ fontFamily: 'var(--font-mono)', color: 'var(--foreground)', fontWeight: 600 }}>
                {budgetSummary.used} / {budgetSummary.total}
              </strong>
            </div>
          </Card>

          {/* Card e: 系统提示词 */}
          <Card>
            <div
              className="card-head"
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
                gap: 'calc(var(--spacing) * 3)',
                marginBottom: 'calc(var(--spacing) * 4)',
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div
                  className="eyebrow"
                  style={{ color: 'var(--muted-foreground)', fontSize: '0.74rem', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 500 }}
                >
                  Step 05
                </div>
                <strong id="prompt-title" style={{ display: 'block', fontSize: '1rem', fontWeight: 600, color: 'var(--foreground)', marginTop: '0.2rem' }}>
                  系统提示词
                </strong>
                <div className="tiny" style={{ color: 'var(--muted-foreground)', fontSize: '0.78rem', lineHeight: 1.5, marginTop: '0.3rem' }}>
                  变量注入模板，{`{花括号}`} 占位符由构建器实时填充
                </div>
              </div>
              <Badge variant="default">6 变量</Badge>
            </div>

            <textarea
              ref={promptRef}
              className="prompt-area"
              data-dom-id="prompt-template"
              aria-label="系统提示词模板"
              spellCheck={false}
              value={promptTemplate}
              onChange={(e) => setPromptTemplate(e.target.value)}
              style={{
                width: '100%',
                minHeight: 170,
                padding: 'calc(var(--spacing) * 4)',
                border: '1px solid var(--input)',
                borderRadius: 'var(--radius)',
                background: 'var(--popover)',
                color: 'var(--foreground)',
                fontFamily: 'var(--font-mono)',
                fontSize: '0.8rem',
                lineHeight: 1.65,
                resize: 'vertical',
                outline: 'none',
              }}
            />

            <div
              className="var-chips"
              aria-label="可插入变量"
              style={{ display: 'flex', flexWrap: 'wrap', gap: 'calc(var(--spacing) * 2)', marginTop: 'calc(var(--spacing) * 3)' }}
            >
              {PROMPT_VARIABLES.map((v) => (
                <button
                  key={v.name}
                  type="button"
                  className="var-chip"
                  data-dom-id={v.domId}
                  onClick={() => insertVariable(v.name)}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.35rem',
                    padding: '0.3rem 0.7rem',
                    borderRadius: 'var(--radius)',
                    background: 'var(--secondary)',
                    color: 'var(--accent-foreground)',
                    fontFamily: 'var(--font-mono)',
                    fontSize: '0.76rem',
                    border: '1px solid var(--border)',
                    cursor: 'pointer',
                    transition: 'background 0.2s ease, border-color 0.2s ease',
                    whiteSpace: 'nowrap',
                  }}
                >
                  <IconPlusTiny size={12} />
                  {v.name}
                </button>
              ))}
            </div>

            <div style={{ display: 'flex', gap: 'calc(var(--spacing) * 3)', marginTop: 'calc(var(--spacing) * 4)' }}>
              <Button variant="primary" onClick={handleSavePrompt} disabled={saving} data-dom-id="cta-save-prompt">
                <Icon name="check" size={15} /> 保存模板
              </Button>
              <Button variant="ghost" onClick={handleResetPrompt} disabled={saving} data-dom-id="cta-reset-prompt">
                <Icon name="refresh" size={15} /> 重置默认
              </Button>
            </div>
          </Card>

          {/* Card f: 记忆提取 */}
          <Card>
            <div
              className="card-head"
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
                gap: 'calc(var(--spacing) * 3)',
                marginBottom: 'calc(var(--spacing) * 4)',
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div
                  className="eyebrow"
                  style={{ color: 'var(--muted-foreground)', fontSize: '0.74rem', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 500 }}
                >
                  Step 06 · 附加
                </div>
                <strong id="memory-title" style={{ display: 'block', fontSize: '1rem', fontWeight: 600, color: 'var(--foreground)', marginTop: '0.2rem' }}>
                  记忆提取
                </strong>
                <div className="tiny" style={{ color: 'var(--muted-foreground)', fontSize: '0.78rem', lineHeight: 1.5, marginTop: '0.3rem' }}>
                  从对话中抽取长期记忆条目，写入 user_memory 表供后续检索
                </div>
              </div>
              <StatusBadge tone="success">提取中</StatusBadge>
            </div>

            <div className="rule-list" style={{ display: 'flex', flexDirection: 'column', gap: 'calc(var(--spacing) * 3)' }}>
              {MEMORY_RULES.map((rule) => {
                const Icon = rule.icon === 'globe' ? IconGlobe : rule.icon === 'camera' ? IconCamera : IconFeedback
                return (
                  <div
                    key={rule.title}
                    className="rule-item"
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 'calc(var(--spacing) * 3)',
                      padding: 'calc(var(--spacing) * 3.5)',
                      background: 'var(--background)',
                      border: '1px solid var(--border)',
                      borderRadius: 'var(--radius)',
                    }}
                  >
                    <span
                      className="rule-icon"
                      aria-hidden="true"
                      style={{
                        width: 26,
                        height: 26,
                        flexShrink: 0,
                        display: 'grid',
                        placeItems: 'center',
                        borderRadius: '50%',
                        background: 'var(--secondary)',
                        color: 'var(--accent-foreground)',
                      }}
                    >
                      <Icon size={14} />
                    </span>
                    <div className="rule-info" style={{ flex: 1, minWidth: 0 }}>
                      <strong style={{ display: 'block', fontSize: '0.86rem', fontWeight: 600, color: 'var(--foreground)' }}>
                        {rule.title}
                      </strong>
                      <p className="tiny" style={{ color: 'var(--muted-foreground)', fontSize: '0.78rem', lineHeight: 1.5, marginTop: '0.15rem', margin: '0.15rem 0 0' }}>
                        {rule.desc}
                      </p>
                    </div>
                  </div>
                )
              })}
            </div>

            <div
              className="mem-field"
              style={{ display: 'flex', alignItems: 'center', gap: 'calc(var(--spacing) * 3)', marginTop: 'calc(var(--spacing) * 4)', paddingTop: 'calc(var(--spacing) * 4)', borderTop: '1px solid var(--border)' }}
            >
              <span className="mem-field-label" style={{ fontSize: '0.86rem', color: 'var(--muted-foreground)', flex: 1 }}>
                单次对话最大记忆条目
              </span>
              <input
                type="number"
                className="mem-input"
                value={maxMemories}
                min={0}
                max={20}
                onChange={(e) => setMaxMemories(Math.max(0, Math.min(20, Number(e.target.value) || 0)))}
                data-dom-id="input-max-memories"
                aria-label="单次对话最大记忆条目"
                style={{
                  width: 84,
                  padding: 'calc(var(--spacing) * 2) calc(var(--spacing) * 3)',
                  border: '1px solid var(--input)',
                  borderRadius: 'var(--radius)',
                  background: 'var(--popover)',
                  color: 'var(--foreground)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '0.82rem',
                  textAlign: 'center',
                  outline: 'none',
                }}
              />
            </div>
          </Card>
        </div>
      </div>

      {/* ===== Section 3: Test Run Panel ===== */}
      <Card padding="calc(var(--spacing) * 6)">
        <div ref={testRunRef} />
        <div
          className="card-head"
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            gap: 'calc(var(--spacing) * 3)',
            marginBottom: 'calc(var(--spacing) * 4)',
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div
              className="eyebrow"
              style={{ color: 'var(--muted-foreground)', fontSize: '0.74rem', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 500 }}
            >
              测试运行
            </div>
            <strong id="test-title" style={{ display: 'block', fontSize: '1rem', fontWeight: 600, color: 'var(--foreground)', marginTop: '0.2rem' }}>
              验证编排效果
            </strong>
            <div className="tiny" style={{ color: 'var(--muted-foreground)', fontSize: '0.78rem', lineHeight: 1.5, marginTop: '0.3rem' }}>
              输入测试问题，实时查看流水线追踪与响应预览
            </div>
          </div>
          <StatusBadge tone={testRunning ? 'info' : 'info'}>
            {testRunning ? '运行中' : '就绪'}
          </StatusBadge>
        </div>

        <div
          className="test-input-row"
          style={{ display: 'flex', gap: 'calc(var(--spacing) * 3)', marginBottom: 'calc(var(--spacing) * 5)', alignItems: 'stretch' }}
        >
          <input
            type="text"
            className="test-input"
            placeholder="输入测试问题..."
            value={testQuestion}
            onChange={(e) => setTestQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                if (!testRunning) handleTestRun()
              }
            }}
            data-dom-id="input-test-question"
            aria-label="测试问题输入"
            style={{
              flex: 1,
              padding: 'calc(var(--spacing) * 4) calc(var(--spacing) * 5)',
              border: '1px solid var(--input)',
              borderRadius: 'var(--radius)',
              background: 'var(--popover)',
              color: 'var(--foreground)',
              fontSize: '0.9rem',
              outline: 'none',
              minWidth: 0,
            }}
          />
          {testRunning ? (
            <Button variant="ghost" onClick={handleCancelStream} data-dom-id="cta-pipeline-cancel">
              <Icon name="pause" size={16} /> 停止
            </Button>
          ) : (
            <Button variant="primary" onClick={handleTestRun} data-dom-id="cta-pipeline-test">
              <Icon name="play" size={16} /> 运行测试
            </Button>
          )}
        </div>

        <div
          className="test-results"
          style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr', gap: 'calc(var(--spacing) * 5)', alignItems: 'start' }}
        >
          {/* Pipeline trace */}
          <div className="trace-grid" aria-label="流水线追踪" style={{ display: 'flex', flexDirection: 'column', gap: 'calc(var(--spacing) * 2)' }}>
            {trace.map((row) => (
              <div
                key={row.label}
                className="trace-row"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'calc(var(--spacing) * 3)',
                  padding: 'calc(var(--spacing) * 3) calc(var(--spacing) * 4)',
                  background: 'var(--background)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius)',
                }}
              >
                <span
                  className="trace-label"
                  style={{
                    fontSize: '0.72rem',
                    color: 'var(--muted-foreground)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.06em',
                    minWidth: 60,
                    flexShrink: 0,
                    fontWeight: 500,
                  }}
                >
                  {row.label}
                </span>
                <span
                  className="trace-value"
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: '0.8rem',
                    color: 'var(--foreground)',
                    flex: 1,
                    minWidth: 0,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {row.value}
                </span>
                <span
                  className="trace-conf"
                  style={{ fontFamily: 'var(--font-mono)', fontSize: '0.76rem', color: 'var(--state-success)', flexShrink: 0, fontWeight: 600 }}
                >
                  {row.conf}
                </span>
              </div>
            ))}
          </div>

          {/* Response preview */}
          <div
            className="response-preview"
            aria-label="响应预览"
            style={{
              background: 'var(--background)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius)',
              padding: 'calc(var(--spacing) * 5)',
              display: 'flex',
              flexDirection: 'column',
              gap: 'calc(var(--spacing) * 3)',
              minHeight: 260,
            }}
          >
            <div
              className="response-head"
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'calc(var(--spacing) * 3)' }}
            >
              <strong style={{ fontSize: '0.86rem', fontWeight: 600, color: 'var(--foreground)' }}>响应预览</strong>
              <StatusBadge tone="info">流式</StatusBadge>
            </div>
            <div
              className="response-body"
              style={{
                fontSize: '0.86rem',
                lineHeight: 1.7,
                color: 'var(--foreground)',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                flex: 1,
              }}
            >
              {streamingContent || (testRunning ? '' : '点击「运行测试」按钮，查看 AI 在当前编排配置下的流式响应...')}
              {testRunning && (
                <span
                  className="response-cursor"
                  aria-hidden="true"
                  style={{
                    display: 'inline-block',
                    width: 7,
                    height: 14,
                    background: 'var(--primary)',
                    verticalAlign: 'text-bottom',
                    marginLeft: 2,
                    animation: 'blink 1s steps(2) infinite',
                  }}
                />
              )}
            </div>
          </div>
        </div>
      </Card>
    </PageHero>
  )
}

// ===== 表格样式常量（避免在 JSX 中重复） =====
const matrixHeaderCellStyle: React.CSSProperties = {
  padding: 'calc(var(--spacing) * 2.5) calc(var(--spacing) * 2)',
  textAlign: 'center',
  background: 'var(--muted)',
  color: 'var(--muted-foreground)',
  fontWeight: 600,
  fontSize: '0.7rem',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  whiteSpace: 'nowrap',
  borderRight: '1px solid var(--border)',
  borderBottom: '1px solid var(--border)',
}

const matrixRowHeaderStyle: React.CSSProperties = {
  padding: 'calc(var(--spacing) * 2.5) calc(var(--spacing) * 2)',
  background: 'var(--muted)',
  color: 'var(--foreground)',
  fontWeight: 600,
  textAlign: 'left',
  whiteSpace: 'nowrap',
  fontFamily: 'var(--font-mono)',
  fontSize: '0.74rem',
  borderRight: '1px solid var(--border)',
  borderBottom: '1px solid var(--border)',
}
