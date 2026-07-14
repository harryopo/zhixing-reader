import { net } from 'electron';
import { logger } from './logger';

export type BackoffStrategy = 'linear' | 'exponential' | 'fixed';

export interface RetryConfig {
  maxRetries: number;
  baseDelay: number;
  backoffStrategy: BackoffStrategy;
  timeout: number;
  nonRetryableStatusCodes?: number[];
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelay: 1000,
  backoffStrategy: 'linear',
  timeout: 30000,
  nonRetryableStatusCodes: [401, 403],
};

export class HttpAbortError extends Error {
  public readonly cause: 'timeout' | 'cancelled' | 'unknown';
  public readonly timeoutMs: number;

  constructor(message: string, cause: 'timeout' | 'cancelled' | 'unknown', timeoutMs: number) {
    super(message);
    this.name = 'HttpAbortError';
    this.cause = cause;
    this.timeoutMs = timeoutMs;
  }
}

export class HttpNetworkError extends Error {
  public readonly originalError: Error;
  constructor(message: string, originalError: Error) {
    super(message);
    this.name = 'HttpNetworkError';
    this.originalError = originalError;
  }
}

function isAbortErrorMessage(msg: string): boolean {
  if (!msg) return false;
  return msg.includes('aborted') || msg.includes('AbortError') || msg.includes('The operation was aborted');
}

function calculateBackoffDelay(
  attempt: number,
  baseDelay: number,
  strategy: BackoffStrategy
): number {
  switch (strategy) {
    case 'linear':
      return baseDelay * attempt;
    case 'exponential':
      return baseDelay * Math.pow(2, attempt - 1);
    case 'fixed':
      return baseDelay;
    default:
      return baseDelay * attempt;
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export interface FetchWithTimeoutOptions {
  timeoutMs: number;
  externalSignal?: AbortSignal;
  onTimeout?: (elapsedMs: number) => void;
}

export async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutOrOptions: number | FetchWithTimeoutOptions
): Promise<Response> {
  const opts: FetchWithTimeoutOptions =
    typeof timeoutOrOptions === 'number'
      ? { timeoutMs: timeoutOrOptions }
      : timeoutOrOptions;

  const { timeoutMs, externalSignal, onTimeout } = opts;

  const controller = new AbortController();
  let timedOut = false;
  let cancelled = false;

  const timeoutId = setTimeout(() => {
    timedOut = true;
    onTimeout?.(timeoutMs);
    controller.abort();
  }, timeoutMs);

  const onExternalAbort = () => {
    cancelled = true;
    controller.abort();
  };
  if (externalSignal) {
    if (externalSignal.aborted) {
      clearTimeout(timeoutId);
      throw new HttpAbortError('请求在开始前已被取消', 'cancelled', timeoutMs);
    }
    externalSignal.addEventListener('abort', onExternalAbort, { once: true });
  }

  try {
    const response = await net.fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return response;
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    const msg = err.message || String(err);

    if (cancelled) {
      throw new HttpAbortError('请求被用户取消', 'cancelled', timeoutMs);
    }
    if (timedOut) {
      throw new HttpAbortError(
        `请求超时（${Math.round(timeoutMs / 1000)}秒）: ${url}`,
        'timeout',
        timeoutMs
      );
    }
    if (isAbortErrorMessage(msg)) {
      throw new HttpAbortError(`请求被中止: ${url}（原因: ${msg}）`, 'unknown', timeoutMs);
    }

    throw new HttpNetworkError(`网络错误: ${msg}`, err);
  } finally {
    clearTimeout(timeoutId);
    if (externalSignal) {
      externalSignal.removeEventListener('abort', onExternalAbort);
    }
  }
}

export interface FetchWithRetryOptions {
  retryConfig?: Partial<RetryConfig>;
  externalSignal?: AbortSignal;
  onRetry?: (info: { attempt: number; delay: number; reason: string }) => void;
}

export async function fetchWithRetry(
  url: string,
  options: RequestInit,
  retryOrConfig: Partial<RetryConfig> | FetchWithRetryOptions = {}
): Promise<Response> {
  const isOptions = (val: unknown): val is FetchWithRetryOptions => {
    return typeof val === 'object' && val !== null && ('retryConfig' in val || 'externalSignal' in val || 'onRetry' in val);
  };

  const finalConfig: RetryConfig = {
    ...DEFAULT_RETRY_CONFIG,
    ...(isOptions(retryOrConfig) ? retryOrConfig.retryConfig : retryOrConfig),
  };
  const externalSignal = isOptions(retryOrConfig) ? retryOrConfig.externalSignal : undefined;
  const onRetry = isOptions(retryOrConfig) ? retryOrConfig.onRetry : undefined;

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= finalConfig.maxRetries; attempt++) {
    if (externalSignal?.aborted) {
      throw new HttpAbortError('请求在重试前已被取消', 'cancelled', finalConfig.timeout);
    }

    try {
      const response = await fetchWithTimeout(url, options, {
        timeoutMs: finalConfig.timeout,
        externalSignal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        const error = new Error(`HTTP ${response.status}: ${response.statusText} - ${errorText}`);

        if (finalConfig.nonRetryableStatusCodes?.includes(response.status)) {
          throw error;
        }

        if (attempt < finalConfig.maxRetries) {
          const delay = calculateBackoffDelay(
            attempt,
            finalConfig.baseDelay,
            finalConfig.backoffStrategy
          );
          logger.warn(`HTTP request failed, retrying in ${delay}ms...`, {
            url,
            status: response.status,
            attempt,
          });
          onRetry?.({ attempt, delay, reason: `HTTP ${response.status}` });
          await sleep(delay);
          lastError = error;
          continue;
        }

        throw error;
      }

      return response;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (lastError instanceof HttpAbortError && lastError.cause === 'cancelled') {
        throw lastError;
      }

      if (
        attempt < finalConfig.maxRetries &&
        !lastError.message.includes('401') &&
        !lastError.message.includes('403')
      ) {
        const delay = calculateBackoffDelay(
          attempt,
          finalConfig.baseDelay,
          finalConfig.backoffStrategy
        );
        logger.warn(`HTTP request failed, retrying in ${delay}ms...`, {
          url,
          error: lastError.message,
          attempt,
        });
        onRetry?.({ attempt, delay, reason: lastError.message });
        await sleep(delay);
        continue;
      }

      break;
    }
  }

  logger.error(
    `HTTP request failed after ${finalConfig.maxRetries} attempts: ${url}`,
    lastError
  );
  throw lastError || new Error(`HTTP request failed: ${url}`);
}

export const RETRY_CONFIGS = {
  AI_SERVICE: {
    maxRetries: 2,
    baseDelay: 1500,
    backoffStrategy: 'linear' as BackoffStrategy,
    timeout: 300000,
  },
  AI_DISTILL: {
    maxRetries: 3,
    baseDelay: 2000,
    backoffStrategy: 'exponential' as BackoffStrategy,
    timeout: 300000,
  },
  AI_LONG: {
    maxRetries: 2,
    baseDelay: 2000,
    backoffStrategy: 'exponential' as BackoffStrategy,
    timeout: 300000,
  },
  WEREAD_API: {
    maxRetries: 3,
    baseDelay: 1000,
    backoffStrategy: 'linear' as BackoffStrategy,
    timeout: 30000,
  },
};
