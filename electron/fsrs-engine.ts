/**
 * 知行读书 — FSRS 引擎（适配层）
 *
 * v2.1 校准：基于 ts-fsrs@5.4.1（open-spaced-repetition 官方，Anki FSRS 插件核心团队维护）。
 * 该版本实现的是 **FSRS-6.0**（21 组权重参数，decay = w[20] = 0.1542），与 Anki 24.06+ 同源；与 Anki 数据互通。
 * ⚠️ 早期文档曾写"FSRS v5 / 19 参数"，与库实际实现不符，已于 2026-09-11 核验校正。
 *
 * **对外 API 与拆分前保持兼容**（唯一例外见下方函数清单备注）：
 * - types: Card, FSRSParameters, FSRSCardStats, VocabReviewResult
 * - enums: CardState, Rating
 * - functions: setCustomParameters, getParameters, resetParameters, cardFromDb, cardToRow,
 *   createCard, reviewCard, reviewCardBatch, previewReviewRatings, getNextReviewTime, isDue,
 *   getCardInterval, getCardDaysUntilDue, getCardRetentionRate, calculateStats, reviewVocabulary
 *   （原 getForecast / getOptimalReviewOrder 与 fsrs:* 两条通道一起删除 —— 渲染层零调用，
 *    复习负荷预测要真做时再按新形状重写）
 *
 * **内部实现**：
 * - 核心算法：ts-fsrs (FSRS-6.0 / DSR)
 * - 学习步骤：`['1m', '10m', '10m']`（3 步，分钟级），与原 `step=0/1/2` 语义对齐
 * - step 映射：原 step 计数"已 Good 次数"；ts-fsrs learning_steps 为"当前 step 索引"
 *   - toFsrsCard: ls = state∈{Learning,Relearning} ? step+1 : 0
 *   - fromFsrsCard: step = state==Review ? 2 : max(0, ls-1)
 * - 状态枚举：ts-fsrs 5.4.1 State/Rating 与现有完全一致（State 0/1/2/3, Rating 1/2/3/4），无需偏移
 * - 21 个 weights：ts-fsrs 默认（FSRS-6.0 标准）。原 `w` 字段为旧 API 形状保留，
 *   传入 17/19/21 元素均可（ts-fsrs 内部自动迁移到 21），其他长度抛错
 *
 * **reviewVocabulary**：词汇学习与划线卡片共用同一个 ts-fsrs 实例（FSRS-6.0 调度）。
 * `efFactor`/`familiarityLevel` 仅作为 UI 展示用的 SM-2 兼容字段保留，不再参与间隔计算。
 * 记忆状态持久化在 vocabulary 表的 stability/difficulty/lapses 三列。
 */

import {
  fsrs as createFsrs,
  generatorParameters,
  createEmptyCard,
  State as FsrsState,
  type Card as FsrsCard,
  default_w as TS_FSRS_DEFAULT_W,
  FSRS6_DEFAULT_DECAY,
} from 'ts-fsrs'
import type { ReviewSourceRef } from '../src/shared/review-sources'

/** ts-fsrs 接受的合法权重长度（17 = FSRSv4, 19 = FSRSv5, 21 = FSRS-6.0），其余长度会被库拒绝。 */
const VALID_WEIGHT_LENGTHS = [17, 19, 21] as const

// ============================================================================
// 对外类型（保持不变）
// ============================================================================

export interface Card {
  id: string;
  /**
   * 三张来源表各自一个可空字段，一张卡有且只有一个非空（cards 表用 CHECK 钉住）。
   * 划线卡来自 highlights；知识卡片卡与方法论卡是 AI 生成后由用户「加入复习」进来的。
   *
   * 读来源请用 src/shared/review-sources.ts 的 cardSourceOf()，不要自己拼 ?? ——
   * 那会把"两个来源都有值"这种坏数据悄悄读成第一个。
   */
  highlightId: string | null;
  knowledgeCardId?: string | null;
  methodologyId?: string | null;
  /**
   * 卡片属于哪本书。cards 表没有这一列，它只能从来源反查：
   * highlights.book_id / knowledge_cards.book_id / methodologies.book_id。
   * 读卡片列表时由 SQL JOIN 带出来，不带就是 undefined —— 之前首页/书架直接读
   * card.bookId，于是书名恒为「未关联书籍」、每本书的卡片数恒为 0。
   */
  bookId?: string;
  state: CardState;
  step: number;
  stability: number;
  difficulty: number;
  due: string;
  lastReview: string | null;
  elapsedDays: number;
  scheduledDays: number;
  reps: number;
  lapses: number;
}

