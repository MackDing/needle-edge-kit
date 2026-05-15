# Step 2 — 合成 2000 条领域数据

> 目标:把你的产品 domain 转成 Needle 能学的训练数据。**这一步决定模型 80% 的最终质量。**

## 数据格式

最终产物是一个 JSONL 文件,每行:

```json
{
  "query": "turn the living room lights to 30% and play jazz",
  "tools": [{"name":"set_light_brightness","description":"...","parameters":{...}}, ...],
  "answer": [
    {"name":"set_light_brightness","arguments":{"room":"living_room","level":30}},
    {"name":"play_music","arguments":{"genre":"jazz"}}
  ]
}
```

## 准备 3 个输入

### A · `tools/my_tools.json` — 工具集合(10-50 个)

模型会**学到所有出现过的工具**。设计建议:

1. **粒度统一** — 不要既有 `do_anything` 又有 `set_pixel`
2. **互不重叠** — 不要 `set_volume` + `change_volume`,模型会困惑
3. **参数尽量 enum** — 自由字符串参数,模型容易胡编
4. **描述用大白话** — 像写给完全不懂代码的实习生看

示例:

```json
[
  {
    "name": "set_light_brightness",
    "description": "Adjust brightness of lights in a room. Use this when the user wants lights brighter, dimmer, or at a specific level.",
    "parameters": {
      "room": {
        "type": "string",
        "enum": ["living_room", "bedroom", "kitchen", "bathroom", "all"],
        "description": "Which room"
      },
      "level": {
        "type": "integer",
        "description": "Brightness 0-100. Use 0 for off, 100 for max."
      }
    },
    "required": ["room", "level"]
  }
]
```

### B · `scenarios/my_domain.json` — 用户可能说的话(300-1000 条)

这是模型学**口语映射**的关键。

```json
{
  "domain": "smart_home_v1",
  "scenarios": [
    "turn off the kitchen light",
    "把客厅灯调到50",
    "好暗",
    "leaving for work, lock everything",
    "kids are sleeping — make it dim and quiet",
    "uhh play that jazz song again",
    "10pm timer for laundry",
    "set ac to 24 and lights warm",
    "I'm cold",
    "..."
  ]
}
```

#### 必须覆盖的 7 类样本

| 类别 | 占比建议 | 示例 |
|---|---|---|
| **显式单调用** | 25% | "turn off bedroom light" |
| **隐含意图** | 15% | "it's too bright" → set_brightness(down) |
| **多调用顺序** | 15% | "lock door then turn off lights" |
| **多调用并行** | 15% | "lights 50% and AC 22" |
| **错别字/ASR** | 10% | "tunr of lite", "play sm music" |
| **混合语言** | 10% | "把灯 dim 一点" |
| **无法完成** | 10% | "cancel my flight"(没这工具) |

最后一类很关键 —— 让模型学会**输出 `[]`**,而不是硬编。

### C · `.env` — Gemini API key

```dotenv
# .env (don't commit!)
GEMINI_API_KEY=AIza...your_key_here
GEMINI_MODEL=gemini-2.0-flash-exp   # 或 gemini-2.5-flash 之类
```

去 [aistudio.google.com](https://aistudio.google.com) 拿,免费额度够跑 2000 条。

## 跑生成

```powershell
python scripts\02_gen_data.py `
    --scenarios scenarios\my_domain.json `
    --tools tools\my_tools.json `
    --num-samples 2000 `
    --batch-size 25 `
    --workers 8 `
    --output examples\train.jsonl `
    --output-jsonl examples\raw.jsonl    # 也存原始 Gemini 输出
```

参数说明:
- `--num-samples`:总条数。1500 起步,2000-5000 是甜区,>10000 边际收益小
- `--batch-size`:Gemini 每次调用让它一次输出多少条
- `--workers`:并行调用数。8 通常 OK,API quota 紧就降到 4

跑完大概 15-30 分钟,看 `--workers` 和 Gemini 当时延迟。

## 人工抽检(**不要跳过**)

```powershell
python scripts\02b_review.py --input examples\train.jsonl --sample 50
```

工具会:
- 随机抽 50 条
- 一条一条让你按 ✓ / ✗ / 编辑
- 输出统计:`accept_rate`, `top failure modes`

**acceptance < 80%** → 数据质量不达标。常见问题:

| 症状 | 原因 | 修复 |
|---|---|---|
| 工具名错 | 工具描述歧义 | 重写 description,强调使用场景 |
| 参数值瞎编 | enum 没写全 | 把 enum 选项补全 |
| 多调用顺序乱 | 场景过短 | 场景里写得更明确 |
| 中文翻车 | 场景纯英文 | 加 200+ 中文场景 |

修完场景文件,**重跑生成**。

## 数据增强(可选,提升 5-10%)

```powershell
python scripts\02c_augment.py --input examples\train.jsonl --output examples\train_aug.jsonl
```

会做:
- **同义改写**(用本地小模型)
- **typo 注入**(键盘相邻误击)
- **大小写抖动**
- **空格/标点扰动**

最终 2000 条 → 增强成 ~6000 条。

## 划分 train/val/test

`needle finetune` 默认自动做 **per-tool stratified split**(80/10/10),不需要你预切。

如果想手动:

```powershell
python scripts\02d_split.py --input examples\train.jsonl --train-ratio 0.85
```

## 下一步

→ [Step 3 · 微调](03-finetuning.md)
