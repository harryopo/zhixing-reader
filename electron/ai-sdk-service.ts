/**
 * AI SDK Service — 基于 Vercel AI SDK 的流式/结构化 LLM 调用
 * 逐步替换 ai-service.ts（1441 行）的 fetch + SSE 手写代码
 */
import { streamText, generateText, generateObject } from 'ai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { z } from 'zod';
import { logger } from './logger';
import { tokenUsageDb } from './database';
import { resolveChatTier, type ModelTier } from '../src/shared/model-routing';
import { cachedTokensFromSdkUsage } from '../src/shared/usage-tokens';
import { formatSkillNameEnLine } from '../src/shared/skill-name';
import { buildMessages } from './services/prompt-messages';

type AIProvider = 'openai' | 'anthropic' | 'custom';

interface AISDKConfig {
  provider: AIProvider;
  apiKey: string;
  baseUrl?: string;
  model?: string;
  /** 经济档模型（可选）：casual_chat 分流用，见 shared/model-routing */
  modelFast?: string;
  maxTokens?: number;
  temperature?: number;
}

let config: AISDKConfig | null = null;

/** Active chat stream — only one at a time; cancelActiveStream aborts network read */
let activeStreamController: AbortController | null = null;

/**
 * 非流式任务（抽取 / 概括 / 翻译 / 结构化输出）一律关掉「深度思考」。
 *
 * 这不是偏好而是上一代手写通路实测出来的结论：deepseek-flash 这类模型**默认就会思考**，
 * 把输出预算先烧在 reasoning 上 —— 小预算（200/600）直接返回空内容，
 * 大预算（8000）被截断成半截 JSON。经验跟着函数一起迁到 SDK 通路，别丢。
 */
