# deploy/prod/ · LibiaoLink 生产部署件（单机 · Docker Compose）

> 归属：px（部署 / 交付）· 2026-10-13 起步（postgres → tools → api / worker，逐切片加组件）。
> 口径：`docs/adr/ADR-013-部署与容量起点.md`（Compose 单机 + Nginx 唯一对外端口；生产门禁）、`docs/adr/ADR-004-数据库与数据访问.md`（PostgreSQL 18.x，部署锁精确补丁）、`docs/M8-部署Runbook与上线检查单(单机).md`（总流程与清单）。
> 密钥纪律（CONTRIBUTING §12）：本目录只放非敏感内容；密钥全部以文件存在服务器 `secrets/`，不进仓库、不进 `.env`。

## 0. 现状与规划

| 组件 | 状态 | 说明 |
|---|---|---|
| postgres | ✅ 已交付 | `postgres:18` tag + digest 双锁（18.6）；数据卷 `libiaolink-prod-pgdata`（系统盘 SSD） |
| db-init（角色 + 密码） | ✅ 已交付 | `scripts/db-init.sh`（幂等；密码自 `secrets/` 注入） |
| tools（迁移 / 种子 / 依赖安装） | ✅ 已交付 | node 工具容器（`profiles: tools`，一次性）：`scripts/db-migrate.sh` / `scripts/db-seed.sh` |
| api / worker | ✅ 部署件已交付（本切片） | `profiles: app`；node 24 双锁；entrypoint 降权（容器进程非 root）；依赖装进命名卷；外部依赖（SSO / 对象存储）以占位值先行，见 §2 / §7 |
| web（Nginx） | ✅ TLS 已接入（v1.8）· 对象存储同源门面（v1.13） | 80 → 301 / 443 应用（含 `/libiaolink/` 对象存储同源门面）/ 9443 MinIO 备用门面（ALLinSSL 自动下发证书）；SPA 静态 + `/api/v1` 反代（SPA 已上线 2026-10-14） |
| minio（对象存储） | ✅ 服务器实测收口（本切片） | 本机自建；镜像 = 本地构建（锚点 sha256:165271c0…）；数据盘 bind `/srv/data/minio`；init + --check + it 24/24、readyz 全绿；S3 走 https 同源门面（443 `/libiaolink/`；9443 为内网备用）；见 §9 |
| onlyoffice（文档服务器） | ✅ 生产上线（本切片 · v1.14） | 独立 compose 项目 `libiaolink-onlyoffice`（不发布公网端口；8001 回环排障）；443 子路径 `/onlyoffice/` 门面（DS 9.4 原生子路径支持）；镜像离线下发并归档 `/srv/data/images/oo_docs_9.4.0.1.tar`；JWT 与 api 同值；真实 64MB xlsx 端到端渲染 ready；见 `deploy/onlyoffice/README.md` §6 |
| 备份（PG 每 12h 加密） | 待办 | 落 `/srv/data/backups/pg` + 异地 |

## 1. 服务器目录约定

```text
/opt/libiaolink/
├── database/            # 从仓库同步（roles / migrations / scripts / seeds / package*.json；不含 node_modules）
├── server/              # api / worker 产物（dist / scripts / package*.json；不含 node_modules 与 src）
├── shared/              # @libiaolink/contracts（dist / generated / package*.json）
└── deploy/prod/         # 本目录（docker-compose.yml / scripts / server.env / secrets/）
    └── secrets/         # 只存在于服务器（本机生成、chmod 600、不进仓库）
```

### 1.1 服务器登录（开发机 → 测试机）

- 测试机：`10.1.104.44`（主机名 `libiao-vm`，Ubuntu 26.04 LTS；对外域名 `test-pm.libiaorobot.com`）；`10.1.103.44` = ALLinSSL 证书下发接收端（同口令），仅证书用途、不作为部署目标。
- 登录方式：开发机 PowerShell 直接 `ssh root@10.1.104.44`（首次连接接受指纹即可）。
- **登录口令不落仓库**（CONTRIBUTING §12）：由 px 持有；开发机上的未跟踪备忘 = `deploy/prod/服务器登录.local.md`（`.gitignore` 已忽略，AI / 新会话可直接读该文件续接）。
- 登录后入口：`cd /opt/libiaolink/deploy/prod`（`docker compose --profile app ps` 应见 postgres / api / worker / web / minio 五容器）。
- 铁律：**不得修改 root 密码**；普通用户 `libiao` 未经许可不动；服务器只跑不改 —— 代码 / 配置变更一律走本仓 → 常驻分支 → PR → 部署件同步（§3 ~ §9），禁止在服务器上手改业务代码，临时热修必须回灌仓库。
- MinIO 控制台（运维排查）：`ssh -L 9001:127.0.0.1:9001 root@10.1.104.44` 后浏览器开 `http://127.0.0.1:9001`（同 §9）。
- 证书：ALLinSSL 自动下发 `*.libiaorobot.com` → 宿主 `/etc/ssl/libiaorobot.com.pem|.key`（SSH 通道自动覆盖 + reload）；未使用 1Panel。

## 2. 密钥清单（`secrets/`）

| 文件 | 用途 | 消费方 | 现状 |
|---|---|---|---|
| `pg_superuser_password` | `postgres` 超级用户 | compose secret（`POSTGRES_PASSWORD_FILE`） | ✅ 已生成 |
| `pg_migrator_password` | 迁移 / 种子 | db-init + tools | ✅ 已生成 |
| `pg_api_password` | 应用角色（api / worker） | entrypoint → `DATABASE_URL` | ✅ 已生成 |
| `pg_readonly_password` | 只读（排查 / 报表） | psql 排查 | ✅ 已生成 |
| `internal_sync_token` | 内部作业凭证（`X-Internal-Token`） | entrypoint → `INTERNAL_SYNC_TOKEN` | 随本切片生成 |
| `onlyoffice_jwt_secret` | 查看器 JWT（与 DocServer 同值） | entrypoint → `ONLYOFFICE_JWT_SECRET` | ✅ 已生成（2026-10-14 DocServer 上线同批复核） |
| `translate_api_key` | 翻译 API Key（New API 网关） | entrypoint → `TRANSLATE_API_KEY` | 待回填（Key 由业务侧提供后落文件，600） |
| `casdoor_client_id` / `casdoor_client_secret` | SSO 应用（Casdoor） | entrypoint → `CASDOOR_CLIENT_ID` / `CASDOOR_CLIENT_SECRET` | ✅ 已回填（2026-10-14，测试环境 authtest 应用 clientId `41e162…`；正式环境应用创建后替换） |
| `s3_access_key` / `s3_secret_key` | 对象存储（MinIO 应用侧） | entrypoint → `S3_ACCESS_KEY` / `S3_SECRET_KEY` | ✅ 已生成（当前与根口令同值；专用最小权限账号列待办） |
| `wecom_app_secret` / `wecom_bot_secret` | 企微通道 | entrypoint → `WECOM_APP_SECRET` / `WECOM_BOT_SECRET` | 待业务侧开通后补 |

