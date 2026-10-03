import { type CopyEntry, renderCopy } from "../copy/define.ts";
import { rulesCopy } from "../copy/rules.ts";
import { ruleLevel, stage } from "../names.ts";
import { pageSection } from "../page/section-names.ts";
import type { BackendRuleInfo } from "./backend.ts";
import type { PendingRule } from "./registry.ts";
import { type Rule, type RuleScope, sinceRelease } from "./rule.ts";

// docs/维护说明.md 里的规则表，由登记的规则生成，见「07 校验」第八节。后端的规则由 backend.ts 的说明生成。
// 表的前后各有一行注释。两行之间由程序生成，其余的由人写。
// 测试核对两行之间的内容和生成的结果逐字相同。改了规则以后，运行 pnpm --filter @product-loop/model rules-doc。

/** 程序生成的部分从这一行后面开始。 */
export const tablesStart =
  "<!-- 下面的三张表由程序生成，不要手改。改了规则以后运行 pnpm --filter @product-loop/model rules-doc -->";
/** 程序生成的部分到这一行前面为止。 */
export const tablesEnd = "<!-- 程序生成的表到这里为止 -->";

const text = (entry: CopyEntry) => renderCopy(entry);
const code = (name: string) => `\`${name}\``;
const cell = (s: string) => s.replaceAll("|", "\\|").replaceAll("\n", " ");
const row = (cells: readonly string[]) => `| ${cells.map(cell).join(" | ")} |`;
const divider = (count: number) => row(Array.from({ length: count }, () => "---"));

/** 查哪里：查的数据，查页面数据的哪几个区块，只在哪几个阶段。 */
function scopeText(scope: RuleScope): string {
  const subjects = scope.subjects.map((key) => text(rulesCopy.subject[key])).join("、");
  const sections =
    scope.sections === undefined
      ? ""
      : `的${scope.sections.map((key) => pageSection.label(key)).join("、")}`;
  const stages =
    scope.stages === undefined
      ? ""
      : `，只在${scope.stages.map((key) => stage.label(key)).join("、")}`;
  return `${subjects}${sections}${stages}`;
}

/** 共用定义和后端的规则都有的几列：编号、级别、查什么、查哪里、命令、起始、上下文、依据。 */
type RuleColumns = Pick<Rule, "id" | "level" | "about" | "scope" | "since" | "needs">;

function ruleCells(rule: RuleColumns): string[] {
  return [
    code(rule.id),
    ruleLevel.label(rule.level),
    text(rule.about.summary),
    scopeText(rule.scope),
    rule.scope.commands.map(code).join("、"),
    rule.since === sinceRelease ? text(rulesCopy.sinceRelease) : rule.since,
    rule.needs.length === 0
      ? "无"
      : rule.needs.map((name) => text(rulesCopy.context[name])).join("、"),
    text(rule.about.basis),
  ];
}

function ruleRow(rule: Rule): string {
  return row(ruleCells(rule));
}

function backendRow(rule: BackendRuleInfo): string {
  return row([...ruleCells(rule), rule.location]);
}

function pendingRow(rule: PendingRule): string {
  return row([code(rule.id), rule.designId === undefined ? "" : code(rule.designId), rule.now]);
}

/**
 * 两行注释之间的内容，共三张表：共用定义里登记的规则、登记在后端的规则，
 * 以及已定编号、还没写成规则的检查。
 */
export function renderRuleTables(
  rules: readonly Rule[],
  backend: readonly BackendRuleInfo[],
  pending: readonly PendingRule[],
): string {
  const ruleHeader = [
    "编号",
    "级别",
    "查什么",
    "查哪里",
    "在哪几条命令里执行",
    "起始",
    "上下文",
    "依据",
  ];
  const backendHeader = [...ruleHeader, "检查在哪里"];
  const pendingHeader = ["编号", "设计文档里的写法", "现在在哪里"];
  return [
    "### 已登记的规则",
    "",
    row(ruleHeader),
    divider(ruleHeader.length),
    ...rules.map(ruleRow),
    "",
    "### 登记在后端的规则",
    "",
    row(backendHeader),
    divider(backendHeader.length),
    ...backend.map(backendRow),
    "",
    "### 已定编号、还没写成规则的检查",
    "",
    row(pendingHeader),
    divider(pendingHeader.length),
    ...pending.map(pendingRow),
  ].join("\n");
}

/** 两行注释在文件里的位置。找不到、次序不对或者出现不止一次时返回 undefined。 */
function tablesAt(doc: string): { readonly from: number; readonly to: number } | undefined {
  const lines = doc.split("\n");
  const from = lines.indexOf(tablesStart);
  const to = lines.indexOf(tablesEnd);
  const once = lines.lastIndexOf(tablesStart) === from && lines.lastIndexOf(tablesEnd) === to;
  return from === -1 || to <= from || !once ? undefined : { from, to };
}

/** 文件里两行注释之间的内容，去掉首尾的空行。找不到两行注释时返回 undefined。 */
export function ruleTablesIn(doc: string): string | undefined {
  const at = tablesAt(doc);
  if (at === undefined) return undefined;
  return doc
    .split("\n")
    .slice(at.from + 1, at.to)
    .join("\n")
    .trim();
}

/** 把两行注释之间换成新生成的表，前后各空一行，其余不动。找不到两行注释时返回 undefined。 */
export function withRuleTables(doc: string, tables: string): string | undefined {
  const at = tablesAt(doc);
  if (at === undefined) return undefined;
  const lines = doc.split("\n");
  return [...lines.slice(0, at.from + 1), "", tables, "", ...lines.slice(at.to)].join("\n");
}
