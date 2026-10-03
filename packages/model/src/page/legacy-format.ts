import { queueStatus } from "../names.ts";
import { evidenceType } from "./evidence.ts";
import { columnStyle, motionEffect, specKind } from "./spec.ts";

// 新格式比旧格式改了什么。旧格式以 v1-final 的 templates/README.md 为准，
// 按「07 校验」第二节改（第一期约定第 8 条）。三处要用它：
//
// - 第 21 步：页面数据里写了旧字段或旧的取值时，按路径找到这一条，报「改成什么」。
// - 第 28 步：旧页面数据的转换函数照它改写字段和取值。
// - 第 29 步：校验对照表照它写明有意的改动和依据。
//
// 每一条的说明和依据在文案表的 formatChangeCopy 里，键和这里的 key 相同。
// 旧格式里没有变的字段不在这里，例如卡片的 title、why、tag、options 和参考的五个属性。

/**
 * - added：新加的字段。
 * - renamed：换了名字，值不变。
 * - reshaped：名字不变，值的写法变了。
 * - tightened：字段还在，要求更严。
 * - renamedValue：名字不变，取值换了写法，values 写旧的取值换成什么。
 * - commandFilled：由命令或后端填，AI 不再写，写了就拦截。
 * - abolished：已废除，写了就拦截。now 写代替它的字段，没有就是空的。
 */
export type FormatChangeKind =
  | "added"
  | "renamed"
  | "reshaped"
  | "renamedValue"
  | "tightened"
  | "commandFilled"
  | "abolished";

export type FormatChange = {
  readonly key: string;
  readonly kind: FormatChangeKind;
  /**
   * 旧格式里的字段路径。[] 表示数组的每一项，例如 asks[].options[].see。
   * 带 =值 的只在取这个值时才算，例如 asks[].evidence[].type=excerpt。
   */
  readonly old: readonly string[];
  /** 新格式里对应的字段路径，写法同上。 */
  readonly now: readonly string[];
  /** 只有 renamedValue 有：旧的取值换成新的取值，例如 image 换成「截图」。 */
  readonly values?: Readonly<Record<string, string>>;
  /** 设计文档没有写到，由第 20 或 21 步定的，要用户确认。 */
  readonly decidedHere?: true;
};

/** 三种卡片的区块。旧格式的回到构思整块废除，不单列它下面的字段。 */
const cardBlocks = ["asks", "findings", "improvements"] as const;

/** 有卡片编号的区块。 */
const idSections = ["align", "scenes", "spec", ...cardBlocks, "changes"] as const;

/** 每个区块下的同一个字段，例如 each(cardBlocks, "saw") 得到 asks[].saw 等三条。 */
function each(sections: readonly string[], ...fields: readonly string[]): string[] {
  return sections.flatMap((section) => fields.map((field) => `${section}[].${field}`));
}

/**
 * 表格一格里状态标签的色调。旧格式写 todo、doing、wait、done、drop，
 * 新格式写队列的五种状态，一一对应。
 */
const toneValues = {
  todo: queueStatus.label("todo"),
  doing: queueStatus.label("doing"),
  wait: queueStatus.label("waiting"),
  done: queueStatus.label("done"),
  drop: queueStatus.label("dropped"),
};

/** 旧格式里写图片路径的字段，来源的除外。 */
const otherImagePaths = (name: "src" | "img"): string[] => [
  ...each(cardBlocks, `image.${name}`, `evidence[].${name}`),
  ...each(["changes"], `before.${name}`, `after.${name}`, `more[].${name}`),
  ...each(["scenes"], `steps[].${name}`),
];