生成（服务器上，root）：`openssl rand -hex 24 > <文件名>`（JWT 用 -hex 32），随后 `chmod 600 *password` 覆盖全部密钥文件。

## 3. 同步与首次部署（postgres）

开发机（Windows PowerShell）→ 服务器：

```powershell
ssh root@10.1.104.44 "mkdir -p /opt/libiaolink/deploy /opt/libiaolink/database"
scp -r D:\LibiaoLink\deploy\prod root@10.1.104.44:/opt/libiaolink/deploy/
scp -r D:\LibiaoLink\database\roles D:\LibiaoLink\database\migrations D:\LibiaoLink\database\scripts D:\LibiaoLink\database\seeds D:\LibiaoLink\database\package.json D:\LibiaoLink\database\package-lock.json D:\LibiaoLink\database\README.md root@10.1.104.44:/opt/libiaolink/database/
```

> 注意：`database/node_modules` 不同步（服务器上由 tools 容器自行 `npm ci`）；`deploy/prod/secrets/`、`deploy/prod/server.env` 不在仓库、不参与同步。

服务器上（root）：

```bash
cd /opt/libiaolink/deploy/prod
mkdir -p secrets
cd secrets
for n in superuser migrator api readonly; do openssl rand -hex 24 > "pg_${n}_password"; done
openssl rand -hex 32 > internal_sync_token
openssl rand -hex 32 > onlyoffice_jwt_secret
chmod 600 *
cd ..
cp .env.example .env
docker compose up -d
docker compose ps
```

## 4. 角色基线与密码注入（幂等）

```bash
bash scripts/db-init.sh
```

## 5. 验证（postgres）

```bash
docker compose exec -T postgres psql -U postgres -d libiaolink -c "select version();"
docker compose exec -T postgres psql -U postgres -d libiaolink -c "\du"
```

期望：版本 = 18.6；`\du` 出现 `libiaolink_migrator` / `libiaolink_api` / `libiaolink_readonly`。

## 6. 迁移与种子（tools 容器）

首次拉取 node 工具镜像（约 55MB，建议单独拉、可看进度）：

```bash
docker compose --profile tools pull tools
```

迁移（以 `libiaolink_migrator` 身份；当前 0001~0053）：

```bash
bash scripts/db-migrate.sh
```

- 复跑幂等：再跑一次应输出「已执行 52 个迁移，无漂移」；
- `bash scripts/db-migrate.sh --dry-run` 只列出待执行，不改库；
- 首次运行会在命名卷 `libiaolink-prod-tools-node-modules` 里 `npm ci`（不污染宿主机 `database/`）；慢网可换源：`NPM_REGISTRY=https://registry.npmmirror.com bash scripts/db-migrate.sh`。

种子（幂等；默认集 = roles / role-permissions / dicts / blueprint / task-nodes / task-templates）：

```bash
bash scripts/db-seed.sh
```

- 复跑应零变更；`--dry-run` 打印摘要后全部回滚；`--only=<name>` 单跑。

## 7. api / worker（应用栈 · profiles: app）

**首次准备（开发机 → 服务器）：**

```powershell
ssh root@10.1.104.44 "mkdir -p /opt/libiaolink/server /opt/libiaolink/shared"
scp -r D:\LibiaoLink\server\dist D:\LibiaoLink\server\scripts D:\LibiaoLink\server\package.json D:\LibiaoLink\server\package-lock.json root@10.1.104.44:/opt/libiaolink/server/
scp -r D:\LibiaoLink\shared\dist D:\LibiaoLink\shared\generated D:\LibiaoLink\shared\package.json D:\LibiaoLink\shared\package-lock.json root@10.1.104.44:/opt/libiaolink/shared/

> scp 传输可能留下畸形目录权限（曾出现 `drwx---rwx`；症状：容器报 `Cannot find module '/opt/libiaolink/server/dist/entry/api.js'`）；修复：`chmod -R a+rX /opt/libiaolink/server /opt/libiaolink/shared`。
```

**安装依赖**（tools 容器；装进命名卷，不落宿主机目录）：

```bash
cd /opt/libiaolink/deploy/prod
docker compose --profile tools run --rm tools -c 'cd /opt/libiaolink/shared && npm ci --include=dev --no-audit --no-fund && cd /opt/libiaolink/server && npm ci --omit=dev --no-audit --no-fund'

> `shared` 需含 dev（`--include=dev`）：其 dist 运行时引用 `@asteasolutions/zod-to-openapi`，而它现声明为 devDependency（打包缺陷，待 wmj 线移入 `dependencies` 并重生成双 lock 后可收回 `--omit=dev`；见 M8 §7 待办 #8）。
```

**环境与占位密钥**（替换外部依赖到位后的真值）：

```bash
cp server.env.example server.env          # 按注释回填 SSO / 对象存储 / ONLYOFFICE / 企微 真实值
cd secrets
for n in casdoor_client_id casdoor_client_secret s3_access_key s3_secret_key; do echo "placeholder-until-configured" > "$n"; done
chmod 600 *
```

> 占位值仅供「先起服务、后回填」的过度期使用；真值到位后覆盖文件并 `docker compose --profile app restart api worker`。

**启动与验证：**

```bash
docker compose --profile app up -d api worker
docker compose ps                                   # api / worker 均 (healthy)
docker compose --profile app exec -T api wget -qO- http://127.0.0.1:3000/healthz
docker compose --profile app exec -T api node -e "fetch('http://127.0.0.1:3000/readyz').then(async r => { console.log(r.status); console.log(await r.text()) })"
```

期望：`/healthz` 返回 200 `{"status":"ok"}`；`/readyz` 在对象存储就绪前为 **HTTP 503** + `status:degraded`（`object-storage:head-bucket` 探针失败，属预期，待对象存储选型关闭后转 ok）。busybox `wget` 遇 5xx 不打印 body，故上面用 `node -e fetch` 看正文。

**升级（改代码后）：**

```bash
# 重传 server/dist（或 scripts）后：
docker compose --profile app restart api worker
```

## 8. web（Nginx 反代 · profiles: app）

**首次准备（开发机 → 服务器）：**

```powershell
ssh root@10.1.104.44 "mkdir -p /opt/libiaolink/deploy/prod/nginx /opt/libiaolink/frontend/dist"
scp D:\LibiaoLink\deploy\prod\nginx\libiaolink.conf root@10.1.104.44:/opt/libiaolink/deploy/prod/nginx/
scp D:\LibiaoLink\deploy\prod\docker-compose.yml root@10.1.104.44:/opt/libiaolink/deploy/prod/
```

> SPA 产物（2026-10-14 已上线）：`frontend` build 后把 `frontend\dist` 内容传到 `/opt/libiaolink/frontend/dist/`；注意 **scp 传目录会产生 `drwx---rwx`(707) 权限畸形 → 传完必须 `chmod -R u=rwX,go=rX /opt/libiaolink/frontend/dist`**（两次踩坑）；目录挂载即传即生效、无需重启容器。

