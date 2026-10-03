import { execFileSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cliEnvelopeSchema } from "@product-loop/model";
import { describe, expect, it } from "vitest";
import { fullMainline, sandbox } from "./testing.ts";

// ploop round start|show|close，对着真的后端跑，见第一期计划第 38 步和「04 命令行」第三到五节。
// 抄录 S15 的第 1、3 步。两个子进程同时开始一个阶段，一个退出码 0、一个退出码 3。
// round show 用阶段的叫法、label 的写法和迁移前的文件名都能查到。给出信息和回复的命令在第 42、46 步，
// 这里用改数据库摆出用户回复过的阶段、在等的一页和迁移进来的文件名。

function opened() {
  const s = sandbox();
  expect(s.ploop("proj/app", "init", "--repo", "自己的").code).toBe(0);
  const run = (...argv: string[]) => s.ploop("proj/app", ...argv);
  const add = (content: string, stage: string) =>
    expect(run("queue", "add", content, "--stage", stage).code).toBe(0);
  return { s, run, add };
}

// 收尾构思阶段要求主线十个部分至少写好一半（规矩 think.leave），要收尾构思的用例先写一份完整的主线。
function openedWithMainline() {
  const opening = opened();
  writeFileSync(join(opening.s.at("proj/app"), ".product-loop", "主线.md"), fullMainline);
  return opening;
}

