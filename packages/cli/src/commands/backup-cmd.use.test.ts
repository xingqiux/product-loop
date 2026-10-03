import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beijingMinute } from "@product-loop/model";
import { describe, expect, it, onTestFinished } from "vitest";
import { fullMainline, sandbox } from "./testing.ts";

// ploop backup now|list|restore|gc，对着真的后端跑，见第一期计划第 56 步。
// 恢复由后端做：先留存当前的数据库，再放回快照，然后做完整性检查。

describe("备份和恢复", { timeout: 60_000 }, () => {
  it("做快照、列出、放进一件事以后恢复，这件事不见了；gc 腾出空间", () => {
    const s = sandbox();
    const run = (...argv: string[]) => s.ploop("proj/app", ...argv);
    expect(run("init", "--repo", "自己的").code).toBe(0);

    const taken = run("backup", "now");
    const name = /做好了快照：(manual-\d{8}T\d{9}Z\.db)（/u.exec(taken.stdout)?.[1] ?? "";
    expect(name).not.toBe("");
    expect(taken.code).toBe(0);

    const listed = run("backup", "list");
    // 每行先写时间，再写大小和文件名；手动快照的时间是文件名里的 UTC 时间换成北京时间。
    const stamp = /^manual-(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})/u.exec(name) ?? [];
    const at = new Date(`${stamp[1]}-${stamp[2]}-${stamp[3]}T${stamp[4]}:${stamp[5]}:00Z`);
    expect(listed.stdout).toContain(`手动：\n  ${beijingMinute(at)}  `);
    expect(listed.stdout).toContain(` KB  ${name}\n`);
    expect(run("backup").stdout).toBe(listed.stdout);

    expect(run("queue", "add", "看板放到首页", "--stage", "构思").code).toBe(0);

    // 没加 --yes：只预告，什么都不改（N17）。项目都在快照里，所以写「都还在」。
    const previewed = run("backup", "restore", name);
    expect(previewed.stdout.split("\n")[0]).toBe("没有恢复，先看一下会怎样。");
    expect(previewed.stdout).toContain(`现在的数据库会换成 ${name}。`);
    expect(previewed.stdout).toContain("已登记的项目恢复以后都还在。");
    expect(previewed.stdout).toContain("要恢复，先问用户；同意了加 --yes 再运行。");
    expect(previewed.code).toBe(1);
    expect(run("queue", "list").stdout).toContain("看板放到首页");
    expect(run("backup", "list").stdout).not.toContain("恢复前留存：");

    const restored = run("backup", "restore", name, "--yes");
    expect(restored.stdout.split("\n")[0]).toBe(`恢复了：${name}`);
    expect(restored.stdout).toContain("完整性检查：没有问题");
    expect(restored.code).toBe(0);
    expect(run("queue", "list").stdout).not.toContain("看板放到首页");
    expect(run("backup", "list").stdout).toContain("恢复前留存：");

    const missing = run("backup", "restore", "daily-2020-01-01.db");
    expect(missing.stderr).toContain("backups 里没有名为 daily-2020-01-01.db 的快照。");
    expect(missing.code).toBe(4);

    expect(run("backup", "gc").stdout.split("\n")[0]).toBe(
      "清理了 0 个附件和 0 个临时文件，腾出 0 B",
    );
  });

  it("今天的快照没做成的警告写在 backup list 里", () => {
    const s = sandbox();
    const run = (...argv: string[]) => s.ploop("proj/app", ...argv);
    expect(run("backend", "start").code).toBe(0);
    // 备份目录改成只读，后端第一次写入时做每日快照会失败。
    chmodSync(join(s.store, "backups"), 0o555);
    onTestFinished(() => chmodSync(join(s.store, "backups"), 0o755));
    expect(run("init", "--repo", "自己的").code).toBe(0);
    const listed = run("backup", "list");
    expect(listed.stdout).toBe("还没有快照。\n");
    expect(listed.stderr).toContain("警告：今天的数据库快照没有做成");
    expect(listed.code).toBe(0);
  });

  it("恢复到项目登记以前的快照：列出消失的项目，status、doctor、init 各指向出口，重新登记以后接着用", () => {
    const s = sandbox();
    const run = (...argv: string[]) => s.ploop("proj/app", ...argv);
    // 先有一个别的项目，快照里只有它。
    expect(s.ploop("proj/first", "init", "--repo", "自己的").code).toBe(0);
    const taken = s.ploop("proj/first", "backup", "now");
    const name = /做好了快照：(manual-\d{8}T\d{9}Z\.db)（/u.exec(taken.stdout)?.[1] ?? "";
    expect(name).not.toBe("");

    // 快照以后才登记的项目，主线已经写了内容。
    expect(run("init", "--repo", "自己的").code).toBe(0);
    const cache = join(s.at("proj/app"), ".product-loop");
    writeFileSync(join(cache, "主线.md"), fullMainline);
    expect(run("queue", "add", "看板放到首页", "--stage", "构思").code).toBe(0);

    // 没加 --yes：先列出会没有的项目，不动数据（N17）。
    const previewed = run("backup", "restore", name);
    expect(previewed.code).toBe(1);
    expect(previewed.stdout).toContain("恢复以后，这 1 个项目就没有了：");
    expect(previewed.stdout).toContain(`  app（${s.at("proj/app")}）`);
    expect(previewed.stdout).toContain("它们是这份快照以后才登记的。");
    expect(run("queue", "list").stdout).toContain("看板放到首页");

    const restored = run("backup", "restore", name, "--yes");
    expect(restored.code).toBe(0);
    expect(restored.stdout).toContain(`恢复以后没有了这几个项目：app（${s.at("proj/app")}）`);
    expect(restored.stdout).toContain("要撤销这次恢复，运行 ploop backup restore pre-restore-");
    expect(restored.stdout).toContain(`下一步：\n  1. ploop init --project ${s.at("proj/app")}\n`);

    // status 不再指向 doctor：直接说怎么重新登记。
    const status = run("status");
    expect(status.code).toBe(6);
    expect(status.stderr).toContain("集中存储里没有登记它。");
    expect(status.stderr).toContain(
      "怎么改：运行 ploop init 重新登记，项目缓存里的主线.md 和各阶段的文件保留。",
    );
    expect(status.stderr).not.toContain("ploop doctor");

    // doctor 看得出来，不再说「没有要迁移的地方」。
    const doctor = run("doctor");
    expect(doctor.stdout).toContain("身份：要迁移");
    expect(doctor.stdout).toContain("发现：project.json 记着项目 app，集中存储里没有登记它。");
    expect(doctor.stdout).not.toContain("没有要迁移的地方");

    // init 不用写 --repo，按缓存里的忽略规则认出仓库是自己的，主线.md 保留并交成第 1 版。
    const again = run("init");
    expect(again.stdout.split("\n")[0]).toBe("重新登记了：项目 app，项目缓存原样保留");
    expect(again.stdout).toContain("集中存储里的队列、决定、回复和阶段记录没有了，项目缓存还在。");
    expect(again.stdout).toContain("主线：项目缓存里的主线.md 已经交成第 1 版");
    expect(again.code).toBe(0);
    expect(readFileSync(join(cache, "主线.md"), "utf8")).toBe(fullMainline);
    const after = run("status");
    expect(after.stdout.split("\n")[0]).toBe("项目 app：第 1 版，还没开始任何阶段");
    expect(after.stdout).toContain("主线：10 个部分齐全");
    expect(after.code).toBe(0);
  });

  it("doctor --fix 也能重新登记，和 ploop init 一样", () => {
    const s = sandbox();
    const run = (...argv: string[]) => s.ploop("proj/app", ...argv);
    expect(s.ploop("proj/first", "init", "--repo", "自己的").code).toBe(0);
    const taken = s.ploop("proj/first", "backup", "now");
    const name = /做好了快照：(manual-\d{8}T\d{9}Z\.db)（/u.exec(taken.stdout)?.[1] ?? "";
    expect(run("init", "--repo", "共用的").code).toBe(2);
    s.gitInit("proj/app");
    expect(run("init", "--repo", "共用的").code).toBe(0);
    expect(run("backup", "restore", name, "--yes").code).toBe(0);
    const fixed = run("doctor", "--fix");
    expect(fixed.stdout.split("\n")[0]).toBe("重新登记了：项目 app，项目缓存原样保留");
    expect(fixed.code).toBe(0);
    expect(run("status").code).toBe(0);
    // 仓库是共用的：规则在 .git/info/exclude 里，认了出来，登记的还是共用的。
    expect(run("status", "--all").stdout).toContain("app");
    expect(readFileSync(join(s.at("proj/app"), ".git", "info", "exclude"), "utf8")).toContain(
      ".product-loop/",
    );
  });
});
