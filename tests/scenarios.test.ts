/**
 * Quality gates for the scenario files that feed Gemini data synthesis.
 *
 * These are heuristic — not exact correctness checks — but they catch the
 * common failure mode of "I added a tool but forgot to write any scenarios
 * that exercise it" which leads to call_f1 collapse on that tool after
 * finetuning.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '..');

interface ScenarioDoc {
  domain?: string;
  description?: string;
  scenarios: string[];
}

interface Tool {
  name: string;
  description: string;
  parameters: Record<string, any>;
  required: string[];
}

function readJSON<T>(p: string): T {
  return JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf-8')) as T;
}

// (scenario file, tool file) pairings — each scenario file must adequately
// cover every tool in its paired tools file.
const PAIRINGS: Array<{ scenarios: string; tools: string; label: string }> = [
  {
    scenarios: 'scenarios/example_smart_home.json',
    tools:     'tools/example_tools.json',
    label:     'smart_home',
  },
  {
    scenarios: 'desktop/scenarios/desktop_actions.json',
    tools:     'desktop/tools/desktop_tools.json',
    label:     'desktop',
  },
  {
    scenarios: 'scenarios/oa_scenarios.json',
    tools:     'tools/oa_tools.json',
    label:     'oa',
  },
];

// Stopwords that are too generic to be useful evidence of coverage on their own.
const STOPWORDS = new Set(['set', 'get', 'do', 'is', 'a', 'an', 'the', 'of', 'on', 'in', 'to']);

/** Decompose snake_case tool names into root tokens.
 *  set_light_brightness → ['light','brightness']  (stopwords like 'set' removed)
 *  control_tv           → ['tv']                  (short acronyms kept) */
function tokenizeName(name: string): string[] {
  return name
    .split('_')
    .filter(t => t.length >= 2)        // keep 2-char acronyms like 'tv','os','ai'
    .filter(t => !STOPWORDS.has(t));
}

/** Aliases mapped per-token. Lets us match "brightness" → "bright|dim|dark|too bright". */
const ALIAS: Record<string, string[]> = {
  brightness: ['bright', 'dim', 'dark', '亮度', '暗', '亮'],
  light:      ['lights', 'lamp', 'lighting', '灯'],
  thermostat: ['ac', 'aircon', 'temperature', 'heat', 'cool', '空调', '温度', '热', '冷'],
  music:      ['song', 'play', 'jazz', 'classical', 'spotify', '音乐'],
  playback:   ['pause', 'stop', 'next', 'previous', 'volume', 'mute', '音量', '暂停'],
  volume:     ['vol', 'louder', 'softer', 'mute', '音量', '声音'],
  door:       ['lock', 'unlock', '门', '锁'],
  timer:      ['minute', 'countdown', 'pomodoro', '分钟', '计时'],
  alarm:      ['wake', 'morning', '闹钟'],
  reminder:   ['remind', 'note', '提醒'],
  scene:      ['mode', 'routine', '模式'],
  display:    ['monitor', 'screen', '屏'],
  shell:      ['command', 'powershell', 'bash', 'pwsh', 'cmd', 'docker', 'run', 'execute'],
  shot:       ['screenshot', 'capture', 'screen', '截屏', '截图'],
  tv:         ['television', 'hdmi'],
  clipboard:  ['copy', 'paste', '剪贴板', '复制', '粘贴'],
  search:     ['find', 'lookup', '查找', '搜索'],
  files:      ['file', 'folder', 'directory', 'pdf', 'png', 'jpg'],
  notification: ['notify', 'alert', '通知'],
  note:       ['notes', 'memo', '笔记'],
  app:        ['launch', 'open', 'start', '启动', '打开'],
  image:      ['png', 'jpg', 'jpeg', 'webp', 'gif', '图', '图片'],
  git:        ['commit', 'pull', 'push', 'branch', 'status', 'repo'],
  url:        ['link', 'website', '网址'],
  message:    ['text', 'show'],
  open:       ['launch', 'start'],
  launch:     ['open', 'start'],
  control:    ['adjust', 'change'],
  set:        ['adjust', 'change', 'turn', '调'],

  // OA domain — Chinese-first aliases
  leave:        ['请假', '年假', '事假', '病假', '产假', '陪产假', '丧假', '婚假', 'leave', 'pto', 'qj'],
  request:      ['申请', 'apply', 'submit'],
  business:     ['出差', '商旅', 'trip', 'travel'],
  trip:         ['出差', '差旅'],
  overtime:     ['加班', 'ot'],
  reimbursement: ['报销', '发票', 'expense', 'claim', 'bx'],
  meeting:      ['会议', '开会', '会', 'meet'],
  room:         ['会议室', '室'],
  book:         ['订', '预订', '预约', 'reserve'],
  schedule:     ['约', '安排', '日程'],
  colleague:    ['同事', '电话', '联系方式', '邮箱', '部门'],
  find:         ['查', '找', 'lookup', 'search'],
  ticket:       ['工单', '报修'],
  it:           ['电脑', 'vpn', '密码', '账号', '邮箱', '蓝屏', '上网'],
  approval:     ['审批', '审核', '批'],
  status:       ['进度', '状态', '到哪了'],
  cancel:       ['撤回', '撤销', '撤'],
  forward:      ['转交', '让', 'reassign'],
  attendance:   ['考勤', '打卡', '迟到', '早退'],
  balance:      ['余额', '剩', '还有'],
  payroll:      ['工资', '工资条', 'salary', '社保'],
  purchase:     ['采购', '买', 'purchase', 'order'],
  visitor:      ['访客', '客户来', '来访'],
  vehicle:      ['用车', '派车', '车', 'car', '机场'],
  seal:         ['用印', '盖章', '盖印', '公章'],
  knowledge:    ['规定', '政策', '怎么', 'policy', '流程', 'how'],
  base:         ['policy', 'regulations'],
  borrow:       ['借', '借用'],
  equipment:    ['投影', '相机', 'demo', '设备'],
  submit:       ['申请', '提交', '提', 'apply'],
  query:        ['查', '看', '查询', '查一下'],
};

