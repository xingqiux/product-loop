import { describe, expect, it } from "vitest";
import { z } from "zod";
import { renderCopy } from "../copy/define.ts";
import { formatChangeCopy } from "../copy/page.ts";
import { queueStatus } from "../names.ts";
import { evidenceType } from "./evidence.ts";
import {
  type FormatChange,
  fieldPath,
  formatChangeAt,
  formatChangeOfValue,
  formatChanges,
  renamedValue,
} from "./legacy-format.ts";
import { validPage } from "./page.samples.ts";
import { pageSectionsSchema } from "./sections.ts";
import { columnStyle, motionEffect, specKind } from "./spec.ts";

type JsonSchema = {
  readonly $ref?: string;
  readonly $defs?: Readonly<Record<string, JsonSchema>>;
  readonly properties?: Readonly<Record<string, JsonSchema>>;
  readonly items?: JsonSchema;
  readonly anyOf?: readonly JsonSchema[];
  readonly oneOf?: readonly JsonSchema[];
};

const pageJsonSchema = z.toJSONSchema(pageSectionsSchema, { io: "input" }) as JsonSchema;

/** 共用的部分放在 $defs 里，引用写成 #/$defs/名字。 */
function resolve(schema: JsonSchema): JsonSchema {
  const name = schema.$ref?.replace("#/$defs/", "");
  return name === undefined ? schema : (pageJsonSchema.$defs?.[name] ?? {});
}

/** 新格式里有没有这个字段：顺着 JSON Schema 往下找，并列的几种写法有一种有就算有。 */
function hasField(schema: JsonSchema, parts: readonly string[]): boolean {
  const node = resolve(schema);
  const branches = [...(node.anyOf ?? []), ...(node.oneOf ?? [])];
  if (branches.length > 0) return branches.some((branch) => hasField(branch, parts));
  const [part, ...rest] = parts;
  if (part === undefined) return true;
  const next = part === "[]" ? node.items : node.properties?.[part];
  return next !== undefined && hasField(next, rest);
}

/** asks[].options[].see 拆成 asks、[]、options、[]、see。 */
function splitPath(path: string): string[] {
  return path.split(".").flatMap((part) => {
    const [name = "", ...brackets] = part.split("[]");
    return [name, ...brackets.map(() => "[]")];
  });
}

/** 不带 =值 的路径，只有这种能对上字段。 */
const plain = (paths: readonly string[]) => paths.filter((path) => !path.includes("="));

