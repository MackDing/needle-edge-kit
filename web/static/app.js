// Web playground client. Posts to /api/generate, then executes browser-safe tools.

const $ = id => document.getElementById(id);
const q = $('q'), go = $('go'), result = $('result'), dot = $('dot'),
      statusText = $('status-text'), latency = $('latency'), examples = $('examples');

const EXAMPLES = [
  "copy 'hello world' to my clipboard",
  "what's in my clipboard",
  "remind me in 5 minutes to stretch",
  "open github.com in a new tab",
  "notify me 'meeting in 10 min'",
  "把这段话复制到剪贴板:测试",
];

let TOOLS = [];
let ready = false;

// ─── Browser-safe tool implementations ─────────────────────

const browserHandlers = {
  clipboard_get: async () => ({ text: await navigator.clipboard.readText() }),

  clipboard_set: async ({ text }) => {
    await navigator.clipboard.writeText(text);
    return { copied: true };
  },

  send_notification: async ({ title, body }) => {
    if (Notification.permission !== 'granted') {
      const p = await Notification.requestPermission();
      if (p !== 'granted') throw new Error('notification permission denied');
    }
    new Notification(title, { body });
    return { shown: true };
  },

  set_timer: async ({ minutes, label }) => {
    setTimeout(async () => {
      await browserHandlers.send_notification({
        title: 'Timer done', body: label ?? `${minutes} min elapsed`,
      });
    }, minutes * 60_000);
    return { firing_in_min: minutes };
  },

  open_url: async ({ url }) => {
    window.open(url, '_blank', 'noopener');
    return { opened: url };
  },

  show_message: async ({ text }) => ({ shown: text }),
};

// ─── Init ──────────────────────────────────────────────────

async function init() {
  // Load tools
  try {
    const r = await fetch('/api/tools/web_tools');
    TOOLS = await r.json();
  } catch (e) {
    statusText.textContent = 'tools load failed';
    dot.classList.add('off');
    return;
  }

  // Health check
  try {
    const r = await fetch('/api/health');
    const j = await r.json();
    statusText.textContent = `ready · ${j.model}`;
    dot.classList.remove('loading');
    ready = true;
    go.disabled = false;
  } catch {
    statusText.textContent = 'server unreachable';
    dot.classList.replace('loading', 'off');
  }

  // Examples
  examples.innerHTML = EXAMPLES.map(e =>
    `<span class="ex-chip">${e}</span>`).join('');
  examples.querySelectorAll('.ex-chip').forEach(el => {
    el.addEventListener('click', () => { q.value = el.textContent; run(); });
  });
}

// ─── Run loop ──────────────────────────────────────────────

async function run() {
  if (!ready) return;
  const query = q.value.trim();
  if (!query) return;
  go.disabled = true;
  result.innerHTML = '<div class="placeholder">Thinking…</div>';
  latency.textContent = '';

  const t0 = performance.now();
  try {
    const r = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query, tools: TOOLS }),
    });
    if (!r.ok) throw new Error(await r.text());
    const { calls, latency_ms } = await r.json();
    const t1 = performance.now();

    if (!calls.length) {
      result.innerHTML = '<div class="placeholder">No matching tool. Try rephrasing — or this might need the desktop app.</div>';
      latency.textContent = `infer ${latency_ms} ms`;
      return;
    }

    result.innerHTML = '';
    const cards = calls.map(c => addCard(c));
    for (let i = 0; i < calls.length; i++) {
      try {
        const fn = browserHandlers[calls[i].name];
        if (!fn) { updateCard(cards[i], 'err', 'desktop-only tool'); continue; }
        const ok = await fn(calls[i].arguments);
        updateCard(cards[i], 'ok', formatOk(ok));
      } catch (e) {
        updateCard(cards[i], 'err', e.message);
      }
    }
    const t2 = performance.now();
    latency.textContent = `infer ${latency_ms} ms · exec ${(t2-t1)|0} ms · roundtrip ${(t2-t0)|0} ms`;
  } catch (e) {
    result.innerHTML = `<div class="placeholder" style="color:var(--err)">${e.message}</div>`;
  } finally {
    go.disabled = false;
  }
}

function addCard(call) {
  const args = JSON.stringify(call.arguments);
  const trunc = args.length > 60 ? args.slice(0, 57) + '…' : args;
  const div = document.createElement('div');
  div.className = 'result-card';
  div.innerHTML = `
    <div class="dot run"></div>
    <div class="rc-body">
      <div class="rc-name">${call.name}</div>
      <div class="rc-args">${trunc}</div>
    </div>
    <div class="rc-tail">running…</div>`;
  result.appendChild(div);
  return div;
}

function updateCard(card, status, tail) {
  card.querySelector('.dot').className = `dot ${status}`;
  card.querySelector('.rc-tail').textContent = tail;
}

function formatOk(ok) {
  if (!ok) return '✓';
  if (typeof ok === 'string') return ok.slice(0, 30);
  if (ok.copied)     return 'copied';
  if (ok.shown)      return typeof ok.shown === 'string' ? ok.shown.slice(0, 30) : 'shown';
  if (ok.opened)     return new URL(ok.opened).hostname;
  if (ok.text)       return `"${ok.text.slice(0, 24)}${ok.text.length > 24 ? '…' : ''}"`;
  if (ok.firing_in_min) return `in ${ok.firing_in_min} min`;
  return '✓';
}

go.addEventListener('click', run);
q.addEventListener('keydown', e => { if (e.key === 'Enter') run(); });

init();
