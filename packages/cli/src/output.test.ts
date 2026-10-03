import {
  cliEnvelopeSchema,
  type ErrorCode,
  err,
  errorBody,
  errorCodes,
  type Issue,
  ok,
} from "@product-loop/model";
import { describe, expect, it } from "vitest";
import { errorLineCopy } from "./copy/output.ts";
import { roundStartedReport, roundStartedText } from "./fixture.ts";
import { exitCodeOf, type Outcome, render } from "./output.ts";

// 「04 命令行」第五节的两段 JSON 样例和第六节的报错样例，原样照抄。
const startedJson = `{"schemaVersion": 1, "kind": "round.started", "ok": true,
 "data": {"round": "v2-检查-1", "taken": ["Q12", "Q15"], "changedScreens": [{"scene": "S1", "steps": [2, 3]}]},
 "warnings": [], "next": ["ploop queue drop <编号> --reason <原因>", "ploop page present"]}`;

const errorJson = `{"schemaVersion": 1, "kind": "error", "ok": false,
 "error": {"code": "RULE_BLOCKED", "rule": "reply.line.handled", "message": "上一个阶段的回复还有两行没有处理：第 3 行、第 5 行。",
           "hint": "运行 ploop reply show 看这两行，再用 ploop reply handle 处理。", "where": "v1-构思-3"}}`;

const blockedText = `拦截：疑问「主线里缺的部分」的来源「报告网页现在的样子」没有图。
位置：rounds/v2-构思-1/page.json → asks[0].sources[1]
怎么改：界面的来源写 img（截图的路径）；文字的来源写 file 和 lines，原文由命令摘录。
规矩：card.source.visual`;

const sourceIssue: Issue = {
  rule: "card.source.visual",
  message: "疑问「主线里缺的部分」的来源「报告网页现在的样子」没有图。",
  hint: "界面的来源写 img（截图的路径）；文字的来源写 file 和 lines，原文由命令摘录。",
  where: "rounds/v2-构思-1/page.json → asks[0].sources[1]",
};
const replyIssue: Issue = {
  rule: "reply.line.handled",
  message: "上一个阶段的回复还有两行没有处理：第 3 行、第 5 行。",
  hint: "运行 ploop reply show 看这两行，再用 ploop reply handle 处理。",
  where: "v1-构思-3",
};
const mainlineWarning: Issue = {
  rule: "mainline.ten",
  message: "主线缺两样：给谁用、风险。",
  hint: "按缺的几样补主线，再运行 ploop mainline push。",
};

/** 标准输出应当正好是一个 JSON 对象，占一行。 */
function onlyJson(stdout: string): unknown {
  expect(stdout.endsWith("\n")).toBe(true);
  expect(stdout.trimEnd().split("\n")).toHaveLength(1);
  const parsed: unknown = JSON.parse(stdout);
  expect(cliEnvelopeSchema.safeParse(parsed).error?.issues).toBeUndefined();
  return parsed;
}

describe("文字输出，「04 命令行」第五节", () => {
  it("round start 检查 的输出和样例逐行相同", () => {
    const { stdout, stderr } = render(ok(roundStartedReport), false);
    expect(stdout.split("\n")).toEqual([...roundStartedText.split("\n"), ""]);
    expect(stderr).toBe("");
  });

  it("没有下一步时不写「下一步：」这一段", () => {
    const { stdout } = render(ok({ ...roundStartedReport, next: [] }), false);
    expect(stdout).toBe(`${roundStartedReport.lines.join("\n")}\n`);
  });

  it("警告另起一段写到标准错误，写明怎么改和规矩，标准输出不变", () => {
    const warned = render(ok({ ...roundStartedReport, warnings: [mainlineWarning] }), false);
    expect(warned.stdout).toBe(render(ok(roundStartedReport), false).stdout);
    expect(warned.stderr).toBe(
      [
        "",
        "警告：主线缺两样：给谁用、风险。",
        "怎么改：按缺的几样补主线，再运行 ploop mainline push。",
        "规矩：mainline.ten",
        "",
      ].join("\n"),
    );
  });
});

