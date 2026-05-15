"""
Convert a Needle .pkl checkpoint to ONNX via jax2tf -> tf2onnx.

This is the EXPERIMENTAL path. Official PR #23 (bs258q) is still placeholder.

Limitations:
  - We do NOT export the generation loop (jax.lax.scan unrolls poorly to ONNX).
  - Instead we export TWO graphs:
        needle_encoder.onnx   :  (input_ids, mask) -> enc_hidden, enc_kv_cache
        needle_decoder.onnx   :  (token, enc_kv, self_kv, pos) -> logits, new_self_kv
  - Your JS/Native runtime is responsible for the while-loop, EOS check, and
    grammar-constrained logit masking (see mobile/src/needle.ts).

Usage:
    python scripts/04_convert.py \
        --checkpoint checkpoints/my_best.pkl \
        --output-dir mobile/assets \
        --quantize int8

This script is a TEMPLATE — it will fail without further work on op-level
compatibility (see docs/04-conversion.md). Treat the comments as a checklist.
"""

import argparse
import json
import os
import pickle
import sys
from pathlib import Path


def convert(checkpoint_path: str, output_dir: str, quantize: str, opset: int):
    try:
        import jax
        import jax.numpy as jnp
        import tensorflow as tf
        from jax.experimental import jax2tf
        import tf2onnx
        from needle.model.architecture import (
            SimpleAttentionNetwork,
            TransformerConfig,
        )
    except ImportError as e:
        print(f"missing dependency: {e}", file=sys.stderr)
        print("install:  pip install tensorflow tf2onnx onnx onnxruntime", file=sys.stderr)
        sys.exit(1)

    # 1) Load checkpoint
    with open(checkpoint_path, "rb") as f:
        data = pickle.load(f)
    params = data["params"]
    config = TransformerConfig(**data["config"])
    print(f"loaded: d_model={config.d_model}  num_layers={config.num_layers}  vocab={config.vocab_size}")

    model = SimpleAttentionNetwork(config)
    out_dir = Path(output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    # 2) Define encoder forward (concrete, no scan over generation)
    def encoder_fn(input_ids, mask):
        # NOTE: you may need to patch SimpleAttentionNetwork to expose a pure
        # encoder forward without the contrastive head. See architecture.py.
        return model.apply({"params": params}, input_ids, mask, method="encode")

    # 3) Define a single-step decoder
    def decoder_step_fn(token, enc_hidden, enc_mask, self_kv, pos):
        return model.apply(
            {"params": params}, token, enc_hidden, enc_mask, self_kv, pos,
            method="decode_step",
        )

    # 4) jax2tf -> tf.function
    tf_encoder = tf.function(jax2tf.convert(encoder_fn, enable_xla=False), autograph=False)
    tf_decoder = tf.function(jax2tf.convert(decoder_step_fn, enable_xla=False), autograph=False)

    # 5) Concretize with example shapes
    B, ENC, DEC, D, H = 1, config.max_enc_len, 1, config.d_model, config.num_heads
    sample_enc_ids = tf.zeros((B, ENC), dtype=tf.int32)
    sample_enc_mask = tf.ones((B, ENC), dtype=tf.int32)
    enc_concrete = tf_encoder.get_concrete_function(sample_enc_ids, sample_enc_mask)

    # 6) Export encoder
    onnx_enc_path = out_dir / "needle_encoder.onnx"
    print(f"exporting encoder → {onnx_enc_path}")
    tf2onnx.convert.from_concrete_function(
        enc_concrete,
        opset=opset,
        output_path=str(onnx_enc_path),
    )

    # 7) Export decoder step
    # (Pseudo — actual shapes depend on cache layout in architecture.py)
    sample_tok      = tf.zeros((B, 1), dtype=tf.int32)
    sample_enc_hid  = tf.zeros((B, ENC, D), dtype=tf.float32)
    sample_enc_msk  = tf.ones((B, ENC), dtype=tf.int32)
    sample_self_kv  = tf.zeros((B, config.num_dec_layers, 2, H, 0, D // H), dtype=tf.float32)
    sample_pos      = tf.zeros((B,), dtype=tf.int32)
    dec_concrete = tf_decoder.get_concrete_function(
        sample_tok, sample_enc_hid, sample_enc_msk, sample_self_kv, sample_pos
    )
    onnx_dec_path = out_dir / "needle_decoder.onnx"
    print(f"exporting decoder → {onnx_dec_path}")
    tf2onnx.convert.from_concrete_function(
        dec_concrete,
        opset=opset,
        output_path=str(onnx_dec_path),
    )

    # 8) Quantize
    if quantize in ("int8", "uint8"):
        from onnxruntime.quantization import quantize_dynamic, QuantType
        for p in (onnx_enc_path, onnx_dec_path):
            q_path = p.with_name(p.stem + "_int8.onnx")
            print(f"quantizing → {q_path}")
            quantize_dynamic(
                model_input=str(p),
                model_output=str(q_path),
                weight_type=QuantType.QInt8 if quantize == "int8" else QuantType.QUInt8,
                op_types_to_quantize=["MatMul"],
                per_channel=True,
            )

    # 9) Write metadata
    meta = {
        "vocab_size":     config.vocab_size,
        "d_model":        config.d_model,
        "num_layers":     config.num_layers,
        "num_dec_layers": config.num_dec_layers,
        "num_heads":      config.num_heads,
        "num_kv_heads":   config.num_kv_heads,
        "max_enc_len":    config.max_enc_len,
        "max_dec_len":    config.max_dec_len,
        "pad_id":  0,
        "eos_id":  1,
        "bos_id":  2,
        "unk_id":  3,
    }
    with open(out_dir / "model_meta.json", "w", encoding="utf-8") as f:
        json.dump(meta, f, indent=2)
    print(f"✓ meta → {out_dir/'model_meta.json'}")
    print("\nNEXT: run scripts/04b_verify.py to compare ONNX vs JAX output")
    print("WARN: this is a template. See docs/04-conversion.md for known op-level issues.")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--checkpoint", required=True)
    ap.add_argument("--output-dir", default="mobile/assets")
    ap.add_argument("--quantize", choices=["none", "int8", "uint8"], default="int8")
    ap.add_argument("--opset", type=int, default=17)
    args = ap.parse_args()
    convert(args.checkpoint, args.output_dir, args.quantize, args.opset)


if __name__ == "__main__":
    main()
