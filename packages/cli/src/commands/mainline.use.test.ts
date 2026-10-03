import { copyFileSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cliEnvelopeSchema } from "@product-loop/model";
import { describe, expect, it } from "vitest";
import { sandbox } from "./testing.ts";

// 主线的各子命令和每条命令开始时的同步，对着真的后端跑，见第一期计划第 35 步和「03 数据模型」第五节。
// 文件变了就交一次新的修订。集中存储新、文件没变就覆盖文件。两边都变了就写主线.远端.md，退出码 3。
// 新场景推送后，文件里补上 S 编号。
// 别的会话交了一次修订，用「把项目缓存退回到上一次修订」来模拟：集中存储里的比基准新。
// ploop init 已把主线模板交成修订 1，所以测试里交的修订从修订 2 数起。
// 只有要用最新主线的命令开始时才同步：round start、page check 和 page present、
// reply handle、use run 和 use ingest、queue add 和 queue edit。status、queue list 这样只读的命令不交新的一版，
// 主线.md 有没交的改动时在输出里提醒，见 P10。

const draft = [
  "# 主线",
  "",
  "## 场景清单",
  "",
  "### 看队列",
  "谁在什么时候用：你。",
  "1. 点队列 → 看到看板",
  "",
  "### 看决定",
  "谁在什么时候用：你。",
  "1. 点决定 → 看到表格",
  "",
].join("\n");

const numbered = draft
  .replace("### 看队列", "### S1 看队列")
  .replace("### 看决定", "### S2 看决定");

function opened() {
  const s = sandbox();
  expect(s.ploop("proj/app", "init", "--repo", "自己的").code).toBe(0);
  const cache = join(s.at("proj/app"), ".product-loop");
  const file = join(cache, "主线.md");
  const remoteFile = join(cache, "主线.远端.md");
  const identity = join(cache, "project.json");
  const base = () => JSON.parse(readFileSync(identity, "utf8")).mainlineBase;
  const run = (...argv: string[]) => s.ploop("proj/app", ...argv);
  /** 记下项目缓存现在的主线.md 和 project.json，之后退回到这里。 */
  const snapshot = () => {
    copyFileSync(file, `${file}.bak`);
    copyFileSync(identity, `${identity}.bak`);
    return () => {
      copyFileSync(`${file}.bak`, file);
      copyFileSync(`${identity}.bak`, identity);
    };
  };
  return { s, cache, file, remoteFile, base, run, snapshot };
}

/**
 * 会同步主线的命令里最轻的一条：放进一件事。mainline check 只检查、不交新的修订，不算在内。
 * 每次放的内容不同，队列不收重复的。
 */
let added = 0;
const sync = () => ["queue", "add", `同步用的事 ${++added}`, "--stage", "构思"] as const;