/** 与 ts-fsrs 5.4.1 的 State 枚举值一致：New=0, Learning=1, Review=2, Relearning=3 */
export enum CardState {
  New = 0,
  Learning = 1,
  Review = 2,
  Relearning = 3,
}

/** 与 ts-fsrs 5.4.1 的 Rating.Again/Hard/Good/Easy 一致：1/2/3/4 */
export enum Rating {
  Again = 1,
  Hard = 2,
  Good = 3,
  Easy = 4,
}

export interface FSRSParameters {
  requestRetention: number;
  maximumInterval: number;
  w: number[];
  decay: number;
  factor: number;
}

export interface FSRSCardStats {
  total: number;
  newCards: number;
  learning: number;
  review: number;
  relearning: number;
  dueToday: number;
  averageStability: number;
  averageDifficulty: number;
}

// ============================================================================
// 内部：参数管理（保留兼容性 + 适配 ts-fsrs）
// ============================================================================

/**
 * 默认参数。
 *
 * ⚠️ 2026-09-11 校正：原实现把 ts-fsrs 的 21 元素默认权重 `.slice(0, 17)`（FSRS-4.5 时代的 17 参数形状），
 * 导致 `getParameters().w` 返回一个既不完整也不对应任何一版 FSRS 的数组，
 * 且 17 元素权重会被 buildFsrsInstance 静默丢弃。现直接使用库的 21 元素 FSRS-6.0 默认值。
 *
 * decay / factor 为 FSRS-6.0 遗忘曲线常数（R = (1 + factor·t/S)^decay）：
 *   decay  = -w[20] = -0.1542
 *   factor = 0.9^(1/decay) - 1 ≈ 0.9805  （满足 R(t=S) = 0.9）
 */
const DEFAULT_PARAMETERS: FSRSParameters = {
  requestRetention: 0.9,
  maximumInterval: 36500,
  w: (TS_FSRS_DEFAULT_W as readonly number[]).map((x) => x as number),
  decay: -FSRS6_DEFAULT_DECAY,
  factor: Math.pow(0.9, 1 / -FSRS6_DEFAULT_DECAY) - 1,
};

interface InternalConfig {
  requestRetention: number;
  maximumInterval: number;
  enableFuzz: boolean;
  /** 用户传入的自定义 w（仅用于 getParameters 返回兼容；不影响 ts-fsrs 算法） */
  customW: number[] | null;
}

let internalConfig: InternalConfig = {
  requestRetention: DEFAULT_PARAMETERS.requestRetention,
  maximumInterval: DEFAULT_PARAMETERS.maximumInterval,
  enableFuzz: true,
  customW: null,
};

/** 保留旧 API 校验，确保 setCustomParameters 调用方不破。 */
function validateParameters(params: FSRSParameters): void {
  if (params.requestRetention <= 0 || params.requestRetention > 1) {
    throw new Error(`Invalid requestRetention: ${params.requestRetention}. Must be between 0 and 1.`);
  }
  if (params.maximumInterval < 1) {
    throw new Error(`Invalid maximumInterval: ${params.maximumInterval}. Must be at least 1.`);
  }
  // w 长度与 ts-fsrs 的 checkParameters 对齐：只接受 17 / 19 / 21
  if (!params.w || !VALID_WEIGHT_LENGTHS.includes(params.w.length as 17 | 19 | 21)) {
    throw new Error(
      `Invalid weights array: length ${params.w?.length} is not supported. Must be 17, 19 or 21 ` +
        `(FSRSv4 / FSRSv5 / FSRS-6.0 respectively).`,
    );
  }
  for (let i = 0; i < params.w.length; i++) {
    if (typeof params.w[i] !== 'number' || isNaN(params.w[i])) {
      throw new Error(`Invalid weight at index ${i}: ${params.w[i]}.`);
    }
  }
}

