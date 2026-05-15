# Step 1 — 跑通官方 Playground

> 目标:5 分钟内让 Needle 在你机器上回话,完全理解 query/tools/answer 三段式的数据格式。

## 1. 安装

### Windows (PowerShell)

```powershell
git clone https://github.com/cactus-compute/needle.git
Set-Location needle
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -e ".[gpu]"
```

> **没有 CUDA?** 把 `.[gpu]` 去掉,纯 CPU 也能跑推理(只是慢)。
> **TPU?** 用 `.[tpu]`,但本地基本用不上。

### Linux / macOS

```bash
git clone https://github.com/cactus-compute/needle.git
cd needle
python -m venv .venv
source .venv/bin/activate
pip install -e ".[gpu]"
```

## 2. 启动 playground

```bash
needle playground
```

终端会输出:

```
Downloading checkpoint Cactus-Compute/checkpoints/needle.pkl ...
Loaded model: d_model=512, num_layers=12, num_dec_layers=8
Serving on http://127.0.0.1:7860
```

首次启动会从 HuggingFace 下载 ~100 MB 权重,缓存在 `~/.cache/huggingface/`。

## 3. 第一个请求

打开浏览器 `http://127.0.0.1:7860`,UI 长这样:

```
┌─────────────────────────────────────────────────────────────┐
│  Needle Playground                                          │
├─────────────────────────────────────────────────────────────┤
│  Query:                                                     │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ turn the living room lights to 30% and play jazz      │  │
│  └───────────────────────────────────────────────────────┘  │
│  Tools (JSON):                                              │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ [{"name":"set_light_brightness", ...}, ...]           │  │
│  └───────────────────────────────────────────────────────┘  │
│  [Constrained ✓]  [Generate]                                │
├─────────────────────────────────────────────────────────────┤
│  Output:                                                    │
│  [                                                          │
│    {"name":"set_light_brightness",                          │
│     "arguments":{"room":"living_room","level":30}},         │
│    {"name":"play_music","arguments":{"genre":"jazz"}}       │
│  ]                                                          │
└─────────────────────────────────────────────────────────────┘
```

## 4. 数据格式拆解

### 输入侧
| 字段 | 类型 | 说明 |
|---|---|---|
| `query` | string | 用户的一句话,自然语言 |
| `tools` | array | 工具 schema 列表(可能 1 ~ 数十个) |

工具 schema 字段:

```json
{
  "name": "set_light_brightness",
  "description": "Adjust brightness of a specific light or room.",
  "parameters": {
    "room": {"type": "string", "enum": ["living_room","bedroom","kitchen","all"]},
    "level": {"type": "integer", "description": "0-100 percent"}
  },
  "required": ["room","level"]
}
```

### 输出侧

固定是一个 **JSON 数组**(即使只有一个调用):

```json
[
  {"name": "<snake_case_name>", "arguments": {"<key>": <value>, ...}}
]
```

如果模型判断**无法用工具完成**,会输出:

```json
[]
```

或附一个 `answer` 字段直接回话(罕见,你的产品应当忽略这种)。

## 5. Grammar-constrained decoding

playground UI 默认勾选 `Constrained`。开启后:

- 工具名 token 只能从 trie 里挑(防止幻觉)
- argument key 只能从 schema 里挑
- value 自由生成

**实际部署一定要开**,只在 ablation/debug 时关。

## 6. 你应该试的 10 条 prompt

跑一遍,体感模型边界:

```
1. turn off all the lights                          # 单调用,显式
2. it's getting dark                                # 单调用,隐含
3. lights to 50% and AC to 22                       # 多调用
4. cancel my 3pm meeting                            # tool 没提供时怎么办
5. 把客厅灯关掉                                       # 中文
6. play sm music                                    # 错别字
7. uhh lights down a bit                            # 口语 + ASR-style
8. wake me at 7 tmrw and remind to take meds 8am    # 时间表达
9. (留空)                                            # 空 query
10. 1234567890                                      # 噪声 query
```

观察哪几条**翻车**了 —— 那就是你将来需要在 Step 2 数据里强化的地方。

## 下一步

→ [Step 2 · 合成 2000 条领域数据](02-data-curation.md)
