# 企业微信（WeCom）对接指南（Casdoor）

> 适用：SSO 管理员给 Casdoor 接企业微信；以及业务开发者想搞清「企微 → Casdoor → 我的应用」这条链路
> 源码依据：Casdoor master @ 2026-09-15（`idp/wecom_internal.go`、`object/syncer_wecom.go`）；本地 `casbin/casdoor:4.4.0` 的前端产物已逐项核对（Provider 表单、Syncer 表单、登录 URL 拼接一致）
> 配套文档：`docs/开发者接入注意事项(SSO接入标准).md`、`docs/公司统一登录(SSO)实施方案.md`
> 字段口径：`Name` = 拼音全名（如 `zhangsan`），见接入标准文档「附录 A」

---

## 一、先分清两条通道

Casdoor 和企业微信之间有**两条独立通道**，用到的 Secret 不是同一个，别混：

| 通道 | 作用 | Casdoor 位置 | 需要的凭证 | 触发频率 |
|---|---|---|---|---|
| 登录通道（OAuth） | 员工在企微点应用或扫码 → 免密登录 → Casdoor 签发 OIDC 令牌给业务系统 | Providers（Type=`WeCom`、Sub type=`Internal`） | CorpID + **自建应用 Secret** + AgentId | 每次登录 |
| 通讯录通道（Syncer） | 定时把企微的部门、成员、在职状态同步成 Casdoor 的用户和组 | Syncers（Type=`WeCom`） | CorpID + **通讯录 Secret** | 定时（建议 5~30 分钟） |

两条通道都只认一个 CorpID，但 Secret 来源不同：登录用「应用管理 → 自建应用 → Secret」，同步用「管理工具 → 通讯录同步 → Secret」（也可以给自建应用授予通讯录读取权限代替）。

**业务应用侧完全不碰企业微信**：接入方式仍是标准 OIDC（`Client ID` + `Client Secret`），只是令牌里的 `name` 变成企微的 `userid`（正好就是已定的拼音全名口径）。

---

## 二、企业微信侧配置（企微超管操作）

| # | 事项 | 位置 | 产出 / 注意 |
|---|---|---|---|
| 1 | 取企业 ID | 管理后台 → 我的企业 → 企业信息 | **CorpID**，形如 `ww1234567890abcdef` |
| 2 | 建自建应用 | 应用管理 → 应用 → 自建 → 创建应用 | 拿到 **AgentId** 和 **Secret**（Secret 只显示一次，丢了只能重置） |
| 3 | 配可信域名 | 应用详情 → 网页授权及JS-SDK → 设置可信域名 | 填 Casdoor 域名（正式环境 `auth.libiaorobot.com`）；下载 `WW_verify_xxx.txt` 放到该域名根目录后点「验证」 |
| 4 | 配可见范围 | 应用详情 → 可见范围 | 不在可见范围的员工，工作台看不到应用，也拿不到 `snsapi_privateinfo` 的私密信息 |
| 5 | 取通讯录 Secret | 管理工具 → 通讯录同步 | 给 Syncer 用 |
| 6 | 配企业可信IP（按需） | 应用详情 / 通讯录同步 | 若企微提示调用方 IP 不在白名单，把 Casdoor 服务器出口 IP 加进去 |

⚠️ 第 3 步的 `WW_verify_xxx.txt` 必须由**企业微信服务器**能访问到（它会主动去拉取）。内网域名、`localhost`、IP 地址都过不了校验 —— 这也是测试环境没有企业微信登录的根因。

---

## 三、Casdoor 侧：新建 Provider（登录通道）

`Providers` → `Add`：Category=`OAuth`、Type=`WeCom`、Sub type=`Internal`

| Casdoor 字段 | 填什么 | 说明 |
|---|---|---|
| `Client ID` | 企业 **CorpID** | |
| `Client secret` | 自建应用的 **Secret** | |
| 额外出现的 `App ID` 行 | 应用的 **AgentId** | 界面标签是 `Agent ID` |
| `Method` | `Normal` / `Silent` | 见下表 |
| `Scope` | `snsapi_privateinfo`（推荐）/ `snsapi_userinfo` | 只有 `snsapi_privateinfo` 会走 `user_ticket` → `getuserdetail`，能拿到**邮箱**；两个都不填则用默认值 |
| `Use id as name` | **打开** | 见下方警告 |

**Method 怎么选**（源码里实际拼接的地址）：

| Method | 跳转地址 | 体验 |
|---|---|---|
| `Normal` | `https://login.work.weixin.qq.com/wwlogin/sso/login?login_type=CorpApp&appid=<CorpID>&agentid=<AgentId>&redirect_uri=https://<Casdoor 域名>/callback&state=...` | 企业微信授权页，需要确认 |
| `Silent` | `https://open.weixin.qq.com/connect/oauth2/authorize?appid=<CorpID>&redirect_uri=...&scope=<Scope>&agentid=<AgentId>&state=...#wechat_redirect` | 静默拿 code，不弹确认（需在企微客户端内打开） |

回调地址固定是 `https://<Casdoor 域名>/callback`（由当前域名或应用的 `forcedRedirectOrigin` 决定），企微侧的可信域名要覆盖它。

⚠️ **`Use id as name` 必须打开**。关闭时 Casdoor 会把 `name` 设成企微里的**中文姓名**；打开后才用 `userid`（`zhangsan`）。这与已定口径（`name` = 拼音全名）直接相关，配错会导致所有用户对不上号。

---

## 四、接到应用上（Applications）

