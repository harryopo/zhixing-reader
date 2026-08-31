/**
 * AI SDK Service — 基于 Vercel AI SDK 的流式/结构化 LLM 调用
 * 逐步替换 ai-service.ts（1441 行）的 fetch + SSE 手写代码
 */
import { streamText, generateObject } from 'ai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { z } from 'zod';
import { logger } from './logger';
import { tokenUsageDb } from './database';

type AIProvider = 'openai' | 'anthropic' | 'custom';

interface AISDKConfig {
  provider: AIProvider;
  apiKey: string;
  baseUrl?: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
}

let config: AISDKConfig | null = null;

/** Active chat stream — only one at a time; cancelActiveStream aborts network read */
let activeStreamController: AbortController | null = null;

export function setAIConfig(cfg: AISDKConfig): void {
  config = { ...cfg };
}

/**
 * 从 settings 初始化配置（与 ai-service.initFromSettings 同源）
 * 在 main.ts 启动时调用，让 orchestrator 走 SDK 路径时有配置可用
 */
export function initFromSettings(settings: Record<string, unknown>): void {
  const llmKey = settings.llmKey as string;
  const aiProvider = (settings.aiProvider as AIProvider) || 'custom';
  let llmEndpoint = settings.llmEndpoint as string;
  const llmModel = settings.llmModel as string;

  // DeepSeek 等 OpenAI 兼容端点需要 /v1 后缀；自动补全避免返回空响应
  if (llmEndpoint && llmEndpoint.includes('api.deepseek.com') && !llmEndpoint.endsWith('/v1')) {
    llmEndpoint = `${llmEndpoint.replace(/\/$/, '')}/v1`;
    logger.info(`Auto-appended /v1 to DeepSeek endpoint: ${llmEndpoint}`);
  }

  if (llmKey) {
    config = {
      provider: aiProvider,
      apiKey: llmKey,
      baseUrl: llmEndpoint || undefined,
      model: llmModel || undefined,
      maxTokens: 2000,
      temperature: 0.7,
    };
    logger.info(`AI SDK initialized from settings: provider=${aiProvider}, model=${llmModel || 'default'}`);
  }
}

/**
 * 归一化消息列表：将 system message 合并到第一条 user message 中。
 * 部分模型（如 deepseek-v4-flash）不允许 messages 中包含 system role，
 * 直接调用会触发 AI_InvalidPromptError 并被 SDK 静默吞掉，导致无输出。
 */
function normalizeMessages(
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
): Array<{ role: 'user' | 'assistant'; content: string }> {
  const systemParts: string[] = [];
  const nonSystem: Array<{ role: 'user' | 'assistant'; content: string }> = [];

  for (const m of messages) {
    if (m.role === 'system') {
      systemParts.push(m.content);
    } else {
      nonSystem.push(m as { role: 'user' | 'assistant'; content: string });
    }
  }

  if (systemParts.length === 0) {
    return nonSystem;
  }

  const systemPrefix = `[系统指令]\n${systemParts.join('\n\n')}\n\n---\n\n`;
  const firstUserIndex = nonSystem.findIndex((m) => m.role === 'user');

  if (firstUserIndex >= 0) {
    nonSystem[firstUserIndex] = {
      ...nonSystem[firstUserIndex],
      content: `${systemPrefix}${nonSystem[firstUserIndex].content}`,
    };
  } else {
    // 没有 user message 时创建一条，保证消息列表有效
    nonSystem.unshift({ role: 'user', content: systemPrefix.trim() });
  }

  return nonSystem;
}

function getModel() {
  if (!config) throw new Error('AI SDK not configured');
  const baseUrl = config.baseUrl || 'https://api.openai.com/v1';
  const model = config.model || 'gpt-4o-mini';

  const provider = createOpenAICompatible({
    baseURL: baseUrl,
    apiKey: config.apiKey,
    name: 'custom',
  });
  return provider(model);
}

/**
 * 聊天流式用量落库 — 修复 Token 统计主链路断裂（streamChat 从不记账）。
 * 0 用量（中断/无输出）不记录，避免垃圾数据。
 * cachedTokens：服务商前缀缓存命中的输入 tokens（DeepSeek prompt_cache_hit_tokens /
 * 火山 cached_tokens），按缓存折扣价计费，是命中率观测的基础数据。
 */
function recordChatUsage(
  durationMs: number,
  usage?: { promptTokens: number; completionTokens: number; cachedTokens?: number },
): void {
  try {
    const inputTokens = usage?.promptTokens ?? 0;
    const outputTokens = usage?.completionTokens ?? 0;
    const cachedTokens = Math.min(usage?.cachedTokens ?? 0, inputTokens);
    if (inputTokens + outputTokens <= 0) return;
    if (!config) return;
    tokenUsageDb.create({
      provider: config.provider,
      model: config.model || 'default',
      feature: 'chat',
      inputTokens,
      outputTokens,
      cachedTokens,
      durationMs,
    });
  } catch (err) {
    logger.warn('Failed to record chat token usage', { error: err instanceof Error ? err.message : String(err) });
  }
}

/** Abort in-flight sdkStreamChat (user stop). Returns true if something was aborted. */
export function cancelActiveStream(): boolean {
  if (!activeStreamController) return false;
  try {
    activeStreamController.abort();
  } catch {
    // ignore
  }
  activeStreamController = null;
  return true;
}