**拉取镜像并回填 digest（生产门禁：tag + digest 双锁）：**

```bash
docker pull nginx:stable-alpine
docker run --rm nginx:stable-alpine nginx -v                                    # 记下版本号（如 nginx/1.xx.y）
docker image inspect nginx:stable-alpine --format "{{index .RepoDigests 0}}"    # 记下 digest
```

> 把版本与 digest 回填到 `deploy/prod/docker-compose.yml` 的 `NGINX_IMAGE`（形如 `nginx:1.xx.y-alpine@sha256:…`）；回填前 compose 默认值 `nginx:stable-alpine` 可先跑通；**2026-10-13 已回填：`nginx:1.30.5-alpine@sha256:0985e772…`**。

**启动与验证：**

```bash
docker compose --profile app run --rm --no-deps web nginx -t        # 配置语法自检（compose 网络内可解析 api）
docker compose --profile app up -d web
docker compose --profile app ps                                     # web (healthy)
curl -s http://127.0.0.1/nginx-health; echo                          # ok（80 探活）
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1/           # 301 → https://test-pm.libiaorobot.com/
curl -sk https://test-pm.libiaorobot.com/nginx-health; echo          # ok（443 探活）
curl -sk https://test-pm.libiaorobot.com/healthz; echo               # {"status":"ok"}（经反代到 api）
curl -sk -o /dev/null -w "%{http_code}\n" https://test-pm.libiaorobot.com/readyz   # 200（对象存储就绪）
curl -sk -o /dev/null -w "%{http_code}\n" https://test-pm.libiaorobot.com/         # 200（index.html，SPA 已上线）
```

