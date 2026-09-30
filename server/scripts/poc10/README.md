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
4. 中文字体：镜像默认 `fc-list :lang=zh` 为 0，安装 Noto Sans CJK SC 后跑 `documentserver-generate-allfonts.sh`；保真度抽查另装了 宋体/黑体/仿宋/楷体（自 Windows 宿主拷入沙箱，仅观察用，不随镜像分发）。

**F3（本轮新增，重要）**：容器 entrypoint 在**每次启动**时按 `JWT_ENABLED` 重写 `local.json` 的 `token.enable.request.*`（outbox 会回到 true），改 `local.json` 必须在容器**启动之后**做，并只重启 docservice 进程：

```bash
# 容器已启动后：
docker exec <容器> bash -lc 'python3 - <<PY
import json
p="/etc/onlyoffice/documentserver/local.json"
j=json.load(open(p)); ca=j["services"]["CoAuthoring"]
ca["token"]["enable"]["request"]["outbox"]=False
ca["externalRequest"]={"action":{"blockPrivateIP":False}}
ca["request-filtering-agent"]={"allowPrivateIPAddress":True}
json.dump(j, open(p,"w"), indent=2)
PY'
docker exec <容器> supervisorctl restart ds:docservice   # 只重启进程，不重启容器
```

（容器 `restart`/重建会把 outbox 重置回 true，随即 S3 预签名拉取报 MinIO 400；生产部署清单须固化该步骤，或按次关 N2 采纳「受控下载端点」后不再依赖预签名。）

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

# 次关 N1 保真度抽查（5 份样本逐个截屏；xlsx 自动切换 Sheet，docx 自动翻页）
node --env-file-if-exists=../../.env --env-file-if-exists=<...> viewer.mjs fidelity \
  --files n1-01,n1-02,n1-03,n1-04,n1-05 --label n1d
# 可选：--probe 输出帧内 DOM 探针（Sheet 标签/滚动容器/提示浮层）；--word-steps 'page2,page2,page2,page2' 自定义翻页
```

产物目录：`POC10_ROOT`（默认 `D:/poc10-onlyoffice`）下 `logs/`（`*.json`、`*.results.jsonl`、`*-samples.csv`、`*.dslog.txt`）与 `shots/`（截图）。

## N1 保真度样本（fixtures/）

`fixtures/` 下为 5 份「构造样本」（中文业务形态，覆盖多 Sheet/公式/图表/条件格式/复杂版式/长文档/红头公文），由 `make-n1-samples.py` 生成（依赖 openpyxl / python-docx / Pillow，字节级确定性：固定文档属性时间 + zip 时间戳归一化）：

```bash
python make-n1-samples.py            # 重新生成 fixtures/（含 n1-samples.manifest.json 记录 sha256）
```

> 样本口径：业务无法提供真实样本（2026-09-30 授权实施方自建）。如业务后续提供真实文件，建议按本模式追加 1~2 份抽样复核。
> 注意：第三方库（如 openpyxl）默认生成的图表 XML 可能缺显式系列样式、分类轴位置异常，在 ONLYOFFICE 中会渲染为「空图」；生成器已按 Excel 风格补齐（显式填充 + `catAx.axPos=b`），存量文件如来自非 Excel/WPS 工具建议抽样复核。

产物目录：`POC10_ROOT`（默认 `D:/poc10-onlyoffice`）下 `logs/`（`*.json`、`*.results.jsonl`、`*-samples.csv`、`*.dslog.txt`）与 `shots/`（截图）。

端点覆盖：`POC10_DOCSRV`（默认 `http://127.0.0.1:8001`）、`POC10_INTERNAL_S3`（容器网络内的 MinIO 地址）、`POC10_HTTP_PORT`、`EDGE_PATH`。
