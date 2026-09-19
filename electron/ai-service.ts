import { logger } from './logger';
import { tokenUsageDb } from './database';
import { fetchWithTimeout, fetchWithRetry, RETRY_CONFIGS, HttpAbortError, HttpNetworkError, RetryConfig } from './http-client';
import { buildMessages } from './services/prompt-messages';

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
    /** 前缀缓存命中的输入 tokens（服务商不给这个字段时为 undefined，统计页按 0 处理） */
    cachedTokens?: number;
  };
  finishReason?: string;
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

function recordTokenUsage(
  feature: string,
  usage: { promptTokens: number; completionTokens: number; cachedTokens?: number },
  durationMs: number
): void {
  const provider = config?.provider || 'unknown'
  const model = config?.model || 'unknown'

  try {
    tokenUsageDb.create({
      provider,
      model,
      feature,
      inputTokens: usage.promptTokens,
      outputTokens: usage.completionTokens,
      cachedTokens: usage.cachedTokens,
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

  // 关闭深度思考：非流式 callAI 只剩抽取 / 蒸馏这类**机械任务**，不需要推理。
  // 而 deepseek-flash 这类模型默认就会思考，把输出预算先烧在 reasoning 上 ——
  // 小预算直接返回空内容，大预算则被截断成半截 JSON。
  // 对话场景走 AI SDK（ai-sdk-service），不受此处影响。
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
        reasoning_effort: 'none',
      }),
    },
    {
      retryConfig,
      externalSignal: opts.signal,
    }
  );

  const data = await response.json() as {
    choices: Array<{ message: { content: string; role?: string }; finish_reason?: string }>;
    usage: {
      prompt_tokens: number;
      completion_tokens: number;
      prompt_tokens_details?: { cached_tokens?: number };
    };
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
      cachedTokens: data.usage.prompt_tokens_details?.cached_tokens,
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

/**
 * 老通路 JSON 抢救命中计数 —— B1 取证用。
 *
 * 剩下两个功能（extractMethodologies / distillKnowledgeCards）要不要换成 zod 严格
 * schema，取决于 repairJSON / salvageArrayItems **多久真的救一次**：命中接近 0 就
 * 直接硬迁，经常要救就说明必须给 SDK 侧留一层容错。只靠人眼翻日志数不出来，
 * 所以每次命中都把这组累计值随日志落盘（进程重启即清零，看最后一次即可）。
 */
const jsonRepairStats = { parseFailed: 0, repaired: 0, salvaged: 0, failed: 0 };

export function getJsonRepairStats(): Readonly<typeof jsonRepairStats> {
  return { ...jsonRepairStats };
}

export function extractAndParseJSON<T>(content: string, isArray: boolean): T {
  let cleaned = content.trim();

  logger.info('Raw AI response length:', { length: cleaned.length });

  const mdMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (mdMatch) {
    logger.info('Found markdown code block, extracting...');
    cleaned = mdMatch[1].trim();
  }

  const startIdx = isArray ? cleaned.indexOf('[') : cleaned.indexOf('{');

  if (startIdx === -1) {
    logger.error('Failed to extract JSON from AI response', {
      content: content.slice(0, 1000),
      isArray,
      startIdx,
    });
    throw new Error('AI响应中未找到有效的JSON格式');
  }

  const jsonStr = isArray
    ? sliceBalanced(cleaned, startIdx, '[', ']')
    : sliceBalanced(cleaned, startIdx, '{', '}');

  try {
    return JSON.parse(jsonStr) as T;
  } catch (parseError) {
    jsonRepairStats.parseFailed++;
    const originalError = parseError instanceof Error ? parseError.message : String(parseError);

    logger.warn('Initial JSON parse failed, attempting repair...', {
      error: originalError,
      jsonSnippet: jsonStr.slice(0, 300),
    });

    const repaired = repairJSON(jsonStr);

    try {
      const parsed = JSON.parse(repaired) as T;
      jsonRepairStats.repaired++;
      // 这条是"模型没一次给对"的直接证据，累计值随每行落盘
      logger.info('JSON 经 repairJSON 修复后才解析成功', { ...jsonRepairStats });
      return parsed;
    } catch {
      // 补救：数组被截断时，抢救出已完整的对象，避免整批作废
      if (isArray) {
        const salvaged = salvageArrayItems(jsonStr);
        if (salvaged.length > 0) {
          jsonRepairStats.salvaged++;
          logger.warn('JSON 被截断，已抢救出部分完整对象', {
            originalError,
            salvagedCount: salvaged.length,
            contentLength: content.length,
            ...jsonRepairStats,
          });
          return salvaged as T;
        }
      }

      jsonRepairStats.failed++;

      // 上报「原始」错误而不是修复后的错误：修复常把问题挪到别处
      // （实测出现过原始报 position 1476、修复后改报 position 22，把排查引偏）。
      // 同时落全量内容 —— 原先只留 500 字预览，看不到真正出错的位置。
      logger.error('JSON repair failed', {
        originalError,
        fullContent: content,
        fullJsonStr: jsonStr,
        repairedFull: repaired,
        ...jsonRepairStats,
      });
      throw new Error(`JSON解析失败: ${originalError}`);
    }
  }
}

/**
 * 从 openIdx 处的开括号开始，按括号配平切出完整的 JSON 片段。
 *
 * 原实现用 indexOf(open) + lastIndexOf(close) 定位，**在被截断的数组上会切错**：
 * 形如 [{...,"tags":["x"]},{...,"steps":["半截 的输入里，
 * lastIndexOf(']') 命中的是 "tags":["x"] 里的那个 ]，于是 JSON 被从中间切断，
 * 连已经完整的对象也一起丢掉。
 *
 * 这里改为字符串感知的括号配平；未闭合（确实被截断）时返回剩余全部，
 * 交给后续的修复与抢救逻辑处理。
 */
function sliceBalanced(text: string, openIdx: number, open: string, close: string): string {
  let depth = 0;
  let inString = false;
  let escapeNext = false;

  for (let i = openIdx; i < text.length; i++) {
    const ch = text[i];
    if (escapeNext) { escapeNext = false; continue; }
    if (ch === '\\') { escapeNext = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;

    if (ch === open) {
      depth++;
    } else if (ch === close) {
      depth--;
      if (depth === 0) return text.slice(openIdx, i + 1);
    }
  }
  return text.slice(openIdx);
}

/**
 * 从被截断的 JSON 数组里抢救出「已完整输出」的对象。
 *
 * 模型输出超长被 max_tokens 截断时（实测：JSON 在 "steps": [ 处戛然而止），
 * 整体解析必然失败，但前面几十个对象都是完整的 —— 丢掉整批太浪费。
 * 这里按花括号配平逐个切出顶层对象并单独解析，坏的那个跳过。
 */
function salvageArrayItems(jsonStr: string): unknown[] {
  const items: unknown[] = [];
  let depth = 0;
  let inString = false;
  let escapeNext = false;
  let start = -1;

  for (let i = 0; i < jsonStr.length; i++) {
    const ch = jsonStr[i];

    if (escapeNext) { escapeNext = false; continue; }
    if (ch === '\\') { escapeNext = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;

    if (ch === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0 && start >= 0) {
        try {
          items.push(JSON.parse(jsonStr.slice(start, i + 1)));
        } catch {
          // 单个对象坏了就跳过，不影响其余
        }
        start = -1;
      }
    }
  }
  return items;
}

/** 仅在字符串字面量「外部」才做的全角 → 半角归一（键名与分隔符位置） */
const OUTSIDE_STRING_MAP: Record<string, string> = {
  '\u201C': '"', '\u201D': '"', '\uFF02': '"',
  '\u2018': "'", '\u2019': "'",
  '\u2033': "'", '\u2032': "'", '\u00B4': "'",
  '\uFF0C': ',', '\uFF1A': ':',
  '\u3010': '[', '\u3011': ']',
  '\uFF08': '(', '\uFF09': ')',
};

export function repairJSON(jsonStr: string): string {
  // ── 第一遍：逐字符扫描，字符串字面量内部一律不改 ──
  //
  // 这里曾经先做一次无差别的 .replace(/[\u201C\u201D]/g, '"')，把中文引号也
  // 换成半角双引号，于是 value 里的「活在“此时此刻”」被改成 活在"此时此刻"，
  // 一份本来就合法的 JSON 被「修复」成了非法 JSON。
  // （中文引号在 JSON 字符串里是合法字符，根本无需转义。）
  //
  // 结构性全角引号（形如 左引号 a 右引号 冒号 左引号 b 右引号）仍会被转换：
  // 那种输入里没有半角引号，inString 始终为 false，全部走字符串外分支。
  let result = '';
  let inString = false;
  let escapeNext = false;

  for (let i = 0; i < jsonStr.length; i++) {
    const char = jsonStr[i];

    if (escapeNext) {
      result += char;
      escapeNext = false;
      continue;
    }

    if (inString && char === '\\') {
      result += char;
      escapeNext = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      result += char;
      continue;
    }

    if (inString) {
      // 字符串内部：只修非法控制字符，其余（含全角标点）原样保留，
      // 避免破坏用户可见的正文内容。
      if (char === '\n') { result += '\\n'; continue; }
      if (char === '\r') { result += '\\r'; continue; }
      if (char === '\t') { result += '\\t'; continue; }
      result += char;
      continue;
    }

    result += OUTSIDE_STRING_MAP[char] ?? char;
  }

  let repaired = result;

  // ── 第二遍：补「缺失的逗号」 ──
  //
  // LLM 最常见的 JSON 错误：一个值结束后直接换行写下个键，漏了逗号，
  // 报错正是 Expected ',' or '}' after property value。
  // 字符串内的裸换行已在第一遍转义，故此处可按行安全匹配；
  // 只吃空格与 Tab（不含换行/逗号），确保不会与已存在的逗号叠加。
  repaired = repaired.replace(/([}\]"\d]|true|false|null)([ \t]*\r?\n[ \t]*)"/g, '$1,$2"');

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

export interface ExtractedMethodology {
  name: string
  nameEn?: string
  triggerScenario?: string
  description?: string
  steps?: string[]
  outputFormat?: string
  examples?: string
  tags?: string[]
  /** AI 给出的「主要依据哪几条笔记」（提示词里的 [n] 编号，1-based） */
  sourceIndexes?: number[]
  /** 由 sourceIndexes 换算出的划线 id 列表（落库到 methodologies.source_highlight_ids） */
  sourceHighlightIds?: string[]
}

export async function extractMethodologies(
  highlights: DistillHighlight[],
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
      sourceIndexes: Array.isArray((m as Record<string, unknown>).sourceIndexes)
        ? ((m as Record<string, unknown>).sourceIndexes as unknown[])
            .map((n) => Math.round(Number(n)))
            .filter((n) => Number.isFinite(n) && n >= 1)
            .slice(0, 3)
        : undefined,
    })).map((m) => ({
      ...m,
      // 换算成真实划线 id；AI 没给或越界则为空数组，不猜
      sourceHighlightIds: (m.sourceIndexes ?? [])
        .map((i) => limitedHighlights[i - 1]?.id)
        .filter((id): id is string => Boolean(id)),
    }))

    logger.info(`Extracted ${validMethods.length} methodologies from ${highlights.length} highlights`)
    return validMethods
  } catch (error) {
    logger.error('Failed to extract methodologies', error)
    throw error
  }
}

