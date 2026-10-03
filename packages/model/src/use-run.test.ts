import { describe, expect, it } from "vitest";
import { z } from "zod";
import * as model from "./index.ts";
import { useStepResult } from "./names.ts";
import { useOutEnv, useRunFile, useRunJsonSchema, useRunOutputSchema } from "./use-run.ts";

/**
 * 一次运行：网页的场景在两个宽度下截图，命令行的场景只核对输出和退出码。
 * 照文件里的写法，结果写中文标签。
 */
const sample: z.input<typeof useRunOutputSchema> = {
  schemaVersion: 1,
  startedAt: "2026-09-28T10:00:00+08:00",
  finishedAt: "2026-09-28T10:03:12+08:00",
  environment: "无头 Chrome，窗口高 900，邮件用假的服务",
  scenes: [
    {
      scene: "S3",
      steps: [
        {
          step: 1,
          width: 420,
          do: "打开等回复的那一页",
          expect: "没有左边一栏，顶上写着还剩几条",
          result: "通过",
          screenshot: "shots/S3-1-420.png",
          facts: { remain: "还剩 4 条", scrollWidth: 420 },
        },
        {
          step: 1,
          width: 1400,
          do: "打开等回复的那一页",
          expect: "左边是列表，右边只摆着一屏",
          result: "通过",
          screenshot: "shots/S3-1-1400.png",
        },
        {
          step: 2,
          width: 1400,
          do: "点第一条的选项 a",
          expect: "选项上色，左边这一条打勾",
          result: "断了",
          screenshot: "shots/S3-2-1400.png",
          error: "点了 a，左边这一条没有打勾",
        },
        {
          step: 3,
          do: "点提交",
          expect: "页面写着已提交",
          result: "没走",
          error: "前一步断了",
        },
      ],
    },
    {
      scene: "S14",
      steps: [
        {
          step: 1,
          do: "敲 ploop",
          expect: "看到第几版、哪个阶段、第几轮和下一步",
          result: "通过",
          facts: { exitCode: 0, firstLine: "v2 · 检查 · 第 1 轮" },
        },
        {
          step: 2,
          do: "敲 ploop round show",
          expect: "看到这一轮拿出来的事和给出过的页",
          result: "环境",
          error: "后端没有起来：端口 4731 被别的程序占用",
        },
      ],
    },
  ],
};

type Json = Record<string, unknown>;

/** 把样例的一处改掉，其余不变。 */
function withStep(change: Json, scene = 0, step = 0): Json {
  const copy = structuredClone(sample) as unknown as { scenes: { steps: Json[] }[] };
  const target = copy.scenes[scene]?.steps;
  if (target === undefined) throw new Error("样例里没有这个场景");
  target[step] = { ...target[step], ...change };
  return copy;
}

function issuesOf(output: unknown): { path: string; message: string }[] {
  const result = useRunOutputSchema.safeParse(output);
  expect(result.success).toBe(false);
  return (result.error?.issues ?? []).map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));
}

describe("使用代码的输出格式", () => {
  it("输出目录由 PLOOP_USE_OUT 指定，结果写在其中的 use-run.json", () => {
    expect(useOutEnv).toBe("PLOOP_USE_OUT");
    expect(useRunFile).toBe("use-run.json");
  });

  it("网页的场景在几个宽度下各写一项，命令行的场景不写宽度和截图", () => {
    const parsed = useRunOutputSchema.parse(sample);
    const results = parsed.scenes.flatMap(({ steps }) => steps.map((step) => step.result));
    expect(results).toEqual(["pass", "pass", "broken", "skipped", "pass", "environment"]);
    expect(z.encode(useRunOutputSchema, parsed)).toEqual(sample);
  });

  it("只写格式版本和走到的场景也行，没有走任何场景时场景是空列表", () => {
    expect(useRunOutputSchema.safeParse({ schemaVersion: 1, scenes: [] }).success).toBe(true);
  });

  it("结果只收四个中文标签", () => {
    expect(useStepResult.labels).toEqual(["通过", "断了", "没走", "环境"]);
    for (const result of useStepResult.labels) {
      const error = result === "通过" ? undefined : "原因";
      expect(useRunOutputSchema.safeParse(withStep({ result, error })).success).toBe(true);
    }
    for (const result of [...useStepResult.keys, "走通", "没有走"]) {
      expect(useRunOutputSchema.safeParse(withStep({ result })).success).toBe(false);
    }
  });

  it.each<[string, unknown]>([
    ["没写格式版本", { scenes: [] }],
    ["格式版本是 2", { schemaVersion: 2, scenes: [] }],
    ["多出不认识的字段", { ...sample, summary: "都走通了" }],
    ["开始时间不带时区", { ...sample, startedAt: "2026-09-28T10:00:00" }],
    ["环境说明是空的", { ...sample, environment: "" }],
    [
      "场景写了名字：名字只从主线取",
      { schemaVersion: 1, scenes: [{ ...sample.scenes[0], title: "逐条点选项并提交" }] },
    ],
    [
      "旧 walk-report.mjs 的 walk-facts.json",
      {
        schemaVersion: 1,
        scenes: [{ name: "回答疑问", state: "走通", steps: [{ n: 1, text: "打开", ok: true }] }],
      },
    ],
    ["场景没有步骤", { schemaVersion: 1, scenes: [{ scene: "S3", steps: [] }] }],
  ])("拒绝：%s", (_, output) => {
    expect(useRunOutputSchema.safeParse(output).success).toBe(false);
  });

  it.each(["s3", "S0", "S03", "3", "S3 逐条点选项并提交", "Q3"])(
    "场景编号 %j 写法不对",
    (scene) => {
      const output = { schemaVersion: 1, scenes: [{ ...sample.scenes[0], scene }] };
      expect(issuesOf(output).map((issue) => issue.path)).toEqual(["scenes.0.scene"]);
    },
  );

  it.each<[string, Json]>([
    ["步号是 0", { step: 0 }],
    ["步号不是整数", { step: 1.5 }],
    ["宽度是 0", { width: 0 }],
    ["没写做什么", { do: "" }],
    ["没写该看到什么", { expect: "" }],
    ["事实不是一个对象", { facts: "顶栏写着设计平台" }],
    ["旧场景文件的 shot", { shot: "designs" }],
  ])("拒绝一步：%s", (_, change) => {
    expect(useRunOutputSchema.safeParse(withStep(change)).success).toBe(false);
  });

  it.each([
    "/tmp/S3-1.png",
    "../S3-1.png",
    "shots/../S3-1.png",
    "./S3-1.png",
    "shots//S3-1.png",
    "shots\\S3-1.png",
    "shots/S3-1.jpg",
    "shots/S3-1.PNG",
    "shots/",
  ])("截图的路径 %j 不收", (screenshot) => {
    expect(issuesOf(withStep({ screenshot })).map((issue) => issue.path)).toEqual([
      "scenes.0.steps.0.screenshot",
    ]);
  });

  it.each(["S3-1.png", "shots/S3/1-420.png", "截图/回答疑问-1.png", "shots/..a.png"])(
    "截图的路径 %j 可以",
    (screenshot) => {
      expect(useRunOutputSchema.safeParse(withStep({ screenshot })).success).toBe(true);
    },
  );
});

