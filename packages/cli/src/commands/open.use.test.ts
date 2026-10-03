import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type Browser, chromium } from "playwright-core";
import { describe, expect, it, onTestFinished } from "vitest";
import { fullMainline, sandbox } from "./testing.ts";

// 工作台里每个阶段的页面和 ploop open，对着真的后端和真的浏览器跑，见第二期计划第 18 步。
// ploop open 打开这个阶段的页面，浏览器换成记下地址的脚本。
// 在浏览器里写一条想法、贴一张图、提交，后台运行的 ploop reply wait 随即退出。
// 浏览器用本机的 Chrome，没有就用 Playwright 下载过的 Chromium。

/** 一像素的 PNG。 */
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

const ask = {
  queue: ["Q1"],
  title: "保存按钮被挡住",
  why: "窄屏下保存按钮落到了屏幕外面，要横着滚才看得到。",
  sources: [{ name: "设置页", saw: "保存按钮只露出一半。", img: "img/settings.png" }],
};

const screens = [
  {
    name: "设置页",
    where: { scene: "S1", step: 1 },
    elements: [{ what: "保存按钮", answers: "改的东西存下来没有" }],
  },
];

async function browser(): Promise<Browser> {
  const launched = await chromium
    .launch({ channel: "chrome", headless: true })
    .catch(() => chromium.launch({ headless: true }));
  onTestFinished(() => launched.close());
  return launched;
}

describe("工作台里每个阶段的页面", { timeout: 90_000 }, () => {
  it("ploop open 打开这个阶段；写想法、贴图、提交，reply wait 随即退出并下载图", async () => {
    const s = sandbox();
    const run = (...argv: string[]) => s.ploop("proj/app", ...argv);
    expect(run("init", "--repo", "自己的").code).toBe(0);
    const cache = join(s.at("proj/app"), ".product-loop");
    writeFileSync(join(cache, "主线.md"), fullMainline);
    expect(run("queue", "add", "设置页的保存按钮在窄屏被挡住", "--stage", "检查").code).toBe(0);
    expect(run("round", "start", "检查").code).toBe(0);
    const workspace = join(cache, "rounds", "v1-检查-1");
    mkdirSync(join(workspace, "img"), { recursive: true });
    writeFileSync(join(workspace, "page.json"), JSON.stringify({ asks: [ask], screens }));
    writeFileSync(join(workspace, "img", "settings.png"), png);
    expect(run("page", "present").code).toBe(0);

    const opener = s.at("opener.sh");
    const record = s.at("opened.txt");
    writeFileSync(opener, `#!/bin/sh\nprintf '%s' "$1" > '${record}'\n`);
    chmodSync(opener, 0o755);
    s.env.PLOOP_BROWSER = opener;
    const opened = run("open");
    const url = opened.stdout.split("\n")[0]?.replace("打开了：", "") ?? "";
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/p\/app\/r\/v1-%E6%A3%80%E6%9F%A5-1$/u);
    expect(opened.code).toBe(0);
    for (let i = 0; i < 50 && readFileSync(record, { flag: "a+" }).length === 0; i++) {
      await new Promise((done) => setTimeout(done, 100));
    }
    expect(readFileSync(record, "utf8")).toBe(url);
    // 阶段的叫法和 --json 里 label 的写法，都能指到同一个阶段。
    const byName = run("open", "--round", "第 1 版的检查阶段");
    expect(byName.stdout.split("\n")[0]).toBe(`打开了：${url}`);
    expect(run("open", "--round", "v1-检查-1").stdout.split("\n")[0]).toBe(`打开了：${url}`);

    const waiting = s.launch("proj/app", "reply", "wait", "--timeout", "60");
    const page = await (await browser()).newPage();
    await page.goto(url);
    const ideas = page.getByPlaceholder("想法");
    await ideas.fill("看板可以按阶段分列");
    // 在想法框里贴一张图。浏览器里跑的代码写成字符串，命令行的包不带 DOM 的类型。
    await page.evaluate(`(() => {
      const area = document.querySelector('textarea[placeholder="想法"]');
      const bytes = Uint8Array.from(atob("${png.toString("base64")}"), (c) => c.charCodeAt(0));
      const data = new DataTransfer();
      data.items.add(new File([bytes], "shot.png", { type: "image/png" }));
      area.focus();
      area.setSelectionRange(area.value.length, area.value.length);
      area.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
    })()`);
    await page.getByAltText("图 1").waitFor();
    await page.getByRole("button", { name: "提交", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "提交" }).click();
    await page
      .getByText(/等 AI 取走|AI 已收到/u)
      .first()
      .waitFor();

    const done = await waiting.done;
    const lines = done.stdout.split("\n");
    expect(lines[0]).toMatch(/^收到了回复：第 1 版的检查阶段的第 1 页，1 行$/u);
    expect(lines[1]).toMatch(/^来源：工作台，/u);
    expect(lines).toContain("第 1 行  想法：看板可以按阶段分列〔图 1〕");
    expect(lines).toContain("  图：.product-loop/rounds/v1-检查-1/reply-img/1-1.png");
    expect(done.code).toBe(0);
    expect(readFileSync(join(workspace, "reply-img", "1-1.png"))).toEqual(png);
  });
});