describe("S15 开始一个阶段", { timeout: 60_000 }, () => {
  it("第 1 步：敲 ploop round start 检查，输出阶段、队列里检查的事、主线和工作区", () => {
    const { s, run, add } = opened();
    writeFileSync(join(s.at("proj/app"), ".product-loop", "主线.md"), fullMainline);
    add("设置页的保存按钮在窄屏被挡住", "检查");
    add("队列看板的等待行和列里的卡重复", "检查");
    add("队列看板加上按阶段筛选", "构思");

    const started = run("round", "start", "检查");
    expect(started.stdout).toBe(
      [
        "开始了：第 1 版的检查阶段",
        "拿出来的事：",
        "  Q1  设置页的保存按钮在窄屏被挡住",
        "  Q2  队列看板的等待行和列里的卡重复",
        "这一版没有新出现或变过的屏。",
        "主线：10 个部分齐全，设计规范 12 个部分齐全",
        "工作区：.product-loop/rounds/v1-检查-1/",
        "",
        "先做：",
        "  判断：不成立的，运行 ploop queue drop Q1 --reason <原因>。",
        "  页面：逐屏看，页面数据写进 .product-loop/rounds/v1-检查-1/page.json，要有元素清单。例子运行 ploop page example --stage 检查，字段运行 ploop page schema --brief --stage 检查。写好运行 ploop page check。",
        "",
        "下一步：",
        "  1. ploop page example --stage 检查",
        "",
      ].join("\n"),
    );
    expect(started.stderr).not.toContain("警告");
    expect(started.code).toBe(0);
    expect(existsSync(join(s.at("proj/app"), ".product-loop", "rounds", "v1-检查-1"))).toBe(true);
    // 构思的事不拿进检查阶段。
    expect(run("queue", "show", "Q3").stdout).toContain("状态：待办\n");
  });

  it("第 1 步 --json：data 带阶段、拿出的事和工作区", () => {
    const { run, add } = opened();
    add("设置页的保存按钮在窄屏被挡住", "使用");
    const { code, stdout } = run("round", "start", "使用", "--json");
    expect(cliEnvelopeSchema.parse(JSON.parse(stdout))).toMatchObject({
      kind: "round.started",
      ok: true,
      data: {
        round: { label: "v1-使用-1", stage: "使用", status: "进行中" },
        taken: [{ id: "Q1", status: "进行中" }],
        workspace: ".product-loop/rounds/v1-使用-1/",
      },
      warnings: [{ rule: "mainline.ten" }],
    });
    expect(code).toBe(0);
  });

  it("第 3 步：已有一个阶段开着时再开，拒绝，写明是哪个阶段、什么时候、哪个会话开的、怎么收尾", () => {
    const { s, run, add } = opened();
    add("设置页的保存按钮在窄屏被挡住", "构思");
    s.env.PLOOP_SESSION = "7f3a9c2e";
    expect(run("round", "start", "构思").code).toBe(0);

    s.env.PLOOP_SESSION = "b81d40aa";
    const again = run("round", "start", "使用");
    expect(again.stdout).toBe("");
    expect(again.stderr).toMatch(
      new RegExp(
        [
          "^冲突：第 1 版的构思阶段还没收尾，是会话 7f3a9c2e 在 \\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2} 开始的。",
          '怎么改：怕别的会话在做，先运行 ploop round show "第 1 版的构思阶段"。' +
            "没人在做，运行 ploop round close 收尾，再开始新的阶段。",
          "$",
        ].join("\n"),
        "u",
      ),
    );
    expect(again.code).toBe(3);
    // 被拒绝的一次什么都没写：还是只有一个阶段，拿出的事没变。
    expect(run("version", "show").stdout).toContain(
      "这一版的阶段：\n  第 1 版的构思阶段  进行中\n",
    );
  });

  it("两个子进程同时开始一个阶段：一个退出码 0，一个退出码 3", async () => {
    const { s } = opened();
    const first = s.launch("proj/app", "round", "start", "构思");
    const second = s.launch("proj/app", "round", "start", "使用");
    const done = await Promise.all([first.done, second.done]);
    expect(done.map((r) => r.code).sort()).toEqual([0, 3]);
    const loser = done.find((r) => r.code === 3);
    expect(loser?.stderr).toMatch(/^冲突：第 1 版的(构思|使用)阶段还没收尾/u);
  });

  it("开始时替已回复的上一个阶段收尾，并在输出里写明", () => {
    const { s, run, add } = openedWithMainline();
    add("队列看板加上按阶段筛选", "构思");
    expect(run("round", "start", "构思").code).toBe(0);
    expect(run("queue", "drop", "Q1", "--reason", "已经有了").code).toBe(0);
    // 用户回复过这个阶段的页。给出信息和回复的命令在第 42、46 步。
    s.database("update rounds set status = 'replied'");

    const started = run("round", "start", "使用");
    expect(started.stdout.split("\n").slice(0, 3)).toEqual([
      "开始了：第 1 版的使用阶段",
      "开始以前替第 1 版的构思阶段收了尾。",
      "这个阶段没有待办的事。",
    ]);
    expect(started.code).toBe(0);
    expect(run("round", "show", "v1-构思-1").stdout).toContain(
      "拿出来的事：\n  Q1  开始时取消  队列看板加上按阶段筛选\n",
    );
  });

  it("落地阶段交上根目录的提交，输出里写明这一批从哪个提交算起", () => {
    const s = sandbox();
    s.gitInit("proj/app");
    const git = (...args: string[]) =>
      execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", ...args], {
        cwd: s.at("proj/app"),
        env: s.env,
        encoding: "utf8",
      }).trim();
    git("commit", "-q", "--allow-empty", "-m", "起点");
    const head = git("rev-parse", "HEAD");
    expect(s.ploop("proj/app", "init", "--repo", "自己的").code).toBe(0);
    const run = (...argv: string[]) => s.ploop("proj/app", ...argv);
    run("queue", "add", "设置页的保存按钮在窄屏被挡住", "--stage", "落地");
    run("queue", "add", "队列看板加上按阶段筛选", "--stage", "落地");

    const started = run(
      "round",
      "start",
      "落地",
      "--take",
      "Q1",
      "--defer",
      "Q2=等构思定下场景 S4",
    );
    expect(started.stdout).toContain(
      [
        "拿出来的事：",
        "  Q1  设置页的保存按钮在窄屏被挡住",
        "改成等待的事：",
        "  Q2  队列看板加上按阶段筛选（等：等构思定下场景 S4）",
        "起点提交：",
        `  ${head.slice(0, 12)}`,
      ].join("\n"),
    );
    expect(started.code).toBe(0);
  });
});

