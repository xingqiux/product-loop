import { describe, expect, it } from "vitest";
import { createExec } from "./exec.ts";

// 真的执行器，按 core/time-machine.ts 的 Exec 约定，见 exec.ts。要起子进程，所以归到 pnpm use。
// 用 node 自己当外部命令，不运行 tmutil。

const node = process.execPath;

describe("真的执行器", () => {
  it("正常退出：返回退出码 0 和两路输出", async () => {
    const exec = createExec(10_000);
    const script = "process.stdout.write('out'); process.stderr.write('err')";
    expect(await exec(node, ["-e", script])).toEqual({
      ok: true,
      value: { status: 0, stdout: "out", stderr: "err" },
    });
  });

  it("退出码不是 0 也算运行完：返回 ok，带着退出码", async () => {
    const exec = createExec(10_000);
    const script = "process.stdout.write('partial'); process.exit(3)";
    expect(await exec(node, ["-e", script])).toEqual({
      ok: true,
      value: { status: 3, stdout: "partial", stderr: "" },
    });
  });

  it("找不到命令：返回 notFound", async () => {
    const exec = createExec(10_000);
    expect(await exec("/no/such/tmutil", ["destinationinfo"])).toEqual({
      ok: false,
      error: { kind: "notFound" },
    });
  });

  it("超时：结束那个进程，返回 failed，写明等了几秒", async () => {
    const exec = createExec(300);
    const started = Date.now();
    expect(await exec(node, ["-e", "setTimeout(() => {}, 60000)"])).toEqual({
      ok: false,
      error: { kind: "failed", message: "超过 0.3 秒没有结束。" },
    });
    expect(Date.now() - started).toBeLessThan(5000);
  });
});
