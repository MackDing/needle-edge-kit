#!/bin/bash
source /home/mack/ngpu/bin/activate
export PYTHONUTF8=1 PYTHONIOENCODING=utf-8
CKPT=$(ls -t /home/mack/ngpu-ckpts-v3/*_best.pkl | head -1)
echo "Using: $CKPT"
TOOLS_FILE=/mnt/c/D/CLPS/Code/Github/needle-edge-kit/tools/oa_tools.json
TOOLS=$(cat "$TOOLS_FILE")

# Same 20 OOD queries as fp_test.sh
QUERIES=(
    "今天午饭吃什么"
    "今天天气怎么样"
    "公司股价多少"
    "美国关税政策"
    "翻译一下这段英文"
    "1+1等于几"
    "帮我订一张去上海的机票"
    "订张去北京的高铁"
    "叫个滴滴"
    "推荐一首歌"
    "讲个笑话"
    "what is the meaning of life"
    "今晚有什么综艺"
    "lululemon 折扣码"
    "美股开盘了吗"
    "怎么炒西红柿鸡蛋"
    "Trump 是谁"
    "我饿了"
    "无聊"
    "?"
)

EMPTY=0
TOOL=0
for q in "${QUERIES[@]}"; do
    OUT=$(needle run --checkpoint "$CKPT" --query "$q" --tools "$TOOLS" 2>/dev/null | tail -1)
    OUT="${OUT#*<tool_call>}"
    if [ "$OUT" = "[]" ]; then
        echo "✓ EMPTY  | $q"
        EMPTY=$((EMPTY+1))
    else
        NAME=$(echo "$OUT" | python -c "import sys,json; d=json.loads(sys.stdin.read().strip()); print(','.join(c.get('name','?') for c in d) if isinstance(d, list) else '?')" 2>/dev/null)
        echo "✗ TOOL   | $q  →  $NAME"
        TOOL=$((TOOL+1))
    fi
done
echo "─────────"
echo "Empty (correct): $EMPTY / 20"
echo "FP (wrong):      $TOOL / 20"