describe("要对照几个字段才能查出的问题", () => {
  it("没有通过的步骤要写原因", () => {
    expect(issuesOf(withStep({ error: undefined }, 0, 2))).toEqual([
      {
        path: "scenes.0.steps.2.error",
        message: "结果是「断了」的步骤要写 error，说明原因。",
      },
    ]);
  });

  it("通过的步骤不写原因", () => {
    expect(issuesOf(withStep({ error: "没有问题" }))).toEqual([
      { path: "scenes.0.steps.0.error", message: "结果是「通过」的步骤不写 error。" },
    ]);
  });

  it("写了截图就要写宽度", () => {
    expect(issuesOf(withStep({ width: undefined }))).toEqual([
      {
        path: "scenes.0.steps.0.width",
        message: "带截图的步骤要写 width，也就是截图时窗口的宽度。",
      },
    ]);
  });

  it("同一步在同一个宽度下只写一项", () => {
    expect(issuesOf(withStep({ width: 420 }, 0, 1))).toEqual([
      { path: "scenes.0.steps.1", message: "场景 S3 的第 1 步在宽度 420 下写了不止一项。" },
    ]);
    expect(issuesOf(withStep({ step: 1 }, 1, 1))).toEqual([
      { path: "scenes.1.steps.1", message: "场景 S14 的第 1 步写了不止一项。" },
    ]);
  });

  it("同一个场景只写一项", () => {
    const output = { ...sample, scenes: [...sample.scenes, sample.scenes[1]] };
    expect(issuesOf(output)).toEqual([
      { path: "scenes.2.scene", message: "场景 S14 写了不止一项，每个场景只写一项。" },
    ]);
  });

  it("一次报出全部问题，连同格式本身的问题", () => {
    const output = structuredClone(sample) as unknown as { scenes: { steps: Json[] }[] };
    const [web, cli] = output.scenes;
    if (web === undefined || cli === undefined) throw new Error("样例里少了场景");
    web.steps[0] = { ...web.steps[0], width: undefined, step: 0 };
    web.steps[2] = { ...web.steps[2], error: undefined };
    cli.steps[0] = { ...cli.steps[0], error: "多写的原因" };
    expect(issuesOf(output).map((issue) => issue.path)).toEqual([
      "scenes.0.steps.0.step",
      "scenes.0.steps.0.width",
      "scenes.0.steps.2.error",
      "scenes.1.steps.0.error",
    ]);
  });
});

describe("使用代码输出格式的 JSON Schema", () => {
  const schema = useRunJsonSchema();

  it("和快照一致", () => {
    expect(JSON.stringify(schema, null, 2)).toMatchSnapshot();
  });

  /** 走遍三层对象：运行、场景、一步。 */
  function objects(node: Json): Json[] {
    const properties = node.properties as Record<string, Json>;
    const children = Object.values(properties).flatMap((property) => {
      const items = property.items as Json | undefined;
      return items?.type === "object" ? objects(items) : [];
    });
    return [node, ...children];
  }

  it("时间字段写 format: date-time，不带四百多字的正则（P22）", () => {
    const properties = schema.properties as Record<string, Json>;
    for (const name of ["startedAt", "finishedAt"]) {
      expect(properties[name]?.format, name).toBe("date-time");
      expect(properties[name], name).not.toHaveProperty("pattern");
    }
    // 别的正则（场景编号、截图路径）都很短，留着。
    expect(JSON.stringify(schema).length).toBeLessThan(3000);
  });

  it("三层对象都不收多出的字段", () => {
    const levels = objects(schema as Json);
    expect(levels).toHaveLength(3);
    for (const level of levels) expect(level.additionalProperties).toBe(false);
  });

  it("每个字段都有说明，整份有标题", () => {
    expect(schema.title).toBe("使用代码的输出");
    for (const level of objects(schema as Json)) {
      for (const [name, property] of Object.entries(level.properties as Record<string, Json>)) {
        expect(typeof property.description, name).toBe("string");
      }
    }
  });

  it("从共用定义的入口导出", () => {
    expect(model.useRunJsonSchema).toBe(useRunJsonSchema);
    expect(model.useCopy.schema.title.text).toBe("使用代码的输出");
  });
});
