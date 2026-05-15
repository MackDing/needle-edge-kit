# Step 6 — Tool Call 路由

模型输出**只是 JSON**,真正执行靠你的路由层。这一步决定产品的**安全性、可靠性、用户体验**。

## 数据流

```
   Needle 输出                          Router                    Native
   ─────────────                       ─────────                ─────────
   [
     {
       "name": "set_light_brightness",  ──┬──→ 1) Whitelist 校验  ──→ 拒绝未知工具
       "arguments": {                     │
         "room": "living_room",           ├──→ 2) Schema 校验    ──→ 拒绝非法参数
         "level": 30                      │
       }                                  ├──→ 3) 危险动作确认   ──→ 弹 toast/对话框
     },                                   │
     ...                                  ├──→ 4) 限流 / 防抖    ──→ 同一 action 1s 内 dedupe
   ]                                      │
                                          └──→ 5) 派发到 handler ──→ SmartHomeNative.setBrightness(...)
```

## 关键代码

`mobile/src/router.ts`(也适用 desktop):

```typescript
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

const DANGEROUS: Set<ToolName> = new Set([
  'transfer_money',
  'delete_file',
  'unlock_door',
  'call_emergency',
]);

const RECENT = new Map<string, number>();
const DEDUP_MS = 1500;

export async function routeToolCalls(
  calls: ToolCall[],
  opts: { confirm?: (c: ToolCall) => Promise<boolean> } = {}
): Promise<ToolResult[]> {
  const results: ToolResult[] = [];

  for (const call of calls) {
    // 1) 白名单
    const handler = handlers[call.name as ToolName];
    if (!handler) {
      results.push({ name: call.name, error: 'unknown_tool' });
      continue;
    }

    // 2) Schema 校验
    const validationError = validateArgs(call.name, call.arguments);
    if (validationError) {
      results.push({ name: call.name, error: `invalid_args: ${validationError}` });
      continue;
    }

    // 3) 危险动作二次确认
    if (DANGEROUS.has(call.name as ToolName)) {
      const ok = opts.confirm ? await opts.confirm(call) : false;
      if (!ok) {
        results.push({ name: call.name, error: 'user_rejected' });
        continue;
      }
    }

    // 4) 防抖去重(同一 name+args 1.5s 内只触发一次)
    const key = call.name + JSON.stringify(call.arguments);
    const now = Date.now();
    if ((RECENT.get(key) ?? 0) + DEDUP_MS > now) {
      results.push({ name: call.name, error: 'debounced' });
      continue;
    }
    RECENT.set(key, now);

    // 5) 派发
    try {
      const ok = await handler(call.arguments);
      results.push({ name: call.name, ok });
    } catch (e: any) {
      results.push({ name: call.name, error: e.message ?? String(e) });
    }
  }

  return results;
}
```

## Handlers 模板

`mobile/src/handlers.ts`:

```typescript
import { NativeModules } from 'react-native';

const { SmartHome, MediaPlayer, Timer } = NativeModules;

export type ToolName =
  | 'set_light_brightness'
  | 'play_music'
  | 'set_timer'
  | 'set_thermostat';

export const handlers: Record<ToolName, (args: any) => Promise<any>> = {
  set_light_brightness: ({ room, level }) => SmartHome.setBrightness(room, level),
  play_music:           ({ genre, song }) => MediaPlayer.play({ genre, song }),
  set_timer:            ({ minutes, label }) => Timer.start(minutes * 60, label),
  set_thermostat:       ({ temperature }) => SmartHome.setThermostat(temperature),
};
```

每个 handler 对应你 `tools/my_tools.json` 里的一个工具。**name 必须一一对应,大小写敏感。**

## 设计原则

### 1. 幂等性
模型偶尔会重复输出同一个调用(尤其训练数据有重复)。所有 handler 必须能安全重复执行。
- 好:`setBrightness(room, level)` —— 设置到 X 就是 X
- 差:`incrementBrightness(by)` —— 重复会累加

### 2. 危险动作 = 二次确认
列出你产品里**不可逆**或**有代价**的动作,强制 UI 确认:
- 转账、下单、删除
- 拨打 911 / 紧急服务
- 解锁门、启动车

### 3. 白名单 + 默认拒绝
即使开了 grammar-constrained decoding,**仍然要做应用层白名单**。
原因:模型可能输出**没在白名单内但语法上合法**的工具名(训练数据偶发噪声)。

### 4. 错误必须可见
不要 silently 失败。返回给用户:
```
✓ 客厅灯调到 30%
✗ 播放音乐 — 未找到 "jazz" 类型
✗ unknown_tool: cancel_flight
```

### 5. 把执行结果反馈给用户(但不要塞回模型)
Needle 是 single-shot,**不要**把上一次的结果拼到下一次 query 里。
应用层维护对话感,但模型每次都是无状态调用。

## 测试矩阵(建议至少跑一遍)

| 用例 | 模型输出 | 路由器行为 | 预期 |
|---|---|---|---|
| 已知工具 + 合法参数 | `[{name:"set_light_brightness",args:{room:"living_room",level:30}}]` | 派发 | 灯调暗 |
| 未知工具 | `[{name:"summon_dragon",args:{}}]` | 拦截 | error: unknown_tool |
| 工具对,参数错 | `[{name:"set_light_brightness",args:{room:"mars",level:30}}]` | Schema 拦截 | error: invalid_args |
| 危险工具 | `[{name:"transfer_money",args:{...}}]` | 弹确认 | 等用户点 OK 才执行 |
| 重复调用 | 同一工具连发两次 | 第二次被防抖 | error: debounced |
| 模型说"我做不到" | `[]` | 空数组 | UI 显示 "Sorry, I can't do that" |

## 集成测试脚本

```powershell
node mobile\test\router.test.js
```

每次改 handlers / router 后跑一遍,~ 30 用例。

## 完结

你现在有了一个完整的:
1. ✅ 自定义领域的工具集
2. ✅ 2000 条合成训练数据
3. ✅ 在你领域上 call_f1 ≥ 0.75 的 26M 模型
4. ✅ 桌面 / 移动端的部署形态
5. ✅ 生产级的路由层

**完全离线,零云端依赖,装上就能用。**

→ 回到 [README](../README.md)
