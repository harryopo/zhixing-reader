import { app, BrowserWindow, Menu, nativeImage, shell, dialog, NativeImage } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { initDatabase, closeDatabase, forceSaveDatabase } from './database';
import { registerIpcHandlers } from './ipc';
import { initFromSettings as initWereadSettings } from './weread-api';
import { initFromSettings as initAISettings } from './ai-service';
import { initFromSettings as initAISDKSettings, cancelActiveStream } from './ai-sdk-service';
import { logger } from './logger';
import { settingsService } from './services/settings-service';
import { initVectorDb, createCollection } from './services/vector-db';
import { initFromAIConfig as initEmbedding } from './services/embedding-service';
import { startWereadAutoSync, stopWereadAutoSync } from './weread-sync-manager';
import { knowledgeCardService } from './services/knowledge-card-service';
import { IPC_CHANNELS } from '../src/shared/ipc-channels';

const isDev = !app.isPackaged;

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

  const iconPath = path.join(__dirname, '../build/icon.png');
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
      registerIpcHandlers();

      const settings = settingsService.getAll();
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

      // 初始化本地向量数据库（Vectra，打包后可用）+ Embedding 服务
      // Vectra 是纯 TS 文件存储，不依赖外部服务，永远可用
      try {
        await initVectorDb();
        await createCollection();
        logger.info('Vectra local index initialized');

        // 初始化 Embedding 服务（仍用 OpenAI API；用户已配 llmKey）
        if (settings.llmKey) {
          initEmbedding({
            apiKey: settings.llmKey as string,
            baseUrl: (settings.llmEndpoint as string) || undefined,
          });
          logger.info('Embedding service initialized');
        } else {
          logger.warn('llmKey not configured, semantic search will be unavailable');
        }
      } catch (vectorErr) {
        logger.warn('Vectra initialization failed, RAG features disabled', vectorErr);
      }

      createMenu();
      createWindow();
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
  logger.info('App quitting...');
  stopWereadAutoSync();
  knowledgeCardService.shutdown();
  closeDatabase();
  logger.close();
});

app.on('certificate-error', (event, _webContents, _url, _error, _certificate, callback) => {
  if (isDev) {
    event.preventDefault();
    callback(true);
  } else {
    callback(false);
  }
});
