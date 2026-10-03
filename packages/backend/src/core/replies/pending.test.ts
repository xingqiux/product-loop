import { describe, expect, it } from "vitest";
import { presentPage } from "../pages/present.ts";
import { deps, presentInput, succeed } from "../pages/testing.ts";
import { startRound } from "../rounds/start.ts";
import { addProject, emptyCore, type TestCore } from "../testing.ts";
import { handleLine } from "./handle.ts";
import { unclearTermsOf, unhandledReplies } from "./pending.ts";
import { submitReply } from "./submit.ts";
import { cardIds, submitDeps } from "./testing.ts";

// 依赖回复的上下文：还有行没处理的回复，和上一份回复点了不明白的术语。
// 后一样用在 align.unclear.reworded：项目 app 开着第一轮构思，给出的一页先对齐「看板」，
// 用户点了不明白，下一页的讲法没变时警告。

/** 疑问卡的来源是用户的原话，这一页不引用截图。 */
const ask = {
  title: "看板放在哪里",
  why: "看板在首页最下面，要翻两屏才看得到。",
  sources: [{ name: "用户昨天说的", saw: "「看板太靠下了」", quote: true }],
};

/** 先对齐里的「看板」，意思和例子可以换。 */
function page(meaning: string, example: string) {
  return {
    align: [{ name: "看板", usedIn: [ask.title], meaning, example }],
    asks: [ask],
  };
}

const meaning = "工作台首页上按阶段排的队列。";
const example = "Q12 排在检查那一列。";

function presentThink(core: TestCore, data: unknown) {
  return succeed(presentPage(core.ctx, "app", presentInput(data, { round: "v1-构思-1" }), deps));
}

/** 开着第一轮构思，给出一页，用户对「看板」点了不明白。返回回复的编号。 */
async function unclearReplied(): Promise<{ core: TestCore; sid: number }> {
  const core = await emptyCore();
  addProject(core, "/work/app");
  succeed(startRound(core.ctx, "app", { stage: "think" }));
  const presented = presentThink(core, page(meaning, example));
  const [align] = cardIds(core, presented.page.id);
  const lines = [{ section: "align", card: align, kind: "notUnderstood" }] as const;
  const submitted = submitReply(
    core.ctx,
    "app",
    presented.page.id,
    { source: "workbench", lines },
    submitDeps,
  );
  return { core, sid: succeed(submitted).submission.id };
}

describe("上一份回复点了不明白的术语", () => {
  it("取那一页上写的名称、意思和例子", async () => {
    const { core } = await unclearReplied();
    expect(unclearTermsOf(core.ctx.db, "app")).toEqual([
      { name: "看板", meaning, example, round: "v1-构思-1" },
    ]);
  });

  it("下一页的意思和例子都没变时，给出信息带 align.unclear.reworded 的警告", async () => {
    const { core, sid } = await unclearReplied();
    expect(unhandledReplies(core.ctx.db, "app")).toEqual([
      { submission: sid, round: "v1-构思-1", lines: [1] },
    ]);
    succeed(handleLine(core.ctx, "app", sid, 1, { to: "noAction", reason: "下一页换讲法" }));
    expect(unhandledReplies(core.ctx.db, "app")).toEqual([]);
    const same = presentThink(core, page(meaning, example));
    expect(same.warnings.filter((w) => w.rule === "align.unclear.reworded")).toEqual([
      {
        rule: "align.unclear.reworded",
        message: "用户在 v1-构思-1 点了不明白的「看板」，这一页的意思和例子都没变。",
        hint: "换一种讲法：改写意思，或者换一个这个项目里的例子。",
        where: "align[0]",
      },
    ]);
  });

  it("换了例子就不警告", async () => {
    const { core, sid } = await unclearReplied();
    succeed(handleLine(core.ctx, "app", sid, 1, { to: "noAction", reason: "下一页换讲法" }));
    const changed = presentThink(core, page(meaning, "用户打开首页，检查那一列里排着 Q12。"));
    expect(changed.warnings.map((w) => w.rule)).not.toContain("align.unclear.reworded");
  });
});
