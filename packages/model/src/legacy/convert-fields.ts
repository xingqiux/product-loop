import { type CopyEntry, renderCopy } from "../copy/define.ts";
import { legacyPageCopy } from "../copy/legacy-convert.ts";
import { pageCopy } from "../copy/page.ts";
import { normalizeTitle } from "../page/card-id.ts";
import type { PageIssue } from "../page/check-page.ts";
import { textPattern } from "../page/fields.ts";
import type { IssueCopy, IssueValues } from "../page/issue.ts";
import {
  type FormatChange,
  type FormatChangeKey,
  fieldPath,
  formatChangeAt,
  formatChanges,
  renamedValue,
} from "../page/legacy-format.ts";

// 旧页面数据按新旧格式的对照表逐个字段转换，见 page/legacy-format.ts。
// 对照表里的每一条按种类处理。
// - 改名的换成新的名字。取值换了写法的换成中文，只写成数组的对象放进数组。
// - 已废除和改由命令填的删掉，原来的值写进备注。queueRow 按队列迁移对照换成编号。
// - 空字符串、空数组、null 删掉，只写 true 的标记写成 false 的也删掉，都写进备注。
// 不在对照表里的字段原样留下，由新的定义报出来。
// 卡片、位置、来源这几处要看同一层的别的字段，另见 convert-card.ts。

/** 页面数据里的一个位置，写法和问题的 path 相同，例如 ["asks", 0, "where"]。 */
export type LegacyPath = readonly (string | number)[];

/** 转换自己定的改法，新旧格式的对照表里没有，见文案表的 legacyPage.change。 */
export type LegacyChangeKey = keyof typeof legacyPageCopy.change;

/**
 * 转换时删掉或挪动的一处。
 * 旧页面上给人看的字，转换以后不在新页面数据里的，都写进备注。
 * 迁移时由 AI 核对，见「08 版本与迁移」第四节。
 * 只换了名字或只换了取值写法的地方不写备注。字还在，对照表写明了怎么换。
 */
export type LegacyNote = {
  /** 旧页面数据里的位置。 */
  readonly path: LegacyPath;
  /** 依据：新旧格式对照表里的一条，或者转换自己定的一种改法。 */
  readonly change: FormatChangeKey | LegacyChangeKey;
  /** 原来的值。 */
  readonly old: unknown;
  /** 转换以后在新页面数据里的位置。删掉、没有去处的没有这一项。 */
  readonly now?: LegacyPath;
};

/** 旧队列里的一件事和迁移时给它的编号，由体检写的队列迁移对照给出。 */
export type LegacyQueueEntry = {
  /** 这件事的内容，queueRow 按它匹配。 */
  readonly text: string;
  /** 队列事项的编号，例如 Q12。 */
  readonly id: string;
};

/** 旧页面里写的场景名和它在主线里的场景编号。同一个场景写过几种名字的，每种写一条。 */
export type LegacySceneEntry = {
  readonly name: string;
  /** 场景编号，例如 S3。 */
  readonly id: string;
};

/** 旧主线给场景排的序号和它现在的场景编号。旧页面的位置只写了序号时用它。 */
export type LegacySceneNumber = {
  readonly number: number;
  readonly id: string;
};

/** 转换一页要的上下文，由迁移按这个项目的队列和主线给出。 */
export type LegacyPageContext = {
  readonly queue: readonly LegacyQueueEntry[];
  readonly scenes: readonly LegacySceneEntry[];
  /** 旧主线按序号编场景时才有。不给时，只写了序号的位置报成问题。 */
  readonly sceneNumbers?: readonly LegacySceneNumber[];
};

/** 转换一页时的状态：查引用的表，以及记下的备注和问题。 */
export type ConvertState = {
  readonly queue: readonly LegacyQueueEntry[];
  readonly sceneByName: ReadonlyMap<string, readonly string[]>;
  readonly sceneByNumber: ReadonlyMap<number, readonly string[]>;
  readonly notes: LegacyNote[];
  readonly problems: PageIssue[];
};

/** 一个字段在旧页面数据和新页面数据里的位置。回到构思的卡挪进疑问，两个位置不同。 */
export type At = {
  readonly old: LegacyPath;
  /** 按它查对照表：回到构思的卡按疑问卡查。 */
  readonly now: LegacyPath;
};

export type JsonObject = Record<string, unknown>;

export function isRecord(value: unknown): value is Readonly<JsonObject> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 下一层的位置。换了名字的字段，新页面里用新的名字。 */
export function child(at: At, key: string | number, now: string | number = key): At {
  return { old: [...at.old, key], now: [...at.now, now] };
}

export function createState(context: LegacyPageContext): ConvertState {
  return {
    queue: context.queue,
    sceneByName: groupIds(context.scenes.map((entry) => [normalizeTitle(entry.name), entry.id])),
    sceneByNumber: groupIds((context.sceneNumbers ?? []).map((entry) => [entry.number, entry.id])),
    notes: [],
    problems: [],
  };
}

