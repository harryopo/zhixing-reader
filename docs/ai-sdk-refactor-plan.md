# Vercel AI SDK 重构方案 — 知行读书

> 将当前手写 fetch + SSE + JSON 修复的 ai-service.ts（1441 行）替换为 Vercel AI SDK

---

## 第一步：安装依赖

```bash
cd zhixing-reader
npm install ai @ai-sdk/openai-compatible @ai-sdk/react zod
```

## 第二步：新建 electron/ai-sdk-service.ts

```typescript
import { streamText, generateText, generateObject, tool } from 'ai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { z } from 'zod';
import { logger } from './logger';
import { tokenUsageDb } from './database';

let config: {
  provider: string;
  apiKey: string;
  baseUrl: string;
  model: string;
  maxTokens: number;
  temperature: number;
} | null = null;

function getProvider() {
  if (!config) throw new Error('AI service not configured');
  // 一个 createOpenAICompatible 适配所有兼容 API
  return createOpenAICompatible({
    baseURL: config.baseUrl || 'https://api.openai.com/v1',
    apiKey: config.apiKey,
    name: 'custom',
  })(config.model || 'gpt-4o-mini');
}

function recordUsage(feature: string, usage: { promptTokens?: number; completionTokens?: number }, durationMs: number) {
  try {
    tokenUsageDb.create({
      id: `usage-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      provider: config?.provider || 'unknown',
      model: config?.model || 'unknown',
      feature,
      input_tokens: usage.promptTokens || 0,
      output_tokens: usage.completionTokens || 0,
      total_tokens: (usage.promptTokens || 0) + (usage.completionTokens || 0),
      duration_ms: durationMs,
      created_at: new Date().toISOString(),
    });
  } catch (e) {
    logger.error('Failed to record token usage', e);
  }
}

/**
 * 流式对话（替换 ai-service.ts 的 streamOpenAI / streamAnthropic / streamCustom）
 */
export async function streamChat(
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
  onChunk: (chunk: string) => void,
  onComplete: (usage?: { promptTokens: number; completionTokens: number }) => void,
  onError: (error: Error) => void,
  signal?: AbortSignal,
) {
  try {
    const startTime = Date.now();
    const result = streamText({
      model: getProvider(),
      messages,
      maxTokens: config?.maxTokens || 2000,
      temperature: config?.temperature || 0.7,
      abortSignal: signal,
    });

    for await (const chunk of result.textStream) {
      onChunk(chunk);
    }

    const usage = await result.usage;
    const durationMs = Date.now() - startTime;
    
    if (usage) {
      recordUsage('chat', { promptTokens: usage.promptTokens, completionTokens: usage.completionTokens }, durationMs);
    }

    onComplete({
      promptTokens: usage?.promptTokens || 0,
      completionTokens: usage?.completionTokens || 0,
    });
  } catch (error) {
    if (signal?.aborted) {
      onComplete({ promptTokens: 0, completionTokens: 0 });
      return;
    }
    onError(error instanceof Error ? error : new Error(String(error)));
  }
}

/**
 * 非流式文本生成（替换 callAI）
 */
export async function generateTextResponse(
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
  options?: { maxTokens?: number; signal?: AbortSignal },
): Promise<{ content: string; usage?: { promptTokens: number; completionTokens: number } }> {
  const startTime = Date.now();
  const result = await generateText({
    model: getProvider(),
    messages,
    maxTokens: options?.maxTokens || config?.maxTokens || 2000,
    abortSignal: options?.signal,
  });
  const durationMs = Date.now() - startTime;
  if (result.usage) {
    recordUsage('generate', { promptTokens: result.usage.promptTokens, completionTokens: result.usage.completionTokens }, durationMs);
  }
  return {
    content: result.text,
    usage: result.usage ? { promptTokens: result.usage.promptTokens, completionTokens: result.usage.completionTokens } : undefined,
  };
}

/**
 * 结构化输出（替换 generateCards / generateSummary / extractMethodologies 等）
 */
export async function generateStructured<T>(
  schema: z.ZodSchema<T>,
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
  feature: string,
  options?: { maxTokens?: number; signal?: AbortSignal },
): Promise<T> {
  const startTime = Date.now();
  const result = await generateObject({
    model: getProvider(),
    schema,
    messages,
    maxTokens: options?.maxTokens || config?.maxTokens || 2000,
    abortSignal: options?.signal,
  });
  const durationMs = Date.now() - startTime;
  if (result.usage) {
    recordUsage(feature, { promptTokens: result.usage.promptTokens, completionTokens: result.usage.completionTokens }, durationMs);
  }
  return result.object;
}

export function setAIConfig(cfg: { provider: string; apiKey: string; baseUrl?: string; model?: string; maxTokens?: number; temperature?: number }) {
  config = {
    provider: cfg.provider,
    apiKey: cfg.apiKey,
    baseUrl: cfg.baseUrl || 'https://api.openai.com/v1',
    model: cfg.model || 'gpt-4o-mini',
    maxTokens: cfg.maxTokens || 2000,
    temperature: cfg.temperature ?? 0.7,
  };
}
```

## 第三步：改造步骤（逐步替换，不破坏现有功能）

### 3.1 先替换流式对话

在 `electron/agent/orchestrator.ts` 中把 `import { streamChat } from '../ai-service'` 改为 `import { streamChat } from '../ai-sdk-service'`

### 3.2 再替换结构化输出

逐个替换：
- `generateCards` → `generateStructured(cardSchema, ...)`
- `generateSummary` → `generateStructured(summarySchema, ...)`
- `extractMethodologies` → `generateStructured(methodologySchema, ...)`
- `distillKnowledgeCards` → `generateStructured(knowledgeCardSchema, ...)`

每个替换后删除 `ai-service.ts` 中对应函数。

### 3.3 彻底删除 ai-service.ts

等所有引用都切到新文件后，删除 `ai-service.ts`（-1441 行，-1 个复杂文件）。

## 好处

| 维度 | 改造前 | 改造后 |
|------|--------|--------|
| 流式代码量 | 3 套各 ~300 行 = 900 行 | `streamChat()` ~40 行 |
| Provider 切换 | 改 3 处 | 改 1 行 `createOpenAICompatible` |
| 结构化输出 | `repairJSON` 117 行正则修复 | `generateObject` + Zod 自动验证 |
| Tool calling | 不支持 | 原生支持 `tool()` |
| 错误处理 | 分散在各处 | 统一 `abortSignal` |
| 包维护 | 手写 fetch/SSE | Vercel 团队维护 |