describe("要用最新主线的命令开始时同步主线", { timeout: 60_000 }, () => {
  it("只读的命令不交新的一版：主线.md 有改动时只提醒，基准不动", () => {
    const { file, base, run } = opened();
    writeFileSync(file, draft);

    const status = run("status");
    expect(status.stderr).toContain(
      "警告：主线.md 有还没交上去的改动，这里显示的是已经交上去的那次修订。",
    );
    expect(status.stderr).toContain("怎么改：运行 ploop mainline push，把它交成新的修订。");
    expect(status.stderr).not.toContain("同步了主线");
    expect(status.code).toBe(0);
    expect(run("queue", "list").stderr).toBe("");
    expect(run("decision", "list").stderr).toBe("");
    expect(readFileSync(file, "utf8")).toBe(draft);
    expect(base()).toMatchObject({ revision: 1 });
    expect(run("mainline", "history").stdout.split("\n")[0]).toBe("主线有 1 次修订：");
  });

  it("文件变了就交一个新版本，新场景推送后文件里补上 S 编号", () => {
    const { file, base, run } = opened();
    writeFileSync(file, draft);

    const checked = run(...sync());
    expect(checked.stderr).toContain("同步了主线：主线.md 交成了修订 2。\n");
    expect(checked.stderr).toContain("补上了场景编号 S1 看队列、S2 看决定，已写回主线.md。\n");
    expect(checked.code).toBe(0);
    expect(readFileSync(file, "utf8")).toBe(numbered);
    expect(base()).toMatchObject({ revision: 2 });
    expect(run("status").stdout.split("\n")[0]).toBe("项目 app：第 1 版，还没开始任何阶段");

    // 再改一处，下一条要用最新主线的命令交成修订 3。没改时不交。
    writeFileSync(file, `${numbered}\n## 交付线\n\n第一期做命令行。\n`);
    expect(run(...sync()).stderr).toContain("同步了主线：主线.md 交成了修订 3。\n");
    expect(run(...sync()).stderr).not.toContain("同步了主线");
    expect(run("mainline", "history").stdout.split("\n").slice(0, 1)).toEqual([
      "主线有 3 次修订：",
    ]);
    expect(base()).toMatchObject({ revision: 3 });
  });

  it("集中存储新、文件没变：用新的修订覆盖文件", () => {
    const { file, base, run, snapshot } = opened();
    writeFileSync(file, numbered);
    run(...sync());
    const rewind = snapshot();
    const second = `${numbered}\n## 交付线\n\n第一期做命令行。\n`;
    writeFileSync(file, second);
    run(...sync());
    rewind();

    const listed = run(...sync());
    expect(listed.stderr).toContain("同步了主线：用集中存储里的修订 3 覆盖了主线.md。\n");
    expect(listed.code).toBe(0);
    expect(readFileSync(file, "utf8")).toBe(second);
    expect(base()).toMatchObject({ revision: 3 });
  });

  it("两边都变了：写主线.远端.md，退出码 3；合并以后 mainline push 交上去", () => {
    const { file, remoteFile, base, run, snapshot } = opened();
    writeFileSync(file, numbered);
    run(...sync());
    const rewind = snapshot();
    const theirs = `${numbered}\n## 交付线\n\n第一期做命令行。\n`;
    writeFileSync(file, theirs);
    run(...sync());
    rewind();
    const mine = `${numbered}\n## 四个风险\n\n没有。\n`;
    writeFileSync(file, mine);

    const conflict = run(...sync());
    expect(conflict.stderr).toBe(
      [
        "冲突：交上来的主线以修订 2 为基准，集中存储里最新的已经是修订 3。",
        `位置：${remoteFile}`,
        "怎么改：集中存储里的修订 3 写进了主线.远端.md。把它合进主线.md，再运行 ploop mainline push。",
        "",
      ].join("\n"),
    );
    expect(conflict.stdout).toBe("");
    expect(conflict.code).toBe(3);
    expect(readFileSync(remoteFile, "utf8")).toBe(theirs);
    expect(readFileSync(file, "utf8")).toBe(mine);
    expect(base()).toMatchObject({ revision: 3 });

    // 没合并以前，要用最新主线的命令一律停下，--json 时也是一个 JSON 对象。
    const pending = run(...sync(), "--json");
    expect(cliEnvelopeSchema.parse(JSON.parse(pending.stdout))).toMatchObject({
      ok: false,
      error: { code: "CONFLICT", where: remoteFile },
    });
    expect(pending.code).toBe(3);

    const merged = `${theirs}\n## 四个风险\n\n没有。\n`;
    writeFileSync(file, merged);
    const pushed = run("mainline", "push");
    expect(pushed.stdout.split("\n").slice(0, 2)).toEqual([
      "交上了：主线修订 4",
      "删掉了主线.远端.md。",
    ]);
    expect(pushed.code).toBe(0);
    expect(existsSync(remoteFile)).toBe(false);
    expect(base()).toMatchObject({ revision: 4 });
    expect(run(...sync()).code).toBe(0);
  });

  it("两边都变了以后 mainline pull：先拦下，写了 --force 才放弃本地的改动，取回最新的修订", () => {
    const { file, remoteFile, run, snapshot } = opened();
    writeFileSync(file, numbered);
    run(...sync());
    const rewind = snapshot();
    const theirs = `${numbered}\n## 交付线\n\n第一期做命令行。\n`;
    writeFileSync(file, theirs);
    run(...sync());
    rewind();
    const mine = `${numbered}\n## 四个风险\n\n没有。\n`;
    writeFileSync(file, mine);
    expect(run(...sync()).code).toBe(3);

    // 不写 --force 时什么都不丢，说明会丢什么、怎么办。
    const refused = run("mainline", "pull");
    expect(refused.code).toBe(3);
    expect(refused.stderr).toContain(
      "主线.md 和主线.远端.md 还没有合并，取回会丢掉主线.md 里的改动。",
    );
    expect(refused.stderr).toContain("ploop mainline pull --force");
    expect(readFileSync(file, "utf8")).toBe(mine);
    expect(existsSync(remoteFile)).toBe(true);

    const pulled = run("mainline", "pull", "--force");
    expect(pulled.stdout.split("\n").slice(0, 3)).toEqual([
      "取回了：主线修订 3，覆盖了主线.md",
      "主线.md 里没交的改动已丢掉。",
      "删掉了主线.远端.md。",
    ]);
    expect(pulled.code).toBe(0);
    expect(readFileSync(file, "utf8")).toBe(theirs);
    expect(existsSync(remoteFile)).toBe(false);
  });

  it("主线.md 被删了：集中存储里有主线就写出来", () => {
    const { file, run } = opened();
    writeFileSync(file, numbered);
    run(...sync());
    rmSync(file);
    expect(run(...sync()).stderr).toContain("同步了主线：用集中存储里的修订 2 覆盖了主线.md。\n");
    expect(readFileSync(file, "utf8")).toBe(numbered);
  });
});

