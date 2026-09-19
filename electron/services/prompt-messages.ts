/**
 * prompt-messages —— 按提示词模板组装 messages 的唯一入口
 *
 * 原先是 ai-service.ts 里的私有函数。AI 能力正从手写 fetch 通路（ai-service）
 * 逐步迁到 Vercel AI SDK 通路（ai-sdk-service），两边都要组同一套模板，
 * 再留一份私有实现就是第三处「同一个逻辑写两遍」。
 */
import { getPromptTemplate } from './prompt-storage'
import { renderTemplate } from './template-engine'

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

/**
 * 用注册表里的 `ai.<feature>.system` / `ai.<feature>.user` 组一对消息。
 * 模板可在「提示词中心」被用户覆写，所以这里每次都实时取，不做缓存。
 */
export function buildMessages(
  feature: string,
  systemExtra: string,
  userVars: Record<string, string | number | undefined>,
): ChatMessage[] {
  const systemTemplate = getPromptTemplate(`ai.${feature}.system`)
  const userTemplate = getPromptTemplate(`ai.${feature}.user`)
  return [
    {
      role: 'system',
      content: systemTemplate + (systemExtra ? `\n${systemExtra}` : ''),
    },
    {
      role: 'user',
      content: renderTemplate(userTemplate, userVars),
    },
  ]
}
