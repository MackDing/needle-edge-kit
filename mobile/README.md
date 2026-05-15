# Mobile Integration (React Native)

This directory is a **skeleton**, not a runnable app yet. It depends on:

1. ✅ `mobile/assets/needle_encoder_int8.onnx` — produced by `scripts/04_convert.py`
2. ✅ `mobile/assets/needle_decoder_int8.onnx` — same
3. ✅ `mobile/assets/model_meta.json` — same
4. ✅ Your SentencePiece JS port in `mobile/src/bpe.ts` — **NOT INCLUDED**

## Bootstrap from scratch

```bash
npx react-native init NeedleEdge --version 0.74.0 --template react-native-template-typescript
# Copy our src/ on top
cp -r ../needle-edge-kit/mobile/src ./NeedleEdge/src
cp ../needle-edge-kit/mobile/package.json ./NeedleEdge/package.json
cd NeedleEdge
yarn install
```

## Add native handlers

Edit `android/app/src/main/java/.../SmartHomeModule.java` and `ios/SmartHome.swift` to expose:
- `setBrightness(room, level)`
- `lockDoor(door, locked)`
- ... one for each tool in `tools/example_tools.json`

Register them as `NativeModule` so `NativeModules.SmartHome` works in `handlers.ts`.

## Drop ONNX assets

```
mobile/assets/
├── needle_encoder_int8.onnx
├── needle_decoder_int8.onnx
├── model_meta.json
└── spm.model                    # SentencePiece model from your trained tokenizer
```

For Android, these end up in `android/app/src/main/assets/`.
For iOS, add to Xcode "Copy Bundle Resources".

## Build

```bash
# Android
yarn android

# iOS  
cd ios && pod install && cd ..
yarn ios
```

## Caveats (read carefully)

- **No JS BPE included** — `mobile/src/bpe.ts` doesn't exist yet. Options:
  - Port [sentencepiece](https://github.com/google/sentencepiece) to JS (hard)
  - Use [`@xenova/transformers`](https://huggingface.co/docs/transformers.js) WASM BPE (recommended)
  - Wrap SentencePiece C++ as a native module (best perf)

- **Constrained decoding** in `mobile/src/constrained.ts` also needs porting from
  `needle/model/constrained.py` (Trie + state machine). Not trivial but mechanical.

- **First run is slow** (~ 2-3s to load both ONNX files on a mid-range Android).
  Cache `InferenceSession` for app lifetime.

See [../docs/05-mobile-integration.md](../docs/05-mobile-integration.md) for the full story.
