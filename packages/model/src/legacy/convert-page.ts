import { renderCopy } from "../copy/define.ts";
import { legacyPageCopy } from "../copy/legacy-convert.ts";
import { formatChangeCopy } from "../copy/page.ts";
import { renamedStages, type Stage, stage } from "../names.ts";
import { checkPageData, type PageIssue } from "../page/check-page.ts";
import { pageSection } from "../page/section-names.ts";
import { sectionAllowed } from "../page/stages.ts";
import { err, ok, type Result } from "../result.ts";
import { convertCard, convertScene, type MoveToAsk } from "./convert-card.ts";
import {
  type At,
  addNote,
  type ConvertState,
  child,
  convertFields,
  createState,
  type FieldHook,
  isEmpty,
  isRecord,
  type JsonObject,
  kindText,
  type LegacyNote,
  type LegacyPageContext,
  type LegacyPath,
  problemOf,
} from "./convert-fields.ts";

// 旧页面数据转成新格式，见「08 版本与迁移」第五节和「07 校验」第六节第 2 步。
// 体检时，命令先用它把 walk/ 下的每一页转一遍，再按历史页面模式校验。
// 仍被拦截的，由 AI 在确认这一步按报错改正（第一期计划第 60 步）。
//
// 转换只做下面几种改法，不替用户补内容。
// - 按新旧格式的对照表改名、换取值的写法、删掉已废除和改由命令填的字段，见 convert-fields.ts。
// - 旧模板的显示方式写明了的几处，照着转换，见 convert-card.ts。
// - 队列和场景的引用按迁移给的对照换成编号，对不上的报成问题。
// - 回到构思的卡挪进疑问，标上「回到构思」（第一期约定第 8 条）。
// - 这一阶段不能写的发现问题和提升挪进疑问，标上原来区块的名字（决定 189）。
//   旧 skill 的落地页常带着这两块，新格式只在检查和提升各留一块。
// - 阶段「修复」换成落地。阶段、轮次和日期由命令填，从页面数据里拿出来，单独交给迁移。
// 旧页面上给人看的字，转换以后不在新页面数据里的，都写进备注，写明原来在哪里。
//
// 转换以后按新的定义校验一遍，报出的问题和转换时的问题放在一起。
// 历史页面模式跳过起始日期晚于这一页的规则，那是规则一层的事，由第 60 步接上。
// 定义一层没有起始日期，这里照常校验。

export type {
  LegacyChangeKey,
  LegacyNote,
  LegacyPageContext,
  LegacyPath,
  LegacyQueueEntry,
  LegacySceneEntry,
  LegacySceneNumber,
} from "./convert-fields.ts";

/** 转换好的一页。 */
export type LegacyConversion = {
  /** 这一页的阶段，「修复」已经换成落地。 */
  readonly stage: Stage;
  /** 转换以后的页面数据：只有 AI 写的区块，按页面上的顺序排，枚举写中文，和新写的页面相同。 */
  readonly page: Readonly<Record<string, unknown>>;
  /** 旧页面数据里的轮号。迁移时同一天的几轮按它排先后。没写或者写法不对时没有。 */
  readonly round?: number;
  /** 旧页面数据里的日期，写成 2026-09-20。迁移按它排轮次，历史页面模式按它跳过规则。 */
  readonly date?: string;
  /** 转换时删掉或挪动的地方，按转换的先后。 */
  readonly notes: readonly LegacyNote[];
  /**
   * 还要改的地方：先是转换时对不上的引用，再是按这一阶段的定义校验报的问题。
   * 同一处转换时已经报过的，校验报的不再重复。没有问题时，这一页可以直接导入。
   */
  readonly problems: readonly PageIssue[];
};

/** 旧页面数据里的日期写法。 */
const datePattern = /^\d{4}-\d{2}-\d{2}$/u;

/**
 * 把一页旧页面数据转成新格式。old 是 JSON 解析以后的值，不会被改动。
 * 不是对象、没写阶段或阶段不认识时转不了，返回原因。
 */
