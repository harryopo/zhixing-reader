/**
 * updater — 应用自动更新（electron-updater + GitHub Releases）
 *
 * ## 设计口径
 * - 更新源 = GitHub Releases（harryopo/zhixing-reader），feed 配置在打包时由
 *   electron-builder 按 package.json 的 build.publish 写入 app-update.yml，
 *   代码里不硬编码任何 URL。
 * - autoDownload = false：发现新版本只通知前端，由用户点「下载更新」再拉包，
 *   避免后台静默下载几百 MB 占带宽。
 * - autoInstallOnAppQuit = true：下载完成后用户不点「重启安装」，下次正常退出
 *   也会自动装上，不会白下。
 * - 开发环境（未打包）autoUpdater 不可用，check 直接返回 supported:false，
 *   前端据此显示「开发环境不支持」，绝不报错弹窗。
 *
 * ## 状态推送
 * 所有状态变化通过 IPC_CHANNELS.UPDATE.STATUS 推给渲染层（顶栏提示 + 设置页「关于」），
 * 状态机：checking → available/not-available → downloading → downloaded / error。
 * 推送是单向的、错过不补，所以同时把最后一次状态缓存下来（lastStatus），
 * 页面挂载时用 UPDATE.GET_STATUS 回读 —— 启动那次检查往往早于任何订阅者出现。
 */

import { app, BrowserWindow } from 'electron';
import { autoUpdater } from 'electron-updater';
import { IPC_CHANNELS } from '../src/shared/ipc-channels';
import { logger } from './logger';
import { shutdownForExit } from './shutdown';

export type UpdateStatusPayload =
  | { stage: 'checking' }
  | { stage: 'available'; version: string; releaseNotes?: string }
  | { stage: 'not-available'; version: string }
  | { stage: 'downloading'; percent: number; transferredMb: number; totalMb: number }
  | { stage: 'downloaded'; version: string }
  | { stage: 'error'; message: string };

let getWindow: (() => BrowserWindow | null) | null = null;
let initialized = false;

/**
 * 最后一次更新状态。
 *
 * 主→渲染是单向推送，页面没挂载时收到也等于没收到：启动那次静默检查通常发生在
 * 用户还在首页的时候，「关于」页这时才有订阅者。缓存一份让后开的页面回读，
 * 否则检查结果就永久丢了（界面上表现为「永远没有新版本」）。
 */
let lastStatus: UpdateStatusPayload | null = null;

/** 定时重查间隔：应用可以连续开好几天，只查一次会一直发现不了新版 */
export const UPDATE_RECHECK_MS = 6 * 60 * 60 * 1000;

let recheckTimer: NodeJS.Timeout | null = null;

function sendStatus(payload: UpdateStatusPayload): void {
  lastStatus = payload;
  const win = getWindow?.();
  if (win && !win.isDestroyed()) {
    win.webContents.send(IPC_CHANNELS.UPDATE.STATUS, payload);
  }
  logger.info('Update status', payload as unknown as Record<string, unknown>);
}

function stripReleaseNotes(notes: unknown): string | undefined {
  // electron-updater 的 releaseNotes 可能是 string | Array<{note}> | null
  if (typeof notes === 'string') return notes.slice(0, 2000);
  if (Array.isArray(notes)) {
    return notes
      .map((n) => (n && typeof n === 'object' && 'note' in n ? String((n as { note: unknown }).note) : ''))
      .filter(Boolean)
      .join('\n')
      .slice(0, 2000);
  }
  return undefined;
}