export function setCustomParameters(params: Partial<FSRSParameters>): void {
  // 校验完整参数（含 w），保证旧 API 行为不变
  const merged: FSRSParameters = { ...DEFAULT_PARAMETERS, ...params };
  validateParameters(merged);
  if (params.requestRetention !== undefined) {
    internalConfig.requestRetention = params.requestRetention;
  }
  if (params.maximumInterval !== undefined) {
    internalConfig.maximumInterval = params.maximumInterval;
  }
  if (params.w !== undefined) {
    // 17 / 19 / 21 元素权重都会真正下发给 ts-fsrs（由库内部迁移到 21）。
    // 原实现只放行 ≥ 19，17/18 元素会被静默忽略 —— 传入的权重看似生效其实无效。
    internalConfig.customW = [...params.w];
  }
  // 重新创建 fsrs 引擎实例以应用新参数
  rebuildFsrsInstance();
}

export function getParameters(): FSRSParameters {
  return {
    requestRetention: internalConfig.requestRetention,
    maximumInterval: internalConfig.maximumInterval,
    w: internalConfig.customW
      ? internalConfig.customW.slice()
      : DEFAULT_PARAMETERS.w.slice(),
    decay: DEFAULT_PARAMETERS.decay,
    factor: DEFAULT_PARAMETERS.factor,
  };
}

export function resetParameters(): void {
  internalConfig = {
    requestRetention: DEFAULT_PARAMETERS.requestRetention,
    maximumInterval: DEFAULT_PARAMETERS.maximumInterval,
    enableFuzz: true,
    customW: null,
  };
  rebuildFsrsInstance();
}

// ============================================================================
// 内部：ts-fsrs 引擎实例（学习步骤配置为 3 步分钟级，与原 step 语义对齐）
// ============================================================================

/**
 * 学习步骤：3 步都是分钟级（'1m', '10m', '10m'），与原 API step=0/1/2 毕业语义匹配。
 * - 原 New+Good → step=0 (Learning, 在第 1 步)
 * - 原 Learning+Good (1st) → step=1 (Learning, 在第 2 步)
 * - 原 Learning+Good (2nd) → step=2 (Review, 毕业)
 * - 第 3 个 step 是 noop，触发毕业条件
 */
const LEARNING_STEPS = ['1m', '10m', '10m'] as const
const RELEARNING_STEPS = ['1m', '10m'] as const

let fsrsInstance = buildFsrsInstance();

function buildFsrsInstance() {
  const params = generatorParameters({
    request_retention: internalConfig.requestRetention,
    maximum_interval: internalConfig.maximumInterval,
    enable_fuzz: internalConfig.enableFuzz,
    learning_steps: [...LEARNING_STEPS],
    relearning_steps: [...RELEARNING_STEPS],
    // 把用户传入的 customW（17 / 19 / 21 元素）交给 generatorParameters，
    // 由 ts-fsrs 的 migrateParameters 负责补齐到 21 元素。
    ...(internalConfig.customW && VALID_WEIGHT_LENGTHS.includes(internalConfig.customW.length as 17 | 19 | 21)
      ? { w: [...internalConfig.customW] }
      : {}),
  } as Parameters<typeof generatorParameters>[0]);
  return createFsrs(params);
}

function rebuildFsrsInstance() {
  fsrsInstance = buildFsrsInstance();
}

// ============================================================================
// 内部：Card 转换层
// ============================================================================

/** Card → FsrsCard（去掉 id/highlightId，加 Date 类型） */
function toFsrsCard(card: Card): FsrsCard {
  // step 映射：原 step=0 (New+Good 后) → ls=1, step=1 (Learning+Good 后) → ls=2
  // state=New 或 state=Review 时 ls=0（无意义）
  let learning_steps = 0;
  if (card.state === CardState.Learning || card.state === CardState.Relearning) {
    learning_steps = card.step + 1;
  }
  return {
    due: new Date(card.due),
    stability: card.stability,
    difficulty: card.difficulty,
    elapsed_days: card.elapsedDays,
    scheduled_days: card.scheduledDays,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state as unknown as FsrsState,
    last_review: card.lastReview ? new Date(card.lastReview) : undefined,
    learning_steps,
  };
}

