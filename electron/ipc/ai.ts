/**
 * ipc/ai — AI 服务 / 智能体流式对话 handlers
 * 从原 ipc.ts 拆分而来，逻辑保持不变。
 * STREAM_CHAT_WITH_CONTEXT 需要访问 event.sender 推送流事件，
 * 因此使用原生 ipcMain.handle 而非统一 handle 包装器。
 */
import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../src/shared/ipc-channels';
import { withStoredApiKey } from '../../src/shared/settings-secrets';
import {
  setAIConfig,
  testConnection as testAIConnection,
} from '../ai-service';
import { setAIConfig as setAISDKConfig } from '../ai-sdk-service';
import { settingsService } from '../services/settings-service';
import { processMessageStream } from '../agent/orchestrator';
import { getIntentKeywords } from '../agent/intent-classifier';
import { getIntentStrategyMap } from '../agent/strategy-selector';
import { logger } from '../logger';
import { cancelActiveStream } from '../ai-sdk-service';
import type { HandleFn } from './types';

/** 窗口可能中途关闭/刷新：sender 已销毁时静默跳过，避免抛 "sender has been destroyed" */
function safeSend(event: Electron.IpcMainInvokeEvent, channel: string, payload: unknown): void {
  if (!event.sender.isDestroyed()) {
    event.sender.send(channel, payload);
  }
}

/**
 * 渲染层不再持有密钥原值（`SETTINGS.GET_ALL` 只回「配没配」），所以它提交的配置里
 * apiKey 可以是空的 —— 空表示"沿用已保存的那把"，由主进程从设置里补上。
 * 判定规则在 `src/shared/settings-secrets.ts`，这里只负责去设置里取真值。
 */
function withStoredKey(config: Record<string, unknown>): Record<string, unknown> {
  return withStoredApiKey(config, settingsService.get('llmKey'));
}

export function registerAIHandlers(handle: HandleFn): void {
  handle(IPC_CHANNELS.AI.SET_CONFIG, (config: Record<string, unknown>) => {
    const resolved = withStoredKey(config);
    setAIConfig(resolved as unknown as Parameters<typeof setAIConfig>[0]);
    setAISDKConfig(resolved as unknown as Parameters<typeof setAISDKConfig>[0]);
  });
  handle(IPC_CHANNELS.AI.TEST, (config: Record<string, unknown>) => testAIConnection(withStoredKey(config) as unknown as Parameters<typeof testAIConnection>[0]));

  ipcMain.handle(IPC_CHANNELS.AGENT.STREAM_CHAT_WITH_CONTEXT, async (event, params: {
    sessionId: string
    bookId?: string
    userMessage: string
    conversationHistory: Array<{ role: string; content: string }>
    enableReasoning?: boolean
  }) => {
    logger.info('IPC AGENT.STREAM_CHAT_WITH_CONTEXT received', {
      sessionId: params.sessionId,
      bookId: params.bookId,
      userMessageLength: params.userMessage?.length,
      historyLength: params.conversationHistory?.length,
      enableReasoning: params.enableReasoning,
    })
    await processMessageStream(
      {
        sessionId: params.sessionId,
        bookId: params.bookId,
        conversationHistory: params.conversationHistory ?? [],
      },
      params.userMessage,
      (chunk: string) => {
        safeSend(event, IPC_CHANNELS.STREAM.CHUNK, { chunk })
      },
      (usage) => {
        safeSend(event, IPC_CHANNELS.STREAM.COMPLETE, { usage })
      },
      (error: Error) => {
        safeSend(event, IPC_CHANNELS.STREAM.ERROR, { error: error.message })
      },
      {
        enableReasoning: params?.enableReasoning === true,
        onReasoningChunk: (chunk: string) => {
          safeSend(event, IPC_CHANNELS.STREAM.REASONING_CHUNK, { chunk })
        },
        onRetrieval: (status) => {
          safeSend(event, IPC_CHANNELS.AGENT.RETRIEVAL_STATUS, status)
        },
      }
    )

    return { success: true }
  });

  handle(IPC_CHANNELS.AGENT.CANCEL_STREAM, () => {
    const aborted = cancelActiveStream()
    logger.info('Stream cancel requested', { aborted })
    return { aborted }
  })

  // 编排页真实运行时配置：意图关键词（运行时生效版）+ 意图→策略映射
  handle(IPC_CHANNELS.AGENT.GET_PIPELINE_INFO, () => {
    return {
      intentKeywords: getIntentKeywords(),
      strategyMap: getIntentStrategyMap(),
    }
  })
}
