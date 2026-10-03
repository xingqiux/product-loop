import type { Card } from "../page/card.ts";
import type { EvidenceItem } from "../page/evidence.ts";
import type { PageSections } from "../page/sections.ts";
import { type Rule, sinceRelease, startDay } from "./rule.ts";
import { type RuleIssue, type RuleRun, type RunOptions, runRules, whereText } from "./run.ts";
import { type WritingContext, type WritingSubject, writingRuleList } from "./writing.ts";

// 页面文字的写作校验，见「07 校验」第五节和第一期计划第 27 步。
// 写作校验的每一项已经登记成一条规则，查一段文字，见 writing.ts。这里把页面数据里 AI 写、
// 用户看得见的每一段文字取出来，逐段交给这些规则，位置写到字段的路径。
// 报出的规矩编号就是写作规则的编号，例如 writing.sentence.tooLong，级别和起始日期也照写作规则。
// 不另写一条页面规则：一条规则只有一个级别和一个起始日期，写作校验的各项各不相同。
//
// 取哪些文字，照旧 build-report.py 的 check_writing 和 wording_notes，另按第五节改了几处：
// - 标了 quote: true 的来源整条不查，照旧 walk_prose。旧的措辞提醒还查它们，现在不查。
// - 设计规范区块不查，它要展示反例。旧的措辞提醒还查它，现在不查。
// - 线稿和中保真线稿是 HTML，旧脚本不查。现在取出其中的文字，只查停用的说法，不查句长。
// - 真组件的 HTML 和样式、改前改后的原文、调研、图表的定义不查，照旧 SKIP_KEYS。
// - 参考和图表的标题旧脚本不查。它们也是 AI 写、用户看得见的文字，现在照常查。
// 旧脚本不查、现在才查的文字，起始写 2.0.0。历史页面模式按页面的日期跳过它们，旧页面不会因此被拦。

type Path = readonly (string | number)[];
type Diagram = NonNullable<Card["diagrams"]>[number];

/** 页面上要查写作校验的一段文字。 */
export type PageText = {
  /** 在页面数据里的位置，例如 ["asks", 0, "why"]。 */
  readonly where: Path;
  /** 要查的文字。线稿是从 HTML 里取出的文字。 */
  readonly text: string;
  /** prose 按普通的文字查。html 是线稿，只查停用的说法。 */
  readonly form: "prose" | "html";
  /** 旧的构建校验不查、2.0.0 起才查的文字写 2.0.0。旧的也查的不写，各项照写作规则的起始日期。 */
  readonly since?: string;
};

/** 有卡片的三个区块，按页面上的顺序，对应旧脚本的 CARD_BLOCKS。回到构思已经并进疑问。 */
const cardBlocks = ["asks", "findings", "improvements"] as const;

/** 依次记下取出的文字。没写的字段跳过。 */
class TextList {
  readonly texts: PageText[] = [];

  prose(where: Path, text: string | undefined): void {
    if (text !== undefined) this.texts.push({ where, text, form: "prose" });
  }

  /** 旧的构建校验不查的文字。 */
  fresh(where: Path, text: string | undefined): void {
    if (text !== undefined) this.texts.push({ where, text, form: "prose", since: sinceRelease });
  }

  /** 线稿：取出 HTML 里的文字。旧的构建校验不查线稿。 */
  html(where: Path, html: string | undefined): void {
    if (html !== undefined) {
      this.texts.push({ where, text: htmlText(html), form: "html", since: sinceRelease });
    }
  }

  /** 图表只查标题，定义是图表库的写法。 */
  diagrams(where: Path, diagrams: readonly Diagram[] | undefined): void {
    for (const [i, diagram] of (diagrams ?? []).entries()) {
      this.fresh([...where, i, "title"], diagram.title);
    }
  }
}

