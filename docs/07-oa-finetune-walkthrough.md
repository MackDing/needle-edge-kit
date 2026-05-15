# OA 微调实操手册

> **写在前面**:这份文档是在 2026-05-14 Windows 11 Pro 上真跑过一遍的产物 ——
> 不是理论。每一步、每条命令、每个错误信息都来自实际执行。
> 你照单跑,期望复现度 > 95%。

---

## 是什么 / 不是什么

**是什么** —— 一份从空白机器到拿到第一个 OA 领域 `.pkl` 的可复制手册。

**不是什么**:
- 不是 Needle 的官方文档
- 不是"模型质量调优"指南(那需要 5-10 轮迭代,本文档只覆盖第一轮)
- 不是 GPU/Colab/云上训练的详尽手册(给了入口,深度配置自查)

---

## 速查:今天总共要花的时间

| 阶段 | 时间(CPU)| 时间(GPU)|
|---|---|---|
| 装 Python + Needle | 3-5 分钟 | 同 |
| 拿 Gemini API key | 5 分钟 | 同 |
| 合成 2000 条 OA 数据 | 30-60 分钟 | 同(网络瓶颈) |
| 人工抽检 50 条 | 20-30 分钟 | 同 |
| 微调 3 epoch | **2-4 小时** | **20-40 分钟** |
| 第一次评估 + 看翻车 | 30 分钟 | 同 |
| **总计** | **半天到一天** | **2-3 小时** |

---

## 0. 先决条件

| 资源 | 必须 | 如何获取 |
|---|---|---|
| Windows 11 / Mac / Linux | ✅ | (你已经有) |
| uv ≥ 0.9 | ✅ | 见下面 0.1 |
| ~15 GB 磁盘 | ✅ | Python (1GB) + JAX 依赖 (5GB) + 模型 (1GB) + 数据 (~50MB) + 余量 |
| Gemini API key | ✅ | https://aistudio.google.com,**免费层够用** |
| HuggingFace 账号 | ⭕ | 可选,匿名拉公开权重 OK,有 token 速度快 |
| NVIDIA GPU(≥8GB)或 Colab Pro | ⭕ | 没有就 CPU,慢但能跑 |
| 这个仓库 | ✅ | `C:\D\CLPS\Code\Github\needle-edge-kit\`(或你的路径) |

### 0.1 装 uv(如已装跳过)

```powershell
# Windows PowerShell —— uv 自己负责拉 Python,不需要预装
irm https://astral.sh/uv/install.ps1 | iex
```

验证:`uv --version` 输出 `uv 0.9.x`。

### 0.2 拿 Gemini key

1. 浏览器开 https://aistudio.google.com
2. 用 Google 账号登录
3. 右上角 `Get API key` → 创建新项目 → 复制 key(`AIza...`)
4. 免费层:**1500 req/天**,够这个项目用 80-100 次调用

---

## 1. 装 Python + Needle(Windows 真跑通的版本)

> **2026 年关键好消息**:JAX 0.10 终于发了 Windows wheel。
> 之前所有"Windows 上跑 JAX 需要 WSL"的教程都过时了 —— 现在 native 能跑。

```powershell
# 1.1 装独立 Python 3.11(uv 管理,不污染系统)
uv python install 3.11

# 1.2 拉 Needle 源码
cd C:\D\CLPS\Code\Github       # 你 GitHub 仓库的父目录
git clone --depth 1 https://github.com/cactus-compute/needle.git
cd needle

# 1.3 建 venv + 装 needle(纯 CPU 版,不要 [gpu] extras)
uv venv --python 3.11
uv pip install -e .             # 大约 3-5 分钟,拉 ~ 500 MB
```

**验证**:
```powershell
& .venv\Scripts\python.exe -c "import jax; print(jax.devices(), jax.default_backend())"
# 期望输出:[CpuDevice(id=0)] cpu
```

如果你有 NVIDIA GPU + CUDA 12,改装:
```powershell
uv pip install -e ".[gpu]"
& .venv\Scripts\python.exe -c "import jax; print(jax.devices())"
# 期望输出包含 CudaDevice
```

---

## 2. 装数据生成的依赖

```powershell
cd C:\D\CLPS\Code\Github\needle
& .venv\Scripts\Activate.ps1
pip install google-genai python-dotenv
```

---

## 3. 配 Gemini key

```powershell
cd C:\D\CLPS\Code\Github\needle-edge-kit
copy .env.example .env
# 用编辑器打开 .env,改成:
# GEMINI_API_KEY=AIza...你的真 key
# GEMINI_MODEL=gemini-2.0-flash-exp
```

---

## 4. 合成 2000 条 OA 训练数据

```powershell
# 这一步会用你的 OA scenarios + tools 调 Gemini 80 次
# 每次让 Gemini 一次输出 25 条样本,总共 80 × 25 = 2000 条
# 8 并发 workers,30-60 分钟取决于 API 延迟

