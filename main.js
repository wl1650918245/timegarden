const path = require('path');
const fs = require('fs');

// 检测并绕过 ELECTRON_RUN_AS_NODE 环境变量
if (process.env.ELECTRON_RUN_AS_NODE && process.env.ELECTRON_RUN_AS_NODE !== '') {
  const { spawn } = require('child_process');
  const electronPath = path.join(__dirname, 'node_modules', 'electron', 'dist', 'electron.exe');
  const cleanEnv = { ...process.env };
  delete cleanEnv.ELECTRON_RUN_AS_NODE;
  // 用 __dirname 作为启动目录，带上原始 Electron 参数
  const child = spawn(electronPath, [__dirname, '--no-sandbox'], {
    stdio: 'inherit',
    env: cleanEnv
  });
  child.on('exit', (code) => process.exit(code));
  return;
}

const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, screen } = require('electron');

// GPU 崩溃防护：因 Electron 35 在部分 Windows 显卡驱动下 GPU 进程不稳定，
// 默认禁用硬件加速确保稳定性。应用以 SVG 为主，软件渲染性能完全够用。
// 如需开启 GPU 加速，启动时加 --enable-gpu 参数。
if (!process.argv.includes('--enable-gpu')) {
  app.commandLine.appendSwitch('disable-gpu');
}

let mainWindow = null;
let tray = null;
let isQuitting = false;
let isFullMode = false;
let isNanoMode = false;
let isHoverTransition = false;  // 悬停扩展期间不保存窗口状态
let nanoBaseX = null;           // 悬停前原始位置 X
let nanoBaseY = null;           // 悬停前原始位置 Y
let nanoBaseW = null;           // 悬停前原始宽度（专注模式可能是 240）
let nanoBaseH = null;           // 悬停前原始高度

// ---- 窗口尺寸 ----
const MINI_W = 360;
const MINI_H = 310;
const FULL_W = 720;
const FULL_H = 520;
const NANO_W = 48;
const NANO_H = 68;
const NANO_FOCUS_W = 240;
const NANO_FOCUS_H = 60;
const NANO_HOVER_W = 230;
const NANO_HOVER_H = 270;

// ---- 数据存储 ----
const DATA_DIR = path.join(__dirname, 'user-data');