1. `Applications` → 你的应用 → `Providers`：勾上刚建的 WeCom Provider，登录页就会出现「企业微信」登录方式。
2. 勾选 `Enable Auto Signin`：已有 Casdoor 会话的员工（7 天内登录过）打开业务系统**直接进入**，不用再点按钮 —— 这就是「打开主页无需二次点击」的实现方式。
3. 企微工作台免登：把工作台应用的首页地址设为业务系统地址；没有 Casdoor 会话时，员工在企微里点一次「企业微信」即可（`Silent` 方式没有确认弹窗）。

---

## 五、通讯录同步（离职回收的关键一环）

`Syncers` → `Add`：Type=`WeCom`、Corp ID、Corp secret（通讯录 Secret）、组织选 `libiaorobot.com`

字段映射（源码 `wecomUserToOriginalUser`）：

| 企业微信 | Casdoor | 说明 |
|---|---|---|
| `userid` | `name` | 与登录口径天然一致 |
| `name` | `displayName` | 中文姓名 |
| `email` / `mobile` / `avatar` / `position` | `email` / `phone` / `avatar` / `title` | |
| `department` | 组（Group） | 部门 ID 作为组名 |
| `status` 为 2、4、5 或 `enable = 0` | `IsForbidden = true` | 停用、未激活、离职 → 自动禁用 |

**闭环**：企微停用或删除人员 → Syncer 下次运行 → Casdoor 用户被禁用或删除 → 自动化代码调业务系统的 `/internal/users/disable`、`/delete`（接口约定见《开发者接入注意事项》第五节）。

---

## 六、本地 / 测试环境能练到哪一步

| 环境 | 能否接真企微 | 原因 |
|---|---|---|
| 本地 Docker（`localhost:8000`） | ❌ | 可信域名必须是企微服务器可校验的域名，`localhost`、IP 都过不了 |
| 测试环境 `authtest.libiaorobot.com` | ❌（现况） | 仅内网，企微服务器拉不到 `WW_verify` 校验文件 |
| 正式环境 `auth.libiaorobot.com` | ✅ | 公网可达、域名可校验 |

结论：**企微登录只能在正式环境真跑**；本地和测试环境只能验证「Casdoor 侧配置项是否齐全、应用绑定是否正确」。登录环节请用正式环境的无痕窗口验证 —— 这也印证了公司文档里「测试环境没有企业微信登录」。测试环境继续用本地账号密码方式联调 OIDC 全链路即可。

> 2026-09-15 只读核对：测试环境里已有一个类型为 `WeCom` 的 Provider（`admin/WoCom`），但 CorpID / Secret / AgentId **全部为空**，是占位、不可用 —— 与「测试环境没有企业微信登录」的结论一致。

---

## 七、常见报错对照

| 现象 | 原因 | 处理 |
|---|---|---|
| `redirect_uri 参数错误` / 错误码 10003 | 可信域名没配，或回调地址不在可信域名下 | 企微后台补可信域名并完成校验 |
| `not an internal user` | 登录的人不在应用可见范围（或不是本企业成员） | 调整可见范围 |
| 读通讯录报无权限 | 用了应用 Secret 但没有通讯录权限 | 换成通讯录同步 Secret，或给应用授权 |
| 令牌里 `name` 是中文姓名 | Provider 没开 `Use id as name` | 打开开关后重新登录 |
| 授权后没回到 Casdoor、state 校验失败 | 企微登记域名与 Casdoor 实际域名（含端口）不一致 | 两边改成完全一致 |
| 静默方式报 scope 相关错误（未实测） | 静默授权通常需要 `snsapi_base`，而界面下拉只提供另外两个值 | 把 Provider 的 `scopes` 字段直接改成 `snsapi_base` |

---

## 八、谁做什么

| 事项 | 责任方 |
|---|---|
| 建自建应用、可信域名、可见范围、通讯录 Secret | 企业微信超级管理员 |
| Casdoor Provider / Syncer / 应用绑定 / Auto Signin | SSO 管理员 |
| 业务系统标准 OIDC 接入、离职禁用与删除 API | 业务开发者（见《开发者接入注意事项》） |

⚠️ 密钥只走密钥渠道：应用 Secret、通讯录 Secret 都不要贴群、不要进 Git。

---

## 九、立镖现状核对（2026-09-15，正式环境）

公开接口 `GET /api/get-provider?id=admin/WeCom` 可以直接读到正式环境已有的企微 Provider（不含密钥）：

| 项 | 值 | 结论 |
|---|---|---|
| Provider | 名称 `WeCom`、显示名「企业微信」，owner `libiaorobot.com`，创建于 2025-05-22 | **不用新建**，直接复用 |
| 类型 | `WeCom` / Sub type `Internal` | 企业内部应用 |
| Method | `Normal` | 走企业微信授权页（需确认一次） |
| `Use id as name` | **已开启** | `name` = 企微 `userid`，与已定口径（拼音全名）一致 |
| Scope | 空（用默认值） | 若业务确实需要邮箱，建议 SSO 管理员改为 `snsapi_privateinfo` 再回归验证 |
| CorpID / AgentId | 已填写 | — |
| 通讯录同步（Syncer） | 匿名接口查不到 | 需 SSO 管理员确认是否已配、多久跑一次 |

**业务应用要做的只有一件事**：`Applications` → 你的应用 → `Providers` 勾上「企业微信」，其余按标准 OIDC 接入。

> 说明：`/api/get-provider` 是登录页要用的公开接口，会返回掩码后的 `clientSecret`（`***`），不会泄露真实密钥；但这也提醒我们 —— Casdoor 里除密钥外的配置项都可能被匿名读到，别把敏感信息写进 Provider 的说明字段。
