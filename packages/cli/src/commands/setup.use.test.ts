import { spawnSync } from "node:child_process";
import {
  cpSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import { sandbox, testBuild } from "./testing.ts";

// ploop setup 和升级替换，对着打包的产物跑，见第一期计划第 64、65 步。
// 家目录和集中存储都是临时的：产物复制到 app/<版本>/，current 指向它，
// ~/.local/bin/ploop 用 Node 的绝对路径执行 app/current/ploop.mjs。

const appDir = process.env.PLOOP_TEST_APP;

/** 版本号：打包时写进 build.json 的。 */
const versionOf = (dir: string) =>
  (JSON.parse(readFileSync(join(dir, "build.json"), "utf8")) as { version: string }).version;

/** 一个装好了 A 版的沙盒，和运行 ~/.local/bin/ploop 的方法。 */
function installed() {
  const s = sandbox();
  const setup = s.ploop("", "setup");
  expect(setup.code).toBe(0);
  const launcher = join(s.home, ".local", "bin", "ploop");
  mkdirSync(s.at("proj/app"), { recursive: true });
  const ploop = (...argv: string[]) =>
    spawnSync(launcher, argv, { cwd: s.at("proj/app"), env: s.env, encoding: "utf8" });
  // 装好的后端从 app/ 下运行，沙盒认不出它，测试结束时请它退出。
  onTestFinished(() => {
    ploop("backend", "stop");
  });
  return { s, setup, launcher, ploop };
}

describe.skipIf(appDir === undefined)("安装和升级", { timeout: 90_000 }, () => {
  it("产物复制到 app/<版本>/，current 指向它，启动脚本写好 Node 的绝对路径", () => {
    const { s, setup, launcher, ploop } = installed();
    const version = versionOf(appDir ?? "");
    expect(setup.stdout.split("\n")[0]).toBe(`装好了：${version}（构建号 ${testBuild}）`);
    const current = join(s.store, "app", "current");
    expect(lstatSync(current).isSymbolicLink()).toBe(true);
    expect(readlinkSync(current)).toBe(version);
    const script = readFileSync(launcher, "utf8");
    expect(script).toContain(`'${process.execPath}'`);
    expect(script).toContain(`'${join(s.store, "app", "current", "ploop.mjs")}'`);
    expect(lstatSync(launcher).mode & 0o111).not.toBe(0);
    expect(ploop("init", "--repo", "自己的").status).toBe(0);
    expect(ploop("backend", "status").stdout).toContain(`构建号：${testBuild}`);
  });

  it("--version 切回装过的版本；没装过的版本退出码 4，列出装过的", () => {
    const { s, ploop } = installed();
    const older = join(s.store, "app", "0.0.0");
    cpSync(appDir ?? "", older, { recursive: true });
    writeFileSync(
      join(older, "build.json"),
      JSON.stringify({ build: "0.0.0+old", version: "0.0.0" }),
    );
    const back = ploop("setup", "--version", "0.0.0");
    expect(back.stdout.split("\n")[0]).toBe("切换到了：0.0.0（构建号 0.0.0+old）");
    expect(readlinkSync(join(s.store, "app", "current"))).toBe("0.0.0");
    const missing = ploop("setup", "--version", "0.1.0");
    expect(missing.stderr).toContain(
      `没有装过 0.1.0。装过的有：0.0.0、${versionOf(appDir ?? "")}。`,
    );
    expect(missing.status).toBe(4);
  });

  it("先装 A 版并拉起后端，再装 B 版：A 版的后端被请退出，下一条命令用的是 B 版的后端", () => {
    const { s, ploop } = installed();
    expect(ploop("init", "--repo", "自己的").status).toBe(0);
    const before = ploop("backend", "status").stdout;
    expect(before).toContain(`构建号：${testBuild}`);
    const pidA = Number(/进程 (\d+)/u.exec(before)?.[1]);

    // B 版：同一份产物，构建号换掉。
    const buildB = `${testBuild}-b`;
    const dirB = join(mkdtempSync(join(s.at(""), "b-")), "app");
    cpSync(appDir ?? "", dirB, { recursive: true });
    for (const name of ["ploop.mjs", "backend.mjs", "build.json"]) {
      const file = join(dirB, name);
      writeFileSync(file, readFileSync(file, "utf8").replaceAll(testBuild, buildB));
    }
    const setupB = spawnSync(process.execPath, [join(dirB, "ploop.mjs"), "setup"], {
      cwd: s.at("proj/app"),
      env: s.env,
      encoding: "utf8",
    });
    expect(setupB.stdout).toContain(`（构建号 ${buildB}）`);
    expect(setupB.stdout).toContain(`请旧后端退出了：进程 ${pidA}`);
    expect(setupB.status).toBe(0);

    expect(ploop("status").status).toBe(0);
    const after = ploop("backend", "status").stdout;
    expect(after).toContain(`构建号：${buildB}`);
    expect(after).not.toContain(`进程 ${pidA}，`);
  });
});
