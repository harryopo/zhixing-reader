/**
 * ipc/ai — AI 服务 / 智能体流式对话 handlers
 * 从原 ipc.ts 拆分而来，逻辑保持不变。
 * STREAM_CHAT / STREAM_CHAT_WITH_CONTEXT 需要访问 event.sender 推送流事件，
 * 因此使用原生 ipcMain.handle 而非统一 handle 包装器。
 */
import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../src/shared/ipc-channels';
import {
  setAIConfig,
  generateCards,
  generateSummary,
  chatWithContext,
  explainHighlight,
  testConnection as testAIConnection,
  streamChat,
} from '../ai-service';
import { setAIConfig as setAISDKConfig } from '../ai-sdk-service';
import { processMessageStream } from '../agent/orchestrator';
import { getIntentKeywords } from '../agent/intent-classifier';
import { getIntentStrategyMap } from '../agent/strategy-selector';
import { logger } from '../logger';
import { cancelActiveStream } from '../ai-sdk-service';
import type { HandleFn } from './types';

export function registerAIHandlers(handle: HandleFn): void {
  handle(IPC_CHANNELS.AI.SET_CONFIG, (config: Record<string, unknown>) => {
    setAIConfig(config as unknown as Parameters<typeof setAIConfig>[0]);
    setAISDKConfig(config as unknown as Parameters<typeof setAISDKConfig>[0]);
  });
  handle(IPC_CHANNELS.AI.GENERATE_CARDS, (highlights: Array<{ content: string; note?: string }>, bookTitle: string) =>
    generateCards(highlights, bookTitle)
  );
  handle(IPC_CHANNELS.AI.GENERATE_SUMMARY, (highlights: Array<{ content: string; chapterTitle?: string }>, bookTitle: string) =>
    generateSummary(highlights, bookTitle)
  );
  handle(IPC_CHANNELS.AI.CHAT, (question: string, context: Array<{ content: string; bookTitle?: string }>) =>
    chatWithContext(question, context)
  );
  handle(IPC_CHANNELS.AI.EXPLAIN, (content: string, bookTitle: string, chapterTitle?: string) =>
    explainHighlight(content, bookTitle, chapterTitle)
  );
  handle(IPC_CHANNELS.AI.TEST, (config: Record<string, unknown>) => testAIConnection(config as unknown as Parameters<typeof testAIConnection>[0]));

  ipcMain.handle(IPC_CHANNELS.AGENT.STREAM_CHAT, async (event, params: { messages: Array<{role: string; content: string}>; enableReasoning?: boolean }) => {
    await streamChat(
      params.messages as Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
      (chunk: string) => {
        event.sender.send(IPC_CHANNELS.STREAM.CHUNK, { chunk });
      },
      (usage) => {
        event.sender.send(IPC_CHANNELS.STREAM.COMPLETE, { usage });
      },
      (error: Error) => {
        event.sender.send(IPC_CHANNELS.STREAM.ERROR, { error: error.message });
      },
      { enableReasoning: params?.enableReasoning === true }
    );

    return { success: true };
  });

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
        event.sender.send(IPC_CHANNELS.STREAM.CHUNK, { chunk })
      },
      (usage) => {
        event.sender.send(IPC_CHANNELS.STREAM.COMPLETE, { usage })
      },
      (error: Error) => {
        event.sender.send(IPC_CHANNELS.STREAM.ERROR, { error: error.message })
      },
      {
        enableReasoning: params?.enableReasoning === true,
        onReasoningChunk: (chunk: string) => {
          event.sender.send(IPC_CHANNELS.STREAM.REASONING_CHUNK, { chunk })
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