describe("新旧格式的对照表", () => {
  it("键不重复，每一条在文案表里都有说明和依据", () => {
    const keys = formatChanges.map((change) => change.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(Object.keys(formatChangeCopy).sort()).toEqual([...keys].sort());
  });

  it("路径的写法统一：英文字段名用点连起来，数组写 []，数组套数组写 [][]", () => {
    for (const change of formatChanges as readonly FormatChange[]) {
      for (const path of [...change.old, ...change.now]) {
        expect(path).toMatch(/^[a-z][A-Za-z]*(\[\])*(\.[a-z][A-Za-z]*(\[\])*)*(=[a-z]+)?$/u);
      }
    }
  });

  it("同一个旧路径只出现在一条里", () => {
    const paths = formatChanges.flatMap((change: FormatChange) => plain(change.old));
    expect(paths.filter((path, i) => paths.indexOf(path) !== i)).toEqual([]);
  });

  it("「07 校验」第二节列的已废除字段都在表里", () => {
    const abolished = formatChanges
      .filter((change: FormatChange) => change.kind === "abolished")
      .flatMap((change: FormatChange) => change.old);
    for (const field of ["queue", "rethink", "progress", "current", "system", "landDir", "land"]) {
      expect(abolished).toContain(field);
    }
    for (const field of ["queueRow", "options[].see", "where.title", "where.stepText"]) {
      expect(abolished).toContain(`asks[].${field}`);
    }
  });

  it("新格式的路径都是新格式里真有的字段", () => {
    for (const change of formatChanges as readonly FormatChange[]) {
      for (const path of plain(change.now)) {
        expect(hasField(pageJsonSchema, splitPath(path)), `${change.key}：${path}`).toBe(true);
      }
    }
  });

  it("废除、改名和改由命令填的旧字段，新格式里都没有", () => {
    const gone = formatChanges.filter((change: FormatChange) =>
      ["abolished", "renamed", "commandFilled"].includes(change.kind),
    );
    for (const change of gone as readonly FormatChange[]) {
      for (const path of plain(change.old)) {
        expect(hasField(pageJsonSchema, splitPath(path)), `${change.key}：${path}`).toBe(false);
      }
    }
  });

  it("设计文档没写、第 20 和 21 步定的几条都标了出来", () => {
    const decided = formatChanges
      .filter((change: FormatChange) => change.decidedHere === true)
      .map((change) => change.key);
    expect(decided).toEqual([
      "queueRefs",
      "whereTotals",
      "imgPath",
      "noLift",
      "stepExpect",
      "evidenceArray",
      "emptyValues",
      "trueFlags",
      "hexColor",
      "evidenceType",
      "specKind",
      "motionEffect",
      "columnStyle",
      "cellTone",
    ]);
  });

  it("只有取值换了写法的几条有 values，路径不变", () => {
    for (const change of formatChanges as readonly FormatChange[]) {
      expect(change.values !== undefined, change.key).toBe(change.kind === "renamedValue");
      if (change.kind === "renamedValue") expect(change.now).toEqual(change.old);
    }
  });
});

/** 枚举在接口上收发中文，见「05 接口」第一节。旧格式写英文的五处，旧的取值换成中文。 */
describe("取值换了写法的五处", () => {
  const values = (key: string) =>
    (formatChanges as readonly FormatChange[]).find((change) => change.key === key)?.values;

  it.each([
    ["evidenceType", evidenceType],
    ["specKind", specKind],
    ["motionEffect", motionEffect],
    ["columnStyle", columnStyle],
  ] as const)("%s：英文键就是旧格式的写法，换成它的中文标签", (key, def) => {
    expect(values(key)).toEqual(def.table);
  });

  it("状态标签的色调换成队列的五种状态，一一对应", () => {
    expect(values("cellTone")).toEqual({
      todo: "待办",
      doing: "进行中",
      wait: "等待",
      done: "已完成",
      drop: "已取消",
    });
    expect(Object.values(values("cellTone") ?? {})).toEqual(queueStatus.labels);
  });

  it("说明里按顺序列出全部新的取值", () => {
    for (const change of formatChanges as readonly FormatChange[]) {
      if (change.values === undefined) continue;
      const note = renderCopy(formatChangeCopy[change.key as keyof typeof formatChangeCopy].note);
      expect(note, change.key).toContain(Object.values(change.values).join("、"));
    }
  });
});

describe("按旧字段的路径找到对照表里的一条", () => {
  it("Zod 问题的路径换成对照表的写法", () => {
    expect(fieldPath(["asks", 0, "options", 1, "see"])).toBe("asks[].options[].see");
    expect(fieldPath(["rethink"])).toBe("rethink");
    expect(fieldPath([])).toBe("");
  });

  it.each([
    ["asks[].queueRow", "queueRow"],
    ["changes[].queueRow", "queueRow"],
    ["findings[].where.stepText", "whereText"],
    ["asks[].sources[].src", "sourceImg"],
    ["changes[].after.src", "imgPath"],
    ["system", "header"],
    ["stage", "roundFields"],
    ["noLift", "noLift"],
  ])("%s 找到 %s", (path, key) => {
    expect(formatChangeAt(path)?.key).toBe(key);
  });

  it("新格式里正常的字段和带值的路径找不到", () => {
    expect(formatChangeAt("asks[].title")).toBeUndefined();
    expect(formatChangeAt("asks[].evidence[].type=excerpt")).toBeUndefined();
  });

  it.each([
    ["asks[].evidence[].type", "excerpt", "excerptEvidence", undefined],
    ["findings[].evidence[].type", "image", "evidenceType", "截图"],
    ["spec[].kind", "table", "specKind", "表格"],
    ["spec[].values[].effect", "move", "motionEffect", "移动"],
    ["spec[].columns[].as", "old", "columnStyle", "旧叫法"],
    ["spec[].rows[][].tone", "wait", "cellTone", "等待"],
  ])("按路径和旧的取值找：%s 取 %s 找到 %s", (path, value, key, now) => {
    const change = formatChangeOfValue(path, value);
    expect(change?.key).toBe(key);
    expect(change && renamedValue(change, value)).toBe(now);
  });

  it("新的取值、不认识的取值和不是文字的取值都找不到", () => {
    expect(formatChangeOfValue("spec[].kind", "表格")).toBeUndefined();
    expect(formatChangeOfValue("spec[].kind", "grid")).toBeUndefined();
    expect(formatChangeOfValue("spec[].rows[][].tone", "red")).toBeUndefined();
    expect(formatChangeOfValue("asks[].sources[].quote", false)).toBeUndefined();
    expect(formatChangeOfValue("asks[].title", "image")).toBeUndefined();
  });

  it("页面数据里写了旧字段，不认识的字段报在哪里，就能找到改成什么", () => {
    const old = JSON.parse(JSON.stringify(validPage)) as {
      asks: Record<string, unknown>[];
      findings: { where: Record<string, unknown> }[];
      [key: string]: unknown;
    };
    old.queue = [];
    const [ask] = old.asks;
    const [finding] = old.findings;
    if (ask === undefined || finding === undefined) throw new Error("样本里缺卡片");
    ask.queueRow = "选项卡升级";
    finding.where.title = "回答疑问";
    const found = (pageSectionsSchema.safeParse(old).error?.issues ?? []).flatMap((issue) =>
      issue.code === "unrecognized_keys"
        ? issue.keys.map((key) => formatChangeAt(fieldPath([...issue.path, key]))?.key)
        : [],
    );
    expect(found.sort()).toEqual(["queueBoard", "queueRow", "whereText"]);
  });
});