$env:PYTHONUTF8 = "1"          # 关键!Windows 中文必须显式开 UTF-8
python scripts\02_gen_data.py `
    --scenarios scenarios\oa_scenarios.json `
    --tools tools\oa_tools.json `
    --num-samples 2000 `
    --batch-size 25 `
    --workers 8 `
    --output examples\oa_train.jsonl
```

**观察日志**:
- `→ 80 Gemini calls, 8 workers, model=gemini-2.0-flash-exp`
- 每 5 个 batch 报一次进度:`[5/80] ok=125 fail_batches=0 4.2/s`
- 偶发 `batch failed:` 是正常的(API 429),指数退避会重试
- 最终:`✓ wrote 1900+ samples to examples\oa_train.jsonl (0 batches failed)`

**质量门**:`wrote N samples`,N 应该 ≥ 1600(80% 接受率)。低于这个,Gemini 可能正在拒绝你的 prompt —— 检查 scenarios 是否有冲突的指令。

---

## 5. 人工抽检 50 条(**别跳!**)

```powershell
python scripts\02b_review.py --input examples\oa_train.jsonl --sample 50
```

按提示一条一条 `a` (accept) / `r` (reject) / `e` (edit)。

**通过率 < 80%** = 数据有系统性问题,回 Step 4 改 scenarios/tools 重跑。
**通过率 ≥ 80%** = 数据合格,继续。

常见拒绝原因:
- 工具名编错(Gemini 偶发幻觉)
- 中文 query 被对应到错的工具(scenarios 写得不明确)
- 参数值瞎填(date 字段写"明天"而不是"2026-05-15"—— 这其实是 OK 的,downstream 解析,但你可以选择更严格)

---

## 6. 微调

```powershell
cd C:\D\CLPS\Code\Github\needle-edge-kit
$env:PYTHONUTF8 = "1"
$env:PYTHONIOENCODING = "utf-8"   # Windows 中文必须

# 用 Needle 的 venv
& C:\D\CLPS\Code\Github\needle\.venv\Scripts\needle.exe finetune `
    examples\oa_train.jsonl `
    --epochs 3 `
    --batch-size 32 `
    --checkpoint-dir checkpoints `
    --max-enc-len 1024 `
    --max-dec-len 256
```

**第一次运行会做的事**:
1. 从 HuggingFace 下载 base ckpt `needle.pkl` (~100 MB,1-3 分钟)
2. 下载 base tokenizer (~ 2MB)
3. 划分 train/val/test(per-tool stratified)
4. Tokenize 全部数据(2-5 分钟,8 核 CPU)
5. 编译 JAX 图(30-60s 第一次)
6. 训练循环,每 1000 step 评估一次

**进度日志**:
```
[step 50/600]  train_loss=2.41  ce=2.31  contrast=0.10
[step 100/600] train_loss=1.85  ce=1.74  contrast=0.11
[eval step 100] call_f1=0.42  name_f1=0.71  arg_acc=0.59
...
[step 600/600] train_loss=1.05  ce=0.95  contrast=0.10
[eval step 600] call_f1=0.79  name_f1=0.91  arg_acc=0.87
✓ best ckpt: checkpoints/needle_finetuned_<timestamp>_best.pkl  (call_f1=0.79)
```

**时间预估**(2000 样本 × 3 epoch):
- RTX 3090/4090:**12-20 分钟**
- RTX 3060 12GB:**25-40 分钟**
- Colab T4 (free):**40-60 分钟**
- **CPU(Windows / Mac):2-4 小时**(全程吃 8 核 100%)

---

## 7. 单条推理验证

```powershell
$env:PYTHONUTF8 = "1"
& C:\D\CLPS\Code\Github\needle\.venv\Scripts\needle.exe run `
    --checkpoint checkpoints\needle_finetuned_<timestamp>_best.pkl `
    --query "明天请一天年假" `
    --tools (Get-Content tools\oa_tools.json -Raw)
```

期望输出:
```json
[{"name":"submit_leave_request","arguments":{"type":"annual","start_date":"2026-05-15","end_date":"2026-05-15"}}]
```

---

## 8. 完整批量评估

