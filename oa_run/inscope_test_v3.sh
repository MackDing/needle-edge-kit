#!/bin/bash
source /home/mack/ngpu/bin/activate
export PYTHONUTF8=1 PYTHONIOENCODING=utf-8
CKPT=$(ls -t /home/mack/ngpu-ckpts-v3/*_best.pkl | head -1)
TOOLS_FILE=/mnt/c/D/CLPS/Code/Github/needle-edge-kit/tools/oa_tools.json
TOOLS=$(cat "$TOOLS_FILE")

# 15 typical in-scope OA queries — should call the right tool
QUERIES=(
    "明天请年假"
    "明天加班半天 周末顶班"
    "100块滴滴报销"
    "下周一到周三去上海出差"
    "Sky会议室 明天上午10点"
    "我那个报销批了吗"
    "查张三的电话"
    "VPN 连不上"
    "请年假明天 顺便预订下周一会议室"
    "采购 5 个键盘给开发组"
    "撤回上周加班申请"
    "婚假 7月1号开始 10天"
    "查我还有几天年假"
    "上个月工资条"
    "bx 200"
)

OK=0
FAIL=0
for q in "${QUERIES[@]}"; do
    OUT=$(needle run --checkpoint "$CKPT" --query "$q" --tools "$TOOLS" 2>/dev/null | tail -1)
    OUT="${OUT#*<tool_call>}"
    if [ "$OUT" = "[]" ]; then
        echo "✗ EMPTY  | $q"
        FAIL=$((FAIL+1))
    else
        NAME=$(echo "$OUT" | python -c "import sys,json; d=json.loads(sys.stdin.read().strip()); print(','.join(c.get('name','?') for c in d) if isinstance(d, list) else '?')" 2>/dev/null)
        echo "✓ TOOL   | $q  →  $NAME"
        OK=$((OK+1))
    fi
done
echo "─────────"
echo "Got tool: $OK / 15 (in-scope coverage)"
echo "Empty (missed): $FAIL / 15"
