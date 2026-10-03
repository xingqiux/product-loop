import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fullMainline, sandbox } from "./testing.ts";

// ploop use 各子命令和使用阶段的收尾，对着真的后端跑，见第一期计划第 53、54 步。
// 抄录 S19：use run -- <命令> 给使用代码一个 PLOOP_USE_OUT，结果收进集中存储。
// 断了的步逐条列出。coverage 列出覆盖表的缺口。收尾时有断点或缺口就拦截。
// 使用阶段收尾以后开始检查，列出这一版新出现的屏。

/** 一像素的 PNG。 */
const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

/** 主线的 S1 有两步。 */
const mainline = fullMainline.replace(
  "1. 点队列 → 看到看板",
  "1. 点队列 → 看到看板\n2. 点一件事 → 右边摆出详情",
);

/** 使用代码：S1 第 1 步截图通过；BROKEN 文件在时第 2 步断了，退出码 1。 */
const script = `
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const out = process.env.PLOOP_USE_OUT;
const broken = existsSync("BROKEN");
writeFileSync(join(out, "s1-1.png"), Buffer.from("${png}", "base64"));
const second = broken
  ? { result: "断了", error: "右边是空的" }
  : { result: "通过" };
const run = {
  schemaVersion: 1,
  scenes: [{ scene: "S1", steps: [
    { step: 1, width: 1400, do: "点队列", expect: "看到看板", result: "通过", screenshot: "s1-1.png" },
    { step: 2, do: "点一件事", expect: "右边摆出详情", ...second },
  ] }],
};
writeFileSync(join(out, "use-run.json"), JSON.stringify(run));
console.log(broken ? "S1 第 2 步断了" : "都走通了");
process.exit(broken ? 1 : 0);
`;

const gapTable = ["| 东西 | 场景 |", "| --- | --- |", "| 队列看板 | S1 |", "| 导出按钮 | |"].join(
  "\n",
);
const fullTable = ["| 东西 | 场景 |", "| --- | --- |", "| 队列看板 | S1 |"].join("\n");

/**
 * 开着第 1 版的使用阶段，拿出了 Q1，使用代码和覆盖表写在项目里。
 * 自己的仓库放在 scripts/use/，共用的仓库放在 .product-loop/use-code/，见决定 107。
 */
function using(repo: "自己的" | "共用的" = "自己的") {
  const s = sandbox();
  const dir = s.at("proj/app");
  const run = (...argv: string[]) => s.ploop("proj/app", ...argv);
  const codeDir = repo === "自己的" ? join("scripts", "use") : join(".product-loop", "use-code");
  if (repo === "共用的") s.gitInit("proj/app");
  expect(run("init", "--repo", repo, "--hook", "否").code).toBe(0);
  writeFileSync(join(dir, ".product-loop", "主线.md"), mainline);
  mkdirSync(join(dir, codeDir), { recursive: true });
  writeFileSync(join(dir, codeDir, "run.mjs"), script);
  writeFileSync(join(dir, codeDir, "覆盖表.md"), gapTable);
  writeFileSync(join(dir, "BROKEN"), "");
  expect(run("queue", "add", "走一遍看队列", "--stage", "使用").code).toBe(0);
  expect(run("round", "start", "使用").code).toBe(0);
  return { s, dir, run, codeDir };
}

