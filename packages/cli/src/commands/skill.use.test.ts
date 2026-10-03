import { describe, expect, it } from "vitest";
import { sandbox } from "./testing.ts";

// ploop skill report|issues 和 ploop lint text|reply，对着真的后端跑，见第一期计划第 55 步。
// 抄录 S20：报问题时打印编号，自动带上项目、阶段和 skill 版本。维护的会话列出问题，回复理解。
// lint reply 从标准输入读，首行要以当前的阶段开头。

/** 开着第 1 版的构思阶段的项目。 */
function thinking() {
  const s = sandbox();
  const run = (...argv: string[]) => s.ploop("proj/app", ...argv);
  expect(run("init", "--repo", "自己的").code).toBe(0);
  expect(run("queue", "add", "理清给谁用", "--stage", "构思").code).toBe(0);
  expect(run("round", "start", "构思").code).toBe(0);
  return { s, run };
}

/** 处理问题只在产品循环自己的项目里放行：另开一个叫 product-loop 的项目当维护者的会话。 */
function maintainer(s: ReturnType<typeof sandbox>) {
  expect(s.ploop("proj/product-loop", "init", "--repo", "自己的").code).toBe(0);
  return (...argv: string[]) => s.ploop("proj/product-loop", ...argv);
}

describe("S20 报 skill 的问题", { timeout: 60_000 }, () => {
  it("报问题打印编号和项目、阶段；维护的会话在别处列出问题，回复理解", () => {
    const { s, run } = thinking();
    const reported = run(
      "skill",
      "report",
      "--aspect",
      "页面",
      "--class",
      "选项卡太长",
      "--example",
      "a 写了九行",
    );
    expect(reported.stdout.split("\n").slice(0, 2)).toEqual(["报上了：问题 1", "页面：选项卡太长"]);
    expect(reported.stdout).toMatch(/项目 app，第 1 版的构思阶段，skill 版本 /u);
    // 下一步不是再运行命令，是告诉用户编号（F35）。
    expect(reported.stdout).toContain("把问题 1 的编号告诉用户，由维护 skill 的人处理。");
    expect(reported.stdout).not.toContain("下一步");
    expect(reported.stdout).not.toContain("ploop skill issues");
    expect(reported.code).toBe(0);

    const listed = s.ploop("elsewhere", "skill", "issues");
    expect(listed.stdout.split("\n").slice(0, 3)).toEqual([
      "skill 的问题：1 条",
      "  1  新  app  第 1 版的构思阶段  页面：选项卡太长",
      "      例子：a 写了九行",
    ]);

    const maintain = maintainer(s);
    const replied = maintain("skill", "issues", "reply", "1", "选项卡要限定行数");
    expect(replied.stdout.split("\n")[0]).toBe("回了理解：问题 1");
    expect(maintain("skill", "issues", "--status", "已理解").stdout).toContain(
      "      说明：选项卡要限定行数",
    );
  });

  it("维护的会话把问题改成已确认、已改；缺说明或版本时报错，改不回新", () => {
    const { s, run } = thinking();
    run("skill", "report", "--aspect", "页面", "--class", "选项卡太长", "--example", "a 写了九行");
    const maintain = maintainer(s);
    const set = (...argv: string[]) => maintain("skill", "issues", "set", "1", ...argv);
    expect(set("已确认").stdout.split("\n")[0]).toBe("改了状态：问题 1 现在是「已确认」");
    const noVersion = set("已改");
    expect(noVersion.stderr).toContain("要写在哪一版改的");
    expect(noVersion.code).not.toBe(0);
    const fixed = set("已改", "--fixed-in", "2.1.0");
    expect(fixed.stdout.split("\n")[0]).toBe("改了状态：问题 1 现在是「已改」");
    expect(maintain("skill", "issues", "--status", "已改").stdout).toContain("1  已改");
    expect(set("新").code).not.toBe(0);
  });

  it("回复和改状态只在产品循环自己的项目里放行：别的项目、项目外都拦下，退出码 1，列出问题不受限", () => {
    const { s, run } = thinking();
    run("skill", "report", "--aspect", "页面", "--class", "选项卡太长", "--example", "a 写了九行");
    const blocked = [
      run("skill", "issues", "reply", "1", "选项卡要限定行数"),
      run("skill", "issues", "set", "1", "已确认"),
      s.ploop("elsewhere", "skill", "issues", "reply", "1", "选项卡要限定行数"),
    ];
    for (const one of blocked) {
      expect(one.stdout).toBe("");
      expect(one.stderr).toBe(
        [
          "拦截：只有维护者能处理 skill 的问题。",
          "怎么改：在项目 product-loop 里运行；别的项目只能用 ploop skill report 报问题。",
          "规矩：skill.issues.maintainer",
          "",
        ].join("\n"),
      );
      expect(one.code).toBe(1);
    }
    // 拦下的命令什么也没改，问题还是「新」。
    expect(s.ploop("elsewhere", "skill", "issues", "--status", "新").stdout).toContain("1  新");
    expect(run("skill", "issues").code).toBe(0);
  });

  it("lint reply 从标准输入读：首行不以当前阶段开头，只报一处，退出码 1；改了以后通过", () => {
    const { s } = thinking();
    const bad = s.feed("proj/app", "构思第 1 阶段：先理清给谁用。\n", "lint", "reply");
    expect(bad.stderr).toBe(
      [
        "拦截：回复的首行没有以当前的阶段「第 1 版的构思阶段」开头。",
        "位置：第 1 行",
        "怎么改：首行写成「第 1 版的构思阶段：」加一句原因。",
        "规矩：writing.reply.round",
        "",
      ].join("\n"),
    );
    expect(bad.code).toBe(1);
    const good = s.feed("proj/app", "第 1 版的构思阶段：先理清给谁用。\n", "lint", "reply");
    expect(good.stdout.split("\n")[0]).toBe("查过了：没有拦截");
    expect(good.code).toBe(0);
    const text = s.feed("elsewhere", "第一件；第二件；第三件；第四件。", "lint", "text");
    expect(text.stderr).toContain("规矩：writing.sentence.semicolons");
    expect(text.code).toBe(1);
  });

  it("lint 没写文件、标准输入又是空的：马上报用法错误，不挂着等", () => {
    const { s } = thinking();
    const empty = s.feed("proj/app", "", "lint", "text");
    expect(empty.stderr).toBe(
      [
        "用法错误：没有要查的文字：标准输入是空的，或者 5 秒内没有传来内容。",
        "怎么改：写文件的路径，或用管道传入，例如 pbpaste | ploop lint text。",
        "",
      ].join("\n"),
    );
    expect(empty.stdout).toBe("");
    expect(empty.code).toBe(2);
  });
});
