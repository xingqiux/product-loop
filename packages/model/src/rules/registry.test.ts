import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { type CopyEntry, renderCopy } from "../copy/define.ts";
import { allCopy } from "../copy/index.ts";
import { rulesCopy } from "../copy/rules.ts";
import * as model from "../index.ts";
import { ruleLevel, stage } from "../names.ts";
import { pageSection } from "../page/section-names.ts";
import { checkWriting } from "../writing/check.ts";
import {
  backendRules,
  handleRuleInfo,
  inlineRuleInfo,
  landRuleInfo,
  presentRuleInfo,
  useRuleInfo,
} from "./backend.ts";
import { renderRuleTables, ruleTablesIn, tablesEnd, tablesStart, withRuleTables } from "./doc.ts";
import { allRules, pendingRules } from "./registry.ts";
import {
  isRuleSince,
  type Rule,
  type RuleHit,
  ruleCommands,
  ruleIdPattern,
  ruleSubjects,
  sinceRelease,
} from "./rule.ts";
import { type RunOptions, runRules, whereText } from "./run.ts";

// 规则的总测试，见「07 校验」第六节和第八节。逐条查登记的每一条规则，查的有以下几项：
// - 编号的写法，范围和起始日期。
// - 文案表里的报错，查什么和依据。
// - 会命中的样本，在基础数据上不命中。
// - 维护说明里的一行。
// 缺一样，这条规则的测试就失败。

const rules = allRules();
const backend = backendRules();
const copyItems = allCopy();
const docFile = new URL("../../../../docs/维护说明.md", import.meta.url);
const doc = readFileSync(docFile, "utf8");
const contextNames: readonly string[] = Object.keys(rulesCopy.context);

/** 一条文案在文案表里的键。不在文案表里时是 undefined。 */
function copyKey(entry: CopyEntry): string | undefined {
  return copyItems.find((item) => item.entry === entry)?.key;
}

/** 文案表里这个键的那一条。 */
function copyAt(key: string): CopyEntry | undefined {
  return copyItems.find((item) => item.key === key)?.entry;
}

/** 命中写成便于比较的样子：位置写成文字，参数照原样。 */
function plain(hits: readonly RuleHit[]) {
  return hits.map((hit) => ({
    where: hit.where === undefined ? undefined : whereText(hit.where),
    params: hit.params,
  }));
}

/** 执行规则的方式。只在某些阶段查的规则，按它的第一个阶段执行。 */
function optionsOf(rule: Rule): RunOptions {
  const [first] = rule.scope.stages ?? [];
  return first === undefined ? { mode: "current" } : { mode: "current", stage: first };
}

const placeholder = /\{[A-Za-z][A-Za-z0-9]*\}/u;

describe.each(rules.map((rule) => [rule.id, rule] as const))("规则 %s", (id, rule) => {
  it("编号是两段或三段的英文小驼峰，第一段是领域", () => {
    expect(id).toMatch(ruleIdPattern);
  });

  it("级别、起始日期和需要的上下文写得对", () => {
    expect(ruleLevel.keys).toContain(rule.level);
    expect(isRuleSince(rule.since), rule.since).toBe(true);
    expect(new Set(rule.needs).size).toBe(rule.needs.length);
    for (const name of rule.needs) expect(contextNames).toContain(name);
  });

  it("范围写得对：区块只在查页面数据时写", () => {
    const { subjects, stages = [], sections = [], commands } = rule.scope;
    for (const subject of subjects) expect(ruleSubjects).toContain(subject);
    for (const key of stages) expect(stage.keys).toContain(key);
    for (const key of sections) expect(pageSection.keys).toContain(key);
    for (const command of commands) expect(ruleCommands).toContain(command);
    if (sections.length > 0) expect(subjects).toContain("page");
    for (const list of [subjects, stages, sections, commands]) {
      expect(new Set<string>(list).size).toBe(list.length);
    }
  });

  it("文案表里有报错，写作校验没有拦截", () => {
    const entries = [rule.copy.message, ...(rule.copy.hint === undefined ? [] : [rule.copy.hint])];
    for (const entry of entries) {
      expect(copyKey(entry), entry.text).toBeDefined();
      expect(checkWriting(renderCopy(entry, entry.sample)).block).toEqual([]);
    }
  });

  it("查什么和依据在文案表里，键和编号相同", () => {
    for (const part of ["summary", "basis"] as const) {
      const entry = rule.about[part];
      expect(copyAt(`rules.about.${id}.${part}`), `rules.about.${id}.${part}`).toBe(entry);
      expect(entry.text).not.toMatch(placeholder);
      expect(entry.text).not.toContain("\n");
      expect(checkWriting(entry.text).block).toEqual([]);
    }
  });

  it("在基础数据上不命中", () => {
    const { subject, context } = rule.samples.base;
    expect(rule.check(subject, context)).toEqual([]);
    const run = runRules([rule], subject, context, optionsOf(rule));
    expect([...run.block, ...run.warn]).toEqual([]);
  });

  describe.each(rule.samples.hits.map((sample) => [sample.why, sample] as const))(
    "会命中的样本：%s",
    (_why, sample) => {
      const context = sample.context ?? rule.samples.base.context;

      it("命中的位置和参数和预期相同", () => {
        expect(plain(rule.check(sample.subject, context))).toEqual(plain(sample.expect));
      });

      it("按级别报出，报错里的参数都填上了", () => {
        const run = runRules([rule], sample.subject, context, optionsOf(rule));
        const issues = rule.level === "block" ? run.block : run.warn;
        expect(rule.level === "block" ? run.warn : run.block).toEqual([]);
        expect(issues).toHaveLength(sample.expect.length);
        for (const issue of issues) {
          expect(issue.rule).toBe(id);
          expect(issue.message).not.toMatch(placeholder);
          if (issue.hint !== undefined) expect(issue.hint).not.toMatch(placeholder);
        }
      });
    },
  );
});

