/**
 * AgentOrchestration — 智能体编排页（去伪存真版）
 *
 * 真实性原则：假数据能做真就做真，不能做真就删。
 *   - 意图分类器：关键词从主进程 GET_PIPELINE_INFO 拉取（运行时真实生效版，intent-classifier.getIntentKeywords）
 *   - 策略选择器：意图→教学模式→起始 Bloom 映射来自 strategy-selector.getIntentStrategyMap（运行时真实）
 *     （原「24 单元格频次热力图」为编造数据，已删除——后端是一对一映射，不存在频次概念）
 *   - 难度调整：三条规则描述与 state-tracker.adjustDifficulty 真实逻辑一致
 *     （原「85% 掌握 / 60% 错误率 / 30 分钟冷却」为编造规则，已更正；原「概念掌握度进度条」为写死示例数据，已删除）
 *   - 上下文构建器：5 个 builder 名单与描述真实（orchestrator 注册）；原「per-builder token 预算 / 百分比进度条」
 *     为编造（后端是总预算 4000 顺序截断，无按比例分配），已删除
 *   - 系统提示词：默认文本与 system-prompt.ts DEFAULT_SYSTEM_PROMPT 同源；保存/重置走 prompt-storage 真实生效
 *     （原「6 个模板变量 chip」为误导功能——后端无变量替换逻辑，占位符会原样发给 LLM，已删除）
 *   - 记忆提取：3 类规则与 memory-service 分类概念对应，保留；原「提取中」假状态徽章已删除
 *   - 流水线：6 步真实存在；原写死「在线」状态徽章已删除
 *
 * IPC 接口（真实可用）：
 *   - agent.getPipelineInfo() → { intentKeywords, strategyMap }
 *   - admin.getAgentConfig() → { systemPrompt }
 *   - admin.savePrompt('agent.system', template) / resetPrompt('agent.system')
 */

import { useCallback, useEffect, useState } from 'react'
import PageHero from '@/components/layout/PageHero'
import Card from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import Badge from '@/components/ui/Badge'
import Icon from '@/components/ui/Icon'
import { Loading } from '@/components/ui/Feedback'
import { toast } from '../stores/toastStore'

// ===== 类型 =====

interface IntentMeta {
  key: 'knowledge_query' | 'deep_discussion' | 'teaching_practice' | 'casual_chat'
  name: string
  label: string
}

interface StrategyPlanInfo {
  teachingMode: string
  bloomLevel: number
}

interface ContextBuilderInfo {
  no: number
  name: string
  desc: string
  priority: string
}

interface PipelineStep {
  no: string
  title: string
  desc: string
  iconName: 'question' | 'box' | 'arrow-up' | 'edit' | 'play'
}

// ===== 常量（静态元信息；运行时数据从 IPC 拉取） =====

/** 4 种意图的元信息（key 与 intent-classifier.ts UserIntent 一致；关键词运行时拉取） */
const INTENT_META: IntentMeta[] = [
  { key: 'knowledge_query', name: 'knowledge_query', label: '知识查询 · 事实/概念/定义检索' },
  { key: 'deep_discussion', name: 'deep_discussion', label: '深度讨论 · 多轮批判性思辨' },
  { key: 'teaching_practice', name: 'teaching_practice', label: '教学练习 · 苏格拉底/费曼训练' },
  { key: 'casual_chat', name: 'casual_chat', label: '闲聊问候 · 无明确学习目标' },
]

/** 教学模式代号 → 中文名 */
const TEACHING_MODE_LABEL: Record<string, string> = {
  direct_answer: '直接回答',
  socratic: '苏格拉底提问',
  feynman: '费曼学习法',
  assessment: '理解测试',
}

/** Bloom 等级代号 → 中文名 */
const BLOOM_LEVEL_LABEL: Record<number, string> = {
  1: 'L1 记忆',
  2: 'L2 理解',
  3: 'L3 应用',
  4: 'L4 分析',
  5: 'L5 评价',
  6: 'L6 创造',
}

/** 难度调整规则（与 electron/agent/state-tracker.ts adjustDifficulty 真实逻辑一致） */
const DIFFICULTY_RULES: {
  tone: 'up' | 'down' | 'stable'
  title: string
  desc: string
}[] = [
  {
    tone: 'up',
    title: '升级规则 · 连续 3 题答对',
    desc: '同一会话中连续 3 次回答正确时，Bloom 层级自动 +1（如 L2 理解 → L3 应用），最高 L6 创造。',
  },
  {
    tone: 'down',
    title: '降级规则 · 连续 2 题答错',
    desc: '同一会话中连续 2 次回答错误时，Bloom 层级自动 -1，回退巩固后再行提升。',
  },
  {
    tone: 'stable',
    title: '掌握规则 · L6 连对 5 次',
    desc: '在最高层级 L6（创造）连续答对 5 次时，标记该概念已掌握。',
  },
]

