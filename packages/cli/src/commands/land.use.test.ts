import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { sandbox } from "./testing.ts";

// ploop land 各子命令和落地阶段的收尾，对着真的后端跑，见第一期计划第 50、51 步。
// 抄录 S18：在临时 git 仓库里做一件先失败后通过的改动。检查命令在当前所在的项目根目录里运行，
// 提交号也从那里取。评审界线按改动规模算，超过界线时 --skip 被拦截。
// 收尾时有没提交的改动就拒绝并列出文件。

const plan = [
  "## 要做的事",
  "看板放到首页。",
  "## 现状",
  "看板在第二屏。",
  "## 要不要先重构",
  "不要。改动都很小，不碰结构。",
  "## 功能改动",
  "1. 看板放到首页",
  "   对应 Q1。检查 `node check.mjs`，查看板在第一屏。",
  "## 用什么锁住现有的行为",
  "`node check.mjs`",
  "## 对应哪个场景",
  "S1 看队列。",
  "## 裁决",
  "| 裁决 | 理由 | 错了的代价 |",
  "| --- | --- | --- |",
  "| 不重构 | 改动小 | 小 |",
].join("\n");

/** 一个 git 仓库里的项目，开着第 1 版的落地阶段，拿出了 Q1，计划已经写好。 */
function landing() {
  const s = sandbox();
  const dir = s.at("proj/app");
  s.gitInit("proj/app");
  const git = (...args: string[]) =>
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], {
      cwd: dir,
      env: s.env,
      encoding: "utf8",
    });
  const commit = (message: string) => {
    git("add", "-A");
    git("commit", "-q", "-m", message);
  };
  writeFileSync(
    join(dir, "check.mjs"),
    'import { readFileSync } from "node:fs";\nconst board = readFileSync("board.txt", "utf8");\nconsole.log(board.trim());\nprocess.exit(board.includes("第一屏") ? 0 : 1);\n',
  );
  writeFileSync(join(dir, "board.txt"), "看板在第二屏\n");
  mkdirSync(join(dir, "sub"));
  writeFileSync(join(dir, "sub", "keep.txt"), "子目录\n");
  commit("起点");
  const run = (...argv: string[]) => s.ploop("proj/app", ...argv);
  expect(run("init", "--repo", "自己的").code).toBe(0);
  commit("忽略项目缓存");
  expect(run("queue", "add", "看板放到首页", "--stage", "落地").code).toBe(0);
  expect(run("round", "start", "落地").code).toBe(0);
  writeFileSync(join(dir, ".product-loop", "rounds", "v1-落地-1", "计划.md"), plan);
  return { s, dir, run, git, commit };
}

/** 计划里的检查命令换成另一个脚本。 */
function withCheck(dir: string, script: string) {
  writeFileSync(
    join(dir, ".product-loop", "rounds", "v1-落地-1", "计划.md"),
    plan.replaceAll("node check.mjs", `node ${script}`),
  );
}

/** 小改动的计划：只写三节。 */
const shortPlan = [
  "## 要做的事",
  "看板放到首页。",
  "## 功能改动",
  "1. 看板放到首页",
  "   对应 Q1。检查 `node check.mjs`，查看板在第一屏。",
  "## 用什么锁住现有的行为",
  "`node check.mjs`",
].join("\n");

