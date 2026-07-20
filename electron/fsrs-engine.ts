/**
 * 知行读书 — FSRS 引擎（适配层）
 *
 * v2.0 升级：基于 ts-fsrs@5.4.1（open-spaced-repetition 官方，Anki FSRS 插件核心团队维护）。
 * 算法对齐 Anki 23.10+ 使用的 FSRS v5 (DSR) 算法；与 Anki 数据互通。
 *
 * **对外 API 100% 保持兼容**：
 * - types: Card, FSRSParameters, FSRSCardStats, VocabReviewResult
 * - enums: CardState, Rating
 * - functions: setCustomParameters, getParameters, resetParameters, cardFromDb, cardToRow,
 *   createCard, reviewCard, reviewCardBatch, getNextReviewTime, isDue, getCardInterval,
 *   getCardDaysUntilDue, getCardRetentionRate, calculateStats, getForecast,
 *   getOptimalReviewOrder, reviewVocabulary
 *
 * **内部实现**：
 * - 核心算法：ts-fsrs (FSRS v5 / DSR)
 * - 学习步骤：`['1m', '10m', '10m']`（3 步，分钟级），与原 `step=0/1/2` 语义对齐
 * - step 映射：原 step 计数"已 Good 次数"；ts-fsrs learning_steps 为"当前 step 索引"
 *   - toFsrsCard: ls = state∈{Learning,Relearning} ? step+1 : 0
 *   - fromFsrsCard: step = state==Review ? 2 : max(0, ls-1)
 * - 状态枚举：ts-fsrs 5.4.1 State/Rating 与现有完全一致（State 0/1/2/3, Rating 1/2/3/4），无需偏移
 * - 19 个 weights：ts-fsrs 默认（v5 标准），原 `w` 字段仅校验保留兼容性，实际不生效
 *
 * **reviewVocabulary**：词汇学习仍用 SM-2 混合算法（familiarityLevel/efFactor 字段非 FSRS 语义），
 * 内嵌自实现的 nextStability/nextInterval 辅助函数，未走 ts-fsrs。
 */

import {
  fsrs as createFsrs,
  generatorParameters,
  createEmptyCard,
  State as FsrsState,
  type Card as FsrsCard,
  default_w as TS_FSRS_DEFAULT_W,
} from 'ts-fsrs'

// ============================================================================
// 对外类型（保持不变）
// ============================================================================

