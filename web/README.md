# Web — 试用入口 / Funnel

> **不是产品本体,是漏斗入口。**
> 客户 30 秒上手 → 喜欢 → 下载桌面版 → 完整体验。

## 定位

| 用法 | Web 版 | 桌面版 |
|---|---|---|
| 安装门槛 | 0 | ~ 200 MB |
| 工作离线 | ❌ 需服务端 | ✅ 完全离线 |
| 工具数 | 6 个浏览器 API | 15+ OS native |
| 隐私 | query 走网络 | 不出机器 |
| 角色 | 营销 / 演示 / 试用 | 真产品 |

## 浏览器能调的工具(只这 6 个)

| 工具 | 实现 |
|---|---|
| `clipboard_get` | `navigator.clipboard.readText()`(需用户手势授权) |
| `clipboard_set` | `navigator.clipboard.writeText()` |
| `send_notification` | `new Notification()`(需权限) |
| `set_timer` | `setTimeout` + 完成时发通知 |
| `open_url` | `window.open()` |
| `show_message` | 仅在结果区域显示文本(兜底用) |

桌面版多的 9 个(`launch_app` / `run_shell` / `set_system_volume` / `screenshot` / …)在浏览器**根本调不动**。这就是为什么 Web 版不能替代桌面。

## 跑起来

```bash
pip install fastapi uvicorn pydantic
python web/server.py --checkpoint checkpoints/my_best.pkl
# 打开 http://127.0.0.1:8000
```

## 生产部署

放到任意支持 Python 的 host:
- Fly.io / Render / Railway:`web/server.py` 直接当 ASGI app
- 自己服务器:`uvicorn web.server:app --host 0.0.0.0 --port 8000` + nginx 反代
- Cloudflare Tunnel:本地 dev 暴露公网最快

### Docker

```dockerfile
FROM python:3.11-slim
WORKDIR /app
COPY . /app
RUN pip install -e ../needle ".[gpu]"  # adjust to your monorepo layout
RUN pip install -r web/requirements.txt
EXPOSE 8000
CMD ["python", "web/server.py", "--checkpoint", "/data/my_best.pkl", "--host", "0.0.0.0"]
```

### 资源消耗
- 一个 26M 模型实例占 ~ 400 MB 内存(JAX 编译后)
- CPU 推理:单 query ~ 200-500 ms
- 并发:server 内单 `Lock()` 串行化(JAX 非线程安全),需要更多吞吐就跑多 worker

### 隐私文案(必写在落地页)
浏览器上跑的 query 是发到你服务器的。要避开这点,客户必须装桌面版。**这是产品差异化的核心卖点,要在 UI 里持续提醒。**

## 跟桌面版共享什么

- ✅ 同一个 `my_best.pkl`
- ✅ 同一份蒸馏流程(scripts/02_gen_data.py + 03_finetune.ps1)
- ✅ 同一套 Needle 推理代码(从 `needle.model.run` 导入)
- ❌ Native 工具实现(浏览器没法)

## 不要做的事

- ❌ 在 web 版加 `run_shell` 假装能跑(用户会以为浏览器在执行,其实是服务端,极度危险)
- ❌ 在 web 版加 `open_file` 调服务端文件系统(同理)
- ❌ 把 web 版作为最终产品出货 — 失去离线+隐私的核心卖点

Web 版的工具池**只包括浏览器原生 API 能做的事**,且每个工具都明确需要用户手势授权。