describe("ploop round show", { timeout: 60_000 }, () => {
  it("阶段的叫法、label 的写法和迁移前的文件名都能查到同一个阶段，带斜杠的文件名也能查", () => {
    const { s, run } = openedWithMainline();
    expect(run("round", "start", "构思").code).toBe(0);
    expect(run("round", "close").code).toBe(0);
    expect(run("round", "start", "使用").code).toBe(0);
    // 迁移进来的阶段带迁移前的文件名，迁移的命令在第 59 到 62 步。
    s.database("update rounds set legacy_id = 'fix-13' where stage = 'think'");
    s.database("update rounds set legacy_id = '2026-09-20/think-29' where stage = 'use'");

    const byLabel = run("round", "show", "v1-构思-1");
    expect(byLabel.stdout.split("\n")[0]).toBe("第 1 版的构思阶段：已收尾");
    expect(byLabel.stdout).toContain("迁移前的文件名：fix-13\n");
    // 用阶段的叫法查，和 label 查到的相同。
    expect(run("round", "show", "第 1 版的构思阶段").stdout).toBe(byLabel.stdout);
    expect(byLabel.code).toBe(0);
    expect(run("round", "show", "fix-13").stdout).toBe(byLabel.stdout);

    const slash = run("round", "show", "2026-09-20/think-29");
    expect(slash.stdout.split("\n")[0]).toBe("第 1 版的使用阶段：进行中");
    // 不写阶段就看当前的阶段。
    expect(run("round", "show").stdout).toBe(slash.stdout);
  });

  it("迁移前的文件名对上两个阶段：用法错误，列出对应的几个阶段；没有这个阶段：退出码 4", () => {
    const { s, run } = openedWithMainline();
    run("round", "start", "构思");
    run("round", "close");
    run("round", "start", "构思");
    s.database("update rounds set legacy_id = 'fix-13'");
    const ambiguous = run("round", "show", "fix-13");
    expect(ambiguous.stderr.split("\n")[0]).toBe(
      "用法错误：迁移前的文件名「fix-13」对上了 2 个阶段：第 1 版的构思阶段、第 1 版的构思阶段（第 2 次）。",
    );
    expect(ambiguous.code).toBe(2);

    const missing = run("round", "show", "v1-检查-9");
    expect(missing.stderr.split("\n")[0]).toBe(
      "找不到：项目「app」没有第 1 版的检查阶段（第 9 次）。",
    );
    expect(missing.code).toBe(4);
    // 用阶段的叫法找也一样。
    const byName = run("round", "show", "第 1 版的检查阶段（第 9 次）");
    expect(byName.stderr).toBe(missing.stderr);
  });

  it("还没开始任何阶段：退出码 4，写明怎么开始", () => {
    const { run } = opened();
    const { code, stderr } = run("round", "show");
    expect(stderr).toBe(
      "找不到：这一版还没开始任何阶段。\n怎么改：运行 ploop round start <阶段名> 开始一个阶段。\n",
    );
    expect(code).toBe(4);
  });
});

