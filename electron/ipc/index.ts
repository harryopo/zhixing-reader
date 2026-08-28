/**
 * ipc/index — IPC handlers 统一注册入口
 *
 * 原单文件 ipc.ts（950+ 行）按领域拆分至本目录，registerIpcHandlers
 * 依次调用各领域 register 函数。对外 API（registerIpcHandlers）不变。
 */
import { createHandle } from './types';
import { registerBookHandlers } from './books';
import { registerArticleHandlers } from './articles';
import { registerStatsHandlers } from './stats';
import { registerWereadHandlers } from './weread';
import { registerAIHandlers } from './ai';
import { registerChatHandlers } from './chat';
import { registerAdminHandlers } from './admin';
import { registerSettingsHandlers } from './settings';
import { registerFsrsHandlers } from './fsrs';
import { registerKnowledgeHandlers } from './knowledge';
import { logger } from '../logger';

export function registerIpcHandlers(): void {
  const handle = createHandle();

  registerBookHandlers(handle);
  registerArticleHandlers(handle);
  registerStatsHandlers(handle);
  registerWereadHandlers(handle);
  registerAIHandlers(handle);
  registerChatHandlers(handle);
  registerAdminHandlers(handle);
  registerSettingsHandlers(handle);
  registerFsrsHandlers(handle);
  registerKnowledgeHandlers(handle);

  logger.info('IPC handlers registered');
}
