#!/usr/bin/env bash
# ============================================================
# 一次性准备 MADLAD-400-3B 模型：ModelScope 下载（fp32）-> CTranslate2 int8 转换。
# ------------------------------------------------------------
# 在宿主机执行（需要 Docker + 约 20GB 空闲磁盘 + 约 12GB 空闲内存跑转换）：
#   bash scripts/prepare-model.sh          # 全流程（下载 + 转换，约 20-40 分钟）
#   FORCE=1 bash scripts/prepare-model.sh  # 已有产物时强制重跑
#
# 产物（均落在 ./data/，不进库）：
#   data/madlad400-3b-mt/   fp32 原始模型（约 11.8GB，转换成功后可删）
#   data/model_ct2/         CTranslate2 int8 模型（约 3GB，运行时挂载）
#
# 说明：
#   - 模型走 ModelScope（国内直连，无需外网代理）；实测下载约 12MB/s；
#   - 转换开 --low_cpu_mem_usage，内存峰值约 12GB；
#   - 容器内具体步骤见 ./prepare-inner.sh（同目录）。
#   - Windows 主机请在 Git Bash 中执行并加 MSYS_NO_PATHCONV=1（防路径被转换）。
# ============================================================
set -euo pipefail
cd "$(dirname "$0")/.."

DATA_DIR="$(pwd)/data"
mkdir -p "$DATA_DIR"

if [ -f "$DATA_DIR/model_ct2/model.bin" ] && [ "${FORCE:-}" != "1" ]; then
  echo "prepare-model: data/model_ct2/model.bin 已存在，跳过（FORCE=1 强制重跑）。"
  exit 0
fi

docker run --rm -v "$DATA_DIR:/data" -v "$(cd "$(dirname "$0")" && pwd):/scripts:ro" -w /data python:3.11-slim bash /scripts/prepare-inner.sh