/** 5 个上下文构建器（与 electron/agent/orchestrator.ts 注册顺序、context-manager.ts 优先级一致） */
const DEFAULT_BUILDERS: ContextBuilderInfo[] = [
  { no: 1, name: 'book', desc: '当前书籍章节与划线原文上下文', priority: '优先级 1 · 先加入上下文' },
  { no: 2, name: 'methodology', desc: '书籍关联的学习方法论', priority: '优先级 2' },
  { no: 3, name: 'knowledge-card', desc: '知识卡片 RAG 检索片段', priority: '优先级 3' },
  { no: 4, name: 'memory', desc: '历史对话提取的长期记忆', priority: '优先级 4' },
  { no: 5, name: 'user-profile', desc: '用户画像（有画像数据时才构建）', priority: '优先级 5 · 条件构建' },
]

/** 记忆提取 3 类规则（对应 services/memory-service.ts 的分类） */
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

/** 6 步流水线（对应 electron/agent/orchestrator.ts processMessageStream 真实执行顺序） */
const PIPELINE_STEPS: PipelineStep[] = [
  { no: '01', title: '意图分类', desc: '关键词计分识别四种意图', iconName: 'question' },
  { no: '02', title: '策略选择', desc: '意图映射教学模式与起始层级', iconName: 'box' },
  { no: '03', title: '难度调整', desc: 'Bloom L1-L6 按答题表现升降级', iconName: 'arrow-up' },
  { no: '04', title: '上下文构建', desc: '5 类构建器按优先级组装，总预算 4000 tokens 超限截断', iconName: 'box' },
  { no: '05', title: '系统提示', desc: '策略提示 + 难度提示 + 已掌握概念注入系统提示', iconName: 'edit' },
  { no: '06', title: '流式响应', desc: 'LLM 流式输出，用量落库统计', iconName: 'play' },
]

/** 系统提示词默认模板（与 electron/agent/system-prompt.ts DEFAULT_SYSTEM_PROMPT 同源） */
const DEFAULT_PROMPT_TEMPLATE = `你是智能阅读助手，基于用户阅读笔记教学。

回答要求：
1. 笔记中没有的信息坦诚告知，引用笔记原文支持你的观点
2. 使用Markdown格式，善用标题、列表、引用保持层级清晰
3. 按需求自适应教学：知识查询→简洁回答，深度讨论→苏格拉底式追问，教学请求→费曼学习法让用户自己解释，评测→出理解题`

// ===== 内联 SVG 图标（设计稿特有，不在 Icon 组件库中） =====

/** 规则上升箭头 */
function IconArrowUp({ size = 14 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" width={size} height={size} aria-hidden="true">
      <path d="m5 12 7-7 7 7" />
      <path d="M12 19V5" />
    </svg>
  )
}

/** 规则下降箭头 */
function IconArrowDown({ size = 14 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" width={size} height={size} aria-hidden="true">
      <path d="M12 5v14" />
      <path d="m19 12-7 7-7-7" />
    </svg>
  )
}

/** 掌握/稳定图标 */
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
      <span
        aria-hidden="true"
        style={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: 'currentColor',
          flexShrink: 0,
          display: 'inline-block',
          opacity: 0.7,
        }}
      />
      {children}
    </span>
  )
}

