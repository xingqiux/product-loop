import { describe, expect, it } from "vitest";
import { addQueueItem } from "../../core/queue.ts";
import { startRound } from "../../core/rounds/start.ts";
import { addProject } from "../../core/testing.ts";
import { dataOf, errorOf, type TestApp, testApp } from "../testing.ts";

// skill 的问题和写作校验的接口，用 app.request 测，见「05 接口」第四节。

/** 项目 app 开着第一轮构思。 */
async function thinking(): Promise<TestApp> {
  const t = await testApp();
  addProject(t.core, "/work/app");
  addQueueItem(t.core.ctx, "app", { content: "理清给谁用", stage: "think", proposer: "ai" });
  const started = startRound(t.core.ctx, "app", { stage: "think" });
  if (!started.ok) throw new Error(started.error.message);
  return t;
}

const report = { project: "app", aspect: "页面", issueClass: "选项卡太长", example: "a 写了九行" };

describe("skill 的问题", () => {
  it("报一个问题，带上项目和阶段，状态是新；按状态筛得出来", async () => {
    const t = await thinking();
    const posted = await t.request("POST", "/api/v1/skill/issues", { body: report });
    expect(posted.status).toBe(201);
    expect(dataOf(posted)).toMatchObject({
      id: 1,
      project: "app",
      round: "v1-构思-1",
      reporter: "cli/2.0.0",
      status: "新",
      note: null,
    });
    const listed = await t.request("GET", "/api/v1/skill/issues?status=%E6%96%B0");
    expect(dataOf(listed)).toMatchObject([{ id: 1, aspect: "页面" }]);
  });

  it("回理解要写说明；写了就改成已理解；编号不在返回 NOT_FOUND", async () => {
    const t = await thinking();
    await t.request("POST", "/api/v1/skill/issues", { body: report });
    const bare = await t.request("PATCH", "/api/v1/skill/issues/1", {
      body: { status: "已理解" },
    });
    expect(errorOf(bare).code).toBe("BAD_REQUEST");
    const replied = await t.request("PATCH", "/api/v1/skill/issues/1", {
      body: { status: "已理解", note: "选项卡要限定行数" },
    });
    expect(dataOf(replied)).toMatchObject({ status: "已理解", note: "选项卡要限定行数" });
    const missing = await t.request("PATCH", "/api/v1/skill/issues/9", {
      body: { status: "已确认" },
    });
    expect(errorOf(missing).code).toBe("NOT_FOUND");
  });

  it("项目不存在返回 NOT_FOUND", async () => {
    const t = await thinking();
    const posted = await t.request("POST", "/api/v1/skill/issues", {
      body: { ...report, project: "nope" },
    });
    expect(errorOf(posted).code).toBe("NOT_FOUND");
  });
});

