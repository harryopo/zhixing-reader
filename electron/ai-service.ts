import { logger } from './logger';
import { tokenUsageDb } from './database';
import { fetchWithTimeout, fetchWithRetry, RETRY_CONFIGS, HttpAbortError, HttpNetworkError, RetryConfig } from './http-client';
import { getPromptTemplate } from './services/prompt-storage';
import { renderTemplate } from './services/template-engine';

function buildMessages(feature: string, systemExtra: string, userVars: Record<string, string | number | undefined>): Message[] {
  const systemId = `ai.${feature}.system`
  const userId = `ai.${feature}.user`
  const systemTemplate = getPromptTemplate(systemId)
  const userTemplate = getPromptTemplate(userId)
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

export type AIProvider = 'openai' | 'anthropic' | 'custom';

interface AIServiceConfig {
  provider: AIProvider;
  apiKey: string;
  baseUrl?: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
}

interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface AIResponse {
  content: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
  };
  finishReason?: string;
}

interface _StreamCallbacks {
  onToken?: (token: string) => void;
  onComplete?: (response: AIResponse) => void;
  onError?: (error: Error) => void;
}

let config: AIServiceConfig | null = null;

// Simple content-hash cache for non-streaming AI responses
const responseCache = new Map<string, { data: AIResponse; timestamp: number }>()
const CACHE_TTL = 10 * 60 * 1000 // 10 minutes
const CACHE_MAX_SIZE = 50

function hashMessages(messages: Message[]): string {
  const key = messages.map(m => `${m.role}:${m.content}`).join('|')
  let hash = 0
  for (let i = 0; i < key.length; i++) {
    const char = key.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash |= 0
  }
  return `ai_${hash.toString(36)}`
}

function getCachedResponse(key: string): AIResponse | null {
  const entry = responseCache.get(key)
  if (!entry) return null
  if (Date.now() - entry.timestamp > CACHE_TTL) {
    responseCache.delete(key)
    return null
  }
  return entry.data
}

function setCachedResponse(key: string, data: AIResponse): void {
  if (responseCache.size >= CACHE_MAX_SIZE) {
    const oldestKey = responseCache.keys().next().value
    if (oldestKey) responseCache.delete(oldestKey)
  }
  responseCache.set(key, { data, timestamp: Date.now() })
}

function recordTokenUsage(feature: string, usage: { promptTokens: number; completionTokens: number }, durationMs: number): void {
  const provider = config?.provider || 'unknown'
  const model = config?.model || 'unknown'

  try {
    tokenUsageDb.create({
      provider,
      model,
      feature,
      inputTokens: usage.promptTokens,
      outputTokens: usage.completionTokens,
      durationMs,
    })
  } catch (error) {
    logger.error('Failed to record token usage', error)
  }
}

export function setAIConfig(newConfig: AIServiceConfig): void {
  config = newConfig;
  logger.info(`AI service configured: provider=${newConfig.provider}, model=${newConfig.model}`);
}

export function getAIConfig(): AIServiceConfig | null {
  return config;
}

export function initFromSettings(settings: Record<string, unknown>): void {
  const llmKey = settings.llmKey as string;
  const aiProvider = (settings.aiProvider as AIProvider) || 'custom';
  const llmEndpoint = settings.llmEndpoint as string;
  const llmModel = settings.llmModel as string;

  if (llmKey) {
    config = {
      provider: aiProvider,
      apiKey: llmKey,
      baseUrl: llmEndpoint || undefined,
      model: llmModel || undefined,
      maxTokens: 2000,
      temperature: 0.7,
    };
    logger.info(`AI service initialized from settings: provider=${aiProvider}, model=${llmModel || 'default'}`);
  }
}

