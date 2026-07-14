import { logger } from '../logger'
import { getPromptTemplate } from '../services/prompt-storage'

const DEFAULT_SYSTEM_PROMPT = `你是智能阅读助手，基于用户阅读笔记教学。

回答要求：
1. 笔记中没有的信息坦诚告知，引用笔记原文支持你的观点
2. 使用Markdown格式，善用标题、列表、引用保持层级清晰
3. 按需求自适应教学：知识查询→简洁回答，深度讨论→苏格拉底式追问，教学请求→费曼学习法让用户自己解释，评测→出理解题`

export function getSystemPrompt(): string {
  try {
    const template = getPromptTemplate('agent.system')
    if (template && template.trim()) {
      return template
    }
  } catch (err) {
    logger.debug('Failed to read system prompt from registry, using default')
  }
  return DEFAULT_SYSTEM_PROMPT
}

export { DEFAULT_SYSTEM_PROMPT }

export const CONTEXT_OVERFLOW_HINT = '\n\n以上是检索到的最相关笔记片段。'
