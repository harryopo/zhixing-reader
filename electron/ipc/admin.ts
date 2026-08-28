/**
 * ipc/admin — 管理后台 handlers
 * 从原 ipc.ts 拆分而来，逻辑保持不变。
 */
import { IPC_CHANNELS } from '../../src/shared/ipc-channels';
import * as admin from '../admin';
import type { HandleFn } from './types';

export function registerAdminHandlers(handle: HandleFn): void {
  handle(IPC_CHANNELS.ADMIN.GET_STATS, () => {
    const stats = admin.getAdminStats()
    const tokenTrend = admin.getTokenUsageLast7Days()
    const recentSessions = admin.getAdminSessions().slice(0, 5)
    return { stats, tokenTrend, recentSessions }
  })
  handle(IPC_CHANNELS.ADMIN.GET_AGENT_CONFIG, () => {
    return admin.getAgentConfig()
  })
  handle(IPC_CHANNELS.ADMIN.SAVE_AGENT_CONFIG, (key: string, value: unknown) => {
    return admin.saveAgentConfig(key, value)
  })
  handle(IPC_CHANNELS.ADMIN.RESET_AGENT_CONFIG, (key: string) => {
    return admin.resetAgentConfig(key)
  })
  handle(IPC_CHANNELS.ADMIN.GET_BOOKS_WITH_COUNTS, () => {
    return admin.getBooksWithCounts()
  })
  handle(IPC_CHANNELS.ADMIN.GET_HIGHLIGHTS_BY_BOOK, (bookId: string) => {
    return admin.getHighlightsByBook(bookId)
  })
  handle(IPC_CHANNELS.ADMIN.GET_CARDS_BY_BOOK, (bookId: string) => {
    return admin.getCardsByBook(bookId)
  })
  handle(IPC_CHANNELS.ADMIN.GET_SESSIONS, () => {
    return admin.getAdminSessions()
  })
  handle(IPC_CHANNELS.ADMIN.GET_SESSION_MESSAGES, (sessionId: string) => {
    return admin.getAdminSessionMessages(sessionId)
  })
  handle(IPC_CHANNELS.ADMIN.GET_PROMPTS, () => {
    return admin.getAllAdminPrompts()
  })
  handle(IPC_CHANNELS.ADMIN.GET_PROMPT, (id: string) => {
    return admin.getAdminPrompt(id)
  })
  handle(IPC_CHANNELS.ADMIN.SAVE_PROMPT, (id: string, template: string) => {
    return admin.saveAdminPrompt(id, template)
  })
  handle(IPC_CHANNELS.ADMIN.RESET_PROMPT, (id: string) => {
    return admin.resetAdminPrompt(id)
  })
  handle(IPC_CHANNELS.ADMIN.RESET_ALL_PROMPTS, () => {
    return admin.resetAllAdminPrompts()
  })
  handle(IPC_CHANNELS.ADMIN.EXPORT_PROMPTS, () => {
    return admin.exportAdminPrompts()
  })
  handle(IPC_CHANNELS.ADMIN.IMPORT_PROMPTS, (json: string) => {
    return admin.importAdminPrompts(json)
  })
  handle(IPC_CHANNELS.ADMIN.GET_DATABASE_SCHEMA, () => {
    return admin.getDatabaseSchema()
  })
  handle(IPC_CHANNELS.ADMIN.GET_TABLE_DATA, (tableName: string, limit?: number, offset?: number) => {
    return admin.getDatabaseTableData(tableName, limit, offset)
  })
  handle(IPC_CHANNELS.ADMIN.CREATE_CUSTOM_PROMPT, (name: string, content: string) => {
    return admin.createAdminCustomPrompt(name, content)
  })
  handle(IPC_CHANNELS.ADMIN.UPDATE_CUSTOM_PROMPT, (id: string, name: string, content: string) => {
    return admin.updateAdminCustomPrompt(id, name, content)
  })
  handle(IPC_CHANNELS.ADMIN.DELETE_CUSTOM_PROMPT, (id: string) => {
    return admin.deleteAdminCustomPrompt(id)
  })
  handle(IPC_CHANNELS.ADMIN.GET_CUSTOM_PROMPTS, () => {
    return admin.getAllAdminCustomPrompts()
  })
}