describe("落地的小改动走快路（R04、D03）", { timeout: 90_000 }, () => {
  it("三节的计划、不用敲 tidy 和 review，记通过时评审自动跳过；没写检查命令的示例写对命令名", () => {
    const { dir, run, commit } = landing();
    writeFileSync(join(dir, ".product-loop", "rounds", "v1-落地-1", "计划.md"), shortPlan);
    const planned = run("land", "plan");
    expect(planned.stdout).toBe(
      [
        "交了计划：第 1 版的落地阶段，功能改动 1 件",
        "",
        "下一步：",
        "  1. ploop land red 看板放到首页 -- node check.mjs",
        "",
      ].join("\n"),
    );
    expect(planned.code).toBe(0);
    // F31 示例写的是这一条命令，不是 red。
    const noCommand = run("land", "tidy");
    expect(noCommand.stderr).toContain("在 -- 后面写命令，例如 ploop land tidy -- pnpm test。");
    expect(noCommand.code).toBe(2);

    expect(run("land", "red", "看板放到首页", "--", "node", "check.mjs").code).toBe(0);
    writeFileSync(join(dir, "board.txt"), "看板在第一屏\n");
    commit("看板放到首页\n\n阶段: 第 1 版的落地阶段\n队列: Q1");
    const passed = run("land", "green", "看板放到首页", "--", "node", "check.mjs");
    expect(passed.stdout).toContain("评审：改动 2 行、1 个文件，在界线以内，自动跳过\n");
    expect(passed.stdout).toContain("下一步：\n  1. ploop page example --stage 落地\n");
    expect(passed.code).toBe(0);
    const status = run("land", "status");
    expect(status.stdout).toContain("重构：跳过了：计划从简，这一批不先重构");
    expect(status.stdout).toContain("评审：跳过了");
    expect(status.stdout).toContain("前四步齐了。");
  });

  it("round start 落地：先做里写明七节的名字和从简的写法，下一步是交计划", () => {
    const s = sandbox();
    const dir = s.at("proj/app");
    s.gitInit("proj/app");
    const run = (...argv: string[]) => s.ploop("proj/app", ...argv);
    writeFileSync(join(dir, "a.txt"), "a\n");
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "add", "-A"], {
      cwd: dir,
      env: s.env,
    });
    execFileSync(
      "git",
      ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "起点"],
      {
        cwd: dir,
        env: s.env,
      },
    );
    expect(run("init", "--repo", "自己的").code).toBe(0);
    expect(run("queue", "add", "看板放到首页", "--stage", "落地").code).toBe(0);
    const started = run("round", "start", "落地");
    expect(started.stdout).toContain(
      "  七节：要做的事、现状、要不要先重构、功能改动、用什么锁住现有的行为、对应哪个场景、裁决。小改动只写要做的事、功能改动、用什么锁住现有的行为三节。\n",
    );
    expect(started.stdout).toContain("下一步：\n  1. ploop land plan\n");
    expect(run("land", "plan", "--help").stdout).toContain(
      "七节是：要做的事、现状、要不要先重构、功能改动。",
    );
  });
});

