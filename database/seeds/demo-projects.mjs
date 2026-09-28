// LibiaoLink · 可选种子 #11：演示数据 —— 项目空间 + 地图「地区分布」（100 个项目 / 41 个国家·地区）
// 口径来源：Push 188 入口页地图改版（业务 2026-09-24「你现在多写一点数据到数据库 这些国家的订单都可以写 写一点数据到数据库 到项目空间」
//   与七追订补的那批）—— 把地图铺满、让「项目空间」有量可看用的数据。
// 范围：① 41 条地区字典（`dict_items`，`type_code = region`）：`code` = 图上国名；阿联酋例外（`code = 阿联酋` /
//          `name = 阿拉伯联合酋长国` —— 与地图底图的国名一致，见 frontend/src/data/worldMap.ts）；
//       ② 100 个演示项目（`projects`）：`code` 全局唯一（`LB<ISO2>-20260924-<序号>`），落库时 `seq_no` 由服务端分配。
// 可选种子（默认不执行）：CI 与正式环境不需要演示数据 —— `scripts/seed.mjs` 默认跳过带 `optional` 的种子，显式执行：
//   `DATABASE_URL=... node scripts/seed.mjs --only=demo-projects`   # 只跑它
//   `DATABASE_URL=... node scripts/seed.mjs --with-optional`        # 连它一起跑
// 修订语义：幂等 —— 地区按 `(type_code = region, code)` 存在即跳过；项目按 `code` 存在即跳过
//   （不覆盖库内改过的名字 / 地区 / 状态 / 经理），不删除；连续执行第二次零变更。
// 项目经理：按用户名解析 `users.id`（一行可挂多个，用 `+` 连接，如 `lan+shaochenyu`）；账号不在库里时退到兜底账号
//   （`DEMO_MANAGER_USERNAME` 环境变量 → 否则 `panxing` → 否则库里第一个账号），摘要里报 `managerFallback` 条数；
//   库里一个账号都没有则报错（`projects.manager_ids` 非空，演示项目必须挂在人身上）。
// created_at：按清单顺序相对 `now()` 倒排（第 1 条最新、依次往回 3 分钟）—— 「项目空间」默认按创建时间倒序，列表顺序与清单一致。

export const name = "demo-projects";
export const title = "演示数据：项目空间 + 地图地区分布（100 个项目 / 41 个国家·地区）";
/** 可选种子：默认不执行（见文件头）。 */
export const optional = true;

/** 项目描述一律写这一句 —— 这批演示数据自己想认出来（按描述一查就知道是它）。 */
export const DESCRIPTION = "演示数据（地区分布用）";

/** 可修订常量区：地区字典（sort 决定「分类筛选 → 地区」的展示顺序）。 */
export const REGIONS = [
  { code: "英国", name: "英国", sort: 90 },
  { code: "美国", name: "美国", sort: 100 },
  { code: "中国", name: "中国", sort: 110 },
  { code: "希腊", name: "希腊", sort: 120 },
  { code: "法国", name: "法国", sort: 130 },
  { code: "韩国", name: "韩国", sort: 140 },
  { code: "日本", name: "日本", sort: 150 },
  { code: "澳大利亚", name: "澳大利亚", sort: 160 },
  { code: "俄罗斯", name: "俄罗斯", sort: 170 },
  { code: "波兰", name: "波兰", sort: 180 },
  { code: "德国", name: "德国", sort: 190 },
  { code: "荷兰", name: "荷兰", sort: 200 },
  { code: "西班牙", name: "西班牙", sort: 210 },
  { code: "意大利", name: "意大利", sort: 220 },
  { code: "比利时", name: "比利时", sort: 230 },
  { code: "匈牙利", name: "匈牙利", sort: 240 },
  { code: "罗马尼亚", name: "罗马尼亚", sort: 250 },
  { code: "塞尔维亚", name: "塞尔维亚", sort: 260 },
  { code: "捷克", name: "捷克", sort: 270 },
  { code: "立陶宛", name: "立陶宛", sort: 280 },
  { code: "拉脱维亚", name: "拉脱维亚", sort: 290 },
  { code: "爱沙尼亚", name: "爱沙尼亚", sort: 300 },
  { code: "乌克兰", name: "乌克兰", sort: 310 },
  { code: "土耳其", name: "土耳其", sort: 320 },
  { code: "以色列", name: "以色列", sort: 330 },
  { code: "沙特阿拉伯", name: "沙特阿拉伯", sort: 340 },
  { code: "阿联酋", name: "阿拉伯联合酋长国", sort: 350 },
  { code: "卡塔尔", name: "卡塔尔", sort: 360 },
  { code: "印度", name: "印度", sort: 370 },
  { code: "泰国", name: "泰国", sort: 380 },
  { code: "越南", name: "越南", sort: 390 },
  { code: "马来西亚", name: "马来西亚", sort: 400 },
  { code: "印度尼西亚", name: "印度尼西亚", sort: 410 },
  { code: "新西兰", name: "新西兰", sort: 420 },
  { code: "加拿大", name: "加拿大", sort: 430 },
  { code: "哥伦比亚", name: "哥伦比亚", sort: 440 },
  { code: "秘鲁", name: "秘鲁", sort: 450 },
  { code: "巴西", name: "巴西", sort: 460 },
  { code: "阿根廷", name: "阿根廷", sort: 470 },
  { code: "乌拉圭", name: "乌拉圭", sort: 480 },
  { code: "南非", name: "南非", sort: 490 },
];

