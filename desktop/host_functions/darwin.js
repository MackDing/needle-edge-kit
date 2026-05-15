// macOS-specific implementations of the desktop_tools.json handler set.
// Uses AppleScript / osascript / mdfind / screencapture — all built-in on macOS.

const { exec, execFile } = require('child_process');
const { promisify } = require('util');
const { clipboard, Notification, shell, screen, nativeImage, desktopCapturer } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');

const execP = promisify(exec);

const APP_ALIASES = {
  chrome:     'Google Chrome',
  edge:       'Microsoft Edge',
  firefox:    'Firefox',
  safari:     'Safari',
  vscode:     'Visual Studio Code',
  'visual studio code': 'Visual Studio Code',
  slack:      'Slack',
  discord:    'Discord',
  notes:      'Notes',
  calculator: 'Calculator',
  calc:       'Calculator',
  terminal:   'Terminal',
  iterm:      'iTerm',
  finder:     'Finder',
  'file explorer': 'Finder',
  spotify:    'Spotify',
  obs:        'OBS',
  preview:    'Preview',
};

async function osa(script) {
  const safe = script.replace(/"/g, '\\"');
  const { stdout } = await execP(`osascript -e "${safe}"`);
  return stdout.trim();
}

function expandHome(p) {
  return p?.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p;
}

module.exports = {

  // ────── App / files ──────────────────────────────────────────

  launch_app: async ({ app }) => {
    const name = APP_ALIASES[app.toLowerCase()] ?? app;
    await execP(`open -a "${name.replace(/"/g, '\\"')}"`);
    return { launched: name };
  },

  open_file: async ({ path: p }) => {
    const r = expandHome(p);
    if (!fs.existsSync(r)) throw new Error(`not found: ${r}`);
    await shell.openPath(r);
    return { opened: r };
  },

  search_files: async ({ query, directory, limit = 50 }) => {
    const root = directory ? expandHome(directory) : os.homedir();
    const safe = query.replace(/['"\\]/g, '');
    // mdfind = Spotlight from CLI, instant
    const { stdout } = await execP(
      `mdfind -onlyin "${root}" "kMDItemDisplayName == '*${safe}*'c" | head -n ${limit}`
    );
    return { matches: stdout.split('\n').filter(Boolean) };
  },

  // ────── System ────────────────────────────────────────────────

  set_system_volume: async ({ level }) => {
    const clamped = Math.max(0, Math.min(100, level));
    await osa(`set volume output volume ${clamped}`);
    return { volume: clamped };
  },

  set_display_brightness: async ({ level }) => {
    // Requires Homebrew `brightness` CLI:  brew install brightness
    // Fallback: osascript can't set brightness directly without extra entitlements.
    try {
      const v = (Math.max(0, Math.min(100, level)) / 100).toFixed(2);
      await execP(`brightness ${v}`);
      return { brightness: level };
    } catch {
      return {
        brightness: level,
        warning: 'install `brew install brightness` for real control',
      };
    }
  },

  // ────── Clipboard ────────────────────────────────────────────

  clipboard_get: async () => ({ text: clipboard.readText() }),
  clipboard_set: async ({ text }) => { clipboard.writeText(text); return { ok: true }; },

  // ────── Screenshot ───────────────────────────────────────────

  screenshot: async ({ mode, destination = 'clipboard' }) => {
    // macOS has the world's best screenshot CLI built in
    const flags = mode === 'region' ? '-i' : mode === 'window' ? '-iw' : '';
    if (destination === 'clipboard') {
      await execP(`screencapture -c ${flags}`);
      return { copied: true };
    }
    const out = path.join(os.homedir(), 'Desktop', `screenshot_${Date.now()}.png`);
    await execP(`screencapture ${flags} "${out}"`);
    return { saved: out };
  },

  // ────── Shell (DANGEROUS — router enforces confirmation) ────

  run_shell: async ({ command, shell: sh }) => {
    const bin = sh === 'bash' ? 'bash -c' : sh === 'powershell' ? 'pwsh -c' : 'zsh -c';
    const { stdout, stderr } = await execP(
      `${bin} "${command.replace(/"/g, '\\"')}"`,
      { timeout: 15_000 },
    );
    return { stdout, stderr };
  },

  // ────── Image conversion (cross-platform via sharp) ─────────

  convert_image: async ({ input, format, max_kb, width }) => {
    const sharp = require('sharp');
    const inP = expandHome(input);
    const out = inP.replace(/\.[^.]+$/, `.${format}`);
    let img = sharp(inP);
    if (width) img = img.resize({ width });
    let buf = await img.toFormat(format, max_kb ? { quality: 80 } : {}).toBuffer();
    if (max_kb) {
      let q = 80;
      while (buf.length > max_kb * 1024 && q > 10) {
        q -= 10;
        buf = await sharp(inP).resize(width ? { width } : {})
                              .toFormat(format, { quality: q }).toBuffer();
      }
    }
    fs.writeFileSync(out, buf);
    return { output: out, kb: Math.round(buf.length / 1024) };
  },

  // ────── Notes / Timer / Notification ─────────────────────────

  create_note: async ({ title, content }) => {
    // Real Notes.app via AppleScript
    const t = (title ?? 'Quick note').replace(/"/g, '\\"');
    const c = content.replace(/"/g, '\\"').replace(/\n/g, '\\n');
    await osa(`tell application "Notes" to make new note with properties {name:"${t}", body:"${c}"}`);
    return { created_in: 'Notes.app' };
  },

  set_timer: async ({ minutes, label }) => {
    setTimeout(() => {
      new Notification({ title: 'Timer done', body: label ?? `${minutes} min elapsed` }).show();
    }, minutes * 60_000);
    return { firing_in_min: minutes };
  },

  send_notification: async ({ title, body }) => {
    new Notification({ title, body }).show();
    return { shown: true };
  },

  // ────── Display modes ────────────────────────────────────────

  switch_display_mode: async ({ mode }) => {
    const scripts = {
      dark:  'tell application "System Events" to tell appearance preferences to set dark mode to true',
      light: 'tell application "System Events" to tell appearance preferences to set dark mode to false',
      night_light_on:  'tell application "System Events" to keystroke "n" using {command down, option down}',
      night_light_off: 'tell application "System Events" to keystroke "n" using {command down, option down}',
      focus_on:  'do shell script "shortcuts run \\"Turn On Focus\\""',
      focus_off: 'do shell script "shortcuts run \\"Turn Off Focus\\""',
    };
    const s = scripts[mode];
    if (!s) return { warning: `${mode} not wired` };
    await osa(s);
    return { applied: mode };
  },

  // ────── Git ──────────────────────────────────────────────────

  git_action: async ({ action, repo, message }) => {
    const cwd = repo ? expandHome(repo) : process.cwd();
    const cmd = {
      status:      'git status --short',
      pull:        'git pull',
      push:        'git push',
      branch_list: 'git branch --list',
      commit:      `git add -A && git commit -m "${(message ?? 'wip').replace(/"/g, '\\"')}"`,
    }[action];
    if (!cmd) throw new Error(`unknown git action: ${action}`);
    const { stdout, stderr } = await execP(cmd, { cwd, timeout: 10_000 });
    return { stdout, stderr };
  },
};