export async function testConnection(testConfig: AIServiceConfig): Promise<{ success: boolean; message: string }> {
  try {
    const isOpenAICompatible = testConfig.provider === 'openai' || testConfig.provider === 'custom';
    const baseUrl = testConfig.baseUrl || (isOpenAICompatible ? 'https://api.openai.com/v1' : 'https://api.anthropic.com/v1');
    const model = testConfig.model || (isOpenAICompatible ? 'gpt-4o-mini' : 'claude-3-5-sonnet-20241022');

    logger.info(`Testing AI connection: provider=${testConfig.provider}, model=${model}, baseUrl=${baseUrl}`);

    let response;
    if (isOpenAICompatible) {
      response = await fetchWithTimeout(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${testConfig.apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: 'Hi' }],
          max_tokens: 5,
        }),
      }, RETRY_CONFIGS.AI_SERVICE.timeout);
    } else {
      response = await fetchWithTimeout(`${baseUrl}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': testConfig.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: 'Hi' }],
          max_tokens: 5,
        }),
      }, RETRY_CONFIGS.AI_SERVICE.timeout);
    }

    if (!response.ok) {
      const errorText = await response.text();
      logger.error(`AI test failed: ${response.status}`, errorText);
      return { success: false, message: `API错误: ${response.status} - ${errorText}` };
    }

    logger.info('AI test connection successful');
    return { success: true, message: `连接成功！模型: ${model}` };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('AI test connection failed', error);
    return { success: false, message: `连接失败: ${errorMessage}` };
  }
}

interface CallOptions {
  retryConfig?: RetryConfig;
  maxTokensOverride?: number;
  signal?: AbortSignal;
}

async function callOpenAI(messages: Message[], optsOrTokens?: number | CallOptions): Promise<AIResponse> {
  if (!config) throw new Error('AI service not configured');

  const opts: CallOptions = typeof optsOrTokens === 'number' || optsOrTokens === undefined
    ? { maxTokensOverride: typeof optsOrTokens === 'number' ? optsOrTokens : undefined }
    : optsOrTokens;

  const baseUrl = config.baseUrl || 'https://api.openai.com/v1';
  const model = config.model || 'gpt-4o-mini';
  const maxTokens = opts.maxTokensOverride || config.maxTokens || 4000;
  const temperature = config.temperature || 0.7;
  const retryConfig = opts.retryConfig || RETRY_CONFIGS.AI_SERVICE;

  logger.info(`Calling OpenAI API`, { model, messageCount: messages.length });

  const response = await fetchWithRetry(
    `${baseUrl}/chat/completions`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        temperature,
        max_tokens: maxTokens,
      }),
    },
    {
      retryConfig,
      externalSignal: opts.signal,
    }
  );

  const data = await response.json() as {
    choices: Array<{ message: { content: string; role?: string }; finish_reason?: string }>;
    usage: { prompt_tokens: number; completion_tokens: number };
  };

  const choice = data.choices[0];
  if (!choice || !choice.message) {
    throw new Error('Invalid response from OpenAI API: no choices returned');
  }

  return {
    content: choice.message.content,
    usage: {
      promptTokens: data.usage.prompt_tokens,
      completionTokens: data.usage.completion_tokens,
    },
    finishReason: choice.finish_reason,
  };
}

async function callAnthropic(messages: Message[], optsOrTokens?: number | CallOptions): Promise<AIResponse> {
  if (!config) throw new Error('AI service not configured');

  const opts: CallOptions = typeof optsOrTokens === 'number' || optsOrTokens === undefined
    ? { maxTokensOverride: typeof optsOrTokens === 'number' ? optsOrTokens : undefined }
    : optsOrTokens;

  const baseUrl = config.baseUrl || 'https://api.anthropic.com/v1';
  const model = config.model || 'claude-3-5-sonnet-20241022';
  const maxTokens = opts.maxTokensOverride || config.maxTokens || 4000;

  const systemMessage = messages.find(m => m.role === 'system')?.content || '';
  const nonSystemMessages = messages.filter(m => m.role !== 'system');

  logger.info(`Calling Anthropic API`, { model, messageCount: messages.length });

  const response = await fetchWithRetry(
    `${baseUrl}/messages`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': config.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        system: systemMessage,
        messages: nonSystemMessages.map(m => ({
          role: m.role,
          content: m.content,
        })),
        max_tokens: maxTokens,
      }),
    },
    {
      retryConfig: opts.retryConfig || RETRY_CONFIGS.AI_SERVICE,
      externalSignal: opts.signal,
    }
  );

  const data = await response.json() as {
    content: Array<{ type: string; text: string }>;
    usage: { input_tokens: number; output_tokens: number };
    stop_reason?: string;
  };

  if (!data.content || data.content.length === 0) {
    throw new Error('Invalid response from Anthropic API: no content returned');
  }

  return {
    content: data.content[0].text,
    usage: {
      promptTokens: data.usage.input_tokens,
      completionTokens: data.usage.output_tokens,
    },
    finishReason: data.stop_reason,
  };
}

async function callAI(messages: Message[], optsOrTokens?: number | CallOptions): Promise<AIResponse> {
  if (!config) throw new Error('AI service not configured');

  const opts: CallOptions = typeof optsOrTokens === 'number' || optsOrTokens === undefined
    ? { maxTokensOverride: typeof optsOrTokens === 'number' ? optsOrTokens : undefined }
    : optsOrTokens;

  // Check cache (skip for streaming or custom options)
  if (!opts.signal && !opts.retryConfig) {
    const cacheKey = hashMessages(messages)
    const cached = getCachedResponse(cacheKey)
    if (cached) {
      logger.info('AI response cache hit')
      return cached
    }
  }

  let response: AIResponse
  switch (config.provider) {
    case 'openai':
    case 'custom':
      response = await callOpenAI(messages, opts);
      break;
    case 'anthropic':
      response = await callAnthropic(messages, opts);
      break;
    default:
      throw new Error(`Unsupported AI provider: ${config.provider}`);
  }

  // Cache the response
  if (!opts.signal && !opts.retryConfig) {
    setCachedResponse(hashMessages(messages), response)
  }

  return response
}

function extractAndParseJSON<T>(content: string, isArray: boolean): T {
  let cleaned = content.trim();

  logger.info('Raw AI response length:', { length: cleaned.length });

  const mdMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (mdMatch) {
    logger.info('Found markdown code block, extracting...');
    cleaned = mdMatch[1].trim();
  }

  const startIdx = isArray ? cleaned.indexOf('[') : cleaned.indexOf('{');
  const endIdx = isArray ? cleaned.lastIndexOf(']') : cleaned.lastIndexOf('}');

  let jsonStr: string;
  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    jsonStr = cleaned.slice(startIdx, endIdx + 1);
  } else {
    logger.error('Failed to extract JSON from AI response', { 
      content: content.slice(0, 1000),
      isArray,
      startIdx,
      endIdx
    });
    throw new Error('AI响应中未找到有效的JSON格式');
  }

  try {
    return JSON.parse(jsonStr) as T;
  } catch (parseError) {
    logger.warn('Initial JSON parse failed, attempting repair...', { 
      error: String(parseError),
      jsonSnippet: jsonStr.slice(0, 300)
    });

    const repaired = repairJSON(jsonStr);

    try {
      return JSON.parse(repaired) as T;
    } catch (repairError) {
      logger.error('JSON repair failed', { 
        error: String(repairError),
        original: jsonStr.slice(0, 500),
        repaired: repaired.slice(0, 500)
      });
      throw new Error(`JSON解析失败: ${repairError instanceof Error ? repairError.message : String(repairError)}`);
    }
  }
}

function repairJSON(jsonStr: string): string {
  let repaired = jsonStr
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u2033\u2032\u00B4]/g, "'")
    .replace(/[\u3001]/g, '，')
    .replace(/[\uFF0C]/g, ',')
    .replace(/[\uFF1A]/g, ':')
    .replace(/[\u3010]/g, '[')
    .replace(/[\u3011]/g, ']')
    .replace(/[\uFF08]/g, '(')
    .replace(/[\uFF09]/g, ')');

  let result = '';
  let inString = false;
  let escapeNext = false;

  for (let i = 0; i < repaired.length; i++) {
    const char = repaired[i];

    if (escapeNext) {
      result += char;
      escapeNext = false;
      continue;
    }

    if (char === '\\' && inString) {
      result += char;
      escapeNext = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      result += char;
      continue;
    }

    if (inString && (char === '\n' || char === '\r')) {
      result += '\\n';
      continue;
    }

    if (inString && char === '\t') {
      result += '\\t';
      continue;
    }

    result += char;
  }

  repaired = result;

  repaired = repaired.replace(/,\s*([}\]])/g, '$1');

  repaired = repaired.replace(/,\s*$/, '');

  const openBrackets = (repaired.match(/\[/g) || []).length;
  const closeBrackets = (repaired.match(/\]/g) || []).length;
  const openBraces = (repaired.match(/\{/g) || []).length;
  const closeBraces = (repaired.match(/\}/g) || []).length;

  for (let i = 0; i < openBrackets - closeBrackets; i++) {
    repaired += ']';
  }
  for (let i = 0; i < openBraces - closeBraces; i++) {
    repaired += '}';
  }

  return repaired;
}

export async function generateCards(
  highlights: Array<{ content: string; note?: string }>,
  bookTitle: string
): Promise<Array<{ front: string; back: string; tags: string[] }>> {
  if (!highlights || highlights.length === 0) {
    throw new Error('No highlights provided for card generation');
  }

  const highlightTexts = highlights.map((h, i) =>
    `[${i + 1}] ${h.content}${h.note ? `\n笔记: ${h.note}` : ''}`
  ).join('\n\n');

  const messages = buildMessages('generateCards', '', {
    bookTitle,
    highlightTexts,
    count: String(highlights.length),
  });

  const startTime = Date.now();
  try {
    const response = await callAI(messages);
    const durationMs = Date.now() - startTime;
    
    if (response.usage) {
      recordTokenUsage('generateCards', response.usage, durationMs);
    }
    
    const cards = extractAndParseJSON<Array<Record<string, unknown>>>(response.content, true);
    
    if (!Array.isArray(cards)) {
      throw new Error('AI返回的数据不是数组格式');
    }

    const validCards = cards.filter((card): card is Record<string, unknown> => 
      !!card && 
      typeof (card as Record<string, unknown>).front === 'string' && 
      typeof (card as Record<string, unknown>).back === 'string'
    ).map(card => ({
      front: String((card as Record<string, unknown>).front).trim(),
      back: String((card as Record<string, unknown>).back).trim(),
      tags: Array.isArray((card as Record<string, unknown>).tags) ? ((card as Record<string, unknown>).tags as unknown[]).filter((t: unknown) => typeof t === 'string') : [],
    }));

    if (validCards.length === 0) {
      throw new Error('AI生成的卡片均无效');
    }

    logger.info(`Generated ${validCards.length} cards from ${highlights.length} highlights`);
    return validCards;
  } catch (error) {
    logger.error('Failed to generate cards', error);
    throw error;
  }
}

export async function generateSummary(
  highlights: Array<{ content: string; chapterTitle?: string }>,
  bookTitle: string
): Promise<{ summary: string; keyPoints: string[] }> {
  if (!highlights || highlights.length === 0) {
    throw new Error('No highlights provided for summary generation');
  }

  const highlightTexts = highlights.map(h =>
    `${h.chapterTitle ? `[${h.chapterTitle}] ` : ''}${h.content}`
  ).join('\n');

  const messages = buildMessages('generateSummary', '', {
    bookTitle,
    highlightTexts,
  });

  const startTime = Date.now();
  try {
    const response = await callAI(messages);
    const durationMs = Date.now() - startTime;
    
    if (response.usage) {
      recordTokenUsage('generateSummary', response.usage, durationMs);
    }
    
    const result = extractAndParseJSON<Record<string, unknown>>(response.content, false);
    
    if (!result.summary || typeof result.summary !== 'string') {
      throw new Error('AI返回的摘要格式无效');
    }

    const keyPointsRaw = Array.isArray(result.keyPoints) ? result.keyPoints : [];

    const validKeyPoints = keyPointsRaw
      .filter((point: unknown) => typeof point === 'string' && point.trim().length > 0)
      .map((point: string) => point.trim());

    logger.info(`Generated summary for "${bookTitle}" with ${validKeyPoints.length} key points`);
    
    return {
      summary: result.summary.trim(),
      keyPoints: validKeyPoints,
    };
  } catch (error) {
    logger.error('Failed to generate summary', error);
    throw error;
  }
}

/**
 * @deprecated 请使用 agent/orchestrator.processMessageStream 代替。
 * 该函数直接注入全部上下文，不经过意图识别和检索优化。
 */
export async function chatWithContext(
  question: string,
  context: Array<{ content: string; bookTitle?: string }>
): Promise<string> {
  const contextText = context.map(c =>
    `${c.bookTitle ? `[${c.bookTitle}] ` : ''}${c.content}`
  ).join('\n\n');

  const messages = buildMessages('chatWithContext', '', {
    contextText,
    question,
  });

  const startTime = Date.now();
  try {
    const response = await callAI(messages);
    const durationMs = Date.now() - startTime;
    
    if (response.usage) {
      recordTokenUsage('chat', response.usage, durationMs);
    }
    
    return response.content;
  } catch (error) {
    logger.error('Failed to chat with context', error);
    throw error;
  }
}

export async function explainHighlight(
  content: string,
  bookTitle: string,
  chapterTitle?: string
): Promise<string> {
  const messages = buildMessages('explainHighlight', '', {
    bookTitle,
    chapterTitle: chapterTitle ? ` - ${chapterTitle}` : '',
    content,
  });

  const startTime = Date.now();
  try {
    const response = await callAI(messages);
    const durationMs = Date.now() - startTime;
    
    if (response.usage) {
      recordTokenUsage('explain', response.usage, durationMs);
    }
    
    return response.content;
  } catch (error) {
    logger.error('Failed to explain highlight', error);
    throw error;
  }
}

export interface ExtractedMethodology {
  name: string
  nameEn?: string
  triggerScenario?: string
  description?: string
  steps?: string[]
  outputFormat?: string
  examples?: string
  tags?: string[]
}

export async function extractMethodologies(
  highlights: Array<{ content: string; note?: string; chapterTitle?: string }>,
  bookTitle: string
): Promise<ExtractedMethodology[]> {
  if (!highlights || highlights.length === 0) {
    throw new Error('No highlights provided for methodology extraction')
  }

  const limitedHighlights = highlights.length > 50 ? highlights.slice(0, 50) : highlights

  const highlightTexts = limitedHighlights.map((h, i) =>
    `[${i + 1}] ${h.chapterTitle ? `(${h.chapterTitle}) ` : ''}${h.content}${h.note ? `\n笔记: ${h.note}` : ''}`
  ).join('\n\n')

  const messages = buildMessages('extractMethodologies', '', {
    bookTitle,
    highlightTexts,
  })

  const startTime = Date.now()
  try {
    const response = await callAI(messages, 8000)
    const durationMs = Date.now() - startTime

    if (response.usage) {
      recordTokenUsage('extractMethodologies', response.usage, durationMs)
    }

    logger.info('AI response for extractMethodologies', { 
      contentLength: response.content.length,
      contentPreview: response.content.slice(0, 500)
    })

    const methodologies = extractAndParseJSON<Array<Record<string, unknown>>>(response.content, true)

    if (!Array.isArray(methodologies)) {
      throw new Error('AI返回的数据不是数组格式')
    }

    const validMethods = methodologies.filter((m): m is Record<string, unknown> =>
      !!m && typeof (m as Record<string, unknown>).name === 'string' && String((m as Record<string, unknown>).name).trim().length > 0
    ).map(m => ({
      name: String((m as Record<string, unknown>).name).trim(),
      nameEn: typeof (m as Record<string, unknown>).nameEn === 'string' ? String((m as Record<string, unknown>).nameEn).trim() : undefined,
      triggerScenario: typeof (m as Record<string, unknown>).triggerScenario === 'string' ? String((m as Record<string, unknown>).triggerScenario).trim() : undefined,
      description: typeof (m as Record<string, unknown>).description === 'string' ? String((m as Record<string, unknown>).description).trim() : undefined,
      steps: Array.isArray((m as Record<string, unknown>).steps) ? ((m as Record<string, unknown>).steps as unknown[]).filter((s: unknown) => typeof s === 'string') : undefined,
      outputFormat: typeof (m as Record<string, unknown>).outputFormat === 'string' ? String((m as Record<string, unknown>).outputFormat).trim() : undefined,
      examples: typeof (m as Record<string, unknown>).examples === 'string' ? String((m as Record<string, unknown>).examples).trim() : undefined,
      tags: Array.isArray((m as Record<string, unknown>).tags) ? ((m as Record<string, unknown>).tags as unknown[]).filter((t: unknown) => typeof t === 'string') : undefined,
    }))

    logger.info(`Extracted ${validMethods.length} methodologies from ${highlights.length} highlights`)
    return validMethods
  } catch (error) {
    logger.error('Failed to extract methodologies', error)
    throw error
  }
}

export interface BookArchitectureResult {
  coreProposition?: string
  cognitiveFramework?: Record<string, unknown>
  methodologyArchitecture?: Record<string, unknown>
  knowledgeHierarchy?: Record<string, unknown>
  targetAudience?: string
}

export async function analyzeBookArchitecture(
  highlights: Array<{ content: string; note?: string; chapterTitle?: string }>,
  bookTitle: string
): Promise<BookArchitectureResult> {
  if (!highlights || highlights.length === 0) {
    throw new Error('No highlights provided for architecture analysis')
  }

  const highlightTexts = highlights.map((h, i) =>
    `[${i + 1}] ${h.chapterTitle ? `(${h.chapterTitle}) ` : ''}${h.content}${h.note ? `\n笔记: ${h.note}` : ''}`
  ).join('\n\n')

  const messages = buildMessages('analyzeBookArchitecture', '', {
    bookTitle,
    highlightTexts,
  })

  const startTime = Date.now()
  try {
    const response = await callAI(messages)
    const durationMs = Date.now() - startTime

    if (response.usage) {
      recordTokenUsage('analyzeBookArchitecture', response.usage, durationMs)
    }

    const result = extractAndParseJSON<Record<string, unknown>>(response.content, false)

    return {
      coreProposition: typeof result.coreProposition === 'string' ? result.coreProposition.trim() : undefined,
      cognitiveFramework: typeof result.cognitiveFramework === 'object' && result.cognitiveFramework !== null ? result.cognitiveFramework as Record<string, unknown> : undefined,
      methodologyArchitecture: typeof result.methodologyArchitecture === 'object' && result.methodologyArchitecture !== null ? result.methodologyArchitecture as Record<string, unknown> : undefined,
      knowledgeHierarchy: typeof result.knowledgeHierarchy === 'object' && result.knowledgeHierarchy !== null ? result.knowledgeHierarchy as Record<string, unknown> : undefined,
      targetAudience: typeof result.targetAudience === 'string' ? result.targetAudience.trim() : undefined,
    }
  } catch (error) {
    logger.error('Failed to analyze book architecture', error)
    throw error
  }
}

export interface DistilledKnowledgeCard {
  type: 'concept' | 'methodology' | 'quote'
  title: string
  content: string
  interpretation?: string
  application?: string
  tags?: string[]
}

export interface DistillOptions {
  signal?: AbortSignal
  onProgress?: (info: { stage: 'fetch' | 'batch' | 'parse' | 'save'; current: number; total: number; message?: string }) => void
  batchSize?: number
}

const DEFAULT_DISTILL_BATCH_SIZE = 20
const DISTILL_MAX_HIGHLIGHTS = 60

function formatAbortErrorMessage(err: unknown): string {
  if (err instanceof HttpAbortError) {
    if (err.cause === 'timeout') {
      return `AI蒸馏请求超时（${Math.round(err.timeoutMs / 1000)}秒）。笔记数量过多时可能耗时较长，请尝试分批或稍后重试。`
    }
    if (err.cause === 'cancelled') {
      return 'AI蒸馏已被用户取消'
    }
    return `AI请求被中止: ${err.message}`
  }
  if (err instanceof HttpNetworkError) {
    return `网络错误: ${err.message}。请检查网络连接后重试。`
  }
  return err instanceof Error ? err.message : String(err)
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size))
  }
  return chunks
}

function buildDistillMessages(
  highlights: Array<{ content: string; note?: string; chapterTitle?: string }>,
  bookTitle: string
): Message[] {
  const highlightTexts = highlights.map((h, i) =>
    `[${i + 1}] ${h.chapterTitle ? `(${h.chapterTitle}) ` : ''}${h.content}${h.note ? `\n笔记: ${h.note}` : ''}`
  ).join('\n\n')

  return buildMessages('distillKnowledgeCards', '', {
    bookTitle,
    highlightTexts,
  })
}

export async function distillKnowledgeCards(
  highlights: Array<{ content: string; note?: string; chapterTitle?: string }>,
  bookTitle: string,
  options: DistillOptions = {}
): Promise<DistilledKnowledgeCard[]> {
  if (!highlights || highlights.length === 0) {
    throw new Error('No highlights provided for knowledge card distillation')
  }

  const { signal, onProgress, batchSize = DEFAULT_DISTILL_BATCH_SIZE } = options
  const limitedHighlights = highlights.length > DISTILL_MAX_HIGHLIGHTS
    ? highlights.slice(0, DISTILL_MAX_HIGHLIGHTS)
    : highlights
  const truncated = limitedHighlights.length < highlights.length

  onProgress?.({ stage: 'fetch', current: 0, total: limitedHighlights.length, message: '准备蒸馏...' })

  if (limitedHighlights.length <= batchSize) {
    return distillSingleBatch(limitedHighlights, bookTitle, signal, onProgress)
  }

  const batches = chunkArray(limitedHighlights, batchSize)
  const allCards: DistilledKnowledgeCard[] = []

  for (let i = 0; i < batches.length; i++) {
    if (signal?.aborted) {
      throw new HttpAbortError('蒸馏已被用户取消', 'cancelled', 0)
    }

    onProgress?.({
      stage: 'batch',
      current: i + 1,
      total: batches.length,
      message: `正在蒸馏第 ${i + 1}/${batches.length} 批（${batches[i].length} 条笔记）`,
    })

    try {
      const cards = await distillSingleBatch(batches[i], bookTitle, signal, onProgress)
      allCards.push(...cards)
    } catch (error) {
      if (error instanceof HttpAbortError && error.cause === 'cancelled') {
        throw error
      }
      const msg = formatAbortErrorMessage(error)
      logger.error(`Batch ${i + 1} distill failed: ${msg}`)
      throw new Error(`第 ${i + 1}/${batches.length} 批蒸馏失败: ${msg}`)
    }
  }

  if (truncated) {
    logger.warn(`Highlights truncated from ${highlights.length} to ${DISTILL_MAX_HIGHLIGHTS}`)
  }

  onProgress?.({ stage: 'save', current: limitedHighlights.length, total: limitedHighlights.length, message: '蒸馏完成' })
  return allCards
}

async function distillSingleBatch(
  highlights: Array<{ content: string; note?: string; chapterTitle?: string }>,
  bookTitle: string,
  signal: AbortSignal | undefined,
  onProgress?: DistillOptions['onProgress']
): Promise<DistilledKnowledgeCard[]> {
  const messages = buildDistillMessages(highlights, bookTitle)

  const startTime = Date.now()
  let response: AIResponse
  try {
    response = await callAI(messages, {
      maxTokensOverride: 8000,
      retryConfig: RETRY_CONFIGS.AI_DISTILL,
      signal,
    })
  } catch (error) {
    throw new Error(formatAbortErrorMessage(error))
  }
  const durationMs = Date.now() - startTime

  if (response.usage) {
    recordTokenUsage('distillKnowledgeCards', response.usage, durationMs)
  }

  logger.info('AI response for distillKnowledgeCards', {
    contentLength: response.content.length,
    contentPreview: response.content.slice(0, 500),
    durationMs,
  })

  onProgress?.({ stage: 'parse', current: highlights.length, total: highlights.length, message: '正在解析响应...' })

  let cards: Array<Record<string, unknown>>
  try {
    cards = extractAndParseJSON<Array<Record<string, unknown>>>(response.content, true)
  } catch (parseError) {
    const msg = parseError instanceof Error ? parseError.message : String(parseError)
    throw new Error(`AI响应解析失败: ${msg}。请重试或减少笔记数量。`)
  }

  if (!Array.isArray(cards)) {
    throw new Error('AI返回的数据不是数组格式')
  }

  const validCards = cards.filter((c): c is Record<string, unknown> =>
    c && typeof c.title === 'string' && typeof c.content === 'string'
  ).map(c => ({
    type: (['concept', 'methodology', 'quote'].includes(c.type as string) ? c.type : 'concept') as 'concept' | 'methodology' | 'quote',
    title: (c.title as string).trim(),
    content: (c.content as string).trim(),
    interpretation: typeof c.interpretation === 'string' ? (c.interpretation as string).trim() : undefined,
    application: typeof c.application === 'string' ? (c.application as string).trim() : undefined,
    tags: Array.isArray(c.tags) ? c.tags.filter((t: unknown) => typeof t === 'string') as string[] : undefined,
  }))

  logger.info(`Distilled ${validCards.length} knowledge cards from ${highlights.length} highlights (${durationMs}ms)`)
  return validCards
}

export async function generateCardInterpretation(
  bookTitle: string,
  cardTitle: string,
  cardContent: string,
  cardType: string
): Promise<string> {
  const messages = buildMessages('generateCardInterpretation', '', {
    bookTitle,
    cardTitle,
    cardContent,
    cardType,
  })

  const startTime = Date.now()
  try {
    const response = await callAI(messages, {
      maxTokensOverride: 600,
      retryConfig: RETRY_CONFIGS.AI_SERVICE,
    })
    const durationMs = Date.now() - startTime
    if (response.usage) {
      recordTokenUsage('generateCardInterpretation', response.usage, durationMs)
    }
    return response.content.trim()
  } catch (error) {
    logger.error('Failed to generate card interpretation', error)
    throw error
  }
}

export async function generateCardApplication(
  bookTitle: string,
  cardTitle: string,
  cardContent: string,
  cardType: string
): Promise<string> {
  const messages = buildMessages('generateCardApplication', '', {
    bookTitle,
    cardTitle,
    cardContent,
    cardType,
  })

  const startTime = Date.now()
  try {
    const response = await callAI(messages, {
      maxTokensOverride: 600,
      retryConfig: RETRY_CONFIGS.AI_SERVICE,
    })
    const durationMs = Date.now() - startTime
    if (response.usage) {
      recordTokenUsage('generateCardApplication', response.usage, durationMs)
    }
    return response.content.trim()
  } catch (error) {
    logger.error('Failed to generate card application', error)
    throw error
  }
}

export async function generateSkill(
  methodology: ExtractedMethodology & { id?: string; bookId?: string; bookTitle?: string }
): Promise<string> {
  // 生成英文名称：将中文名转换为拼音风格或直接使用英文名
  const nameEn = methodology.nameEn || methodology.name
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, '-')
    .replace(/^-+|-+$/g, '') || 'methodology'

  const messages = buildMessages('generateSkill', '', {
    name: methodology.name,
    nameEn: nameEn,
    triggerScenario: methodology.triggerScenario || 'N/A',
    description: methodology.description || 'N/A',
    steps: methodology.steps ? methodology.steps.join('\n') : 'N/A',
    outputFormat: methodology.outputFormat || 'N/A',
    examples: methodology.examples || 'N/A',
    bookTitle: methodology.bookTitle || '未知书籍',
  })

  const startTime = Date.now()
  try {
    const response = await callAI(messages)
    const durationMs = Date.now() - startTime

    if (response.usage) {
      recordTokenUsage('generateSkill', response.usage, durationMs)
    }

    return response.content
  } catch (error) {
    logger.error('Failed to generate skill', error)
    throw error
  }
}

export async function generateSkillBatch(
  methodologies: Array<ExtractedMethodology & { id?: string; bookId?: string; bookTitle?: string }>
): Promise<Record<string, string>> {
  const results: Record<string, string> = {}

  for (const method of methodologies) {
    try {
      const skillContent = await generateSkill(method)
      results[method.name] = skillContent
    } catch (error) {
      logger.error(`Failed to generate skill for ${method.name}`, error)
    }
  }

  return results
}

/** Active chat stream — only one at a time; cancelActiveStream aborts network read */
let activeStreamController: AbortController | null = null

/** Abort in-flight streamChat (user stop). Returns true if something was aborted. */
export function cancelActiveStream(): boolean {
  if (!activeStreamController) return false
  try {
    activeStreamController.abort()
  } catch {
    // ignore
  }
  activeStreamController = null
  return true
}

function isCancelledError(error: unknown): boolean {
  if (error instanceof HttpAbortError && error.cause === 'cancelled') return true
  if (error instanceof Error) {
    const msg = error.message || ''
    if (error.name === 'AbortError') return true
    if (msg.includes('aborted') || msg.includes('The operation was aborted') || msg.includes('请求被用户取消')) {
      return true
    }
  }
  return false
}

export interface StreamChatOptions {
  /** 开启深度思考模式（DeepSeek R1 reasoning_content / Claude thinking / OpenAI o-series summary） */
  enableReasoning?: boolean
  /** 推理过程流式回调（chunk 增量） */
  onReasoningChunk?: (chunk: string) => void
}

export async function streamChat(
  messages: Message[],
  onChunk: (chunk: string) => void,
  onComplete: (usage?: { promptTokens: number; completionTokens: number }) => void,
  onError: (error: Error) => void,
  options?: StreamChatOptions
): Promise<void> {
  if (!config) {
    onError(new Error('AI service not configured'));
    return;
  }

  // Replace any previous stream
  if (activeStreamController) {
    try { activeStreamController.abort() } catch { /* ignore */ }
  }
  const controller = new AbortController()
  activeStreamController = controller
  const signal = controller.signal

  let completed = false
  const safeComplete = (usage?: { promptTokens: number; completionTokens: number }) => {
    if (completed) return
    completed = true
    onComplete(usage)
  }
  const safeError = (error: Error) => {
    if (completed) return
    completed = true
    onError(error)
  }

  const isOpenAICompatible = config.provider === 'openai' || config.provider === 'custom';

  try {
    if (isOpenAICompatible) {
      await streamOpenAI(messages, onChunk, safeComplete, safeError, signal, options);
    } else {
      await streamAnthropic(messages, onChunk, safeComplete, safeError, signal, options);
    }
  } catch (error) {
    if (isCancelledError(error) || signal.aborted) {
      safeComplete(undefined)
      return
    }
    safeError(error instanceof Error ? error : new Error(String(error)));
  } finally {
    if (activeStreamController === controller) {
      activeStreamController = null
    }
  }
}

async function streamOpenAI(
  messages: Message[],
  onChunk: (chunk: string) => void,
  onComplete: (usage?: { promptTokens: number; completionTokens: number }) => void,
  onError: (error: Error) => void,
  signal: AbortSignal,
  options?: StreamChatOptions
): Promise<void> {
  if (!config) throw new Error('AI service not configured');

  const enableReasoning = options?.enableReasoning === true
  const onReasoningChunk = options?.onReasoningChunk

  const baseUrl = config.baseUrl || 'https://api.openai.com/v1';
  const model = config.model || 'gpt-4o-mini';
  const maxTokens = config.maxTokens || 2000;
  const temperature = config.temperature || 0.7;

  const startTime = Date.now();

  try {
    const body: Record<string, unknown> = {
      model,
      messages,
      temperature,
      max_tokens: maxTokens,
      stream: true,
    }
    // 深度思考模式：DeepSeek R1 (deepseek-reasoner) 默认返回 reasoning_content；
    // OpenAI o 系列需要 reasoning_effort；其它模型只尽力解析 delta.reasoning_content。
    // 不强行修改 model —— 由用户在设置里选择支持的模型。
    if (enableReasoning) {
      // OpenAI o 系列参数（若模型是 o1/o3/o4-mini 会生效；其它模型会被忽略）
      body.reasoning_effort = 'medium'
      // DeepSeek / 第三方兼容 API：stream_options 让 usage 提早返回，但不影响 reasoning
      body.stream_options = { include_usage: true }
    }

    const response = await fetchWithTimeout(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(body),
    }, {
      timeoutMs: RETRY_CONFIGS.AI_SERVICE.timeout,
      externalSignal: signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI API error: ${response.status} - ${errorText}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('No response body');
    }

    const decoder = new TextDecoder();
    let _totalContent = '';
    let usageData: { promptTokens: number; completionTokens: number } | undefined;

    while (true) {
      if (signal.aborted) {
        try { await reader.cancel() } catch { /* ignore */ }
        onComplete(usageData)
        return
      }
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split('\n').filter(line => line.trim() !== '');

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6).trim();
          if (data === '[DONE]') continue;

          try {
            const parsed = JSON.parse(data);
            const delta = parsed.choices?.[0]?.delta;
            if (delta?.content) {
              _totalContent += delta.content;
              onChunk(delta.content);
            }
            // DeepSeek R1 / 兼容 API：reasoning_content 字段
            if (enableReasoning && onReasoningChunk && delta?.reasoning_content) {
              onReasoningChunk(delta.reasoning_content);
            }
            // OpenAI o 系列：reasoning summary（部分 provider 通过 delta.reasoning 透传）
            if (enableReasoning && onReasoningChunk && delta?.reasoning) {
              const r = delta.reasoning
              if (typeof r === 'string') {
                onReasoningChunk(r)
              } else if (r && typeof r === 'object' && Array.isArray(r.summary)) {
                for (const s of r.summary) {
                  if (s && typeof s === 'object' && typeof s.text === 'string') {
                    onReasoningChunk(s.text)
                  }
                }
              }
            }
            if (parsed.usage) {
              usageData = {
                promptTokens: parsed.usage.prompt_tokens,
                completionTokens: parsed.usage.completion_tokens,
              };
            }
          } catch {
          }
        }
      }
    }

    const durationMs = Date.now() - startTime;
    if (usageData) {
      recordTokenUsage('streamChat', usageData, durationMs);
    }

    onComplete(usageData);
  } catch (error) {
    if (isCancelledError(error) || signal.aborted) {
      onComplete(undefined)
      return
    }
    onError(error instanceof Error ? error : new Error(String(error)));
  }
}

async function streamAnthropic(
  messages: Message[],
  onChunk: (chunk: string) => void,
  onComplete: (usage?: { promptTokens: number; completionTokens: number }) => void,
  onError: (error: Error) => void,
  signal: AbortSignal,
  options?: StreamChatOptions
): Promise<void> {
  if (!config) throw new Error('AI service not configured');

  const enableReasoning = options?.enableReasoning === true
  const onReasoningChunk = options?.onReasoningChunk

  const baseUrl = config.baseUrl || 'https://api.anthropic.com/v1';
  const model = config.model || 'claude-3-5-sonnet-20241022';
  const maxTokens = config.maxTokens || 2000;

  const systemMessage = messages.find(m => m.role === 'system')?.content || '';
  const nonSystemMessages = messages.filter(m => m.role !== 'system');

  const startTime = Date.now();

  try {
    const body: Record<string, unknown> = {
      model,
      system: systemMessage,
      messages: nonSystemMessages.map(m => ({
        role: m.role,
        content: m.content,
      })),
      max_tokens: maxTokens,
      stream: true,
    }
    // Claude extended thinking（sonnet-4.6 / opus-4.6 等）
    if (enableReasoning) {
      body.thinking = { type: 'enabled', budget_tokens: Math.min(10000, Math.max(1024, maxTokens - 1)) }
    }

    const response = await fetchWithTimeout(`${baseUrl}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': config.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    }, {
      timeoutMs: RETRY_CONFIGS.AI_SERVICE.timeout,
      externalSignal: signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Anthropic API error: ${response.status} - ${errorText}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('No response body');
    }

    const decoder = new TextDecoder();
    let usageData: { promptTokens: number; completionTokens: number } | undefined;

    while (true) {
      if (signal.aborted) {
        try { await reader.cancel() } catch { /* ignore */ }
        onComplete(usageData)
        return
      }
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split('\n').filter(line => line.trim() !== '');

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6).trim();

          try {
            const parsed = JSON.parse(data);
            // 文本增量
            if (parsed.type === 'content_block_delta') {
              if (parsed.delta?.text) {
                onChunk(parsed.delta.text);
              }
              // Claude thinking 增量
              if (enableReasoning && onReasoningChunk && parsed.delta?.type === 'thinking_delta' && typeof parsed.delta.thinking === 'string') {
                onReasoningChunk(parsed.delta.thinking);
              }
            }
            if (parsed.type === 'message_delta' && parsed.usage) {
              if (usageData) {
                // message_start 已设置 promptTokens，只更新 completionTokens
                usageData.completionTokens = parsed.usage.output_tokens;
              } else {
                // 异常顺序：message_delta 先于 message_start（不应发生但容错）
                usageData = {
                  promptTokens: 0,
                  completionTokens: parsed.usage.output_tokens,
                };
              }
            }
            if (parsed.type === 'message_start' && parsed.message?.usage) {
              if (usageData) {
                usageData.promptTokens = parsed.message.usage.input_tokens;
              } else {
                usageData = {
                  promptTokens: parsed.message.usage.input_tokens,
                  completionTokens: 0,
                };
              }
            }
          } catch {
          }
        }
      }
    }

    const durationMs = Date.now() - startTime;
    if (usageData) {
      recordTokenUsage('streamChat', usageData, durationMs);
    }

    onComplete(usageData);
  } catch (error) {
    if (isCancelledError(error) || signal.aborted) {
      onComplete(undefined)
      return
    }
    onError(error instanceof Error ? error : new Error(String(error)));
  }
}