describe("登记的规则", () => {
  it("编号不重复，也不和后端的、已定编号还没写成规则的重复", () => {
    const ids = [
      ...rules.map((rule) => rule.id),
      ...backend.map((rule) => rule.id),
      ...pendingRules.map((rule) => rule.id),
    ];
    expect(ids.filter((id, i) => ids.indexOf(id) !== i)).toEqual([]);
  });

  it("登记以后不能再改，共用定义的入口能拿到", () => {
    expect(Object.isFrozen(rules)).toBe(true);
    expect(model.allRules()).toBe(rules);
    expect(model.runRules).toBe(runRules);
    expect(model.pendingRules).toBe(pendingRules);
    expect(Object.isFrozen(backend)).toBe(true);
    expect(model.backendRules()).toBe(backend);
  });

  it("写作校验的十八项和 decision.fields 都登记了", () => {
    expect(rules.filter((rule) => rule.id.startsWith("writing."))).toHaveLength(18);
    expect(rules.map((rule) => rule.id)).toContain("decision.fields");
  });

  it("内容和「决定」一项不超过 40 个字的两条规矩也登记了", () => {
    const ids = rules.map((rule) => rule.id);
    expect(ids).toContain("queue.content.tooLong");
    expect(ids).toContain("decision.decision.tooLong");
  });

  it("文案表里每条规则的查什么和依据，都对应一条登记的规则", () => {
    const ids = new Set([...rules, ...backend].map((rule) => rule.id));
    const keys = copyItems.map((item) => item.key).filter((key) => key.startsWith("rules.about."));
    const owners = keys.map((key) =>
      key.replace(/^rules\.about\./u, "").replace(/\.(summary|basis)$/u, ""),
    );
    expect(owners.filter((owner) => !ids.has(owner))).toEqual([]);
  });
});

describe("已定编号、还没写成规则的检查", () => {
  it.each(pendingRules.map((rule) => [rule.id, rule] as const))("%s 守同一种写法", (id, rule) => {
    expect(id).toMatch(ruleIdPattern);
    expect(rule.now.trim()).not.toBe("");
  });

  it("设计文档里带短横的写法，换成小驼峰就是编号", () => {
    const camel = (id: string) =>
      id.replace(/-([a-z])/gu, (_all, letter: string) => letter.toUpperCase());
    const renamed = pendingRules.filter((rule) => rule.designId !== undefined);
    for (const rule of renamed) expect(camel(rule.designId ?? "")).toBe(rule.id);
    // 第 53 步写成规则对象的 screens.cover-changed，登记在后端。
    expect(camel("screens.cover-changed")).toBe(presentRuleInfo.coverChanged.id);
  });
});

