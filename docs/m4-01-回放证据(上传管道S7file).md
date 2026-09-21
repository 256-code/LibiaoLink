# M4-01 回放证据（S7·file 上传管道：分片直传 / 断点续传 / 完成落版本 / 过期清理）

> 卡片：M4-01「file 模块：上传管道（发起 / 分片 / 完成 / 取消）」（主责 lan，评审 wmj）｜口径来源：ADR-006 定案（Push 126）、系统功能书 A4-01~A4-03、技术设计v0.2 §5.1-5.2、上传错误码契约 V0.3。
> 落点说明：`docs/` 属 px 线；本文件由 lan 随 M4-01 卡片代记（回放脚本与断言同 PR，请 px 复核）。

| 项 | 值 |
|---|---|
| 回放时间 | 2026-09-21 16:54:14 +08:00 |
| 目标 | http://127.0.0.1:3011 |
| 数据库 | postgresql://libiaolink_migrator@127.0.0.1:55432/libiaolink |
| 对象存储 | libiaolink（本地 MinIO 沙箱：仅沙箱、不代表生产选型） |
| 代码版本 | 0a5a618（回放时工作区含本卡未提交改动） |
| 执行账号 | 管理员（含 file.upload）+ 名册成员（file.upload 平权基准） |
| 脚本 | server/scripts/m4-upload-replay.mjs |

## 断言明细

| PASS | S0 | api 可用（/healthz + /readyz：含存储探针） | 
  - 期望：200 / 200
  - 实际：200 / 200
| PASS | S1 | 管理员会话含 file.upload / file.download（上传入口的功能权限位） | 
  - 期望：200 + 含 file.upload 与 file.download
  - 实际：200 {"userId":"caa8d763-4b6a-4967-9b26-7d1086272c9c","roleCodes":["admin"],"hasUpload":true,"hasDownload":true}
| PASS | P1 | 建回放项目（导入即快照，为 file 提供 projectId） | 
  - 期望：201 + 项目可见
  - 实际：201 {"id":"4d367826-f7d2-4e30-a18c-a6f20dd562f2","code":"M4-20260921085407"}
| PASS | P2 | 建第二个项目（跨项目 nodeId 反例用） | 
  - 期望：201
  - 实际：201
| PASS | P3 | 快照节点可见（项目 A / B 各取一个节点） | 
  - 期望：两个节点非空
  - 实际：{"nodeA":"b3755c1e-a04e-425d-a1b1-145f1bc12833","nodeB":"d61d65be-0960-4292-86a5-bb980f219457"}
| PASS | T1 | 分片状态不落表（2026-09-18 评审定案：以 ListParts 为唯一真相） | 
  - 期望：upload_parts 表不存在（null）
  - 实际：null
  - 说明：会话元数据落 upload_sessions；分片清单只从对象存储读
| PASS | U1 | 发起上传：建 draft 文件 + 会话（返回分片计划与到期时间） | 
  - 期望：201 + status=draft + version=0 + intent=version + 8 MiB x 3 片 + duplicateHint=null
  - 实际：201 {"fileId":"9f0d7a21-d476-4e66-99b9-e9c26b78c45a","status":"draft","version":0,"intent":"version","partSizeBytes":8388608,"totalParts":3,"duplicateHint":null}
| PASS | U2 | 落库口径：会话先写暂存键 / 文件 draft version 0 / 发起上传留痕（objectType=file） | 
  - 期望：object_key = …/staging/{sessionId}、files.status=draft、files.version=0、审计 1 条（metadata.uploadId）
  - 实际：{"objectKey":"projects/4d367826-f7d2-4e30-a18c-a6f20dd562f2/files/9f0d7a21-d476-4e66-99b9-e9c26b78c45a/staging/7b4a24c5-cff9-4d02-b92c-4f8ab548c6b5","status":"draft","version":0,"currentVersionId":null,"ttlHours":24,"auditAction":"create","auditUploadId":"7b4a24c5-cff9-4d02-b92c-4f8ab548c6b5"}
| PASS | U3 | 取分片预签名 URL（首次调用登记存储侧 UploadId；URL 指向对象存储、api 不代理流量） | 
  - 期望：200 + 3 条 URL（含 X-Amz-Signature）+ 落 storage_upload_id
  - 实际：200 {"count":3,"host":"127.0.0.1:9000","signature":true,"storageUploadId":true}
| PASS | U4 | 分片 1 直传（浏览器同口径：裸 PUT 预签名 URL） | 
  - 期望：HTTP 200 + ETag
  - 实际：HTTP 200 "4b087ce3111c75919019c76230e566e3"
| PASS | U5 | 断点续传依据：会话状态回已传 / 缺失分片（ListParts 为唯一真相） | 
  - 期望：uploaded=[1] missing=[2,3]
  - 实际：{"uploaded":[1],"missing":[2,3],"status":"active"}