- 服务器实测（2026-10-13 HTTP 先行）：`/nginx-health` ok、`/healthz` 200、`/readyz` 503（存储占位）、`/` 404（SPA 未传输）、web (healthy)；
- 服务器实测（2026-10-14 TLS 接入）：证书链校验通过（无 `-k` 请求 200；SAN 匹配）、80 → 301（IP 访问一并收口）、443 `/nginx-health` ok / `/healthz` 200 / `/readyz` 200、9443 门面 `storage:it` 24/24；
- 服务器实测（2026-10-14 对象存储改同源 443 门面 · v1.13）：开发机（真实客户端网络）实测 9443 / 9000 被安全策略拦截（仅 22/80/443 放行）→ 443 增 `location /libiaolink/`（= 桶名；`proxy_pass` 无 URI 不重写、`Host $http_host` 保 SigV4）同源门面、`S3_ENDPOINT` 去端口；`storage:it` 24/24（host 断言 test-pm.libiaorobot.com）；开发机预签名 PUT 200 / GET 200 字节一致 / DELETE 204 / 删后 GET 404；`/libiaolink/` 匿名 403（AccessDenied，符合 ADR-006 短时签名口径）；
- 服务器实测（2026-10-14 SPA 上线）：站点根 200（index.html）、JS / CSS / SVG 200、wasm 200（`application/wasm`）、SPA 路由兜底 200；
- 服务器实测（2026-10-14 SPA 更新 · Push 304「已有项目地区」修复）：tar 增量上传（解包）→ `chmod -R u=rwX,go=rX` —— 站点根 200（新构建 `assets/index-Qkd_qv0F.js`）、新 JS 200（1,106,488 B）、`/healthz` 200、`/readyz` 200；旧哈希资源已清理；目录挂载即传即生效（无容器重启）；
- 服务器实测（2026-10-14 SPA 更新 · Push 312「Blocked aria-hidden」告警修复）：tar 增量上传（解包）→ `chmod -R u=rwX,go=rX` → 旧哈希资源清理 4 个 —— 站点根 200（index.html 引用 `assets/index-9-LTzT0u.js`）、新 JS 200（1,107,122 B · sha256 与本地构建一致 `83e4f5b6…`）、CSS 200、`/healthz` 200、`/readyz` 200；旧资源路径回落 SPA 兜底（text/html）；目录挂载即传即生效（无容器重启）；
- 服务器实测（2026-10-14 SPA 更新 · Push 313「默认外观改档 + 甘特『全部』不出任务列表」）：tar 增量上传（解包）→ `chmod -R u=rwX,go=rX` → 旧哈希资源清理 2 个（`index-9-LTzT0u.js` / `CadViewer-roDP69Tk.js`）—— 站点根 200（index.html 引用 `assets/index-DckvL4un.js`）、新 JS 200（1,107,126 B · sha256 与本地构建一致 `3add9c49…`）、CSS 200、`/healthz` 200、`/readyz` 200；旧资源路径回落 SPA 兜底（text/html）；目录挂载即传即生效（无容器重启）；
- 服务器实测（2026-10-14 SPA 更新 · Push 315「变更前 / 变更后可填图」）：tar 增量上传（解包）→ `chmod -R u=rwX,go=rX` → 旧哈希资源清理 2 个（`index-DckvL4un.js` / `CadViewer-l0DG45xP.js`）—— 站点根 200（index.html 引用 `assets/index-BmpRAV9e.js`）、新 JS 200（1,109,516 B · sha256 与本地构建一致 `636c110b…`）、CSS 200、`/healthz` 200、`/readyz` 200；旧资源路径回落 SPA 兜底（text/html）；目录挂载即传即生效（无容器重启）；
- 服务器实测（2026-10-14 老表导入部署 · Push 316「导入项目 + preview / commit」）：tar 上传解包 → `chmod -R a+rX server shared` + `chmod -R u=rwX,go=rX frontend/dist` → `db-migrate.sh` 实执行 `0053`（23 ms · `project_import_previews` 11 列 / 2 索引 / 5 CHECK / 2 FK）→ 复跑「已执行 52 个迁移，无漂移」→ api / worker restart（均 healthy · 容器内 `/healthz` 200 · `/readyz` 200）→ 旧哈希资源清理 3 个（`index-BmpRAV9e.js` / `CadViewer-q__WjFO3.js` / `index-CBhDTCMn.css`）—— 站点根 200（index.html 引用 `assets/index-BgYAfdBn.js`）、新 JS 200（1,139,908 B · sha256 `838892a1…` 与本地构建一致）、CSS 200、`/healthz` 200、`/readyz` 200、旧资源路径回落 SPA 兜底（text/html）、`POST /api/v1/project-imports/preview` 未登录 401（新路由已挂载）、api / worker 日志 0 error；开发机（真实客户端网络）公网复核同组断言；
- 服务器实测（2026-10-14 老表导入 413 热修 · v1.23）：根因 = 443 server 级 `client_max_body_size 32m` 被 `/api/v1` 继承，61.4 MiB 老表在 nginx 层被 413（前端显示「请求失败（HTTP 413）· 错误码 INTERNAL」）；修复 = `location /api/v1` 单独 `client_max_body_size 65m;`（应用整包上限 64 MiB + 1m 余量）→ conf 原地覆盖（保 inode · 单文件 ro bind mount）+ `nginx -t` OK + `nginx -s reload`（web 不重建）—— 双路实测（服务器本机 + 开发机真实客户端网络）：40 MB POST **413 → 401**、70 MB POST 仍 413（守上限）、61,410,006 B 老表原文件 POST → 401；`/nginx-health` / `/healthz` / `/readyz` / 站点根均 200；
- 服务器实测（2026-10-14 SPA 更新 · Push 318「导入面板撤两处说明文案」）：tar 增量上传（解包）→ `chmod -R u=rwX,go=rX` → 旧哈希资源清理 2 个（`index-BgYAfdBn.js` / `CadViewer-BekWaEqt.js`）—— 站点根 200（index.html 引用 `assets/index-BS9fUUs1.js`）、新 JS 200（1,139,052 B · sha256 `e624326f…` 与本地构建一致）、CSS 200（131,944 B · sha256 `2736d269…`）、`/healthz` 200、`/readyz` 200；目录挂载即传即生效（无容器重启）；
- 服务器实测（2026-10-14 老表导入收口部署 · Push 319 + v1.25 存量回填）：server / shared / frontend 三包 tar 上传解包 → `chmod -R a+rX`（server / shared）/ `chmod -R u=rwX,go=rX`（frontend）→ api / worker restart（均 healthy · 容器内 `/healthz` 200 · `/readyz` 200）→ 旧哈希资源清理 2 个（`index-BS9fUUs1.js` / `CadViewer-DZptSeOy.js`）；站点根 200（index.html 引用 `assets/index-Bti0_HPU.js`）、新 JS 200（1,140,699 B · sha256 `c50ead8c…` 与本地构建逐字节一致）、CSS 200（131,944 B · sha256 `2736d269…`）、旧资源回落 SPA 兜底、服务器 dist 标记核对（`leftJoin` ×3 / `changesLinked`）；存量回填 `server/scripts/push319-import-backfill.mjs`（dry-run → 实跑 → 幂等复跑 0 变更）：3 条未解决问题处理人回填贾海洋、3 条任务回写 `change_refs`（包装 / 物料清单完整版 / 布局定档；第 4 条「1xxx」源表关联为空按原样跳过）；贾海洋会话公网复验（临时会话 · 用毕即撤 · 残留 0）：`GET /api/v1/workspace`「待我处理」3 条 in_progress、`GET /projects/{id}/tasks` 3 条 changeLinks 有值、`GET /projects/{id}/change-requests` total = 4（fileId / versionId 全 null 不再被过滤）、`GET /change-requests/{id}` 200（file / version = null 不再 500）；
- 服务器实测（2026-10-14 SPA 更新 · Push 320「导入面板两处提示文案撤除 + 项目类型可新建」）：tar 增量上传（解包）→ `chmod -R u=rwX,go=rX` → 旧哈希资源清理 2 个（`index-Bti0_HPU.js` / `CadViewer-BAbx1aIu.js`）—— 站点根 200（index.html 引用 `assets/index-CzQcCLqe.js`）、新 JS 200（1,140,534 B · sha256 `a149af6d…` 与本地构建逐字节一致）、CSS 200（131,944 B · sha256 `2736d269…`）、`/healthz` 200、`/readyz` 200；线上 JS 文案核对：「添加项目类型」命中、撤销文案（「按源表关键字识别」/「导入老项目：选 Excel」）0 命中；目录挂载即传即生效（无容器重启）；
- 服务器实测（2026-10-14 nginx↔Node 上游长连接竞态修复 · Push 323 / v1.29）：根因 = `upstream api_backend` 未显式声明长连接池（实测连接被保持复用：10 连发仅 2 条 · 空闲数秒仍 ESTABLISHED）而 api（Node）默认 `server.keepAliveTimeout = 5s` 空闲即关 → 复用「已关未感知」旧连接偶发 502（`sendfile() failed (104: Connection reset by peer) while sending request to upstream`；Push 321 真机取消验证中复现、更早 `/api/v1/static-version` 高频请求为同型）；修复 = `keepalive 32;` + `keepalive_timeout 4s;`（idle ≤ 4s 复用 · 先于 Node 5s 关门）+ server 级 `proxy_set_header Connection "";` → conf 原地覆盖 + `nginx -t` OK + `nginx -s reload`（web 不重启）；行为探针（内核 uptime 时间戳 + netstat / `/proc/net/tcp`）：改后空闲 ~4s 由 nginx 侧主动关闭（TIME_WAIT · 本端先关）、4s 内复用同连接、超时后新建；修复后真机复跑两轮（共 8 次 61.4 MB preview · 零 502），第二轮 Push 321 公网取消验证 == 全部通过 ==（commit 10.0s 中断落在图片上传中途 → 零残留 / 票据可重提）；
- Nginx 是唯一对外入口（80 / 443 / 9443；80 仅探活 + 301；443 含对象存储同源门面 `/libiaolink/`；9443 = MinIO 备用门面）；
- 证书：ALLinSSL 自动下发 `*.libiaorobot.com` → 宿主 `/etc/ssl/libiaorobot.com.pem|.key`（只读挂载进 web 容器 `/etc/nginx/ssl/`）；续签经 SSH 自动覆盖 + `sudo /usr/local/bin/allinssl-reload`（容器内 nginx 重载）；若续签后证书未生效 → `docker compose --profile app restart web`（单文件 bind mount 兜底）；
- 反代口径（与前端开发代理一致）：`/api/v1`、`/auth`、`/healthz`、`/readyz`；`/internal/**` 不对外；
- api / minio 容器**重建**（换镜像等）后 nginx 自动跟随新 IP（2026-10-14 起：`resolver 127.0.0.11 valid=10s` + `upstream … resolve` 动态解析；重建回归通过，不再需要 `restart web`）；若遇极端仍 502 → `docker compose --profile app restart web` 兜底；
- 生产 cookie 为 `Secure`（`SESSION_COOKIE_SECURE=auto` + `NODE_ENV=production`）→ TLS 已就绪（2026-10-14）；
- SSO（2026-10-14 测试环境接通）：`/auth/login` 302 → `https://authtest.libiaorobot.com/login/oauth/authorize`（client_id / redirect_uri 精确匹配、PKCE S256）；应用侧标准配置见《实测报告(SSO接入验证)》§四；正式环境应用（auth.libiaorobot.com）待 SSO 管理员创建（M8 §3-B）。

## 9. 对象存储（MinIO · 本机自建）

**决策口径（2026-10-13，px；待 lan 复核）**：生产选型 = 本机 MinIO 单节点（pinned `RELEASE.2025-09-07T16-13-09Z`）。背景：MinIO 上游已归档、官方分发下线（见 `deploy/minio/README.md`），故把「镜像离线固化」与「SeaweedFS 迁移评估」列为运维待办；接口层只依赖 S3 协议，换实现不动调用代码。**2026-10-13 追加实测：quay 该镜像已不可拉（匿名 401 / token $disabled）；镜像改由「GitHub Release 官方二进制（sha256 校验）+ 服务器本地 docker build」固化，见下文步骤与 `minio/Dockerfile`。**

