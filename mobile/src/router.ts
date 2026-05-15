// Tool-call router with whitelist, schema validation, debounce, and danger confirmation.
// Backend-agnostic: works for Electron (5A), ONNX-RN (5B), and future cact (5C).

import { handlers, ToolName } from './handlers';
import { validateArgs } from './schema';

export interface ToolCall {
  name: string;
  arguments: Record<string, any>;
}

export interface ToolResult {
  name: string;
  ok?: any;
  error?: string;
}

const DANGEROUS: Set<string> = new Set([
  'lock_door',
  'transfer_money',
  'delete_file',
  'call_emergency',
]);

const RECENT = new Map<string, number>();
const DEDUP_MS = 1500;

export async function routeToolCalls(
  calls: ToolCall[],
  opts: { confirm?: (c: ToolCall) => Promise<boolean> } = {},
): Promise<ToolResult[]> {
  const results: ToolResult[] = [];

  for (const call of calls) {
    // 1) Whitelist
    const handler = handlers[call.name as ToolName];
    if (!handler) {
      results.push({ name: call.name, error: 'unknown_tool' });
      continue;
    }

    // 2) Schema validation
    const err = validateArgs(call.name, call.arguments);
    if (err) {
      results.push({ name: call.name, error: `invalid_args: ${err}` });
      continue;
    }

    // 3) Danger confirmation
    if (DANGEROUS.has(call.name)) {
      const ok = opts.confirm ? await opts.confirm(call) : false;
      if (!ok) {
        results.push({ name: call.name, error: 'user_rejected' });
        continue;
      }
    }

    // 4) Debounce
    const key = call.name + JSON.stringify(call.arguments);
    const now = Date.now();
    if ((RECENT.get(key) ?? 0) + DEDUP_MS > now) {
      results.push({ name: call.name, error: 'debounced' });
      continue;
    }
    RECENT.set(key, now);

    // 5) Dispatch
    try {
      const out = await handler(call.arguments);
      results.push({ name: call.name, ok: out });
    } catch (e: any) {
      results.push({ name: call.name, error: e?.message ?? String(e) });
    }
  }

  return results;
}