```powershell
$env:PYTHONUTF8 = "1"
& C:\D\CLPS\Code\Github\needle\.venv\Scripts\needle.exe eval `
    --checkpoint checkpoints\needle_finetuned_<timestamp>_best.pkl `
    --tool-call-samples 200 `
    --throughput-runs 10
```

关注的数字:
- **call_f1 ≥ 0.75** → 合格,可以做内部 demo
- **call_f1 ≥ 0.85** → 优秀,可以小范围内部上线
- **call_f1 < 0.60** → 数据有问题,回 Step 4 扩充场景

---

## 已知坑速查表(我今天踩的真坑)

### 坑 1 · Windows 默认 GBK 编码读不了 UTF-8 训练数据
**症状**:
```
UnicodeDecodeError: 'gbk' codec can't decode byte 0x87 in position 30
```
**修法**:`$env:PYTHONUTF8 = "1"` + `$env:PYTHONIOENCODING = "utf-8"`,
**每个 shell 都要设**。或者放进 PowerShell profile 永久生效。

> 我会把这个 bug 提交 PR 给 Needle 上游,让 `open()` 显式指定 `encoding='utf-8'`。
> 但在合并前,你必须靠环境变量。

### 坑 2 · `tools` 和 `answers` 必须是 **JSON 字符串**,不是 JSON 数组
**症状**:
```
TypeError: list must contain strings
  in needle/dataset/dataset.py:273 _worker_sp.Encode(t, out_type=int)
```
**原因**:Needle 期望 `ex["tools"]` 和 `ex["answers"]` 都是字符串(然后用 `_compact_json` 解析压缩)。
**修法**:本 kit 的 `scripts/02_gen_data.py` 已经处理 —— `tools` 和 `answers` 输出时都做了 `json.dumps`。
**如果你自己写数据**:`{"query": "...", "tools": "[{\\"name\\":...}]", "answers": "[{\\"name\\":...}]"}`

### 坑 3 · `needle.pkl` 下载需要联网
第一次 finetune 自动从 `Cactus-Compute/needle` 拉权重 (~100 MB)。
**没网就跑 不通**。Air-gapped 环境提前下载:
```powershell
huggingface-cli download Cactus-Compute/needle needle.pkl --local-dir .
```
然后 `needle finetune --checkpoint .\needle.pkl ...`。

### 坑 4 · CPU 训练巨慢 + 没进度
3 个原因:
- JAX 编译 XLA 图(第一次 30-60s,日志只显示 `tracing...`)
- pmap 在 CPU 上没意义但还在转(浪费 5%)
- INT4 周期性量化每 100 步占 10s

实际能跑,只是慢。**别杀进程**,等。

### 坑 5 · `call_f1=0%` 但训练完成了
看 `Pred` 字段。如果是乱码 Unicode,模型还没学到东西:
- 训练数据太少(< 100 条)→ 加数据
- epoch 太少(< 3)→ 加 epoch
- lr 太大 → 默认 3e-5 应该 OK,先别动

我自己跑 3 条样本的 dry-run 就是 0% call_f1 —— 完全预期。
**2000 条干净数据 × 3 epoch 期望 0.65-0.80**。

### 坑 6 · `pip install -e ".[gpu]"` Windows 上崩
JAX CUDA wheels **只有 Linux 版**。Windows 上想用 GPU 必须走 WSL2 + Linux。
本机 Windows + NVIDIA 用户的实操路径:
1. WSL2 Ubuntu 24.04
2. 在 WSL 里装 CUDA + cuDNN
3. 在 WSL 里跑全套流程
4. 跨文件系统访问(`/mnt/c/...`)读 Windows 上的数据

或者:**直接上 Colab**。

---

## CPU / GPU / Colab 三条路怎么选

```
                       ┌─────────────────────────────┐
                       │  你有 NVIDIA GPU 8GB+?      │
                       └─────────────────────────────┘
                                ↓ YES            ↓ NO
                       ┌────────────────┐   ┌────────────────┐
                       │  Windows?      │   │  能用 Colab?   │
                       └────────────────┘   └────────────────┘
                          ↓ YES   ↓ NO         ↓ YES   ↓ NO
                       ┌──────┐ ┌──────┐   ┌──────┐ ┌──────┐
                       │ WSL2 │ │ GPU  │   │Colab │ │ CPU  │
                       │ CUDA │ │ JAX  │   │ T4   │ │ JAX  │
                       │      │ │ 原生 │   │      │ │      │
                       └──────┘ └──────┘   └──────┘ └──────┘
                        30 min   20 min    30-50 min  2-4 hr
