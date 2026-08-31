/**
 * ipc/types — IPC handle 包装器与类型
 * 从原 ipc.ts 拆分而来，逻辑保持不变。
 */
import { ipcMain, IpcMainInvokeEvent } from 'electron';
import { logger } from '../logger';
import { IPC_CHANNELS } from '../../src/shared/ipc-channels';

export type HandleFn = (channel: string, handler: (...args: any[]) => Promise<unknown> | unknown) => void;

const SENSITIVE_SETTING_KEY = /(api[_-]?key|apikey|token|secret|cookie|password|llmkey|wereadkey)/i;

/** SETTINGS.SET(key, value) 是位置参数，键名脱敏扫不到：敏感键时直接掩盖值 */
function sanitizeIpcArgs(channel: string, args: unknown[]): unknown {
  if (
    channel === IPC_CHANNELS.SETTINGS.SET &&
    typeof args[0] === 'string' &&
    SENSITIVE_SETTING_KEY.test(args[0])
  ) {
    return { args: [args[0], '[REDACTED]'] };
  }
  return { args };
}

/** 统一 handle 包装：日志 + { success, data } / { success, error } 响应协议 */
export function createHandle(): HandleFn {
  return (channel: string, handler: (...args: any[]) => Promise<unknown> | unknown): void => {
    ipcMain.handle(channel, async (_event: IpcMainInvokeEvent, ...args: unknown[]) => {
      try {
        logger.debug(`IPC: ${channel}`, sanitizeIpcArgs(channel, args));
        const result = await handler(...args);
        return { success: true, data: result };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error(`IPC Error: ${channel}`, { error: errorMessage });
        return { success: false, error: errorMessage };
      }
    });
  };
}