// analyzeBookArchitecture 已删除（2026-09-16）：book_architecture 全链路是死代码
// （表 0 行、渲染层零引用），按 B11「能砍则砍」整条移除。

export interface DistilledKnowledgeCard {
  type: 'concept' | 'methodology' | 'quote'
  title: string
  content: string
  interpretation?: string
  application?: string
  tags?: string[]
  /**
   * AI 给出的「主要依据第几条笔记」（对应提示词里的 [n] 编号，1-based）。
   *
   * 2026-09-16 新增：此前提示词给每条笔记编了号，却**没让 AI 回答卡片来自哪一条**，
   * 于是 knowledge_cards.source_highlight_id 只能写死 null ——
   * 实测 90 张卡片的来源溯源全部为空，"划线 → 卡片 → 方法论"这条血缘链是断的。
   */
  sourceIndex?: number
  /**
   * 由 sourceIndex 经 `distillKnowledgeCards` 换算出的划线 id。
   * 调用方直接落库即可，不必自己处理分批的序号偏移。
   */
  sourceHighlightId?: string
}

/**
 * 把 AI 返回的批次内序号换算成真实的划线 id。
 * 分批蒸馏时每批都从 [1] 重新编号，所以必须加上该批的起始偏移。
 */
function resolveSourceHighlightId(
  batch: ReadonlyArray<{ id?: string }>,
  sourceIndex: unknown,
): string | undefined {
  const n = Math.round(Number(sourceIndex))
  if (!Number.isFinite(n) || n < 1) return undefined
  return batch[n - 1]?.id
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
  highlights: DistillHighlight[],
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

/** 蒸馏输入：多一个可选的 id，用来把卡片溯源回具体的划线 */
export type DistillHighlight = { id?: string; content: string; note?: string; chapterTitle?: string }

export async function distillKnowledgeCards(
  highlights: DistillHighlight[],
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
    const cards = await distillSingleBatch(limitedHighlights, bookTitle, signal, onProgress)
    return attachSourceHighlightIds(cards, limitedHighlights)
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
      // 每批都从 [1] 重新编号，必须在**本批内**换算成真实 id 再合并
      allCards.push(...attachSourceHighlightIds(cards, batches[i]))
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

/** 把一批卡片上的 sourceIndex 换算成真实划线 id（纯函数，便于单独测试） */
function attachSourceHighlightIds(
  cards: DistilledKnowledgeCard[],
  batch: ReadonlyArray<{ id?: string }>,
): DistilledKnowledgeCard[] {
  return cards.map((c) => ({ ...c, sourceHighlightId: resolveSourceHighlightId(batch, c.sourceIndex) }))
}

async function distillSingleBatch(
  highlights: DistillHighlight[],
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
    sourceIndex: Number.isFinite(Number(c.sourceIndex)) ? Math.round(Number(c.sourceIndex)) : undefined,
  }))

  logger.info(`Distilled ${validCards.length} knowledge cards from ${highlights.length} highlights (${durationMs}ms)`)
  return validCards
}
