import { formatQueueId, formatSceneId } from "../ids.ts";
import { assignSceneIds } from "../mainline/assign.ts";
import { parseMainline } from "../mainline/parse.ts";
import { type FormatChange, formatChanges } from "../page/legacy-format.ts";
import {
  type LegacyConversion,
  type LegacyQueueEntry,
  type LegacySceneEntry,
  legacyPathText,
} from "./convert-page.ts";

// 转换的测试共用的几样：按旧文件给出上下文，查有没有悄悄丢掉的字，把结果写成表格的一行。

/** 旧 队列.json 用中文键。Biome 只收 ASCII 的标识符，所以用常量表读，见第一期计划第三节。 */
const queueKeys = { items: "事项", content: "内容" } as const;

/**
 * 旧 队列.json 里每件事的内容和编号。编号按先后从 Q1 起。
 * 体检导入 队列.json 时也这样做：已经是十格，只补编号（「08 版本与迁移」第五节）。
 * 不是完整的队列数据时没有事项。
 */
export function queueEntriesOf(doc: unknown): LegacyQueueEntry[] {
  if (typeof doc !== "object" || doc === null) return [];
  const items: unknown = (doc as Readonly<Record<string, unknown>>)[queueKeys.items];
  if (!Array.isArray(items)) return [];
  return items.flatMap((item: unknown, i) => {
    if (typeof item !== "object" || item === null) return [];
    const text: unknown = (item as Readonly<Record<string, unknown>>)[queueKeys.content];
    return typeof text === "string" ? [{ text, id: formatQueueId(i + 1) }] : [];
  });
}

/** 主线里的场景名和场景编号。没写编号的场景先补上编号，和体检迁移旧主线时一样。 */
export function sceneEntriesOf(mainline: string): LegacySceneEntry[] {
  return parseMainline(assignSceneIds(mainline).text).scenes.flatMap((scene) =>
    scene.id === undefined ? [] : [{ name: scene.name, id: formatSceneId(scene.id) }],
  );
}

/** 一个值里的每一段文字和它的位置。 */
function textsOf(value: unknown, path: readonly (string | number)[] = []): [string, string][] {
  if (typeof value === "string") return [[value, legacyPathText(path)]];
  if (Array.isArray(value)) return value.flatMap((item, i) => textsOf(item, [...path, i]));
  if (typeof value === "object" && value !== null) {
    return Object.entries(value).flatMap(([key, item]) => textsOf(item, [...path, key]));
  }
  return [];
}

/** 取值换了写法的字段：字段名和旧的取值，例如 type 的 image。换成中文以后不算丢掉。 */
const renamedValues: ReadonlyMap<string, readonly string[]> = new Map(
  (formatChanges as readonly FormatChange[]).flatMap((change) => {
    const [path] = change.old;
    if (change.values === undefined || path === undefined) return [];
    return [[path.slice(path.lastIndexOf(".") + 1), Object.keys(change.values)] as const];
  }),
);

/**
 * 旧页面上有、转换以后却哪里都找不到的字：不在新页面数据里，也不在备注记下的原来的值里。
 * 按出现的次数数，同一句话出现两次就要找到两次。
 * 阶段另有去处，换成中文的取值不算丢掉，这两样不算在内。
 */
export function lostTexts(old: unknown, conversion: LegacyConversion): string[] {
  const found = new Map<string, number>();
  const keep = (text: string) => found.set(text, (found.get(text) ?? 0) + 1);
  for (const [text] of textsOf(conversion.page)) keep(text);
  for (const note of conversion.notes) for (const [text] of textsOf(note.old)) keep(text);
  if (conversion.date !== undefined) keep(conversion.date);
  return textsOf(old).flatMap(([text, where]) => {
    const field =
      where
        .replace(/\[\d+\]/gu, "")
        .split(".")
        .at(-1) ?? "";
    if (where === "stage" || renamedValues.get(field)?.includes(text)) return [];
    const count = found.get(text) ?? 0;
    if (count === 0) return [`${where}：${text}`];
    found.set(text, count - 1);
    return [];
  });
}

/** 旧构建校验的三种判定写成中文。 */
const verdictText: Readonly<Record<string, string>> = { block: "拦截", warn: "警告", pass: "通过" };

export function verdictLabel(verdict: string): string {
  return verdictText[verdict] ?? verdict;
}

/** 转换以后还要改的地方，写成「查的是哪一项 位置」，没有时写「通过」。 */
export function problemsText(conversion: LegacyConversion): string {
  const { problems } = conversion;
  if (problems.length === 0) return "通过";
  return problems.map((p) => `${p.check} ${legacyPathText(p.path)}`).join("<br>");
}

/** 备注按依据数一数，写成「emptyValues×4 header」。 */
export function notesText(conversion: LegacyConversion): string {
  const counts = new Map<string, number>();
  for (const { change } of conversion.notes) counts.set(change, (counts.get(change) ?? 0) + 1);
  return [...counts]
    .map(([change, count]) => (count === 1 ? change : `${change}×${count}`))
    .join(" ");
}