// ===== 主组件 =====
export default function AgentOrchestration() {
  // 运行时真实数据（从主进程拉取）
  const [intentKeywords, setIntentKeywords] = useState<Record<string, string[]> | null>(null)
  const [strategyMap, setStrategyMap] = useState<Record<string, StrategyPlanInfo> | null>(null)

  // 系统提示词（唯一可编辑项，真实生效）
  const [promptTemplate, setPromptTemplate] = useState(DEFAULT_PROMPT_TEMPLATE)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  // ===== 加载运行时配置 =====
  useEffect(() => {
    const load = async () => {
      // 1) 意图关键词 + 策略映射（运行时真实生效版）
      try {
        if (window.electronAPI?.agent?.getPipelineInfo) {
          const info = await window.electronAPI.agent.getPipelineInfo()
          setIntentKeywords(info.intentKeywords)
          setStrategyMap(info.strategyMap)
        }
      } catch (err) {
        console.error('加载流水线信息失败:', err)
      }

      // 2) 系统提示词（admin.getAgentConfig → settings.admin_system_prompt）
      try {
        if (window.electronAPI?.admin?.getAgentConfig) {
          const config = (await window.electronAPI.admin.getAgentConfig()) as {
            systemPrompt?: string | null
          }
          if (config?.systemPrompt) {
            setPromptTemplate(config.systemPrompt)
          }
        }
      } catch (err) {
        console.error('加载智能体配置失败:', err)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  // ===== 保存系统提示词（真实生效：admin.savePrompt('agent.system') → prompt-storage → getSystemPrompt()） =====
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

  if (loading) {
    return <Loading hint="正在加载智能体编排配置..." />
  }

  // ===== 渲染 =====
  return (
    <PageHero
      title="智能体编排"
      subtitle="查看AI对话的意图识别、教学策略与上下文构建规则，自定义系统提示词"
      actions={
        <Button
          variant="primary"
          onClick={handleSavePrompt}
          disabled={saving}
          data-dom-id="cta-publish-config"
        >
          <Icon name="check" size={16} /> 保存配置
        </Button>
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
              每条消息都会依次经过以下六步处理，从用户输入到流式响应。
            </div>
          </div>
        </div>

        <div
          className="pipeline-flow"
          role="list"
          style={{
            display: 'flex',
            flexWrap: 'nowrap',
            alignItems: 'stretch',
            gap: 'calc(var(--spacing) * 3)',
            padding: 'calc(var(--spacing) * 2) 0 calc(var(--spacing) * 3)',
            overflowX: 'auto',
            scrollSnapType: 'x mandatory',
          }}
        >
          {PIPELINE_STEPS.map((step, idx) => (
            <div key={step.no} style={{ display: 'contents' }}>
              <article
                className="pipeline-step"
                role="listitem"
                style={{
                  flex: '0 0 auto',
                  width: 200,
                  scrollSnapAlign: 'start',
                  background: 'var(--background)',
                  border: '1px solid var(--border)',
                  borderRadius: 'calc(var(--radius) + 4px)',
                  padding: 'calc(var(--spacing) * 4)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 'calc(var(--spacing) * 3)',
                  transition: 'border-color 0.2s ease, transform 0.16s ease',
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
                      background: 'var(--card)',
                      color: 'var(--primary)',
                      border: '1px solid var(--border)',
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

      {/* ===== Section 2: Config Grid ===== */}
      <div
        className="config-section-header"
        style={{ marginTop: 'calc(var(--spacing) * 8)' }}
      >
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
          配置详情
        </div>
        <strong
          id="config-title"
          style={{ display: 'block', fontSize: '1.05rem', fontWeight: 600, color: 'var(--foreground)', marginTop: '0.2rem' }}
        >
          六模块运行参数
        </strong>
        <div
          className="tiny"
          style={{ color: 'var(--muted-foreground)', fontSize: '0.78rem', lineHeight: 1.5, marginTop: '0.4rem', maxWidth: '70ch' }}
        >
          除「系统提示词」外，其余卡片均为只读展示，运行时由对应后端服务自动处理。
        </div>
      </div>
      <div
        className="config-grid"
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 'calc(var(--spacing) * 5)',
          alignItems: 'stretch',
          marginTop: 'calc(var(--spacing) * 5)',
        }}
      >
        {/* Card a: 意图分类器（关键词为运行时真实生效版） */}
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
                关键词计分匹配（命中加分子串长度，否定词扣分，上下文加权），取最高分意图
              </div>
            </div>
            <Badge variant="default">4 类意图</Badge>
          </div>

          {INTENT_META.map((intent, idx) => {
            const keywords = intentKeywords?.[intent.key] ?? []
            return (
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
                  <span className="intent-conf" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', color: 'var(--muted-foreground)', flexShrink: 0 }}>
                    {keywords.length} 个关键词
                  </span>
                </div>
                {keywords.length > 0 && (
                  <div className="chip-row" style={{ display: 'flex', flexWrap: 'wrap', gap: 'calc(var(--spacing) * 2)' }}>
                    {keywords.map((kw) => (
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
                )}
              </div>
            )
          })}
        </Card>

        {/* Card b: 策略选择器（真实映射表：意图 → 教学模式 + 起始 Bloom 层级） */}
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
                识别出的意图映射为教学模式与起始 Bloom 层级（难度会随后续答题表现自动调整）
              </div>
            </div>
            <Badge variant="default">4 条映射</Badge>
          </div>

          <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 'var(--radius)' }}>
            <table
              aria-label="意图与教学策略映射"
              style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem', minWidth: 420 }}
            >
              <thead>
                <tr>
                  {['识别意图', '教学模式', '起始层级'].map((h) => (
                    <th
                      key={h}
                      scope="col"
                      style={{
                        padding: 'calc(var(--spacing) * 2.5) calc(var(--spacing) * 3)',
                        textAlign: 'left',
                        borderBottom: '1px solid var(--border)',
                        borderRight: '1px solid var(--border)',
                        background: 'var(--muted)',
                        color: 'var(--muted-foreground)',
                        fontSize: '0.78rem',
                        fontWeight: 600,
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {INTENT_META.map((intent) => {
                  const plan = strategyMap?.[intent.key]
                  return (
                    <tr key={intent.key}>
                      <td style={{ padding: 'calc(var(--spacing) * 2.5) calc(var(--spacing) * 3)', borderBottom: '1px solid var(--border)', borderRight: '1px solid var(--border)', fontFamily: 'var(--font-mono)', fontSize: '0.78rem' }}>
                        {intent.name}
                      </td>
                      <td style={{ padding: 'calc(var(--spacing) * 2.5) calc(var(--spacing) * 3)', borderBottom: '1px solid var(--border)', borderRight: '1px solid var(--border)' }}>
                        {plan ? TEACHING_MODE_LABEL[plan.teachingMode] ?? plan.teachingMode : '—'}
                      </td>
                      <td style={{ padding: 'calc(var(--spacing) * 2.5) calc(var(--spacing) * 3)', borderBottom: '1px solid var(--border)', fontFamily: 'var(--font-mono)', fontSize: '0.78rem' }}>
                        {plan ? BLOOM_LEVEL_LABEL[plan.bloomLevel] ?? `L${plan.bloomLevel}` : '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Card>

        {/* Card c: 难度调整（规则描述与 state-tracker.adjustDifficulty 真实逻辑一致） */}
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
                Bloom L1-L6 自动升降级（会话内按答题表现实时计算）
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
        </Card>

        {/* Card d: 上下文构建器（真实注册名单 + 优先级；总预算 4000 顺序截断） */}
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
                5 类构建器按优先级顺序组装上下文，总预算 4000 tokens，超限截断
              </div>
            </div>
            <Badge variant="default">5 构建器</Badge>
          </div>

          {DEFAULT_BUILDERS.map((b, idx) => (
            <div
              key={b.name}
              className="builder-row"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'calc(var(--spacing) * 3)',
                padding: idx === 0 ? '0 0 calc(var(--spacing) * 4)' : 'calc(var(--spacing) * 4) 0',
                borderTop: idx === 0 ? 'none' : '1px solid var(--border)',
              }}
            >
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
              <div className="builder-name" style={{ display: 'flex', flexDirection: 'column', gap: '0.1rem', minWidth: 0, flex: 1 }}>
                <strong style={{ fontSize: '0.88rem', fontWeight: 600, color: 'var(--foreground)', fontFamily: 'var(--font-mono)' }}>{b.name}</strong>
                <span className="tiny" style={{ color: 'var(--muted-foreground)', fontSize: '0.78rem', lineHeight: 1.5, marginTop: 0 }}>
                  {b.desc}
                </span>
              </div>
              <span
                className="builder-priority"
                style={{ fontSize: '0.76rem', color: 'var(--muted-foreground)', flexShrink: 0, whiteSpace: 'nowrap' }}
              >
                {b.priority}
              </span>
            </div>
          ))}
        </Card>

        {/* Card e: 系统提示词（唯一可编辑项，保存后真实生效） */}
        <Card
          style={{
            gridColumn: '1 / -1',
          }}
        >
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
                保存后立即生效于所有新对话（策略提示、难度提示与已掌握概念由系统自动追加）
              </div>
            </div>
          </div>

          <textarea
            className="prompt-area"
            data-dom-id="prompt-template"
            aria-label="系统提示词模板"
            spellCheck={false}
            value={promptTemplate}
            onChange={(e) => setPromptTemplate(e.target.value)}
            style={{
              width: '100%',
              minHeight: 260,
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
                每轮对话结束后自动抽取记忆条目，写入 user_memory 表供后续检索
              </div>
            </div>
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
        </Card>
      </div>
    </PageHero>
  )
}
