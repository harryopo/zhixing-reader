/**
 * AI SDK Service — 基于 Vercel AI SDK 的流式/结构化 LLM 调用
 * 逐步替换 ai-service.ts（1441 行）的 fetch + SSE 手写代码
 */
import { streamText, generateObject } from 'ai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { z } from 'zod';
import { logger } from './logger';

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
  onComplete: (usage?: { promptTokens: number; completionTokens: number }) => void,
  onError: (error: Error) => void,
  _options?: { enableReasoning?: boolean; onReasoningChunk?: (chunk: string) => void },
): Promise<void> {
  if (!config) {
    onError(new Error('AI SDK not configured'));
    return;
  }

  // Replace any previous stream
  if (activeStreamController) {
    try { activeStreamController.abort() } catch { /* ignore */ }
  }
  const controller = new AbortController();
  activeStreamController = controller;
  const signal = controller.signal;

  let completed = false;
  const safeComplete = (usage?: { promptTokens: number; completionTokens: number }) => {
    if (completed) return;
    completed = true;
    onComplete(usage);
  };
  const safeError = (error: Error) => {
    if (completed) return;
    completed = true;
    onError(error);
  };

  try {
    const result = streamText({
      model: getModel(),
      messages,
      maxOutputTokens: config.maxTokens ?? 2000,
      temperature: config.temperature ?? 0.7,
      abortSignal: signal,
    });

    for await (const chunk of result.textStream) {
      onChunk(chunk);
    }

    // 获取用量
    const usage = await result.usage;
    safeComplete({
      promptTokens: usage?.inputTokens ?? 0,
      completionTokens: usage?.outputTokens ?? 0,
    });
  } catch (error) {
    if (signal.aborted) {
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

  const result = await generateObject({
    model: getModel(),
    schema,
    messages,
    maxOutputTokens: options?.maxOutputTokens ?? config.maxTokens ?? 2000,
    abortSignal: options?.signal,
  });

  return result.object;
}