const REASONING_OFF = { openaiCompatible: { reasoningEffort: 'none' } } as const;

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
  const llmModelFast = (settings.llmModelFast as string) || undefined;

  // DeepSeek 等 OpenAI 兼容端点需要 /v1 后缀；自动补全避免返回空响应
  if (llmEndpoint && llmEndpoint.includes('api.deepseek.com') && !llmEndpoint.endsWith('/v1')) {
    llmEndpoint = `${llmEndpoint.replace(/\/$/, '')}/v1`;
    logger.info(`Auto-appended /v1 to DeepSeek endpoint: ${llmEndpoint}`);
  }

  if (llmKey) {
    // 输出预算必须取用户配置。此前硬编码 2000，而 deepseek-flash 这类模型
    // **默认先输出 2-3k 字符的 reasoning**，2000 的预算会被思考吃光，
    // 正文一个字都出不来 —— 表现就是「提问后一直不回答」。
    // （实测：max_tokens=2000 → finish_reason=length、正文被截断；
    //  4096 → finish_reason=stop、正文完整。）
    const configuredMax = Number(settings.llmMaxTokens);
    const maxTokens = Number.isFinite(configuredMax) && configuredMax > 0 ? configuredMax : 4096;
    const configuredTemp = Number(settings.llmTemperature);

    config = {
      provider: aiProvider,
      apiKey: llmKey,
      baseUrl: llmEndpoint || undefined,
      model: llmModel || undefined,
      modelFast: llmModelFast?.trim() || undefined,
      maxTokens,
      temperature: Number.isFinite(configuredTemp) ? configuredTemp : 0.7,
    };
    logger.info(`AI SDK initialized from settings: provider=${aiProvider}, model=${llmModel || 'default'}, fastModel=${llmModelFast?.trim() || 'off'}, maxTokens=${maxTokens}`);
    if (maxTokens < 3000) {
      logger.warn('llmMaxTokens 偏小，模型默认思考可能占满输出预算导致正文为空', { maxTokens });
    }
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

function getModel(tier: ModelTier = 'main'): { languageModel: ReturnType<ReturnType<typeof createOpenAICompatible>>; modelName: string } {
  if (!config) throw new Error('AI SDK not configured');
  const baseUrl = config.baseUrl || 'https://api.openai.com/v1';
  // 经济档仅在配置了 modelFast 时生效（resolveChatTier 已保证未配置时返回 main）
  const model = (tier === 'fast' && config.modelFast ? config.modelFast : config.model) || 'gpt-4o-mini';

  const provider = createOpenAICompatible({
    baseURL: baseUrl,
    apiKey: config.apiKey,
    name: 'custom',
  });
  return { languageModel: provider(model), modelName: model };
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
  modelUsed?: string,
): void {
  try {
    const inputTokens = usage?.promptTokens ?? 0;
    const outputTokens = usage?.completionTokens ?? 0;
    const cachedTokens = Math.min(usage?.cachedTokens ?? 0, inputTokens);
    if (inputTokens + outputTokens <= 0) return;
    if (!config) return;
    tokenUsageDb.create({
      provider: config.provider,
      model: modelUsed || config.model || 'default',
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
  options?: { enableReasoning?: boolean; onReasoningChunk?: (chunk: string) => void; intent?: string },
): Promise<void> {
  if (!config) {
    onError(new Error('AI SDK not configured'));
    return;
  }

  // Step 6 模型分级路由：casual_chat 且配置了经济档 → fast，其余 main
  const tier = resolveChatTier(options?.intent, config.modelFast);
  const { languageModel, modelName } = getModel(tier);

  logger.info('sdkStreamChat called', {
    messageCount: messages.length,
    hasConfig: !!config,
    baseUrl: config.baseUrl,
    tier,
    model: modelName,
  })

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
    recordChatUsage(Date.now() - startedAt, usage, modelName);
    onComplete(usage);
  };
  const safeError = (error: Error) => {
    if (completed) return;
    completed = true;
    onError(error);
  };

  try {
    logger.info('Calling streamText with model', { model: modelName, baseUrl: config.baseUrl })
    // 深度思考开关必须下发到服务商，否则形同虚设：
    // deepseek-flash 这类模型**默认就会思考**，每次回答前先产出 200-3000 字符的
    // reasoning。实测关闭后 2.8s vs 开启 13-16s（约 5 倍），且能避免 reasoning
    // 吃满输出预算导致正文为空。
    const reasoningOff = options?.enableReasoning !== true;

    const result = streamText({
      model: languageModel,
      messages: normalizedMessages,
      maxOutputTokens: config.maxTokens ?? 4096,
      temperature: config.temperature ?? 0.7,
      abortSignal: signal,
      ...(reasoningOff
        ? { providerOptions: { openaiCompatible: { reasoningEffort: 'none' } } }
        : {}),
      onError: (error) => {
        logger.error('streamText onError callback', error);
        safeError(error instanceof Error ? error : new Error(String(error)));
      },
    });
    logger.info('streamText returned, awaiting textStream', { reasoningOff })

    // finishReason 是判断「为什么没有正文」的关键：
    // length = 输出预算被占满（思考型模型的典型表现）；stop = 正常结束。
    try {
      const reason = await result.finishReason
      logger.info('streamText finishReason', { finishReason: reason })
    } catch {
      // 部分 provider 不返回，忽略
    }

    let hasOutput = false;
    let chunkCount = 0;
    let reasoningCount = 0;

    // 改用 fullStream：textStream 只给正文，拿不到 reasoning。
    // 深度思考开启时，把 reasoning-delta 转发到渲染层做流式展示。
    for await (const part of result.fullStream) {
      if (part.type === 'text-delta') {
        // AI SDK 7 的 text-delta 有两种形状（text / delta），逐级兜底
        const piece = (part as { text?: string; delta?: string }).text
          ?? (part as { delta?: string }).delta
          ?? '';
        if (!piece) continue;
        onChunk(piece);
        hasOutput = true;
        chunkCount++;
        if (chunkCount <= 5 || chunkCount % 20 === 0) {
          logger.info(`LLM chunk #${chunkCount}`, { chunkLength: piece.length, chunkPreview: piece.slice(0, 80) })
        }
      } else if (part.type === 'reasoning-delta') {
        const piece = (part as { text?: string }).text ?? '';
        if (!piece) continue;
        reasoningCount++;
        options?.onReasoningChunk?.(piece);
      } else if (part.type === 'error') {
        const err = (part as { error?: unknown }).error;
        // 用户主动中断 / 被新流顶掉时，SDK 也会以 error 事件收尾，
        // 这种情况按「已取消」处理，不能当成故障弹给用户。
        if (signal.aborted) {
          logger.info('fullStream aborted by signal');
          safeComplete({ promptTokens: 0, completionTokens: 0 });
          return;
        }
        logger.error('fullStream error part', err);
        safeError(err instanceof Error ? err : new Error(String(err)));
        return;
      }
    }
    logger.info('textStream ended', { chunkCount, hasOutput, reasoningCount })

    // 流「干净结束」但一个字都没产出 —— 原实现会当作成功上报（usage 全 0），
    // 界面既不报错也不出内容，用户看到的就是「宕机/不回答了」。
    // 常见成因：输出预算被 reasoning 占满、服务商侧返回空内容、
    // 或连接被静默中断。此处必须显式报错，不能静默成功。
    if (chunkCount === 0) {
      logger.error('textStream ended with no output', {
        model: config.model,
        baseUrl: config.baseUrl,
        messageCount: normalizedMessages.length,
        maxOutputTokens: config.maxTokens ?? 2000,
      })
      safeError(new Error('模型未返回任何内容。可能是输出长度被「深度思考」占满，或服务商拒绝了本次请求；可尝试关闭深度思考、或换个模型/精简提问后重试。'))
      return
    }

    // 获取用量
    let promptTokens = 0;
    let completionTokens = 0;
    let cachedTokens = 0;
    if (hasOutput) {
      try {
        const usage = await result.usage;
        promptTokens = usage?.inputTokens ?? 0;
        completionTokens = usage?.outputTokens ?? 0;
        // 缓存命中：ai@7 在 inputTokenDetails.cacheReadTokens（旧的 cachedInputTokens
        // 与两条 providerMetadata 兜底都是从猜的字段名来的，永远读不到）
        cachedTokens = cachedTokensFromSdkUsage(usage);
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
 * 结构化输出 —— 由 zod schema 约束返回形状。
 *
 * 与老通路最大的区别：老的是「让模型自由发挥，回来用 repairJSON 把坏 JSON 修好」，
 * 这里是「不合规就抛错」。宁可报错，也不要把一半被截断的 JSON 当成成功结果写进库。
 */
export async function sdkGenerateObject<T>(
  schema: z.ZodSchema<T>,
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
  options?: { maxOutputTokens?: number; temperature?: number; signal?: AbortSignal; feature?: string },
): Promise<T> {
  if (!config) throw new Error('AI SDK not configured');

  const normalizedMessages = normalizeMessages(messages);
  logger.info('sdkGenerateObject normalized messages', {
    originalCount: messages.length,
    normalizedCount: normalizedMessages.length,
  });

  const { languageModel, modelName } = getModel();
  const startedAt = Date.now();
  const result = await generateObject({
    model: languageModel,
    schema,
    messages: normalizedMessages,
    temperature: options?.temperature ?? config.temperature ?? 0.7,
    maxOutputTokens: options?.maxOutputTokens ?? config.maxTokens ?? 2000,
    abortSignal: options?.signal,
    providerOptions: REASONING_OFF,
  });

  recordGenerateUsage(
    result.usage,
    options?.feature ?? 'generate',
    Date.now() - startedAt,
    modelName,
  );

  return result.object;
}

/** 结构化输出的严格 schema —— 模型不合财会抛错，不再靠 repairJSON 硬修 */
const bookSummarySchema = z.object({
  summary: z.string().min(1, 'summary 不能为空'),
  keyPoints: z.array(z.string()).default([]),
});

/**
 * 层级摘要 L1：一章的划线圈 → 一段章节摘要（纯文本）。
 * 提示词要求纯文本，但模型仍可能包一层代码块，这里兜底剥掉。
 */
export async function generateChapterSummary(
  bookTitle: string,
  chapterTitle: string,
  highlightTexts: string,
): Promise<string> {
  if (!highlightTexts || highlightTexts.trim() === '') {
    throw new Error('No highlights provided for chapter summary generation');
  }

  const text = await sdkGenerateText(
    buildMessages('generateChapterSummary', '', { bookTitle, chapterTitle, highlightTexts }),
    { feature: 'generateChapterSummary' },
  );
  const summary = text
    .replace(/^```(?:\w*)?\s*/, '')
    .replace(/\s*```$/, '')
    .trim();

  if (!summary) throw new Error('AI 返回的章节摘要为空');
  return summary;
}

/**
 * 层级摘要 L2：各章摘要 → 全书摘要。
 * 输入是 L1 的二手概括，所以单独一对提示词，不复用「从划线生成摘要」那条。
 */
export async function generateBookSummary(
  bookTitle: string,
  chapterSummaryTexts: string,
): Promise<{ summary: string; keyPoints: string[] }> {
  const parsed = await sdkGenerateObject(
    bookSummarySchema,
    buildMessages('generateBookSummary', '', { bookTitle, chapterSummaryTexts }),
    { feature: 'generateBookSummary' },
  );

  return {
    summary: parsed.summary.trim(),
    keyPoints: parsed.keyPoints.map((point) => point.trim()).filter((point) => point.length > 0),
  };
}

/** 卡片解读 / 卡片应用：同形状的两种输出，只有提示词模板不同 */
async function generateCardText(
  feature: 'generateCardInterpretation' | 'generateCardApplication',
  bookTitle: string,
  cardTitle: string,
  cardContent: string,
  cardType: string,
): Promise<string> {
  const text = await sdkGenerateText(
    buildMessages(feature, '', { bookTitle, cardTitle, cardContent, cardType }),
    { maxOutputTokens: 600, feature },
  );
  return text.trim();
}

export function generateCardInterpretation(
  bookTitle: string,
  cardTitle: string,
  cardContent: string,
  cardType: string,
): Promise<string> {
  return generateCardText('generateCardInterpretation', bookTitle, cardTitle, cardContent, cardType);
}

export function generateCardApplication(
  bookTitle: string,
  cardTitle: string,
  cardContent: string,
  cardType: string,
): Promise<string> {
  return generateCardText('generateCardApplication', bookTitle, cardTitle, cardContent, cardType);
}

export interface SkillMethodologyInput {
  name: string
  nameEn?: string
  triggerScenario?: string
  description?: string
  steps?: string[]
  outputFormat?: string
  examples?: string
  bookTitle?: string
}

/** 方法论 → 可复用 Skill 文件（Markdown 正文） */
export async function generateSkill(methodology: SkillMethodologyInput): Promise<string> {
  return sdkGenerateText(
    buildMessages('generateSkill', '', {
      name: methodology.name,
      nameEn: formatSkillNameEnLine(methodology.name, methodology.nameEn),
      triggerScenario: methodology.triggerScenario || 'N/A',
      description: methodology.description || 'N/A',
      steps: methodology.steps ? methodology.steps.join('\n') : 'N/A',
      outputFormat: methodology.outputFormat || 'N/A',
      examples: methodology.examples || 'N/A',
      bookTitle: methodology.bookTitle || '未知书籍',
    }),
    { feature: 'generateSkill' },
  );
}

/**
 * RSS 文章翻译：标题一次调用 + 正文逐段调用（分段是为了不把整篇塞进一次请求）。
 *
 * 两段提示词是硬编码的，没进提示词注册表 —— 翻译是机械任务，覆写它没有意义，
 * 而「只返回翻译结果」这句一旦被改，界面拿到的就是模型的解释而不是译文。
 */
export async function translateArticle(
  titleEn: string,
  contentEn: string,
): Promise<{ title_zh: string; summary_zh: string; content_zh: string }> {
  const title_zh = (
    await sdkGenerateText(
      [
        { role: 'system', content: '你是翻译助手，将英文翻译为中文，只返回翻译结果。' },
        { role: 'user', content: `翻译以下英文标题为中文：\n${titleEn}` },
      ],
      { maxOutputTokens: 512, feature: 'translateArticle' },
    )
  ).trim();

  const paragraphs = contentEn.split(/\n\s*\n/).filter((p) => p.trim());
  const contentParagraphs: string[] = [];
  for (const para of paragraphs) {
    const translated = await sdkGenerateText(
      [
        { role: 'system', content: '你是翻译助手，将英文段落翻译为中文，保持段落结构，只返回翻译结果。' },
        { role: 'user', content: `翻译以下英文段落为中文：\n${para}` },
      ],
      { maxOutputTokens: 2000, feature: 'translateArticle' },
    );
    contentParagraphs.push(translated.trim());
  }

  const content_zh = contentParagraphs.join('\n\n');
  const summary_zh = contentParagraphs[0] ? `${contentParagraphs[0].slice(0, 100)}...` : '';

  // 必须校验：模型返回空内容时不报错的话，空字符串会被当成功写进 articles 表，
  // 界面因此永远停在「点击翻译」且从不提示失败（线上真实故障）。
  if (!title_zh && !content_zh) {
    throw new Error('翻译返回空内容。可能是输出预算被「深度思考」占满或服务商拒绝请求，请重试。');
  }

  logger.info('Article translated', { paragraphs: contentParagraphs.length });
  return { title_zh, summary_zh, content_zh };
}

/**
 * 从 AI SDK 的 usage 里取"缓存命中的输入 token"。
 *
 * ai@7 的 LanguageModelUsage **没有** cachedInputTokens 这个字段 —— 之前读的是它，
 * 所以 token_usage.cached_tokens 恒为 0，统计页那句"缓存命中率"从来没真测到过。
 * 取法集中在 src/shared/usage-tokens.ts（两条通路共用一份判据）。
 */

/** 非流式补全用量落库（与 recordChatUsage 同机制，feature 区分）：0 用量不记，失败不报错 */
function recordGenerateUsage(
  usage: unknown,
  feature: string,
  durationMs: number,
  modelUsed?: string,
): void {
  const tokens = (usage ?? {}) as { inputTokens?: number; outputTokens?: number };
  const inputTokens = tokens.inputTokens ?? 0;
  const outputTokens = tokens.outputTokens ?? 0;
  if (inputTokens + outputTokens <= 0 || !config) return;
  try {
    tokenUsageDb.create({
      provider: config.provider,
      model: modelUsed || config.model || 'default',
      feature,
      inputTokens,
      outputTokens,
      cachedTokens: Math.min(cachedTokensFromSdkUsage(usage), inputTokens),
      durationMs,
    });
  } catch (err) {
    logger.warn('Failed to record generateText usage', { error: err instanceof Error ? err.message : String(err) });
  }
}

/**
 * 非流式文本补全 —— 用于离线/内部任务（历史滚动摘要、章节摘要、卡片解读、Skill 生成等）。
 * 用量按 feature 落库，便于逐个功能核算成本。
 *
 * 默认值跟着用户配置走（温度 / 输出预算），只有需要特殊预算的调用才显式传：
 * 历史摘要要 500/0.3，卡片解读要 600 —— 传死值会让换模型时预算不合理。
 */
export async function sdkGenerateText(
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
  options?: {
    maxOutputTokens?: number;
    temperature?: number;
    feature?: string;
    signal?: AbortSignal;
  },
): Promise<string> {
  if (!config) throw new Error('AI SDK not configured');
  const normalizedMessages = normalizeMessages(messages);
  const startedAt = Date.now();
  const { languageModel, modelName } = getModel();
  const result = await generateText({
    model: languageModel,
    messages: normalizedMessages,
    maxOutputTokens: options?.maxOutputTokens ?? config.maxTokens ?? 2000,
    temperature: options?.temperature ?? config.temperature ?? 0.7,
    abortSignal: options?.signal,
    providerOptions: REASONING_OFF,
  });

  recordGenerateUsage(
    result.usage,
    options?.feature ?? 'summary',
    Date.now() - startedAt,
    modelName,
  );

  return result.text;
}

