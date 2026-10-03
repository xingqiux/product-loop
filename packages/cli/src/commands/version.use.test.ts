import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { cliEnvelopeSchema } from "@product-loop/model";
import { describe, expect, it } from "vitest";
import { fullMainline, sandbox } from "./testing.ts";

// ploop version show|next，对着真的后端跑，见第一期计划第 38 步和「08 版本与迁移」第二节。
// 提前结束这一版要写原因。还有一个阶段没收尾时不能结束，退出码 3。

function opened() {
  const s = sandbox();
  expect(s.ploop("proj/app", "init", "--repo", "自己的").code).toBe(0);
  const run = (...argv: string[]) => s.ploop("proj/app", ...argv);
  return { s, run };
}

describe("ploop version", { timeout: 60_000 }, () => {
  it("show 写当前的一版和它的阶段；next 结束这一版，开始下一版", () => {
    const { s, run } = opened();
    // 收尾构思阶段要求主线十个部分至少写好一半。
    writeFileSync(join(s.at("proj/app"), ".product-loop", "主线.md"), fullMainline);
    const fresh = run("version", "show");
    expect(fresh.stdout).toMatch(/^第 1 版：进行中，[\d-]+ [\d:]+ 开始\n这一版还没有阶段。\n$/u);
    expect(fresh.code).toBe(0);

    run("round", "start", "构思");
    expect(run("version", "show").stdout).toMatch(
      /这一版的阶段：\n {2}第 1 版的构思阶段 {2}进行中\n$/u,
    );
    run("round", "close");
    const next = run("version", "next", "--reason", "跳过提升，先做下一版");
    expect(next.stdout).toBe(
      [
        "进入了第 2 版，第 1 版已结束。",
        "结束的原因：跳过提升，先做下一版",
        "",
        "下一步：",
        "  1. ploop round start 构思",
        "",
      ].join("\n"),
    );
    expect(next.code).toBe(0);
    expect(run("version", "show").stdout).toMatch(/^第 2 版：进行中/u);

    const json = run("version", "show", "--json");
    expect(cliEnvelopeSchema.parse(JSON.parse(json.stdout))).toMatchObject({
      kind: "version.current",
      data: { version: 2, status: "进行中", rounds: [] },
    });
  });

  it("还有一个阶段没收尾：退出码 3；原因只写空白：退出码 2", () => {
    const { run } = opened();
    run("round", "start", "构思");
    const open = run("version", "next", "--reason", "跳过");
    expect(open.stderr.split("\n")[0]).toMatch(/^冲突：第 1 版的构思阶段还没收尾/u);
    expect(open.code).toBe(3);

    const blank = run("version", "next", "--reason", "  ");
    expect(blank.stderr.split("\n")[0]).toBe("用法错误：提前结束一版要写一句原因。");
    expect(blank.code).toBe(2);
  });
});
