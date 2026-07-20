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

export enum CardState {
  New = 0,
  Learning = 1,
  Review = 2,
  Relearning = 3,
}

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

const DEFAULT_PARAMETERS: FSRSParameters = {
  requestRetention: 0.9,
  maximumInterval: 36500,
  w: [
    0.4, 0.6, 2.4, 5.8, 4.93, 0.94, 0.86, 0.01,
    1.49, 0.14, 0.94, 2.18, 0.05, 0.34, 1.26, 0.29, 2.61,
  ],
  decay: -0.5,
  factor: 19 / 81,
};

let customParameters: FSRSParameters | null = null;

export function setCustomParameters(params: Partial<FSRSParameters>): void {
  customParameters = {
    ...DEFAULT_PARAMETERS,
    ...params,
  };
  validateParameters(customParameters);
}

export function getParameters(): FSRSParameters {
  return customParameters || DEFAULT_PARAMETERS;
}

export function resetParameters(): void {
  customParameters = null;
}

function validateParameters(params: FSRSParameters): void {
  if (params.requestRetention <= 0 || params.requestRetention > 1) {
    throw new Error(`Invalid requestRetention: ${params.requestRetention}. Must be between 0 and 1.`);
  }
  
  if (params.maximumInterval < 1) {
    throw new Error(`Invalid maximumInterval: ${params.maximumInterval}. Must be at least 1.`);
  }
  
  if (!params.w || params.w.length < 17) {
    throw new Error(`Invalid weights array: must have at least 17 elements.`);
  }
  
  for (let i = 0; i < params.w.length; i++) {
    if (typeof params.w[i] !== 'number' || isNaN(params.w[i])) {
      throw new Error(`Invalid weight at index ${i}: ${params.w[i]}.`);
    }
  }
}