/** 页面数据里要查写作校验的全部文字，按区块在页面上的顺序，同一项里按字段在定义里的顺序。 */
export function pageTexts(page: PageSections): PageText[] {
  const list = new TextList();
  page.align?.forEach((term, i) => {
    list.prose(["align", i, "name"], term.name);
    list.prose(["align", i, "meaning"], term.meaning);
    list.prose(["align", i, "example"], term.example);
    list.fresh(["align", i, "diagram", "title"], term.diagram?.title);
  });
  page.scenes?.forEach((scene, i) => {
    list.prose(["scenes", i, "name"], scene.name);
    list.prose(["scenes", i, "who"], scene.who);
    list.prose(["scenes", i, "mark"], scene.mark);
    scene.steps.forEach((step, j) => {
      list.prose(["scenes", i, "steps", j, "do"], step.do);
      list.prose(["scenes", i, "steps", j, "expect"], step.expect);
    });
  });
  for (const section of cardBlocks) {
    const cards: readonly Card[] = page[section] ?? [];
    for (const [i, card] of cards.entries()) cardTexts(list, [section, i], card);
  }
  page.changes?.forEach((change, i) => {
    const at = ["changes", i] as const;
    list.prose([...at, "title"], change.title);
    list.prose([...at, "problem"], change.problem);
    list.prose([...at, "fix"], change.fix);
    list.prose([...at, "before", "caption"], change.before?.caption);
    list.prose([...at, "after", "caption"], change.after?.caption);
    for (const [j, figure] of (change.more ?? []).entries()) {
      list.prose([...at, "more", j, "caption"], figure.caption);
    }
    list.prose([...at, "textName"], change.textName);
  });
  page.refs?.forEach((ref, i) => {
    list.fresh(["refs", i, "name"], ref.name);
    list.fresh(["refs", i, "body"], ref.body);
    list.fresh(["refs", i, "where"], ref.where);
  });
  page.screens?.forEach((screen, i) => {
    list.prose(["screens", i, "name"], screen.name);
    screen.elements.forEach((element, j) => {
      list.prose(["screens", i, "elements", j, "what"], element.what);
      list.prose(["screens", i, "elements", j, "answers"], element.answers);
    });
  });
  return list.texts;
}

/** 一张卡上的文字。原话的来源整条跳过，线稿只取文字。 */
function cardTexts(list: TextList, at: Path, card: Card): void {
  list.prose([...at, "title"], card.title);
  list.prose([...at, "tag"], card.tag);
  list.prose([...at, "why"], card.why);
  card.sources.forEach((source, i) => {
    if (source.quote) return;
    list.prose([...at, "sources", i, "name"], source.name);
    list.prose([...at, "sources", i, "saw"], source.saw);
  });
  card.options?.forEach((option, i) => {
    const place = [...at, "options", i];
    list.prose([...place, "title"], option.title);
    for (const [j, diff] of option.diffs.entries()) list.prose([...place, "diffs", j], diff);
    list.prose([...place, "why"], option.why);
    list.prose([...place, "cost"], option.cost);
    list.prose([...place, "when"], option.when);
    list.html([...place, "sketch"], option.sketch);
  });
  for (const [i, row] of (card.rows ?? []).entries()) list.prose([...at, "rows", i], row);
  if (card.shared !== undefined) {
    list.prose([...at, "shared", "text"], card.shared.text);
    list.diagrams([...at, "shared", "diagrams"], card.shared.diagrams);
  }
  card.dropped?.forEach((item, i) => {
    list.prose([...at, "dropped", i, "name"], item.name);
    list.prose([...at, "dropped", i, "because"], item.because);
  });
  list.prose([...at, "stance", "because"], card.stance?.because);
  for (const [i, item] of (card.evidence ?? []).entries()) {
    evidenceTexts(list, [...at, "evidence", i], item);
  }
  list.prose([...at, "image", "caption"], card.image?.caption);
  list.html([...at, "mock"], card.mock);
  list.prose([...at, "mockCaption"], card.mockCaption);
  for (const [i, step] of (card.flow ?? []).entries()) list.prose([...at, "flow", i], step);
  list.diagrams([...at, "diagrams"], card.diagrams);
}