function groupIds<K>(pairs: readonly (readonly [K, string])[]): ReadonlyMap<K, readonly string[]> {
  const map = new Map<K, string[]>();
  for (const [key, id] of pairs) {
    const ids = map.get(key) ?? [];
    if (!ids.includes(id)) ids.push(id);
    map.set(key, ids);
  }
  return map;
}

export function addNote(
  s: ConvertState,
  path: LegacyPath,
  change: LegacyNote["change"],
  old: unknown,
  now?: LegacyPath,
): void {
  s.notes.push(now === undefined ? { path, change, old } : { path, change, old, now });
}

/** 一个要改的地方。path 是新页面数据里的位置，check 是文案表里这条报错的键。 */
export function problemOf<C extends IssueCopy>(
  path: LegacyPath,
  check: string,
  entry: C,
  values: IssueValues<C>,
): PageIssue {
  const message: CopyEntry = entry.message;
  const hint: CopyEntry = entry.hint;
  return {
    path: [...path],
    check,
    message: renderCopy(message, values),
    hint: renderCopy(hint, values),
  };
}

/** 记下一个转换以后还要改的地方。 */
export function addProblem<C extends IssueCopy>(
  s: ConvertState,
  path: LegacyPath,
  check: string,
  entry: C,
  values: IssueValues<C>,
): void {
  s.problems.push(problemOf(path, check, entry, values));
}

/** 一个值在报错里怎么称呼它的类型：文字、数字、数组、对象，别的照写。 */
export function kindText(value: unknown): string {
  const { phrase } = pageCopy;
  if (typeof value === "string") return renderCopy(phrase.text);
  if (typeof value === "number") return renderCopy(phrase.number);
  if (Array.isArray(value)) return renderCopy(phrase.array);
  if (isRecord(value)) return renderCopy(phrase.object);
  return String(value);
}

/** 空的值：null、没有字的文字、空数组。可以不写的字段，没有内容就不写（对照表的 emptyValues）。 */
export function isEmpty(value: unknown): boolean {
  if (value === null) return true;
  if (typeof value === "string") return !textPattern.test(value);
  return Array.isArray(value) && value.length === 0;
}

function changeOf(key: FormatChangeKey): FormatChange {
  const change = formatChanges.find((entry) => entry.key === key);
  if (change === undefined) throw new Error(`对照表里没有 ${key}`);
  return change;
}

/** 只写 true 的标记在哪几处，对照表的 trueFlags 写成 asks[].only=false 这样。 */
const flagPaths: ReadonlySet<string> = new Set(
  changeOf("trueFlags").old.map((path) => path.replace(/=false$/u, "")),
);

/** 整个删掉的字段：已废除和改由命令填的，queueRow 除外，它换成队列事项的编号。 */
function dropped(change: FormatChange): boolean {
  return (
    (change.kind === "abolished" || change.kind === "commandFilled") && change.key !== "queueRow"
  );
}

/** 改了名的字段的新名字：对照表里旧路径和新路径按先后一一对应，取新路径的最后一段。 */
function renamedKey(change: FormatChange, path: string): string | undefined {
  const target = change.now[change.old.indexOf(path)];
  return target?.slice(target.lastIndexOf(".") + 1);
}

/**
 * 一个字段交给别的函数转换。value 不是空的值。
 * 函数把结果写进 out，不写就是删掉，删掉的要自己写备注。
 */
export type FieldHook = (value: unknown, at: At, out: JsonObject) => void;

/** 按对照表转换任意一个值：对象逐个字段转，数组逐项转，别的原样。 */
export function convertValue(value: unknown, at: At, s: ConvertState): unknown {
  if (Array.isArray(value)) return value.map((item, i) => convertValue(item, child(at, i), s));
  if (isRecord(value)) return convertFields(value, at, s);
  return value;
}

/**
 * 按对照表逐个字段转换一个对象，字段的先后不变。hooks 里有的字段交给它转换。
 * 返回新的对象，不改原来的。
 */