/** Returns true if any scenario contains at least one significant token (or its alias)
 *  for the given tool name. Lower-cases both sides. */
function isToolCovered(toolName: string, scenarios: string[]): { covered: boolean; matchedTokens: string[] } {
  const tokens = tokenizeName(toolName);
  const matched = new Set<string>();
  const corpus = scenarios.map(s => s.toLowerCase()).join(' \n ');

  for (const tok of tokens) {
    const candidates = [tok, ...(ALIAS[tok] ?? [])];
    if (candidates.some(c => corpus.includes(c.toLowerCase()))) {
      matched.add(tok);
    }
  }
  return { covered: matched.size > 0, matchedTokens: [...matched] };
}

// ──────────────────────────────────────────────────────────────────────

describe('scenario corpus sanity', () => {

  for (const { scenarios: sf, label } of PAIRINGS) {
    describe(`${label} (${sf})`, () => {
      const doc = readJSON<ScenarioDoc>(sf);

      it('has a non-empty scenarios array', () => {
        expect(Array.isArray(doc.scenarios)).toBe(true);
        expect(doc.scenarios.length).toBeGreaterThan(0);
      });

      it('every scenario is a non-empty string', () => {
        for (const s of doc.scenarios) {
          expect(typeof s).toBe('string');
          expect(s.trim().length).toBeGreaterThan(0);
        }
      });

      it('no scenario is absurdly long', () => {
        for (const s of doc.scenarios) {
          expect(s.length, `too long: "${s.slice(0, 30)}…"`).toBeLessThanOrEqual(200);
        }
      });

      it('no duplicate scenarios', () => {
        const seen = new Set<string>();
        const dups: string[] = [];
        for (const s of doc.scenarios) {
          const k = s.trim().toLowerCase();
          if (seen.has(k)) dups.push(s);
          seen.add(k);
        }
        expect(dups, `duplicates: ${dups.join('; ')}`).toEqual([]);
      });

      it('vocabulary diversity ≥ 100 unique tokens', () => {
        const tokens = new Set<string>();
        for (const s of doc.scenarios) {
          for (const w of s.toLowerCase().split(/[\s,.\/\\:;!?()'"`]+/)) {
            if (w.length >= 2) tokens.add(w);
          }
        }
        expect(tokens.size, `unique vocab tokens`).toBeGreaterThanOrEqual(100);
      });

      it('at least 10% of scenarios look multi-action (en/zh conjunctions)', () => {
        // Multi-action data is what teaches the model to emit multiple tool calls;
        // without it call_f1 on parallel/chained intents collapses.
        const multiPattern = /\band\b|\bthen\b|,|,|然后|顺便|接着|同时|并且|、/;
        const multi = doc.scenarios.filter(s => multiPattern.test(s));
        const ratio = multi.length / doc.scenarios.length;
        expect(ratio, `${(ratio*100).toFixed(0)}% multi-action`).toBeGreaterThanOrEqual(0.10);
      });
    });
  }
});

describe('scenario ↔ tool coverage', () => {

  for (const { scenarios: sf, tools: tf, label } of PAIRINGS) {
    it(`${label}: every tool is mentioned in at least one scenario`, () => {
      const scenarios = readJSON<ScenarioDoc>(sf).scenarios;
      const tools = readJSON<Tool[]>(tf);

      const uncovered: string[] = [];
      for (const tool of tools) {
        const { covered } = isToolCovered(tool.name, scenarios);
        if (!covered) uncovered.push(tool.name);
      }
      expect(
        uncovered,
        `tools with no scenario coverage in ${sf}:\n  ${uncovered.join('\n  ')}\n` +
        `  → add at least one scenario that mentions one of these tools' keywords ` +
        `(see ALIAS map in tests/scenarios.test.ts).`,
      ).toEqual([]);
    });
  }
});
