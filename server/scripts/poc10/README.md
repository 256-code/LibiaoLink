# PoC-10 · ONLYOFFICE 查看器替换首关（真机回放工具）

对自托管 ONLYOFFICE Docs（document server）做「查看器」三组首关验证：

- **A 组 · 并发**：view 模式 20 / 50 并开，观察超出行为与容器 CPU/内存曲线；
- **B 组 · JWT 只读不可绕**：无 token / 篡改 payload / 换密钥 / alg=none / 过期 / token 与配置错配 / 客户端 config 篡改 / 直连 DocServer；
- **C 组 · 字体与拓扑**：中文字体安装与 `documentserver-generate-allfonts.sh`；DocServer 经内网拉取 MinIO 预签名 URL。

## 依赖与前置

- Docker 里已有 ONLYOFFICE Docs 容器（JWT 开启，`browser`/`request.inbox` 为 true）与本仓 `server/` 同款 MinIO；
- Node ≥ 24；`server/.env`（S3_* 凭据）；`POC10_JWT_SECRET`（与容器 JWT_SECRET 一致，本地生成、不入库）；
- 无头 Edge（可用 `EDGE_PATH` 覆盖路径）。

关键容器侧配置（本机沙箱口径，生产按部署环境另行评估）：

1. `JWT_ENABLED=true`、`JWT_SECRET=...`；
2. 9.4 起默认 `externalRequest.action.blockPrivateIP=true` 会拒绝内网拉取，本沙箱就地改 `local.json` 为 false（`directIfIn.allowList` 不生效）；
3. 若同时启用 `token.enable.request.outbox=true`，DocServer 拉取会附加 `Authorization: Bearer <JWT>` 与 S3 预签名冲突（MinIO 400 multiple authentication types），本沙箱 outbox=false；
4. 中文字体：镜像默认 `fc-list :lang=zh` 为 0，安装 Noto Sans CJK SC 后跑 `documentserver-generate-allfonts.sh`。

## 用法

```bash
cd server/scripts/poc10
# 上传夹具
node --env-file-if-exists=../../.env storage.mjs upload ../../<夹具>.docx poc10/fixtures/<名>.docx
# 单开基线
node --env-file-if-exists=../../.env --env-file-if-exists=<POC10_JWT_SECRET 所在 .env> viewer.mjs single --label a1 --shot
# 50 并发（含采样 CSV / 每用例 JSONL / 失败网络探针）
node --env-file-if-exists=../../.env --env-file-if-exists=<...> viewer.mjs burst --n 50 --label a3 --per-browser 17 --shot-every 10
# JWT 篡改组
node --env-file-if-exists=../../.env --env-file-if-exists=<...> viewer.mjs tamper --cases all --label b
# b6 深测（客户端 config 篡改 → 真实输入 → 同 key 重开核验）
node --env-file-if-exists=../../.env --env-file-if-exists=<...> b6-edit-probe.mjs
# 宿主 → 容器端口 并发压测对照
node http-burst.mjs http://127.0.0.1:8001/<any.js> 300 3 15000
```

产物目录：`POC10_ROOT`（默认 `D:/poc10-onlyoffice`）下 `logs/`（`*.json`、`*.results.jsonl`、`*-samples.csv`、`*.dslog.txt`）与 `shots/`（截图）。

端点覆盖：`POC10_DOCSRV`（默认 `http://127.0.0.1:8001`）、`POC10_INTERNAL_S3`（容器网络内的 MinIO 地址）、`POC10_HTTP_PORT`、`EDGE_PATH`。
