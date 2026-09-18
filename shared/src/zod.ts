import { extendZodWithOpenApi } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";

// 契约包对 zod 的唯一扩展点（.openapi(...) 元数据与组件注册）。
// 所有模块必须从本文件导入 z；不要在别处重复调用 extendZodWithOpenApi。
extendZodWithOpenApi(z);

export { z };
