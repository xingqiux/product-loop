import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ploop } from "../fixture.ts";
import { identity, makeTree, tempRoot } from "../project/testing.ts";

// prime 不碰后端就能回答的几种：不在项目里什么都不输出；在项目里后端没开时写一行怎么启动。
// 退出码都是 0，也不拉起后端。后端在运行时的输出写在使用测试里。

describe("ploop prime 不连后端也不出声", () => {
  it("不在项目里：什么都不输出，退出码 0", async () => {
    const home = tempRoot();
    makeTree(home, ["proj/plain/"]);
    const result = await ploop(["prime"], {
      cwd: join(home, "proj", "plain"),
      userHome: home,
      env: { PLOOP_HOME: join(home, "store") },
    });
    expect(result).toEqual({ code: 0, stdout: "", stderr: "" });
  });

  it("在项目里但后端没有在运行：写一行说明怎么启动，退出码 0，不拉起后端", async () => {
    const home = tempRoot();
    const root = join(home, "proj", "app");
    makeTree(root, [[".product-loop/project.json", JSON.stringify(identity)]]);
    const store = join(home, "store");
    const result = await ploop(["prime"], {
      cwd: root,
      userHome: home,
      env: { PLOOP_HOME: store },
    });
    expect(result).toEqual({
      code: 0,
      stdout: "这个项目用产品循环，后端没有在运行。运行 ploop status 拉起它。\n",
      stderr: "",
    });
    // 没有拉起后端：集中存储里没有 run/backend.json。
    expect(existsSync(join(store, "run"))).toBe(false);
  });

  it("--json 在项目里后端没开：kind 是 prime.unavailable，data 写明原因", async () => {
    const home = tempRoot();
    const root = join(home, "proj", "app");
    makeTree(root, [[".product-loop/project.json", JSON.stringify(identity)]]);
    const result = await ploop(["prime", "--json"], {
      cwd: root,
      userHome: home,
      env: { PLOOP_HOME: join(home, "store") },
    });
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: true,
      kind: "prime.unavailable",
      data: { reason: "notRunning" },
    });
    expect(result.code).toBe(0);
  });

  it("--json：照常给一个 JSON 对象，说明没有内容", async () => {
    const home = tempRoot();
    const result = await ploop(["prime", "--json"], { cwd: home, userHome: home });
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: true, kind: "prime.none" });
    expect(result.code).toBe(0);
  });
});
