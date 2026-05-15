#!/bin/bash
source /home/mack/ngpu/bin/activate
export PYTHONUTF8=1
export PYTHONIOENCODING=utf-8

CKPT=/home/mack/ngpu-ckpts/needle_finetuned_20260514182554_29076_12_512_best.pkl
TOOLS_JSON=/mnt/c/D/CLPS/Code/Github/needle-edge-kit/tools/oa_tools.json
TOOLS=$(cat "$TOOLS_JSON")

QUERIES=(
    "明天请一天年假"
    "下周一到周三去上海出差 客户验收"
    "100块滴滴报销"
    "Sky会议室 明天上午10点到12点 5人"
    "我那个报销批了吗"
    "查一下王芳的电话"
    "电脑蓝屏了 紧急"
    "请年假明天 顺便预订下周一会议室"
    "帮我订一张去北京的机票"
    "bx 200"
)

for q in "${QUERIES[@]}"; do
    echo "──────────────────────────────────────────"
    echo "Q: $q"
    echo -n "→ "
    needle run --checkpoint "$CKPT" --query "$q" --tools "$TOOLS" 2>/dev/null | tail -1
done
