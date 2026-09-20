// 种子注册表：按执行顺序导出（database/seeds/README.md §执行约定：dicts → roles → 蓝图 → …）。
// 追加规则：新种子模块追加到数组末尾；runner（scripts/seed.mjs）逐个独立事务执行，重复执行零变更。
import * as roles from "./roles.mjs";

export const SEEDS = [roles];
