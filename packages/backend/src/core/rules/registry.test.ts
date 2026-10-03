import { existsSync } from "node:fs";
import {
  backendRules,
  type CopyEntry,
  checkWriting,
  flattenCopy,
  handleRuleInfo,
  inlineRuleInfo,
  landRuleInfo,
  presentRuleInfo,
  type Rule,
  type RuleHit,
  type RunOptions,
  renderCopy,
  runRules,
  useRuleInfo,
  whereText,
} from "@product-loop/model";
import { describe, expect, it } from "vitest";
import { backendRulesCopy } from "../../copy/rules.ts";
import { landRules } from "../land/rules.ts";
import { lintRules } from "../lint.ts";
import { queueRules } from "../queue.ts";
import { handleRules } from "../replies/handle.ts";
import { roundCloseRules } from "../rounds/close.ts";
import { roundStartRules } from "../rounds/start.ts";
import { useRules } from "../use/ingest.ts";
import { unclearReworded } from "./align.ts";
import { imageRefsOf } from "./blobs.ts";
import { backendRuleList, handleRuleList } from "./index.ts";
import { basePage, pageWith } from "./page.samples.ts";
import { oneWaiting } from "./waiting.ts";

// 后端规则的总测试，见「07 校验」第六节和第八节，查法和 model 的 registry.test.ts 相同：
// 说明和 model 登记的一致，报错在文案表里，会命中的样本命中，基础数据不命中。
// 检查写在用例里的规则，核对用例里的编号常量和 model 登记的一一对应。
// 规则对象和用例里的编号合起来，正好是 model 登记在后端的全部规则。

const copyItems = flattenCopy("rules", backendRulesCopy);
/** 写成规则对象的全部后端规则。 */
const ruleObjects = [...backendRuleList, ...handleRuleList];
const registered = backendRules();
/** 执行规则的方式。只在某些阶段查的规则，按它的第一个阶段执行。 */
function optionsOf(rule: Rule): RunOptions {
  const [first] = rule.scope.stages ?? [];
  return first === undefined ? { mode: "current" } : { mode: "current", stage: first };
}

const placeholder = /\{[A-Za-z][A-Za-z0-9]*\}/u;

/** 命中写成便于比较的样子：位置写成文字，参数照原样。 */
function plain(hits: readonly RuleHit[]) {
  return hits.map((hit) => ({
    where: hit.where === undefined ? undefined : whereText(hit.where),
    params: hit.params,
  }));
}

describe.each(ruleObjects.map((rule) => [rule.id, rule] as const))("后端规则 %s", (id, rule) => {
  it("编号、级别、范围、起始、上下文和查什么，都照 model 登记的说明", () => {
    const info = registered.find((item) => item.id === id);
    expect(info, id).toBeDefined();
    const { location: _location, ...fields } = info ?? { location: "" };
    for (const [key, value] of Object.entries(fields)) {
      expect(rule[key as keyof typeof rule], key).toBe(value);
    }
  });

  it("报错在后端的文案表里，写作校验没有拦截", () => {
    const entries: CopyEntry[] = [rule.copy.message, ...(rule.copy.hint ? [rule.copy.hint] : [])];
    for (const entry of entries) {
      expect(copyItems.some((item) => item.entry === entry)).toBe(true);
      expect(checkWriting(renderCopy(entry, entry.sample)).block).toEqual([]);
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
        expect(issues).toHaveLength(sample.expect.length);
        for (const issue of issues) {
          expect(issue.rule).toBe(id);
          expect(issue.message).not.toMatch(placeholder);
          expect(issue.hint ?? "").not.toMatch(placeholder);
        }
      });
    },
  );
});