/** FsrsCard → Card（保留原 id/highlightId，转 Date→ISO 字符串） */
function fromFsrsCard(fsrsCard: FsrsCard, original: Card): Card {
  let step = 0;
  if (fsrsCard.state === FsrsState.Review) {
    // 已毕业，step 固定 2（原 API 语义）
    step = 2;
  } else if (fsrsCard.state === FsrsState.Learning || fsrsCard.state === FsrsState.Relearning) {
    // ts-fsrs ls: 0=Again 重置, 1=New+Good 后, 2=Learning+Good 后
    // 我们的 step: 0=刚进入学习/重置, 1=Learning+Good 1 次
    step = Math.max(0, fsrsCard.learning_steps - 1);
  }
  return {
    ...original,
    state: fsrsCard.state as unknown as CardState,
    stability: fsrsCard.stability,
    difficulty: fsrsCard.difficulty,
    due: fsrsCard.due.toISOString(),
    lastReview: fsrsCard.last_review ? fsrsCard.last_review.toISOString() : null,
    elapsedDays: fsrsCard.elapsed_days,
    scheduledDays: fsrsCard.scheduled_days,
    reps: fsrsCard.reps,
    lapses: fsrsCard.lapses,
    step,
  };
}

// ============================================================================
// 对外函数：DB 转换
// ============================================================================

export function cardFromDb(row: Record<string, unknown>): Card {
  return {
    id: row.id as string,
    highlightId: (row.highlight_id as string | null) ?? null,
    knowledgeCardId: (row.knowledge_card_id as string | null) ?? null,
    methodologyId: (row.methodology_id as string | null) ?? null,
    bookId: (row.book_id ?? row._book_id) as string | undefined,
    state: row.state as CardState,
    step: row.step as number,
    stability: row.stability as number,
    difficulty: row.difficulty as number,
    due: row.due as string,
    lastReview: row.last_review as string | null,
    elapsedDays: row.elapsed_days as number,
    scheduledDays: row.scheduled_days as number,
    reps: row.reps as number,
    lapses: row.lapses as number,
  };
}

export function cardToRow(card: Card): Record<string, unknown> {
  return {
    id: card.id,
    highlight_id: card.highlightId,
    knowledge_card_id: card.knowledgeCardId ?? null,
    methodology_id: card.methodologyId ?? null,
    state: card.state,
    step: card.step,
    stability: card.stability,
    difficulty: card.difficulty,
    due: card.due,
    last_review: card.lastReview,
    elapsed_days: card.elapsedDays,
    scheduled_days: card.scheduledDays,
    reps: card.reps,
    lapses: card.lapses,
  };
}

// ============================================================================
// 对外函数：卡片创建 + 复习
// ============================================================================

/**
 * 建一张复习卡。
 *
 * 参数可以是三种来源之一的引用，也可以直接给划线 id 字符串（历史上只有划线一种，
 * 队列里绝大多数卡至今是划线卡）。两种写法在这里一次归一，别处不再各写一遍判断。
 */
