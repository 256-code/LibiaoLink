-- LibiaoLink · 数据库角色基线 0001（g3 · S5）
-- 对应《技术设计v0.2-架构与数据模型.md》§2.3 与 CONTRIBUTING.md §14：
--   结构变更由独立、受限的迁移任务执行；应用进程不得在启动时自动修改结构。
-- 执行者：数据库管理员（超级用户，或有 CREATEROLE + 相应授权能力的账号）；本文件幂等，可重复执行。
-- 密码不写入仓库（CONTRIBUTING §12）：角色以「无密码 LOGIN」创建（此时无法用密码登录），
--   部署时由密钥库脚本注入 ALTER ROLE ... PASSWORD，步骤见 database/README.md。
-- 角色划分：
--   libiaolink_migrator  迁移专用：public 模式建表权限；迁移产生的对象归其所有（全库唯一持有 DDL 的角色）
--   libiaolink_api       应用运行：业务表增删改查 + 序列取值（无任何 DDL 权限）
--   libiaolink_readonly  只读：业务表 SELECT（排查 / 报表 / 核对用）

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'libiaolink_migrator') then
    create role libiaolink_migrator login;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'libiaolink_api') then
    create role libiaolink_api login;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'libiaolink_readonly') then
    create role libiaolink_readonly login;
  end if;
end $$;

-- 连接权限按「当前数据库」授予，脚本不绑定环境库名
do $$
begin
  execute format('grant connect on database %I to libiaolink_migrator', current_database());
  execute format('grant connect on database %I to libiaolink_api', current_database());
  execute format('grant connect on database %I to libiaolink_readonly', current_database());
end $$;

grant usage on schema public to libiaolink_api, libiaolink_readonly;
grant create on schema public to libiaolink_migrator;

-- 已存在对象：重复执行时可补授权
grant select, insert, update, delete on all tables in schema public to libiaolink_api;
grant usage, select on all sequences in schema public to libiaolink_api;
grant select on all tables in schema public to libiaolink_readonly;

-- 默认权限：迁移器将来新建的对象自动授权（一期所有表均由迁移器创建）
alter default privileges for role libiaolink_migrator in schema public
  grant select, insert, update, delete on tables to libiaolink_api;
alter default privileges for role libiaolink_migrator in schema public
  grant usage, select on sequences to libiaolink_api;
alter default privileges for role libiaolink_migrator in schema public
  grant select on tables to libiaolink_readonly;

-- 迁移记录表归迁移器独有：显式收回应用 / 只读角色（默认权限会覆盖到它）
do $$
begin
  if exists (select 1 from pg_class where relname = 'schema_migrations' and relnamespace = 'public'::regnamespace) then
    revoke all on table public.schema_migrations from libiaolink_api;
    revoke all on table public.schema_migrations from libiaolink_readonly;
  end if;
end $$;

-- 审计防篡改（h7 · C7-05）：应用角色对 audit_logs 仅 SELECT / INSERT。
-- 上面的「全表授权」会给已存在的 audit_logs 重新授予 UPDATE / DELETE，
-- 因此角色脚本每次执行都要显式收回（表存在时；表不存在则由 0013 迁移内的 revoke 兜底）。
do $$
begin
  if exists (select 1 from pg_class where relname = 'audit_logs' and relnamespace = 'public'::regnamespace) then
    revoke update, delete on table public.audit_logs from libiaolink_api;
    grant select, insert on table public.audit_logs to libiaolink_api;
    grant select on table public.audit_logs to libiaolink_readonly;
  end if;
end $$;
