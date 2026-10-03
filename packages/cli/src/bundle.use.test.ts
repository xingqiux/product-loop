import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { isBuiltin } from "node:module";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { sandbox, testBuild } from "./commands/testing.ts";

// 打包的产物，见第一期计划第 15 步，照验证代码的 verify-bundle 做。
// 运行目录复制到没有 node_modules 的地方，node ploop.mjs 能拉起 backend.mjs，两边的构建号相同。

const appDir = process.env.PLOOP_TEST_APP;

/**
 * 打出的文件引入的包：静态的 import、动态的 import() 和 rolldown 换成的 __require()。
 * 先去掉注释，打进来的库在 JSDoc 里写的 import("./x.js") 不算。
 */
function importsOf(file: string): string[] {
  const code = readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//gu, "")
    .replace(/^\s*\/\/.*$/gmu, "");
  return [
    ...[...code.matchAll(/^\s*(?:import|export)\b[^'"]*?\bfrom\s*["']([^"']+)["']/gmu)],
    ...[...code.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/gu)],
    ...[...code.matchAll(/\b__require\(\s*["']([^"']+)["']\s*\)/gu)],
  ].flatMap((match) => (match[1] === undefined ? [] : [match[1]]));
}

describe.skipIf(appDir === undefined)("打包的产物", { timeout: 60_000 }, () => {
  it("运行目录里是两个入口、原生文件、迁移、工作台和 build.json，入口只引入 Node 自带的模块", () => {
    const dir = appDir ?? "";
    const names = readdirSync(dir).sort();
    expect(names).toEqual([
      "backend.mjs",
      "build.json",
      `${process.platform}-${process.arch}.node`,
      "drizzle",
      "ploop.mjs",
      "web",
    ]);
    expect(existsSync(join(dir, "drizzle", "meta", "_journal.json"))).toBe(true);
    expect(existsSync(join(dir, "web", "index.html"))).toBe(true);
    expect(existsSync(join(dir, "web", "licenses", "noto-sans-sc.txt"))).toBe(true);
    for (const entry of ["ploop.mjs", "backend.mjs"]) {
      expect(importsOf(join(dir, entry)).filter((name) => !isBuiltin(name))).toEqual([]);
    }
    expect(testBuild).toMatch(/^\d+\.\d+\.\d+[^+]*\+[0-9a-f]+\.\d{8}T\d{6}Z$/u);
  });

  it("复制到没有 node_modules 的目录，node ploop.mjs 开工时拉起 backend.mjs，构建号相同", () => {
    const s = sandbox();
    const copy = join(mkdtempSync(join(s.at(""), "app-")), "app");
    cpSync(appDir ?? "", copy, { recursive: true });
    for (let d = copy; dirname(d) !== d; d = dirname(d)) {
      expect(existsSync(join(d, "node_modules")), d).toBe(false);
    }
    const run = (...argv: string[]) =>
      spawnSync(process.execPath, [join(copy, "ploop.mjs"), ...argv], {
        cwd: s.at("proj"),
        env: { ...s.env, NODE_PATH: "" },
        encoding: "utf8",
      });
    mkdirSync(s.at("proj"), { recursive: true });
    expect(run("init", "--repo", "自己的").status).toBe(0);
    const status = run("backend", "status");
    expect(status.stdout).toContain(`构建号：${testBuild}`);
    expect(status.stdout).toMatch(/^在运行：后端，进程 \d+/u);
    expect(run("backend", "stop").status).toBe(0);
  });
});