describe("S19 跑使用代码", { timeout: 90_000 }, () => {
  it("运行、列出断点和覆盖表的缺口、收尾被拦，修好以后收尾，开始检查时列出新出现的屏", () => {
    const { s, dir, run } = using();
    const ran = s.ploop("proj/app/scripts", "use", "run", "--", "node", "scripts/use/run.mjs");
    const lines = ran.stdout.split("\n");
    expect(lines[0]).toBe("收下了使用代码的运行：通过 1 步，断了 1 步");
    expect(lines[1]).toBe("运行：node scripts/use/run.mjs，退出码 1");
    expect(lines).toContain("断了的步：");
    expect(lines).toContain("  S1 第 2 步：右边是空的");
    expect(lines).toContain("截图：上传 1 张，后端已有 0 张");
    expect(lines).toContain("覆盖表：scripts/use/覆盖表.md，2 行，缺口 1 行");
    expect(lines).toContain("  S1 第 2 步断了");
    // 有断了的步，退出码不是 0，靠退出码判断使用有没有通过的脚本不会误认为通过。
    expect(ran.code).toBe(1);
    const outDirs = readdirSync(join(dir, ".product-loop", "use"));
    expect(outDirs).toHaveLength(1);
    expect(existsSync(join(dir, ".product-loop", "use", outDirs[0] ?? "", "use-run.json"))).toBe(
      true,
    );

    const coverage = run("use", "coverage");
    expect(coverage.stderr).toContain("覆盖表第 4 行「导出按钮」没有场景用到。");
    expect(coverage.code).toBe(1);

    const changed = run("use", "changed");
    expect(changed.stdout.split("\n").slice(0, 2)).toEqual([
      "第 1 版新出现或变过的屏，按场景分组：",
      "  S1 看队列    第 1 步",
    ]);

    const blocked = run("round", "close", "--done", "Q1=走完了");
    expect(blocked.stderr).toContain("这个阶段最近一次运行有 1 步断了：S1 第 2 步。");
    expect(blocked.stderr).toContain("覆盖表有 1 行没有场景用到：导出按钮。");
    expect(blocked.stderr).toContain("规矩：use.leave");
    expect(blocked.code).toBe(1);

    // 开始下一个阶段拦下的也是这个原因，不写成「别的会话还开着」。
    const early = run("round", "start", "检查");
    expect(early.stderr).toContain("拦截：这个阶段最近一次运行有 1 步断了：S1 第 2 步。");
    expect(early.stderr).toContain("规矩：use.leave");
    expect(early.stderr).not.toContain("怕别的会话在做");
    expect(early.code).toBe(1);

    writeFileSync(join(dir, "scripts", "use", "覆盖表.md"), fullTable);
    rmSync(join(dir, "BROKEN"));
    const fixed = run("use", "run", "--", "node", "scripts/use/run.mjs");
    expect(fixed.stdout.split("\n")[0]).toBe("收下了使用代码的运行：通过 2 步，断了 0 步");
    // 没有断点和缺口：后端自动给用户看一页使用记录，不用再敲 page present。Q1 还在进行中，下一步是收尾。
    expect(fixed.stdout).toContain("给用户看了一页使用记录：第 1 页，不等回复");
    expect(fixed.stdout).toContain("下一步：\n  1. ploop round close\n");
    expect(fixed.stdout).not.toContain("目录名里的时间是 UTC");
    expect(fixed.code).toBe(0);
    expect(run("use", "coverage").stdout.split("\n")[0]).toBe(
      "覆盖表没有缺口：scripts/use/覆盖表.md，1 行",
    );

    const closed = run("round", "close", "--done", "Q1=走完了");
    expect(closed.stdout.split("\n")[0]).toBe("收尾了：第 1 版的使用阶段");
    expect(closed.code).toBe(0);

    const check = run("round", "start", "检查");
    expect(check.stdout).toContain(
      "这一版新出现或变过的屏，按场景分组：\n  S1 看队列    第 1 步\n",
    );
    expect(check.code).toBe(0);
  });

  it("A03 运行没走到主线里的步：列出没走到的步，退出码 1，收尾被拦，规矩是 use.leave", () => {
    const { s, dir, run } = using();
    writeFileSync(join(dir, "scripts", "use", "覆盖表.md"), fullTable);
    rmSync(join(dir, "BROKEN"));
    // 使用代码只走了 S1 的第 1 步，主线里 S1 有两步。
    const shortScript = script.replace(
      /\{ step: 2, do: "点一件事", expect: "右边摆出详情", \.\.\.second \},/u,
      "",
    );
    writeFileSync(join(dir, "scripts", "use", "short.mjs"), shortScript);
    const ran = s.ploop("proj/app", "use", "run", "--", "node", "scripts/use/short.mjs");
    expect(ran.stdout).toContain("主线里有 1 步这次运行没走到：\n  S1 第 2 步\n");
    expect(ran.stdout).not.toContain("给用户看了一页使用记录");
    expect(ran.stdout).toContain("下一步：\n  1. ploop use run -- node scripts/use/short.mjs\n");
    expect(ran.code).toBe(1);
    const blocked = run("round", "close", "--done", "Q1=走完了");
    expect(blocked.stderr).toContain("主线里有 1 步最近一次运行没走到：S1 第 2 步。");
    expect(blocked.stderr).toContain("规矩：use.leave");
    expect(blocked.code).toBe(1);
  });

  it("D02 使用阶段自动给出的页：开始下一个阶段时自动收尾，不用敲 round close", () => {
    const { dir, run } = using();
    writeFileSync(join(dir, "scripts", "use", "覆盖表.md"), fullTable);
    rmSync(join(dir, "BROKEN"));
    expect(run("use", "run", "--", "node", "scripts/use/run.mjs").code).toBe(0);
    expect(run("queue", "drop", "Q1", "--reason", "用不着单独跑").code).toBe(0);
    const status = run("status");
    expect(status.stdout).toContain("下一步：\n  1. ploop round start 检查\n");
    const next = run("round", "start", "检查");
    expect(next.stdout).toContain("开始以前替第 1 版的使用阶段收了尾。");
    expect(next.code).toBe(0);
  });

  it("使用代码崩了没写 use-run.json：报它自己的退出码和输出末尾，不只说文件没写", () => {
    const { run } = using();
    const crashed = run("use", "run", "--", "sh", "-c", "echo boom >&2; exit 3");
    expect(crashed.stderr).toMatch(
      /使用代码以退出码 3 结束，没有写出 \.product-loop\/use\/\d{8}T\d{6}Z\/use-run\.json。/u,
    );
    expect(crashed.stderr).toContain("输出的末尾：\n  boom");
    expect(crashed.stderr).toContain("修好使用代码再运行");
    expect(crashed.stderr).not.toContain("读不出来：ENOENT");
    expect(crashed.stderr).toContain("规矩：use.run.crashed");
    expect(crashed.code).toBe(1);
  });

  it("使用代码正常结束却没写 use-run.json：说清楚是没写文件，指到 PLOOP_USE_OUT；use schema 打印定义", () => {
    const { run } = using();
    const missing = run("use", "run", "--", "node", "--eval", "1");
    expect(missing.stderr).toMatch(
      /使用代码正常结束了，可是没有写出 \.product-loop\/use\/\d{8}T\d{6}Z\/use-run\.json。/u,
    );
    expect(missing.stderr).toContain("PLOOP_USE_OUT");
    expect(missing.stderr).toContain("规矩：use.run.crashed");
    expect(missing.code).toBe(1);
    const schema = run("use", "schema");
    const parsed = JSON.parse(schema.stdout) as { properties: Record<string, unknown> };
    expect(Object.keys(parsed.properties)).toContain("scenes");
    expect(schema.code).toBe(0);
    // 日期时间字段只留 format，几百个字的正则去掉了；场景编号、截图路径的正则有用，留着。
    expect(parsed.properties.startedAt).toMatchObject({ type: "string", format: "date-time" });
    expect(parsed.properties.startedAt).not.toHaveProperty("pattern");
    expect(schema.stdout).toContain('"pattern": "^S[1-9][0-9]*$"');
  });

  it("共用的仓库：覆盖表默认在 .product-loop/use-code/，开始使用阶段和收尾被拦的提示也写这里（决定 107）", () => {
    const { run, dir, codeDir } = using("共用的");
    const ran = run("use", "run", "--", "node", `${codeDir}/run.mjs`);
    expect(ran.stdout).toContain("覆盖表：.product-loop/use-code/覆盖表.md，2 行，缺口 1 行");
    const coverage = run("use", "coverage");
    expect(coverage.stderr).toContain("位置：.product-loop/use-code/覆盖表.md:4");
    // 仓库里一个字节都不变：使用代码在被忽略的项目缓存里，git 看不到。
    expect(existsSync(join(dir, "scripts"))).toBe(false);
  });

  it("共用的仓库：没有覆盖表时，收尾被拦的提示写 .product-loop/use-code/覆盖表.md；自己的仓库写 scripts/use/覆盖表.md", () => {
    for (const [repo, file] of [
      ["共用的", ".product-loop/use-code/覆盖表.md"],
      ["自己的", "scripts/use/覆盖表.md"],
    ] as const) {
      const { run, dir, codeDir } = using(repo);
      rmSync(join(dir, codeDir, "覆盖表.md"));
      rmSync(join(dir, "BROKEN"));
      const ran = run("use", "run", "--", "node", `${codeDir}/run.mjs`);
      expect(ran.stdout).toContain(`覆盖表：${file} 不在，这次运行没有带覆盖表`);
      const blocked = run("round", "close");
      expect(blocked.stderr).toContain(`写好 ${file}，再运行一次使用代码。`);
    }
  });

  it("开始使用阶段时，先做什么里写使用代码放在哪里：跟着仓库是谁的走", () => {
    for (const [repo, dir] of [
      ["共用的", ".product-loop/use-code/"],
      ["自己的", "scripts/use/"],
    ] as const) {
      const s = sandbox();
      if (repo === "共用的") s.gitInit("proj/app");
      const run = (...argv: string[]) => s.ploop("proj/app", ...argv);
      expect(run("init", "--repo", repo, "--hook", "否").code).toBe(0);
      const started = run("round", "start", "使用");
      expect(started.stdout).toContain(`放在 ${dir}，覆盖表写在 ${dir}覆盖表.md`);
    }
  });
});