export interface Card {
  id: string;
  highlightId: string;
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

/** 默认参数（w 用 ts-fsrs 默认 19 元素） */
const DEFAULT_PARAMETERS: FSRSParameters = {
  requestRetention: 0.9,
  maximumInterval: 36500,
  // 兼容字段：ts-fsrs 5.x 用 19 个 weights（原 API 期望 ≥ 17 元素）
  // 这里取 ts-fsrs 默认 w 的前 17 个保持 API 形状，实际算法由 ts-fsrs 用全 19 个
  w: (TS_FSRS_DEFAULT_W as readonly number[]).slice(0, 17).map((x) => x as number),
  decay: -0.5,
  factor: 19 / 81,
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
  // 保留 w 字段校验（向后兼容），实际由 ts-fsrs 内部用 19 元素
  if (!params.w || params.w.length < 17) {
    throw new Error(`Invalid weights array: must have at least 17 elements.`);
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
    // 保存用户传入的 w（用于 getParameters 返回兼容；ts-fsrs 算法仍用 19 元素默认）
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
  });
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
    highlightId: row.highlight_id as string,
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

export function createCard(highlightId: string): Card {
  const empty = createEmptyCard();
  return {
    id: `card_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    highlightId,
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

export function getForecast(cards: Card[], days: number = 30): Map<string, number> {
  const forecast = new Map<string, number>();
  const now = new Date();

  for (let i = 0; i < days; i++) {
    const date = new Date(now);
    date.setDate(date.getDate() + i);
    const dateStr = date.toISOString().split('T')[0];
    forecast.set(dateStr, 0);
  }

  for (const card of cards) {
    if (card.state === CardState.New) continue;

    const dueDate = new Date(card.due);
    const dateStr = dueDate.toISOString().split('T')[0];

    if (forecast.has(dateStr)) {
      forecast.set(dateStr, (forecast.get(dateStr) || 0) + 1);
    }
  }

  return forecast;
}

export function getOptimalReviewOrder(cards: Card[], limit: number = 20): Card[] {
  const now = new Date();

  const dueCards = cards.filter(card => isDue(card, now));

  dueCards.sort((a, b) => {
    const aRetention = getCardRetentionRate(a, now);
    const bRetention = getCardRetentionRate(b, now);

    if (Math.abs(aRetention - bRetention) > 0.1) {
      return aRetention - bRetention;
    }

    return new Date(a.due).getTime() - new Date(b.due).getTime();
  });

  return dueCards.slice(0, limit);
}

// ============================================================================
// 对外函数：词汇学习（保留原 SM-2 混合算法）
// ============================================================================

export interface VocabReviewResult {
  nextReviewAt: string
  intervalDays: number
  efFactor: number
  repetitionCount: number
  isMastered: boolean
  familiarityLevel: number
  learningStage: number
}

// reviewVocabulary 内部辅助（保留原实现，未走 ts-fsrs）
function _addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function _constrainDifficulty(d: number): number {
  return Math.min(Math.max(d, 0.1), 10);
}

function _nextIntervalVocabulary(s: number, parameters: FSRSParameters): number {
  const interval = s * (Math.pow(1 / parameters.requestRetention, 1 / parameters.decay) - 1);
  return Math.min(Math.max(Math.round(interval), 1), parameters.maximumInterval);
}

function _nextDifficultyVocabulary(d: number, r: Rating): number {
  const dClone = d;
  switch (r) {
    case Rating.Again:
      return _constrainDifficulty(dClone + 0.1);
    case Rating.Hard:
      return _constrainDifficulty(dClone + 0.2);
    case Rating.Good:
      return dClone;
    case Rating.Easy:
      return _constrainDifficulty(dClone - 0.1);
    default:
      return dClone;
  }
}

function _nextStabilityVocabulary(d: number, s: number, r: Rating, parameters: FSRSParameters): number {
  const w = parameters.w;
  const decay = parameters.decay;

  if (s === 0) {
    return w[r - 1];
  }

  const dFactor = Math.exp(w[6] * (d - 1));
  const sFactor = Math.pow(s, decay);
  const rFactor = Math.exp(w[8] * (1 - r));
  const gFactor = 1 - Math.exp(w[9] * s);

  let stability = s * (1 + dFactor * sFactor * rFactor * gFactor);

  if (r === Rating.Hard) {
    stability *= w[15];
  } else if (r === Rating.Easy) {
    stability *= w[16];
  }

  return Math.max(stability, 0.1);
}

export function reviewVocabulary(
  params: {
    efFactor: number
    intervalDays: number
    repetitionCount: number
    learningStage: number
    familiarityLevel: number
  },
  rating: Rating,
  now: Date = new Date()
): VocabReviewResult {
  const fsrsParams = getParameters()
  let { efFactor, repetitionCount, learningStage, familiarityLevel } = params

  // Map Rating to FSRS-like quality (1-4 → 1-4)
  const r = rating

  // Build a virtual Card state
  let state: CardState
  let stability = 0

  if (learningStage === 0) {
    state = CardState.New
  } else if (learningStage === 1) {
    state = CardState.Learning
  } else {
    state = CardState.Review
  }

  // Use FSRS nextStability/nextDifficulty/nextInterval
  const initialDifficulty = fsrsParams.w[2]

  if (state === CardState.New) {
    stability = fsrsParams.w[r - 1]
    const interval = 1
    const nextReview = _addDays(now, interval)

    if (r >= Rating.Good) {
      learningStage = 1
      repetitionCount = 1
    }

    return {
      nextReviewAt: r >= Rating.Good ? nextReview.toISOString() : _addDays(now, 0).toISOString(),
      intervalDays: r >= Rating.Good ? interval : 0,
      efFactor,
      repetitionCount,
      isMastered: false,
      familiarityLevel: 0,
      learningStage,
    }
  }

  if (state === CardState.Learning) {
    if (r === Rating.Again) {
      learningStage = 1
      repetitionCount = 0
      return {
        nextReviewAt: _addDays(now, 0).toISOString(),
        intervalDays: 0,
        efFactor,
        repetitionCount,
        isMastered: false,
        familiarityLevel: Math.min(2, repetitionCount),
        learningStage,
      }
    }

    if (r >= Rating.Good) {
      repetitionCount++
      if (repetitionCount >= 2) {
        // Graduate to review
        learningStage = 2
        stability = fsrsParams.w[1] // initial stability for graduated cards
        const interval = _nextIntervalVocabulary(stability, fsrsParams)
        return {
          nextReviewAt: _addDays(now, Math.max(1, interval)).toISOString(),
          intervalDays: Math.max(1, interval),
          efFactor,
          repetitionCount,
          isMastered: false,
          familiarityLevel: 3,
          learningStage,
        }
      }
      // Still learning, review in 10 min
      return {
        nextReviewAt: _addDays(now, 0).toISOString(),
        intervalDays: 0,
        efFactor,
        repetitionCount,
        isMastered: false,
        familiarityLevel: Math.min(2, repetitionCount),
        learningStage,
      }
    }

    // Hard during learning
    return {
      nextReviewAt: _addDays(now, 0).toISOString(),
      intervalDays: 0,
      efFactor,
      repetitionCount,
      isMastered: false,
      familiarityLevel: Math.min(2, repetitionCount),
      learningStage,
    }
  }

  // Review stage - full FSRS
  stability = _nextStabilityVocabulary(initialDifficulty, efFactor, r, fsrsParams)
  const _newDifficulty = _nextDifficultyVocabulary(initialDifficulty, r)
  const interval = _nextIntervalVocabulary(stability, fsrsParams)

  // Update EF (SM-2 style for backward compat)
  efFactor = efFactor + (0.1 - (5 - (r + 1)) * (0.08 + (5 - (r + 1)) * 0.02))
  efFactor = Math.max(1.3, efFactor)

  if (r === Rating.Again) {
    // Lapse - relearning
    learningStage = 1
    repetitionCount = Math.max(0, repetitionCount - 2)
    return {
      nextReviewAt: _addDays(now, 0).toISOString(),
      intervalDays: Math.max(1, Math.round(interval * 0.1)),
      efFactor,
      repetitionCount,
      isMastered: false,
      familiarityLevel: Math.max(2, Math.min(5, 2 + Math.floor(repetitionCount / 2))),
      learningStage,
    }
  }

  repetitionCount++
  const isMastered = repetitionCount >= 5 && efFactor >= 2.5 && r >= Rating.Good
  familiarityLevel = Math.min(5, 2 + Math.floor(repetitionCount / 2))

  return {
    nextReviewAt: _addDays(now, Math.max(1, interval)).toISOString(),
    intervalDays: Math.max(1, interval),
    efFactor,
    repetitionCount,
    isMastered,
    familiarityLevel,
    learningStage: 2,
  }
}