describe("ploop mainline 各子命令", { timeout: 60_000 }, () => {
  it("init 以后主线是模板：show 写修订 1，check 报出十个部分都缺", () => {
    const { run } = opened();
    expect(run("mainline", "show").stdout.split("\n")[0]).toMatch(/^主线修订 1：/u);
    const checked = run("mainline", "check");
    expect(checked.stdout).toContain("一句话新闻稿");
    expect(checked.code).toBe(0);
  });

  it("check 只检查不交修订：查的是主线.md 现在的内容，有没交的改动时提醒 push，push 以后不再提醒（Q10）", () => {
    const { file, base, run } = opened();
    writeFileSync(file, draft);
    const checked = run("mainline", "check");
    expect(checked.stdout.split("\n")[0]).toBe("查了主线.md 现在的内容，没有交新的修订。");
    // 查的是刚写的草稿：场景清单有了，别的部分还缺。
    expect(checked.stdout).toContain("主线缺 9 个部分：");
    expect(checked.stdout).not.toContain("  场景清单\n");
    expect(checked.stderr).toContain("警告：查的主线.md 还没交上去。");
    expect(checked.stdout).toContain("下一步：\n  1. ploop mainline push\n");
    expect(checked.stderr).not.toContain("同步了主线");
    expect(checked.code).toBe(0);
    // 什么都没交：基准和历次修订都不动，文件也不改。
    expect(base()).toMatchObject({ revision: 1 });
    expect(readFileSync(file, "utf8")).toBe(draft);
    expect(run("mainline", "history").stdout.split("\n")[0]).toBe("主线有 1 次修订：");

    expect(run("mainline", "push").code).toBe(0);
    const again = run("mainline", "check");
    expect(again.stderr).toBe("");
    expect(again.stdout).not.toContain("下一步");
  });

  it("show、check、history、diff 查集中存储里的主线", () => {
    const { file, run } = opened();
    writeFileSync(file, draft);
    run(...sync());
    writeFileSync(file, `${numbered}\n## 交付线\n\n第一期做命令行。\n`);

    // show 是只读的：显示交上去的最新修订（修订 2），主线.md 里没交的改动只提醒。
    const show = run("mainline", "show");
    expect(show.stderr).toContain("警告：主线.md 有还没交上去的改动");
    expect(show.stderr).not.toContain("同步了主线");
    expect(show.stdout.split("\n")[0]).toMatch(/^主线修订 2：/u);
    expect(run(...sync()).stderr).toContain("同步了主线：主线.md 交成了修订 3。\n");
    const lines = run("mainline", "show").stdout.split("\n");
    expect(lines[0]).toMatch(/^主线修订 3：\d{4}-\d{2}-\d{2} \d{2}:\d{2}，来自项目缓存$/u);
    expect(lines).toContain("场景 2 个：");
    expect(lines).toContain("  S1  看队列");

    expect(run("mainline", "show", "2", "--text").stdout).toContain(`全文：\n${numbered}`);
    expect(run("mainline", "check").stdout.split("\n")[0]).toBe(
      "查了主线.md 现在的内容，没有交新的修订。",
    );
    expect(run("mainline", "diff").stdout).toContain(
      "比较了主线修订 2 和修订 3\n  …\n  谁在什么时候用：你。\n  1. 点决定 → 看到表格\n+\n+ ## 交付线\n",
    );
    expect(run("mainline", "diff", "2").stdout.split("\n")[0]).toBe("比较了主线修订 2 和修订 3");

    const json = run("mainline", "history", "--json");
    expect(cliEnvelopeSchema.parse(JSON.parse(json.stdout))).toMatchObject({
      kind: "mainline.history",
      data: [{ revision: 1 }, { revision: 2, source: "项目缓存" }, { revision: 3 }],
    });
    const missing = run("mainline", "show", "9");
    expect(missing.code).toBe(4);
  });

  it("push：没有主线.md 时退出码 4；--project 写编号时退出码 2", () => {
    const { s, file, run } = opened();
    rmSync(file);
    expect(run("mainline", "push").code).toBe(4);
    const byId = s.ploop(".", "mainline", "push", "--project", "app");
    expect(byId.stderr.split("\n")[0]).toBe(
      "用法错误：ploop mainline push 要读写主线.md，--project 写的「app」是项目名。",
    );
    expect(byId.code).toBe(2);
  });

  it("F10 push 交上去时已经校验过，下一步照项目状态给，不再让人回头 check", () => {
    const { file, run } = opened();
    writeFileSync(file, draft);
    const pushed = run("mainline", "push");
    expect(pushed.stdout).toContain("下一步：\n  1. ploop round start 构思\n");
    expect(pushed.stdout).not.toContain("ploop mainline check");
    expect(pushed.code).toBe(0);
  });

  it("push --json：data 里有交上的这次修订和补上的场景编号", () => {
    const { file, run } = opened();
    writeFileSync(file, draft);
    const { code, stdout, stderr } = run("mainline", "push", "--json");
    expect(stdout.trimEnd().split("\n")).toHaveLength(1);
    expect(cliEnvelopeSchema.parse(JSON.parse(stdout))).toMatchObject({
      kind: "mainline.pushed",
      ok: true,
      data: {
        kind: "pushed",
        rewritten: true,
        pushed: {
          created: true,
          revision: { revision: 2 },
          assignedScenes: [
            { id: "S1", name: "看队列" },
            { id: "S2", name: "看决定" },
          ],
        },
      },
    });
    expect(stderr).toBe("");
    expect(code).toBe(0);
    expect(readFileSync(file, "utf8")).toBe(numbered);
  });
});
