// Electron main process: launches needle_bridge.py and proxies generate() via IPC.

const { app, BrowserWindow, Tray, Menu, globalShortcut, ipcMain, dialog, shell } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const hostFns = require('./host_functions');

const PYTHON_BIN = process.env.NEEDLE_PYTHON || (process.platform === 'win32'
  ? path.join(__dirname, 'python', 'python.exe')
  : path.join(__dirname, 'python', 'bin', 'python3'));

const CHECKPOINT = process.env.NEEDLE_CHECKPOINT
  || path.join(__dirname, 'assets', 'my_best.pkl');

// WSL mode: NEEDLE_USE_WSL=1 spawns the bridge via `wsl bash -c "..."`,
// inheriting the WSL venv (GPU CUDA). Useful on Windows where JAX has no
// native CUDA support.
const USE_WSL    = process.env.NEEDLE_USE_WSL === '1';
const WSL_DISTRO = process.env.NEEDLE_WSL_DISTRO || 'Ubuntu-24.04';
const WSL_VENV   = process.env.NEEDLE_WSL_VENV   || '/home/mack/ngpu/bin/activate';
const WSL_BRIDGE = process.env.NEEDLE_WSL_BRIDGE || '/mnt/c/D/CLPS/Code/Github/needle-edge-kit/desktop/needle_bridge.py';
const WSL_CKPT   = process.env.NEEDLE_WSL_CHECKPOINT
                 || '/home/mack/ngpu-ckpts/needle_finetuned_20260514182554_29076_12_512_best.pkl';

let py = null;
let win = null;
const pending = new Map();
let nextId = 1;
let ready = false;
const readyQueue = [];

function startPython() {
  let bin, args;
  if (USE_WSL) {
    const bashCmd =
      `export PYTHONUTF8=1 PYTHONIOENCODING=utf-8 PYTHONUNBUFFERED=1 && ` +
      `source ${WSL_VENV} && ` +
      `exec python -u ${WSL_BRIDGE} --checkpoint ${WSL_CKPT}`;
    bin  = 'wsl.exe';
    args = ['-d', WSL_DISTRO, '-e', 'bash', '-c', bashCmd];
    console.log(`[main] launching bridge in WSL (${WSL_DISTRO})`);
  } else {
    if (!fs.existsSync(PYTHON_BIN)) {
      console.error(`[main] python not found at ${PYTHON_BIN}`);
      return;
    }
    bin  = PYTHON_BIN;
    args = [path.join(__dirname, 'needle_bridge.py'), '--checkpoint', CHECKPOINT];
  }
  py = spawn(bin, args, { stdio: ['pipe', 'pipe', 'pipe'] });

  let buf = '';
  py.stdout.on('data', (chunk) => {
    buf += chunk.toString();
    let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { continue; }

      if (msg.ready) {
        ready = true;
        for (const fn of readyQueue) fn();
        readyQueue.length = 0;
        win?.webContents.send('needle:ready', msg);
        continue;
      }

      const cb = pending.get(msg.id);
      if (cb) { pending.delete(msg.id); cb(msg); }
    }
  });

  py.stderr.on('data', (c) => process.stderr.write(`[bridge] ${c}`));
  py.on('exit', (code) => {
    console.error(`[main] python bridge exited code=${code}`);
    ready = false;
    py = null;
  });
}

function waitReady() {
  return ready ? Promise.resolve() : new Promise(r => readyQueue.push(r));
}

ipcMain.handle('needle:generate', async (_evt, { query, tools, maxLen, seed }) => {
  await waitReady();
  if (!py) throw new Error('python bridge not running');
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, (msg) => {
      if (msg.err) reject(new Error(msg.err));
      else resolve(msg.ok);
    });
    py.stdin.write(JSON.stringify({ id, query, tools, max_len: maxLen, seed }) + '\n');
  });
});

ipcMain.handle('needle:status', () => ({ ready, checkpoint: CHECKPOINT }));