/** 可修订常量区：演示项目（100 条；列 = 编号 / 名称 / 地区 / 类型 / 阶段 / 状态 / 项目经理用户名）。 */
export const PROJECTS = [
  { code: "LBDE-20260924-001", name: "德国汉堡分拣中心", region: "德国", projectType: "T-sort", stageKey: "deploy", status: "active", manager: "panxing" },
  { code: "LBDE-20260924-002", name: "德国展厅", region: "德国", projectType: "3D分拣", stageKey: "presale", status: "active", manager: "wmj" },
  { code: "LBDE-20260924-003", name: "德国不来梅仓配中心", region: "德国", projectType: "飞箱", stageKey: "design", status: "paused", manager: "lan" },
  { code: "LBNL-20260924-001", name: "荷兰鹿特丹分拨中心", region: "荷兰", projectType: "T-sort", stageKey: "install", status: "active", manager: "panxing" },
  { code: "LBNL-20260924-002", name: "荷兰电商仓", region: "荷兰", projectType: "飞箱", stageKey: "acceptance", status: "done", manager: "lan" },
  { code: "LBFR-20260924-001", name: "法国巴黎分拣中心", region: "法国", projectType: "3D分拣", stageKey: "trial", status: "active", manager: "wmj" },
  { code: "LBFR-20260924-002", name: "法国里昂仓配", region: "法国", projectType: "T-sort", stageKey: "acceptance", status: "done", manager: "panxing" },
  { code: "LBES-20260924-001", name: "西班牙马德里分拣中心", region: "西班牙", projectType: "T-sort", stageKey: "deploy", status: "active", manager: "lan" },
  { code: "LBES-20260924-002", name: "西班牙巴塞罗那仓", region: "西班牙", projectType: "3D分拣", stageKey: "design", status: "active", manager: "panxing" },
  { code: "LBIT-20260924-001", name: "意大利米兰分拣中心", region: "意大利", projectType: "飞箱", stageKey: "install", status: "active", manager: "wmj" },
  { code: "LBIT-20260924-002", name: "意大利罗马仓配", region: "意大利", projectType: "T-sort", stageKey: "acceptance", status: "done", manager: "lan" },
  { code: "LBBE-20260924-001", name: "比利时安特卫普分拨中心", region: "比利时", projectType: "T-sort", stageKey: "presale", status: "active", manager: "panxing" },
  { code: "LBHU-20260924-001", name: "匈牙利布达佩斯仓配", region: "匈牙利", projectType: "3D分拣", stageKey: "design", status: "active", manager: "lan" },
  { code: "LBRO-20260924-001", name: "罗马尼亚布加勒斯特分拣线", region: "罗马尼亚", projectType: "T-sort", stageKey: "presale", status: "active", manager: "wmj" },
  { code: "LBRS-20260924-001", name: "塞尔维亚贝尔格莱德仓配", region: "塞尔维亚", projectType: "飞箱", stageKey: "presale", status: "paused", manager: "lan" },
  { code: "LBCZ-20260924-001", name: "捷克布拉格分拣中心", region: "捷克", projectType: "3D分拣", stageKey: "deploy", status: "active", manager: "wmj" },
  { code: "LBLT-20260924-001", name: "立陶宛维尔纽斯仓配", region: "立陶宛", projectType: "T-sort", stageKey: "presale", status: "active", manager: "lan" },
  { code: "LBLV-20260924-001", name: "拉脱维亚里加分拣线", region: "拉脱维亚", projectType: "飞箱", stageKey: "design", status: "active", manager: "panxing" },
  { code: "LBEE-20260924-001", name: "爱沙尼亚塔林仓配", region: "爱沙尼亚", projectType: "T-sort", stageKey: "presale", status: "active", manager: "wmj" },
  { code: "LBUA-20260924-001", name: "乌克兰基辅分拨中心", region: "乌克兰", projectType: "3D分拣", stageKey: "design", status: "paused", manager: "lan" },
  { code: "LBTR-20260924-001", name: "土耳其伊斯坦布尔分拣中心", region: "土耳其", projectType: "3D分拣", stageKey: "install", status: "active", manager: "wmj" },
  { code: "LBTR-20260924-002", name: "土耳其安卡拉仓配", region: "土耳其", projectType: "T-sort", stageKey: "presale", status: "active", manager: "lan" },
  { code: "LBIL-20260924-001", name: "以色列特拉维夫分拣线", region: "以色列", projectType: "飞箱", stageKey: "deploy", status: "active", manager: "panxing" },
  { code: "LBSA-20260924-001", name: "沙特利雅得分拨中心", region: "沙特阿拉伯", projectType: "T-sort", stageKey: "trial", status: "active", manager: "wmj" },
  { code: "LBAE-20260924-001", name: "阿联酋迪拜分拣中心", region: "阿联酋", projectType: "3D分拣", stageKey: "deploy", status: "active", manager: "lan" },
  { code: "LBAE-20260924-002", name: "阿联酋阿布扎比仓", region: "阿联酋", projectType: "飞箱", stageKey: "design", status: "done", manager: "panxing" },
  { code: "LBQA-20260924-001", name: "卡塔尔多哈分拨中心", region: "卡塔尔", projectType: "T-sort", stageKey: "presale", status: "paused", manager: "wmj" },
  { code: "LBIN-20260924-001", name: "印度孟买分拣中心", region: "印度", projectType: "T-sort", stageKey: "production", status: "active", manager: "lan" },
  { code: "LBIN-20260924-002", name: "印度班加罗尔仓配", region: "印度", projectType: "3D分拣", stageKey: "install", status: "active", manager: "panxing" },
  { code: "LBIN-20260924-003", name: "印度德里分拨中心", region: "印度", projectType: "飞箱", stageKey: "design", status: "active", manager: "wmj" },
  { code: "LBTH-20260924-001", name: "泰国曼谷分拣中心", region: "泰国", projectType: "T-sort", stageKey: "deploy", status: "active", manager: "lan" },
  { code: "LBTH-20260924-002", name: "泰国罗勇仓配", region: "泰国", projectType: "飞箱", stageKey: "presale", status: "active", manager: "panxing" },
  { code: "LBVN-20260924-001", name: "越南胡志明分拣中心", region: "越南", projectType: "3D分拣", stageKey: "install", status: "active", manager: "wmj" },
  { code: "LBVN-20260924-002", name: "越南河内仓配", region: "越南", projectType: "T-sort", stageKey: "presale", status: "active", manager: "lan" },
  { code: "LBMY-20260924-001", name: "马来西亚吉隆坡分拨中心", region: "马来西亚", projectType: "T-sort", stageKey: "trial", status: "active", manager: "panxing" },
  { code: "LBMY-20260924-002", name: "马来西亚槟城仓", region: "马来西亚", projectType: "飞箱", stageKey: "presale", status: "active", manager: "wmj" },
  { code: "LBID-20260924-001", name: "印尼雅加达分拣中心", region: "印度尼西亚", projectType: "3D分拣", stageKey: "deploy", status: "active", manager: "lan" },
  { code: "LBID-20260924-002", name: "印尼泗水仓配", region: "印度尼西亚", projectType: "T-sort", stageKey: "presale", status: "active", manager: "panxing" },
  { code: "LBNZ-20260924-001", name: "新西兰奥克兰分拨中心", region: "新西兰", projectType: "T-sort", stageKey: "presale", status: "active", manager: "wmj" },
  { code: "LBCA-20260924-001", name: "加拿大温哥华分拣中心", region: "加拿大", projectType: "3D分拣", stageKey: "install", status: "active", manager: "lan" },
  { code: "LBCA-20260924-002", name: "加拿大多伦多仓", region: "加拿大", projectType: "T-sort", stageKey: "presale", status: "active", manager: "panxing" },
  { code: "LBCO-20260924-001", name: "哥伦比亚波哥大仓配", region: "哥伦比亚", projectType: "飞箱", stageKey: "presale", status: "paused", manager: "wmj" },
  { code: "LBPE-20260924-001", name: "秘鲁利马分拨中心", region: "秘鲁", projectType: "T-sort", stageKey: "presale", status: "active", manager: "lan" },
  { code: "LBBR-20260924-001", name: "巴西圣保罗分拣中心", region: "巴西", projectType: "T-sort", stageKey: "production", status: "active", manager: "panxing" },
  { code: "LBBR-20260924-002", name: "巴西里约仓配", region: "巴西", projectType: "3D分拣", stageKey: "presale", status: "active", manager: "wmj" },
  { code: "LBBR-20260924-003", name: "巴西玛瑙斯分拨中心", region: "巴西", projectType: "飞箱", stageKey: "design", status: "archived", manager: "lan" },
  { code: "LBAR-20260924-001", name: "阿根廷布宜诺斯艾利斯仓配", region: "阿根廷", projectType: "T-sort", stageKey: "design", status: "active", manager: "panxing" },
  { code: "LBAR-20260924-002", name: "阿根廷罗萨里奥分拣线", region: "阿根廷", projectType: "飞箱", stageKey: "presale", status: "paused", manager: "wmj" },
  { code: "LBUY-20260924-001", name: "乌拉圭蒙得维的亚分拨中心", region: "乌拉圭", projectType: "T-sort", stageKey: "presale", status: "active", manager: "lan" },
  { code: "LBZA-20260924-001", name: "南非约翰内斯堡分拣中心", region: "南非", projectType: "3D分拣", stageKey: "trial", status: "active", manager: "panxing" },
  { code: "LBZA-20260924-002", name: "南非开普敦仓配", region: "南非", projectType: "T-sort", stageKey: "presale", status: "active", manager: "wmj" },
  { code: "LBGR-20260924-001", name: "希腊雅典分拨中心", region: "希腊", projectType: "T-sort", stageKey: "production", status: "active", manager: "panxing" },
  { code: "LBRU-20260924-001", name: "俄罗斯莫斯科仓配", region: "俄罗斯", projectType: "T-sort", stageKey: "presale", status: "paused", manager: "panxing" },
  { code: "LBKR-20260924-001", name: "韩国首尔分拣中心", region: "韩国", projectType: "T-sort", stageKey: "install", status: "active", manager: "wmj" },
  { code: "LBKR-20260924-002", name: "韩国釜山仓配", region: "韩国", projectType: "3D分拣", stageKey: "design", status: "active", manager: "lan" },
  { code: "LBJP-20260924-001", name: "日本东京分拣中心", region: "日本", projectType: "3D分拣", stageKey: "production", status: "active", manager: "panxing" },
  { code: "LBJP-20260924-002", name: "日本大阪仓配", region: "日本", projectType: "T-sort", stageKey: "presale", status: "active", manager: "wmj" },
  { code: "LBAU-20260924-001", name: "澳大利亚悉尼分拣中心", region: "澳大利亚", projectType: "T-sort", stageKey: "deploy", status: "active", manager: "lan" },
  { code: "LBAU-20260924-002", name: "澳大利亚墨尔本仓", region: "澳大利亚", projectType: "3D分拣", stageKey: "design", status: "active", manager: "panxing" },
  { code: "LBCN-20260924-001", name: "上海分拨中心", region: "中国", projectType: "T-sort", stageKey: "deploy", status: "active", manager: "lan" },
  { code: "LBCN-20260924-002", name: "深圳电商仓", region: "中国", projectType: "飞箱", stageKey: "install", status: "active", manager: "panxing" },
  { code: "LBUS-20260924-001", name: "美国洛杉矶分拣中心", region: "美国", projectType: "T-sort", stageKey: "trial", status: "active", manager: "wmj" },
  { code: "LBUS-20260924-002", name: "美国新泽西仓配", region: "美国", projectType: "3D分拣", stageKey: "presale", status: "active", manager: "lan+shaochenyu" },
  { code: "LBCN-20260924-101", name: "中国广州分拨中心", region: "中国", projectType: "T-sort", stageKey: "deploy", status: "active", manager: "lan" },
  { code: "LBCN-20260924-102", name: "中国成都仓配", region: "中国", projectType: "飞箱", stageKey: "install", status: "active", manager: "panxing" },
  { code: "LBCN-20260924-103", name: "中国武汉分拣线", region: "中国", projectType: "3D分拣", stageKey: "design", status: "active", manager: "wmj" },
  { code: "LBUS-20260924-101", name: "美国芝加哥分拣中心", region: "美国", projectType: "T-sort", stageKey: "install", status: "active", manager: "wmj" },
  { code: "LBUS-20260924-102", name: "美国达拉斯仓配", region: "美国", projectType: "3D分拣", stageKey: "deploy", status: "active", manager: "lan" },
  { code: "LBUS-20260924-103", name: "美国亚特兰大分拨中心", region: "美国", projectType: "飞箱", stageKey: "presale", status: "active", manager: "panxing" },
  { code: "LBUS-20260924-104", name: "美国西雅图仓", region: "美国", projectType: "T-sort", stageKey: "trial", status: "active", manager: "wmj" },
  { code: "LBIN-20260924-101", name: "印度金奈仓配", region: "印度", projectType: "T-sort", stageKey: "design", status: "active", manager: "lan" },
  { code: "LBIN-20260924-102", name: "印度海得拉巴分拨中心", region: "印度", projectType: "3D分拣", stageKey: "install", status: "active", manager: "panxing" },
  { code: "LBIN-20260924-103", name: "印度浦那分拣线", region: "印度", projectType: "飞箱", stageKey: "presale", status: "paused", manager: "wmj" },
  { code: "LBDE-20260924-101", name: "德国慕尼黑仓配", region: "德国", projectType: "3D分拣", stageKey: "presale", status: "active", manager: "lan" },
  { code: "LBDE-20260924-102", name: "德国法兰克福分拨中心", region: "德国", projectType: "T-sort", stageKey: "trial", status: "active", manager: "panxing" },
  { code: "LBBR-20260924-101", name: "巴西巴西利亚仓配", region: "巴西", projectType: "飞箱", stageKey: "design", status: "active", manager: "wmj" },
  { code: "LBBR-20260924-102", name: "巴西萨尔瓦多分拣线", region: "巴西", projectType: "T-sort", stageKey: "presale", status: "active", manager: "lan" },
  { code: "LBGB-20260924-101", name: "英国伯明翰仓配", region: "英国", projectType: "T-sort", stageKey: "install", status: "active", manager: "panxing" },
  { code: "LBGB-20260924-102", name: "英国曼彻斯特分拨中心", region: "英国", projectType: "3D分拣", stageKey: "design", status: "done", manager: "wmj" },
  { code: "LBJP-20260924-101", name: "日本名古屋仓配", region: "日本", projectType: "T-sort", stageKey: "presale", status: "active", manager: "lan" },
  { code: "LBJP-20260924-102", name: "日本福冈分拨中心", region: "日本", projectType: "飞箱", stageKey: "deploy", status: "active", manager: "panxing" },
  { code: "LBFR-20260924-101", name: "法国马赛仓配", region: "法国", projectType: "3D分拣", stageKey: "install", status: "active", manager: "wmj" },
  { code: "LBFR-20260924-102", name: "法国图卢兹分拣线", region: "法国", projectType: "T-sort", stageKey: "presale", status: "active", manager: "lan" },
  { code: "LBKR-20260924-101", name: "韩国仁川仓配", region: "韩国", projectType: "T-sort", stageKey: "trial", status: "active", manager: "panxing" },
  { code: "LBKR-20260924-102", name: "韩国大邱分拨中心", region: "韩国", projectType: "3D分拣", stageKey: "presale", status: "active", manager: "wmj" },
  { code: "LBIT-20260924-101", name: "意大利都灵仓配", region: "意大利", projectType: "T-sort", stageKey: "presale", status: "active", manager: "lan" },
  { code: "LBAU-20260924-101", name: "澳大利亚布里斯班仓配", region: "澳大利亚", projectType: "3D分拣", stageKey: "design", status: "active", manager: "panxing" },
  { code: "LBCA-20260924-101", name: "加拿大卡尔加里分拨中心", region: "加拿大", projectType: "T-sort", stageKey: "trial", status: "active", manager: "wmj" },
  { code: "LBTH-20260924-101", name: "泰国清迈仓配", region: "泰国", projectType: "飞箱", stageKey: "presale", status: "active", manager: "lan" },
  { code: "LBVN-20260924-101", name: "越南岘港分拨中心", region: "越南", projectType: "T-sort", stageKey: "deploy", status: "active", manager: "panxing" },
  { code: "LBES-20260924-101", name: "西班牙瓦伦西亚仓配", region: "西班牙", projectType: "3D分拣", stageKey: "presale", status: "active", manager: "yuhong" },
  { code: "LBNL-20260924-101", name: "荷兰海牙分拣线", region: "荷兰", projectType: "T-sort", stageKey: "presale", status: "active", manager: "yicaonan+xulinjie" },
  { code: "LBAE-20260924-101", name: "阿联酋沙迦仓配", region: "阿联酋", projectType: "飞箱", stageKey: "design", status: "active", manager: "panxing" },
  { code: "LBRU-20260924-101", name: "俄罗斯圣彼得堡分拨中心", region: "俄罗斯", projectType: "T-sort", stageKey: "presale", status: "active", manager: "wmj" },
  { code: "LBPL-20260924-101", name: "波兰华沙分拨中心", region: "波兰", projectType: "3D分拣", stageKey: "presale", status: "active", manager: "shaochenyu" },
  { code: "LBUA-20260924-101", name: "乌克兰利沃夫仓配", region: "乌克兰", projectType: "飞箱", stageKey: "presale", status: "active", manager: "panxing" },
  { code: "LBGR-20260924-101", name: "希腊塞萨洛尼基仓配", region: "希腊", projectType: "T-sort", stageKey: "presale", status: "active", manager: "wmj" },
  { code: "LBSA-20260924-101", name: "沙特勒雅得分拨中心", region: "沙特阿拉伯", projectType: "3D分拣", stageKey: "presale", status: "active", manager: "lan" },
  { code: "LBNZ-20260924-101", name: "新西兰基督城仓配", region: "新西兰", projectType: "T-sort", stageKey: "presale", status: "done", manager: "panxing" },
  { code: "LBPE-20260924-101", name: "秘鲁阿雷基帕分拣线", region: "秘鲁", projectType: "飞箱", stageKey: "presale", status: "active", manager: "wmj" },
];

