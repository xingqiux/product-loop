import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { sandbox } from "./testing.ts";

// ploop open 除了打开一轮的页面，还能打开队列、主线、决定和首页，一个阶段都没开始过时也有去处（P15）。
// 浏览器换成把地址写进文件的脚本，不起真的浏览器；地址再用 fetch 请求一次，确认后端认得。

function opened() {
  const s = sandbox();
  expect(s.ploop("proj/app", "init", "--repo", "自己的", "--hook", "否").code).toBe(0);
  const opener = s.at("opener.sh");
  const record = s.at("opened.txt");
  writeFileSync(opener, `#!/bin/sh\nprintf '%s' "$1" > '${record}'\n`);
  chmodSync(opener, 0o755);
  s.env.PLOOP_BROWSER = opener;
  /** 敲 ploop open，返回输出和浏览器收到的地址。 */
  const open = async (cwd: string, ...argv: string[]) => {
    writeFileSync(record, "");
    const result = s.ploop(cwd, "open", ...argv);
    for (let i = 0; i < 50 && readFileSync(record, "utf8") === "" && result.code === 0; i++) {
      await new Promise((done) => setTimeout(done, 100));
    }
    return { ...result, url: readFileSync(record, "utf8") };
  };
  return { s, open };
}

describe("ploop open 的去处", { timeout: 60_000 }, () => {
  it("一个阶段都没开始过：打开项目页，说明原因，下一步开始构思", async () => {
    const { s, open } = opened();
    const port = s.runInfo()?.port;
    const result = await open("proj/app");
    expect(result.url).toBe(`http://127.0.0.1:${port}/p/app`);
    expect(result.stdout).toBe(
      [
        `打开了：http://127.0.0.1:${port}/p/app`,
        "这个项目还没有开始过任何阶段，先打开的是项目页。",
        "",
        "下一步：",
        "  1. ploop round start 构思",
        "",
      ].join("\n"),
    );
    expect(result.code).toBe(0);
    expect((await fetch(result.url)).status).toBe(200);
  });

  it("--queue、--mainline、--decisions 打开这个项目的三个页面", async () => {
    const { s, open } = opened();
    const port = s.runInfo()?.port;
    for (const [option, path] of [
      ["--queue", "queue"],
      ["--mainline", "mainline"],
      ["--decisions", "decisions"],
    ] as const) {
      const result = await open("proj/app", option);
      expect(result.url).toBe(`http://127.0.0.1:${port}/p/app/${path}`);
      expect(result.stdout).toBe(`打开了：http://127.0.0.1:${port}/p/app/${path}\n`);
      expect(result.code).toBe(0);
      expect((await fetch(result.url)).status).toBe(200);
    }
  });

  it("--all 打开首页，不用在项目里；--json 写明去哪", async () => {
    const { s, open } = opened();
    const port = s.runInfo()?.port;
    const result = await open("proj/plain", "--all");
    expect(result.url).toBe(`http://127.0.0.1:${port}/`);
    expect(result.stdout).toBe(`打开了：http://127.0.0.1:${port}/\n`);
    expect(result.code).toBe(0);
    expect((await fetch(result.url)).status).toBe(200);
    const json = await open("proj/plain", "--all", "--json");
    expect(JSON.parse(json.stdout)).toMatchObject({
      kind: "page.opened",
      data: { url: `http://127.0.0.1:${port}/`, target: "all" },
    });
  });

  it("有阶段时不写选项还是打开最近的阶段；几个去处的选项不能一起写", async () => {
    const { s, open } = opened();
    expect(s.ploop("proj/app", "round", "start", "构思").code).toBe(0);
    const result = await open("proj/app");
    expect(result.url).toMatch(/\/p\/app\/r\/v1-%E6%9E%84%E6%80%9D-1$/u);
    const both = s.ploop("proj/app", "open", "--queue", "--all");
    expect(both.stderr).toContain("用法错误：");
    expect(both.stderr).toContain("--queue");
    expect(both.stderr).toContain("--all");
    expect(both.code).toBe(2);
  });
});
