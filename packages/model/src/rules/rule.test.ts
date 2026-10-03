import { describe, expect, expectTypeOf, it } from "vitest";
import { copy } from "../copy/define.ts";
import {
  type CopyParams,
  defineRule,
  isDay,
  isRuleSince,
  type RuleContextOf,
  releaseDay,
  ruleIdPattern,
  sinceRelease,
  startDay,
} from "./rule.ts";

describe("规则的编号", () => {
  it.each([
    "decision.fields",
    "use.leave",
    "land.oneCommit",
    "screens.coverChanged",
    "writing.sentence.tooLong",
    "mainline.spec.twelve",
    "page.stage2.v2",
  ])("%s 是对的写法", (id) => {
    expect(id).toMatch(ruleIdPattern);
  });

  it.each([
    ["只有一段", "decision"],
    ["多于三段", "writing.sentence.too.long"],
    ["带短横", "land.one-commit"],
    ["带下划线", "land.one_commit"],
    ["段以大写字母开头", "decision.Fields"],
    ["第一段以大写字母开头", "Decision.fields"],
    ["段以数字开头", "decision.2fields"],
    ["有空的段", "decision..fields"],
    ["以点结尾", "decision.fields."],
    ["带空格", "decision.fields "],
    ["带中文", "决定.fields"],
  ])("%s时不对：%s", (_why, id) => {
    expect(id).not.toMatch(ruleIdPattern);
  });
});

describe("起始日期", () => {
  it("写日期，或者写 2.0.0", () => {
    expect(isRuleSince("2026-09-21")).toBe(true);
    expect(isRuleSince(sinceRelease)).toBe(true);
    expect(sinceRelease).toBe("2.0.0");
  });

  it.each(["2026-9-21", "2026/09/21", "2026-02-30", "20260921", "", "2.0", "v2.0.0"])(
    "%s 不对",
    (since) => {
      expect(isRuleSince(since)).toBe(false);
    },
  );

  it("日期要真的存在", () => {
    expect(isDay("2028-02-29")).toBe(true);
    expect(isDay("2026-02-29")).toBe(false);
    expect(isDay("2026-13-01")).toBe(false);
  });

  it("2.0.0 还没发布，写 2.0.0 的规则没有开始的日期", () => {
    expect(releaseDay).toBeUndefined();
    expect(startDay(sinceRelease)).toBeUndefined();
    expect(startDay("2026-09-21")).toBe("2026-09-21");
  });

  it("发布以后，写 2.0.0 的规则从发布那天开始", () => {
    expect(startDay(sinceRelease, "2026-11-02")).toBe("2026-11-02");
    expect(startDay("2026-09-21", "2026-11-02")).toBe("2026-09-21");
  });
});

describe("defineRule 的类型", () => {
  const entry = {
    message: copy("{card}的行名「{name}」超过八个字。", {
      card: "疑问",
      name: "页面上会出现的变化",
    }),
    hint: copy("行名改到八个字以内，例如「{short}」。", { short: "页面的变化" }),
  };
  const noContext: RuleContextOf<never> = {};

  it("命中的参数要把两句文案里的参数都给全", () => {
    expectTypeOf<CopyParams<typeof entry>>().toEqualTypeOf<{
      readonly card: string | number;
      readonly name: string | number;
      readonly short: string | number;
    }>();
    const params = { card: "疑问", name: "页面上会出现的变化", short: "页面的变化" };
    const rule = defineRule({
      id: "card.row.width",
      level: "block",
      scope: { subjects: ["page"], commands: ["page check"] },
      since: sinceRelease,
      needs: [],
      about: { summary: copy("行名不超过八个字"), basis: copy("决定 125") },
      copy: entry,
      check: (_page: unknown) => [{ where: ["asks", 0, "rows", 0], params }],
      samples: {
        base: { subject: {}, context: noContext },
        hits: [{ why: "行名九个字", subject: {}, expect: [{ params }] }],
      },
    });
    expect(rule.check({}, {})).toEqual([{ where: ["asks", 0, "rows", 0], params }]);
    defineRule({
      ...rule,
      needs: [],
      copy: entry,
      // @ts-expect-error 少了 hint 里的 short
      check: () => [{ params: { card: "疑问", name: "页面上会出现的变化" } }],
    });
  });

  it("检查函数拿到的上下文按 needs 推出，没写的上下文拿不到", () => {
    const rule = defineRule({
      id: "writing.demo.spec",
      level: "warn",
      scope: { subjects: ["text"], commands: ["lint text"] },
      since: "2026-09-21",
      needs: ["writingSpec"],
      about: { summary: copy("示例"), basis: copy("示例") },
      copy: { message: copy("示例的报错") },
      check: (_text: string, context) => {
        expectTypeOf(context).toEqualTypeOf<RuleContextOf<"writingSpec">>();
        return context.writingSpec.banned.map(() => ({ params: {} }));
      },
      samples: {
        base: { subject: "", context: { writingSpec: { banned: [], exceptions: [] } } },
        hits: [
          {
            why: "项目停用了一个说法",
            subject: "",
            context: {
              writingSpec: { banned: [{ phrase: "看板", replacement: "队列" }], exceptions: [] },
            },
            expect: [{ params: {} }],
          },
        ],
      },
    });
    expect(rule.needs).toEqual(["writingSpec"]);
    defineRule({
      ...rule,
      // @ts-expect-error 没有叫 queue 的上下文
      needs: ["queue"],
    });
  });
});
