# Step 5 — 嵌入端侧

提供 3 条路径,**根据你的目标平台和"今天就要 demo"程度选**。

```
                      ┌──────────────────────────────────────────┐
                      │  哪条路径?                                │
                      └──────────────────────────────────────────┘
                                       │
              ┌──────────────────┬─────┴──────┬──────────────────┐
              ▼                  ▼            ▼                  ▼
       桌面 / Win·Mac         安卓 / iOS    安卓 / iOS         嵌入式
       立即可用                等转换稳定     等官方支持          MCU
            │                      │            │                  │
            ▼                      ▼            ▼                  ▼
       Electron + Python      onnxruntime   cactus-react-       Cactus C++
       (.pkl 直接推理)        -react-native  native             runtime
                              + ONNX        (Needle 待支持)     (本 kit 暂不覆盖)
            5A                    5B             5C
```

---

## 5A · Electron + 内嵌 Python(立即可用,推荐起步)

### 架构

```
┌─────────────────── Electron App ───────────────────┐
│                                                    │
│   ┌──────── Renderer (HTML/JS) ────────┐           │
│   │   用户输入框 / 工具调用展示          │           │
│   └────────────────┬────────────────────┘           │
│                    │ IPC (JSON)                     │
│   ┌────────────────▼─────────────────┐             │
│   │   Main (Node.js)                 │             │
│   │   - 启动 Python 子进程            │             │
│   │   - 转发 query                    │             │
│   │   - 路由 tool calls → Native      │             │
│   └────────────────┬─────────────────┘             │
│                    │ stdio JSON-RPC                 │
│   ┌────────────────▼─────────────────┐             │
│   │  Python 子进程 (needle_bridge.py)│             │
│   │   - 加载 .pkl(一次)              │             │
│   │   - 每次 stdin 读 query           │             │
│   │   - stdout 写 tool calls          │             │
│   └──────────────────────────────────┘             │
└────────────────────────────────────────────────────┘
```

### 文件结构(已在仓库 `desktop/`)

```
desktop/
├── package.json
├── main.js                  # Electron 主进程
├── needle_bridge.py         # Python stdio 桥
├── preload.js               # 暴露 ipc API
└── renderer/
    ├── index.html
    └── app.js
```

### 关键代码:Python 桥

`desktop/needle_bridge.py`:

```python
import sys, json
from needle.model.run import load_checkpoint, generate

state, config, tokenizer = load_checkpoint("checkpoints/my_best.pkl")

# 一行一次请求
for line in sys.stdin:
    try:
        req = json.loads(line)
        out = generate(
            state, config, tokenizer,
            query=req["query"],
            tools=req["tools"],
            constrained=True,
            max_len=256,
        )
        print(json.dumps({"id": req["id"], "ok": out}), flush=True)
    except Exception as e:
        print(json.dumps({"id": req.get("id"), "err": str(e)}), flush=True)
```

### 关键代码:Electron 主进程

`desktop/main.js`:

```javascript
const { app, BrowserWindow, ipcMain } = require('electron');
const { spawn } = require('child_process');
const path = require('path');

let py, win, pending = new Map(), nextId = 1;

function startPython() {
  py = spawn(path.join(__dirname, 'python/python.exe'),
             [path.join(__dirname, 'needle_bridge.py')]);
  let buf = '';
  py.stdout.on('data', (chunk) => {
    buf += chunk;
    let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx); buf = buf.slice(idx + 1);
      const msg = JSON.parse(line);
      const cb = pending.get(msg.id); pending.delete(msg.id);
      if (cb) cb(msg);
    }
  });
}

ipcMain.handle('generate', async (_e, { query, tools }) => {
  const id = nextId++;
  return new Promise(resolve => {
    pending.set(id, resolve);
    py.stdin.write(JSON.stringify({ id, query, tools }) + '\n');
  });
});

app.whenReady().then(() => {
  startPython();
  win = new BrowserWindow({
    width: 800, height: 600,
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  win.loadFile('renderer/index.html');
});
```

### 打包

```powershell
cd desktop
npm install
npm run build          # electron-builder 打包,Python 一起塞进 resources/
```