describe("S18 落地一批", { timeout: 90_000 }, () => {
  it("计划、跳过重构、在子目录里先失败后通过、跳过评审、收尾；有没提交的文件时拒绝收尾", () => {
    const { s, dir, run, commit } = landing();
    const planned = run("land", "plan");
    expect(planned.stdout.split("\n")[0]).toBe("交了计划：第 1 版的落地阶段，功能改动 1 件");
    expect(planned.code).toBe(0);
    expect(run("land", "tidy", "--skip").stdout.split("\n")[0]).toBe(
      "跳过了重构：改动都很小，不碰结构。",
    );

    // 在子目录里运行：检查命令在根目录里跑，check.mjs 按根目录找 board.txt。
    const failed = s.ploop(
      "proj/app/sub",
      "land",
      "red",
      "看板放到首页",
      "--",
      "node",
      "check.mjs",
    );
    expect(failed.stdout.split("\n").slice(0, 4)).toEqual([
      "记了失败：看板放到首页，退出码 1",
      "运行：node check.mjs",
      "输出的末尾：",
      "  看板在第二屏",
    ]);
    expect(failed.code).toBe(0);

    writeFileSync(join(dir, "board.txt"), "看板在第一屏\n");
    commit("看板放到首页\n\n阶段: 第 1 版的落地阶段\n队列: Q1");
    const passed = run("land", "green", "看板放到首页", "--", "node", "check.mjs");
    expect(passed.stdout.split("\n")[0]).toMatch(/^记了通过：看板放到首页，提交 [0-9a-f]{7}$/u);
    expect(passed.stderr).not.toContain("警告");
    expect(passed.code).toBe(0);

    const skipped = run("land", "review", "--skip", "只改了一行");
    expect(skipped.stdout.split("\n")[0]).toBe("跳过了评审：改动 2 行、1 个文件，在界线以内");
    expect(skipped.code).toBe(0);

    const status = run("land", "status");
    expect(status.stdout).toContain("前四步齐了。第五步要自己核对：更改卡上有改前改后。");
    expect(status.stdout).toMatch(/看板放到首页 {2}先失败后通过，提交 [0-9a-f]{7}/u);

    const diff = run("land", "diff");
    expect(diff.stdout).toContain("改动：看板放到首页\n  检查命令：node check.mjs\n");
    expect(diff.stdout).toContain("+看板在第一屏");
    // 只有一个根目录：差异一行不写路径（N14）。
    expect(diff.stdout).toMatch(/\n差异：从 [0-9a-f]{7} 起\n/u);
    expect(diff.stdout).not.toContain(dir);

    writeFileSync(join(dir, "scratch.txt"), "草稿\n");
    const dirty = run("round", "close", "--done", "Q1=提交看板放到首页");
    expect(dirty.stderr).toContain(`拦截：${dir} 里有 1 个文件没有提交：scratch.txt。`);
    expect(dirty.stderr).toContain("规矩：land.commit.clean");
    // 落地阶段收尾以前要给用户看过一页，一页都没给过时也一并拦下。
    expect(dirty.stderr).toContain(
      "第 1 版的落地阶段还没有给用户看过要点的页，也没有给看过更改，不能收尾。",
    );
    expect(dirty.stderr).toContain("规矩：land.page.shown");
    expect(dirty.code).toBe(1);

    rmSync(join(dir, "scratch.txt"));
    // 给出验收页要看截图，这里直接摆出一页只看的页，页上有一张更改卡：空的只看页不算给看过。
    s.database(
      `insert into pages (project_id, round_id, seq, purpose, format_version, sections, images,
         fill, status, presented_at)
       select project_id, id, 1, 'view', 1, '{}', '[]', '{}', 'presented', ? from rounds`,
      Date.now(),
    );
    s.database(
      `insert into cards (page_id, section, card_id, position, title, queue, scenes)
       select id, 'changes', 'c1', 0, '看板放到首页', '[1]', '[]' from pages`,
    );
    const closed = run("round", "close", "--done", "Q1=提交看板放到首页");
    expect(closed.stdout.split("\n")[0]).toBe("收尾了：第 1 版的落地阶段");
    expect(closed.code).toBe(0);
  });

  it("计划或评审意见还没写：说明先写哪个文件、再运行哪条命令，不只报系统错误码", () => {
    const { dir, run } = landing();
    rmSync(join(dir, ".product-loop", "rounds", "v1-落地-1", "计划.md"));
    const noPlan = run("land", "plan");
    expect(noPlan.stderr).toContain("还没有写计划：");
    expect(noPlan.stderr).toContain("计划.md 不存在。");
    expect(noPlan.stderr).toContain("再运行 ploop land plan");
    expect(noPlan.stderr).not.toContain("ENOENT");
    expect(noPlan.code).toBe(4);

    const noReview = run("land", "review");
    expect(noReview.stderr).toContain("还没有评审意见：");
    expect(noReview.stderr).toContain("review.json 不存在。");
    expect(noReview.stderr).toContain("ploop land review --skip <理由>");
    expect(noReview.stderr).not.toContain("ENOENT");
    expect(noReview.code).toBe(4);

    // 命令后面写了路径找不到时，还是写明试过哪些位置。
    const named = run("land", "review", "--file", "nosuch.json");
    expect(named.stderr).toContain("试过：");
    expect(named.code).toBe(4);
  });

  it("这一版还没有开始任何阶段：说没有落地记录可写，不留一个空的位置", () => {
    const s = sandbox();
    const run = (...argv: string[]) => s.ploop("proj/app", ...argv);
    expect(run("init", "--repo", "自己的", "--hook", "否").code).toBe(0);
    const none = run("land", "status");
    expect(none.stderr).toBe(
      "冲突：这一版还没有开始任何阶段，没有落地记录可写。\n怎么改：先运行 ploop round start 落地。\n",
    );
    expect(none.code).toBe(3);
    expect(run("round", "start", "构思").code).toBe(0);
    expect(run("land", "status").stderr).toContain("当前的阶段是第 1 版的构思阶段，不是落地阶段。");
  });

  it("评审意见和计划的写法：帮助里写明格式，review.json 内容不对时说出 level 能写什么", () => {
    const { dir, run } = landing();
    const help = run("land", "review", "--help");
    expect(help.stdout).toContain("每条写 file、line、level、text。");
    expect(help.stdout).toContain("level 写阻塞或建议，阻塞的另写 disposition。");
    expect(run("land", "plan", "--help").stdout).toContain("每件写成一个顶格列表项或三级标题");
    writeFileSync(join(dir, ".product-loop", "rounds", "v1-落地-1", "review.json"), "{}");
    const bad = run("land", "review");
    expect(bad.stderr).toContain("level 写阻塞或建议，阻塞的另写 disposition。");
    expect(bad.stderr).toContain("规矩：land.review.located");
    expect(bad.code).toBe(1);
  });

  it("改动超过界线时 --skip 被拦截，退出码 1", () => {
    const { dir, run, commit } = landing();
    run("land", "plan");
    run("land", "tidy", "--skip");
    run("land", "red", "看板放到首页", "--", "node", "check.mjs");
    const many = Array.from({ length: 70 }, (_, i) => `第 ${i + 1} 行`).join("\n");
    writeFileSync(join(dir, "board.txt"), `看板在第一屏\n${many}\n`);
    commit("看板放到首页");
    expect(run("land", "green", "看板放到首页", "--", "node", "check.mjs").code).toBe(0);
    const skipped = run("land", "review", "--skip", "想跳过");
    expect(skipped.stderr).toContain("规矩：land.review.required");
    expect(skipped.code).toBe(1);
  });

  it("检查命令不写结果：不留空目录，输出里没有断了的步（F16）", () => {
    const { dir, run } = landing();
    writeFileSync(join(dir, "quiet.mjs"), "process.exit(1);\n");
    withCheck(dir, "quiet.mjs");
    run("land", "plan");
    run("land", "tidy", "--skip");
    const quiet = run("land", "red", "看板放到首页", "--", "node", "quiet.mjs");
    expect(quiet.code).toBe(0);
    expect(quiet.stdout).not.toContain("使用代码没走完的步");
    expect(readdirSync(join(dir, ".product-loop", "use"))).toEqual([]);
  });

  it("检查命令是使用代码：结果写进项目缓存里，输出里列出断了的步（F16）", () => {
    const { dir, run } = landing();
    withCheck(dir, "use-code.mjs");
    run("land", "plan");
    run("land", "tidy", "--skip");
    const output = {
      schemaVersion: 1,
      scenes: [
        {
          scene: "S1",
          steps: [
            { step: 1, do: "打开首页", expect: "看到看板", result: "通过" },
            {
              step: 2,
              do: "点保存",
              expect: "出现提示",
              result: "断了",
              error: "页面上没有保存按钮",
            },
          ],
        },
      ],
    };
    writeFileSync(
      join(dir, "use-code.mjs"),
      [
        'import { mkdirSync, writeFileSync } from "node:fs";',
        'import { join } from "node:path";',
        "const out = process.env.PLOOP_USE_OUT;",
        'if (out === undefined || out === "") { console.log("没有 PLOOP_USE_OUT"); process.exit(2); }',
        "mkdirSync(out, { recursive: true });",
        `writeFileSync(join(out, "use-run.json"), ${JSON.stringify(JSON.stringify(output))});`,
        "process.exit(1);",
        "",
      ].join("\n"),
    );

    const failed = run("land", "red", "看板放到首页", "--", "node", "use-code.mjs");
    expect(failed.code).toBe(0);
    const lines = failed.stdout.split("\n");
    expect(lines[0]).toBe("记了失败：看板放到首页，退出码 1");
    expect(lines[1]).toBe("运行：node use-code.mjs");
    const head = lines.findIndex((line) => line.startsWith("使用代码没走完的步（结果在 "));
    expect(head).toBeGreaterThan(1);
    expect(lines[head]).toMatch(
      /^使用代码没走完的步（结果在 \.product-loop\/use\/land-[0-9TZ-]+\/use-run\.json）：$/u,
    );
    expect(lines[head + 1]).toBe("  - S1 第 2 步：页面上没有保存按钮");
    const runs = readdirSync(join(dir, ".product-loop", "use"));
    expect(runs).toHaveLength(1);
    expect(existsSync(join(dir, ".product-loop", "use", runs[0] ?? "", "use-run.json"))).toBe(true);
  });

  it("失败和通过用的不是同一条命令，拦截，退出码 1", () => {
    const { run, dir, commit } = landing();
    run("land", "plan");
    run("land", "tidy", "--skip");
    run("land", "red", "看板放到首页", "--", "node", "check.mjs");
    writeFileSync(join(dir, "board.txt"), "看板在第一屏\n");
    commit("看板放到首页");
    const other = run("land", "green", "看板放到首页", "--", "node", "./check.mjs");
    expect(other.stderr).toContain("规矩：land.green.sameCommand");
    expect(other.code).toBe(1);
  });
});