**设计要点：**

- 数据落数据盘：bind `/srv/data/minio`（HDD；默认 docker volume 会落系统盘，禁用）；
- 端口：`9000` = S3 API，对局域网发布（预签名直传要求浏览器直连）；`9001` 控制台仅绑 `127.0.0.1`（SSH 隧道访问）；
- 凭据：`secrets/minio_root_user`、`secrets/minio_root_password`（`scripts/minio-entrypoint.sh` 注入）；应用侧 `secrets/s3_access_key` / `s3_secret_key`（当前与根口令同值；专用账号最小权限列为待办）；
- CORS：MinIO 社区版走服务端变量 `MINIO_API_CORS_ALLOW_ORIGIN`（compose 默认 `http://10.1.104.44`；换域名 / TLS 后同步更新并重建容器）。

**首次部署与验证（服务器）：**

```bash
cd /opt/libiaolink/deploy/prod
mkdir -p /srv/data/minio
cd secrets
echo "libiaolink" > minio_root_user
openssl rand -hex 24 > minio_root_password
cp minio_root_user s3_access_key
cp minio_root_password s3_secret_key
chmod 600 *
cd ..
# server.env 已存在（v1.2 切片创建）→ 只回填 S3 段；新机首部署才 cp server.env.example server.env
set_s3() { if grep -q "^$1=" server.env; then sed -i "s|^$1=.*|$1=$2|" server.env; else echo "$1=$2" >> server.env; fi; }
set_s3 S3_ENDPOINT http://10.1.104.44:9000
set_s3 S3_REGION us-east-1
set_s3 S3_BUCKET libiaolink
set_s3 S3_FORCE_PATH_STYLE auto
set_s3 S3_CORS_ORIGINS http://10.1.104.44
set_s3 S3_ABORT_INCOMPLETE_DAYS 30

# 镜像：quay 已下架（2026-10-13 实测 401 / token $disabled）→ 用 GitHub Release 官方二进制在服务器本地构建
# 二进制先（开发机 PowerShell）scp 到 /srv/data/images/minio/（保持文件名）：
#   minio.linux-amd64.RELEASE.2025-09-07T16-13-09Z、minio.sha256sum
cd /srv/data/images/minio
echo "7c5bd8512c6e966455b1d198209358b2d191c77a83ab377c4073281065fb855f  minio.linux-amd64.RELEASE.2025-09-07T16-13-09Z" | sha256sum -c -
docker build -f /opt/libiaolink/deploy/prod/minio/Dockerfile -t libiaolink/minio:RELEASE.2025-09-07T16-13-09Z /srv/data/images/minio
cd /opt/libiaolink/deploy/prod
docker compose --profile app up -d --force-recreate api worker minio
docker compose --profile app ps       # minio (healthy)
bash scripts/storage.sh init          # 建桶 + 版本控制（CORS / 分片清理按 MinIO 能力面告警）
bash scripts/storage.sh init --check  # 只读门禁（部署验收）
bash scripts/storage.sh it            # 真机回放 24 项断言
```

- 完成后 `readyz` 全绿（`object-storage:head-bucket` ✓）—— 2026-10-14 服务器实测：minio healthy / api→minio 200 / init 两项能力面告警属预期 / `--check` 退出码 0 / `it` 24/24 / readyz 200 全绿；镜像锚点 `sha256:165271c0…`；
- 换域名 / TLS 时：同步改 `server.env` 的 `S3_*` 与 compose 的 `MINIO_CORS_ALLOW_ORIGIN`，再 `up -d --force-recreate api worker`——**已执行（2026-10-14）**：`S3_ENDPOINT=https://test-pm.libiaorobot.com`（443 同源门面 `/libiaolink/` → minio:9000；客户端网络仅放行 22/80/443，9443 / 9000 实测被拦 —— **浏览器预签名地址一律走 443 默认端口，不带非标端口**；`/libiaolink/` 与 `S3_BUCKET` 强耦合，换桶名须同步 nginx）、`MINIO_CORS_ALLOW_ORIGIN=https://test-pm.libiaorobot.com,http://10.1.104.44`（改同源后 CORS 非必需，保留兼容 9443 直连与旧源）；同源门面上 `storage:it` 24/24 复跑通过；
- 部署件同步提醒：`nginx/libiaolink.conf` 为**文件级 bind mount（绑定 inode）**——scp 覆盖后容器内仍读旧文件，务必 `docker compose --profile app up -d --force-recreate web` 生效（2026-10-14 实测踩坑，同证书更新口径）；
- 镜像部署锚点：`docker image inspect libiaolink/minio:RELEASE.2025-09-07T16-13-09Z --format '{{.Id}}'` 记录 Image ID（换机 / 归档核对）；
- 控制台（运维）：`ssh -L 9001:127.0.0.1:9001 root@10.1.104.44` 后浏览器开 `http://127.0.0.1:9001`。

## 10. 后续切片（登记）

- web（Nginx）：TLS 接入 ✅（2026-10-14，443 应用 + 对象存储同源门面 + ALLinSSL 自动下发）；剩余：9443 备用门面择机收敛（浏览器流量已全部走 443 同源门面，9443 仅内网直连用，待无使用后从 compose 删端口）；`/internal/**` / `/example/` 显式 404 加固（SPA 产物 2026-10-14 已上线）；备份脚本（PG 12h → `/srv/data/backups/pg`）；监控告警接线；MinIO 运维面：镜像离线固化（quay 2026-10-13 实测下架，已改服务器本地构建；`docker save` 归档待办）、SeaweedFS 迁移评估、S3 专用账号最小权限、9000 明文端口收敛（127.0.0.1，TLS 门面稳定后）；
- onlyoffice（文档服务器）：生产上线 ✅（2026-10-14，离线镜像 + 443 子路径门面 + 真实 64MB xlsx 端到端；见 `deploy/onlyoffice/README.md` §6）；剩余：升级 / 重建后按回归五项 + §6.3 表复验、缓存盘 7 天清理 cron、正式环境容量评估与 CVE 跟踪；
- SSO：测试环境（authtest 应用 `LibiaoLink`）已按接入标准接通（2026-10-14）；正式环境应用 `libiaolink` 创建 + 企微登录方式挂接待 SSO 管理员（M8 §3-B）。
- 完成项在 `docs/M8-部署Runbook与上线检查单(单机).md` 勾选；推送时随 `开发日志.md` 记录。

## 11. 变更记录

