#!/usr/bin/env node
/**
 * S7-4 · M5-02 接线段 真机回放（规则事件消费 + automation-schedule.job → notify.message 生产）：
 *   证据一（事件链全链）：task.completed 真 outbox 行 → 真 OutboxDispatcher 领取 → 规则接线消费（R02 命中）
 *        → 产出 notify.message（收件人 / 类型 / 渠道 / 模板 / 关联对象 / 幂等键全字段断言）→ 下一轮领取
 *        → 真 NotifyService 落行 → 收件箱读面（notify.list）立即可见。
 *   证据二（冷启动保护）：行创建时刻超 AUTOMATION_EVENT_MAX_AGE_MS 的历史事件 → done、零产出；同载荷新事件
 *        正常产出（对照组：拦截判据是「事件年龄」而非条件不命中）。
 *   证据三（主体不可解析）：taskId 不存在 → outbox 行 dead（确定性失败一次即弃）、零产出。
 *   证据四（无事件型规则订阅）：issue.updated 主题 → 直接消费完成、零产出（不产无主通知）。
 *   证据五（渠道护栏）：notify.message 行 channel=wecom_app → 投递层 dead + 零落库（M5-03 前不静默当站内信）。
 *   证据六（调度窗口 · A03 T+1）：真 JobScheduler tick 领取 automation-schedule.job → 产出与 last_run_at 推进
 *        同事务提交、job_runs 留痕（executed / fire_count / produced / note）→ 消费 → 收件箱可见。
 *   证据七（调度窗口 · A01 合并）：同一人名下多项目 → 收件人粒度一条（项目清单合并文案 + 幂等键收件人粒度）。
 *   证据八（重放幂等）：回拨窗口重放 → 产出幂等键不重复（appendOutboxIfAbsent 唯一约束兜底）、job_runs 如实留痕。
 *   证据九（非 inbox 跳过）：R02 / A03 的 wecom_app 动作不产行，接线层 warn + channelSkipped 计数入 note。
 *   证据十（自清理）：合成前缀 / 实体 id 全量精确清理，零残留（finally 兜底）。
 *
 * 前置：真 PG（迁移器角色即可）+ 已构建的 server/dist（cd server && npm run build）。
 * 用法：cd server && S7_4_WIRING_DATABASE_URL=postgresql://libiaolink_migrator@127.0.0.1:55432/libiaolink \
 *       node scripts/s7-4-automation-wiring-replay.mjs [--out <报告.md>] [--json <证据.json>] [--keep]
 * 退出码：断言全过 = 0，否则 = 1（可当门禁用）。
 * 说明：本机无 PG 时只做语法门禁；真机证据以 CI database job 为准（不伪造）。合成实体 id 全部由脚本生成、
 *   按 id / 前缀精确清理（--keep 时保留现场）。
 */
import { randomBytes, randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import pg from "pg";

const HERE = dirname(fileURLToPath(import.meta.url));
const args = parseArgs(process.argv.slice(2));
const DATABASE_URL =
  args.databaseUrl ??
  process.env.S7_4_WIRING_DATABASE_URL ??
  process.env.S7_4_DATABASE_URL ??
  process.env.DATABASE_URL ??
  "postgresql://libiaolink_migrator@127.0.0.1:55432/libiaolink";

/** 本回放合成 outbox 去重键前缀（清理 / 基线计数用）：证据专用，不落生产代码。 */
const OUTBOX_PREFIX = "s74wireReplay.";
const USER_PREFIX = "s74w-";
const JOB_REPLAY_TAG = "s74wire-replay";
const WORKER_ID = "s74wire-replay";
const HOUR_MS = 3_600_000;
/** 与 env 缺省同档（6h）：冷启动保护证据按它构造「过旧」行。 */
const EVENT_MAX_AGE_MS = 6 * HOUR_MS;
/** 固定时钟：上海 2026-09-24 20:00 —— A03 T+1（当日 09:00）与 A01（当日 19:30）触发均已过且在窗口内。 */
const CLOCK_NOW = new Date("2026-09-24T12:00:00.000Z");
/** 调度窗口起点：上海 2026-09-24 00:00 —— 窗口 (起点, now] 覆盖当日全部触发时刻。 */
const JOB_WINDOW_START = new Date("2026-09-23T16:00:00.000Z");
/** 业务日（A01 上报基准日 / A03 T+1 触发日；上海 2026-09-24 周四 = 缺省工作日）。 */
const BUSINESS_DATE = "2026-09-24";

const report = [];
const evidence = { anchors: {}, checks: [] };
let pass = 0;
let fail = 0;
let runtime;
let db;

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (item === "--out") out.out = argv[++i];
    else if (item === "--json") out.json = argv[++i];
    else if (item === "--database-url") out.databaseUrl = argv[++i];
    else if (item === "--keep") out.keep = true;
  }
  return out;
}

function check(id, title, expected, actual, ok, extra = "") {
  if (ok) {
    pass += 1;
  } else {
    fail += 1;
  }
  report.push(
    "| " + (ok ? "PASS" : "FAIL") + " | " + id + " | " + title + " | 期望：" + expected + " | 实际：" + actual +
      (extra === "" ? "" : " | " + extra) + " |",
  );
  evidence.checks.push({ id, title, expected, actual, ok, extra });
  process.stdout.write((ok ? "PASS " : "FAIL ") + id + " " + title + String.fromCharCode(10));
}