/**
 * 纯流式对话 — 替换 orchestrator 中的 streamChat 引用
 * 支持 AbortSignal 取消
 */
export async function sdkStreamChat(
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
  onChunk: (chunk: string) => void,
  onComplete: (usage?: { promptTokens: number; completionTokens: number; cachedTokens?: number }) => void,
  onError: (error: Error) => void,
  _options?: { enableReasoning?: boolean; onReasoningChunk?: (chunk: string) => void },
): Promise<void> {
  logger.info('sdkStreamChat called', {
    messageCount: messages.length,
    hasConfig: !!config,
    baseUrl: config?.baseUrl,
    model: config?.model,
  })
  if (!config) {
    onError(new Error('AI SDK not configured'));
    return;
  }

  // 归一化消息：避免模型不支持 system role 导致静默失败
  const normalizedMessages = normalizeMessages(messages);
  logger.info('Normalized messages for LLM', {
    originalCount: messages.length,
    normalizedCount: normalizedMessages.length,
    roles: normalizedMessages.map((m) => m.role),
    previews: normalizedMessages.map((m) => ({ role: m.role, length: m.content.length, preview: m.content.slice(0, 120) })),
  });

  // Replace any previous stream
  if (activeStreamController) {
    try { activeStreamController.abort() } catch { /* ignore */ }
  }
  const controller = new AbortController();
  activeStreamController = controller;
  const signal = controller.signal;
  const startedAt = Date.now();

  let completed = false;
  const safeComplete = (usage?: { promptTokens: number; completionTokens: number; cachedTokens?: number }) => {
    if (completed) return;
    completed = true;
    recordChatUsage(Date.now() - startedAt, usage);
    onComplete(usage);
  };
  const safeError = (error: Error) => {
    if (completed) return;
    completed = true;
    onError(error);
  };

  try {
    logger.info('Calling streamText with model', { model: config.model, baseUrl: config.baseUrl })
    const result = streamText({
      model: getModel(),
      messages: normalizedMessages,
      maxOutputTokens: config.maxTokens ?? 2000,
      temperature: config.temperature ?? 0.7,
      abortSignal: signal,
      onError: (error) => {
        logger.error('streamText onError callback', error);
        safeError(error instanceof Error ? error : new Error(String(error)));
      },
    });
    logger.info('streamText returned, awaiting textStream')

    let hasOutput = false;
    let chunkCount = 0;
    for await (const chunk of result.textStream) {
      onChunk(chunk);
      hasOutput = true;
      chunkCount++;
      if (chunkCount <= 5 || chunkCount % 20 === 0) {
        logger.info(`LLM chunk #${chunkCount}`, { chunkLength: chunk?.length, chunkPreview: chunk?.slice(0, 80) })
      }
    }
    logger.info('textStream ended', { chunkCount, hasOutput })

    // 获取用量
    let promptTokens = 0;
    let completionTokens = 0;
    let cachedTokens = 0;
    if (hasOutput) {
      try {
        const usage = await result.usage;
        promptTokens = usage?.inputTokens ?? 0;
        completionTokens = usage?.outputTokens ?? 0;
        // 缓存命中字段：AI SDK 统一字段为 cachedInputTokens（openai-compatible
        // 会映射 DeepSeek prompt_cache_hit_tokens / 火山 cached_tokens），
        // 不同 provider 版本字段可能缺失，逐级兜底读取
        const usageRecord = usage as unknown as {
          cachedInputTokens?: number;
          providerMetadata?: Record<string, { cachedPromptTokens?: number }>;
        };
        cachedTokens =
          usageRecord?.cachedInputTokens ??
          usageRecord?.providerMetadata?.custom?.cachedPromptTokens ??
          usageRecord?.providerMetadata?.openai?.cachedPromptTokens ??
          0;
        logger.info('streamText usage', { promptTokens, completionTokens, cachedTokens })
      } catch (e) {
        logger.warn('Failed to get streamText usage', { error: e instanceof Error ? e.message : String(e) })
      }
    }

    safeComplete({ promptTokens, completionTokens, cachedTokens });
  } catch (error) {
    if (signal.aborted) {
      logger.info('sdkStreamChat aborted by signal')
      safeComplete({ promptTokens: 0, completionTokens: 0 });
      return;
    }
    logger.error('sdkStreamChat failed', error);
    safeError(error instanceof Error ? error : new Error(String(error)));
  } finally {
    if (activeStreamController === controller) {
      activeStreamController = null;
    }
  }
}

/**
 * 结构化输出 — 替换 generateCards / generateSummary / extractMethodologies / distillKnowledgeCards
 */
export async function sdkGenerateObject<T>(
  schema: z.ZodSchema<T>,
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
  options?: { maxOutputTokens?: number; signal?: AbortSignal },
): Promise<T> {
  if (!config) throw new Error('AI SDK not configured');

  const normalizedMessages = normalizeMessages(messages);
  logger.info('sdkGenerateObject normalized messages', {
    originalCount: messages.length,
    normalizedCount: normalizedMessages.length,
  });

  const result = await generateObject({
    model: getModel(),
    schema,
    messages: normalizedMessages,
    maxOutputTokens: options?.maxOutputTokens ?? config.maxTokens ?? 2000,
    abortSignal: options?.signal,
  });

  return result.object;
}