| PASS | U6 | 只补缺失分片（续传不重传已传分片） | 
  - 期望：2 条补传均 200 + ETag
  - 实际：[200,200]
| PASS | U7 | 补齐后会话状态：已传 3 / 缺失 0 | 
  - 期望：uploaded=[1,2,3] missing=[]
  - 实际：{"uploaded":[1,2,3],"missing":[]}
| PASS | U8 | 完成上传：版本 v1 落库、文件 currentVersionId / version 前进 | 
  - 期望：200 + version.seq=1 + sizeBytes=20 MiB + files.version=1 + changeRequest=null
  - 实际：200 {"seq":1,"sizeBytes":20971520,"fileVersion":1,"currentVersionId":"f8554e3b-2f37-4ec5-914c-90e8c3d9697c","changeRequest":null}
| PASS | U9 | 契约键口径（ADR-006）：file_versions.object_key = …/v{seq}/{contentHash}.{ext}，会话 completed | 
  - 期望：object_key=projects/4d367826-f7d2-4e30-a18c-a6f20dd562f2/files/9f0d7a21-d476-4e66-99b9-e9c26b78c45a/v1/0ca27a50836b3bd1356deb974388ca084ddad8370c77e54d93935e5e28139c58.docx
  - 实际：{"objectKey":"projects/4d367826-f7d2-4e30-a18c-a6f20dd562f2/files/9f0d7a21-d476-4e66-99b9-e9c26b78c45a/v1/0ca27a50836b3bd1356deb974388ca084ddad8370c77e54d93935e5e28139c58.docx","sizeBytes":20971520,"status":"completed","completedAt":true}
| PASS | U10 | 存储侧：契约键对象存在且大小一致；暂存对象按版本清理干净（无数据版本 / 无 delete marker） | 
  - 期望：契约键 20 MiB；暂存键 0 版本 0 marker
  - 实际：{"contractSize":20971520,"stagingVersions":0,"stagingMarkers":0}