export function convertFields(
  input: Readonly<JsonObject>,
  at: At,
  s: ConvertState,
  hooks: Readonly<Record<string, FieldHook>> = {},
): JsonObject {
  const out: JsonObject = {};
  for (const [key, value] of Object.entries(input)) {
    const here = child(at, key);
    const path = fieldPath(here.now);
    const change: FormatChange | undefined = formatChangeAt(path);
    const hook = Object.hasOwn(hooks, key) ? hooks[key] : undefined;
    // 已废除和改由命令填的字段整个删掉，空的也按对照表里的这一条记。
    if (hook === undefined && change !== undefined && dropped(change)) {
      addNote(s, here.old, change.key as FormatChangeKey, value);
      continue;
    }
    if (isEmpty(value)) {
      addNote(s, here.old, "emptyValues", value);
      continue;
    }
    if (value === false && flagPaths.has(path)) {
      addNote(s, here.old, "trueFlags", value);
      continue;
    }
    if (hook !== undefined) {
      hook(value, here, out);
      continue;
    }
    switch (change?.kind) {
      case "renamed": {
        const name = renamedKey(change, path) ?? key;
        // 新旧两个名字都写了：新的为准，旧的删掉。
        if (Object.hasOwn(input, name)) addNote(s, here.old, change.key as FormatChangeKey, value);
        else out[name] = convertValue(value, child(at, key, name), s);
        break;
      }
      case "renamedValue":
        out[key] =
          typeof value === "string"
            ? (renamedValue(change, value) ?? value)
            : convertValue(value, here, s);
        break;
      case "reshaped":
        out[key] = convertValue(isRecord(value) ? [value] : value, here, s);
        break;
      case "abolished":
        // 走到这里的只有 queueRow，别的已废除的字段在上面删掉了。
        convertQueueRow(value, here, out, s);
        break;
      default:
        if (key === "queue" && Array.isArray(out.queue) && Array.isArray(value)) {
          out.queue = unique([...out.queue, ...value]);
        } else {
          out[key] = convertValue(value, here, s);
        }
    }
  }
  return out;
}

function unique<T>(items: readonly T[]): T[] {
  return items.filter((item, i) => items.indexOf(item) === i);
}

// ---- 队列：queueRow 按内容匹配队列里的一件，换成编号，见「07 校验」第二节

/**
 * 旧构建校验的匹配办法：先找内容完全相同的，没有再找内容以它开头的。
 * 按开头匹配时至少要六个字，短的只认完全相同的。
 */
const prefixMinLength = 6;

type QueueMatch = { readonly ids: readonly string[] };

function matchQueueRow(text: string, queue: readonly LegacyQueueEntry[]): QueueMatch {
  const wanted = text.trim();
  const exact = queue.filter((entry) => entry.text.trim() === wanted);
  const prefix =
    exact.length > 0 || [...wanted].length < prefixMinLength
      ? []
      : queue.filter((entry) => entry.text.trim().startsWith(wanted));
  return { ids: unique([...exact, ...prefix].map((entry) => entry.id)) };
}

/** queueRow 换成 queue 里的编号，写在 queueRow 原来的位置。对不上的报成问题，原文写进备注。 */
function convertQueueRow(value: unknown, at: At, out: JsonObject, s: ConvertState): void {
  const parent = at.now.slice(0, -1);
  const queuePath = [...parent, "queue"];
  const rows: readonly (readonly [unknown, LegacyPath])[] =
    typeof value === "string"
      ? [[value, at.old]]
      : Array.isArray(value)
        ? value.map((row, i) => [row, [...at.old, i]] as const)
        : [[value, at.old]];
  for (const [row, old] of rows) {
    if (typeof row !== "string") {
      const { shape } = legacyPageCopy.queueRow;
      addProblem(s, queuePath, "legacyPage.queueRow.shape", shape, { received: kindText(row) });
      addNote(s, old, "queueRow", row);
      continue;
    }
    if (isEmpty(row)) {
      addNote(s, old, "emptyValues", row);
      continue;
    }
    const { ids } = matchQueueRow(row, s.queue);
    const [id] = ids;
    if (id !== undefined && ids.length === 1) {
      const queue = Array.isArray(out.queue) ? out.queue : [];
      if (!queue.includes(id)) queue.push(id);
      out.queue = queue;
      addNote(s, old, "queueRow", row, [...queuePath, queue.indexOf(id)]);
      continue;
    }
    const text = row.trim();
    if (ids.length > 1) {
      const { ambiguous } = legacyPageCopy.queueRow;
      const values = { text, ids: ids.join("、") };
      addProblem(s, queuePath, "legacyPage.queueRow.ambiguous", ambiguous, values);
    } else {
      const { unknown } = legacyPageCopy.queueRow;
      addProblem(s, queuePath, "legacyPage.queueRow.unknown", unknown, { text });
    }
    addNote(s, old, "queueRow", row);
  }
}

// ---- 场景：旧页面写场景名，新页面写场景编号，按迁移给的场景对照查

/** 按场景名查场景编号。对不上或对上几个时返回 undefined。 */
export function sceneIdByName(name: string, s: ConvertState): string | undefined {
  const ids = s.sceneByName.get(normalizeTitle(name)) ?? [];
  return ids.length === 1 ? ids[0] : undefined;
}

/** 按旧主线的场景序号查场景编号。对不上或对上几个时返回 undefined。 */
export function sceneIdByNumber(number: number, s: ConvertState): string | undefined {
  const ids = s.sceneByNumber.get(number) ?? [];
  return ids.length === 1 ? ids[0] : undefined;
}
