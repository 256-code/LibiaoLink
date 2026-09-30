#!/usr/bin/env bash
# ============================================================
# LibiaoLink ONLYOFFICE 入口包装（S2 · F1/R3/R6 固化 · 定稿 §1.2）
# ------------------------------------------------------------
# 流程：原入口后台启动（supervisord 全套服务）
#       → 等 local.json 就绪（entrypoint 每次启动会重写 token.enable.request.*，F3）
#       → 固化 local.json（blockPrivateIP=false / allowPrivateIPAddress=true / request.outbox=true）
#       → 只重启 ds:docservice（不重启容器）
#       → 启动后自检（失败 = 容器退出非零，编排侧可见不健康）
#       → 守候主进程（信号转发）
# 注意：不得绕过本包装手工改容器；配置在此幂等重放，容器重启 / 重建 / 升级后自动恢复。
# ============================================================
set -uo pipefail

DS_ENTRY="/app/ds/run-document-server.sh"
LOCAL_JSON="/etc/onlyoffice/documentserver/local.json"
TAG="[libiaolink-onlyoffice]"

log() { printf "%s %s\n" "$TAG" "$*"; }

log "启动原始入口：$DS_ENTRY"
"$DS_ENTRY" &
DS_PID=$!

shutdown() {
  log "收到停止信号，转发给主进程（pid=$DS_PID）"
  kill -TERM "$DS_PID" 2>/dev/null || true
  wait "$DS_PID" 2>/dev/null || true
}
trap shutdown TERM INT

wait_json=0
for _ in $(seq 1 120); do
  if [ -f "$LOCAL_JSON" ] && grep -q "token" "$LOCAL_JSON"; then wait_json=1; break; fi
  sleep 1
done
if [ "$wait_json" != "1" ]; then
  log "FATAL: 等待 local.json 超时（$LOCAL_JSON）"
  kill -TERM "$DS_PID" 2>/dev/null || true
  exit 1
fi

wait_service() {
  for _ in $(seq 1 180); do
    if supervisorctl status ds:docservice 2>/dev/null | grep -q RUNNING; then
      code=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1/healthcheck || true)
      if [ "$code" = "200" ]; then return 0; fi
    fi
    sleep 1
  done
  return 1
}

log "等待 docservice 首次就绪（supervisor RUNNING + /healthcheck 200）…"
if wait_service; then log "首次就绪 OK"; else log "WARN: 首次就绪探测超时（继续固化配置，重启 ds:docservice 后再等）"; fi

log "固化 local.json（F1/R3）：blockPrivateIP=false / allowPrivateIPAddress=true / request.outbox=true"
python3 - <<'PY'
import json

path = "/etc/onlyoffice/documentserver/local.json"
with open(path) as fh:
    data = json.load(fh)
co = data.setdefault("services", {}).setdefault("CoAuthoring", {})
co.setdefault("externalRequest", {}).setdefault("action", {})["blockPrivateIP"] = False
co.setdefault("request-filtering-agent", {})["allowPrivateIPAddress"] = True
co.setdefault("token", {}).setdefault("enable", {}).setdefault("request", {})["outbox"] = True
with open(path, "w") as fh:
    json.dump(data, fh, indent=2)
print("local.json updated")
PY

log "只重启 ds:docservice 进程（F3 口径：不重启容器）"
if ! supervisorctl restart ds:docservice >/dev/null 2>&1; then
  log "WARN: supervisorctl restart 返回非零"
fi

log "等待 docservice 二次就绪…"
if wait_service; then log "二次就绪 OK"; else log "WARN: 二次就绪探测超时"; fi

log "启动后自检（配置三键 / 中文字体 / 示例 app 关闭）…"
if /usr/local/bin/libiaolink-selfcheck.sh; then
  log "自检通过。"
else
  log "FATAL: 自检失败 —— 配置未按定稿生效（容器退出非零）"
  kill -TERM "$DS_PID" 2>/dev/null || true
  exit 1
fi

log "进入守候（原入口继续前台化运行）"
wait "$DS_PID"
