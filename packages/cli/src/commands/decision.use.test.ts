import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cliEnvelopeSchema } from "@product-loop/model";
import { describe, expect, it } from "vitest";
import { sandbox } from "./testing.ts";

// ploop decision 各子命令，对着真的后端跑，见第一期计划第 34 步和「04 命令行」第十节。
// 缺原因时退出码 1 并带规矩编号。每次写了决定就重写决定.md，命令从不回读它。

function opened() {
  const s = sandbox();
  expect(s.ploop("proj/app", "init", "--repo", "自己的").code).toBe(0);
  const d = (...argv: string[]) => s.ploop("proj/app", "decision", ...argv);
  const doc = join(s.at("proj/app"), ".product-loop", "决定.md");
  return { s, d, doc };
}

const first = [
  "--decision",
  "队列看板默认按阶段分列",
  "--reason",
  "用户按阶段找事",
  "--case",
  "第 1 版的构思阶段第 3 行",
];

describe("ploop decision", { timeout: 60_000 }, () => {
  it("add 缺原因：拦截，退出码 1，带规矩编号 decision.fields，不写决定.md", () => {
    const { d, doc } = opened();
    const { code, stdout, stderr } = d("add", "--decision", "看板按阶段分列", "--case", "第 3 行");
    expect(stderr).toBe(
      [
        "拦截：决定、原因、案例三项都要写，这里缺了原因。",
        "位置：--reason",
        "怎么改：补上原因再重跑，日期由命令填。",
        "规矩：decision.fields",
        "",
      ].join("\n"),
    );
    expect(stdout).toBe("");
    expect(code).toBe(1);
    expect(() => readFileSync(doc)).toThrow();

    const json = d("add", "--json");
    const envelope = cliEnvelopeSchema.parse(JSON.parse(json.stdout));
    expect(envelope).toMatchObject({
      ok: false,
      error: { code: "RULE_BLOCKED", rule: "decision.fields", total: 3 },
    });
    expect(json.code).toBe(1);
  });

  it("add 照 queue add 的样子写位置参数：用法错误，怎么改直接写一个能运行的例子（F32）", () => {
    const { d } = opened();
    const { code, stderr } = d("add", "队列看板放首页");
    expect(stderr).toBe(
      [
        "用法错误：ploop decision add 多写了参数：队列看板放首页。",
        '怎么改：写法例如 ploop decision add --decision "队列看板默认按阶段分列" --reason "用户按阶段找事" --case "第 2 版的检查阶段第 3 行"。运行 ploop decision add --help 查看用法。',
        "",
      ].join("\n"),
    );
    expect(code).toBe(2);
  });

  it("add 以后重写决定.md，手改的内容不留，命令不回读", () => {
    const { d, doc } = opened();
    const added = d("add", ...first);
    expect(added.stdout.split("\n").slice(0, 4)).toEqual([
      "记下了决定：第 1 条",
      "队列看板默认按阶段分列",
      "原因：用户按阶段找事",
      "案例：第 1 版的构思阶段第 3 行",
    ]);
    expect(added.stdout).toContain("重写了 .product-loop/决定.md\n");
    expect(added.code).toBe(0);

    // 决定.md 是只读视图：手改成别的内容，命令不读它，下一次写照集中存储整份重写。
    writeFileSync(doc, "| 99 | 手写的决定 |\n");
    expect(
      d(
        "add",
        "--decision",
        "看板加上拖动排序",
        "--reason",
        "用户要调顺序",
        "--case",
        "第 1 版的构思阶段（第 2 次）第 1 行",
        "--kind",
        "以后再说",
      ).code,
    ).toBe(0);
    const text = readFileSync(doc, "utf8");
    expect(text).not.toContain("手写的决定");
    expect(text).toContain(
      "| 1 | 队列看板默认按阶段分列 | 用户按阶段找事 | 第 1 版的构思阶段第 3 行 |",
    );
    expect(text).toMatch(/\| 2 \| 看板加上拖动排序 \| .* \| 有效 \| 以后再说 \|/u);
  });

  it("edit 只改写了的项，编号和日期不变，重写决定.md，命令不回读", () => {
    const { d, doc } = opened();
    d("add", ...first);
    d("add", ...first.map((text) => (text === "用户按阶段找事" ? "另一个原因" : text)));
    const before = JSON.parse(d("list", "--json").stdout) as {
      data: { id: number; date: string }[];
    };

    writeFileSync(doc, "| 99 | 手写的决定 |\n");
    const edited = d("edit", "1", "--reason", "用户按阶段找事，按状态找不到", "--case", "新的案例");
    expect(edited.stdout.split("\n").slice(0, 5)).toEqual([
      "改好了决定：第 1 条",
      "队列看板默认按阶段分列",
      "原因：用户按阶段找事，按状态找不到",
      "案例：新的案例",
      "重写了 .product-loop/决定.md",
    ]);
    expect(edited.stdout).toContain("下一步：\n  1. ploop decision list");
    expect(edited.stderr).toBe("");
    expect(edited.code).toBe(0);

    const text = readFileSync(doc, "utf8");
    expect(text).not.toContain("手写的决定");
    expect(text).toContain(
      "| 1 | 队列看板默认按阶段分列 | 用户按阶段找事，按状态找不到 | 新的案例 |",
    );
    // 没改的一条照旧，编号和日期都没变。
    expect(text).toContain("| 2 | 队列看板默认按阶段分列 | 另一个原因 |");
    const after = JSON.parse(d("list", "--json").stdout) as {
      data: { id: number; date: string }[];
    };
    expect(after.data.map(({ id, date }) => [id, date])).toEqual(
      before.data.map(({ id, date }) => [id, date]),
    );
  });

  it("edit 已作废的也能改，决定.md 里还标着已作废", () => {
    const { d, doc } = opened();
    d("add", ...first);
    d(
      "add",
      "--decision",
      "队列看板默认按状态分列",
      "--reason",
      "用户改主意",
      "--case",
      "第 2 次第 1 行",
    );
    expect(d("void", "1", "--by", "2").code).toBe(0);
    const edited = d("edit", "1", "--decision", "队列看板按阶段分列");
    expect(edited.code).toBe(0);
    expect(edited.stdout.split("\n")[0]).toBe("改好了决定：第 1 条");
    expect(readFileSync(doc, "utf8")).toMatch(
      /\| 1 \| 队列看板按阶段分列 \| .* \| 已作废，被第 2 条推翻 \| 决定 \|/u,
    );
  });

  it("edit 什么都没写：拦下，退出码 2，写明要改哪几项，不动决定.md", () => {
    const { d, doc } = opened();
    d("add", ...first);
    const before = readFileSync(doc, "utf8");
    const empty = d("edit", "1");
    expect(empty.code).toBe(2);
    expect(empty.stderr).toContain("至少要改一项：决定、原因或案例。");
    expect(readFileSync(doc, "utf8")).toBe(before);
  });

  it("edit 写成空白：拦截，退出码 1，带规矩编号，位置写选项名，决定不变", () => {
    const { d, doc } = opened();
    d("add", ...first);
    const before = readFileSync(doc, "utf8");
    const blank = d("edit", "1", "--reason", "  ");
    expect(blank.stderr).toBe(
      [
        "拦截：决定、原因、案例三项都要写，这里缺了原因。",
        "位置：--reason",
        "怎么改：补上原因再重跑，日期由命令填。",
        "规矩：decision.fields",
        "",
      ].join("\n"),
    );
    expect(blank.code).toBe(1);
    expect(readFileSync(doc, "utf8")).toBe(before);
  });

  it("add 和 edit 的「决定」超过 40 个字：拦截，退出码 1，写明字数、怎么改和规矩编号", () => {
    const { d, doc } = opened();
    const long =
      "队列看板默认按阶段分列，因为用户按阶段找事，按状态分列时同一阶段的事散在几列里，要来回找，而且列头上的数量也对不上";
    const added = d("add", "--decision", long, "--reason", "用户按阶段找事", "--case", "第 3 行");
    expect(added.stderr).toBe(
      [
        "拦截：「决定」一项有 53 个字，超过 40 个字。",
        "位置：--decision",
        "怎么改：缩短到 40 个字以内，细节写进原因。",
        "规矩：decision.decision.tooLong",
        "",
      ].join("\n"),
    );
    expect(added.code).toBe(1);
    expect(() => readFileSync(doc)).toThrow();

    d("add", ...first);
    const edited = d("edit", "1", "--decision", long);
    expect(edited.stderr).toContain("规矩：decision.decision.tooLong");
    expect(edited.stderr).toContain("位置：--decision");
    expect(edited.code).toBe(1);
    expect(readFileSync(doc, "utf8")).toContain("| 1 | 队列看板默认按阶段分列 |");
    // 细节写进原因，决定缩短以后放得进去。
    expect(d("edit", "1", "--decision", "队列看板按阶段分列", "--reason", long).code).toBe(0);
  });

  it("edit 没有这一条：退出码 4；--json 里是 decision.edited", () => {
    const { d } = opened();
    const missing = d("edit", "9", "--reason", "新的原因");
    expect(missing.stderr.split("\n")[0]).toBe("找不到：项目「app」没有编号是 9 的决定。");
    expect(missing.code).toBe(4);
    d("add", ...first);
    const json = d("edit", "1", "--reason", "新的原因", "--json");
    expect(cliEnvelopeSchema.parse(JSON.parse(json.stdout))).toMatchObject({
      ok: true,
      kind: "decision.edited",
      data: { id: 1, reason: "新的原因", status: "有效" },
    });
  });

  it("void 写明被哪一条推翻，决定.md 里原地标已作废；list 默认只列有效的", () => {
    const { d, doc } = opened();
    d("add", ...first);
    d(
      "add",
      "--decision",
      "队列看板默认按状态分列",
      "--reason",
      "用户改主意",
      "--case",
      "第 1 版的构思阶段（第 2 次）第 1 行",
    );

    const voided = d("void", "1", "--by", "2", "--reason", "用户改主意");
    expect(voided.stdout.split("\n")[0]).toBe("作废了决定：第 1 条，被第 2 条推翻");
    expect(voided.code).toBe(0);
    expect(readFileSync(doc, "utf8")).toContain(
      "| 已作废，被第 2 条推翻。作废原因：用户改主意 | 决定 |",
    );

    expect(d("list").stdout).toMatch(
      /^列出了 1 条决定：\n {2}2 {2}\d{4}-\d{2}-\d{2} {2}决定 {2}队列看板默认按状态分列\n$/u,
    );
    const all = d("list", "--all", "--json");
    const envelope = cliEnvelopeSchema.parse(JSON.parse(all.stdout));
    expect(envelope).toMatchObject({
      kind: "decision.list",
      data: [
        { id: 1, status: "已作废", voidedBy: 2 },
        { id: 2, status: "有效" },
      ],
    });
  });

  it("list --limit：决定多时文字只列最近的几条，写明还有几条；--limit 0 列全部；--json 里仍是全部", () => {
    const { d } = opened();
    for (const [i, name] of ["甲", "乙", "丙"].entries()) {
      expect(
        d("add", "--decision", `决定${name}`, "--reason", "理由", "--case", `案例${i}`).code,
      ).toBe(0);
    }
    const limited = d("list", "--limit", "2");
    expect(limited.stdout.split("\n")).toEqual([
      "列出了最近的 2 条决定，共 3 条：",
      expect.stringMatching(/^ {2}2 {2}\d{4}-\d{2}-\d{2} {2}决定 {2}决定乙$/u),
      expect.stringMatching(/^ {2}3 {2}\d{4}-\d{2}-\d{2} {2}决定 {2}决定丙$/u),
      "还有 1 条没列出，加 --limit 0 重新运行可以列出全部。",
      "",
    ]);
    expect(d("list", "--limit", "0").stdout.split("\n")[0]).toBe("列出了 3 条决定：");
    const json = JSON.parse(d("list", "--limit", "2", "--json").stdout) as { data: unknown[] };
    expect(json.data).toHaveLength(3);
    const bad = d("list", "--limit", "很多");
    expect(bad.stderr.split("\n")[0]).toBe(
      "用法错误：选项 --limit <条数> 的取值「很多」不对。条数要写从 0 起的整数，例如 30；写 0 是全部列出。",
    );
    expect(bad.code).toBe(2);
  });

  it("void 推翻它的那一条不存在：找不到或拦截，不改决定.md", () => {
    const { d, doc } = opened();
    d("add", ...first);
    const before = readFileSync(doc, "utf8");
    const { code } = d("void", "1", "--by", "9");
    expect(code).not.toBe(0);
    expect(readFileSync(doc, "utf8")).toBe(before);
  });
});