/** 证据上显示成文字的部分。真组件的 HTML、样式和按钮切换的类名不查，只查按钮上的字。 */
function evidenceTexts(list: TextList, at: Path, item: EvidenceItem): void {
  switch (item.type) {
    case "sizes":
      list.prose([...at, "unit"], item.unit);
      break;
    case "swatches":
      for (const [i, value] of item.values.entries()) {
        list.prose([...at, "values", i, "name"], value.name);
      }
      break;
    case "type":
      for (const [i, value] of item.values.entries()) {
        list.prose([...at, "values", i, "sample"], value.sample);
      }
      break;
    case "live":
      for (const [i, toggle] of (item.toggles ?? []).entries()) {
        list.prose([...at, "toggles", i, "label"], toggle.label);
      }
      break;
    default:
      break;
  }
  list.prose([...at, "caption"], item.caption);
}

const htmlComment = /<!--[\s\S]*?(?:-->|$)/gu;
const rawElement = /<(script|style)\b(?:[^>"']|"[^"]*"|'[^']*')*>[\s\S]*?(?:<\/\1\s*>|$)/giu;
const htmlTag = /<\/?[A-Za-z][^\s/>]*(?:[^>"']|"[^"]*"|'[^']*')*>/gu;
const htmlEntity = /&(?:#([0-9]+)|#[xX]([0-9A-Fa-f]+)|([A-Za-z]+));/gu;
const namedEntities: ReadonlyMap<string, string> = new Map([
  ["amp", "&"],
  ["lt", "<"],
  ["gt", ">"],
  ["quot", '"'],
  ["apos", "'"],
  ["nbsp", " "],
]);

/**
 * 线稿里用户看得见的文字。注释、脚本和样式去掉，每个标签换成一个换行，
 * 两段文字不会连成一个说法。属性里的字不算。字符引用换成字，认不出的照原样留着。
 */
function htmlText(html: string): string {
  return html
    .replace(htmlComment, "\n")
    .replace(rawElement, "\n")
    .replace(htmlTag, "\n")
    .replace(htmlEntity, (whole: string, dec?: string, hex?: string, name?: string) => {
      if (name !== undefined) return namedEntities.get(name) ?? whole;
      const code = dec === undefined ? Number.parseInt(hex ?? "", 16) : Number.parseInt(dec, 10);
      const valid = code > 0 && code <= 0x10ffff && (code < 0xd800 || code > 0xdfff);
      return valid ? String.fromCodePoint(code) : whole;
    });
}

type WritingRule = Rule<WritingSubject, WritingContext>;

/** 普通的文字查写作规则里查文字的每一项，会话回复另查的四项不查。 */
const proseRules: readonly WritingRule[] = writingRuleList.filter((rule) =>
  rule.scope.subjects.includes("text"),
);

/** 线稿只查停用的说法：写在引号外面的拦截，只在引号里的警告。 */
const htmlRuleIds: ReadonlySet<string> = new Set(["writing.term.banned", "writing.term.quoted"]);
const htmlRules: readonly WritingRule[] = proseRules.filter((rule) => htmlRuleIds.has(rule.id));

/** 这段文字在这一次执行里查不查。旧的构建校验不查的文字，历史页面模式按页面的日期决定。 */
function checked(piece: PageText, options: RunOptions): boolean {
  if (piece.since === undefined || options.mode === "current") return true;
  const start = startDay(piece.since);
  // 和规则的起始日期同一个判法：同一天生成的页面不查。
  return start !== undefined && start < options.pageDate;
}

/**
 * 对页面文字跑写作校验，收齐全部命中，每条报错写明在哪个字段。context 是主线的写作规范。
 * 顺序按文字在页面上的顺序，同一段文字按写作规则的顺序。执行的方式和 runRules 相同。
 */
export function runPageWriting(
  page: PageSections,
  context: WritingContext,
  options: RunOptions = { mode: "current" },
): RuleRun {
  const block: RuleIssue[] = [];
  const warn: RuleIssue[] = [];
  const skipped = new Set<string>();
  for (const piece of pageTexts(page)) {
    if (!checked(piece, options)) continue;
    const rules = piece.form === "html" ? htmlRules : proseRules;
    const subject: WritingSubject = { kind: "text", text: piece.text };
    const run = runRules(rules, subject, context, options);
    const where = whereText(piece.where);
    block.push(...run.block.map((issue) => ({ ...issue, where })));
    warn.push(...run.warn.map((issue) => ({ ...issue, where })));
    for (const id of run.skipped) skipped.add(id);
  }
  return { block, warn, skipped: [...skipped] };
}