// Tools file path the renderer should load. Configurable so the same UI works
// for OA / desktop / smart_home models without code change. Renderer fetches
// via a relative URL from renderer/, so we return a relative path.
const TOOLS_REL_PATH = process.env.NEEDLE_TOOLS_PATH
  || '../../tools/oa_tools.json';
ipcMain.handle('needle:tools-path', () => TOOLS_REL_PATH);

ipcMain.handle('needle:execute', async (_evt, calls) => {
  const results = [];
  for (const call of calls) {
    const r = await hostFns.route(call, {
      confirm: async (c) => {
        const { response } = await dialog.showMessageBox(win, {
          type: 'question',
          buttons: ['Cancel', 'Run'],
          defaultId: 0,
          cancelId: 0,
          message: `Confirm action?`,
          detail: `${c.name}(${JSON.stringify(c.arguments)})`,
        });
        return response === 1;
      },
    });
    results.push(r);
  }
  return results;
});

let tray = null;
const { screen } = require('electron');

function makeWindow() {
  win = new BrowserWindow({
    width: 720,
    height: 88,                  // initial = input row only; results expand it
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    fullscreenable: false,
    minimizable: false,
    maximizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: true,
    roundedCorners: true,
    vibrancy:           process.platform === 'darwin' ? 'sidebar' : undefined,
    backgroundMaterial: process.platform === 'win32'  ? 'acrylic' : undefined,
    backgroundColor:    '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile('renderer/launcher.html');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  positionTopCenter();

  win.on('blur', () => {
    if (!win.webContents.isDevToolsOpened()) win.hide();
  });
  win.on('close', (e) => { e.preventDefault(); win.hide(); });
  return win;
}

function positionTopCenter() {
  const cursor = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(cursor);
  const { x, y, width, height } = display.workArea;
  const w = 720;
  win.setBounds({
    x: Math.round(x + (width - w) / 2),
    y: Math.round(y + height / 4),
    width: w,
    height: 88,
  });
}

function toggleWindow() {
  if (!win) return;
  if (win.isVisible()) {
    win.hide();
  } else {
    positionTopCenter();
    win.show();
    win.focus();
    win.webContents.send('needle:show');
  }
}

ipcMain.handle('needle:hide', () => win?.hide());
ipcMain.handle('needle:resize', (_e, h) => {
  if (!win) return;
  const b = win.getBounds();
  win.setBounds({ ...b, height: Math.min(560, Math.max(88, h | 0)) });
});

app.whenReady().then(() => {
  startPython();
  makeWindow();

  // Global hotkey — Cmd+Space-like
  const accel = process.platform === 'darwin' ? 'Cmd+Shift+Space' : 'Ctrl+Shift+Space';
  globalShortcut.register(accel, toggleWindow);

  // System tray — synthesize a 1px transparent icon if no asset is shipped.
  // (Avoids the silent "Failed to load image" warning that breaks the tray.)
  const { nativeImage } = require('electron');
  const iconCandidates = [
    path.join(__dirname, 'assets', 'tray.png'),
    path.join(__dirname, 'renderer', 'favicon.ico'),
  ];
  const iconPath = iconCandidates.find(p => fs.existsSync(p));
  const trayIcon = iconPath
    ? nativeImage.createFromPath(iconPath)
    : nativeImage.createFromBuffer(Buffer.from(
        // 16x16 dark-blue square PNG (base64). Tiny, no asset needed.
        'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAQAAAC1+jfqAAAANElEQVR42mNk+M9' +
        'AAmAcVTCqYFQB' + 'wxBQ8B8E/sP4w' + 'wEFEDpsAQDLAQ4nIcccywAAAABJRU5ErkJggg==',
        'base64'));
  try {
    tray = new Tray(trayIcon);
    tray.setToolTip('Needle Edge');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Show / Hide', click: toggleWindow, accelerator: accel },
      { type: 'separator' },
      { label: 'Quit', click: () => { app.exit(0); } },
    ]));
    tray.on('click', toggleWindow);
  } catch (e) {
    console.error('[main] tray init failed (non-fatal):', e.message);
  }
});

app.on('window-all-closed', (e) => {
  // Keep alive in tray
  e.preventDefault();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  if (py) py.kill();
});