export function convertLegacyPage(
  old: unknown,
  context: LegacyPageContext,
): Result<LegacyConversion, PageIssue> {
  if (!isRecord(old)) {
    const { notObject } = legacyPageCopy.page;
    return err(problemOf([], "legacyPage.page.notObject", notObject, { received: kindText(old) }));
  }
  const key = stageOf(old.stage);
  if (!key.ok) return err(key.error);

  const s = createState(context);
  const asksCount = Array.isArray(old.asks) ? old.asks.length : 0;
  const movedCards: unknown[] = [];
  /** 挪进疑问的卡接在原有的疑问后面，按挪进来的先后排。 */
  const moveToAsks = (value: readonly unknown[], at: At, move: MoveToAsk) => {
    value.forEach((card, i) => {
      const now = ["asks", asksCount + movedCards.length];
      addNote(s, [...at.old, i], move.change, card, now);
      movedCards.push(convertCard(card, { old: [...at.old, i], now }, s, move));
    });
  };
  /** 疑问写坏了、不是数组时，挪进来的卡接不上。 */
  const asksBroken = Object.hasOwn(old, "asks") && !isEmpty(old.asks) && !Array.isArray(old.asks);
  let round: number | undefined;
  let date: string | undefined;
  const root: At = { old: [], now: [] };
  const cards: FieldHook = (value, at, out) => {
    const [name] = at.now;
    out[String(name)] = Array.isArray(value)
      ? value.map((card, i) => convertCard(card, child(at, i), s))
      : convertCard(value, at, s);
  };
  const converted = convertFields(old, root, s, {
    stage: () => undefined,
    round: (value, at) => {
      if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) round = value;
      else addNote(s, at.old, "roundFields", value);
    },
    date: (value, at) => {
      if (typeof value === "string" && datePattern.test(value)) date = value;
      else addNote(s, at.old, "roundFields", value);
    },
    asks: cards,
    findings: (value, at, out) => {
      if (sectionAllowed(key.value, "findings") || !Array.isArray(value) || asksBroken)
        cards(value, at, out);
      else moveToAsks(value, at, sectionMove("findings"));
    },
    improvements: (value, at, out) => {
      if (sectionAllowed(key.value, "improvements") || !Array.isArray(value) || asksBroken)
        cards(value, at, out);
      else moveToAsks(value, at, sectionMove("improvements"));
    },
    rethink: (value, at) => {
      // 疑问写坏了、不是数组时接不上，回到构思整个写进备注。
      if (!Array.isArray(value) || asksBroken) {
        addNote(s, at.old, "rethink", value);
        return;
      }
      moveToAsks(value, at, {
        tag: renderCopy(legacyPageCopy.value.rethinkTag),
        change: "rethinkAsk",
      });
    },
    scenes: (value, at, out) => {
      out.scenes = Array.isArray(value)
        ? value.map((scene, i) => convertScene(scene, child(at, i), s))
        : convertScene(value, at, s);
    },
  });
  const page = arrange(converted, movedCards);
  const problems = withIssues(s, key.value, page);
  return ok({
    stage: key.value,
    page,
    ...(round === undefined ? {} : { round }),
    ...(date === undefined ? {} : { date }),
    notes: s.notes,
    problems,
  });
}

/** 旧页面数据的阶段。「修复」换成落地。 */
function stageOf(value: unknown): Result<Stage, PageIssue> {
  if (typeof value !== "string" || isEmpty(value)) {
    const { missing } = legacyPageCopy.stage;
    return err(problemOf(["stage"], "legacyPage.stage.missing", missing, {}));
  }
  const label = renamedStages.get(value) ?? value;
  const key = stage.key(label);
  if (key !== undefined) return ok(key);
  const { unknown } = legacyPageCopy.stage;
  return err(problemOf(["stage"], "legacyPage.stage.unknown", unknown, { value }));
}

/** 发现问题或提升挪进疑问时，标签写原来区块的名字。 */
const sectionMove = (section: "findings" | "improvements"): MoveToAsk => ({
  tag: pageSection.label(section),
  change: "sectionAsk",
});

/**
 * 按页面上的顺序排区块，挪进疑问的卡接在疑问后面。不认识的字段排在最后，由定义报出来。
 */
function arrange(converted: Readonly<JsonObject>, movedCards: readonly unknown[]): JsonObject {
  const sections: JsonObject = { ...converted };
  if (movedCards.length > 0) {
    const asks = Array.isArray(sections.asks) ? sections.asks : [];
    sections.asks = [...asks, ...movedCards];
  }
  const page: JsonObject = {};
  for (const section of pageSection.keys) {
    if (Object.hasOwn(sections, section)) page[section] = sections[section];
  }
  for (const [name, value] of Object.entries(sections)) {
    if (!Object.hasOwn(page, name)) page[name] = value;
  }
  return page;
}

/** 转换时的问题，加上按这一阶段的定义校验报的问题。同一处已经报过的不再重复。 */
function withIssues(s: ConvertState, key: Stage, page: Readonly<JsonObject>): PageIssue[] {
  const checked = checkPageData(key, page);
  if (checked.ok) return s.problems;
  const reported = new Set(s.problems.map((problem) => JSON.stringify(problem.path)));
  const issues = checked.error.filter((found) => !reported.has(JSON.stringify(found.path)));
  return [...s.problems, ...issues];
}

// ---- 备注写成一句话，迁移时列给 AI 核对

/** 位置写成 asks[0].where.title 这样。 */
export function legacyPathText(path: LegacyPath): string {
  return path
    .map((part, i) => (typeof part === "number" ? `[${part}]` : i === 0 ? part : `.${part}`))
    .join("");
}

/** 一条备注的说法：删掉了哪里或挪到了哪里，再加上依据的那一条改法。原来的值不在句子里。 */
export function legacyNoteText(note: LegacyNote): string {
  const path = legacyPathText(note.path);
  const head =
    note.now === undefined
      ? renderCopy(legacyPageCopy.note.dropped, { path })
      : renderCopy(legacyPageCopy.note.moved, { path, now: legacyPathText(note.now) });
  const { change } = note;
  const reason = Object.hasOwn(legacyPageCopy.change, change)
    ? legacyPageCopy.change[change as keyof typeof legacyPageCopy.change].note
    : formatChangeCopy[change as keyof typeof formatChangeCopy].note;
  return `${head}${renderCopy(reason)}`;
}
