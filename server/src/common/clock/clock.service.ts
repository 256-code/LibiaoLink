import { Injectable } from "@nestjs/common";

/**
 * 时钟服务（技术设计v0.3 §4.7）：规则 / 调度 / 逾期判定禁止直接取系统时间，统一经本出口，
 * 保证可回放与金标用例（注入固定时刻即可复算）。h8（工作日历）为首个接入模块。
 * 口径：业务日按 Asia/Shanghai（UTC+8 固定偏移、无夏令时，ADR-028）。
 */
export function shanghaiDateOf(now: Date): string {
  return new Date(now.getTime() + 8 * 3_600_000).toISOString().slice(0, 10);
}

@Injectable()
export class ClockService {
  private source: () => Date = () => new Date();

  /** 当前时刻（UTC）。 */
  now(): Date {
    return this.source();
  }

  /** 当前业务日（Asia/Shanghai）YYYY-MM-DD。 */
  today(): string {
    return shanghaiDateOf(this.now());
  }

  /** 仅测试 / 回放使用：替换时钟源（生产不调用）。 */
  setSource(source: () => Date): void {
    this.source = source;
  }
}
