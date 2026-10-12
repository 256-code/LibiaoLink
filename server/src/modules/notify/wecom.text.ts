/**
 * 企微文本组装工具（M5-03-3 抽共用 · B5 定案「投递层按企微字节上限截断留痕」）：
 * UTF-8 字节截断（不劈开多字节字符）—— 群 markdown（wecom_group · 20000 字节）与
 * 应用文本（wecom_app · 2000 字节）共用同一实现，尾部省略标记。
 */

/** UTF-8 字节截断：未超长原样返回；超长截到 maxBytes - 后缀，尾部拼省略标记（从合法字符边界回退）。 */
export function truncateUtf8Bytes(
  content: string,
  maxBytes: number,
  suffix: string,
): { content: string; truncated: boolean } {
  if (Buffer.byteLength(content, "utf8") <= maxBytes) {
    return { content, truncated: false };
  }
  const bytes = Buffer.from(content, "utf8").subarray(0, Math.max(0, maxBytes - Buffer.byteLength(suffix, "utf8")));
  let sliced = bytes.toString("utf8");
  // 多字节字符切在中间时 toString 产生 U+FFFD 替换符：从尾部剥离（回退到合法字符边界）
  while (sliced.endsWith("\uFFFD")) {
    sliced = sliced.slice(0, -1);
  }
  return { content: sliced + suffix, truncated: true };
}
