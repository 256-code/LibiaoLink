import { Injectable, type PipeTransform } from "@nestjs/common";
import { z, type ErrorDetail } from "@libiaolink/contracts";
import { AppError } from "../errors/app-error.js";

/** 用契约包 Zod schema 校验入参；失败统一抛 VALIDATION_FAILED（由 ApiErrorFilter 落信封）。 */
@Injectable()
export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: z.ZodType) {}

  transform(value: unknown): unknown {
    const parsed = this.schema.safeParse(value);
    if (!parsed.success) {
      const details: ErrorDetail[] = parsed.error.issues.map((issue) => ({
        code: issue.code,
        message: issue.message,
        path: issue.path.join(".") || undefined,
      }));
      throw new AppError("VALIDATION_FAILED", "参数校验失败", details);
    }
    return parsed.data;
  }
}
