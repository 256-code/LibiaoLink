import { z } from "@libiaolink/contracts";
import { describe, expect, it } from "vitest";
import { AppError } from "../src/common/errors/app-error.js";
import { ZodValidationPipe } from "../src/common/http/zod-validation.pipe.js";

describe("ZodValidationPipe", () => {
  const schema = z.object({ limit: z.coerce.number().int().min(1).max(200) });

  it("通过时返回解析后的值", () => {
    const pipe = new ZodValidationPipe(schema);
    expect(pipe.transform({ limit: "10" })).toEqual({ limit: 10 });
  });

  it("失败时抛 VALIDATION_FAILED（含字段明细与 HTTP 400）", () => {
    const pipe = new ZodValidationPipe(schema);
    try {
      pipe.transform({ limit: 0 });
      expect.unreachable("应当抛出 AppError");
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      const appError = error as AppError;
      expect(appError.code).toBe("VALIDATION_FAILED");
      expect(appError.httpStatus).toBe(400);
      expect(appError.details.length).toBeGreaterThan(0);
      expect(appError.details[0]?.path).toBe("limit");
    }
  });
});