/** 应用启动时调用一次（仅打包环境真正生效）。 */
export function initAutoUpdater(windowGetter: () => BrowserWindow | null): void {
  if (initialized) return;
  initialized = true;
  getWindow = windowGetter;

  if (!app.isPackaged) {
    logger.info('Auto updater disabled in dev (app not packaged)');
    return;
  }

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  // GitHub 公有仓库无需 token；allowPrerelease 默认 false，只吃正式 release
  autoUpdater.allowPrerelease = false;

  autoUpdater.on('checking-for-update', () => sendStatus({ stage: 'checking' }));
  autoUpdater.on('update-available', (info) => {
    sendStatus({
      stage: 'available',
      version: info.version,
      releaseNotes: stripReleaseNotes(info.releaseNotes),
    });
  });
  autoUpdater.on('update-not-available', (info) => {
    sendStatus({ stage: 'not-available', version: info.version });
  });
  autoUpdater.on('download-progress', (p) => {
    sendStatus({
      stage: 'downloading',
      percent: Math.round(p.percent * 10) / 10,
      transferredMb: Math.round((p.transferred / 1048576) * 10) / 10,
      totalMb: Math.round((p.total / 1048576) * 10) / 10,
    });
  });
  autoUpdater.on('update-downloaded', (info) => {
    sendStatus({ stage: 'downloaded', version: info.version });
  });
  autoUpdater.on('error', (err) => {
    sendStatus({ stage: 'error', message: err?.message ?? String(err) });
  });

  // 启动后静默检查一次：有更新就推送 available 状态，不弹窗打扰
  void autoUpdater.checkForUpdates().catch((e) => {
    logger.warn('Silent update check failed', { error: String(e) });
  });

  // 应用常连着开好几天，只查一次会一直发现不了新版
  recheckTimer = setInterval(() => {
    // 下载中不打断；已下载完再查也不会改变结果
    if (lastStatus?.stage === 'downloading' || lastStatus?.stage === 'downloaded') return;
    void autoUpdater.checkForUpdates().catch((e) => {
      logger.warn('Scheduled update check failed', { error: String(e) });
    });
  }, UPDATE_RECHECK_MS);
}

/** 回读最后一次更新状态（顶栏与「关于」页挂载晚于启动检查时用）。 */
export function getUpdateStatus(): { supported: boolean; status: UpdateStatusPayload | null } {
  return { supported: app.isPackaged, status: lastStatus };
}

export function stopUpdateChecks(): void {
  if (recheckTimer) {
    clearInterval(recheckTimer);
    recheckTimer = null;
  }
}

export interface UpdateActionResult {
  supported: boolean;
  /** check 专用：是否发现新版本（仅同步可得时；异步结果仍以 STATUS 事件为准） */
  updateAvailable?: boolean;
  version?: string;
  error?: string;
}

/** 手动检查更新（设置页「检查更新」按钮）。 */
export async function checkForUpdates(): Promise<UpdateActionResult> {
  if (!app.isPackaged) {
    return { supported: false, error: '开发环境不支持自动更新，请前往 GitHub Releases 手动下载' };
  }
  try {
    const result = await autoUpdater.checkForUpdates();
    const current = app.getVersion();
    const latest = result?.updateInfo?.version;
    return {
      supported: true,
      updateAvailable: !!latest && latest !== current,
      version: latest ?? current,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    logger.error('checkForUpdates failed', { error: message });
    return { supported: true, error: message };
  }
}

/** 下载已发现的更新。 */
export async function downloadUpdate(): Promise<UpdateActionResult> {
  if (!app.isPackaged) {
    return { supported: false, error: '开发环境不支持自动更新' };
  }
  try {
    await autoUpdater.downloadUpdate();
    return { supported: true };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    logger.error('downloadUpdate failed', { error: message });
    return { supported: true, error: message };
  }
}

/**
 * 退出并安装（下载完成后调用）。
 *
 * 不能只交给 electron-updater 的 app.quit()：它先 spawn 安装进程、再把 quit 排到
 * 下一个 tick，而 quit 是异步的 —— 窗口拆除、close / before-quit 处理器都能让主进程
 * 再多活几百毫秒。NSIS 安装进程一起来就按映像名 taskkill 找「知行读书.exe」
 * （app-builder-lib 的 allowOnlyOneInstallerInstance.nsh），两边抢同一段时间窗；
 * 主进程没及时消失，安装界面就弹「知行读书 无法关闭」卡在重试框上（2026-09-21 实测撞上）。
 * 所以 spawn 返回后（安装进程已在跑）我们同步把数据落盘，再 app.exit(0) 立刻退。
 * exit 跳过 before-quit，收尾必须由 shutdownForExit() 做全。
 */
export function quitAndInstall(): UpdateActionResult {
  if (!app.isPackaged) {
    return { supported: false, error: '开发环境不支持自动更新' };
  }
  // electron-updater 没有公开的「安装包已就绪」判定：没下载完时它只会 dispatchError
  // 然后返回，那时退出等于把应用白关一次。拦在 spawn 之前。
  if (lastStatus?.stage !== 'downloaded') {
    return { supported: false, error: '尚未下载完成，暂时无法安装' };
  }
  // isSilent=false：让用户看到安装进度；isForceRunAfter=true：装完自动启动
  autoUpdater.quitAndInstall(false, true);
  shutdownForExit();
  app.exit(0);
  return { supported: true };
}