function getDataDir() {
  const dir = path.join(DATA_DIR, 'data');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getHistoryDir() {
  const dir = path.join(getDataDir(), 'history');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getDataPath() { return path.join(getDataDir(), 'current.json'); }
function getHistoryPath(weekKey) { return path.join(getHistoryDir(), `${weekKey}.json`); }
function getWindowStatePath() { return path.join(DATA_DIR, 'window-state.json'); }

function getWeekKey(date) {
  const d = new Date(date);
  const dayNum = d.getDay() || 7;           // 1=Mon … 7=Sun
  d.setDate(d.getDate() + 4 - dayNum);      // 推到该周四
  const yearStart = new Date(d.getFullYear(), 0, 1);
  const weekNum = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return `${d.getFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}

// ---- 屏幕位置计算 ----
function getMiniBounds() {
  const workArea = screen.getPrimaryDisplay().workArea;
  const saved = loadWindowState();
  if (saved && saved.mode === 'mini' && saved.x !== undefined) {
    return { width: saved.width || MINI_W, height: saved.height || MINI_H, x: saved.x, y: saved.y };
  }
  return { width: MINI_W, height: MINI_H, x: workArea.x + workArea.width - MINI_W - 20, y: workArea.y + 20 };
}

function getFullBounds() {
  const workArea = screen.getPrimaryDisplay().workArea;
  const saved = loadWindowState();
  if (saved && saved.mode === 'full' && saved.x !== undefined) {
    return { width: saved.width || FULL_W, height: saved.height || FULL_H, x: saved.x, y: saved.y };
  }
  return {
    width: FULL_W, height: FULL_H,
    x: workArea.x + Math.round((workArea.width - FULL_W) / 2),
    y: workArea.y + Math.round((workArea.height - FULL_H) / 3)
  };
}

function getNanoBounds() {
  const workArea = screen.getPrimaryDisplay().workArea;
  const saved = loadWindowState();
  if (saved && saved.mode === 'nano' && saved.x !== undefined) {
    return { width: NANO_W, height: NANO_H, x: saved.x, y: saved.y };
  }
  return {
    width: NANO_W, height: NANO_H,
    x: workArea.x + workArea.width - NANO_W - 4,
    y: workArea.y + Math.round((workArea.height - NANO_H) / 2)
  };
}

function getNanoHoverBounds() {
  const workArea = screen.getPrimaryDisplay().workArea;
  const saved = loadWindowState();
  // 保持花在屏幕上的位置不变，扩展窗口
  const nanoX = saved && saved.mode === 'nano' && saved.x !== undefined
    ? saved.x
    : workArea.x + workArea.width - NANO_W - 4;
  const nanoY = saved && saved.mode === 'nano' && saved.y !== undefined
    ? saved.y
    : workArea.y + Math.round((workArea.height - NANO_H) / 2);
  // 右下角对齐：扩展后花的右上角屏幕位置不变
  return {
    width: NANO_HOVER_W, height: NANO_HOVER_H,
    x: nanoX + NANO_W - NANO_HOVER_W,
    y: nanoY + Math.round((NANO_H - NANO_HOVER_H) / 2)
  };
}

function loadWindowState() {
  const statePath = getWindowStatePath();
  try {
    if (fs.existsSync(statePath)) return JSON.parse(fs.readFileSync(statePath, 'utf-8'));
  } catch(e) {}
  return null;
}

function saveWindowState() {
  if (!mainWindow) return;
  if (isHoverTransition) return;  // 悬停扩展期间不保存，避免位置漂移
  const bounds = mainWindow.getBounds();
  // 专注模式下，保存原始 Nano 坐标（而非 240×60 的坐标）
  const saveX = isNanoFocusMode && nanoFocusBaseX !== null ? nanoFocusBaseX : bounds.x;
  const saveY = isNanoFocusMode && nanoFocusBaseY !== null ? nanoFocusBaseY : bounds.y;
  fs.writeFileSync(getWindowStatePath(), JSON.stringify({
    mode: isFullMode ? 'full' : isNanoMode ? 'nano' : 'mini',
    x: saveX, y: saveY, width: bounds.width, height: bounds.height
  }));
}

// ---- IPC 通信 ----
ipcMain.handle('load-data', () => {
  const dataPath = getDataPath();
  try {
    if (fs.existsSync(dataPath)) {
      return JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
    }
  } catch (e) {
    console.error('加载数据失败:', e);
  }
  return { weekKey: getWeekKey(new Date()), important: [], todos: [] };
});

ipcMain.handle('save-data', (_, data) => {
  try {
    fs.writeFileSync(getDataPath(), JSON.stringify(data, null, 2));
    return true;
  } catch (e) {
    console.error('保存数据失败:', e);
    return false;
  }
});

ipcMain.handle('archive-week', (_, { weekKey, data }) => {
  try {
    fs.writeFileSync(getHistoryPath(weekKey), JSON.stringify(data, null, 2));
    // 归档成功后才重置当前数据
    const newWeekKey = getWeekKey(new Date());
    const resetData = { weekKey: newWeekKey, important: [], todos: [] };
    fs.writeFileSync(getDataPath(), JSON.stringify(resetData, null, 2));
    return resetData;
  } catch (e) {
    console.error('归档数据失败:', e);
    return null;  // 返回 null 表示失败，渲染端不重置
  }
});

ipcMain.handle('check-new-week', (_, currentWeekKey) => {
  const actualWeekKey = getWeekKey(new Date());
  return { isNewWeek: currentWeekKey !== actualWeekKey, actualWeekKey };
});

ipcMain.handle('load-history', (_, weekKey) => {
  const histPath = getHistoryPath(weekKey);
  if (fs.existsSync(histPath)) return JSON.parse(fs.readFileSync(histPath, 'utf-8'));
  return null;
});

ipcMain.handle('list-history-weeks', () => {
  const dir = getHistoryDir();
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
  return files.map(f => f.replace('.json', '')).sort();
});

ipcMain.handle('get-screen-info', () => {
  const workArea = screen.getPrimaryDisplay().workArea;
  return { width: workArea.width, height: workArea.height };
});

// ---- 窗口控制 ----
ipcMain.on('minimize-window', () => { if (mainWindow) mainWindow.minimize(); });
ipcMain.on('close-window', () => { if (mainWindow) mainWindow.hide(); });

ipcMain.handle('toggle-panel', () => {
  if (!mainWindow) return;
  if (isNanoMode) {
    isNanoMode = false;
    isFullMode = false;
    mainWindow.setBounds(getMiniBounds(), false);
    return false;
  }
  isFullMode = !isFullMode;
  const bounds = isFullMode ? getFullBounds() : getMiniBounds();
  mainWindow.setBounds(bounds, false);
  return isFullMode;
});

ipcMain.handle('collapse-panel', () => {
  if (!mainWindow || !isFullMode) return false;
  isFullMode = false;
  mainWindow.setBounds(getMiniBounds(), false);
  return true;
});

// 直接设置窗口模式（不依赖翻转状态，避免主从不同步）
ipcMain.handle('set-mode', (_, mode) => {
  if (!mainWindow) return;
  isNanoMode = false;
  isFullMode = false;
  isNanoFocusMode = false;      // 切出 Nano 时清除专注状态
  nanoFocusBaseX = null;        // 清除专注锚点
  nanoFocusBaseY = null;
  if (mode === 'nano') {
    isNanoMode = true;
    mainWindow.setResizable(false);
    mainWindow.setBounds(getNanoBounds(), false);
  } else if (mode === 'full') {
    isFullMode = true;
    mainWindow.setResizable(true);
    mainWindow.setMinimumSize(480, 360);
    mainWindow.setBounds(getFullBounds(), false);
  } else {
    mainWindow.setResizable(true);
    mainWindow.setMinimumSize(280, 240);
    mainWindow.setBounds(getMiniBounds(), false);
  }  // mini
  return mode;
});

// ---- Nano 模式 IPC ----
ipcMain.handle('toggle-nano', () => {
  if (!mainWindow) return;
  if (isNanoMode) {
    // nano → mini
    isNanoMode = false;
    mainWindow.setBounds(getMiniBounds(), false);
    return 'mini';
  } else if (isFullMode) {
    // full → nano
    isFullMode = false;
    isNanoMode = true;
    mainWindow.setBounds(getNanoBounds(), false);
    return 'nano';
  } else {
    // mini → nano
    isFullMode = false;
    isNanoMode = true;
    mainWindow.setBounds(getNanoBounds(), false);
    return 'nano';
  }
});

ipcMain.handle('set-nano-mode', (_, active) => {
  if (!mainWindow) return;
  isNanoMode = active;
  const bounds = active ? getNanoBounds() : getMiniBounds();
  mainWindow.setBounds(bounds, false);
  return active;
});

ipcMain.handle('nano-hover', (_, hovering) => {
  if (!mainWindow || !isNanoMode) return;

  if (hovering) {
    // 已展开时不重复设锚点
    if (nanoBaseX !== null) return;
    // 保存当前窗口位置作为锚点
    const current = mainWindow.getBounds();
    nanoBaseX = current.x;
    nanoBaseY = current.y;
    // 记住原始尺寸，用于恢复
    nanoBaseW = current.width;
    nanoBaseH = current.height;
    // 扩展窗口：右键保持窗口右侧不变，向左上扩展
    const rightEdge = current.x + current.width;
    isHoverTransition = true;
    mainWindow.setBounds({
      width: NANO_HOVER_W,
      height: NANO_HOVER_H,
      x: rightEdge - NANO_HOVER_W,
      y: nanoBaseY + Math.round((current.height - NANO_HOVER_H) / 2)
    }, false);
    isHoverTransition = false;
  } else {
    // 恢复到原始位置和尺寸
    if (nanoBaseX !== null && nanoBaseY !== null) {
      const restoreW = nanoBaseW || NANO_W;
      const restoreH = nanoBaseH || NANO_H;
      isHoverTransition = true;
      mainWindow.setBounds({
        width: restoreW,
        height: restoreH,
        x: nanoBaseX,
        y: nanoBaseY
      }, false);
      isHoverTransition = false;
      nanoBaseX = null;
      nanoBaseY = null;
      nanoBaseW = null;
      nanoBaseH = null;
    }
  }
});

// 专注模式：Nano 窗口扩展到专注条，支持自由缩放
let isNanoFocusMode = false;
let nanoFocusBaseX = null;
let nanoFocusBaseY = null;
let nanoFocusSavedW = null;  // 用户拖拽后的自定义专注宽度
let nanoFocusSavedH = null;  // 用户拖拽后的自定义专注高度

ipcMain.handle('nano-focus-mode', (_, active, suggestedWidth) => {
  if (!mainWindow) return;
  if (active && isNanoFocusMode) return;

  if (active) {
    if (!isNanoMode) return;  // 只在 Nano 模式进入专注
    const current = mainWindow.getBounds();
    nanoFocusBaseX = current.x;
    nanoFocusBaseY = current.y;
    // 优先使用建议宽度（根据任务名计算），其次用户拖拽保存的，最后默认值
    const baseW = suggestedWidth || nanoFocusSavedW || NANO_FOCUS_W;
    const focusW = Math.max(180, Math.min(440, baseW));
    const focusH = nanoFocusSavedH || NANO_FOCUS_H;
    isHoverTransition = true;
    mainWindow.setBounds({
      width: focusW, height: focusH,
      x: nanoFocusBaseX + NANO_W - focusW,
      y: nanoFocusBaseY + Math.round((NANO_H - focusH) / 2)
    }, false);
    isHoverTransition = false;
    mainWindow.setResizable(true);
    mainWindow.setMinimumSize(160, 56);
    isNanoFocusMode = true;
  } else {
    // 保存用户拖拽后的自定义尺寸
    if (isNanoFocusMode) {
      const bounds = mainWindow.getBounds();
      if (bounds.width !== NANO_FOCUS_W) nanoFocusSavedW = bounds.width;
      if (bounds.height !== NANO_FOCUS_H) nanoFocusSavedH = bounds.height;
    }
    // 缩回普通 Nano：仅当窗口宽度 < 500（非 Full/Mini 模式）
    const cur = mainWindow.getBounds();
    if (cur.width < 500) {
      const rightEdge = cur.x + cur.width;
      isHoverTransition = true;
      mainWindow.setBounds({
        width: NANO_W, height: NANO_H,
        x: rightEdge - NANO_W,
        y: cur.y + Math.round((cur.height - NANO_H) / 2)
      }, false);
      isHoverTransition = false;
    }
    nanoFocusBaseX = null;
    nanoFocusBaseY = null;
    if (cur.width < 500) mainWindow.setResizable(false);
    isNanoFocusMode = false;
  }
});

// 强制缩回普通 Nano 尺寸（无任何守卫）
ipcMain.handle('nano-shrink', () => {
  if (!mainWindow) return;
  const cur = mainWindow.getBounds();
  const rightEdge = cur.x + cur.width;
  mainWindow.setBounds({
    width: NANO_W, height: NANO_H,
    x: rightEdge - NANO_W,
    y: cur.y + Math.round((cur.height - NANO_H) / 2)
  }, false);
  mainWindow.setResizable(false);
  isNanoFocusMode = false;
});

ipcMain.handle('nano-drag', (_, { dx, dy }) => {
  if (!mainWindow) return;
  const bounds = mainWindow.getBounds();
  mainWindow.setBounds({ x: bounds.x + dx, y: bounds.y + dy }, false);
  // 拖动后更新锚点，确保后续 hover/focus 基于新位置
  if (nanoBaseX !== null) { nanoBaseX += dx; nanoBaseY += dy; }
  if (nanoFocusBaseX !== null) { nanoFocusBaseX += dx; nanoFocusBaseY += dy; }
});

ipcMain.handle('get-nano-state', () => {
  return { isNanoMode, isFullMode };
});

// ---- 窗口创建 ----
function createWindow() {
  const bounds = getMiniBounds();
  mainWindow = new BrowserWindow({
    ...bounds,
    backgroundColor: '#fdf6ee',
    minWidth: 42, minHeight: 52,
    frame: false, transparent: false,
    alwaysOnTop: true, skipTaskbar: true,
    resizable: true, hasShadow: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  // 多路径回退：兼容开发（electron .）和生产（asar 打包）两种模式
  const indexPath = path.join(__dirname, 'src', 'index.html');
  try {
    if (fs.existsSync(indexPath)) {
      mainWindow.loadFile(indexPath);
    } else {
      // asar 打包后路径可能不同，尝试相对于 app 根目录
      const fallbackPath = path.join(app.getAppPath(), 'src', 'index.html');
      if (fs.existsSync(fallbackPath)) {
        mainWindow.loadFile(fallbackPath);
      } else {
        // 最后尝试不加 src 子目录
        mainWindow.loadFile(path.join(__dirname, 'index.html'));
      }
    }
  } catch (e) {
    console.error('加载 index.html 失败，尝试回退路径:', e.message);
    try {
      mainWindow.loadFile(path.join(app.getAppPath(), 'src', 'index.html'));
    } catch (e2) {
      console.error('所有路径尝试失败:', e2.message);
    }
  }

  mainWindow.on('resize', saveWindowState);
  mainWindow.on('move', saveWindowState);

  mainWindow.on('close', (e) => {
    if (!isQuitting) { e.preventDefault(); mainWindow.hide(); }
  });

  // 渲染进程崩溃自动恢复
  mainWindow.webContents.on('render-process-gone', (event, details) => {
    console.error('渲染进程崩溃:', details.reason, 'exitCode:', details.exitCode);
    if (!isQuitting && mainWindow && !mainWindow.isDestroyed()) {
      setTimeout(() => {
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.reload();
      }, 1000);
    }
  });

  // 无响应检测（10s 后强制重载）
  mainWindow.webContents.on('unresponsive', () => {
    console.error('渲染进程无响应，强制重载');
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.reload();
  });
}

// ---- 系统托盘 ----
function createTrayIcon() {
  // 生成 32x32 PNG 花盆图标
  const SIZE = 32;
  const buf = Buffer.alloc(SIZE * SIZE * 4); // RGBA

  function setPixel(x, y, r, g, b, a) {
    if (x < 0 || x >= SIZE || y < 0 || y >= SIZE) return;
    const i = (y * SIZE + x) * 4;
    buf[i] = r; buf[i+1] = g; buf[i+2] = b; buf[i+3] = a;
  }
  function fillRect(x, y, w, h, r, g, b, a) {
    for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) setPixel(x + dx, y + dy, r, g, b, a);
  }
  function fillCircle(cx, cy, radius, r, g, b, a) {
    for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
      if ((x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2) setPixel(x, y, r, g, b, a);
    }
  }

  // 圆角背景
  fillRect(0, 0, SIZE, SIZE, 26, 42, 31, 255);
  // 边框
  fillRect(1, 1, SIZE-2, SIZE-2, 74, 222, 128, 80);
  fillRect(2, 2, SIZE-4, SIZE-4, 26, 42, 31, 255);
  // 花/圆
  fillCircle(16, 11, 3, 74, 222, 128, 255);
  // 茎
  fillRect(15, 14, 2, 10, 74, 222, 128, 200);
  // 叶子
  fillCircle(10, 17, 2, 34, 197, 94, 180);
  fillCircle(22, 18, 2, 34, 197, 94, 180);

  return nativeImage.createFromBuffer(buf, { width: SIZE, height: SIZE });
}

function createTray() {
  const pngPath = path.join(__dirname, 'tray-icon.png');
  // 每次启动重新生成图标，确保使用最新样式
  let icon = createTrayIcon();
  const pngData = icon.toPNG();
  fs.writeFileSync(pngPath, pngData);
  icon = nativeImage.createFromBuffer(pngData, { width: 32, height: 32 });
  tray = new Tray(icon);

  // 国际化：根据系统语言选择菜单文本
  const locale = app.getLocale();
  const isZh = locale.startsWith('zh');
  const labels = {
    open: isZh ? '打开周计划' : 'Open Weekly Planner',
    quit: isZh ? '退出' : 'Quit',
    tooltip: isZh ? '周计划花盆' : 'Weekly Planner'
  };
  tray.setToolTip(labels.tooltip);

  const contextMenu = Menu.buildFromTemplate([
    { label: labels.open, click: () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); }}},
    { type: 'separator' },
    { label: labels.quit, click: () => { isQuitting = true; app.quit(); }}
  ]);

  tray.setContextMenu(contextMenu);
  tray.on('click', () => {
    if (mainWindow) { mainWindow.isVisible() ? mainWindow.hide() : (mainWindow.show(), mainWindow.focus()); }
  });
}

// ---- 生命周期 ----
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  // 清理旧 Electron 崩溃日志（保留最近 3 个）
  function cleanupErrorLogs() {
    try {
      const logs = fs.readdirSync(__dirname)
        .filter(f => f.startsWith('electron-err') && f.endsWith('.log'))
        .map(f => ({ name: f, path: path.join(__dirname, f), mtime: fs.statSync(path.join(__dirname, f)).mtimeMs }))
        .sort((a, b) => b.mtime - a.mtime);
      logs.slice(3).forEach(log => { try { fs.unlinkSync(log.path); } catch(e) {} });
    } catch(e) {}
  }

  app.whenReady().then(() => {
    cleanupErrorLogs();
    app.setLoginItemSettings({ openAtLogin: true, path: app.getPath('exe') });
    createWindow();
    createTray();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
      if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
    });
  });

  app.on('before-quit', () => { isQuitting = true; });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
}