function daysBetween(date1: Date, date2: Date): number {
  const diffMs = Math.abs(date2.getTime() - date1.getTime());
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function constrainDifficulty(d: number): number {
  return Math.min(Math.max(d, 0.1), 10);
}

function _meanReversion(init: number, current: number, parameter: number): number {
  return parameter * init + (1 - parameter) * current;
}

function nextInterval(s: number, parameters: FSRSParameters): number {
  const interval = s * (Math.pow(1 / parameters.requestRetention, 1 / parameters.decay) - 1);
  return Math.min(Math.max(Math.round(interval), 1), parameters.maximumInterval);
}

function nextDifficulty(d: number, r: Rating): number {
  const dClone = d;
  switch (r) {
    case Rating.Again:
      return constrainDifficulty(dClone + 0.1);
    case Rating.Hard:
      return constrainDifficulty(dClone + 0.2);
    case Rating.Good:
      return dClone;
    case Rating.Easy:
      return constrainDifficulty(dClone - 0.1);
    default:
      return dClone;
  }
}

function nextStability(d: number, s: number, r: Rating, parameters: FSRSParameters): number {
  const w = parameters.w;
  const decay = parameters.decay;
  const _factor = parameters.factor;

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

export function createCard(highlightId: string): Card {
  const now = new Date();
  return {
    id: `card_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    highlightId,
    state: CardState.New,
    step: 0,
    stability: 0,
    difficulty: DEFAULT_PARAMETERS.w[2],
    due: now.toISOString(),
    lastReview: null,
    elapsedDays: 0,
    scheduledDays: 0,
    reps: 0,
    lapses: 0,
  };
}

export function reviewCard(card: Card, rating: Rating, now: Date = new Date(), params?: FSRSParameters): Card {
  const fsrsParams = params || getParameters();
  const newCard = { ...card };

  const elapsedDays = card.lastReview
    ? daysBetween(new Date(card.lastReview), now)
    : 0;

  newCard.lastReview = now.toISOString();
  newCard.reps += 1;
  newCard.elapsedDays = elapsedDays;

  if (card.state === CardState.New) {
    newCard.state = CardState.Learning;
    newCard.step = 0;
    newCard.difficulty = fsrsParams.w[2];
    newCard.stability = fsrsParams.w[rating - 1];
  }

  if (card.state === CardState.Learning || card.state === CardState.Relearning) {
    if (rating === Rating.Again) {
      newCard.step = 0;
      newCard.lapses += 1;
      newCard.scheduledDays = 0;
      newCard.due = addDays(now, 0).toISOString();
    } else if (rating === Rating.Hard) {
      newCard.scheduledDays = 0;
      newCard.due = addDays(now, 0).toISOString();
    } else if (rating === Rating.Good) {
      newCard.step += 1;
      if (newCard.step >= 2) {
        newCard.state = CardState.Review;
        const interval = nextInterval(newCard.stability, fsrsParams);
        newCard.scheduledDays = interval;
        newCard.due = addDays(now, interval).toISOString();
      } else {
        newCard.scheduledDays = 0;
        newCard.due = addDays(now, 0).toISOString();
      }
    } else if (rating === Rating.Easy) {
      newCard.state = CardState.Review;
      newCard.stability = nextStability(newCard.difficulty, newCard.stability, rating, fsrsParams);
      const interval = nextInterval(newCard.stability, fsrsParams);
      newCard.scheduledDays = interval;
      newCard.due = addDays(now, interval).toISOString();
    }
  }

  if (card.state === CardState.Review) {
    newCard.elapsedDays = elapsedDays;
    newCard.stability = nextStability(newCard.difficulty, card.stability, rating, fsrsParams);
    newCard.difficulty = nextDifficulty(card.difficulty, rating);

    if (rating === Rating.Again) {
      newCard.lapses += 1;
      newCard.state = CardState.Relearning;
      newCard.step = 0;
      newCard.scheduledDays = 0;
      newCard.due = addDays(now, 0).toISOString();
    } else {
      const interval = nextInterval(newCard.stability, fsrsParams);
      newCard.scheduledDays = interval;
      newCard.due = addDays(now, interval).toISOString();
    }
  }

  return newCard;
}

export function reviewCardBatch(cards: Array<{ card: Card; rating: Rating }>, now: Date = new Date()): Card[] {
  const params = getParameters();
  return cards.map(({ card, rating }) => reviewCard(card, rating, now, params));
}

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

export function getCardRetentionRate(card: Card): number {
  const params = getParameters();
  if (card.stability === 0) return 0;
  
  const elapsedDays = card.lastReview 
    ? daysBetween(new Date(card.lastReview), new Date())
    : 0;
  
  return Math.exp(Math.log(params.requestRetention) * elapsedDays / card.stability);
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
    const aRetention = getCardRetentionRate(a);
    const bRetention = getCardRetentionRate(b);
    
    if (Math.abs(aRetention - bRetention) > 0.1) {
      return aRetention - bRetention;
    }
    
    return new Date(a.due).getTime() - new Date(b.due).getTime();
  });
  
  return dueCards.slice(0, limit);
}

export interface VocabReviewResult {
  nextReviewAt: string
  intervalDays: number
  efFactor: number
  repetitionCount: number
  isMastered: boolean
  familiarityLevel: number
  learningStage: number
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
  const _step = 0
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
    const nextReview = addDays(now, interval)

    if (r >= Rating.Good) {
      learningStage = 1
      repetitionCount = 1
    }
    // else stay new, review again in 1 min

    return {
      nextReviewAt: r >= Rating.Good ? nextReview.toISOString() : addDays(now, 0).toISOString(),
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
        nextReviewAt: addDays(now, 0).toISOString(),
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
        const interval = nextInterval(stability, fsrsParams)
        return {
          nextReviewAt: addDays(now, Math.max(1, interval)).toISOString(),
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
        nextReviewAt: addDays(now, 0).toISOString(),
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
      nextReviewAt: addDays(now, 0).toISOString(),
      intervalDays: 0,
      efFactor,
      repetitionCount,
      isMastered: false,
      familiarityLevel: Math.min(2, repetitionCount),
      learningStage,
    }
  }

  // Review stage - full FSRS
  stability = nextStability(initialDifficulty, efFactor, r, fsrsParams)
  const _newDifficulty = nextDifficulty(initialDifficulty, r)
  const interval = nextInterval(stability, fsrsParams)

  // Update EF (SM-2 style for backward compat)
  efFactor = efFactor + (0.1 - (5 - (r + 1)) * (0.08 + (5 - (r + 1)) * 0.02))
  efFactor = Math.max(1.3, efFactor)

  if (r === Rating.Again) {
    // Lapse - relearning
    learningStage = 1
    repetitionCount = Math.max(0, repetitionCount - 2)
    return {
      nextReviewAt: addDays(now, 0).toISOString(),
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
    nextReviewAt: addDays(now, Math.max(1, interval)).toISOString(),
    intervalDays: Math.max(1, interval),
    efFactor,
    repetitionCount,
    isMastered,
    familiarityLevel,
    learningStage: 2,
  }
}
