import { describe, expect, it } from "vitest";
import { sandbox } from "./testing.ts";

// ploop lint text|reply 读标准输入的几种情形：管道开着没人写、写了空白、在家目录里运行。
// 见审查报告 P23：不带参数运行 lint reply，标准输入是一根没关的管道时，命令不能一直挂着。

describe("lint 读标准输入", { timeout: 60_000 }, () => {
  it("标准输入是一根开着、没人写的管道：几秒后报没有读到文字，退出码 2，不挂住", async () => {
    const s = sandbox();
    const started = Date.now();
    const { done } = s.launch(".", "lint", "reply");
    const run = await done;
    expect(run.stderr).toBe(
      "用法错误：没有要查的文字：标准输入是空的，或者 5 秒内没有传来内容。\n怎么改：写文件的路径，或用管道传入，例如 pbpaste | ploop lint text。\n",
    );
    expect(run.code).toBe(2);
    expect(Date.now() - started).toBeLessThan(30_000);
  });

  it("写了空白也一样；有文字时照常查，在家目录里运行不需要项目", () => {
    const s = sandbox();
    const blank = s.feed(".", "  \n", "lint", "text");
    expect(blank.stderr).toContain("用法错误：没有要查的文字：标准输入是空的");
    expect(blank.code).toBe(2);
    const good = s.feed(".", "先理清给谁用。\n", "lint", "text");
    expect(good.stdout.split("\n")[0]).toBe("查过了：没有拦截");
    expect(good.code).toBe(0);
  });

  it("lint reply 也查措辞一类：只警告，写出怎么改，退出码 0（F07）", () => {
    const s = sandbox();
    const said = s.feed(".", "第 3 版的提升阶段：这次改了 5 处，共 12 个文件。\n", "lint", "reply");
    expect(said.code).toBe(0);
    expect(said.stdout.split("\n")[0]).toBe("查过了：没有拦截，警告 1 条");
    expect(said.stderr).toContain("警告：出现「5 处」。不对用户报统计数字");
    expect(said.stderr).toContain("怎么改：是引用就留着，是写错了就改");
    expect(said.stderr).toContain("规矩：writing.wording.statistics");
  });
});
