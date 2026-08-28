/**
 * ipc/types — IPC handle 包装器与类型
 * 从原 ipc.ts 拆分而来，逻辑保持不变。
 */
import { ipcMain, IpcMainInvokeEvent } from 'electron';
import { logger } from '../logger';

export type HandleFn = (channel: string, handler: (...args: any[]) => Promise<unknown> | unknown) => void;

/** 统一 handle 包装：日志 + { success, data } / { success, error } 响应协议 */
export function createHandle(): HandleFn {
  return (channel: string, handler: (...args: any[]) => Promise<unknown> | unknown): void => {
    ipcMain.handle(channel, async (_event: IpcMainInvokeEvent, ...args: unknown[]) => {
      try {
        logger.debug(`IPC: ${channel}`, { args });
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
