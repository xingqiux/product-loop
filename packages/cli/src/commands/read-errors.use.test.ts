import { describe, expect, it } from "vitest";
import { sandbox } from "./testing.ts";

// 读文件、运行程序出错时，不把系统的错误码（ENOENT、EISDIR）原样给人看，写清缺什么、先做什么，见审查报告 P26、P27。

describe("读文件出错的说法", { timeout: 60_000 }, () => {
  it("lint text：文件不存在、是文件夹，各写成一句话，退出码 4", () => {
    const s = sandbox();
    const missing = s.ploop("proj/app", "lint", "text", "没有这个.md");
    expect(missing.stderr).toBe(
      [
        "找不到：没有这个.md 读不出来：文件不存在。",
        "怎么改：写对文件的路径，或者不写文件，从标准输入读。",
        "",
      ].join("\n"),
    );
    expect(missing.code).toBe(4);
    const dir = s.ploop("proj/app", "lint", "text", ".");
    expect(dir.stderr).toContain("读不出来：这是一个文件夹，不是文件。");
    expect(dir.stderr).not.toMatch(/EISDIR|ENOENT/u);
    expect(dir.code).toBe(4);
  });

  it("use ingest、reply handle --file、page check：都写原因，不露出错误码", () => {
    const s = sandbox();
    const run = (...argv: string[]) => s.ploop("proj/app", ...argv);
    expect(run("init", "--repo", "自己的", "--hook", "否").code).toBe(0);

    const ingest = run("use", "ingest", "/nonexistent");
    expect(ingest.stderr).toContain("/nonexistent/use-run.json 读不出来：文件不存在。");
    expect(ingest.stderr).toContain("里面要有使用代码写出的 use-run.json");
    expect(ingest.code).toBe(4);

    expect(run("round", "start", "构思").code).toBe(0);
    const handle = run("reply", "handle", "--file", "nope.json");
    expect(handle.stderr).toContain("nope.json 读不出来：文件不存在。");
    expect(handle.code).toBe(4);

    const check = run("page", "check", "nope.json");
    expect(check.stderr).toContain("页面数据读不出来：没有这个文件。");
    expect(check.stderr).not.toMatch(/ENOENT|EACCES/u);
    expect(check.code).toBe(4);
  });

  it("运行的程序不存在：说找不到这个程序，不写 ENOENT", () => {
    const s = sandbox();
    const run = (...argv: string[]) => s.ploop("proj/app", ...argv);
    expect(run("init", "--repo", "自己的", "--hook", "否").code).toBe(0);
    expect(run("round", "start", "使用").code).toBe(0);
    const missing = run("use", "run", "--", "没有这个程序-ploop-test");
    expect(missing.stderr).toContain(
      "使用代码没有跑起来：找不到这个程序，确认名字写对了、已经装好。",
    );
    expect(missing.stderr).not.toContain("ENOENT");
    expect(missing.code).toBe(4);
  });

  it("open 的浏览器程序不存在：警告里写找不到这个程序，地址照样打印", async () => {
    const s = sandbox();
    expect(s.ploop("proj/app", "init", "--repo", "自己的", "--hook", "否").code).toBe(0);
    s.env.PLOOP_BROWSER = "/没有/这个浏览器";
    const opened = s.ploop("proj/app", "open", "--all");
    expect(opened.stdout).toMatch(/^没能打开浏览器，请手动打开：http:\/\/127\.0\.0\.1:\d+\/\n/u);
    expect(opened.stderr).toContain("没有跑起来：找不到这个程序");
    expect(opened.stderr).not.toContain("ENOENT");
    expect(opened.code).toBe(0);
  });
});
