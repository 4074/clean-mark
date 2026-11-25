'use strict';

const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  protocol,
  shell,
  nativeTheme,
  Menu,
} = require('electron');
const sharp = require('sharp');
const {
  isImageFile,
  scanFolder,
  processFolder,
  getOutputDirectory,
} = require('./processor');

const APP_NAME = '净印';
const allowedImages = new Set();
let mainWindow = null;
let activeJob = null;
let storedTheme = 'dark';
let themeFilePath = null;

function windowBackground(theme) {
  return theme === 'light' ? '#f3f5ef' : '#07080a';
}

function readStoredTheme() {
  if (!themeFilePath) return 'dark';
  try {
    const data = JSON.parse(fs.readFileSync(themeFilePath, 'utf8'));
    return data.theme === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

function persistTheme(theme) {
  if (!themeFilePath) return;
  try {
    fs.mkdirSync(path.dirname(themeFilePath), { recursive: true });
    fs.writeFileSync(themeFilePath, `${JSON.stringify({ theme }, null, 2)}\n`);
  } catch {
    // 持久化失败不影响当前会话。
  }
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'cleanimg',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
    },
  },
]);

function allowImage(filePath) {
  if (!filePath) return;
  const resolved = path.resolve(filePath);
  if (isImageFile(resolved)) allowedImages.add(resolved);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

async function handleImageRequest(request) {
  try {
    const url = new URL(request.url);
    const filePath = url.searchParams.get('path');
    if (!filePath) return new Response('Missing path', { status: 400 });

    const resolved = path.resolve(filePath);
    if (!allowedImages.has(resolved) || !isImageFile(resolved)) {
      return new Response('Not allowed', { status: 403 });
    }

    const width = clamp(Number.parseInt(url.searchParams.get('w') || '640', 10) || 640, 32, 2400);
    const buffer = await sharp(resolved, { failOn: 'none' })
      .rotate()
      .resize({ width, withoutEnlargement: true })
      .flatten({ background: '#0a0c0d' })
      .jpeg({ quality: 88, mozjpeg: true, chromaSubsampling: '4:4:4' })
      .toBuffer();

    return new Response(buffer, {
      headers: {
        'Content-Type': 'image/jpeg',
        'Cache-Control': 'public, max-age=3600',
      },
    });
  } catch {
    return new Response('Not found', { status: 404 });
  }
}

function createWindow() {
  const isMac = process.platform === 'darwin';
  const isWindows = process.platform === 'win32';
  const win = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 980,
    minHeight: 680,
    show: false,
    title: `${APP_NAME} · 图片去水印`,
    backgroundColor: windowBackground(storedTheme),
    icon: path.join(__dirname, '..', 'assets', isWindows ? 'icon.ico' : 'icon.png'),
    titleBarStyle: isMac ? 'hiddenInset' : isWindows ? 'hidden' : 'default',
    trafficLightPosition: isMac ? { x: 17, y: 25 } : undefined,
    titleBarOverlay: isWindows
      ? {
          color: windowBackground(storedTheme),
          symbolColor: storedTheme === 'light' ? '#1c2318' : '#f2f5ef',
          height: 68,
        }
      : undefined,
    autoHideMenuBar: !isMac,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  win.once('ready-to-show', () => {
    win.show();
  });

  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://')) event.preventDefault();
  });

  win.on('closed', () => {
    if (activeJob) {
      activeJob.controller.abort();
      activeJob = null;
    }
    if (mainWindow === win) mainWindow = null;
  });

  mainWindow = win;
  return win;
}

function applyTitleBarOverlay(win, theme) {
  if (process.platform !== 'win32' || !win || win.isDestroyed()) return;
  try {
    win.setTitleBarOverlay({
      color: windowBackground(theme),
      symbolColor: theme === 'light' ? '#1c2318' : '#f2f5ef',
      height: 68,
    });
  } catch {
    // 部分旧版 Windows 不支持标题栏覆盖层，忽略即可。
  }
}

function getDialogWindow(event) {
  return BrowserWindow.fromWebContents(event.sender) || mainWindow;
}

