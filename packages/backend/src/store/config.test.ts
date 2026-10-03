import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readConfig } from "./config.ts";
import { tempHome } from "./testing.ts";

describe("config.json", () => {
  it("没有文件时用默认值：端口 4731，缓存保留十四天，评审界线六十行和三个文件", () => {
    const paths = tempHome();
    expect(readConfig(paths.config)).toEqual({
      ok: true,
      value: {
        port: 4731,
        cacheRetentionDays: 14,
        reviewThreshold: { lines: 60, files: 3, dataFormatPaths: [] },
      },
    });
  });

  it("只写了几项时，其余用默认值，不认识的项忽略", () => {
    const paths = tempHome();
    writeFileSync(paths.config, JSON.stringify({ port: 0, reviewThreshold: { lines: 100 }, x: 1 }));
    expect(readConfig(paths.config)).toEqual({
      ok: true,
      value: {
        port: 0,
        cacheRetentionDays: 14,
        reviewThreshold: { lines: 100, files: 3, dataFormatPaths: [] },
      },
    });
  });

  it("评审界线可以写数据格式的路径，每条是一个 glob", () => {
    const paths = tempHome();
    const dataFormatPaths = ["packages/backend/drizzle/**", "**/*.schema.json"];
    writeFileSync(paths.config, JSON.stringify({ reviewThreshold: { dataFormatPaths } }));
    expect(readConfig(paths.config)).toMatchObject({
      ok: true,
      value: { reviewThreshold: { lines: 60, files: 3, dataFormatPaths } },
    });
  });

  it("写错的项一次报全", () => {
    const paths = tempHome();
    writeFileSync(
      paths.config,
      JSON.stringify({
        port: "4731",
        cacheRetentionDays: 1.5,
        reviewThreshold: { files: -1, dataFormatPaths: ["drizzle/**", ""] },
      }),
    );
    expect(readConfig(paths.config)).toEqual({
      ok: false,
      error: {
        kind: "configInvalid",
        file: paths.config,
        fields: [
          "port",
          "cacheRetentionDays",
          "reviewThreshold.files",
          "reviewThreshold.dataFormatPaths.1",
        ],
      },
    });
  });

  it.each(["{", "[]", "null", ""])("整个文件不是 JSON 对象（%j）时报写错，不列具体的项", (text) => {
    const paths = tempHome();
    writeFileSync(paths.config, text);
    expect(readConfig(paths.config)).toEqual({
      ok: false,
      error: { kind: "configInvalid", file: paths.config, fields: [] },
    });
  });
});
