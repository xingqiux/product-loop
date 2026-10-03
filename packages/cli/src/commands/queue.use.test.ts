import { cliEnvelopeSchema } from "@product-loop/model";
import { describe, expect, it } from "vitest";
import { sandbox } from "./testing.ts";

// ploop queue 各子命令，对着真的后端跑，见第一期计划第 34 步和「04 命令行」第三节。
// 放进去打印 Q1。drop 不写 --reason 时退出码 2，只写空白时后端拦截，退出码 1。

function opened() {
  const s = sandbox();
  expect(s.ploop("proj/app", "init", "--repo", "自己的").code).toBe(0);
  const q = (...argv: string[]) => s.ploop("proj/app", "queue", ...argv);
  return { s, q };
}

describe("ploop queue", { timeout: 60_000 }, () => {
  it("add 打印 Q1，再放一件是 Q2；list 只列没做完的", () => {
    const { q } = opened();
    const first = q("add", "设置页的保存按钮在窄屏被挡住", "--stage", "落地");
    expect(first.stdout).toBe(
      [
        "放进了队列：Q1",
        "落地，待办：设置页的保存按钮在窄屏被挡住",
        "",
        "下一步：",
        "  1. ploop queue list",
        "",
      ].join("\n"),
    );
    expect(first.stderr).toBe("");
    expect(first.code).toBe(0);
    expect(q("add", "队列看板加上按阶段筛选", "--stage", "构思").stdout).toMatch(
      /^放进了队列：Q2\n/u,
    );

    expect(q("drop", "Q1", "--reason", "已在第 1 版的落地阶段修掉").code).toBe(0);
    expect(q("list").stdout).toBe("列出了 1 件事：\n  Q2  待办  构思  队列看板加上按阶段筛选\n");
    expect(q("list", "--all").stdout).toBe(
      [
        "列出了 2 件事：",
        "  Q1  已取消  落地  设置页的保存按钮在窄屏被挡住",
        "  Q2  待办    构思  队列看板加上按阶段筛选",
        "",
      ].join("\n"),
    );
    expect(q("list", "--stage", "落地", "--status", "已取消", "--status", "待办").stdout).toMatch(
      /^列出了 1 件事：\n {2}Q1 {2}已取消/u,
    );
  });

  it("list --limit：事多时文字只列最近放进来的几件，按编号排，写明还有几件；--limit 0 列全部；--json 里仍是全部", () => {
    const { q } = opened();
    for (const name of ["甲", "乙", "丙"]) {
      expect(q("add", `事情${name}`, "--stage", "构思").code).toBe(0);
    }
    expect(q("list", "--limit", "2").stdout).toBe(
      [
        "列出了最近的 2 件事，共 3 件：",
        "  Q2  待办  构思  事情乙",
        "  Q3  待办  构思  事情丙",
        "还有更早的 1 件没列出，加 --limit 0 重新运行可以列出全部。",
        "",
      ].join("\n"),
    );
    expect(q("list", "--limit", "0").stdout.split("\n")[0]).toBe("列出了 3 件事：");
    const json = JSON.parse(q("list", "--limit", "2", "--json").stdout) as { data: unknown[] };
    expect(json.data).toHaveLength(3);
    expect(q("list", "--limit", "-1").code).toBe(2);
  });

  it("内容里有停用的说法：写出怎么改，位置写字段的名字，不写内部的参数名（P25）", () => {
    const { q } = opened();
    const bad = q(
      "add",
      "替人用的脚本要改",
      "--stage",
      "落地",
      "--item",
      "设置页",
      "--item",
      "替人用的脚本",
    );
    expect(bad.stderr).toBe(
      [
        "拦截：出现了术语表停用的说法「替人用的脚本」，统一的术语是「走查脚本」",
        "位置：内容；子项 2",
        "怎么改：改成术语表里的说法「走查脚本」，或者换一种说法。引号里的原话不用改",
        "规矩：writing.term.banned",
        "",
      ].join("\n"),
    );
    expect(bad.code).toBe(1);
  });

  it("add --json：标准输出只有一个 JSON 对象，data 是这件事", () => {
    const { q } = opened();
    const { code, stdout, stderr } = q("add", "设置页的按钮被挡住", "--stage", "落地", "--json");
    expect(stdout.trimEnd().split("\n")).toHaveLength(1);
    expect(cliEnvelopeSchema.parse(JSON.parse(stdout))).toMatchObject({
      kind: "queue.added",
      ok: true,
      data: { id: "Q1", status: "待办", stage: "落地", proposer: "AI", editCount: 0 },
      next: ["ploop queue list"],
    });
    expect(stderr).toBe("");
    expect(code).toBe(0);
  });

  it("drop 不写 --reason 退出码 2；只写空白时拦截，退出码 1 并带规矩编号；写了原因才取消", () => {
    const { q } = opened();
    q("add", "设置页的保存按钮在窄屏被挡住", "--stage", "落地");

    const missing = q("drop", "Q1");
    expect(missing.stderr).toContain("用法错误：ploop queue drop 缺少必填的选项 --reason <原因>。");
    expect(missing.code).toBe(2);

    const blank = q("drop", "Q1", "--reason", "  ", "--json");
    expect(cliEnvelopeSchema.parse(JSON.parse(blank.stdout))).toMatchObject({
      ok: false,
      error: { code: "RULE_BLOCKED", rule: "queue.drop.reason" },
    });
    expect(blank.code).toBe(1);

    const dropped = q("drop", "Q1", "--reason", "已在第 1 版的落地阶段修掉");
    expect(dropped.stdout.split("\n")[0]).toBe("取消了：Q1");
    expect(dropped.code).toBe(0);
    expect(q("show", "Q1").stdout).toContain("状态说明：已在第 1 版的落地阶段修掉\n");
  });

  it("wait 写明依赖；edit 按修改计数改内容；show 列出字段和状态变化", () => {
    const { q } = opened();
    q("add", "队列看板加上按阶段筛选", "--stage", "构思", "--item", "看板", "--item", "列表");

    const waiting = q("wait", "Q1", "--depends-on", "等构思定下场景 S4");
    expect(waiting.stdout.split("\n").slice(0, 2)).toEqual([
      "改成等待：Q1",
      "构思，等待：队列看板加上按阶段筛选",
    ]);

    const edited = q("edit", "Q1", "--content", "队列看板按阶段筛选", "--no-items");
    expect(edited.stdout.split("\n")[0]).toBe("改好了：Q1");
    expect(q("edit", "Q1", "--acceptance", "只看一个阶段时其余的列隐藏").stdout).toMatch(
      /^改好了：Q1\n/u,
    );

    const shown = q("show", "Q1").stdout.split("\n");
    expect(shown.slice(0, 3)).toEqual(["Q1：队列看板按阶段筛选", "状态：等待", "阶段：构思"]);
    expect(shown).toContain("依赖：等构思定下场景 S4");
    expect(shown).toContain("验收标准：只看一个阶段时其余的列隐藏");
    expect(shown).not.toContain("子项：");
    expect(shown.filter((line) => line.endsWith("待办 → 等待：等构思定下场景 S4"))).toHaveLength(1);
  });

  it("add --note 放进多行备注，show 写在内容下面，edit --note 整份改，--no-note 删掉", () => {
    const { q } = opened();
    const note = "第一行：先做筛选条\n\n第二行：再做隐藏其余的列";
    const added = q("add", "队列看板按阶段筛选", "--stage", "构思", "--note", note);
    expect(added.code).toBe(0);
    expect(q("show", "Q1").stdout.split("\n").slice(0, 7)).toEqual([
      "Q1：队列看板按阶段筛选",
      "备注：",
      "  第一行：先做筛选条",
      "",
      "  第二行：再做隐藏其余的列",
      "状态：待办",
      "阶段：构思",
    ]);
    const json = JSON.parse(q("show", "Q1", "--json").stdout) as {
      data: { item: { note?: string; editCount: number } };
    };
    expect(json.data.item).toMatchObject({ note, editCount: 0 });

    expect(q("edit", "Q1", "--note", "只剩一行").code).toBe(0);
    expect(q("show", "Q1").stdout.split("\n").slice(0, 3)).toEqual([
      "Q1：队列看板按阶段筛选",
      "备注：只剩一行",
      "状态：待办",
    ]);

    expect(q("edit", "Q1", "--no-note").code).toBe(0);
    const shown = q("show", "Q1").stdout;
    expect(shown).not.toContain("备注");
    const after = JSON.parse(q("show", "Q1", "--json").stdout) as {
      data: { item: Record<string, unknown> };
    };
    expect(after.data.item).not.toHaveProperty("note");
    expect(after.data.item.editCount).toBe(2);
  });

  it("内容超过 40 个字：add 和 edit 都拦截，写明字数和改法，备注写多长都放行", () => {
    const { q } = opened();
    const long =
      "队列看板按阶段分五列，等待的事放在最上面，停了七天的卡片显示得淡一些，点开卡片能看到各项属性";
    const added = q("add", long, "--stage", "构思");
    expect(added.stderr).toBe(
      [
        "拦截：内容有 43 个字，超过 40 个字。",
        "怎么改：缩短到 40 个字以内，细节写进 --note。",
        "规矩：queue.content.tooLong",
        "",
      ].join("\n"),
    );
    expect(added.code).toBe(1);
    expect(q("list", "--all").stdout).toContain("没有符合条件的事。");

    const ok = q("add", "队列看板按阶段分五列", "--stage", "构思", "--note", long.repeat(3));
    expect(ok.code).toBe(0);
    const edited = q("edit", "Q1", "--content", long);
    expect(edited.stderr).toContain("怎么改：缩短到 40 个字以内，细节写进 --note。");
    expect(edited.stderr).toContain("规矩：queue.content.tooLong");
    expect(edited.code).toBe(1);
    expect(q("edit", "Q1", "--note", long).code).toBe(0);
    expect(q("show", "Q1").stdout.split("\n")[0]).toBe("Q1：队列看板按阶段分五列");
  });

  it("备注写成只有空白：请求不合定义，退出码 2，写明没有写备注，什么都不放进去", () => {
    const { q } = opened();
    const blank = q("add", "队列看板按阶段筛选", "--stage", "构思", "--note", "  ");
    expect(blank.code).toBe(2);
    expect(blank.stderr).toContain("没有写备注。");
    expect(q("list", "--all").stdout).toContain("没有符合条件的事。");
  });

  it("edit 什么都没写：用法错误；待办的事不能直接做完：拦截，退出码 1", () => {
    const { q } = opened();
    q("add", "设置页的按钮被挡住", "--stage", "落地");
    expect(q("edit", "Q1").code).toBe(2);
    // 进行中只由开始一个阶段拿出来，待办的事改不到已完成。
    const blocked = q("done", "Q1", "--evidence", "提交 3f2a9c1");
    expect(blocked.stderr).toContain("规矩：queue.status.graph");
    // 没有别的路可走时，说明先由一个阶段拿出来，再写证据。
    expect(blocked.stderr).toContain(
      "怎么改：待办只能改成进行中、等待或已取消。先运行 ploop round start 落地，把它拿成进行中。做完写 ploop round close --done Q1=<证据>。",
    );
    expect(blocked.code).toBe(1);
  });

  it("等待和已取消的事用 reopen 改回待办；已经是待办的不算错；已完成的拦下", () => {
    const { s, q } = opened();
    q("add", "队列看板加上按阶段筛选", "--stage", "构思");
    q("add", "设置页的保存按钮在窄屏被挡住", "--stage", "落地");
    q("wait", "Q1", "--depends-on", "等构思定下场景 S4");
    q("drop", "Q2", "--reason", "用户说先不做");

    const back = q("reopen", "Q1", "--reason", "场景 S4 定下了");
    expect(back.stdout).toBe(
      [
        "改回待办：Q1",
        "构思，待办：队列看板加上按阶段筛选",
        "下一次开始构思阶段时，会拿出它。",
        "",
        "下一步：",
        "  1. ploop queue list",
        "",
      ].join("\n"),
    );
    expect(back.code).toBe(0);
    expect(q("reopen", "Q2").stdout.split("\n")[0]).toBe("改回待办：Q2");
    expect(q("reopen", "Q2").code).toBe(0);
    const shown = q("show", "Q1").stdout;
    expect(shown).toContain("等待 → 待办：场景 S4 定下了");
    expect(q("list").stdout.split("\n")[0]).toBe("列出了 2 件事：");

    // 已完成的事不能改回：要重新做，就放进一件新的。
    expect(s.ploop("proj/app", "round", "start", "构思").code).toBe(0);
    expect(q("done", "Q1", "--evidence", "提交 3f2a9c1").code).toBe(0);
    const done = q("reopen", "Q1");
    expect(done.stderr).toContain("拦截：Q1 已经完成，不能再改状态。");
    expect(done.stderr).toContain("怎么改：要重新做，就放进一件新的，在来源里写明接的是 Q1。");
    expect(done.code).toBe(1);
  });

  it("等待的事不能直接做完或拿进阶段：写出能运行的 queue reopen", () => {
    const { s, q } = opened();
    q("add", "设置页的保存按钮在窄屏被挡住", "--stage", "落地");
    q("wait", "Q1", "--depends-on", "等构思定下场景 S4");
    const taken = s.ploop("proj/app", "round", "start", "落地", "--take", "Q1");
    expect(taken.stderr).toContain("拦截：Q1 现在是等待，不能改成进行中。");
    expect(taken.stderr).toContain("怎么改：先运行 ploop queue reopen Q1，改回待办。");
    expect(taken.code).toBe(1);
    const started = s.ploop("proj/app", "round", "start", "落地");
    expect(started.stdout).toContain("这个阶段没有待办的事。");
    expect(started.stdout).toContain(
      "还在等待的事，这次没有拿出来：\n  Q1  设置页的保存按钮在窄屏被挡住（等：等构思定下场景 S4）\n  等的事做完了，运行 ploop queue reopen Q1，改回待办。",
    );
  });

  it("edit --stage 改标阶段，--status-note 和 --evidence 只改文字，状态不变", () => {
    const { s, q } = opened();
    q("add", "队列看板加上按阶段筛选", "--stage", "提升");
    const restaged = q("edit", "Q1", "--stage", "落地");
    expect(restaged.stdout.split("\n").slice(0, 2)).toEqual([
      "改好了：Q1",
      "落地，待办：队列看板加上按阶段筛选",
    ]);
    expect(q("edit", "Q1", "--stage", "评审").code).toBe(2);

    // 没有状态说明、没有证据的事，写明原因，不改。
    const none = q("edit", "Q1", "--evidence", "提交 3f2a9c1");
    expect(none.stderr).toContain("Q1 现在是待办，没有证据可改。");
    expect(none.code).toBe(2);

    q("wait", "Q1", "--depends-on", "等第 1 轮的结果");
    expect(q("edit", "Q1", "--status-note", "等第 1 版的构思阶段的结果").code).toBe(0);
    const shown = q("show", "Q1").stdout.split("\n");
    expect(shown).toContain("依赖：等第 1 版的构思阶段的结果");
    expect(shown).toContain("状态：等待");
    expect(
      shown.filter((line) => line.endsWith("待办 → 等待：等第 1 版的构思阶段的结果")),
    ).toHaveLength(1);

    // 已完成的事：证据和状态说明是同一句话，改一处两处一起改，状态不变。
    expect(q("reopen", "Q1").code).toBe(0);
    expect(s.ploop("proj/app", "round", "start", "落地").code).toBe(0);
    expect(q("done", "Q1", "--evidence", "第 1 轮的改后截图").code).toBe(0);
    expect(q("edit", "Q1", "--evidence", "第 1 版的落地阶段的改后截图").code).toBe(0);
    const done = q("show", "Q1").stdout.split("\n");
    expect(done).toContain("状态：已完成");
    expect(done).toContain("证据：第 1 版的落地阶段的改后截图");
    expect(done.filter((line) => line.includes("第 1 轮"))).toEqual([]);
    expect(done.at(-2)).toMatch(
      /进行中 → 已完成，在第 1 版的落地阶段：第 1 版的落地阶段的改后截图$/u,
    );
    const blockedStage = q("edit", "Q1", "--stage", "构思");
    expect(blockedStage.stderr).toContain("Q1 已经是已完成，不改它的阶段。");
  });

  it("没有这件事：退出码 4", () => {
    const { q } = opened();
    const { code, stderr } = q("show", "Q9");
    expect(stderr.split("\n")[0]).toBe("找不到：项目「app」的队列里没有 Q9。");
    expect(code).toBe(4);
  });
});
