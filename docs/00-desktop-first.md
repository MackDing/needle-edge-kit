# Strategic Note — 为什么先做桌面端

## TL;DR

把 Needle 当成 **"on-device 命令面板的大脑"** 而不是"塞进手机的小模型"。
桌面优先让你 **2-4 周** 出真产品,而不是 3+ 月。

---

## 桌面优先 vs. 全栈对比

| 维度 | 全栈 | 桌面优先 |
|---|---|---|
| MVP 时间 | 3+ 月 | **2-4 周** |
| 阻塞依赖 | PR #23、Issue #17、`.cact` 转换器 | 零 |
| 模型转换 | 必做,7 个已知 op 坑 | **跳过** |
| Tokenizer 移植 | JS SentencePiece(难) | Python 直接用 |
| Constrained decoder 移植 | JS Trie(中) | Python 直接用 |
| 安装包 | < 60 MB | ~ 200-250 MB |
| 客户群 | 移动端 | PC / Mac 重度用户 |
| 模型迭代 | 每次重转 ONNX | 拖 .pkl 即生效 |
| 商业模式 | 移动端 SaaS / SDK | 桌面订阅 / Pro 版 |

## 为什么桌面端反而更适合 Needle

### 1. Needle 的 single-shot 限制 = 桌面命令面板的天然形态

| 场景 | 适不适合 single-shot |
|---|---|
| 移动端语音助手 | ⚠️ 用户期望多轮纠错 |
| **桌面 Cmd+K 命令面板** | ✅ 一句话一动作就是产品哲学 |
| 移动端聊天 | ❌ 完全不适合 |
| **快捷键触发的 PowerToys** | ✅ 一击即发 |

桌面用户**就是**只想一句话搞定 → Needle 的设计哲学和用户期望天然对齐。

### 2. 桌面端能做的事比手机多 100 倍

```
手机能调用的 native API:                桌面能调用的 native API:
- 灯泡 / 空调 (smart home SDK)           - 文件系统(读/写/批处理)
- 媒体播放                                - PowerShell / Bash / AppleScript
- 通知                                    - 任何已安装的应用
- 联系人                                  - 浏览器 tab / 剪贴板
- 闹钟                                    - 系统设置(显示器、音量、网络)
                                         - Git / Docker / Kubectl
                                         - 数据库 CLI
                                         - 图片/视频/PDF 处理
```

工具池一旦丰富,Needle 的价值才显出来。手机上 10 个工具,桌面上能轻松 50-200 个。

### 3. 用户付费意愿更高

- 手机端工具/快捷指令 app:用户期望 9.99 一次性买断
- 桌面生产力工具(Raycast / Alfred Pro):用户接受 $10-30/月订阅

26M 模型本地跑、零云端开销、隐私强保障 —— 这是桌面订阅产品天然的卖点。

---

## 修订后的路线图

### Week 1:核心可跑
- [x] Step 1-3 跑通(playground、合成数据、微调)
- [ ] **Electron + Python bridge 起飞** ← 关键里程碑
- [ ] 一个真实的"hello world"工具(开计算器/截屏)

### Week 2:OS 集成(选一个先做透)
- [ ] Windows:`host_functions/windows.js` 暴露 30 个常用动作
  - 启动应用、控制音量/亮度、剪贴板、文件操作、PowerShell 一键
- [ ] **全局快捷键**(Win+/ 或 Cmd+Space-like)
- [ ] **系统托盘** + 后台常驻

### Week 3:产品化
- [ ] Auto-updater(electron-updater + GitHub Releases)
- [ ] INT4 量化 → 安装包从 250 MB → 150 MB
- [ ] 一键安装器(NSIS for Windows / DMG for Mac)
- [ ] LoRA 热切换:同一个 app 支持多个"领域"

### Week 4:跨平台对齐
- [ ] Mac:`host_functions/darwin.js`(AppleScript / JXA)
- [ ] Linux:`host_functions/linux.js`(DBus / xdotool)

### 之后(Phase 2)
- 移动端用本 kit 的 `mobile/` 骨架开始,等 PR #23 或 cactus 官方 `.cact` 就绪
- 嵌入式 / 工业终端探索

---

## 跟全栈方案的差异(具体哪些可以**砍掉**)

```diff
needle-edge-kit/
  README.md
  docs/
    00-desktop-first.md         ← 新增,本文
    01-quickstart.md
    02-data-curation.md
    03-finetuning.md
-   04-conversion.md             ← 暂时不需要(Phase 2 再回来)
-   05-mobile-integration.md     ← 暂时不需要
    06-tool-routing.md
  scripts/
    01_playground.ps1
    02_gen_data.py
    02b_review.py
    03_finetune.ps1
-   04_convert.py                ← 暂时不需要
  desktop/                       ← 主战场
    main.js                      (← 加 tray + 全局快捷键)
    needle_bridge.py
    renderer/
    host_functions/              ← 新增,核心价值
      windows.js
      darwin.js  (后)
      linux.js   (后)
    scenarios/desktop_actions.json   ← 新增
    tools/desktop_tools.json         ← 新增
- mobile/                        ← 移到 future/mobile/ 留作参考
+ future/
+   mobile/  (原 mobile/)
```

## 给"产品化、人人可蒸馏"目标的关键改动

桌面优先后,**"人人可蒸馏"** 这件事变得更容易实现:

```
┌──────────────────────────────────────────────────────────────┐
│  需求方:把自家工具/SDK 接进来                                │
│  1. 写 tools/my_tools.json  (10-50 个工具)                   │
│  2. 写 scenarios/my_domain.json (200-500 场景)               │
│  3. 跑 ./scripts/02_gen_data.py + 03_finetune.ps1            │
│  4. 替换 desktop/assets/my_best.pkl                          │
│  5. npm run build → 拿到自己品牌的 .exe                       │
└──────────────────────────────────────────────────────────────┘
```

整个"蒸馏"过程 **不需要懂 ML**,3 个 JSON + 2 个命令搞定。

桌面分发解决了"客户拿到 ONNX 不知道怎么塞进 app"的最后一公里。

## 下一步

→ [Step 1 · Playground](01-quickstart.md) 不变
→ [Step 2 · 数据合成](02-data-curation.md) 用 `desktop/scenarios/` + `desktop/tools/`
→ [Step 3 · 微调](03-finetuning.md) 不变
→ **跳过 Step 4-5**
→ 直接看 [`desktop/README.md`](../desktop/README.md) 和 [`desktop/host_functions/windows.js`](../desktop/host_functions/windows.js)