export const formatChanges = [
  { key: "cardId", kind: "added", old: [], now: each(idSections, "id") },
  {
    key: "queueRow",
    kind: "abolished",
    old: each([...cardBlocks, "changes"], "queueRow"),
    now: each([...cardBlocks, "changes"], "queue"),
  },
  {
    key: "queueRefs",
    kind: "added",
    old: [],
    now: each(["align", "scenes", "spec"], "queue"),
    decidedHere: true,
  },
  { key: "queueBoard", kind: "abolished", old: ["queue"], now: [] },
  {
    key: "whereScene",
    kind: "abolished",
    old: each(cardBlocks, "where.scenario"),
    now: each(cardBlocks, "where.scene"),
  },
  {
    key: "whereText",
    kind: "abolished",
    old: each(cardBlocks, "where.title", "where.stepText"),
    now: [],
  },
  {
    key: "whereTotals",
    kind: "commandFilled",
    old: each(cardBlocks, "where.scenarios", "where.steps"),
    now: [],
    decidedHere: true,
  },
  { key: "screenWhere", kind: "added", old: [], now: ["screens[].where"] },
  {
    key: "sourceImg",
    kind: "renamed",
    old: each(cardBlocks, "sources[].src"),
    now: each(cardBlocks, "sources[].img"),
  },
  {
    key: "imgPath",
    kind: "renamed",
    old: otherImagePaths("src"),
    now: otherImagePaths("img"),
    decidedHere: true,
  },
  {
    key: "textSource",
    kind: "added",
    old: [],
    now: each(cardBlocks, "sources[].file", "sources[].lines", "sources[].mark"),
  },
  {
    key: "sourceOldForm",
    kind: "abolished",
    old: each(cardBlocks, "sources[].label", "sources[].kind", "sources[].excerpt"),
    now: each(cardBlocks, "sources[].name", "sources[].saw"),
  },
  {
    key: "cardSaw",
    kind: "abolished",
    old: each(cardBlocks, "saw"),
    now: each(cardBlocks, "sources"),
  },
  {
    key: "optionSee",
    kind: "abolished",
    old: each(cardBlocks, "options[].see"),
    now: each(cardBlocks, "rows", "options[].diffs", "shared"),
  },
  {
    key: "hiddenFields",
    kind: "abolished",
    old: each(cardBlocks, "side", "prior", "impact"),
    now: [],
  },
  {
    key: "excerptEvidence",
    kind: "abolished",
    old: each(cardBlocks, "evidence[].type=excerpt"),
    now: each(cardBlocks, "sources[].file"),
  },
  { key: "rethink", kind: "abolished", old: ["rethink"], now: [] },
  { key: "header", kind: "abolished", old: ["system", "progress", "current"], now: [] },
  { key: "roundFields", kind: "commandFilled", old: ["stage", "round", "date"], now: [] },
  { key: "usage", kind: "commandFilled", old: ["usage"], now: [] },
  { key: "land", kind: "abolished", old: ["landDir", "land"], now: [] },
  { key: "noLift", kind: "abolished", old: ["noLift"], now: [], decidedHere: true },
  { key: "sceneNumber", kind: "added", old: [], now: ["scenes[].scene"] },
  {
    key: "stepExpect",
    kind: "renamed",
    old: ["scenes[].steps[].see"],
    now: ["scenes[].steps[].expect"],
    decidedHere: true,
  },
  { key: "specFor", kind: "tightened", old: ["spec[].for"], now: ["spec[].for"] },
  {
    key: "evidenceArray",
    kind: "reshaped",
    old: each(cardBlocks, "evidence"),
    now: each(cardBlocks, "evidence"),
    decidedHere: true,
  },
  { key: "emptyValues", kind: "tightened", old: [], now: [], decidedHere: true },
  {
    key: "trueFlags",
    kind: "tightened",
    old: [
      ...each(cardBlocks, "sources[].quote=false", "sources[].outside=false"),
      ...each(cardBlocks, "only=false", "design=false"),
    ],
    now: [],
    decidedHere: true,
  },
  {
    key: "hexColor",
    kind: "tightened",
    old: ["spec[].values[].hex", ...each(cardBlocks, "evidence[].values[].hex")],
    now: ["spec[].values[].hex", ...each(cardBlocks, "evidence[].values[].hex")],
    decidedHere: true,
  },
  // 下面五条：枚举在接口上收发中文（「05 接口」第一节），旧格式写英文的取值换成中文。
  {
    key: "evidenceType",
    kind: "renamedValue",
    old: each(cardBlocks, "evidence[].type"),
    now: each(cardBlocks, "evidence[].type"),
    values: evidenceType.table,
    decidedHere: true,
  },
  {
    key: "specKind",
    kind: "renamedValue",
    old: ["spec[].kind"],
    now: ["spec[].kind"],
    values: specKind.table,
    decidedHere: true,
  },
  {
    key: "motionEffect",
    kind: "renamedValue",
    old: ["spec[].values[].effect"],
    now: ["spec[].values[].effect"],
    values: motionEffect.table,
    decidedHere: true,
  },
  {
    key: "columnStyle",
    kind: "renamedValue",
    old: ["spec[].columns[].as"],
    now: ["spec[].columns[].as"],
    values: columnStyle.table,
    decidedHere: true,
  },
  {
    key: "cellTone",
    kind: "renamedValue",
    old: ["spec[].rows[][].tone"],
    now: ["spec[].rows[][].tone"],
    values: toneValues,
    decidedHere: true,
  },
] as const satisfies readonly FormatChange[];

/** 对照表里的一条，key 是具体的键。 */
export type FormatChangeEntry = (typeof formatChanges)[number];
export type FormatChangeKey = FormatChangeEntry["key"];

/**
 * Zod 问题里的路径写成对照表的写法：数组的下标换成 []。
 * 例如 ["asks", 0, "options", 1, "see"] 得到 asks[].options[].see。
 */
export function fieldPath(path: readonly PropertyKey[]): string {
  let text = "";
  for (const part of path) {
    if (typeof part === "number") text += "[]";
    else text += text === "" ? String(part) : `.${String(part)}`;
  }
  return text;
}

const changeByOldPath: ReadonlyMap<string, FormatChangeEntry> = new Map(
  formatChanges.flatMap((change: FormatChangeEntry) =>
    (change.old as readonly string[])
      .filter((path) => !path.includes("="))
      .map((path) => [path, change] as const),
  ),
);

/** 按旧字段的路径找对照表里的一条，例如 asks[].queueRow。找不到时返回 undefined。 */
export function formatChangeAt(path: string): FormatChangeEntry | undefined {
  return changeByOldPath.get(path);
}

/**
 * 按旧字段的路径和旧的取值找对照表里的一条：带 =值 的路径，或者 values 里有这个取值的一条。
 * 例如 asks[].evidence[].type 取 excerpt 找到 excerptEvidence，取 image 找到 evidenceType。
 */
export function formatChangeOfValue(path: string, value: unknown): FormatChangeEntry | undefined {
  if (typeof value !== "string") return undefined;
  return formatChanges.find((change: FormatChangeEntry) => {
    const { old, values }: FormatChange = change;
    if (old.includes(`${path}=${value}`)) return true;
    return values !== undefined && Object.hasOwn(values, value) && old.includes(path);
  });
}

/** 旧的取值换成什么，只看 renamedValue 的 values。 */
export function renamedValue(change: FormatChange, value: string): string | undefined {
  const { values } = change;
  return values !== undefined && Object.hasOwn(values, value) ? values[value] : undefined;
}
