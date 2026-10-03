import type { Page } from "playwright-core";
import { openPage } from "../browser.ts";
import { check, expectRun, type Scene, started } from "../lib.ts";
import { solidPng } from "../pages.ts";

// S6 看使用阶段的结果。用户，使用阶段跑完时。要知道产品有没有走通，哪一步断了。
// 被跑的使用代码是一个小脚本：S1 走通，S2 断在第 2 步并带 1440 宽的截图，S3 没有走。

const shot = solidPng(64, 40, [200, 40, 40]).toString("base64");

const script = `
import { writeFileSync } from "node:fs";
import { join } from "node:path";
const out = process.env.PLOOP_USE_OUT;
writeFileSync(join(out, "s2-2.png"), Buffer.from("${shot}", "base64"));
const run = {
  schemaVersion: 1,
  scenes: [
    { scene: "S1", steps: [{ step: 1, do: "打开项目列表", expect: "每个项目一行", result: "通过" }] },
    { scene: "S2", steps: [
      { step: 1, do: "点一个项目", expect: "看到版本的进度", result: "通过" },
      { step: 2, do: "点导出", expect: "下载一份队列", result: "断了", error: "导出按钮点了没有反应", width: 1440, screenshot: "s2-2.png" },
    ] },
    { scene: "S3", steps: [{ step: 1, do: "打开等我的那一页", expect: "页头写第几次", result: "没走", error: "S2 断了，没有接着走" }] },
  ],
};
writeFileSync(join(out, "use-run.json"), JSON.stringify(run));
`;

const table = [
  "| 东西 | 场景 |",
  "| --- | --- |",
  "| 项目列表 | S1 |",
  "| 导出按钮 | |",
  "| 设置页 | |",
].join("\n");

export const scene: Scene = {
  scene: "S6",
  setup: (w) => {
    started(w);
    w.write("scripts/use/run.mjs", script);
    w.write("scripts/use/覆盖表.md", table);
    expectRun(w.ploop(["queue", "add", "走一遍导出", "--stage", "使用"]), 0);
    expectRun(w.ploop(["round", "start", "使用"]), 0);
    // 运行里有断了的步，结果照常收下，退出码是 1。
    expectRun(w.ploop(["use", "run", "--", "node", "scripts/use/run.mjs"]), 1, "断了 1 步");
    w.write(
      ".product-loop/rounds/v1-使用-1/page.json",
      JSON.stringify({
        asks: [
          {
            queue: ["Q1"],
            title: "导出断了要不要先修",
            why: "S2 断在导出这一步。",
            sources: [{ name: "使用代码", saw: "「导出按钮点了没有反应」", quote: true }],
          },
        ],
      }),
    );
    expectRun(w.ploop(["page", "present"]), 0);
    const status = JSON.parse(w.ploop(["status", "--json"]).stdout) as {
      data: { project: { id: string } };
    };
    w.memo.set("path", `/p/${status.data.project.id}/r/v1-使用-1`);
  },
  steps: [
    {
      do: "打开使用阶段的那一页",
      expect: "每个场景一行，写走通、断在第几步或没有走。走通的折叠，断了和没有走的展开步骤。",
      run: async (w) => {
        const page = await openPage(w, w.memo.get("path") as string);
        w.memo.set("page", page);
        await page
          .getByRole("navigation", { name: "这一页的每一条" })
          .getByRole("button", { name: "使用" })
          .click();
        const heading = (id: string) =>
          page.getByRole("heading", { level: 3 }).filter({ hasText: id });
        await heading("S1").getByText("走通", { exact: true }).waitFor();
        await heading("S2").getByText("断在第 2 步", { exact: true }).waitFor();
        await heading("S3").getByText("没有走", { exact: true }).waitFor();
        check((await page.getByRole("heading", { level: 3 }).count()) === 3, "不是每个场景一行");
        // 走通的折叠：S1 的步骤不显示；断了和没有走的展开：S2、S3 的步骤显示。
        check(
          !(await page.getByText("打开项目列表", { exact: true }).isVisible()),
          "S1 走通了，它的步骤却没有折叠",
        );
        await page.getByText("点导出", { exact: true }).waitFor();
        await page.getByText("打开等我的那一页", { exact: true }).waitFor();
        // 走通的折叠着，点「展开」才看到步骤，再点「收起」又折上；断了和没有走的没有这个按钮。
        const s1 = page.locator("section", { has: heading("S1") });
        check(
          (await s1.getByRole("button", { name: "收起" }).count()) === 0,
          "折叠着却写了「收起」",
        );
        await s1.getByRole("button", { name: "展开 1 步", exact: true }).click();
        await page.getByText("打开项目列表", { exact: true }).waitFor();
        await s1.getByRole("button", { name: "收起", exact: true }).click();
        await page.getByText("打开项目列表", { exact: true }).waitFor({ state: "hidden" });
        check(
          (await page.getByRole("button", { name: /^展开/u }).count()) === 1,
          "只有走通的场景该有「展开」，断了和没有走的已经展开",
        );
      },
    },
    {
      do: "看页的底部",
      expect: "没有想法框和提交，这一页不算在等的页。",
      run: async (w) => {
        const page = w.memo.get("page") as Page;
        await page.evaluate("window.scrollTo(0, document.body.scrollHeight)");
        check((await page.getByRole("textbox").count()) === 0, "使用阶段的页有想法框");
        check(
          (await page.getByRole("button", { name: "提交", exact: true }).count()) === 0,
          "使用阶段的页有提交",
        );
        // 这一页不算在等的页：项目状态里在等的页写没有，这一页只是只看的页。
        const status = JSON.parse(w.ploop(["status", "--json"]).stdout) as {
          data: { waitingPages: { purpose: string }[] };
        };
        const asks = status.data.waitingPages.filter((page) => page.purpose !== "只看");
        check(asks.length === 0, `使用阶段的页算成了在等的页：${JSON.stringify(asks)}`);
        expectRun(w.ploop(["status"]), 0, "在等的页：没有");
      },
    },
    {
      do: "看断了的那一行",
      expect: "断处配一张截图，写着窗口宽度。",
      run: async (w) => {
        const page = w.memo.get("page") as Page;
        const scene = page.locator("section", { has: page.getByRole("heading", { name: /S2/u }) });
        await scene.getByText("导出按钮点了没有反应").waitFor();
        await scene.getByText("1440 宽", { exact: true }).waitFor();
        const img = scene.getByRole("img", { name: "S2 第 2 步" });
        await img.waitFor();
        const box = await img.boundingBox();
        check(box !== null && box.width > 0, "截图没有显示");
      },
    },
    {
      do: "往下看",
      expect: "覆盖表的缺口列在下面，每个缺口写页面、入口、操作或状态的名字。",
      run: async (w) => {
        const page = w.memo.get("page") as Page;
        // 外面的屏也是 section，取最里面的一层。
        const gaps = page.locator("section", { hasText: "覆盖表的缺口" }).last();
        await gaps.getByRole("listitem").first().waitFor();
        const rows = await gaps.getByRole("listitem").allInnerTexts();
        check(rows.join("，") === "导出按钮，设置页", `缺口列的是 ${rows.join("，")}`);
        // 缺口在场景的下面。
        const gapTop = (await gaps.boundingBox())?.y ?? 0;
        const sceneTop = (await page.getByRole("heading", { name: /S3/u }).boundingBox())?.y ?? 0;
        check(gapTop > sceneTop, "覆盖表的缺口不在场景的下面");
      },
    },
  ],
};
