import { app, BrowserWindow, Menu, nativeImage, shell, dialog, NativeImage } from 'electron';
// 必须排在其它本地 import 之前：它负责把开发版的 userData 换到独立目录，
// 而 logger / settings-service 在模块加载期就会读这个路径。
import { isDev } from './user-data';
import * as path from 'path';
import * as fs from 'fs';
import { initDatabase, forceSaveDatabase } from './database';
import { registerIpcHandlers } from './ipc';
import { initFromSettings as initWereadSettings } from './weread-api';
import { initFromSettings as initAISettings } from './ai-service';
import { initFromSettings as initAISDKSettings, cancelActiveStream } from './ai-sdk-service';
import { logger } from './logger';
import { settingsService } from './services/settings-service';
import { getDatabase } from './database/connection';
import { initRepositoryFactory } from './repositories';
import { startWereadAutoSync } from './weread-sync-manager';
import { runStartupRepair } from './services/startup-repair';
import { initAutoUpdater, stopUpdateChecks } from './updater';
import { shutdownForExit } from './shutdown';
import { IPC_CHANNELS } from '../src/shared/ipc-channels';

// 开发环境启用 CDP 调试端口（供截图脚本使用）
if (isDev) {
  app.commandLine.appendSwitch('remote-debugging-port', '9222');
  app.commandLine.appendSwitch('remote-allow-origins', '*');
}

// 进程级兜底：运行时未捕获异常只记日志，不静默丢失
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection', { reason: String(reason) });
});

process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception', { error: String(error?.stack || error) });
});

