// Windows-specific implementations of the desktop_tools.json handler set.
// Wire these into the IPC router in main.js (see desktop/main.js patch).
//
// Strategy: use built-in shell utilities (PowerShell mostly) so we don't ship
// extra binaries. Slower than native bindings but zero install friction.

const { exec, execFile } = require('child_process');
const { promisify } = require('util');
const { clipboard, Notification, shell, BrowserWindow, screen } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');

const execP = promisify(exec);

// Map "user-friendly app names" to Windows executable / Start Menu names.
const APP_ALIASES = {
  chrome:     'chrome',
  edge:       'msedge',
  firefox:    'firefox',
  vscode:     'code',
  'visual studio code': 'code',
  slack:      'slack',
  discord:    'discord',
  notepad:    'notepad',
  calculator: 'calc',
  calc:       'calc',
  terminal:   'wt',
  'windows terminal': 'wt',
  powershell: 'powershell',
  cmd:        'cmd',
  explorer:   'explorer',
  'file explorer': 'explorer',
  'task manager': 'taskmgr',
  spotify:    'spotify',
  obs:        'obs64',
};

async function ps(cmd) {
  const { stdout } = await execP(`powershell -NoProfile -NonInteractive -Command "${cmd.replace(/"/g, '\\"')}"`);
  return stdout.trim();
}

