/**
 * ipc/update — 自动更新 IPC handlers
 */
import { HandleFn } from './types';
import { IPC_CHANNELS } from '../../src/shared/ipc-channels';
import { checkForUpdates, downloadUpdate, getUpdateStatus, quitAndInstall } from '../updater';

export function registerUpdateHandlers(handle: HandleFn): void {
  handle(IPC_CHANNELS.UPDATE.CHECK, () => checkForUpdates());
  handle(IPC_CHANNELS.UPDATE.DOWNLOAD, () => downloadUpdate());
  handle(IPC_CHANNELS.UPDATE.INSTALL, () => quitAndInstall());
  handle(IPC_CHANNELS.UPDATE.GET_STATUS, () => getUpdateStatus());
}