describe.each(backend.map((rule) => [rule.id, rule] as const))(
  "登记在后端的规则 %s",
  (id, rule) => {
    it("编号、级别、起始日期、范围和上下文写得对", () => {
      expect(id).toMatch(ruleIdPattern);
      expect(ruleLevel.keys).toContain(rule.level);
      expect(isRuleSince(rule.since), rule.since).toBe(true);
      const { subjects, stages = [], sections = [], commands } = rule.scope;
      for (const subject of subjects) expect(ruleSubjects).toContain(subject);
      for (const key of stages) expect(stage.keys).toContain(key);
      for (const key of sections) expect(pageSection.keys).toContain(key);
      for (const command of commands) expect(ruleCommands).toContain(command);
      for (const name of rule.needs) expect(contextNames).toContain(name);
    });

    it("查什么和依据在文案表里，写明了检查在后端的哪里", () => {
      for (const part of ["summary", "basis"] as const) {
        const entry = rule.about[part];
        expect(copyAt(`rules.about.${id}.${part}`), `rules.about.${id}.${part}`).toBe(entry);
        expect(checkWriting(entry.text).block).toEqual([]);
      }
      expect(rule.location).toMatch(/^后端 core\//u);
    });
  },
);

describe("后端的规则", () => {
  it("给出信息的七条写成规则对象，放在 core/rules/ 下", () => {
    const present = Object.values(presentRuleInfo);
    expect(present.map((rule) => rule.id)).toEqual([
      "round.batch.covered",
      "page.oneWaiting",
      "page.cards.none",
      "blob.present",
      "reply.line.handled",
      "screens.coverChanged",
      "align.unclear.reworded",
    ]);
    for (const rule of present) expect(rule.location).toMatch(/^后端 core\/rules\//u);
  });

  it("处理回复时的 reply.images.read 写成规则对象，放在 core/rules/ 下", () => {
    const handle = Object.values(handleRuleInfo);
    expect(handle.map((rule) => rule.id)).toEqual(["reply.images.read"]);
    for (const rule of handle) expect(rule.location).toMatch(/^后端 core\/rules\//u);
  });

  it("检查写在用例里的十二条都登记了，写明是哪个常量", () => {
    const inline = Object.values(inlineRuleInfo);
    expect(inline.map((rule) => rule.id)).toEqual([
      "queue.status.graph",
      "queue.drop.reason",
      "queue.content.semicolons",
      "queue.content.duplicate",
      "round.take.stage",
      "round.close.result",
      "use.leave",
      "think.leave",
      "mainline.spec.twelve",
      "mainline.ten",
      "writing.reply.round",
      "reply.mainline.newer",
    ]);
    for (const rule of inline) expect(rule.location).toMatch(/ 的 [a-zA-Z]+Rules$/u);
  });

  it("落地和使用记录的规则写明是哪个常量，查的是落地记录和使用记录", () => {
    const land = Object.values(landRuleInfo);
    const use = Object.values(useRuleInfo);
    expect(land).toHaveLength(20);
    expect(use.map((rule) => rule.id)).toEqual(["use.shots.present", "use.scene.known"]);
    for (const rule of land) {
      expect(rule.id).toMatch(/^land\./u);
      expect(rule.scope.subjects).toEqual(["land"]);
      expect(rule.location).toBe("后端 core/land/rules.ts 的 landRules");
    }
    for (const rule of use) {
      expect(rule.scope.subjects).toEqual(["use"]);
      expect(rule.location).toBe("后端 core/use/ingest.ts 的 useRules");
    }
  });
});

describe("docs/维护说明.md", () => {
  const tables = renderRuleTables(rules, backend, pendingRules);

  it("两行注释之间的表和程序生成的逐字相同", () => {
    const hint = "改了规则以后，运行 pnpm --filter @product-loop/model rules-doc 重新生成";
    expect(ruleTablesIn(doc), hint).toBe(tables);
    expect(withRuleTables(doc, tables), hint).toBe(doc);
  });

  it("每条规则在表里正好一行，写着级别和起始日期", () => {
    const lines = (ruleTablesIn(doc) ?? "").split("\n");
    for (const rule of rules) {
      const rows = lines.filter((line) => line.startsWith(`| \`${rule.id}\` |`));
      expect(rows, rule.id).toHaveLength(1);
      expect(rows[0]).toContain(`| ${ruleLevel.label(rule.level)} |`);
      const since = rule.since === sinceRelease ? renderCopy(rulesCopy.sinceRelease) : rule.since;
      expect(rows[0]).toContain(`| ${since} |`);
    }
    for (const rule of backend) {
      const rows = lines.filter((line) => line.startsWith(`| \`${rule.id}\` |`));
      expect(rows, rule.id).toHaveLength(1);
      expect(rows[0]).toContain(`| ${ruleLevel.label(rule.level)} |`);
      expect(rows[0]?.endsWith(`| ${rule.location} |`)).toBe(true);
    }
    for (const rule of pendingRules) {
      expect(
        lines.filter((line) => line.startsWith(`| \`${rule.id}\` |`)),
        rule.id,
      ).toHaveLength(1);
    }
  });

  it("找不到两行注释、次序反了或者写了两遍时，不改文件", () => {
    const [start, end] = [tablesStart, tablesEnd];
    for (const broken of [
      "# 维护说明\n",
      `# 维护说明\n${end}\n${start}\n`,
      `${start}\n${end}\n${start}\n${end}\n`,
    ]) {
      expect(withRuleTables(broken, tables)).toBeUndefined();
      expect(ruleTablesIn(broken)).toBeUndefined();
    }
  });

  it("重新生成时只换两行注释之间的内容", () => {
    const before = `# 维护说明\n\n前面的字。\n\n${tablesStart}\n旧的表\n${tablesEnd}\n\n后面的字。\n`;
    expect(withRuleTables(before, "新的表")).toBe(
      `# 维护说明\n\n前面的字。\n\n${tablesStart}\n\n新的表\n\n${tablesEnd}\n\n后面的字。\n`,
    );
  });
});
