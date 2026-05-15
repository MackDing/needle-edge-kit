# Step 4 — 转 ONNX / GGUF / .cact

> **这是当前 stack 最大的坑。** 读完这个文档你会理解为什么。

## 现状一览(2026-05)

```
        Needle (.pkl, JAX/Flax)
                │
                ├──→ ONNX (本 kit 实验性 jax2tf 路径) ──→ onnxruntime
                ├──→ ONNX (官方 PR #23,placeholder) ────→ 等
                ├──→ CoreML (官方 PR #23,placeholder) ──→ 等
                ├──→ TFLite (官方 PR #23,placeholder) ──→ 等
                ├──→ .cact (Cactus 私有) ────────────────→ 转换器未公开
                └──→ GGUF ────────────────────────────────→ 不支持
```

## 选哪条?

| 你的场景 | 推荐路径 |
|---|---|
| 桌面 PoC,赶时间上线 | **不转,直接 JAX CPU 推理 + Electron**(见 Step 5A) |
| Android/iOS,愿意趟坑 | 本 kit 的 jax2tf → ONNX |
| Android/iOS,愿意等 | 跟踪 PR #23 + Issue #17 |
| 嵌入式 / MCU | 暂无路径,等 Cactus C++ runtime |

## 路径 A:不转(JAX 推理)

```powershell
# 仍然产出 .pkl,直接用 Step 5 桌面方案
# 跳过这个文档
```

体积大但能跑。Step 5A 用这条。

## 路径 B:jax2tf → tf2onnx(本 kit 实验性)

### 原理

1. `jax.experimental.jax2tf.convert` 把 Flax 的 `apply()` 转 TF `ConcreteFunction`
2. `tf2onnx.convert.from_function` 导 ONNX
3. `onnxruntime.quantization` INT8 化

### 跑

```powershell
python scripts\04_convert.py `
    --checkpoint checkpoints\my_best.pkl `
    --target onnx `
    --quantize int8 `
    --output mobile\assets\needle.onnx `
    --opset 17
```

### 算子兼容性(主要的坑)

Needle 几个特殊算子在 ONNX 上的表现:

| Needle 用 | jax2tf | tf2onnx | onnxruntime | 修复 |
|---|---|---|---|---|
| RoPE (复数旋转) | ✅ | ⚠️ | ✅ | 改 `apply_rope` 用纯实数 sin/cos |
| GQA | ✅ | ✅ | ✅ | 自动展开成多组 attention |
| ZCRMSNorm | ✅ | ✅ | ✅ | 等价 LayerNorm |
| Gated residual | ✅ | ✅ | ✅ | 纯 element-wise |
| `nn.scan` | ⚠️ | ⚠️ | - | 在转换前 `unroll=True` 展开 |
| Block-diag mask | ✅ | ⚠️ | ✅ | 改用显式 mask 张量 |
| `jax.lax.scan` (生成循环) | ❌ | ❌ | - | 生成循环外移到 Python |

**最大的痛点**:Needle 在 `model/run.py` 的解码循环用了 `jax.lax.scan`,这个**不能整体转 ONNX**。

#### 解决方案:拆 prefill / decode

不要把整个 generate 转 ONNX。**拆成两个 ONNX 图**:

```
ONNX-1: encoder(query_tokens, tool_tokens) → encoder_kv_cache
ONNX-2: decode_step(token, encoder_kv_cache, self_kv_cache, pos) → logits + new_self_kv_cache
```

JS/Native 侧自己写 while 循环,每次调一次 ONNX-2,这是工业界标准做法。
本 kit 的 `04_convert.py` 默认输出**两个 .onnx 文件** + 一个 `model_meta.json`:

```
mobile/assets/
├── needle_encoder.onnx       (~ 18 MB INT8)
├── needle_decoder.onnx       (~ 12 MB INT8)
└── model_meta.json           (vocab, EOS, max_len 等)
```

### 验证转换正确性

```powershell
python scripts\04b_verify.py `
    --pkl checkpoints\my_best.pkl `
    --onnx mobile\assets\needle_encoder.onnx mobile\assets\needle_decoder.onnx
```

对一组 sanity prompt 同时跑 JAX 和 ONNX,对比:
- encoder hidden 的 L2 距离 (应 < 1e-2 bf16)
- decoder 第 5 步 logits 的 KL 散度 (应 < 0.05)
- 实际生成的工具调用是否完全一致 (10/10)

如果第 3 条不通过,**不要上线**。

## 路径 C:跟踪 PR #23

[Pull Request #23](https://github.com/cactus-compute/needle/pull/23) 作者 bs258q,2026-05 还在 open。
作者自述 "simplified placeholder code pending completion of the full conversion toolchain"。

**你可以做的**:
- 去 review 加速合并
- 借鉴本 kit 的实现给那个 PR 提 commit
- 或派生出官方的 fork 等他合

## 路径 D:.cact 格式 (Issue #17)

[Issue #17](https://github.com/cactus-compute/needle/issues/17) 问的就是这件事,Cactus 官方还没回应。
`.cact` 是 Cactus 的私有格式,有性能优势(Cactus 报 6000 prefill / 1200 decode)。
**等官方放出转换器或回应这个 issue。**

## INT8 量化注意事项

```python
# scripts/04_convert.py 内部
from onnxruntime.quantization import quantize_dynamic, QuantType
quantize_dynamic(
    model_input=fp32_path,
    model_output=int8_path,
    weight_type=QuantType.QInt8,
    op_types_to_quantize=["MatMul"],   # 别量化 LayerNorm / Softmax
    per_channel=True,
)
```

经验值:
- INT8 体积 ≈ FP16 的 50%,FP32 的 25%
- 精度损失:call_f1 通常掉 0.5-2%
- 静态量化(给标定数据)比动态好,但要准备 100 条代表性 query
- 别用 INT4 —— ONNX runtime 支持仍弱

## 下一步

→ [Step 5 · 嵌入端侧](05-mobile-integration.md)