describe("ploop round close", { timeout: 60_000 }, () => {
  it("写明每件事的结果再收尾：做完写证据，退回可以换阶段", () => {
    const { run, add } = openedWithMainline();
    add("设置页的保存按钮在窄屏被挡住", "构思");
    add("队列看板加上按阶段筛选", "构思");
    expect(run("round", "start", "构思").code).toBe(0);

    const blocked = run("round", "close");
    expect(blocked.stderr).toContain("拦截：Q1 还没有结果，第 1 版的构思阶段不能收尾。");
    expect(blocked.stderr).toContain("规矩：round.close.result");
    expect(blocked.code).toBe(1);

    const closed = run(
      "round",
      "close",
      "--done",
      "Q1=主线里写明了",
      "--return",
      "Q2:使用=要先用一遍再定",
      "--summary",
      "定下了设置页",
    );
    expect(closed.stdout).toBe(
      [
        "收尾了：第 1 版的构思阶段",
        "拿出来的事的结果：",
        "  Q1  做完      设置页的保存按钮在窄屏被挡住",
        "  Q2  退回使用  队列看板加上按阶段筛选",
        "收尾说明：定下了设置页",
        "",
        "下一步：",
        "  1. ploop round start 使用",
        "",
      ].join("\n"),
    );
    expect(closed.code).toBe(0);
    expect(run("queue", "show", "Q2").stdout).toContain("阶段：使用\n");
  });

  it("没写结果的报错给出 --done 和 --return 的写法，带上这件事的编号", () => {
    const { run, add } = opened();
    add("设置页的保存按钮在窄屏被挡住", "构思");
    expect(run("round", "start", "构思").code).toBe(0);
    const blocked = run("round", "close");
    expect(blocked.stderr).toContain(
      "怎么改：写明 Q1 做完还是退回。做完运行 ploop round close --done Q1=<证据>。退回运行 ploop round close --return Q1=<原因>。",
    );
    expect(blocked.code).toBe(1);
  });

  it("放弃一个阶段：--abort 写原因，拿出的事都退回待办；和 --done 一起写是用法错误", () => {
    const { run, add } = opened();
    add("设置页的保存按钮在窄屏被挡住", "构思");
    expect(run("round", "start", "构思").code).toBe(0);
    const mixed = run("round", "close", "--abort", "计划要改", "--done", "Q1=好了");
    expect(mixed.code).toBe(2);
    expect(mixed.stderr).toContain("--abort");
    const aborted = run("round", "close", "--abort", "计划要改");
    expect(aborted.stdout).toBe(
      [
        "放弃了：第 1 版的构思阶段",
        "拿出来的事的结果：",
        "  Q1  退回  设置页的保存按钮在窄屏被挡住",
        "收尾说明：放弃：计划要改",
        "",
        "下一步：",
        "  1. ploop round start 构思",
        "",
      ].join("\n"),
    );
    expect(aborted.code).toBe(0);
    expect(run("queue", "show", "Q1").stdout).toContain("状态：待办\n");
    expect(run("round", "start", "构思").code).toBe(0);
    const json = JSON.parse(run("round", "close", "--abort", "再来一次", "--json").stdout) as {
      kind: string;
    };
    expect(json.kind).toBe("round.aborted");
  });

  it("构思阶段的主线还没写够：拦截收尾，写明缺几个；放弃不受影响", () => {
    const { run, add } = opened();
    add("设置页的保存按钮在窄屏被挡住", "构思");
    expect(run("round", "start", "构思").code).toBe(0);
    const blocked = run("round", "close", "--done", "Q1=先写着");
    expect(blocked.stderr).toContain(
      "拦截：主线十个部分只写了 0 个，缺 10 个，第 1 版的构思阶段不能收尾。",
    );
    expect(blocked.stderr).toContain("缺的部分：一句话新闻稿、给谁用、要完成的任务、场景清单");
    expect(blocked.stderr).toContain("规矩：think.leave");
    expect(blocked.code).toBe(1);
    expect(run("round", "close", "--abort", "主线还没写").code).toBe(0);
  });

  it("已经收尾的阶段再收尾：退出码 0，说已经收尾了，下一步照 status 给", () => {
    const { run, add } = openedWithMainline();
    add("设置页的保存按钮在窄屏被挡住", "构思");
    expect(run("round", "start", "构思").code).toBe(0);
    expect(run("round", "close", "--done", "Q1=主线里写明了").code).toBe(0);
    const again = run("round", "close");
    expect(again.stdout).toBe(
      [
        "已经收尾了：第 1 版的构思阶段，不用再收尾。",
        "",
        "下一步：",
        "  1. ploop round start 使用",
        "",
      ].join("\n"),
    );
    expect(again.stderr).toBe("");
    expect(again.code).toBe(0);
    const json = JSON.parse(run("round", "close", "--json").stdout) as {
      kind: string;
      ok: boolean;
    };
    expect(json).toMatchObject({ kind: "round.alreadyClosed", ok: true });
  });

  it("还有一页在等用户点：拒绝收尾，退出码 3，写明是哪一页", () => {
    const { s, run } = opened();
    expect(run("round", "start", "构思").code).toBe(0);
    // 给出信息的命令在第 42 步。这里直接摆出在等的一页。
    s.database(
      `insert into pages (project_id, round_id, seq, purpose, format_version, sections, images,
         fill, status, presented_at)
       select project_id, id, 1, 'ask', 1, '{}', '[]', '{}', 'presented', ? from rounds`,
      Date.now(),
    );
    s.database("update rounds set status = 'waiting'");

    const refused = run("round", "close");
    expect(refused.stdout).toBe("");
    expect(refused.stderr).toBe(
      [
        "冲突：第 1 版的构思阶段的第 1 页还在等用户点，现在不能收尾。",
        "怎么改：先运行 ploop reply wait 取回用户的回复。用户不再回复这一页时，运行 ploop page withdraw 撤回它，再收尾。",
        "",
      ].join("\n"),
    );
    expect(refused.code).toBe(3);
    expect(run("round", "show").stdout).toMatch(
      /\n给出过的页：\n {2}第 1 页，要用户点，已给出，[\d-]+ [\d:]+\n收到的回复：没有\n$/u,
    );
  });
});