产物:`dist/needle-edge-Setup-0.1.0.exe`(Windows)、`.dmg`(Mac)
体积:~ 250 MB(Python ~ 80 MB + JAX ~ 60 MB + 模型 ~ 100 MB + Electron ~ 80 MB)

**优化空间**:
- 用 `nuitka` 把 Python 编成原生 .exe 省 30 MB
- 用 JAX CPU-only wheel 省 200 MB(默认装 GPU 版很大)
- 模型 INT4 量化省 75 MB

---

## 5B · React Native + onnxruntime(需先完成 Step 4)

### 架构

```
┌────────────── React Native App ──────────────┐
│                                              │
│   App.tsx (JSX)                              │
│      │                                       │
│      ▼                                       │
│   needle.ts                                  │
│     - 加载 needle_encoder.onnx               │
│     - 加载 needle_decoder.onnx               │
│     - prefill + greedy decode loop           │
│     - constrained_decoding.ts (Trie)         │
│      │                                       │
│      ▼                                       │
│   handlers.ts (你写的 native 桥)              │
│      │                                       │
│      ▼                                       │
│   NativeModules (Java/Kotlin/Swift)          │
└──────────────────────────────────────────────┘
```

### 安装

```bash
cd mobile
yarn add onnxruntime-react-native
cd ios && pod install && cd ..
```

把 Step 4 输出的两个 ONNX 文件放到:
- `mobile/android/app/src/main/assets/`
- `mobile/ios/needle/Resources/`

(本仓库 `mobile/src/` 已经有骨架代码,需要你接上真实的 ONNX 文件)

### 关键代码(摘自 `mobile/src/needle.ts`):

```typescript
import { InferenceSession, Tensor } from 'onnxruntime-react-native';

let encoder: InferenceSession;
let decoder: InferenceSession;

export async function loadModel() {
  encoder = await InferenceSession.create('needle_encoder.onnx');
  decoder = await InferenceSession.create('needle_decoder.onnx');
}

export async function generate(query: string, tools: any[]): Promise<ToolCall[]> {
  const encInput = await tokenize(query, tools);   // 你的 BPE 实现
  const encOut   = await encoder.run({ input_ids: new Tensor('int32', encInput) });

  let tok = EOS_ID, decKV: any = null, out: number[] = [];
  for (let step = 0; step < 256; step++) {
    const decOut = await decoder.run({
      token: new Tensor('int32', [tok]),
      encoder_kv: encOut.kv,
      self_kv: decKV ?? makeEmptyKV(),
      pos: new Tensor('int32', [step]),
    });
    const logits = decOut.logits.data as Float32Array;
    tok = applyConstrained(logits, state);          // 你的 trie 约束
    if (tok === EOS_ID) break;
    out.push(tok);
    decKV = decOut.new_self_kv;
  }
  return parseToolCalls(detokenize(out));
}
```

### Tokenizer

`onnxruntime-react-native` 不带 BPE。两个选项:
1. 把 SentencePiece 模型 → JS 实现(本 kit 提供 `mobile/src/bpe.ts` 参考)
2. 用 `sentencepiece-js` npm 包

### 体积参考
- onnxruntime-react-native: ~ 25 MB
- 两个 INT8 ONNX: ~ 30 MB
- SentencePiece + 词表: ~ 1 MB
- **总增量 ~ 56 MB**

---

## 5C · cactus-react-native(等官方支持)

### 现状
- [cactus-compute/cactus-react-native](https://github.com/cactus-compute/cactus-react-native) 支持 Gemma / Qwen / LFM / Parakeet 等
- **不支持 Needle**(2026-05),Issue #17 在追

### 一旦支持(预期 API)

```typescript
import { Cactus } from 'cactus-react-native';

const model = await Cactus.load({
  format: 'cact',
  path: 'needle-26m-yourdomain.cact',
});

const result = await model.toolCall({ query, tools });
```

### 准备工作

把你的 `.pkl` 转 `.cact` 还要等 Cactus 官方放出转换器,或 PR #23 落地。
**现在能做的**:
- 在你的 RN app 里把 5B 路径设计成可替换 backend
- `needle.ts` 抽象成 interface,实现 `OnnxBackend` / `CactusBackend` 两个,以后切换

---

## 下一步

→ [Step 6 · Tool call 路由](06-tool-routing.md)