describe("报错，「04 命令行」第六节", () => {
  it("拦截的写法和样例逐行相同，标准输出什么也不写", () => {
    const { stdout, stderr } = render(err(errorBody("RULE_BLOCKED", [sourceIssue])), false);
    expect(stderr.split("\n")).toEqual([...blockedText.split("\n"), ""]);
    expect(stdout).toBe("");
  });

  it("一次列出全部拦截，每条一段，段和段之间空一行", () => {
    const { stderr } = render(err(errorBody("RULE_BLOCKED", [sourceIssue, replyIssue])), false);
    expect(stderr).toBe(
      [
        blockedText,
        "",
        "拦截：上一个阶段的回复还有两行没有处理：第 3 行、第 5 行。",
        "位置：v1-构思-3",
        "怎么改：运行 ploop reply show 看这两行，再用 ploop reply handle 处理。",
        "规矩：reply.line.handled",
        "",
      ].join("\n"),
    );
  });

  it("位置已经写在正文里的，不再另写一行位置（N14）", () => {
    const file = "/Users/me/proj/app/.product-loop/主线.远端.md";
    const { stderr } = render(
      err(
        errorBody("CONFLICT", [{ message: `${file} 已经在了。`, hint: "先删掉它。", where: file }]),
      ),
      false,
    );
    expect(stderr).toBe(`冲突：${file} 已经在了。\n怎么改：先删掉它。\n`);
  });

  it("没写的位置、怎么改和规矩不出", () => {
    const { stderr } = render(
      err(errorBody("NOT_FOUND", [{ message: "没有这个阶段：第 2 版的检查阶段（第 9 次）。" }])),
      false,
    );
    expect(stderr).toBe("找不到：没有这个阶段：第 2 版的检查阶段（第 9 次）。\n");
  });

  it("消息只差引号里的名字、怎么改和规矩相同的，合成一条，名字并列出来", () => {
    const one = (scene: string, where: string): Issue => ({
      message: `场景「${scene}」没有写谁在什么时候用。`,
      hint: "在标题的下一行写「谁在什么时候用：」。",
      where,
      rule: "mainline.scene.who",
    });
    const { stderr } = render(
      ok({
        kind: "mainline.show",
        data: {},
        lines: ["主线修订 4"],
        next: [],
        warnings: [
          one("S1 看队列", "第 5 行"),
          one("S2 看决定", "第 9 行"),
          one("S3 改设置", "第 14 行"),
        ],
      }),
      false,
    );
    expect(stderr).toBe(
      [
        "",
        "警告：场景「S1 看队列」、「S2 看决定」、「S3 改设置」没有写谁在什么时候用。",
        "位置：第 5、9、14 行",
        "怎么改：在标题的下一行写「谁在什么时候用：」。",
        "规矩：mainline.scene.who",
        "",
      ].join("\n"),
    );
  });

  it("合并时只差行号的位置写成「第 5、9 行」，前面的文件名只写一次", () => {
    const one = (scene: string, line: number): Issue => ({
      message: `场景「${scene}」没有步骤。`,
      hint: "补上步骤。",
      where: `主线.md 第 ${line} 行`,
    });
    const { stderr } = render(
      err(errorBody("RULE_BLOCKED", [one("a", 23), one("b", 25), one("c", 27)])),
      false,
    );
    expect(stderr).toContain("位置：主线.md 第 23、25、27 行\n");
  });

  it("合并时名字太多只列前六个，再写总数；只有一条的照旧", () => {
    const one = (name: string): Issue => ({
      message: `「${name}」没有写原因。`,
      hint: "补上原因。",
    });
    const [first, ...rest] = ["a", "b", "c", "d", "e", "f", "g", "h"].map(one);
    const { stderr } = render(err(errorBody("RULE_BLOCKED", [first as Issue, ...rest])), false);
    expect(stderr).toBe(
      "拦截：「a」、「b」、「c」、「d」、「e」、「f」等 8 处没有写原因。\n怎么改：补上原因。\n",
    );
    expect(render(err(errorBody("RULE_BLOCKED", [one("a")])), false).stderr).toBe(
      "拦截：「a」没有写原因。\n怎么改：补上原因。\n",
    );
  });

  it("两条只差名字的也合并（F26）", () => {
    const one = (name: string): Issue => ({
      message: `「${name}」没有写原因。`,
      hint: "补上原因。",
    });
    expect(render(err(errorBody("RULE_BLOCKED", [one("a"), one("b")])), false).stderr).toBe(
      "拦截：「a」、「b」没有写原因。\n怎么改：补上原因。\n",
    );
  });

  it("队列编号加事项名的问题合并成一条，怎么改里的编号也写成全部编号（F26）", () => {
    const one = (id: string, content: string): Issue => ({
      message: `这个阶段拿出来的 ${id}「${content}」没有出现在任何一张卡上。`,
      hint: `在处理它的卡上写 queue，列出 ${id}。不做它就取消。`,
      rule: "round.batch.covered",
    });
    const { stderr } = render(
      err(errorBody("RULE_BLOCKED", [one("Q3", "看板"), one("Q4", "设置"), one("Q9", "登录")])),
      false,
    );
    expect(stderr).toBe(
      [
        "拦截：这个阶段拿出来的 Q3「看板」、Q4「设置」、Q9「登录」没有出现在任何一张卡上。",
        "怎么改：在处理它的卡上写 queue，列出 Q3、Q4、Q9。不做它就取消。",
        "规矩：round.batch.covered",
        "",
      ].join("\n"),
    );
  });

  it("消息、怎么改和规矩都一样、只有位置不同的合成一条，位置并列（F24）", () => {
    const at = (where: string): Issue => ({
      message: "出现了术语表停用的说法「替人用的脚本」。",
      hint: "改成「走查脚本」。",
      rule: "writing.term.banned",
      where,
    });
    const { stderr } = render(err(errorBody("RULE_BLOCKED", [at("内容"), at("子项 2")])), false);
    expect(stderr).toBe(
      [
        "拦截：出现了术语表停用的说法「替人用的脚本」。",
        "位置：内容；子项 2",
        "怎么改：改成「走查脚本」。",
        "规矩：writing.term.banned",
        "",
      ].join("\n"),
    );
  });

  it("合不了的每条都写全「怎么改」，不写「同上」（F24）", () => {
    const missing = (section: string): Issue => ({
      message: `计划里没有 ${section} 这一节。`,
      hint: "计划固定七节：现状、裁决。",
    });
    const { stderr } = render(
      err(errorBody("RULE_BLOCKED", [missing("现状"), missing("裁决")])),
      false,
    );
    expect(stderr).toBe(
      [
        "拦截：计划里没有 现状 这一节。",
        "怎么改：计划固定七节：现状、裁决。",
        "",
        "拦截：计划里没有 裁决 这一节。",
        "怎么改：计划固定七节：现状、裁决。",
        "",
      ].join("\n"),
    );
    expect(stderr).not.toContain("同上");
  });

  it("每个错误码都有报错第一行的写法，顺序和错误码表相同", () => {
    expect(errorLineCopy.map((row) => row.code)).toEqual(errorCodes.map((row) => row.code));
    const firstLines = errorCodes.map(({ code }) => {
      const { stderr } = render(err(errorBody(code, [{ message: "出了问题。" }])), false);
      return stderr.split("\n")[0];
    });
    expect(firstLines).toEqual([
      "拦截：出了问题。",
      "用法错误：出了问题。",
      "冲突：出了问题。",
      "找不到：出了问题。",
      "后端正忙：出了问题。",
      "要先做迁移检查：出了问题。",
      "页已不在：出了问题。",
      "版本过低：出了问题。",
      "后端出错：出了问题。",
    ]);
  });
});

