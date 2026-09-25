/**
 * ipc/chat — AI 对话会话 / 消息点赞收藏 handlers
 * 从原 ipc.ts 拆分而来，逻辑保持不变。
 */
import { conversationDb } from '../database';
import { IPC_CHANNELS } from '../../src/shared/ipc-channels';
import type { HandleFn } from './types';

export function registerChatHandlers(handle: HandleFn): void {
  handle(IPC_CHANNELS.CONVERSATIONS.CREATE, (title?: string, bookId?: string) => conversationDb.create(title, bookId));
  handle(IPC_CHANNELS.CONVERSATIONS.GET_ALL, () => conversationDb.getAll());
  handle(IPC_CHANNELS.CONVERSATIONS.DELETE, (id: string) => conversationDb.delete(id));
  handle(IPC_CHANNELS.CONVERSATIONS.ADD_MESSAGE, (conversationId: string, message: Record<string, unknown>) => conversationDb.addMessage(conversationId, message));
  handle(IPC_CHANNELS.CONVERSATIONS.DELETE_MESSAGE, (messageId: string) => conversationDb.deleteMessage(messageId));
  handle(IPC_CHANNELS.CONVERSATIONS.GET_MESSAGES, (conversationId: string) => conversationDb.getMessages(conversationId));
  handle(IPC_CHANNELS.CONVERSATIONS.GET_BOOKMARKED, (limit?: number) => conversationDb.getBookmarked(limit));

  // 聊天消息点赞 / 收藏（仅 assistant 消息）
  handle(IPC_CHANNELS.CHAT.TOGGLE_LIKE, (messageId: string, liked: boolean) => conversationDb.setLike(messageId, liked));
  handle(IPC_CHANNELS.CHAT.TOGGLE_BOOKMARK, (messageId: string, bookmarked: boolean) => conversationDb.setBookmark(messageId, bookmarked));
}