export async function run(client) {
  const summary = { regionsInserted: 0, regionsUnchanged: 0, projectsInserted: 0, projectsUnchanged: 0, managerFallback: 0 };

  // ① 地区字典：存在即跳过（不覆盖库内改过的 name / sort）。
  for (const region of REGIONS) {
    const found = await client.query("select id from dict_items where type_code = 'region' and code = $1", [region.code]);
    if (found.rows.length > 0) {
      summary.regionsUnchanged += 1;
      continue;
    }
    await client.query(
      "insert into dict_items (type_code, code, name, sort, enabled, metadata, created_at, updated_at) values ('region', $1, $2, $3, true, '{}'::jsonb, now(), now())",
      [region.code, region.name, region.sort],
    );
    summary.regionsInserted += 1;
  }

  // ② 项目经理：用户名 → users.id；解析不到的退兜底账号（见文件头）。
  const users = (await client.query("select id, username from users order by created_at, username")).rows;
  const idByUsername = new Map(users.map((row) => [row.username, row.id]));
  let fallbackId = null;
  for (const candidate of [process.env.DEMO_MANAGER_USERNAME, "panxing"]) {
    if (typeof candidate === "string" && candidate.length > 0 && idByUsername.has(candidate)) {
      fallbackId = idByUsername.get(candidate);
      break;
    }
  }
  if (fallbackId === null && users.length > 0) {
    fallbackId = users[0].id;
  }

  // ③ 演示项目：按 code 存在即跳过；created_at 按清单顺序倒排（列表顺序与清单一致）。
  for (let index = 0; index < PROJECTS.length; index += 1) {
    const project = PROJECTS[index];
    const found = await client.query("select id from projects where code = $1", [project.code]);
    if (found.rows.length > 0) {
      summary.projectsUnchanged += 1;
      continue;
    }
    const managerIds = [];
    for (const username of project.manager.split("+")) {
      const id = idByUsername.get(username);
      if (id === undefined) {
        if (fallbackId === null) {
          throw new Error("库里没有任何账号：演示项目必须挂在项目经理上（projects.manager_ids 非空）—— 先建账号再跑本种子");
        }
        summary.managerFallback += 1;
        if (!managerIds.includes(fallbackId)) {
          managerIds.push(fallbackId);
        }
        continue;
      }
      if (!managerIds.includes(id)) {
        managerIds.push(id);
      }
    }
    await client.query(
      "insert into projects (code, name, region, project_type, stage_key, status, description, manager_ids, created_at, updated_at) values ($1, $2, $3, $4, $5, $6, $7, $8::uuid[], now() - make_interval(mins => $9), now())",
      [project.code, project.name, project.region, project.projectType, project.stageKey, project.status, DESCRIPTION, managerIds, index * 3],
    );
    summary.projectsInserted += 1;
  }

  return summary;
}
