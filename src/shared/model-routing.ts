/**
 * 模型分级路由（PROGRESS 主线 A · Step 6）
 *
 * 目的：闲聊类交互（casual_chat）不必消耗主档模型的 token 预算，配置经济档后自动分流。
 * 未配置经济档 = 功能关闭（全部走主档），零行为变化。
 */

export type ModelTier = 'fast' | 'main'

/** 走经济档的意图白名单 */
export const FAST_TIER_INTENTS: readonly string[] = ['casual_chat']

/**
 * 按意图选档：经济档已配置（非空白）且意图命中白名单 → fast，否则 main。
 * fastModel 可能来自用户输入，空白串视为未配置。
 */
export function resolveChatTier(
  intent: string | undefined,
  fastModel: string | undefined | null,
): ModelTier {
  if (!fastModel || fastModel.trim() === '') return 'main'
  return intent && FAST_TIER_INTENTS.includes(intent) ? 'fast' : 'main'
}
