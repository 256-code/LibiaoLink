# deploy/minio/ · 对象存储沙箱（S7·file 存储接入）

ADR-006 选定「S3 协议抽象 + MinIO 单节点」。本目录是**本地 / 联调沙箱**，不是生产部署模板。

## 阶段 0 结论（2026-09-20 实测，请 wmj / px 复核）

ADR-006 要求「阶段 0 必须核实 MinIO 许可与版本并锁定」。核实结果：

| 项 | 结论 |
|---|---|
| 许可 | **AGPL-3.0** —— 容器内 `minio --version` 自述与 `/licenses/LICENSE` 一致，GitHub 仓库 license 字段同为 `AGPL-3.0` |
| 版本 | 锁定 `RELEASE.2025-09-07T16-13-09Z`（commit `07c3a429bfed433e49018cb0f78a52145d4bedeb`，go1.24.6 linux/amd64） |
| 镜像 | 来自 `quay.io/minio/minio`；**Docker Hub 的 `minio/minio` 已不存在**（`docker pull` 返回 pull access denied） |
| 官方下载 | `https://dl.min.io/server/minio/release/**`（含 windows / linux 二进制与目录页）**全部 410 Gone** |
| 上游仓库 | `github.com/minio/minio` 已 **archived**（最后推送 2026-04-24） |

**含义**：ADR-006 写的切换触发条件之一是「MinIO 许可或功能不满足」。现在的证据更强：**上游归档、官方分发渠道下线**，社区版不再有安全更新。本次不动 ADR（ADR 与 `技术设计*` 属 wmj 主责），只把证据与本目录的锁定值落到工程侧，并提请定案。

候选替代（接口层只依赖 S3 协议，**换实现不动调用代码**，见 `server/src/storage/README.md`）：

1. 复用公司内网既有对象存储 / MinIO（运维能力现成，风险最低）；
2. SeaweedFS（Apache-2.0，活跃维护）等 S3 兼容实现；
3. 公司云 OSS（受「不允许上传第三方云」约束，需先有云策略结论）。

## 启动（本地沙箱）

```bash
cp .env.example .env      # 改成本地口令（不要用示例值）
docker compose up -d
docker compose ps         # 等 healthcheck 变 healthy
```

控制台：<http://127.0.0.1:9001>（用 `.env` 里的口令登录）；S3 API：`http://127.0.0.1:9000`。

## 与应用对接

`server/.env` 填同一组值（示例见 `server/.env.example`）：

```dotenv
S3_ENDPOINT=http://127.0.0.1:9000
S3_REGION=us-east-1
S3_ACCESS_KEY=<MINIO_ROOT_USER>
S3_SECRET_KEY=<MINIO_ROOT_PASSWORD>
S3_BUCKET=libiaolink
S3_FORCE_PATH_STYLE=auto   # 非 AWS 端点自动走 path-style
```

然后（`server/` 目录下）：

```bash
npm run build
npm run storage:init    # 建桶 + 版本控制 + CORS + 未完成分片清理；-- --check 只读校验
npm run storage:it      # 真机回放：创建会话 → 分片直传 → ListParts → 合并 → HEAD → 签名下载 → 哈希比对
```

`storage:init` 需要 `S3_CORS_ORIGINS`（默认 `http://localhost:5173`）与 `S3_ABORT_INCOMPLETE_DAYS`（默认 30）两个可选变量，前者要覆盖前端实际来源。

## 与生产部署的差距（不在本沙箱内）

- 独立数据盘、每日增量异地同步、定期抽检恢复 —— ADR-006 要求，属运维线（px）与生产环境落地；
- **预签名 URL 的 host 必须对客户端可达**：沙箱用 `127.0.0.1`，生产要按内网 / 外网两种形态用真实网络验证后回写；
- 桶策略只允许签名访问（`storage:init` 会做一次匿名 GET 断言）；
- 本次**未**配置整桶对象过期：草稿 30 天清理按 `files.purge_after` 由 worker 驱动（M4-02），存储侧只兜底未完成分片，避免误删定档文件。
