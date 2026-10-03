import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { cliEnvelopeSchema } from "@product-loop/model";
import { describe, expect, it } from "vitest";

// 命令行测试：用 node 直接运行命令行的入口，Node 运行时去掉类型。要起子进程，所以归到 pnpm use。
// 子进程的标准输出是管道，不是终端。第 15 步以后改成对着打包好的产物跑。

const main = fileURLToPath(new URL("./main.ts", import.meta.url));

function ploop(...argv: string[]) {
  const result = spawnSync(process.execPath, [main, ...argv], { encoding: "utf8" });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

describe("用 node 运行命令行的入口", () => {
  it("--json 时出错：退出码 2，标准输出只有一个 JSON 对象，标准错误什么也不写", () => {
    const { code, stdout, stderr } = ploop("--json", "nosuch");
    expect(stdout.trimEnd().split("\n")).toHaveLength(1);
    expect(cliEnvelopeSchema.parse(JSON.parse(stdout))).toEqual({
      schemaVersion: 1,
      kind: "error",
      ok: false,
      error: {
        code: "BAD_REQUEST",
        message: "ploop 下面没有命令 nosuch。",
        hint: "运行 ploop --help 查看用法。",
      },
    });
    expect(stderr).toBe("");
    expect(code).toBe(2);
  });

  it("不带 --json 时出错：中文写到标准错误，标准输出是空的，退出码 2", () => {
    const { code, stdout, stderr } = ploop("--tkae");
    expect(stderr).toBe(
      "用法错误：ploop 没有选项 --tkae。\n怎么改：运行 ploop --help 查看用法。\n",
    );
    expect(stdout).toBe("");
    expect(code).toBe(2);
  });

  it("--json --version：一个 JSON 对象，退出码 0", () => {
    const { code, stdout } = ploop("--json", "--version");
    expect(cliEnvelopeSchema.parse(JSON.parse(stdout))).toMatchObject({
      kind: "version",
      ok: true,
    });
    expect(code).toBe(0);
  });

  it("标准输出不是终端时帮助不折行，标题是中文", () => {
    const { code, stdout, stderr } = ploop("--help");
    const lines = stdout.split("\n");
    expect(lines).toContain("用法");
    expect(lines).toContain("阶段的四步");
    expect(lines).toContain(
      "  --project <项目名或路径>  指定项目：项目名，或项目里的路径；不写按当前目录找",
    );
    expect(lines.filter((line) => /^ {3,}\S/u.test(line))).toEqual([]);
    expect(stderr).toBe("");
    expect(code).toBe(0);
  });
});
