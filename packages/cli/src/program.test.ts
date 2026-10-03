import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { cliEnvelopeSchema } from "@product-loop/model";
import { describe, expect, it } from "vitest";
import packageJson from "../package.json" with { type: "json" };
import { cliBuild } from "./connect.ts";
import { helpEnvCopy, helpGroupCopy, transitionalDate } from "./copy/help.ts";
import { buildWithRoundStart, ploop, roundStartedText } from "./fixture.ts";
import { groupOf, helpGroups } from "./help.ts";
import { buildProgram, commandGroups, type ProgramContext } from "./program.ts";
import { makeTree, tempRoot } from "./project/testing.ts";

/** 标准输出应当正好是一个 JSON 对象，占一行，合乎命令行的外壳。 */
function onlyJson(stdout: string) {
  expect(stdout.trimEnd().split("\n")).toHaveLength(1);
  return cliEnvelopeSchema.parse(JSON.parse(stdout));
}

describe("ploop 的骨架", () => {
  it("--help 和 -h 显示帮助，退出码 0，标准错误什么也不写", async () => {
    const long = await ploop(["--help"]);
    const short = await ploop(["-h"]);
    expect(long.stdout.startsWith("ploop\n\n产品循环的命令行")).toBe(true);
    expect(short).toEqual(long);
    expect(long.stderr).toBe("");
    expect(long.code).toBe(0);
  });

  it("ploop --help 只列日常和按需两组；加 --all 列四组，过渡命令写明删除的日期（C07）", async () => {
    const plain = (await ploop(["--help"], { build: buildProgram })).stdout.split("\n");
    expect(plain).toContain("日常命令");
    expect(plain).toContain("按需命令");
    expect(plain).not.toContain("维护命令");
    expect(plain.some((line) => line.startsWith("过渡命令"))).toBe(false);
    const skill = (await ploop(["skill", "--help"], { build: buildProgram })).stdout;
    expect(skill).not.toContain("issues");
    const skillAll = (await ploop(["skill", "--help", "--all"], { build: buildProgram })).stdout;
    expect(skillAll).toContain("issues");
    // --all 写在 -- 后面是参数，不是要看全部。
    const rest = (await ploop(["skill", "--help", "--", "--all"], { build: buildProgram })).stdout;
    expect(rest).not.toContain("issues");
    const { stdout } = await ploop(["--help", "--all"], { build: buildProgram });
    const headings = ["日常命令", "按需命令", "维护命令", `过渡命令（${transitionalDate} 删除）`];
    const lines = stdout.split("\n");
    const at = headings.map((heading) => lines.indexOf(heading));
    expect(at.every((index) => index > 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    const group = (heading: string) => {
      const from = lines.indexOf(heading) + 1;
      const rest = lines.slice(from);
      return rest.slice(0, rest.indexOf("")).map((line) => line.trim().split(/\s+/u)[0]);
    };
    // 每组里的命令按命令树的顺序列，和 commandGroups 里写的顺序无关。
    const sorted = (names: readonly (string | undefined)[]) => [...names].sort();
    expect(sorted(group(headings[0] ?? ""))).toEqual(sorted(commandGroups.daily));
    expect(sorted(group(headings[1] ?? ""))).toEqual(sorted(commandGroups.onDemand));
    expect(sorted(group(headings[2] ?? ""))).toEqual(sorted(commandGroups.maintenance));
    expect(sorted(group(headings[3] ?? ""))).toEqual(sorted(commandGroups.transitional));
    // 没有归组的命令不会在「命令」一节里漏着。
    expect(lines).not.toContain("命令");
  });

  it("每条顶层命令都归了组，过渡命令的说明里写明删除的日期", () => {
    const program = buildProgram({
      cwd: "/",
      env: {},
      userHome: "/",
      columns: undefined,
      notice: () => {},
      settle: () => {},
    });
    const listed = Object.values(commandGroups).flat();
    expect(program.commands.map((command) => command.name()).sort()).toEqual([...listed].sort());
    expect(new Set(listed).size).toBe(listed.length);
    expect(helpGroups).toEqual(Object.keys(helpGroupCopy));
    const transitional: string[] = [];
    const walk = (command: (typeof program.commands)[number]) => {
      if (groupOf(command) === "transitional") {
        transitional.push(command.name());
        expect(command.description(), command.name()).toContain(transitionalDate);
      }
      for (const sub of command.commands) walk(sub);
    };
    for (const command of program.commands) walk(command);
    expect(transitional).toEqual(["doctor", "ingest", "ingest"]);
  });

  it("不带子命令时等同 ploop status：往上找不到项目时一样报找不到，退出码 4", async () => {
    const home = tempRoot();
    makeTree(home, ["proj/app/"]);
    const options = { cwd: join(home, "proj", "app"), userHome: home };
    const bare = await ploop([], options);
    expect(bare).toEqual(await ploop(["status"], options));
    expect(bare.stderr).toContain("都没有项目缓存");
    expect(bare.stderr).toContain("ploop init");
    expect(bare.code).toBe(4);
  });

  it("--version 和 -V 显示 package.json 里的版本号，第二行写构建号", async () => {
    const { code, stdout } = await ploop(["--version"]);
    expect(stdout).toBe(`${packageJson.version}\n构建号：${cliBuild}\n`);
    expect((await ploop(["-V"])).stdout).toBe(stdout);
    expect(code).toBe(0);
  });

  it("--version 写在子命令后面时交给子命令，写在前面才是版本号", async () => {
    const after = await ploop(["setup", "--version", "0.0.1", "--help"]);
    expect(after.stdout).toContain("ploop setup");
    expect(after.stdout).not.toContain("构建号");
    expect((await ploop(["--version", "setup"])).stdout).toBe(
      `${packageJson.version}\n构建号：${cliBuild}\n`,
    );
  });

  it("--json 时帮助和版本号也各是一个 JSON 对象", async () => {
    const help = await ploop(["round", "start", "--help", "--json"]);
    const text = (await ploop(["round", "start", "--help"])).stdout;
    expect(onlyJson(help.stdout)).toEqual({
      schemaVersion: 1,
      kind: "help",
      ok: true,
      data: { text: text.trimEnd() },
      warnings: [],
      next: [],
    });
    const version = await ploop(["--json", "--version"]);
    expect(onlyJson(version.stdout)).toMatchObject({
      kind: "version",
      data: { version: packageJson.version, build: cliBuild },
    });
    expect([help.code, version.code]).toEqual([0, 0]);
  });

  it("命令交回的结果照文字输出，退出码 0", async () => {
    const { code, stdout, stderr } = await ploop(["round", "start", "检查"]);
    expect(stdout).toBe(`${roundStartedText}\n`);
    expect(stderr).toBe("");
    expect(code).toBe(0);
  });

  it.each([
    ["写在子命令前面", ["--json", "round", "start", "检查"]],
    ["写在子命令后面", ["round", "start", "检查", "--json"]],
    ["夹在选项中间", ["round", "start", "落地", "--take", "Q12", "--json", "--defer", "Q9=等Q12"]],
  ])("--json %s都算，标准输出只有一个 JSON 对象", async (_where, argv) => {
    const { code, stdout, stderr } = await ploop(argv);
    expect(onlyJson(stdout)).toMatchObject({ kind: "round.started", ok: true });
    expect(stderr).toBe("");
    expect(code).toBe(0);
  });

  it("不认识的子命令是用法错误", async () => {
    const { code, stderr } = await ploop(["nosuch"], { build: buildProgram });
    expect(stderr).toBe(
      "用法错误：ploop 下面没有命令 nosuch。\n怎么改：运行 ploop --help 查看用法。\n",
    );
    expect(code).toBe(2);
  });

  it("顶层写错命令名：报认不出的命令，写得接近的给出建议；ploop help 当作 --help", async () => {
    const typo = await ploop(["stauts"], { build: buildProgram });
    expect(typo.stderr).toBe(
      "用法错误：ploop 下面没有命令 stauts。\n怎么改：要写的可能是 status。运行 ploop --help 查看用法。\n",
    );
    expect(typo.code).toBe(2);
    const far = await ploop(["zzzzzz"], { build: buildProgram });
    expect(far.stderr).not.toContain("要写的可能是");
    const long = await ploop(["--help"], { build: buildProgram });
    expect(await ploop(["help"], { build: buildProgram })).toEqual(long);
    const round = await ploop(["round", "--help"], { build: buildProgram });
    expect(await ploop(["help", "round"], { build: buildProgram })).toEqual(round);
    // 写在别的命令后面的 help 是那条命令的参数，不动。
    const inner = await ploop(["queue", "help"], { build: buildProgram });
    expect(inner.code).toBe(2);
  });

  it("命令没有交回结果时报程序的错误，不当成成功", async () => {
    const build = (context: ProgramContext) => {
      const program = buildWithRoundStart(context);
      program.command("noop").description("什么也不交回");
      return program;
    };
    await expect(ploop(["noop"], { build })).rejects.toThrow("没有交回结果");
  });
});

describe("环境变量清单", () => {
  /** 各个包的 src 下的源码（不含测试）里读到的 PLOOP_ 开头的变量名。 */
  function namesInSource(): Set<string> {
    const packages = fileURLToPath(new URL("../../", import.meta.url));
    const found = new Set<string>();
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (/\.tsx?$/u.test(entry.name) && !/\.test\.tsx?$/u.test(entry.name)) {
          for (const [name] of readFileSync(path, "utf8").matchAll(/\bPLOOP_[A-Z_]+\b/gu)) {
            found.add(name);
          }
        }
      }
    };
    for (const pkg of ["backend", "cli", "client", "model"]) walk(join(packages, pkg, "src"));
    return found;
  }

  it("代码里读的 PLOOP_ 变量都写在 ploop --help 的环境变量一节里", () => {
    // PLOOP_BUILD 是打包时换掉的常量，PLOOP_TEST_APP 只有测试用，PLOOP_STAGE 是报错文案的样例。
    const internal = new Set(["PLOOP_BUILD", "PLOOP_TEST_APP", "PLOOP_STAGE"]);
    const listed = new Set(helpEnvCopy.map(({ name }) => name));
    const missing = [...namesInSource()].filter((name) => !internal.has(name) && !listed.has(name));
    expect(missing).toEqual([]);
  });
});
