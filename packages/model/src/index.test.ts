import { describe, expect, it } from "vitest";
import * as model from "./index.ts";

describe("共用定义的入口", () => {
  it("导出错误码、响应外壳和文案表", () => {
    expect(model.errorCodes.length).toBeGreaterThan(0);
    expect(model.cliEnvelopeSchema).toBeDefined();
    expect(model.allCopy().length).toBeGreaterThan(0);
  });
});