describe("后端规则的登记", () => {
  it("给出信息的规则，model 登记的每一条都写成了规则对象，顺序相同", () => {
    expect(backendRuleList.map((rule) => rule.id)).toEqual(
      Object.values(presentRuleInfo).map((info) => info.id),
    );
  });

  it("处理回复的规则，model 登记的每一条都写成了规则对象，顺序相同", () => {
    expect(handleRuleList.map((rule) => rule.id)).toEqual(
      Object.values(handleRuleInfo).map((info) => info.id),
    );
  });

  it("说明里写的文件都在", () => {
    for (const info of registered) {
      const file = /^后端 (core\/[a-z/-]+\.ts)/u.exec(info.location)?.[1];
      expect(file, info.location).toBeDefined();
      expect(existsSync(new URL(`../../${file}`, import.meta.url)), info.location).toBe(true);
    }
  });

  it("用例里的编号常量和 model 登记的一一对应", () => {
    const constants = new Map<string, Readonly<Record<string, string>>>([
      ["queueRules", queueRules],
      ["roundStartRules", roundStartRules],
      ["roundCloseRules", roundCloseRules],
      ["handleRules", handleRules],
      ["landRules", landRules],
      ["useRules", useRules],
      ["lintRules", lintRules],
    ]);
    const inline = [
      ...Object.values(inlineRuleInfo),
      ...Object.values(landRuleInfo),
      ...Object.values(useRuleInfo),
    ];
    for (const info of inline) {
      const name = / 的 ([a-zA-Z]+)$/u.exec(info.location)?.[1] ?? "";
      expect(Object.values(constants.get(name) ?? {}), info.id).toContain(info.id);
    }
    const used = [...constants.values()].flatMap((ids) => Object.values(ids));
    expect([...used].sort()).toEqual(inline.map((info) => info.id).sort());
  });

  it("规则对象和用例里的编号合起来，正好是登记在后端的全部规则", () => {
    const constants = [
      queueRules,
      roundStartRules,
      roundCloseRules,
      handleRules,
      landRules,
      useRules,
      lintRules,
    ];
    const ids = [
      ...ruleObjects.map((rule) => rule.id),
      ...constants.flatMap((ids) => Object.values(ids)),
    ];
    expect([...ids].sort()).toEqual(registered.map((info) => info.id).sort());
  });

  it("文案表里的每一组报错都有规则在用", () => {
    const used = new Set(ruleObjects.flatMap((rule) => [rule.copy.message, rule.copy.hint]));
    expect(copyItems.filter((item) => !used.has(item.entry)).map((item) => item.key)).toEqual([]);
  });
});

describe("page.oneWaiting", () => {
  it("要给出的是只看的页时，有页在等也不报", () => {
    const context = { waitingPages: [{ id: 12, seq: 1, round: "v2-检查-1" }] };
    expect(oneWaiting.check({ page: basePage, purpose: "view" }, context)).toEqual([]);
  });

  it("在等的页有几页就报几处", () => {
    const waitingPages = [
      { id: 12, seq: 1, round: "v2-检查-1" },
      { id: 13, seq: 2, round: "v2-检查-1" },
    ];
    expect(oneWaiting.check({ page: basePage, purpose: "ask" }, { waitingPages })).toHaveLength(2);
  });
});

describe("blob.present 找截图的路径", () => {
  it("来源、图、更改和证据里名为 img 的字段都找到，按数据里的顺序", () => {
    const page = pageWith((input) => {
      const [card] = input.asks;
      if (card !== undefined) {
        Object.assign(card, { evidence: [{ type: "截图", img: "img/zoom.png" }] });
      }
    });
    expect(imageRefsOf(page).map((ref) => [whereText(ref.where), ref.path])).toEqual([
      ["asks[0].sources[0].img", "img/home.png"],
      ["asks[0].evidence[0].img", "img/zoom.png"],
      ["asks[0].image.img", "img/board.png"],
      ["changes[0].after.img", "img/after.png"],
    ]);
  });
});

describe("align.unclear.reworded", () => {
  const unclear = {
    name: "看板",
    meaning: "工作台首页上按阶段排的队列。",
    example: "Q12 排在检查那一列。",
    round: "v1-构思-3",
  };
  const pageOf = (meaning: string, example: string) => ({
    page: pageWith((input) => {
      Object.assign(input, {
        align: [{ name: "看板", usedIn: ["队列看板放在哪里"], meaning, example }],
      });
    }),
    purpose: "ask" as const,
  });

  it("只改了意思或者只换了例子，都算换了讲法", () => {
    const context = { unclearTerms: [unclear] };
    expect(
      unclearReworded.check(pageOf("首页上按阶段分列的队列。", unclear.example), context),
    ).toEqual([]);
    expect(unclearReworded.check(pageOf(unclear.meaning, "Q15 排在落地那一列。"), context)).toEqual(
      [],
    );
  });

  it("这一页的先对齐里没有这个术语时不报", () => {
    expect(
      unclearReworded.check({ page: basePage, purpose: "ask" }, { unclearTerms: [unclear] }),
    ).toEqual([]);
  });
});
