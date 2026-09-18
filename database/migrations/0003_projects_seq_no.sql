-- LibiaoLink · 数据库迁移 0003
-- 项目序号：对齐《技术设计v0.2-架构与数据模型.md》v0.2.3 §2.3（projects 新增 seq_no）。
-- 口径：项目序号 = 全库唯一正整数，创建时由服务端序列分配；稳定不变、不回收（删除项目不重排、不重发）；
--   与「项目编号 code」一一对应同一个项目；供首页卡片右上角徽标（两位补零展示）、
--   列表排序（sort=seqNo:asc|desc）与快速定位使用。
-- 执行者：libiaolink_migrator（最小权限角色，见 roles/0001_roles.sql）。
-- 规则：迁移只追加、不可修改（CONTRIBUTING §14）；本文件不含 BEGIN/COMMIT —— 迁移器把每个文件包在独立事务中执行。
-- 数据安全：存量行按 created_at、code 升序回填 1..N（确定性、可复现）；随后把序列推进到 max(seq_no)+1，
--   下一个新项目取到 max+1，不重号。

-- 1) 序列：项目序号的唯一来源（由 projects.seq_no 列持有，expand / contract 收起列时一并回收）
create sequence projects_seq_no_seq;

-- 2) 新列先可空加入（存量行不阻塞）
alter table projects add column seq_no integer;

-- 3) 存量回填：按创建时间升序取 1..N；同一时刻并列的行用 code 兜底，保证确定性
update projects p
   set seq_no = t.rn
  from (
    select id, row_number() over (order by created_at, code) as rn
      from projects
  ) t
 where t.id = p.id;

-- 4) 序列推进：setval(..., false) 表示下一次 nextval 返回 基数+1（空表时为 1）
select setval('projects_seq_no_seq', coalesce((select max(seq_no) from projects), 0) + 1, false);

-- 5) 默认值 / 非空 / 唯一 / 正数校验（唯一约束自带索引，无需另建）
alter table projects alter column seq_no set default nextval('projects_seq_no_seq');
alter table projects alter column seq_no set not null;
alter table projects add constraint uq_projects_seq_no unique (seq_no);
alter table projects add constraint ck_projects_seq_no check (seq_no > 0);

-- 6) 归属：序列随 projects.seq_no 列生命周期
alter sequence projects_seq_no_seq owned by projects.seq_no;
