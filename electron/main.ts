import { app, BrowserWindow, Menu, nativeImage, shell, NativeImage } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { initDatabase, closeDatabase, forceSaveDatabase } from './database';
import { registerIpcHandlers } from './ipc';
import { initFromSettings as initWereadSettings } from './weread-api';
import { initFromSettings as initAISettings } from './ai-service';
import { logger } from './logger';
import { settingsService } from './services/settings-service';
import { initVectorDb, createCollection } from './services/vector-db';
import { initFromAIConfig as initEmbedding } from './services/embedding-service';
import { startWereadAutoSync, stopWereadAutoSync } from './weread-sync-manager';

const isDev = !app.isPackaged;



function getPreloadPath(): string {
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

  // 如果都找不到，返回默认路径
  const defaultPath = path.join(__dirname, '../preload/index.js');
  logger.warn(`Preload not found, using default: ${defaultPath}`);
  return defaultPath;
}

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
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
      preload: getPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    show: false,
    titleBarStyle: 'default',
  });

  if (isDev) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL || 'http://localhost:5275');
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
      logger.info('Window close event - saving database');
      forceSaveDatabase();
    } catch (e) {
      logger.error('Failed to save DB on window close', e);
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
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
            mainWindow?.webContents.send('menu:syncBookshelf');
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
            mainWindow?.webContents.send('navigate', '/bookshelf');
          },
        },
        {
          label: '复习',
          accelerator: 'CmdOrCtrl+2',
          click: () => {
            mainWindow?.webContents.send('navigate', '/review');
          },
        },
        {
          label: '知识库',
          accelerator: 'CmdOrCtrl+3',
          click: () => {
            mainWindow?.webContents.send('navigate', '/knowledge-cards');
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
            mainWindow?.webContents.send('menu:about');
          },
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

app.whenReady().then(async () => {
  logger.info('App starting...');

  try {
    await initDatabase();
    registerIpcHandlers();

    const settings = settingsService.getAll();
    initWereadSettings(settings);
    initAISettings(settings);
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

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  logger.info('App quitting...');
  stopWereadAutoSync();
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
