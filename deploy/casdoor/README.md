# Casdoor 部署（公司统一登录）

配套方案文档：`docs/公司统一登录(SSO)实施方案.md`

> **用途**：① **本机联调**（当前主要用法）—— 按「一、启动」跑起来即可，登录页、账号与配置快照见 `docs/本地沙箱(LibiaoLink 演练环境).md`；
> ② **自建生产** —— 公司统一登录由 SSO 团队维护，业务方一般无需自建；若确要自建，按「二」~「五」的生产要求执行（HTTPS 反代、改默认密码、每日备份、接 Redis）。

## 一、启动

```bash
cp .env.example .env
vi .env                       # 改 SSO_ORIGIN 和三个密码
mkdir -p files logs backup
sudo chown -R 1000:1000 files logs      # 容器内以 uid 1000 运行
docker compose up -d
docker compose logs -f casdoor
```

> `files/brand/` 放应用 Logo（如 `files/brand/libiaolink-logo.svg`）：Casdoor 会以 `http://<origin>/files/brand/...` 对外提供，应用详情页的 Logo / LogoDark 就填这个地址。源文件在仓库 `assets/`，**换图后记得同步副本**。

## 二、首次登录并加固

1. 访问 `http://<服务器IP>:8000`（或已配好的 HTTPS 域名）
2. 组织 `built-in` / 用户名 `admin` / 密码 `123`
3. **立刻改密码 + 开 MFA**，然后按方案文档第四章配置组织、证书、应用、认证源。

## 三、反向代理

方案文档 3.5 节有完整 Nginx 配置。要点：

- `client_max_body_size 50m`（上传头像/附件）
- 透传 `Host` / `X-Forwarded-For` / `X-Forwarded-Proto`
- HTTP 全部 301 到 HTTPS
- `origin` 环境变量必须等于对外访问地址，否则登录回调地址会拼错

## 四、备份（上线前必做）

```bash
# 数据库全量备份，建议加进 crontab 每天执行
docker compose exec -T mysql \
  mysqldump -uroot -p"$MYSQL_ROOT_PASSWORD" --single-transaction --routines casdoor \
  | gzip > backup/casdoor_$(date +%F).sql.gz

# 同时备份上传的附件与配置
tar czf backup/casdoor_files_$(date +%F).tar.gz files
```

**恢复演练**：至少做过一次 `gunzip < xxx.sql.gz | docker compose exec -T mysql mysql -uroot -p... casdoor`，确认能恢复可用。

## 五、升级

```bash
# 1) 先备份（见上）
# 2) 改 .env 里的 CASDOOR_VERSION
docker compose pull casdoor
docker compose up -d casdoor
docker compose logs -f casdoor      # 观察启动日志与表结构迁移
```

Casdoor 启动时会自动执行表结构迁移，**升级前必须备份**；出问题就把 `CASDOOR_VERSION` 改回旧版本重启。

## 六、日常运维

```bash
docker compose ps
docker compose logs --tail=200 casdoor
curl -fsS http://127.0.0.1:8000/api/health    # 健康检查
```

- 登录审计：控制台 Records / Sessions / Tokens 三个页面
- 会话强退：Sessions 页面直接踢人
- 多副本：去掉 `127.0.0.1:8000` 端口映射，用多实例编排，务必保留 Redis 共享会话