| 版本 | 日期 | 变更 | 人 |
|---|---|---|---|
| v1.0 | 2026-10-13 | 首版：postgres 服务（18.6 双锁 / 文件密钥 / 回环端口 / 资源限额 / healthcheck / 日志轮转）；db-init 脚本（角色基线 + 密码注入）；目录与密钥约定 | px |
| v1.1 | 2026-10-13 | tools 服务（node 24 双锁 / 一次性 profile / 依赖命名卷 / 只读 secrets）；db-migrate.sh + db-seed.sh；database 同步方式（scp 多源，不含 node_modules） | px |
| v1.2 | 2026-10-13 | api / worker 服务（profiles: app / 非 root 降权 entrypoint / 依赖命名卷 / healthcheck：api=wget healthz、worker=--health-check）；server.env 非敏感配置模板；server_node_modules / shared_node_modules 卷；README 补应用栈章节 | px |
| v1.3 | 2026-10-13 | api / worker 服务器实测收口（均 healthy / `/healthz` ok / `/readyz` 503-degraded 属预期 / worker heartbeat 正常）；依赖安装口径修正：`shared` 改 `npm ci --include=dev`（`@asteasolutions/zod-to-openapi` 运行时缺陷，待 wmj 线修复）；补 scp 权限畸形坑（`chmod -R a+rX`）；验证命令补 `--profile app` 与 degraded 正文查看方式 | px |
| v1.4 | 2026-10-13 | web（Nginx）部署件落地：compose 增 web 服务（唯一对外端口 80 / SPA 挂载 / 反代 api / nginx-health 探活 / 依赖 api healthy / 64M·0.5c 限额）；`nginx/libiaolink.conf`（80 先行 + TLS 模板注释；`/internal/**` 不对外）；README 补 §8；镜像双锁回填：`nginx:1.30.5-alpine@sha256:0985e772…`（2026-10-13）| px |
| v1.5 | 2026-10-13 | 对象存储切片：`deploy/prod` 增 minio 服务（数据盘 bind / 9000 局域网 + 9001 回环 / secrets 文件注入 / 镜像双锁 quay pinned / healthcheck；profiles: app）；新增 `scripts/minio-entrypoint.sh` + `scripts/storage.sh`（init / --check / it）；server.env S3 段回填内网端点与 CORS；README 补 §9 | px |
| v1.6 | 2026-10-13 | MinIO 镜像改**服务器本地构建**（quay 2026-10-13 实测下架：匿名 401 / `$disabled`；官方分发 410 / Docker Hub 无）—— 新增 `minio/Dockerfile`（alpine 3.24 双锁 + GitHub Release 官方二进制 sha256 校验）；compose minio 镜像指向本地 tag、healthcheck 改 busybox wget；`.env.example` / README §9 步骤与 §0 / §2 现状同步回填；storage.sh 注入 DATABASE_URL（server loadEnv 校验前置，服务器实测补丁） | px |
| v1.7 | 2026-10-14 | MinIO 服务器实测收口：A 路线（alpine 官方构建）成功，镜像锚点 `sha256:165271c0…`；minio healthy、api→minio 200；init（CORS / 分片清理按能力面降级 ⚠ 属预期）+ `--check` 通过 + `it` 24/24 + readyz 200 全绿；初试 Docker Hub auth 抖动（connection reset）→ 重试后拉取成功；§0 / §9 现状回填 | px |
| v1.8 | 2026-10-14 | TLS 切片收口：nginx 80 → 301 / 443 应用 / 9443 MinIO https 门面（Host 原样透传保 SigV4；证书单文件只读挂载）；compose 加 443/9443 端口与证书挂载；server.env S3 段切 https://test-pm.libiaorobot.com:9443、.env 回填 MINIO_CORS_ALLOW_ORIGIN；ALLinSSL SSH 自动下发（固定 /etc/ssl/ 路径 + allinssl 重载通道；第二台 103.44 接收端就绪）；服务器实测：证书链 200（无 -k）· 80/443/9443 全验 · storage:it 24/24（host 断言 9443）· 5 容器 healthy；§0 / §8 / §9 / §10 同步 | px |
| v1.9 | 2026-10-14 | SPA 产物上线：`frontend/dist`（10 文件 / 9.3MB）传服务器 + 权限修正（scp 707 畸形 → `chmod -R u=rwX,go=rX`）；实测站点根 200 / SPA 兜底 200 / wasm `application/wasm`；§8 SPA 说明与验证命令同步 | px |
| v1.10 | 2026-10-14 | SSO 切片（测试环境接通）+ Nginx 容器 DNS 动态解析：authtest 应用 `LibiaoLink` 按接入标准调整（redirect 追加 test-pm 回调 / 仅 `authorization_code` / `JWT-Custom` 五字段）→ 服务器回填 `casdoor_client_id` / `casdoor_client_secret`（chmod 600）+ `CASDOOR_ISSUER=https://authtest.libiaorobot.com` / `CASDOOR_REDIRECT_URI=https://test-pm.libiaorobot.com/auth/callback`；实测 `/auth/login` 302 → authtest 授权页（PKCE S256）· `/readyz` 200 · 5 容器 healthy；nginx 增 `resolver` + `upstream … resolve`（api / minio 重建换 IP 自动跟随，根治 502；重建回归通过）；§2 / §8 / §10 同步 | px |
| v1.11 | 2026-10-14 | SPA 更新部署（Push 304：「已有项目地区」按项目落库值聚合修复）：`frontend/dist` 重新构建 → tar 上传解包 + 权限 `u=rwX,go=rX`；旧哈希资源清理；实测站点根 200 / 新 JS 200 / `/healthz` 200 / `/readyz` 200；§8 补实测行（流程沿用 v1.9，无口径变化） | px |
| v1.12 | 2026-10-14 | 新增 §1.1 服务器登录（测试机 IP / 域名 / 登录方式 / 口令不落仓库 + 本机未跟踪备忘路径 / 登录后入口 / 铁律 / MinIO 控制台隧道 / 证书通道）；AGENTS.md 增「服务器与运维（测试机）」节（新会话自动注入可发现） | px |
| v1.13 | 2026-10-14 | 对象存储改「443 同源门面」修上传 / 预览断链：根因 = 客户端网络仅放行 22/80/443，预签名 URL 的 `:9443` 被拦（API 侧 201/200 正常、浏览器 PUT/GET 超时）→ 443 增 `location /libiaolink/`（= 桶名；`proxy_pass` 不重写、`Host $http_host` 保 SigV4）、`S3_ENDPOINT` 去端口为 `https://test-pm.libiaorobot.com`；`storage:it` 24/24 + 开发机真实网络预签名 PUT 200 / GET 200 字节一致 / DELETE 204 / 删后 404；9443 保留为内网备用门面；§0 / §8 / §9 / §10 同步 | px |
| v1.14 | 2026-10-14 | ONLYOFFICE 文档服务器生产上线（修「No online preview / DocServer unreachable」）：新增 `deploy/onlyoffice/docker-compose.prod.yml`（独立 compose 项目 `libiaolink-onlyoffice` / 不发布公网端口 / 8001 回环 / external 网络 `libiaolink-prod`）；nginx 增 `location /onlyoffice/`（去前缀 + `X-Forwarded-Prefix` / `X-Forwarded-Host` + Upgrade 透传 + `upstream … resolve`；DS 9.4 子路径原生支持）与 `location = /onlyoffice/example/` 恒 404（R6）；server.env `ONLYOFFICE_DOCSERVER_URL=https://test-pm.libiaorobot.com/onlyoffice`；镜像离线 save/scp/load 下发（1.7GB，归档 `/srv/data/images/oo_docs_9.4.0.1.tar`）；实测：门面 `api.js` 200 / `/onlyoffice/` 302 带前缀 / example 404 / healthz·readyz 200 · 密钥三处同值（宿主 secret / DS JWT_SECRET / api 进程）· DS→api:3000 200 · 匿名 preview-content 401 · WSS Upgrade 101 · 真实 64MB xlsx 经 443 全链渲染 ready（0 失败请求）；回滚备份 `nginx/libiaolink.conf.bak-oo-20261014` / `server.env.bak-oo-20261014`；`deploy/onlyoffice/README.md` 增 §6 + v1.1 | px |
| v1.15 | 2026-10-14 | 翻译通道切 API 方案（Push 309）：`translate` 模块 provider 可插拔 —— `TRANSLATE_PROVIDER=openai`（OpenAI 兼容 API 主通道：`TRANSLATE_API_BASE_URL` / `TRANSLATE_API_MODEL`，公司 New API 网关 `newapi.libiaorobot.com/v1`）/ `local`（本地引擎方案保留、暂不部署）；`TRANSLATE_FALLBACK_ORIGIN` 可选本地兜底；api / worker 入口增 `secrets/translate_api_key → TRANSLATE_API_KEY` 注入（不进仓库 / 不进 .env）；`server.env.example` TRANSLATE 段重写（provider / base / model / fallback）；`server/test/translate.test.ts` 13 例全绿；**服务器接线完成（14:36）**：`secrets/translate_api_key` 回填 + `server.env` 切 openai（备份 `server.env.bak-tr-20261014`）+ dist 重传 + api / worker 重建（均 healthy）；真机实测 4/4（1.5–2.6s/条） | px |
| v1.16 | 2026-10-14 | 翻译 API 备用模型接力（Push 310 · 业务口径「gemini-3.8-flash还有这个模型也可以调用 首选deepseek若deepseek断了就用这个」）：新增 `TRANSLATE_API_MODEL_FALLBACK`（备用 API 模型；留空 = 不接力）；`openai` 通道改「主模型 → 备用模型」两跳 —— 主模型（deepseek-v4-flash-vision-exp）失败（网络 / HTTP / 解析）且备用非空且不同名 → warn 日志 + 自动改调 `gemini-3.8-flash`（同一 New API 网关）；两跳皆败才回落 `TRANSLATE_FALLBACK_ORIGIN` 本地引擎（若配置）；落库 engine 按**实际产出模型**标记（`api:<模型>`）；`server.env.example` TRANSLATE 段补备用模型行；单测 18 例全绿 + 全量 1054 例全绿；**服务器接线（同一日）**：server.env 追加 `TRANSLATE_API_MODEL_FALLBACK=gemini-3.8-flash`（备份 `server.env.bak-tr2-20261014`）+ dist 重传 + api / worker 重建；真机实测主通道正常 + 主模型断流自动接力 2/2 | px |
| v1.17 | 2026-10-14 | 翻译规整补「句首大写」（Push 311 · 业务口径「句首大写规整 做」）：`translate.text.ts` 新增 `capitalizeSentenceStart`（小写开头 → 首字母大写；iPhone / eBay / pH 类品牌词形态不误伤；数字 / 标点 / 已大写幂等；占位符 Xq…Y 不受影响）；dist 重传解包 + `chmod -R a+rX` + api / worker `--force-recreate` 均 healthy；容器内探针：部署产物直测 6/6（「in dire straits」→「In dire straits」/ iPhone / eBay / 数字开头 / 已大写 / 全大写各 1 例）+ 真实网关实翻 3/3 正常（均句首大写）；无 env / 契约变化 | px |
| v1.18 | 2026-10-14 | SPA 更新部署（Push 312：日报贴图区「粘贴」的 Chrome「Blocked aria-hidden」控制台告警修复）：`frontend/dist` 重新构建 → tar 增量上传解包 + `chmod -R u=rwX,go=rX`；旧哈希资源清理 4 个；实测站点根 200 / 新 JS 200（sha256 `83e4f5b6…` 与本地构建一致）/ CSS 200 / `/healthz` 200 / `/readyz` 200；§8 补实测行（流程沿用 v1.11，无口径变化） | px |
| v1.19 | 2026-10-14 | 默认外观改档部署（Push 313：「所有人 背景=适中 + 无水印」默认值 + 迁移 `0049` 存量回填 + 甘特「全部」不出任务列表）：同步迁移 `0048`（lan 线 · 已在 main；服务器此前至 `0047`）+ `0049` → `db-migrate.sh` 实执行（23 ms / 6 ms）+ 复跑无漂移；服务器 DB 核对 `prefs` 分布 5/5 行 medium/false；server / shared dist 干净替换重传 + `chmod -R a+rX` + api / worker `--force-recreate`（5 容器 healthy）；`frontend/dist` tar 增量上传解包 + 旧哈希清理 2 个；实测站点根 200 / 新 JS 200（sha256 `3add9c49…` 与本地一致）/ `/healthz` 200 / `/readyz` 200；§6 迁移口径同步（49 个） | px |
| v1.20 | 2026-10-14 | 地区字典对齐部署（Push 314：region 种子改 201 国标准清单 + 迁移 `0051` 清理旧 8 条区域占位）：`database/` 同步（`0051` + `dicts.mjs`）→ `db-migrate.sh` 实执行 `0051`（4 ms）→ 复跑「已执行 50 个迁移，无漂移」（本包未含平行刀 0050）→ `db-seed.sh` 六种子全 0 变更（测试环境已先行重写、region 已 201 —— `0051` 为 0 行 no-op、种子全 in sync）；DB 核对 region = 201 / 占位 0 / 英国 920 · 美国 1640 · 中国 470 · 新西兰 2010；站点根 / `/healthz` / `/readyz` 200（公网 `test-pm.libiaorobot.com/healthz` 200）；§6 迁移口径同步（50 个） | px |
| v1.21 | 2026-10-14 | 变更前后可填图部署（Push 315：变更申请「变更前 / 变更后」可填摘要附图 —— 与日报同款贴图区 + 迁移订正 0050→0052）：`database/migrations/` 删残留 `0050` → 同步 `0052`（md5 一致）→ `db-migrate.sh` 实执行 `0052`（7 ms：两列 + 两 CHECK）→ 复跑「已执行 51 个迁移，无漂移」；server / shared dist 重传 + `chmod -R a+rX` + api / worker restart（均 healthy · `/healthz` 200 · `/readyz` 200 四探针全绿）；`frontend/dist` tar 增量上传解包 + 旧哈希清理 2 个；实测站点根 200（index.html 引用 `assets/index-BmpRAV9e.js`）、新 JS 200（1,109,516 B · sha256 `636c110b…` 与本地一致）、CSS 200、`/healthz` 200、`/readyz` 200、旧资源回落 SPA 兜底；§6 迁移口径同步（51 个） | px |
| v1.22 | 2026-10-14 | 老表 Excel 直连导入部署（Push 316：项目空间「导入项目」按钮 + 大屏四步 + 服务端 preview / commit + 迁移 `0053`）：`database/migrations/0053` 同步 → `db-migrate.sh` 实执行 `0053`（23 ms：`project_import_previews` 11 列 / 2 索引 / 5 CHECK / 2 FK，`committed_project_id → projects on delete set null`）→ 复跑「已执行 52 个迁移，无漂移」；server / shared dist 重传 + `chmod -R a+rX` + api / worker restart（均 healthy · `/healthz` 200 · `/readyz` 200）；`frontend/dist` tar 增量上传解包 + 旧哈希清理 3 个；实测站点根 200（index.html 引用 `assets/index-BgYAfdBn.js`）、新 JS 200（1,139,908 B · sha256 `838892a1…` 与本地一致）、CSS 200、`/healthz` 200、`/readyz` 200、旧资源回落 SPA 兜底、`POST /api/v1/project-imports/preview` 未登录 401（新路由挂载）；§6 迁移口径同步（52 个） | px |
| v1.23 | 2026-10-14 | 老表导入 413 热修（Push 317：443 server 级 `client_max_body_size 32m` 被 `/api/v1` 继承 → 61.4 MiB 老表在 nginx 层 413）：`location /api/v1` 单独放 `client_max_body_size 65m`（应用整包上限 64 MiB + 1m 余量 → 超限由应用回 JSON 400）→ conf 原地覆盖（保 inode）+ `nginx -t` + `nginx -s reload`（web 未重建）；双路实测：40 MB POST 413→401、70 MB POST 仍 413、61,410,006 B 老表原文件 POST → 401；`/nginx-health` / `/healthz` / `/readyz` / 站点根均 200 | px |
| v1.24 | 2026-10-14 | SPA 更新部署（Push 318：导入面板撤两处说明文案 —— 标题副标题 + 账号提示 · i18n -4 键）：`frontend/dist` tar 增量上传解包 + `chmod -R u=rwX,go=rX`；旧哈希资源清理 2 个（`index-BgYAfdBn.js` / `CadViewer-BekWaEqt.js`）；实测站点根 200（index.html 引用 `assets/index-BS9fUUs1.js`）、新 JS 200（1,139,052 B · sha256 `e624326f…` 与本地一致）、CSS 200、`/healthz` 200、`/readyz` 200；§8 补实测行（流程沿用 v1.21，无口径变化） | px |
| v1.25 | 2026-10-14 | 老表导入收口部署（Push 319：变更关联回写 + 问题默认处理人 + 变更读面容忍无文件）+ 存量回填：server / shared / frontend 三包 tar 上传解包 → 权限修复 → api / worker restart（healthy · `/healthz` 200 · `/readyz` 200）→ 旧哈希清理 2 个；站点根 200（引用 `assets/index-Bti0_HPU.js` · 1,140,699 B · sha256 `c50ead8c…` 与本地一致）、CSS 200；存量回填 `push319-import-backfill.mjs`（dry-run → 实跑 · 幂等复跑 0 变更）—— 3 条问题处理人 + 3 条任务变更关联；贾海洋会话公网复验：工作台「待我处理」3 条 / 任务 changeLinks 3 条 / 变更记录 4 条可见（fileId / versionId null）；会话即撤零残留 | px |
| v1.26 | 2026-10-14 | SPA 更新部署（Push 320：导入面板两处提示文案撤除 + 项目类型「＋ 添加项目类型」）：`frontend/dist` tar 增量上传解包 + `chmod -R u=rwX,go=rX`；旧哈希资源清理 2 个（`index-Bti0_HPU.js` / `CadViewer-BAbx1aIu.js`）；实测站点根 200（index.html 引用 `assets/index-CzQcCLqe.js`）、新 JS 200（1,140,534 B · sha256 `a149af6d…` 与本地一致）、CSS 200、`/healthz` 200、`/readyz` 200；线上 JS 文案核对（新增文案命中 · 撤销文案 0 命中）；§8 补实测行（流程沿用 v1.24，无口径变化） | px |
| v1.27 | 2026-10-14 | 老表导入「可取消」部署（Push 321）：2026-10-14 22:26 完成 api / worker 重启生效（本会话 22:36 核对：dist 含取消检查点标记 `IMPORT_CANCELLED` · 前端 `index-Dr85aZkg.js`）；本条随 v1.28 轮次核对补记 | px |
| v1.28 | 2026-10-14 | 退出登录回跳修正部署（Push 322：`post_logout_redirect_uri` 复用已登记回调地址 + 无参 `/auth/callback` 落回首页）：server / shared / frontend 三包重传解包 + `chmod -R a+rX`（server · shared）/ `u=rwX,go=rX`（frontend）→ api / worker restart（均 healthy · 容器 `/healthz` 200 · `/readyz` 四探针全绿）→ 站点根 200（index.html 引用 `assets/index-Dr85aZkg.js` · 1,141,642 B · sha256 `e52d86e5…` 与本地构建逐字节一致）· CSS 200（131,944 B · sha256 `2736d269…`）· `/healthz` 200 · `/readyz` 200；真机探针（临时会话即用即删 · 残留 0）：`/auth/logout` 302 → Casdoor `/api/logout` 携 `post_logout_redirect_uri=https://test-pm.libiaorobot.com/auth/callback` + `id_token_hint` + `client_id`（此前传站点根地址、被 Casdoor「许可跳转列表」拒绝返回错误 JSON）；无参 `/auth/callback` 302 → `/`；浏览器人工点验「退出登录 → 回登录页」待业务侧确认 | px |
| v1.29 | 2026-10-14 | nginx↔Node 上游长连接竞态 502 修复（Push 323）+ Push 321 真机取消验证收口：`upstream api_backend` 增 `keepalive 32;` / `keepalive_timeout 4s;`（idle ≤ 4s 复用 · 先于 api 默认 `keepAliveTimeout` 5s 关门）+ server 级 `proxy_set_header Connection "";`；conf 原地覆盖（保 inode · 单文件 bind mount）+ `nginx -t` OK + `nginx -s reload`（web 不重建）→ 探针：2s 间隔复用同连接 / 空闲 ~4s 本端先关（TIME_WAIT）/ 超时后新建；改前真机复现：取消提交后 ~5s preview 撞 `sendfile() failed (104)` 502；修复后真机复跑两轮共 8 次 61.4 MB preview 零 502 · 第二轮 Push 321 公网取消验证 == 全部通过 ==（commit 10.0s 中断落在图片上传中途 → 库 / 桶零残留 · 票据 pending 可重提 → 同票据重提 200 · 删项目 200 · 收尾桶恢复基线 422 键） | px |