| PASS | U11 | 留痕与事件：complete 审计（metadata 带 versionSeq / objectKey）+ outbox file.version.created（dedupeKey 幂等） | 
  - 期望：审计 1 条 + outbox 1 条（dedupeKey=file.version.created:f8554e3b-2f37-4ec5-914c-90e8c3d9697c）
  - 实际：{"audit":1,"versionSeq":1,"objectKey":"projects/4d367826-f7d2-4e30-a18c-a6f20dd562f2/files/9f0d7a21-d476-4e66-99b9-e9c26b78c45a/v1/0ca27a50836b3bd1356deb974388ca084ddad8370c77e54d93935e5e28139c58.docx","outbox":1,"dedupeKey":"file.version.created:f8554e3b-2f37-4ec5-914c-90e8c3d9697c","status":"pendi…
| PASS | U12 | 秒传提示（A4-04）：同项目同内容哈希 → duplicateHint 指向既有文件（不阻断继续上传） | 
  - 期望：duplicateHint.fileId=9f0d7a21-d476-4e66-99b9-e9c26b78c45a
  - 实际：201 {"hint":{"fileId":"9f0d7a21-d476-4e66-99b9-e9c26b78c45a","name":"机械设计图纸-v2.docx","sizeBytes":20971520,"uploadedBy":"caa8d763-4b6a-4967-9b26-7d1086272c9c","uploadedAt":"2026-09-21T08:54:07.502Z"},"newFileId":"40456e6f-2721-4792-b12f-78fb38a4…
| PASS | U13 | 已完成会话不可续传（409 FILE_STATE_INVALID）/ 不可取消（回退走版本回溯 M4-02） | 
  - 期望：409 + 409
  - 实际：409 {"code":"FILE_STATE_INVALID","message":"上传会话已结束（completed），不可续传；请重新发起上传","details":[],"traceId":"29a6c297-8808-4e21-943b… / 409 {"code":"FILE_STATE_INVALID","message":"上传已完成，不能取消；如需回退请走版本回溯（M4-02）","details":[],"traceId":"86fa0bfe-b3f8-4307-b1d3-5a…
| PASS | U14 | 分片未齐 → 409 UPLOAD_INCOMPLETE（details.missing 可驱动前端补传） | 
  - 期望：409 + missing=[2,3] + 无版本行
  - 实际：409 {"code":"UPLOAD_INCOMPLETE","missing":[2,3]}
| PASS | U15 | complete 哈希与 init 声明不一致 → 422 FILE_HASH_MISMATCH（一致性校验不省；不复制不落库） | 
  - 期望：422 + code=FILE_HASH_MISMATCH + 无版本行
  - 实际：422 {"code":"FILE_HASH_MISMATCH","detail":"hash_mismatch"}
| PASS | U16 | 合并后大小与声明不一致 → 409 UPLOAD_INCOMPLETE（size_mismatch；不信客户端声明） | 
  - 期望：409 + code=UPLOAD_INCOMPLETE + details.size_mismatch
  - 实际：409 {"code":"UPLOAD_INCOMPLETE","details":[{"code":"size_mismatch","message":"sizeBytes 不一致","path":"sizeBytes","meta":{"declared":8388608,"actual":8388609}}]}
| PASS | U17 | 取消上传：首个 200 aborted + 重复取消幂等 200 + 之后取分片 410（会话不可再用） | 
  - 期望：200 aborted / 200 aborted / 410 UPLOAD_SESSION_EXPIRED
  - 实际：{"first":"aborted","second":"aborted","sign":"410 UPLOAD_SESSION_EXPIRED"}
| PASS | U18 | 过期会话（访问时惰性）：取分片 410 + 会话置 expired + 暂存清干净 + system 审计（actorId=null） | 
  - 期望：410 UPLOAD_SESSION_EXPIRED + status=expired + 0 数据版本 + 审计 actor_id=null
  - 实际：{"code":"UPLOAD_SESSION_EXPIRED","status":"expired","versions":0,"auditActor":null}
  - 说明：过期模拟：created_at / expires_at 同时前移（ck_upload_sessions_expires 要求 expires_at > created_at）
| PASS | U19 | worker 定时档（启动即跑一轮）：中止未完成分片 + 按版本清暂存 + 置 expired | 
  - 期望：status=expired + 0 数据版本 + worker 启动日志
  - 实际：{"status":"expired","versions":0,"started":true}
  - 说明：worker 日志：{"level":30,"time":1789980848783,"pid":3240,"hostname":"liuannan","msg":"worker 已启动（已接入上传会话过期清理；Outbox 投递 / 调度 / 规则 / 转换编排随后续卡片接入）"} | {"level":30,"time":1789980848833,"pid":3240,"hostname":"liuannan","msg":"上传会话过期清理：扫描 
| PASS | U20 | file.upload 项目成员平权：非成员 404（防 IDOR）→ 入名册后 201 | 
  - 期望：404 NOT_FOUND / 201 + draft
  - 实际：404 NOT_FOUND / 201 draft
  - 说明：名册写入返回 200
| PASS | U21 | 跨项目 nodeId → 400（防跨项目挂接）；intent=change → 400（Push 130 定案：change 必填 fileId，本请求缺 fileId 被契约拒；实现随 M4-04） | 
  - 期望：400 VALIDATION_FAILED（invalid_node）/ 400 VALIDATION_FAILED
  - 实际：400 {"code":"VALIDATION_FAILED","detail":"invalid_node"} / 400 VALIDATION_FAILED
| PASS | U22 | 带 fileId 一律显式 400（Push 130 显式守卫：zod 放行后不守卫会静默新建文件）：version + fileId / change + fileId | 
  - 期望：400 VALIDATION_FAILED（file_id_not_supported）/ 400 VALIDATION_FAILED（intent_change_not_open）
  - 实际：400 {"code":"VALIDATION_FAILED","detail":"file_id_not_supported"} / 400 {"code":"VALIDATION_FAILED","detail":"intent_change_not_open"}

## 汇总

- ✅ 全部断言通过（28 项）：发起上传 / 分片直传与续传 / 完成落版本（契约键）+ 留痕与事件 / 失败面 / 过期清理（惰性 + worker）/ 权限平权。

## 验收对照（M4-01）

- 发起上传 = U1 / U2：POST /files/uploads 建 draft 文件 + 上传会话；会话先写暂存键（ADR-006），contentHash 命中回秒传提示（U12）。
- 分片直传 / 断点续传 = U3 ~ U7：预签名 URL 由浏览器裸 PUT（api 不代理流量）；GET 会话状态回已传 / 缺失分片；分片状态不落表（T1）。
- 完成上传 = U8 ~ U11：合并 → HEAD 校大小 → 哈希一致性 → copyObject 到契约键 → 事务写版本 / 文件 / 会话 + 审计 + outbox → 按版本清暂存。
- 失败面 = U13 ~ U17：缺片 409 / 大小不符 409 / 哈希不符 422 / 已完成 409 / 取消幂等 + 取消后 410。
- 过期与清理 = U18 / U19：访问时惰性置 expired（410 + system 审计）；worker 启动一轮即清理未完成分片与暂存对象。
- 权限与守卫 = U20 / U21 / U22：非成员 404（防 IDOR）→ 名册成员 201；跨项目 nodeId 400；intent=change 400；带 fileId（version / change）一律显式 400（Push 130 定案后的切片守卫，M4-02 / M4-04 放开）。
- 单测回归（不连库）：server/test/file-service.test.ts（34 例）随 npm test 常跑：成功链路 / 缺片 / 哈希 / 大小 / 过期 / 秒传 / 越界 / 完成位次竞态。
- 复跑：cd server && node --env-file-if-exists=.env scripts/m4-upload-replay.mjs --out "./../docs/m4-01-回放证据(上传管道S7file).md"