function short(value, max = 320) {
  const text = JSON.stringify(value);
  return text === undefined ? "undefined" : text.length > max ? text.slice(0, max) + "..." : text;
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}

function fmtJob(row) {
  if (row === null || row === undefined) return "（行不存在）";
  return (
    "status=" + row.status + " / attempts=" + row.attempts + " / locked_at=" + (row.locked_at === null ? "null" : "非空") +
    " / last_run_at=" + (row.last_run_at === null ? "null" : new Date(row.last_run_at).toISOString())
  );
}

/** 加载 dist（真运行时类）；缺构建时给出明确指引。 */
async function loadRuntime() {
  await import("reflect-metadata");
  const load = (relative) => import(pathToFileURL(join(HERE, "..", "dist", relative)).href);
  try {
    const [
      envModule,
      configModule,
      databaseModule,
      clockModule,
      notifyRepositoryModule,
      notifyServiceModule,
      notifyIndexModule,
      outboxModule,
      outboxStoreModule,
      dispatcherModule,
      policyModule,
      alertModule,
      jobsStoreModule,
      schedulerModule,
      subjectsModule,
      wiringModule,
      automationIndexModule,
      calendarServiceModule,
      calendarRepositoryModule,
      auditServiceModule,
      auditRepositoryModule,
    ] = await Promise.all([
      load("config/env.js"),
      load("config/config.module.js"),
      load("db/database.service.js"),
      load("common/clock/clock.service.js"),
      load("modules/notify/notify.repository.js"),
      load("modules/notify/notify.service.js"),
      load("modules/notify/index.js"),
      load("db/outbox.js"),
      load("db/outbox.store.js"),
      load("outbox/dispatcher.js"),
      load("outbox/policy.js"),
      load("outbox/alert.js"),
      load("db/jobs.store.js"),
      load("outbox/scheduler.js"),
      load("outbox/automation-subjects.js"),
      load("outbox/automation-wiring.js"),
      load("modules/automation/index.js"),
      load("modules/calendar/calendar.service.js"),
      load("modules/calendar/calendar.repository.js"),
      load("modules/admin/audit.service.js"),
      load("modules/admin/audit.repository.js"),
    ]);
    return {
      loadEnv: envModule.loadEnv,
      AppConfig: configModule.AppConfig,
      DatabaseService: databaseModule.DatabaseService,
      ClockService: clockModule.ClockService,
      NotifyRepository: notifyRepositoryModule.NotifyRepository,
      NotifyService: notifyServiceModule.NotifyService,
      NOTIFY_MESSAGE_TOPIC: notifyIndexModule.NOTIFY_MESSAGE_TOPIC,
      appendOutboxIfAbsent: outboxModule.appendOutboxIfAbsent,
      OutboxStore: outboxStoreModule.OutboxStore,
      OutboxDispatcher: dispatcherModule.OutboxDispatcher,
      resolveOutboxPolicies: policyModule.resolveOutboxPolicies,
      LogOutboxAlertSink: alertModule.LogOutboxAlertSink,
      JobsStore: jobsStoreModule.JobsStore,
      JobScheduler: schedulerModule.JobScheduler,
      AutomationSubjectReader: subjectsModule.AutomationSubjectReader,
      createRuleEventConsumers: wiringModule.createRuleEventConsumers,
      createAutomationScheduleHandler: wiringModule.createAutomationScheduleHandler,
      AUTOMATION_SCHEDULE_JOB_KIND: automationIndexModule.AUTOMATION_SCHEDULE_JOB_KIND,
      listEnabledRules: automationIndexModule.listEnabledRules,
      CalendarService: calendarServiceModule.CalendarService,
      CalendarRepository: calendarRepositoryModule.CalendarRepository,
      AuditService: auditServiceModule.AuditService,
      AuditRepository: auditRepositoryModule.AuditRepository,
    };
  } catch (error) {
    process.stderr.write("S7-4 接线：无法加载 server/dist（先执行 cd server && npm run build）：" + String(error) + "\n");
    process.exit(1);
  }
}

