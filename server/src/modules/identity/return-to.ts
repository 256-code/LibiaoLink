/** 回跳白名单：仅允许同源相对路径（以 / 开头、非 // 或 /\\、不含反斜杠），非法值一律回退 /。 */
export function safeReturnTo(value: string | undefined): string {
  if (value === undefined || value === "") {
    return "/";
  }
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\") || value.includes("\\")) {
    return "/";
  }
  return value;
}