describe("写作校验", () => {
  it("回复的首行不以当前阶段开头，拦截；以阶段开头的通过，内部编号不认（决定 211）", async () => {
    const t = await thinking();
    const bad = await t.request("POST", "/api/v1/lint/reply", {
      body: { text: "构思：先理清给谁用。", project: "app" },
    });
    expect(bad.status).toBe(200);
    expect(dataOf(bad)).toMatchObject({
      block: [
        {
          rule: "writing.reply.round",
          message: "回复的首行没有以当前的阶段「第 1 版的构思阶段」开头。",
          hint: "首行写成「第 1 版的构思阶段：」加一句原因。",
          where: "第 1 行",
        },
      ],
    });
    // 同一件事只报一处：通用的「首行要写阶段」不再另报。
    expect(JSON.stringify(dataOf(bad))).not.toContain("writing.reply.firstLine");
    const good = await t.request("POST", "/api/v1/lint/reply", {
      body: { text: "第 1 版的构思阶段：先理清给谁用。", project: "app" },
    });
    expect(dataOf(good)).toEqual({ block: [], warn: [] });
    // 内部编号开头的拦下，写明第几行、怎么改（N06）。
    const old = await t.request("POST", "/api/v1/lint/reply", {
      body: { text: "v1-构思-1：先理清给谁用。", project: "app" },
    });
    expect(dataOf(old)).toMatchObject({
      block: [{ rule: "writing.reply.round", where: "第 1 行" }],
    });
  });

  it("回复里的文件名、间隔号、链接，写明在第几行，文件名写怎么改（N26）", async () => {
    const t = await thinking();
    const res = await t.request("POST", "/api/v1/lint/reply", {
      body: {
        text: "第 1 版的构思阶段：先理清给谁用。\n主线.md 里的场景要改。\n状态 · 字段。\nhttps://a.example/x\n还有一句。",
        project: "app",
      },
    });
    const { block } = dataOf(res) as {
      block: { rule: string; where?: string; hint?: string }[];
    };
    const at = (rule: string) => block.find((issue) => issue.rule === rule);
    expect(at("writing.reply.fileName")).toMatchObject({
      where: "第 2 行",
      hint: "把文件名换成它的内容，例如「主线」「计划」",
    });
    expect(at("writing.reply.interpunct")?.where).toBe("第 3 行");
    expect(at("writing.reply.linkLast")?.where).toBe("第 4 行");
  });

  it("回复也查措辞一类，只警告，带怎么改；首行的阶段叫法里的数字不算（F07）", async () => {
    const t = await thinking();
    const res = await t.request("POST", "/api/v1/lint/reply", {
      body: {
        text: "第 1 版的构思阶段：先理清给谁用。\n这次改了 5 处，场景 3 也动了。",
        project: "app",
      },
    });
    const { block, warn } = dataOf(res) as {
      block: unknown[];
      warn: { rule: string; message: string; hint?: string }[];
    };
    expect(block).toEqual([]);
    expect(warn.map((issue) => issue.rule)).toEqual([
      "writing.wording.numberRef",
      "writing.wording.statistics",
    ]);
    expect(warn[1]).toMatchObject({
      message: "出现「5 处」。不对用户报统计数字",
      hint: "是引用就留着，是写错了就改",
    });
    const clean = await t.request("POST", "/api/v1/lint/reply", {
      body: { text: "第 1 版的构思阶段（第 2 次）：先理清给谁用。", project: "app" },
    });
    expect(dataOf(clean)).toMatchObject({ block: [], warn: [] });
  });

  it("首行写了别的阶段，只报 writing.reply.round，不再报首行的写法", async () => {
    const t = await thinking();
    const res = await t.request("POST", "/api/v1/lint/reply", {
      body: { text: "第 1 版的检查阶段：先理清给谁用。", project: "app" },
    });
    expect(res.status).toBe(200);
    const { block, warn } = dataOf(res) as {
      block: { rule: string; message: string }[];
      warn: unknown[];
    };
    expect(block.map((issue) => issue.rule)).toEqual(["writing.reply.round"]);
    expect(block[0]?.message).toBe("回复的首行没有以当前的阶段「第 1 版的构思阶段」开头。");
    expect(warn).toEqual([]);
  });

  it("查一段文字：三个分号的句子拦截；不写项目也能查", async () => {
    const t = await testApp();
    const res = await t.request("POST", "/api/v1/lint/text", {
      body: { text: "第一件；第二件；第三件；第四件。" },
    });
    expect(dataOf(res)).toMatchObject({ block: [{ rule: "writing.sentence.semicolons" }] });
  });
});

describe("skill 的三类信号", () => {
  it("GET /skill/signals 按假时钟算出四份列表，空的时候也是空数组", async () => {
    const t = await thinking();
    const empty = await t.request("GET", "/api/v1/skill/signals");
    expect(empty.status).toBe(200);
    expect(dataOf(empty)).toEqual({
      blockedRules: [],
      outdatedProjects: [],
      stalledRounds: [],
      stalledQueueItems: [],
    });
    // 拨到十天以后：进行中的构思轮和待办的事都停了。
    t.core.setNow(new Date("2026-10-08T08:00:00Z"));
    const later = await t.request("GET", "/api/v1/skill/signals");
    expect(dataOf(later)).toMatchObject({
      stalledRounds: [{ project: "app", round: "v1-构思-1", status: "进行中" }],
    });
  });
});
