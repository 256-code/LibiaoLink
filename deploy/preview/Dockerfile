# ============================================================
# LibiaoLink 预览转换器镜像（M4-05 / ADR-007：自建转换管道 · converter 沙箱）
# ------------------------------------------------------------
# 构建（在 deploy/preview/ 下）：
#   docker compose build
#
# 口径：
#   - 基座锁 digest（ADR-017：版本基线 + 镜像 digest 门禁）；LibreOffice 由 Debian 包提供，
#     实际版本随镜像记录在 README「镜像台账」并可从 /healthz 读出；
#   - 字体门禁：装 Noto CJK 并做宋体/黑体映射，构建期 fc-match 断言 —— 映射不生效直接
#     构建失败（ADR-007 把「中文不乱码」列为硬验收项，不能靠人工记得）；
#   - 零依赖：镜像内没有 node_modules，服务只用 Node 内置模块（缩小攻击面）。
# ============================================================
# syntax=docker/dockerfile:1

FROM node:24-trixie-slim@sha256:8ec5d7557396cfe32d21c3f9c13072355ceab22b584578ca4bb28af31120cffe

ARG PIPELINE_VERSION=1.0.0
ARG DEBIAN_FRONTEND=noninteractive

# 沙箱基线：可写目录只在 /tmp（tmpfs），headless VCL 插件，UTF-8 区域
ENV PIPELINE_VERSION=${PIPELINE_VERSION} \
    NODE_ENV=production \
    HOME=/tmp \
    TMPDIR=/tmp \
    SAL_USE_VCLPLUGIN=svp \
    LANG=C.UTF-8 \
    LC_ALL=C.UTF-8 \
    PORT=9900

# LibreOffice（writer/calc/impress 三件套 + 中文与度量兼容字体 + 首屏光栅化）
# --no-install-recommends：不带 Java / 桌面 / 打印推荐包，镜像更小、面更窄
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      libreoffice-writer \
      libreoffice-calc \
      libreoffice-impress \
      fonts-noto-cjk \
      fonts-liberation \
      fonts-crosextra-carlito \
      fonts-crosextra-caladea \
      fontconfig \
      poppler-utils \
 && apt-get clean \
 && rm -rf /var/lib/apt/lists/*

# 中文字体映射（宋体/黑体 -> Noto CJK）+ 构建期门禁
COPY service/fonts/99-libiaolink-cjk.conf /etc/fonts/conf.d/99-libiaolink-cjk.conf
RUN fc-cache -f \
 && test "$(fc-match -f %{family} SimSun)" = "Noto Serif CJK SC" \
 && test "$(fc-match -f %{family} SimHei)" = "Noto Sans CJK SC" \
 && soffice --version 2>/dev/null | grep -q "^LibreOffice " \
 && pdftoppm -v 2>&1 | grep -q "^pdftoppm version "

WORKDIR /app
COPY service/server.mjs       /app/server.mjs
COPY service/edge-forward.mjs /app/edge-forward.mjs
COPY service/smoke.mjs        /app/smoke.mjs

USER 1000:1000
EXPOSE 9900
CMD ["node", "/app/server.mjs"]
