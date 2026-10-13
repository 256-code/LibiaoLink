#!/usr/bin/env bash
# ============================================================
# 容器内步骤（由 prepare-model.sh 以 python:3.11-slim 运行）：
#   pip 安装（torch CPU 版走 PyTorch 官方源，其余走清华源）
#   -> ModelScope 下载 google/madlad400-3b-mt（排除 GGUF，省 3.9GB）
#   -> CTranslate2 int8 转换（产物 /data/model_ct2）
# ============================================================
set -e
pip install -q torch --index-url https://download.pytorch.org/whl/cpu
pip install -q -i https://pypi.tuna.tsinghua.edu.cn/simple modelscope ctranslate2==4.8.3 transformers==5.19.0 accelerate
modelscope download --model google/madlad400-3b-mt --exclude=\*.gguf --local_dir /data/madlad400-3b-mt
ct2-transformers-converter \
  --model /data/madlad400-3b-mt \
  --output_dir /data/model_ct2 \
  --quantization int8 \
  --low_cpu_mem_usage \
  --copy_files spiece.model tokenizer.json tokenizer_config.json special_tokens_map.json added_tokens.json generation_config.json
echo "prepare-model: done -> /data/model_ct2"