function registerIpcHandlers() {
  ipcMain.on('theme:get-sync', (event) => {
    event.returnValue = storedTheme;
  });

  ipcMain.handle('folder:choose', async (event) => {
    const result = await dialog.showOpenDialog(getDialogWindow(event), {
      title: '选择要处理的图片文件夹',
      buttonLabel: '选择文件夹',
      properties: ['openDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  ipcMain.handle('folder:scan', async (event, folderPath) => {
    if (typeof folderPath !== 'string' || !folderPath.trim()) {
      throw new Error('文件夹路径无效。');
    }
    const data = await scanFolder(folderPath);
    data.images.forEach((image) => allowImage(image.path));
    return data;
  });

  ipcMain.handle('process:start', async (event, payload) => {
    if (activeJob) throw new Error('已有一个处理任务正在进行。');
    const folderPath = payload && payload.folderPath;
    if (typeof folderPath !== 'string' || !folderPath.trim()) {
      throw new Error('请先选择文件夹。');
    }

    const sender = event.sender;
    const controller = new AbortController();
    const job = { controller, sender };
    activeJob = job;

    try {
      const scan = await scanFolder(folderPath);
      scan.images.forEach((image) => allowImage(image.path));

      if (scan.images.length === 0) {
        return {
          total: 0,
          completed: 0,
          watermarked: 0,
          noWatermark: 0,
          failed: 0,
          cancelled: false,
          outputDir: getOutputDirectory(scan.folderPath),
          durationMs: 0,
          items: [],
        };
      }

      const summary = await processFolder({
        folderPath: scan.folderPath,
        outputDir: getOutputDirectory(scan.folderPath),
        images: scan.images,
        signal: controller.signal,
        onProgress: (progress) => {
          if (progress.outputPath) allowImage(progress.outputPath);
          if (!sender.isDestroyed()) {
            sender.send('process:progress', progress);
          }
        },
      });

      summary.items.forEach((item) => allowImage(item.outputPath));
      return summary;
    } finally {
      if (activeJob === job) activeJob = null;
    }
  });

  ipcMain.handle('process:cancel', async () => {
    if (!activeJob) return false;
    activeJob.controller.abort();
    return true;
  });

  ipcMain.handle('image:info', async (event, imagePath) => {
    if (typeof imagePath !== 'string') throw new Error('图片路径无效。');
    const resolved = path.resolve(imagePath);
    if (!allowedImages.has(resolved) || !isImageFile(resolved)) {
      throw new Error('不能读取该图片。');
    }
    const stat = await fsp.stat(resolved);
    const meta = await sharp(resolved, { failOn: 'none' }).metadata();
    const orientation = meta.orientation || 1;
    const swapped = orientation >= 5 && orientation <= 8;
    return {
      width: swapped ? meta.height : meta.width,
      height: swapped ? meta.width : meta.height,
      format: meta.format,
      size: stat.size,
    };
  });

  ipcMain.handle('output:open', async (event, folderPath) => {
    if (typeof folderPath !== 'string') throw new Error('文件夹路径无效。');
    const outputDir = getOutputDirectory(folderPath);
    const error = await shell.openPath(outputDir);
    if (error) throw new Error(error);
    return outputDir;
  });

  ipcMain.handle('output:reveal', async (event, filePath) => {
    if (typeof filePath !== 'string') throw new Error('文件路径无效。');
    const resolved = path.resolve(filePath);
    if (!allowedImages.has(resolved)) throw new Error('不能定位该文件。');
    shell.showItemInFolder(resolved);
    return true;
  });

  ipcMain.handle('theme:set', async (event, theme) => {
    const next = theme === 'light' ? 'light' : theme === 'dark' ? 'dark' : null;
    if (!next) return storedTheme;
    storedTheme = next;
    nativeTheme.themeSource = next;
    persistTheme(next);
    for (const win of BrowserWindow.getAllWindows()) {
      win.setBackgroundColor(windowBackground(next));
      applyTitleBarOverlay(win, next);
    }
    return next;
  });
}

app.setName(APP_NAME);

app.whenReady().then(() => {
  themeFilePath = path.join(app.getPath('userData'), 'theme.json');
  storedTheme = readStoredTheme();
  nativeTheme.themeSource = storedTheme === 'light' ? 'light' : 'dark';

  protocol.handle('cleanimg', handleImageRequest);
  registerIpcHandlers();
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      ...(process.platform === 'darwin'
        ? [
            {
              label: APP_NAME,
              submenu: [
                { role: 'about', label: `关于 ${APP_NAME}` },
                { type: 'separator' },
                { role: 'hide', label: `隐藏 ${APP_NAME}` },
                { role: 'hideOthers', label: '隐藏其他' },
                { role: 'unhide', label: '全部显示' },
                { type: 'separator' },
                { role: 'quit', label: `退出 ${APP_NAME}` },
              ],
            },
          ]
        : []),
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
          { role: 'reload', label: '重新载入' },
          { role: 'toggleDevTools', label: '开发者工具' },
          { type: 'separator' },
          { role: 'resetZoom', label: '实际大小' },
          { role: 'zoomIn', label: '放大' },
          { role: 'zoomOut', label: '缩小' },
          { type: 'separator' },
          { role: 'togglefullscreen', label: '全屏' },
        ],
      },
      {
        label: '窗口',
        submenu: [
          { role: 'minimize', label: '最小化' },
          { role: 'zoom', label: '缩放' },
          ...(process.platform === 'darwin' ? [{ role: 'front', label: '前置全部窗口' }] : []),
        ],
      },
    ])
  );
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (activeJob) activeJob.controller.abort();
});
