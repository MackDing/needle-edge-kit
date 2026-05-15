# Step 3 — 微调出你的 .pkl

## 单条命令

```powershell
needle finetune examples\train.jsonl `
    --epochs 3 `
    --batch-size 32 `
    --checkpoint-dir checkpoints `
    --max-enc-len 1024 `
    --max-dec-len 256
```

不指定 `--checkpoint` → 自动从 HF `Cactus-Compute/checkpoints/needle.pkl` 拉 base。

## 关键超参

| 超参 | 推荐 | 说明 |
|---|---|---|
| `--epochs` | 3 (2k 数据) ~ 5 (10k+) | 太多会过拟合,call-F1 会先涨后跌 |
| `--batch-size` | 32 (12GB GPU) ~ 128 (40GB) | OOM 就降一半 |
| `--lr` | 3e-5 (默认) | 别动 |
| `--w-name` | 2.0 | tool name 权重,通常默认就行 |
| `--w-value` | 4.0 | argument value 权重 |
| `--w-key` | 1.5 | argument key 权重 |
| `--max-enc-len` | 1024 | 工具多就调到 2048 |
| `--max-dec-len` | 256 | 多调用场景调到 384 |

## 训练过程会看到什么

```
[step 50/300]  train_loss=2.41  ce=2.31  contrast=0.10  lr=2.1e-5
[step 100/300] train_loss=1.85  ce=1.74  contrast=0.11  lr=3.0e-5
[eval step 100] call_f1=0.42  name_f1=0.71  arg_acc=0.59
[step 200/300] train_loss=1.32  ce=1.21  contrast=0.11  lr=2.4e-5
[eval step 200] call_f1=0.68  name_f1=0.84  arg_acc=0.81
[step 300/300] train_loss=1.05  ce=0.95  contrast=0.10  lr=0.0e-5
[eval step 300] call_f1=0.79  name_f1=0.91  arg_acc=0.87
✓ best ckpt: checkpoints/finetune_best.pkl  (call_f1=0.79)
```

## 看懂三个指标

- **call_f1** = 整条工具调用是否正确(name + 所有 arg 都对)。**这是最终目标。**
- **name_f1** = 只看 tool name 是否对。
- **arg_acc** = 在 name 正确的样本里,argument 值对的比例。

**期望值**(2000 高质量样本,3 epoch):
- call_f1 ≥ 0.75 = 合格,可上线
- call_f1 ≥ 0.85 = 优秀
- call_f1 < 0.60 = 数据有问题,回 Step 2

## 不收敛 / 效果差的常见原因

| 症状 | 诊断 | 处理 |
|---|---|---|
| loss 不降 | lr 太小 / 数据太少 | 加数据;或 `--lr 5e-5` |
| call_f1 卡在 name_f1 一半 | argument 学不会 | `--w-value 6.0`;检查 value 是否在工具 enum 里 |
| name_f1 涨,call_f1 不涨 | argument hallucination | 数据里 argument 多样性不够 |
| val loss 涨 / call_f1 跌 | 过拟合 | 减 epoch,或加更多场景 |
| 中文翻车 | 数据中文样本少 | scenarios 加 30% 中文 |

## 单条推理验证

训练完跑一条:

```powershell
needle run --checkpoint checkpoints\finetune_best.pkl `
           --query "turn off all lights" `
           --tools (Get-Content tools\my_tools.json -Raw)
```

期望输出:
```json
[{"name":"set_light_brightness","arguments":{"room":"all","level":0}}]
```

## 批量评估

```powershell
needle eval --checkpoint checkpoints\finetune_best.pkl `
            --tool-call-samples 200 `
            --throughput-runs 10
```

会打印完整的 evaluation 矩阵 + 吞吐量(tok/s)。

## 进阶:LoRA 微调

PR #22 (bs258q) 正在加 LoRA 适配器支持。合并后,你可以:

```powershell
needle finetune examples\train.jsonl --lora --lora-rank 8
```

输出只有几 MB,可以多个 LoRA 切换不同领域。**目前 main 分支还没合,等。**

## 下一步

→ [Step 4 · 转 ONNX](04-conversion.md)