export function createCard(source: ReviewSourceRef | string): Card {
  const ref: ReviewSourceRef = typeof source === 'string' ? { kind: 'highlight', id: source } : source;
  const empty = createEmptyCard();
  return {
    id: `card_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    highlightId: ref.kind === 'highlight' ? ref.id : null,
    knowledgeCardId: ref.kind === 'knowledge_card' ? ref.id : null,
    methodologyId: ref.kind === 'methodology' ? ref.id : null,
    state: CardState.New,
    step: 0,
    stability: 0,
    difficulty: 0,
    due: empty.due.toISOString(),
    lastReview: null,
    elapsedDays: 0,
    scheduledDays: 0,
    reps: 0,
    lapses: 0,
  };
}

export function reviewCard(
  card: Card,
  rating: Rating,
  now: Date = new Date(),
  _params?: FSRSParameters,
): Card {
  const fsrsCard = toFsrsCard(card);
  // Rating 枚举值与 ts-fsrs Grade 一致（Again=1, Hard=2, Good=3, Easy=4），
  // 但类型系统不识别，需要 cast。
  const fsrsRating = rating as unknown as 1 | 2 | 3 | 4;
  const result = fsrsInstance.next(fsrsCard, now, fsrsRating);
  return fromFsrsCard(result.card, card);
}

export function reviewCardBatch(
  cards: Array<{ card: Card; rating: Rating }>,
  now: Date = new Date(),
): Card[] {
  return cards.map(({ card, rating }) => reviewCard(card, rating, now));
}

/** 四种评分对应的下次复习预览（不落库） */
export interface ReviewPreview {
  rating: Rating
  due: string
  scheduledDays: number
  state: CardState
  stability: number
  /** 人类可读间隔，如 "10 分钟" / "3 天" */
  intervalLabel: string
}

function formatIntervalLabel(dueIso: string, now: Date, scheduledDays: number): string {
  const dueMs = new Date(dueIso).getTime() - now.getTime()
  if (dueMs <= 0) return '立即'
  const minutes = Math.round(dueMs / 60_000)
  if (minutes < 60) return `${Math.max(1, minutes)} 分钟`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `${hours} 小时`
  if (scheduledDays > 0) return `${scheduledDays} 天`
  const days = Math.max(1, Math.round(hours / 24))
  return `${days} 天`
}

/**
 * 预览当前卡片在 Again/Hard/Good/Easy 四种评分下的下次 due。
 * README 4.6 / 循环工程 P2-5 承诺 API；纯函数，不改卡片状态。
 */
export function previewReviewRatings(card: Card, now: Date = new Date()): ReviewPreview[] {
  const ratings: Rating[] = [Rating.Again, Rating.Hard, Rating.Good, Rating.Easy]
  return ratings.map((rating) => {
    const next = reviewCard(card, rating, now)
    return {
      rating,
      due: next.due,
      scheduledDays: next.scheduledDays,
      state: next.state,
      stability: next.stability,
      intervalLabel: formatIntervalLabel(next.due, now, next.scheduledDays),
    }
  })
}

// ============================================================================
// 对外函数：查询 / 统计
// ============================================================================

export function getNextReviewTime(card: Card): Date {
  return new Date(card.due);
}

export function isDue(card: Card, now: Date = new Date()): boolean {
  return new Date(card.due) <= now;
}

export function getCardInterval(card: Card): number {
  return card.scheduledDays;
}

export function getCardDaysUntilDue(card: Card, now: Date = new Date()): number {
  const dueDate = new Date(card.due);
  const diffMs = dueDate.getTime() - now.getTime();
  return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
}

/** 用 ts-fsrs 的遗忘曲线计算 retention。 */
export function getCardRetentionRate(card: Card, now: Date = new Date()): number {
  if (card.stability === 0) return 0;
  // ts-fsrs forgetting_curve: (1 + FACTOR * t / 9S)^DECAY
  return fsrsInstance.get_retrievability(toFsrsCard(card), now, false) as number;
}

export function calculateStats(cards: Card[]): FSRSCardStats {
  const now = new Date();
  const nowStr = now.toISOString();

  const stats: FSRSCardStats = {
    total: cards.length,
    newCards: 0,
    learning: 0,
    review: 0,
    relearning: 0,
    dueToday: 0,
    averageStability: 0,
    averageDifficulty: 0,
  };

  let totalStability = 0;
  let totalDifficulty = 0;
  let countWithStability = 0;

  for (const card of cards) {
    switch (card.state) {
      case CardState.New:
        stats.newCards++;
        break;
      case CardState.Learning:
        stats.learning++;
        break;
      case CardState.Review:
        stats.review++;
        break;
      case CardState.Relearning:
        stats.relearning++;
        break;
    }

    if (card.due <= nowStr) {
      stats.dueToday++;
    }

    if (card.stability > 0) {
      totalStability += card.stability;
      countWithStability++;
    }

    totalDifficulty += card.difficulty;
  }

  stats.averageStability = countWithStability > 0 ? totalStability / countWithStability : 0;
  stats.averageDifficulty = cards.length > 0 ? totalDifficulty / cards.length : 0;

  return stats;
}



// ============================================================================
// 对外函数：词汇学习（与划线卡片共用 ts-fsrs / FSRS-6.0 调度）
// ============================================================================

export interface VocabReviewParams {
  efFactor: number
  intervalDays: number
  repetitionCount: number
  learningStage: number
  familiarityLevel: number
  /** FSRS-6.0 记忆稳定性（天）。为 0/缺省时按本次评分自举。 */
  stability?: number
  /** FSRS-6.0 记忆难度（1-10）。 */
  difficulty?: number
  /** 遗忘次数（ts-fsrs lapse 计数）。 */
  lapses?: number
}

export interface VocabReviewResult {
  nextReviewAt: string
  intervalDays: number
  efFactor: number
  repetitionCount: number
  /**
   * 是否"已掌握"。
   *
   * 2026-09-15 起 **恒为 false**：掌握与否由用户通过「标记已掌握」显式决定
   * （`vocabularyDb.markAsMastered`）。此前它在复习满 5 次且 efFactor ≥ 2.5 时自动置位，
   * 而 `is_mastered = 1` 会让单词被 `getDueForReview` 永久排除 ——
   * 等于"复习 5 次就再也不出现"，与 FSRS 排定的数百天后复习直接冲突。
   * 该自动毕业在为旧调度器（间隔恒为 1 天）兜底时尚可理解，现在已无必要且有害。
   */
  isMastered: boolean
  familiarityLevel: number
  learningStage: number
  /** FSRS-6.0 记忆稳定性，需持久化以便下次复习继续累积 */
  stability: number
  /** FSRS-6.0 记忆难度 */
  difficulty: number
  /** 遗忘次数 */
  lapses: number
}

function _addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

/** Rating → ts-fsrs Grade（枚举值本就一致，仅做类型收窄） */
function toGrade(rating: Rating): 1 | 2 | 3 | 4 {
  return rating as unknown as 1 | 2 | 3 | 4
}

/**
 * 自举记忆状态。
 *
 * 让 ts-fsrs 自己从空卡片推演，直接取库算出的 initial stability / difficulty，
 * 而不是在本文件里重写 FSRS-6 公式 —— 后者正是旧实现的错误来源
 * （旧 `_nextStabilityVocabulary` 把 SM-2 的 efFactor 当作记忆稳定性传入，
 *   再配一个符号写反的 interval 公式，导致词汇间隔恒为 1 天）。
 */
function bootstrapVocabularyMemory(
  now: Date,
  grade: Rating,
  repeats: number,
): { stability: number; difficulty: number; scheduledDays: number } {
  let card = createEmptyCard(now)
  let at = now
  for (let i = 0; i < Math.max(1, repeats); i++) {
    card = fsrsInstance.next(card, at, toGrade(grade)).card
    at = new Date(card.due)
  }
  return {
    stability: card.stability,
    difficulty: card.difficulty,
    scheduledDays: card.scheduled_days,
  }
}

/** 把 ts-fsrs 的 FsrsCard 归一成自举函数的返回形状（两者的字段命名不同，别混用）。 */
function toGraduationState(card: FsrsCard): {
  stability: number
  difficulty: number
  scheduledDays: number
} {
  return {
    stability: card.stability,
    difficulty: card.difficulty,
    scheduledDays: card.scheduled_days,
  }
}

/** 用 ts-fsrs（FSRS-6.0）把一次评分作用到词汇的记忆状态上。 */
function advanceVocabularyMemory(
  memory: { stability: number; difficulty: number; lapses: number; intervalDays: number; repetitionCount: number },
  grade: Rating,
  now: Date,
): FsrsCard {
  const virtual: FsrsCard = {
    due: now,
    stability: memory.stability,
    difficulty: memory.difficulty,
    elapsed_days: Math.max(0, memory.intervalDays),
    scheduled_days: Math.max(0, memory.intervalDays),
    learning_steps: 0,
    reps: Math.max(1, memory.repetitionCount),
    lapses: Math.max(0, memory.lapses),
    state: FsrsState.Review,
    last_review: memory.intervalDays > 0 ? _addDays(now, -memory.intervalDays) : undefined,
  }
  return fsrsInstance.next(virtual, now, toGrade(grade)).card
}

export function reviewVocabulary(
  params: VocabReviewParams,
  rating: Rating,
  now: Date = new Date()
): VocabReviewResult {
  let { efFactor, repetitionCount, learningStage, familiarityLevel } = params
  const intervalDays = Math.max(0, params.intervalDays || 0)
  const stability0 = params.stability ?? 0
  const difficulty0 = params.difficulty ?? 0
  let lapses = Math.max(0, params.lapses || 0)

  // Rating 1-4 直接就是 ts-fsrs 的 Grade
  const r = rating

  // Build a virtual Card state
  let state: CardState

  if (learningStage === 0) {
    state = CardState.New
  } else if (learningStage === 1) {
    state = CardState.Learning
  } else {
    state = CardState.Review
  }

  // 记忆状态：已有则沿用，没有则按本应用的学习路径自举
  // （stage 2 = 已经过 New→Learning→Learning 两次 Good 毕业）
  // ⚠️ 自举必须用**本次真实评分**，不能写死 Good —— 否则一个刚学就"完全忘记"的词
  // 会和"轻松想起"的词拿到完全相同的初始稳定性与难度（2026-09-15 集成测试抓出）。
  const memory: { stability: number; difficulty: number } =
    stability0 > 0
      ? { stability: stability0, difficulty: difficulty0 > 0 ? difficulty0 : 5 }
      : bootstrapVocabularyMemory(now, r, state === CardState.Review ? 3 : 1)

  /** 统一构造返回值，避免每处遗漏 FSRS 字段 */
  const build = (
    over: Partial<VocabReviewResult> & { nextReviewAt: string; intervalDays: number },
  ): VocabReviewResult => ({
    efFactor,
    repetitionCount,
    isMastered: false,
    familiarityLevel,
    learningStage,
    stability: memory.stability,
    difficulty: memory.difficulty,
    lapses,
    ...over,
  })

  if (state === CardState.New) {
    const interval = 1
    const nextReview = _addDays(now, interval)

    if (r >= Rating.Good) {
      learningStage = 1
      repetitionCount = 1
    }

    return build({
      nextReviewAt: r >= Rating.Good ? nextReview.toISOString() : _addDays(now, 0).toISOString(),
      intervalDays: r >= Rating.Good ? interval : 0,
      familiarityLevel: 0,
    })
  }

  if (state === CardState.Learning) {
    if (r === Rating.Again) {
      learningStage = 1
      repetitionCount = 0
      return build({
        nextReviewAt: _addDays(now, 0).toISOString(),
        intervalDays: 0,
        familiarityLevel: Math.min(2, repetitionCount),
      })
    }

    if (r >= Rating.Good) {
      repetitionCount++
      if (repetitionCount >= 2) {
        // 毕业进入 Review：由 ts-fsrs 给出首个真实间隔与记忆状态
        learningStage = 2
        // 已有记忆状态就沿用它继续推进，不能重新自举 —— 否则前面复习累积的稳定性
        // 会在毕业这一步被丢弃（2026-09-15 集成测试抓出：连续复习 stability 恒为 2.3065）。
        const graduated =
          stability0 > 0
            ? toGraduationState(
                advanceVocabularyMemory(
                  { stability: memory.stability, difficulty: memory.difficulty, lapses, intervalDays, repetitionCount },
                  Rating.Good,
                  now,
                ),
              )
            : bootstrapVocabularyMemory(now, Rating.Good, 3)
        const interval = Math.max(1, Math.round(graduated.scheduledDays))
        memory.stability = graduated.stability
        memory.difficulty = graduated.difficulty
        return build({
          nextReviewAt: _addDays(now, interval).toISOString(),
          intervalDays: interval,
          familiarityLevel: 3,
        })
      }
      // Still learning, review in 10 min
      return build({
        nextReviewAt: _addDays(now, 0).toISOString(),
        intervalDays: 0,
        familiarityLevel: Math.min(2, repetitionCount),
      })
    }

    // Hard during learning
    return build({
      nextReviewAt: _addDays(now, 0).toISOString(),
      intervalDays: 0,
      familiarityLevel: Math.min(2, repetitionCount),
    })
  }

  // Review stage —— 交给 ts-fsrs（FSRS-6.0）推进记忆状态
  const advanced = advanceVocabularyMemory(
    { stability: memory.stability, difficulty: memory.difficulty, lapses, intervalDays, repetitionCount },
    r,
    now,
  )
  memory.stability = advanced.stability
  memory.difficulty = advanced.difficulty
  const interval = Math.max(1, Math.round(advanced.scheduled_days))

  // efFactor 仅保留给 UI 展示（SM-2 语义），不再参与间隔计算
  efFactor = efFactor + (0.1 - (5 - (r + 1)) * (0.08 + (5 - (r + 1)) * 0.02))
  efFactor = Math.max(1.3, efFactor)

  if (r === Rating.Again) {
    // 遗忘：回到 relearning（今日重来），但记忆状态按 ts-fsrs 的结果保留
    learningStage = 1
    repetitionCount = Math.max(0, repetitionCount - 2)
    lapses++
    return build({
      nextReviewAt: _addDays(now, 0).toISOString(),
      intervalDays: interval,
      familiarityLevel: Math.max(2, Math.min(5, 2 + Math.floor(repetitionCount / 2))),
    })
  }

  repetitionCount++
  familiarityLevel = Math.min(5, 2 + Math.floor(repetitionCount / 2))
  // 注意 build() 默认 isMastered: false —— 见 VocabReviewResult.isMastered 的说明

  return build({
    nextReviewAt: _addDays(now, interval).toISOString(),
    intervalDays: interval,
    familiarityLevel,
    learningStage: 2,
  })
}