/**
 * 翻译 RSS 文章为中文
 * 分段翻译避免超长，返回标题、摘要、正文的中文翻译
 */
export async function translateArticle(
  titleEn: string,
  contentEn: string
): Promise<{ title_zh: string; summary_zh: string; content_zh: string }> {
  if (!config) throw new Error('AI service not configured');

  // 翻译标题
  const titleMessages: Message[] = [
    { role: 'system', content: '你是翻译助手，将英文翻译为中文，只返回翻译结果。' },
    { role: 'user', content: `翻译以下英文标题为中文：\n${titleEn}` },
  ];

  const titleResponse = await callAI(titleMessages, { maxTokensOverride: 200 });
  const title_zh = titleResponse.content.trim();

  // 分段翻译正文
  const paragraphs = contentEn.split(/\n\s*\n/).filter(p => p.trim());
  const contentParagraphs: string[] = [];

  for (const para of paragraphs) {
    const paraMessages: Message[] = [
      { role: 'system', content: '你是翻译助手，将英文段落翻译为中文，保持段落结构，只返回翻译结果。' },
      { role: 'user', content: `翻译以下英文段落为中文：\n${para}` },
    ];

    const paraResponse = await callAI(paraMessages, { maxTokensOverride: 1000 });
    contentParagraphs.push(paraResponse.content.trim());
  }

  const content_zh = contentParagraphs.join('\n\n');
  // 修复：原代码 `contentParagraphs[0]?.slice(0, 100) + '...' || ''` 有运算符优先级 bug
  //   `+` 优先于 `||`，解析为 `(undefined + '...') || ''` = `'undefined...'`
  //   当 contentParagraphs 为空时 summary_zh 应为空字符串
  const summary_zh = contentParagraphs[0]
    ? contentParagraphs[0].slice(0, 100) + '...'
    : '';

  return { title_zh, summary_zh, content_zh };
}