function getPreloadPath(): string | null {
  // 尝试多个可能的路径
  const possiblePaths = [
    path.join(__dirname, '../preload/index.js'),       // 生产模式
    path.join(__dirname, '../../dist/preload/index.js'), // 开发模式（electron-vite）
    path.join(__dirname, '../dist/preload/index.js'),    // 备选
  ];

  for (const preloadPath of possiblePaths) {
    logger.info(`Checking preload path: ${preloadPath}`);
    if (fs.existsSync(preloadPath)) {
      logger.info(`Found preload at: ${preloadPath}`);
      return preloadPath;
    }
  }

  logger.error('Preload script not found in any candidate path');
  return null;
}

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  const preloadPath = getPreloadPath();
  if (!preloadPath) {
    // 缺 preload 会导致 window.electronAPI 为 undefined，渲染层首次 IPC 即崩；
    // 明确报错退出，胜过带病运行
    dialog.showErrorBox('知行读书启动失败', '未找到预加载脚本，请重新安装应用。');
    app.quit();
    return;
  }

  // 打包后 extraResources 会把 resources/icon.png 复制到 <app>/resources/icon.png；
  // 开发态 __dirname = <root>/dist/main，故上溯两级取仓库内的 resources/icon.png。
  // 原实现指向 ../build/icon.png，该路径在任何模式下都不存在，窗口图标一直是缺省值。
  const iconPath = app.isPackaged
    ? path.join(process.resourcesPath, 'icon.png')
    : path.join(__dirname, '../../resources/icon.png');
  let icon: NativeImage | undefined;
  try {
    icon = nativeImage.createFromPath(iconPath);
  } catch {
    logger.warn('App icon not found, using default');
  }

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    icon,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    show: false,
    titleBarStyle: 'default',
  });

  if (isDev) {
    // 强制使用 5500 端口（electron.vite.config.ts 中配置）
    // 不使用 VITE_DEV_SERVER_URL 环境变量，因为它可能被缓存为旧值
    mainWindow.loadURL('http://127.0.0.1:5500');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
    logger.info('Main window shown');
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // 数据保护：用户直接点窗口 X 关闭时立即保存数据库，
  // 双保险 - 即使 before-quit 没来得及触发也不丢数据
  mainWindow.on('close', () => {
    try {
      // 先中止进行中的 AI 流，避免窗口销毁后 sender.send 抛错且网络请求继续烧 token
      cancelActiveStream();
      logger.info('Window close event - saving database');
      forceSaveDatabase();
    } catch (e) {
      logger.error('Failed to save DB on window close', e);
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // 与 SYSTEM.OPEN_EXTERNAL handler 同款白名单：仅放行 http(s) / weread 深链
    if (/^(https?:|weread:)/i.test(url)) {
      void shell.openExternal(url);
    } else {
      logger.warn('Blocked window.open with disallowed protocol', { url });
    }
    return { action: 'deny' };
  });
}

function createMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: '文件',
      submenu: [
        {
          label: '同步书架',
          accelerator: 'CmdOrCtrl+S',
          click: () => {
            mainWindow?.webContents.send(IPC_CHANNELS.MENU.SYNC_BOOKSHELF);
          },
        },
        { type: 'separator' },
        {
          label: '退出',
          accelerator: 'CmdOrCtrl+Q',
          click: () => {
            app.quit();
          },
        },
      ],
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' },
      ],
    },
    {
      label: '视图',
      submenu: [
        {
          label: '书架',
          accelerator: 'CmdOrCtrl+1',
          click: () => {
            mainWindow?.webContents.send(IPC_CHANNELS.MENU.NAVIGATE, '/bookshelf');
          },
        },
        {
          label: '复习',
          accelerator: 'CmdOrCtrl+2',
          click: () => {
            mainWindow?.webContents.send(IPC_CHANNELS.MENU.NAVIGATE, '/review');
          },
        },
        {
          label: '知识库',
          accelerator: 'CmdOrCtrl+3',
          click: () => {
            mainWindow?.webContents.send(IPC_CHANNELS.MENU.NAVIGATE, '/knowledge-cards');
          },
        },
        { type: 'separator' },
        { role: 'reload', label: '刷新' },
        { role: 'toggleDevTools', label: '开发者工具' },
        { type: 'separator' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { role: 'resetZoom', label: '重置缩放' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '全屏' },
      ],
    },
    {
      label: '帮助',
      submenu: [
        {
          label: '关于',
          click: () => {
            mainWindow?.webContents.send(IPC_CHANNELS.MENU.ABOUT);
          },
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

// 单实例锁：sql.js 内存数据库不支持多实例并发写同一库文件，
// 第二个实例启动时聚焦已有窗口并退出
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  void app.whenReady().then(async () => {
    logger.info('App starting...');

    try {
      await initDatabase();

      // Repository 工厂必须在任何 getRepositories() 调用之前初始化。
      // 此前全项目从未调用过 initRepositoryFactory，导致 getRepositories() 恒抛
      // 'RepositoryFactory not initialized' —— RAG 的关键词回退（keywordSearch）
      // 与用户画像服务（6 处调用）因此全部静默失败，书籍上下文永远是空的。
      initRepositoryFactory(getDatabase);

      registerIpcHandlers();

      // 历史明文密钥一次性搬进加密存储（必须在读设置之前：否则这一轮启动仍然
      // 用着明文，界面也说不清到底加密了没有）。搬不动就留着，不丢用户的 key。
      const secretsMigration = settingsService.migratePlainSecrets();
      if (secretsMigration.migrated.length > 0) {
        logger.info('Migrated plaintext secrets to encrypted storage', {
          keys: secretsMigration.migrated,
        });
      }
      if (secretsMigration.keptPlaintext.length > 0) {
        logger.error('System encryption unusable; these secrets stay in plaintext settings.json', {
          keys: secretsMigration.keptPlaintext,
        });
      }

      const settings = settingsService.getAll();

      // 记录本机是否真的能用系统加密（false 时密钥是明文存在 settings.json 里的）。
      // 渲染层读这个键，在 AI 配置页 / 微信读书页如实提示用户。
      settingsService.set('secureStorageAvailable', settingsService.isEncryptionAvailable());

      initWereadSettings(settings);
      initAISettings(settings);
      initAISDKSettings(settings);
      logger.info('Settings loaded and applied');

      // 启动微信读书自动同步定时器（如 settings.wereadAutoSync=true 且已配置 wereadApiKey）
      try {
        startWereadAutoSync();
      } catch (e) {
        logger.warn('Failed to start WeRead auto-sync timer', e);
      }

      // 向量语义检索已于 2026-09-16 整套移除（Vectra + embeddings）：
      // 用户的 AI 服务商没有 /embeddings 接口，索引自始至终是空的（79 字节 / 0 条向量），
      // 而它的失败是静默的 —— AI 带着零条书籍上下文回答，日志还写着"用了语义检索"。
      // 现在书籍上下文走本地 BM25 检索（services/rag-service.ts → src/shared/retrieval.ts），
      // 不需要任何初始化，也不需要网络。

      createMenu();
      createWindow();

      // 自动更新（electron-updater）：仅打包环境生效；启动后静默检查一次，
      // 发现新版本只推状态给渲染层，下载由用户在「设置 → 关于」手动触发
      initAutoUpdater(() => mainWindow);

      // 启动后自动修复历史数据缺口（卡片来源 / 划线章节名 / 阅读时长）。
      // 不 await：后两项要走微信读书网络，不能拖慢窗口出现。详见 services/startup-repair.ts
      void runStartupRepair();
    } catch (error) {
      logger.error('Failed to initialize app', error);
      app.quit();
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  stopUpdateChecks();
  shutdownForExit();
});

app.on('certificate-error', (event, _webContents, _url, _error, _certificate, callback) => {
  if (isDev) {
    event.preventDefault();
    callback(true);
  } else {
    callback(false);
  }
});
