-- LibiaoLink · 0043 一条日报多条问题（Push 243 · 业务口径 2026-10-08「日报填写问题时新增 添加问题按钮 … 提交后各自独立便于追溯」· 代做 wmj 线，请 wmj 复核）
-- 口径来源：系统功能书.md A3-09（问题自动生成）；契约 shared/src/modules/reports.ts（ReportIssueDraft / DailyReportCreateBody.issues /
--   DailyReportUpdateBody.issues）；前端功能需求.md §3.8 A21 / §6.12（同批修订）。
-- 三件事：
--   1. 新增 daily_reports.issue_drafts jsonb（not null default []，CHECK = 数组）：**内联问题清单** —— 「添加问题」逐条填的问题
--      （各带描述 / 归类 / 问题处理人 / 解决方案 / 附图）；暂存草稿整体落这里（不丢内容），提交时逐条生成独立问题记录，
--      生成后原稿保留不改写（便于追溯）。空数组 = 旧单问题字段口径（found_issue / issue_categories / suggestion）。
--   2. 删 issues.uq_issues_source_report（原口径 = 一条日报至多派生一条问题）—— 一天可有多个类型的问题，
--      一次填报（「添加问题」）可携带 1~N 条问题，逐条生成独立问题记录，原唯一约束不再成立。
--   3. A3-09 幂等兜底改由应用层承担：生成在日报事务内、持日报行锁，生成前按 source_report_id 计数（>0 即已生成过，不重复）；
--      见 server/src/modules/report-issue/report.service.ts（afterSubmit）。补部分索引 ix_issues_source_report（source_report_id is not null）：
--      替代原唯一约束承担的「按来源日报反查」路径（成对删除 / 幂等计数 / 附图转挂都要按来源日报查问题）。
-- 只追加迁移：应用角色 libiaolink_api 无 DDL；新列 / 索引随表级 GRANT 生效，无需额外授权。
-- 回滚（如需；一日报多问题的存量行无法回退到单问题口径，需先人工清理到每日报至多一条）：
--   alter table daily_reports drop constraint ck_daily_reports_issue_drafts;
--   alter table daily_reports drop column issue_drafts;
--   drop index if exists ix_issues_source_report;
--   alter table issues add constraint uq_issues_source_report unique (source_report_id);

alter table daily_reports add column issue_drafts jsonb not null default '[]'::jsonb;

alter table daily_reports add constraint ck_daily_reports_issue_drafts check (jsonb_typeof(issue_drafts) = 'array');

alter table issues drop constraint if exists uq_issues_source_report;

create index if not exists ix_issues_source_report on issues (source_report_id) where source_report_id is not null;
