import { cliEnvelopeSchema } from "@product-loop/model";
import { describe, expect, it } from "vitest";
import { sandbox } from "./testing.ts";

// ploop status [--all] 和不带子命令的 ploop，对着真的后端跑，见 S13 第 3 步和 S14 第 1 步。

describe("ploop status", { timeout: 60_000 }, () => {
  it("在项目的子目录里、用 --project 写编号或路径，查到的都是同一个项目", () => {
    const s = sandbox();
    s.ploop("proj/app", "init", "--repo", "自己的");
    const head = "项目 app：第 1 版，还没开始任何阶段";
    expect(s.ploop("proj/app/src/deep", "status").stdout.split("\n")[0]).toBe(head);
    expect(s.ploop(".", "status", "--project", "app").stdout.split("\n")[0]).toBe(head);
    expect(s.ploop(".", "--project", "./proj/app", "status").stdout.split("\n")[0]).toBe(head);
  });

  it("--json：标准输出只有一个 JSON 对象，下一步取自后端", () => {
    const s = sandbox();
    s.ploop("proj/app", "init", "--repo", "自己的");
    const { code, stdout, stderr } = s.ploop("proj/app", "--json");
    expect(stdout.trimEnd().split("\n")).toHaveLength(1);
    expect(cliEnvelopeSchema.parse(JSON.parse(stdout))).toMatchObject({
      kind: "project.status",
      ok: true,
      data: {
        project: { id: "app" },
        version: { version: 1, status: "进行中" },
        round: null,
        waitingPages: [],
      },
      next: ["ploop round start 构思"],
    });
    expect(stderr).toBe("");
    expect(code).toBe(0);
  });

  it("--all 列出所有项目，不看当前目录", () => {
    const s = sandbox();
    s.ploop("proj/app", "init", "--repo", "自己的");
    s.ploop("proj/web", "init", "--repo", "自己的");
    const { code, stdout } = s.ploop(".", "status", "--all");
    const lines = stdout.trimEnd().split("\n");
    expect(lines[0]).toBe("列出了 2 个项目：");
    expect(lines.slice(1).sort()).toEqual([
      `  app  第 1 版，还没开始任何阶段，${s.at("proj/app")}`,
      `  web  第 1 版，还没开始任何阶段，${s.at("proj/web")}`,
    ]);
    expect(code).toBe(0);
  });

  it("--all 没有项目时提示开工", () => {
    const s = sandbox();
    const { code, stdout } = s.ploop(".", "status", "--all");
    expect(stdout).toBe("还没有登记过项目。\n\n下一步：\n  1. 在项目的根目录运行 ploop init\n");
    expect(code).toBe(0);
  });

  it("找不到项目：退出码 4，不拉起后端", () => {
    const s = sandbox();
    const { code, stderr } = s.ploop("proj/nothing");
    expect(stderr).toContain("都没有项目缓存。");
    expect(code).toBe(4);
    expect(s.runInfo()).toBeUndefined();
  });

  it("--project 写的编号没有登记：退出码 4", () => {
    const s = sandbox();
    const { code, stderr } = s.ploop(".", "status", "--project", "nosuch");
    expect(stderr).toBe(
      "找不到：没有叫「nosuch」的项目。\n怎么改：运行 ploop status --all，查看已登记的项目。\n",
    );
    expect(code).toBe(4);
  });
});