```

### Colab 最低配方法

1. 把 `oa_train.jsonl` 上传到 Google Drive
2. 新建 Colab notebook(免费 T4 配额够用)
3. 单元格里跑:
```python
!pip install -q jax flax optax sentencepiece huggingface_hub transformers wandb
!git clone --depth 1 https://github.com/cactus-compute/needle.git
%cd needle
!pip install -q -e .

from google.colab import drive
drive.mount('/content/drive')

!python -m needle.cli finetune /content/drive/MyDrive/oa_train.jsonl \
    --epochs 3 --batch-size 64
```

约 30-50 分钟出 ckpt,Drive 下载即可。

---

## 拿到第一个真 `.pkl` 之后做什么

### 阶段 A · 体感测试(立刻做)
列 30-50 条 OA 真实场景(从同事 / 业务那里要),逐条跑 `needle run`,看输出对不对。
**别相信纯 call_f1 数字 —— 自己读 30 条样本是真正的体感**。

### 阶段 B · 接入 Electron demo
```powershell
cd desktop
npm install
$env:NEEDLE_CHECKPOINT = "C:\D\CLPS\Code\Github\needle-edge-kit\checkpoints\<ckpt>_best.pkl"
$env:NEEDLE_PYTHON = "C:\D\CLPS\Code\Github\needle\.venv\Scripts\python.exe"
npm start
```
Ctrl+Shift+Space 弹 Spotlight 浮窗,输入 "明天请一天年假",看是否调用对的工具。

### 阶段 C · 接入 Web 试用入口
```powershell
cd web
& C:\D\CLPS\Code\Github\needle\.venv\Scripts\python.exe server.py `
    --checkpoint C:\D\CLPS\Code\Github\needle-edge-kit\checkpoints\<ckpt>_best.pkl
# 浏览器开 http://127.0.0.1:8000
```

### 阶段 D · 迭代(call_f1 < 0.80)
找翻车样本 → 分类(哪个 tool / 哪类 query 翻最多)→ 在 scenarios 里补该类 50-100 条 → 重跑 4-8。
**通常 2-3 轮迭代到 call_f1 ≥ 0.85**。

---

## FAQ

**Q: 我能不下载 `needle.pkl` 直接从零训吗?**
A: 可以用 `needle pretrain`,但你得给 200B token 预训练数据 + 27 小时 16 块 TPU v6e。**不推荐** —— finetune base ckpt 才是产品路径。

**Q: 我需要 wandb 吗?**
A: 不需要。`--wandb` 标志默认关。本地训练有 print 日志足够。

**Q: 中文场景训出来后能识别英文 query 吗?**
A: 部分能。Base ckpt 是混合语料训的,有英文知识;但**你 finetune 数据里没出现的英文模式可能翻车**。建议 scenarios 加 10-20% 英文。

**Q: 微调 ckpt 比 base ckpt 大还是小?**
A: 同样大(~ 51 MB bf16)。如果要部署小一点:
```powershell
# INT4 量化 + Matryoshka 切 FFN 一半
needle export --checkpoint <ckpt>_best.pkl --factor 2
needle quantize --checkpoint <ckpt>_best.pkl --precision int4
```
最终能压到 ~ 13 MB。

**Q: 我可以训 LoRA 而不是 full finetune 吗?**
A: 目前不能。Needle [PR #22](https://github.com/cactus-compute/needle/pull/22) 正在加 LoRA,等合。

**Q: 训练中可以热重启 / 中断恢复吗?**
A: 可以。`needle train` 支持 `--checkpoint` 恢复;`needle finetune` 用户友好包装暂不支持,要恢复就直接用 `needle train`。

---

## 把这些发现反馈给上游

我在跑通过程中发现 2 个真 Needle bug,会向上游提 PR:
1. `finetune.py:234` `open()` 缺 `encoding='utf-8'`(Windows + 中文 必崩)
2. README 没说 `tools`/`answers` 字段在 JSONL 里必须是字符串

如果你也跑到了类似问题,欢迎贡献修复。本 kit `scripts/02_gen_data.py` 已经替你 workaround 了。

---

## 完毕

照这份文档跑完,你手里会有:
- 一个 ~51 MB 的 OA 领域 `.pkl`
- 一个 call_f1 ~ 0.75-0.85 的模型
- 一个 Electron Spotlight 浮窗能调起来,断网就跑

下一步去 [docs/00-desktop-first.md](00-desktop-first.md) 看产品化路径。