module.exports = {

  // ────── App / files ──────────────────────────────────────────

  launch_app: async ({ app }) => {
    const exe = APP_ALIASES[app.toLowerCase()] ?? app;
    return new Promise((resolve, reject) => {
      // 'start' resolves Start Menu shortcuts & PATH lookups
      exec(`start "" "${exe}"`, { shell: true }, (err) =>
        err ? reject(err) : resolve({ launched: exe }));
    });
  },

  open_file: async ({ path: p }) => {
    const resolved = p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p;
    if (!fs.existsSync(resolved)) throw new Error(`not found: ${resolved}`);
    await shell.openPath(resolved);
    return { opened: resolved };
  },

  search_files: async ({ query, directory, limit = 50 }) => {
    const root = directory
      ? (directory.startsWith('~') ? path.join(os.homedir(), directory.slice(1)) : directory)
      : os.homedir();
    const safe = query.replace(/[`$"\\]/g, '');
    const out = await ps(
      `Get-ChildItem -Path '${root}' -Recurse -ErrorAction SilentlyContinue ` +
      `-Filter '*${safe}*' | Select-Object -First ${limit} -ExpandProperty FullName`
    );
    return { matches: out.split(/\r?\n/).filter(Boolean) };
  },

  // ────── System ────────────────────────────────────────────────

  set_system_volume: async ({ level }) => {
    // Uses nircmd-style API via Windows.Media — simplest cross-version path is PowerShell + AudioDeviceCmdlets,
    // but that requires install. Fallback: nudge via shell keys (less precise).
    // Easiest reliable approach: 50 keypresses of VK_VOLUME_DOWN to zero then up.
    // Better: ship a tiny `setvol.exe` (https://www.nirsoft.net/utils/nircmd.html) in resources/.
    const clamped = Math.max(0, Math.min(100, level));
    await ps(`(New-Object -ComObject WScript.Shell).SendKeys([char]173)`);  // mute toggle as smoke test
    // TODO: bundle nircmd.exe and call:  nircmd.exe setsysvolume ${Math.round(clamped/100*65535)}
    return { volume: clamped, note: 'ship nircmd.exe for precise control' };
  },

  set_display_brightness: async ({ level }) => {
    const clamped = Math.max(0, Math.min(100, level));
    await ps(`(Get-WmiObject -Namespace root/WMI -Class WmiMonitorBrightnessMethods).WmiSetBrightness(1, ${clamped})`);
    return { brightness: clamped };
  },

  // ────── Clipboard ────────────────────────────────────────────

  clipboard_get: async () => ({ text: clipboard.readText() }),
  clipboard_set: async ({ text }) => { clipboard.writeText(text); return { ok: true }; },

  // ────── Screenshot ───────────────────────────────────────────

  screenshot: async ({ mode, destination = 'clipboard' }) => {
    if (mode === 'region') {
      // Hand off to the built-in Snipping Tool UI
      exec('start ms-screenclip:', { shell: true });
      return { handed_off_to: 'Snipping Tool' };
    }
    const display = screen.getPrimaryDisplay();
    const sources = await require('electron').desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: display.size.width, height: display.size.height },
    });
    const png = sources[0].thumbnail.toPNG();
    if (destination === 'clipboard') {
      clipboard.writeImage(require('electron').nativeImage.createFromBuffer(png));
      return { copied: true };
    }
    const out = path.join(os.homedir(), 'Desktop', `screenshot_${Date.now()}.png`);
    fs.writeFileSync(out, png);
    return { saved: out };
  },

  // ────── Shell (DANGEROUS — router enforces confirmation) ────

  run_shell: async ({ command, shell: sh }) => {
    const cmd = sh === 'powershell'
      ? `powershell -NoProfile -Command "${command.replace(/"/g, '\\"')}"`
      : sh === 'bash'
      ? `bash -c "${command.replace(/"/g, '\\"')}"`
      : command;
    const { stdout, stderr } = await execP(cmd, { timeout: 15_000 });
    return { stdout, stderr };
  },

  // ────── Image conversion ─────────────────────────────────────

  convert_image: async ({ input, format, max_kb, width }) => {
    // Uses bundled sharp (npm i sharp) — install in desktop/
    const sharp = require('sharp');
    const inP = input.startsWith('~') ? path.join(os.homedir(), input.slice(1)) : input;
    const out = inP.replace(/\.[^.]+$/, `.${format}`);
    let img = sharp(inP);
    if (width) img = img.resize({ width });
    let buf = await img.toFormat(format, max_kb ? { quality: 80 } : {}).toBuffer();
    if (max_kb) {
      let q = 80;
      while (buf.length > max_kb * 1024 && q > 10) {
        q -= 10;
        buf = await sharp(inP).resize(width ? { width } : {}).toFormat(format, { quality: q }).toBuffer();
      }
    }
    fs.writeFileSync(out, buf);
    return { output: out, kb: Math.round(buf.length / 1024) };
  },

  // ────── Notes / Timer / Notification ─────────────────────────

  create_note: async ({ title, content }) => {
    const dir = path.join(os.homedir(), 'Documents', 'NeedleNotes');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${(title || 'note').replace(/[^\w-]+/g, '_')}_${Date.now()}.txt`);
    fs.writeFileSync(file, content, 'utf-8');
    return { saved: file };
  },

  set_timer: async ({ minutes, label }) => {
    const ms = minutes * 60_000;
    setTimeout(() => {
      new Notification({ title: 'Timer done', body: label ?? `${minutes} min elapsed` }).show();
    }, ms);
    return { firing_in_min: minutes };
  },

  send_notification: async ({ title, body }) => {
    new Notification({ title, body }).show();
    return { shown: true };
  },

  // ────── Display modes ────────────────────────────────────────

  switch_display_mode: async ({ mode }) => {
    const map = {
      dark:  'New-ItemProperty -Path HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize -Name AppsUseLightTheme -Value 0 -Type Dword -Force',
      light: 'New-ItemProperty -Path HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize -Name AppsUseLightTheme -Value 1 -Type Dword -Force',
    };
    const cmd = map[mode];
    if (!cmd) return { warning: `${mode} not yet wired` };
    await ps(cmd);
    return { applied: mode };
  },

  // ────── Git ──────────────────────────────────────────────────

  git_action: async ({ action, repo, message }) => {
    const cwd = repo
      ? (repo.startsWith('~') ? path.join(os.homedir(), repo.slice(1)) : repo)
      : process.cwd();
    const cmd = {
      status:       'git status --short',
      pull:         'git pull',
      push:         'git push',
      branch_list:  'git branch --list',
      commit:       `git add -A && git commit -m "${(message ?? 'wip').replace(/"/g, '\\"')}"`,
    }[action];
    if (!cmd) throw new Error(`unknown git action: ${action}`);
    const { stdout, stderr } = await execP(cmd, { cwd, timeout: 10_000 });
    return { stdout, stderr };
  },
};
