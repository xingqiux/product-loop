import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { sandbox } from "./testing.ts";

// ploop export [--legacy] 和 ploop storage，对着真的后端跑，见第一期计划第 57 步。
// --legacy 写回的队列.json 要能被旧 skill 的 queue.py 读取。仓库里的 tools/legacy/v1-final/queue.py
// 是旧 skill 的原样，只读不改。

const queueScript = fileURLToPath(
  new URL("../../../../tools/legacy/v1-final/queue.py", import.meta.url),
);

describe("导出", { timeout: 60_000 }, () => {
  it("导出成文件夹；--legacy 写回项目缓存，旧的 queue.py 读得出；storage 列出占用", () => {
    const s = sandbox();
    const run = (...argv: string[]) => s.ploop("proj/app", ...argv);
    expect(run("init", "--repo", "自己的").code).toBe(0);
    expect(run("queue", "add", "看板放到首页", "--stage", "落地").code).toBe(0);
    expect(run("queue", "add", "理清给谁用", "--stage", "构思").code).toBe(0);
    expect(run("round", "start", "构思").code).toBe(0);

    const exported = run("export", "--out", "out");
    expect(exported.stdout.split("\n")[0]).toMatch(/^导出了：.*\/out，\d+ 个文件$/u);
    const out = join(s.at("proj/app"), "out");
    expect(readFileSync(join(out, "队列.md"), "utf8")).toContain("## 构思\n\n### 进行中\n");
    expect(existsSync(join(out, "rounds", "v1-构思-1.json"))).toBe(true);
    expect(existsSync(join(out, "决定.md"))).toBe(true);
    // 文件夹已经在了：报错里路径只写在正文里，不再另写一行「位置」（N14）。
    const again = run("export", "--out", "out");
    expect(again.code).toBe(3);
    expect(again.stderr).not.toContain("位置：");
    // --out 是用户自己起的名字，不用说时间。
    expect(exported.stdout).not.toContain("UTC");

    const legacy = run("export", "--legacy");
    expect(legacy.stdout.split("\n")[0]).toBe("按旧格式写回了：.product-loop");
    // 输出最后写下一步：把 skill 的链接改回旧正文。
    expect(legacy.stdout).toContain("\n下一步：\n  1. 把 skill 的链接改回旧正文\n");
    const queueFile = join(s.at("proj/app"), ".product-loop", "队列.json");
    const read = spawnSync("python3", [queueScript, "看", queueFile], { encoding: "utf8" });
    expect(read.stderr).toBe("");
    expect(read.status).toBe(0);
    expect(read.stdout).toContain("看板放到首页");
    expect(read.stdout).toContain("理清给谁用");

    const storage = run("storage");
    expect(storage.stdout.split("\n")[0]).toMatch(/^集中存储的占用：附件 0 个，0 B；数据库 /u);
    // 项目的名字和编号相同时只写一个，不写成「app  app」。
    expect(storage.stdout).toContain("\n  app  附件 0 个，0 B\n");
  });

  it("不写 --out：导到集中存储的 exports/ 下，当前目录里不多出东西", () => {
    const s = sandbox();
    const run = (...argv: string[]) => s.ploop("proj/app", ...argv);
    expect(run("init", "--repo", "自己的").code).toBe(0);
    const before = readdirSync(s.at("proj/app"));

    const exported = run("export");
    const head = exported.stdout.split("\n")[0] ?? "";
    const dir = /^导出了：(.*)，\d+ 个文件$/u.exec(head)?.[1] ?? "";
    expect(dir.startsWith(join(s.store, "exports", "ploop-export-app-"))).toBe(true);
    // 文件夹名里的时间是 UTC，以 Z 结尾，输出里写明（N10）。
    expect(dir).toMatch(/ploop-export-app-\d{8}T\d{6}Z$/u);
    expect(exported.stdout.split("\n")[1]).toBe("文件夹名里的时间是 UTC。");
    expect(existsSync(join(dir, "决定.md"))).toBe(true);
    expect(exported.code).toBe(0);
    // 用户的项目目录没有变，落地阶段收尾时不会因为它多出没提交的文件。
    expect(readdirSync(s.at("proj/app"))).toEqual(before);
  });
});