/** 回放环境：接线开启 + 冷启动阈值 6h + 投递不受免打扰 / 上限影响（上海 20:00 投递）。 */
function buildEnv(overrides = {}) {
  return runtime.loadEnv({
    ...process.env,
    DATABASE_URL,
    AUTOMATION_WIRING_ENABLED: "true",
    AUTOMATION_EVENT_MAX_AGE_MS: String(EVENT_MAX_AGE_MS),
    NOTIFY_QUIET_HOURS: "22:00-08:00",
    NOTIFY_DAILY_LIMIT: "200",
    NOTIFY_MERGE_WINDOW_MS: "1800000",
    WORKER_ID,
    ...overrides,
  });
}async function main() {
  runtime = await loadRuntime();
  db = new pg.Client({ connectionString: DATABASE_URL });
  await db.connect();

  const tag = randomBytes(4).toString("hex");
  const env = buildEnv();
  const clock = new runtime.ClockService();
  clock.setSource(() => CLOCK_NOW);
  const config = new runtime.AppConfig(env);
  const database = new runtime.DatabaseService(config);
  const notify = new runtime.NotifyService(new runtime.NotifyRepository(database), database, config, clock);
  const outboxStore = new runtime.OutboxStore(database);
  const jobsStore = new runtime.JobsStore(database);
  const calendar = new runtime.CalendarService(
    database,
    new runtime.CalendarRepository(database),
    new runtime.AuditService(database, new runtime.AuditRepository(database)),
    clock,
  );
  const subjects = new runtime.AutomationSubjectReader(database, calendar);

  /** 接线日志（真装配 = Nest Logger；回放捕获以断言 warn 留痕）。 */
  const wiringLogs = { log: [], warn: [], error: [] };
  const wiringDeps = {
    env,
    subjects,
    append: runtime.appendOutboxIfAbsent,
    db: database.db,
    rules: runtime.listEnabledRules,
    now: () => clock.now(),
    shift: () => calendar.getSettings(),
    logger: {
      log: (line) => wiringLogs.log.push(line),
      warn: (line) => wiringLogs.warn.push(line),
      error: (line) => wiringLogs.error.push(line),
    },
  };
  /** 真分派器：规则事件主题全量 + notify.message 投递（与 OutboxModule 组合根同形）。 */
  const registry = new Map();
  for (const [topic, handler] of runtime.createRuleEventConsumers(wiringDeps)) registry.set(topic, handler);
  registry.set(runtime.NOTIFY_MESSAGE_TOPIC, { handle: (row) => notify.consume(row) });
  const dispatcher = new runtime.OutboxDispatcher(
    outboxStore,
    registry,
    runtime.resolveOutboxPolicies(env),
    new runtime.LogOutboxAlertSink(),
    config,
    clock,
  );
  /** 真调度器：注册 automation-schedule.job 生产者（窗口 / 补发 / 单活锁全走运行时）。 */
  const scheduler = new runtime.JobScheduler(
    database,
    jobsStore,
    new Map([[runtime.AUTOMATION_SCHEDULE_JOB_KIND, runtime.createAutomationScheduleHandler(wiringDeps)]]),
    clock,
    config,
  );

  const cleanup = {
    keep: args.keep === true,
    userIds: [],
    projectIds: [],
    taskIds: [],
    issueIds: [],
    jobIds: [],
    outboxKeys: [],
  };
  const trackedKey = (key) => {
    cleanup.outboxKeys.push(key);
    return key;
  };
  const insertOutbox = async (topic, payload, dedupeKey, createdAt) => {
    trackedKey(dedupeKey);
    await db.query(
      "insert into outbox_events (topic, payload, dedupe_key, status, available_at, created_at) values ($1, $2::jsonb, $3, 'pending', $4, $4)",
      [topic, JSON.stringify(payload), dedupeKey, createdAt],
    );
  };
  const outboxRow = async (dedupeKey) => {
    const result = await db.query("select id, topic, status, attempts, last_error, payload from outbox_events where dedupe_key = $1", [dedupeKey]);
    return result.rows[0] ?? null;
  };
  const notifyRowCount = async (dedupeKey) => {
    const result = await db.query("select count(*)::int as n from notifications where source_dedupe_key = $1", [dedupeKey]);
    return result.rows[0].n;
  };
  /** 本回放产出（收件人 ∈ 合成用户）的 notify.message 行数。 */
  const ourMessageCount = async () => {
    const result = await db.query(
      "select count(*)::int as n from outbox_events where topic = 'notify.message' and (payload->>'recipientId')::uuid = any($1::uuid[])",
      [cleanup.userIds],
    );
    return result.rows[0].n;
  };

  evidence.anchors = {
    tag,
    clockNow: CLOCK_NOW.toISOString(),
    jobWindowStart: JOB_WINDOW_START.toISOString(),
    businessDate: BUSINESS_DATE,
    eventMaxAgeMs: EVENT_MAX_AGE_MS,
    workerId: WORKER_ID,
    topics: [...registry.keys()].sort(),
  };

  try {
    // ---------------------------------------------------------------- 基线
    const usersBaseline = await db.query("select count(*)::int as n from users where username like $1", [USER_PREFIX + "%"]);
    const outboxBaseline = await db.query("select count(*)::int as n from outbox_events where dedupe_key like $1", [OUTBOX_PREFIX + "%"]);
    const jobsBaseline = await db.query("select count(*)::int as n from jobs where payload->>'replay' = $1", [JOB_REPLAY_TAG]);
    check(
      "S0a",
      "基线：合成前缀（用户 / outbox 去重键 / 调度任务）无存量行（回放自清理）",
      "users=0 / outbox=0 / jobs=0",
      short({ users: usersBaseline.rows[0].n, outbox: outboxBaseline.rows[0].n, jobs: jobsBaseline.rows[0].n }),
      usersBaseline.rows[0].n === 0 && outboxBaseline.rows[0].n === 0 && jobsBaseline.rows[0].n === 0,
    );
    const calendarGuard = await db.query("select date::text as date from calendar_days where date between date '2026-09-22' and date '2026-09-25'");
    check(
      "S0b",
      "基线：回放日期窗口无日历例外（触发日确定性前提）",
      "calendar_days=0",
      "calendar_days=" + calendarGuard.rows.length + (calendarGuard.rows.length === 0 ? "" : " · " + short(calendarGuard.rows)),
      calendarGuard.rows.length === 0,
    );
    const pendingBaseline = await db.query(
      "select (select count(*)::int from outbox_events where topic in ('task.completed','task.updated','task.progress_changed','change.applied','node.completed','report.submitted','issue.updated','notify.message') and status in ('pending','processing')) as outbox, (select count(*)::int from jobs where status = 'pending') as jobs",
    );
    check(
      "S0c",
      "基线：注册主题无待领行、无待跑任务（领取统计可用精确值断言）",
      "outbox=0 / jobs=0",
      short(pendingBaseline.rows[0]),
      pendingBaseline.rows[0].outbox === 0 && pendingBaseline.rows[0].jobs === 0,
    );

    // ---------------------------------------------------------------- 造数
    const users = await db.query(
      "insert into users (casdoor_id, username, display_name, status) values ($1, $1, $2, 'active'), ($3, $3, $4, 'active'), ($5, $5, $6, 'active') returning id",
      [
        USER_PREFIX + tag + "-owner",
        "S7-4 接线回放·责任人",
        USER_PREFIX + tag + "-manager",
        "S7-4 接线回放·项目经理",
        USER_PREFIX + tag + "-owner2",
        "S7-4 接线回放·次责任人",
      ],
    );
    cleanup.userIds = users.rows.map((row) => row.id);
    const owner = cleanup.userIds[0];
    const manager = cleanup.userIds[1];
    const owner2 = cleanup.userIds[2];

    const projects = await db.query(
      "insert into projects (code, name, customer, region, project_type, manager_ids, stage_key, status, description, version) values ($1, $2, $3, 'shanghai', 'default', array[$4::uuid], 'presale', 'active', $5, 1), ($6, $7, $8, 'shanghai', 'default', array[$4::uuid], 'presale', 'active', $9, 1) returning id",
      [
        "S74W-" + tag + "-A",
        "临港数据中心",
        "合成客户",
        manager,
        "S7-4 接线回放项目 A",
        "S74W-" + tag + "-B",
        "张江机房",
        "合成客户",
        "S7-4 接线回放项目 B",
      ],
    );
    const projectA = projects.rows[0].id;
    const projectB = projects.rows[1].id;
    cleanup.projectIds = [projectA, projectB];
    await db.query(
      "insert into project_members (project_id, user_id, role_in_project) values ($1, $2, 'project_member'), ($3, $2, 'project_member')",
      [projectA, owner, projectB],
    );

    const tasks = await db.query(
      "insert into tasks (project_id, stage_key, sort_index, title, status, progress, priority, owner_ids, deliverable_types, version, planned_start, planned_end, actual_end) values ($1, 'presale', 0, $2, 'done', 1, '高', array[$3::uuid], array['CAD图纸'], 5, null, null, null), ($1, 'presale', 1, $4, 'done', 1, '高', array[$5::uuid], array['CAD图纸'], 1, null, null, null) returning id, version",
      [projectA, "安装摄像头", owner, "机房布线", owner2],
    );
    cleanup.taskIds = tasks.rows.map((row) => row.id);
    const taskA = cleanup.taskIds[0];
    const taskB = cleanup.taskIds[1];

    const issues = await db.query(
      "insert into issues (project_id, title, category, state, reporter_id, owner_id, due_at, raised_at) values ($1, $2, '其它原因', 'open', $3, $4, $5, date '2026-09-20') returning id",
      [projectA, "现场漏水", manager, owner, "2026-09-23T09:00:00+08:00"],
    );
    cleanup.issueIds = issues.rows.map((row) => row.id);
    const issue = cleanup.issueIds[0];

    const job = await db.query(
      "insert into jobs (kind, payload, cron, run_at, last_run_at) values ($1, $2::jsonb, null, $3, $3) returning id",
      [runtime.AUTOMATION_SCHEDULE_JOB_KIND, JSON.stringify({ replay: JOB_REPLAY_TAG, tag }), JOB_WINDOW_START],
    );
    cleanup.jobIds = [Number(job.rows[0].id)];
    const jobId = cleanup.jobIds[0];

    const r02TaskAKey = trackedKey("R02:" + taskA + ":v" + tasks.rows[0].version);
    const r02TaskBKey = trackedKey("R02:" + taskB + ":v" + tasks.rows[1].version);
    const a03Key = trackedKey("A03:" + issue + ":" + BUSINESS_DATE);
    const a01Key = trackedKey("A01:" + owner + ":" + BUSINESS_DATE);
    const wecomKey = trackedKey(OUTBOX_PREFIX + tag + ".chan.wecom");

    // --------------------------------------------- 证据一：事件链（R02 全链）
    await insertOutbox("task.completed", { taskId: taskA }, OUTBOX_PREFIX + tag + ".evt.task-completed", new Date(CLOCK_NOW.getTime() - 60_000));
    const drain1 = await dispatcher.drainOnce();
    const eventRow1 = await outboxRow(OUTBOX_PREFIX + tag + ".evt.task-completed");
    check(
      "S1a",
      "事件领取：task.completed 行经真领取器消费完成（claimed=1 / done=1）",
      "status=done / claimed=1 / done=1 / dead=0",
      short({ status: eventRow1?.status, ...drain1 }),
      eventRow1?.status === "done" && drain1.claimed === 1 && drain1.done === 1 && drain1.dead === 0,
    );
    const produced1 = await outboxRow(r02TaskAKey);
    const payload1 = produced1?.payload ?? {};
    check(
      "S1b",
      "R02 命中产出：notify.message 载荷全字段（收件人 / 类型 / 渠道 / 模板 / 关联对象 / 合并键）",
      "recipient=owner / type=reminder / channel=inbox / R02_INBOX / ref=task:" + taskA + " / mergeKey=幂等键",
      short({
        recipient: payload1.recipientId === owner,
        type: payload1.type,
        channel: payload1.channel,
        template: payload1.templateCode,
        ref: payload1.refType + "/" + payload1.refId,
        mergeKey: payload1.mergeKey === r02TaskAKey,
      }),
      produced1?.topic === "notify.message" &&
        payload1.recipientId === owner &&
        payload1.type === "reminder" &&
        payload1.channel === "inbox" &&
        payload1.templateCode === "R02_INBOX" &&
        payload1.refType === "task" &&
        payload1.refId === taskA &&
        payload1.mergeKey === r02TaskAKey,
    );
    check(
      "S1c",
      "R02 文案渲染：模板标题 / 正文含任务描述（引擎按主体快照渲染）",
      "标题=及时添加文件 / 正文含「安装摄像头」",
      short({ title: payload1.title, body: payload1.body }),
      payload1.title === "及时添加文件" && String(payload1.body).includes("安装摄像头"),
    );
    const drain2 = await dispatcher.drainOnce();
    const notification1 = await db.query(
      "select id, recipient_id, title, status, ref_type, ref_id, template_code, merge_key, source_topic, delivered_at from notifications where source_dedupe_key = $1",
      [r02TaskAKey],
    );
    const notification1Row = notification1.rows[0] ?? null;
    check(
      "S1d",
      "投递落库：notify.message 消费 → notifications 一行（delivered_at 非空 / source_topic 回溯）",
      "claimed=1 / done=1 / 1 行 / delivered_at 非空 / source_topic=notify.message",
      short({ ...drain2, rows: notification1.rows.length, delivered: notification1Row?.delivered_at !== null }),
      drain2.claimed === 1 &&
        drain2.done === 1 &&
        notification1.rows.length === 1 &&
        notification1Row?.delivered_at !== null &&
        notification1Row?.source_topic === "notify.message",
    );
    const inbox1 = await notify.list(owner, { page: 1, limit: 50 });
    check(
      "S1e",
      "收件箱读面：规则产出的站内信立即可见（total / unreadCount / 关联对象）",
      "total=1 / unreadCount=1 / refType=task",
      short({ total: inbox1.total, unread: inbox1.unreadCount, ref: inbox1.items[0]?.refType }),
      inbox1.total === 1 && inbox1.unreadCount === 1 && inbox1.items[0]?.refType === "task",
    );
    check(
      "S1f",
      "渠道留痕：R02 的第二动作（wecom_app）不产行、warn 记录（与投递层护栏配对）",
      "warn 含 wecom_app / 产出仅 1 条 notify.message",
      short({ warnHit: wiringLogs.warn.some((line) => line.includes("wecom_app")), messages: await ourMessageCount() }),
      wiringLogs.warn.some((line) => line.includes("wecom_app")) && (await ourMessageCount()) === 1,
    );    // --------------------------------- 证据二：冷启动保护（过旧拦截 / 新建对照）
    await insertOutbox("task.completed", { taskId: taskB }, OUTBOX_PREFIX + tag + ".evt.cold", new Date(CLOCK_NOW.getTime() - EVENT_MAX_AGE_MS - HOUR_MS));
    const drain3 = await dispatcher.drainOnce();
    const coldRow = await outboxRow(OUTBOX_PREFIX + tag + ".evt.cold");
    const coldProduced = await outboxRow(r02TaskBKey);
    check(
      "S2",
      "冷启动保护：行创建时刻超 AUTOMATION_EVENT_MAX_AGE_MS → done、零产出（event_too_old 留痕）",
      "status=done / claimed=1 / done=1 / R02 幂等键无产出",
      short({
        status: coldRow?.status,
        ...drain3,
        produced: coldProduced !== null,
        tooOld: wiringLogs.log.some((line) => line.includes("event_too_old")),
      }),
      coldRow?.status === "done" &&
        drain3.claimed === 1 &&
        drain3.done === 1 &&
        coldProduced === null &&
        wiringLogs.log.some((line) => line.includes("event_too_old")),
    );
    await insertOutbox("task.completed", { taskId: taskB }, OUTBOX_PREFIX + tag + ".evt.fresh", new Date(CLOCK_NOW.getTime() - 60_000));
    const drain4 = await dispatcher.drainOnce();
    const freshProduced = await outboxRow(r02TaskBKey);
    check(
      "S2b",
      "对照组：同载荷新事件（60s 前）正常产出（证明拦截判据 = 事件年龄）",
      "claimed=1 / done=1 / 产出 R02 行（收件人=次责任人）",
      short({ ...drain4, produced: freshProduced !== null, recipient: freshProduced?.payload?.recipientId === owner2 }),
      drain4.claimed === 1 && drain4.done === 1 && freshProduced !== null && freshProduced.payload?.recipientId === owner2,
    );
    const drain4b = await dispatcher.drainOnce();
    check(
      "S2c",
      "对照组落库：次责任人收件箱 1 条（及时添加文件）",
      "claimed=1 / done=1 / notifications=1 行",
      short({ ...drain4b, rows: await notifyRowCount(r02TaskBKey) }),
      drain4b.claimed === 1 && drain4b.done === 1 && (await notifyRowCount(r02TaskBKey)) === 1,
    );

    // ----------------------------------------- 证据三：主体不可解析 → dead
    const ghostTaskId = randomUUID();
    await insertOutbox("task.completed", { taskId: ghostTaskId }, OUTBOX_PREFIX + tag + ".evt.ghost", new Date(CLOCK_NOW.getTime() - 60_000));
    const messagesBeforeGhost = await ourMessageCount();
    const drain5 = await dispatcher.drainOnce();
    const ghostRow = await outboxRow(OUTBOX_PREFIX + tag + ".evt.ghost");
    check(
      "S3",
      "主体不可解析：taskId 不存在 → dead（确定性失败一次即弃）、零产出",
      "status=dead / claimed=1 / dead=1 / 产出数不变",
      short({ status: ghostRow?.status, error: ghostRow?.last_error, ...drain5, messages: await ourMessageCount() }),
      ghostRow?.status === "dead" &&
        String(ghostRow?.last_error).includes("主体不可解析") &&
        drain5.claimed === 1 &&
        drain5.dead === 1 &&
        (await ourMessageCount()) === messagesBeforeGhost,
    );

    // ------------------------------------- 证据四：无事件型规则订阅 → 直接完成
    const messagesBeforeIssueTopic = await ourMessageCount();
    await insertOutbox("issue.updated", { issueId: issue }, OUTBOX_PREFIX + tag + ".evt.issue-updated", new Date(CLOCK_NOW.getTime() - 60_000));
    const drain6 = await dispatcher.drainOnce();
    const issueTopicRow = await outboxRow(OUTBOX_PREFIX + tag + ".evt.issue-updated");
    check(
      "S4",
      "无事件型规则订阅：issue.updated（A03 为调度型）→ 直接消费完成、零产出",
      "status=done / claimed=1 / done=1 / 产出数不变",
      short({ status: issueTopicRow?.status, ...drain6, messages: await ourMessageCount() }),
      issueTopicRow?.status === "done" &&
        drain6.claimed === 1 &&
        drain6.done === 1 &&
        (await ourMessageCount()) === messagesBeforeIssueTopic,
    );

    // ------------------------------------- 证据五：渠道护栏（M5-03 前非 inbox）
    await insertOutbox(
      "notify.message",
      { recipientId: owner, type: "reminder", channel: "wecom_app", title: "企微提醒", body: "M5-03 未落地前不得静默当站内信投递" },
      wecomKey,
      new Date(CLOCK_NOW.getTime() - 60_000),
    );
    const drain7 = await dispatcher.drainOnce();
    const wecomRow = await outboxRow(wecomKey);
    check(
      "S5",
      "渠道护栏：notify.message channel=wecom_app → 投递层 dead、零落库",
      "status=dead / claimed=1 / dead=1 / notifications=0",
      short({ status: wecomRow?.status, error: wecomRow?.last_error, ...drain7, rows: await notifyRowCount(wecomKey) }),
      wecomRow?.status === "dead" &&
        String(wecomRow?.last_error).includes("非 inbox") &&
        drain7.claimed === 1 &&
        drain7.dead === 1 &&
        (await notifyRowCount(wecomKey)) === 0,
    );

    // ------------------------- 证据六/七：调度窗口（A03 T+1 提醒 + A01 日报合并）
    const tick1 = await scheduler.tickOnce();
    const jobAfter = (await db.query("select id, kind, status, attempts, last_run_at, locked_by, locked_at, cron from jobs where id = $1", [jobId])).rows[0] ?? null;
    const runs1 = (await db.query("select status, window_from, window_to, fire_count, produced, note from job_runs where job_id = $1 order by id", [jobId])).rows;
    check(
      "S6a",
      "调度领取与推进：真 tick 领取 automation-schedule.job → 执行、last_run_at 推进到 now、锁清空",
      "lockAcquired / claimed=1 / executed=1 / status=done / last_run_at=" + CLOCK_NOW.toISOString(),
      short({ ...tick1, job: fmtJob(jobAfter) }),
      tick1.lockAcquired === true &&
        tick1.claimed === 1 &&
        tick1.executed === 1 &&
        jobAfter?.status === "done" &&
        new Date(jobAfter?.last_run_at).getTime() === CLOCK_NOW.getTime() &&
        jobAfter?.locked_at === null,
    );
    check(
      "S6b",
      "job_runs 留痕：executed / fire_count=1 / produced=2 / note 含主体数与非 inbox 跳过数",
      "1 行 / executed / produced=2 / note 含「主体 5」与「非 inbox 跳过 2 条」",
      short(runs1),
      runs1.length === 1 &&
        runs1[0]?.status === "executed" &&
        runs1[0]?.produced === 2 &&
        runs1[0]?.fire_count === 1 &&
        String(runs1[0]?.note).includes("主体 5") &&
        String(runs1[0]?.note).includes("非 inbox 跳过 2 条"),
    );
    const a03Row = await outboxRow(a03Key);
    const a03Payload = a03Row?.payload ?? {};
    check(
      "S6c",
      "A03 T+1 产出：提醒责任人（issue.owner）一条，关联问题、模板 A03_T1_INBOX",
      "A03:{issue}:2026-09-24 / recipient=责任人 / ref=issue:" + issue + " / A03_T1_INBOX",
      short({ key: a03Row !== null, recipient: a03Payload.recipientId === owner, ref: a03Payload.refType + "/" + a03Payload.refId, template: a03Payload.templateCode, body: a03Payload.body }),
      a03Row !== null &&
        a03Payload.recipientId === owner &&
        a03Payload.refType === "issue" &&
        a03Payload.refId === issue &&
        a03Payload.templateCode === "A03_T1_INBOX" &&
        String(a03Payload.body).includes("现场漏水"),
    );
    const a01Row = await outboxRow(a01Key);
    const a01Payload = a01Row?.payload ?? {};
    check(
      "S6d",
      "A01 合并产出：同一人名下两项目合并一条（收件人粒度幂等键 + 项目清单文案 + 无单一关联对象）",
      "A01:{owner}:2026-09-24 / refType=null / A01_INBOX_MERGED / 正文含两项目名",
      short({ key: a01Row !== null, ref: a01Payload.refType, template: a01Payload.templateCode, body: a01Payload.body }),
      a01Row !== null &&
        a01Payload.recipientId === owner &&
        a01Payload.refType === null &&
        a01Payload.refId === null &&
        a01Payload.templateCode === "A01_INBOX_MERGED" &&
        String(a01Payload.body).includes("临港数据中心") &&
        String(a01Payload.body).includes("张江机房"),
    );
    const drain8 = await dispatcher.drainOnce();
    const inboxOwner = await notify.list(owner, { page: 1, limit: 50 });
    const ownerTemplates = inboxOwner.items.map((item) => item.templateCode).sort();
    check(
      "S6e",
      "调度产出消费：A03 + A01 落行 → 责任人收件箱共 3 条（R02 + A03 + A01）",
      "claimed=2 / done=2 / total=3 / unreadCount=3 / 模板集命中",
      short({ ...drain8, total: inboxOwner.total, unread: inboxOwner.unreadCount, templates: ownerTemplates }),
      drain8.claimed === 2 &&
        drain8.done === 2 &&
        inboxOwner.total === 3 &&
        inboxOwner.unreadCount === 3 &&
        JSON.stringify(ownerTemplates) === JSON.stringify(["A01_INBOX_MERGED", "A03_T1_INBOX", "R02_INBOX"]),
    );
    check(
      "S6f",
      "非 inbox 跳过（证据九）：接线层 warn 含「渠道未落地」；本回放产出消息数 = 5（R02×2 + 护栏行 + A03 + A01）",
      "warn 命中 / notify.message=5",
      short({ warnHit: wiringLogs.warn.some((line) => line.includes("渠道未落地")), messages: await ourMessageCount() }),
      wiringLogs.warn.some((line) => line.includes("渠道未落地")) && (await ourMessageCount()) === 5,
    );    // ------------------------------------- 证据八：同窗口重放（幂等键兜底不重发）
    await db.query(
      "update jobs set status = 'pending', run_at = $2, last_run_at = $2, attempts = 0, locked_at = null, locked_by = null where id = $1",
      [jobId, JOB_WINDOW_START],
    );
    const messagesBeforeReplay = await ourMessageCount();
    const tick2 = await scheduler.tickOnce();
    const runs2 = (await db.query("select status, produced, note from job_runs where job_id = $1 order by id", [jobId])).rows;
    const a03Replay = await outboxRow(a03Key);
    const a01Replay = await outboxRow(a01Key);
    check(
      "S7",
      "窗口重放：任务再执行、产出幂等键已存在 → 不新增行（appendOutboxIfAbsent 兜底）、job_runs 如实留痕",
      "executed=1 / 产出数不变 / job_runs=2 行（均 executed）",
      short({ ...tick2, messages: await ourMessageCount(), runs: runs2.length, lastProduced: runs2[1]?.produced }),
      tick2.executed === 1 &&
        (await ourMessageCount()) === messagesBeforeReplay &&
        runs2.length === 2 &&
        runs2[1]?.status === "executed" &&
        a03Replay !== null &&
        a01Replay !== null,
    );
    const inboxAfterReplay = await notify.list(owner, { page: 1, limit: 50 });
    check(
      "S7b",
      "重放不重发（读面）：责任人收件箱仍 3 条（无重复通知）",
      "total=3 / unreadCount=3",
      short({ total: inboxAfterReplay.total, unread: inboxAfterReplay.unreadCount }),
      inboxAfterReplay.total === 3 && inboxAfterReplay.unreadCount === 3,
    );
  } finally {
    try {
      if (!cleanup.keep) {
        const userIds = cleanup.userIds;
        const produced = await db
          .query("select dedupe_key from outbox_events where topic = 'notify.message' and (payload->>'recipientId')::uuid = any($1::uuid[])", [userIds])
          .catch(() => ({ rows: [] }));
        const keys = [...new Set([...cleanup.outboxKeys, ...produced.rows.map((row) => row.dedupe_key)])];
        if (keys.length > 0) {
          await db.query("delete from notifications where source_dedupe_key = any($1::text[])", [keys]);
          await db.query("delete from outbox_events where dedupe_key = any($1::text[])", [keys]);
        }
        if (userIds.length > 0) {
          await db.query("delete from notifications where recipient_id = any($1::uuid[])", [userIds]);
        }
        if (cleanup.jobIds.length > 0) {
          await db.query("delete from jobs where id = any($1::bigint[])", [cleanup.jobIds]);
        }
        if (cleanup.projectIds.length > 0) {
          await db.query("delete from project_members where project_id = any($1::uuid[])", [cleanup.projectIds]);
        }
        if (cleanup.issueIds.length > 0) {
          await db.query("delete from issues where id = any($1::uuid[])", [cleanup.issueIds]);
        }
        if (cleanup.taskIds.length > 0) {
          await db.query("delete from tasks where id = any($1::uuid[])", [cleanup.taskIds]);
        }
        if (cleanup.projectIds.length > 0) {
          await db.query("delete from projects where id = any($1::uuid[])", [cleanup.projectIds]);
        }
        if (userIds.length > 0) {
          await db.query("delete from users where id = any($1::uuid[]) and username like $2", [userIds, USER_PREFIX + "%"]);
        }
      }
      const residueUsers = await db.query("select count(*)::int as n from users where username like $1", [USER_PREFIX + "%"]);
      const residueOutbox = await db.query("select count(*)::int as n from outbox_events where dedupe_key like $1", [OUTBOX_PREFIX + "%"]);
      const residueJobs = await db.query("select count(*)::int as n from jobs where payload->>'replay' = $1", [JOB_REPLAY_TAG]);
      const residueMessages = cleanup.userIds.length === 0 ? 0 : await ourMessageCount();
      const residueNotifications =
        cleanup.userIds.length === 0
          ? 0
          : (await db.query("select count(*)::int as n from notifications where recipient_id = any($1::uuid[])", [cleanup.userIds])).rows[0].n;
      check(
        "S9",
        "自清理：合成前缀 / 实体零残留（--keep 时保留现场、仅留痕）",
        cleanup.keep ? "keep=true（不清理）" : "users=0 / outbox=0 / jobs=0 / notifications=0",
        short({
          users: residueUsers.rows[0].n,
          outbox: residueOutbox.rows[0].n,
          jobs: residueJobs.rows[0].n,
          messages: residueMessages,
          notifications: residueNotifications,
          keep: cleanup.keep,
        }),
        cleanup.keep ||
          (residueUsers.rows[0].n === 0 &&
            residueOutbox.rows[0].n === 0 &&
            residueJobs.rows[0].n === 0 &&
            residueMessages === 0 &&
            residueNotifications === 0),
      );
    } catch (error) {
      check("S9", "自清理：合成前缀 / 实体零残留", "清理成功", "清理失败：" + messageOf(error), false);
    }
    await db.end().catch(() => {});
  }
}

function writeReports() {
  const summary = "S7-4 接线回放汇总：PASS " + pass + " / FAIL " + fail + "（合成 outbox 前缀 " + OUTBOX_PREFIX + "）";
  if (args.out !== undefined) {
    writeFileSync(
      args.out,
      "# S7-4 · M5-02 接线段 真机回放证据（事件消费 + 调度产出 → notify.message）\n\n" +
        "| 结果 | 编号 | 断言 | 期望 | 实际 | 备注 |\n|---|---|---|---|---|---|\n" +
        report.join("\n") +
        "\n\n" + summary + "\n\n锚点：" + short(evidence.anchors) + "\n",
      "utf8",
    );
  }
  if (args.json !== undefined) {
    writeFileSync(args.json, JSON.stringify({ anchors: evidence.anchors, checks: evidence.checks, pass, fail }, null, 2), "utf8");
  }
  process.stdout.write("\n" + summary + "\n");
}

try {
  await main();
} catch (error) {
  fail += 1;
  process.stderr.write("S7-4 接线回放异常：" + messageOf(error) + "\n");
}

writeReports();
process.exit(fail === 0 ? 0 : 1);