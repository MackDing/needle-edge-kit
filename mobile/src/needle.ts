// On-device Needle inference via onnxruntime-react-native.
// REQUIRES: Step 4 conversion to have produced needle_encoder.onnx + needle_decoder.onnx.
//
// This file is a TEMPLATE — sketches the prefill+decode loop. You will need to
// fill in tokenize() / detokenize() with your SentencePiece JS port, and the
// exact tensor shapes will depend on how your converted ONNX exposes the
// KV cache.

import { InferenceSession, Tensor } from 'onnxruntime-react-native';
import { Asset } from 'expo-asset';   // or your RN-equivalent asset loader
import modelMeta from '../assets/model_meta.json';

let encoder: InferenceSession | null = null;
let decoder: InferenceSession | null = null;

export async function loadModel() {
  const encAsset = Asset.fromModule(require('../assets/needle_encoder_int8.onnx'));
  const decAsset = Asset.fromModule(require('../assets/needle_decoder_int8.onnx'));
  await encAsset.downloadAsync();
  await decAsset.downloadAsync();
  encoder = await InferenceSession.create(encAsset.localUri!);
  decoder = await InferenceSession.create(decAsset.localUri!);
}

export interface ToolCall { name: string; arguments: Record<string, any>; }

// TODO: import your BPE port
import { tokenize, detokenize } from './bpe';
import { ConstrainedDecoder } from './constrained';

export async function generate(query: string, tools: any[], maxLen = 256): Promise<ToolCall[]> {
  if (!encoder || !decoder) throw new Error('call loadModel() first');

  const encIds = tokenize(query, tools, modelMeta.max_enc_len);  // Int32Array
  const encMask = new Int32Array(encIds.length).fill(1);

  const encOut = await encoder.run({
    input_ids: new Tensor('int32', encIds, [1, encIds.length]),
    mask:      new Tensor('int32', encMask, [1, encMask.length]),
  });

  const encHidden = encOut.enc_hidden;
  const encKV     = encOut.enc_kv;          // depends on your export

  const constrained = new ConstrainedDecoder(tools);
  const tokens: number[] = [];
  let tok = modelMeta.eos_id;
  let selfKV: Tensor | undefined = undefined;

  for (let pos = 0; pos < maxLen; pos++) {
    const decOut = await decoder.run({
      token:    new Tensor('int32', new Int32Array([tok]), [1, 1]),
      enc_hidden: encHidden,
      enc_mask:   encOut.mask ?? new Tensor('int32', encMask, [1, encMask.length]),
      self_kv:    selfKV ?? makeEmptySelfKV(),
      pos:        new Tensor('int32', new Int32Array([pos]), [1]),
    });

    const logits = decOut.logits.data as Float32Array;
    constrained.applyMask(logits);
    tok = argmax(logits);

    if (tok === modelMeta.eos_id) break;
    tokens.push(tok);
    constrained.step(tok);
    selfKV = decOut.new_self_kv;
  }

  const text = detokenize(tokens);
  try {
    return JSON.parse(text);
  } catch {
    // Model emitted malformed JSON despite constrained decoding — return empty
    return [];
  }
}

function argmax(arr: Float32Array): number {
  let best = 0, bestV = -Infinity;
  for (let i = 0; i < arr.length; i++) if (arr[i] > bestV) { bestV = arr[i]; best = i; }
  return best;
}

function makeEmptySelfKV(): Tensor {
  // Shape depends on your decoder export. Adjust to match.
  const B = 1, L = modelMeta.num_dec_layers, KV = 2, H = modelMeta.num_heads;
  const HD = modelMeta.d_model / modelMeta.num_heads;
  return new Tensor('float32', new Float32Array(0), [B, L, KV, H, 0, HD]);
}