describe("--json，「04 命令行」第五节", () => {
  it("成功时标准输出只有一个 JSON 对象，和样例相同", () => {
    const next = ["ploop queue drop <编号> --reason <原因>", "ploop page present"];
    const { stdout, stderr } = render(ok({ ...roundStartedReport, next }), true);
    expect(onlyJson(stdout)).toEqual(JSON.parse(startedJson));
    expect(stderr).toBe("");
  });

  it("出错时也是同一种外壳，和样例相同，标准错误什么也不写", () => {
    const { stdout, stderr } = render(err(errorBody("RULE_BLOCKED", [replyIssue])), true);
    expect(onlyJson(stdout)).toEqual(JSON.parse(errorJson));
    expect(stderr).toBe("");
  });

  it("多条拦截都放进 issues，顶层写第一条", () => {
    const { stdout } = render(err(errorBody("RULE_BLOCKED", [sourceIssue, replyIssue])), true);
    expect(onlyJson(stdout)).toMatchObject({
      error: { code: "RULE_BLOCKED", ...sourceIssue, issues: [sourceIssue, replyIssue], total: 2 },
    });
  });

  it("警告放进 warnings，不写到标准错误", () => {
    const warned: Outcome = ok({ ...roundStartedReport, warnings: [mainlineWarning] });
    const { stdout, stderr } = render(warned, true);
    expect(onlyJson(stdout)).toMatchObject({ ok: true, warnings: [mainlineWarning] });
    expect(stderr).toBe("");
  });
});

describe("退出码，「04 命令行」第七节", () => {
  it("成功是 0，带着警告也是 0", () => {
    expect(exitCodeOf(ok(roundStartedReport))).toBe(0);
    expect(exitCodeOf(ok({ ...roundStartedReport, warnings: [mainlineWarning] }))).toBe(0);
  });

  it("还在等：结果照常输出，退出码是 7", () => {
    expect(exitCodeOf(ok({ ...roundStartedReport, exit: 7 }))).toBe(7);
  });

  // 每个错误码的退出码照「05 接口」第九节的表取，不在命令行里另写一份。
  const table: [ErrorCode, number][] = [
    ["RULE_BLOCKED", 1],
    ["BAD_REQUEST", 2],
    ["CONFLICT", 3],
    ["NOT_FOUND", 4],
    ["BUSY", 5],
    ["NEEDS_DOCTOR", 6],
    ["PAGE_GONE", 8],
    ["CLIENT_TOO_OLD", 2],
    ["INTERNAL", 5],
  ];

  it.each(table)("%s 以 %i 退出", (code, exit) => {
    expect(exitCodeOf(err(errorBody(code, [{ message: "出了问题。" }])))).toBe(exit);
  });
});
