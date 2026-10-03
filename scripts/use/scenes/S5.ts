import type { Page } from "playwright-core";
import { openPage, pick, show } from "../browser.ts";
import { check, expectRun, pause, type Scene } from "../lib.ts";
import { solidPng } from "../pages.ts";

// S5 验收更改。用户，落地做完一批时。要确认改的东西真的改对了，这件事才算做完。
// 落地一批照 S18 走到评审，再给出验收页：一条界面的更改带改前改后的图，两条文字的更改。
// 截图按真实窗口的宽度画，放大时才比页面里的大。

const plan = [
  "## 要做的事",
  "看板放到首页。",
  "## 现状",
  "看板在第二屏。",
  "## 要不要先重构",
  "不要。改动都很小，不碰结构。",
  "## 功能改动",
  "1. 看板放到首页",
  "   对应 Q1。检查 `node check.mjs`，查看板在第一屏。",
  "## 用什么锁住现有的行为",
  "`node check.mjs`",
  "## 对应哪个场景",
  "S1 看队列。",
  "## 裁决",
  "| 裁决 | 理由 | 错了的代价 |",
  "| --- | --- | --- |",
  "| 不重构 | 改动小 | 小 |",
].join("\n");

const checkScript = [
  'import { readFileSync } from "node:fs";',
  'process.exit(readFileSync("board.txt", "utf8").includes("第一屏") ? 0 : 1);',
  "",
].join("\n");

const page = {
  changes: [
    {
      id: "board-first",
      queue: ["Q1"],
      title: "看板放到首页",
      problem: "看板在第二屏，要往下滚才看到。",
      fix: "看板放到第一屏。",
      before: { img: "img/before.png", caption: "改前的首页" },
      after: { img: "img/after.png", caption: "改后的首页" },
    },
    {
      id: "board-copy",
      title: "看板的说明改成一句",
      problem: "说明写了两句。",
      fix: "说明写成一句。",
      textName: "看板的说明",
      textBefore: "看板列出每一件事。\n每一列是一种状态。",
      textAfter: "看板按状态分列，列出每一件事。",
    },
    {
      id: "board-title",
      title: "看板的标题改短",
      problem: "标题有九个字。",
      fix: "标题写成四个字。",
      textName: "看板的标题",
      textBefore: "队列看板：每个阶段的事",
      textAfter: "队列看板",
    },
  ],
};

export const scene: Scene = {
  scene: "S5",
  setup: (w) => {
    w.git("init", "-q");
    w.write("check.mjs", checkScript);
    w.write("board.txt", "看板在第二屏\n");
    w.git("add", "-A");
    w.git("commit", "-q", "-m", "起点");
    expectRun(w.ploop(["init", "--repo", "自己的"]), 0);
    w.git("add", "-A");
    w.git("commit", "-q", "-m", "忽略项目缓存");
    expectRun(w.ploop(["queue", "add", "看板放到首页", "--stage", "落地"]), 0);
    expectRun(w.ploop(["round", "start", "落地"]), 0);
    w.write(".product-loop/rounds/v1-落地-1/计划.md", plan);
    expectRun(w.ploop(["land", "plan"]), 0);
    expectRun(w.ploop(["land", "tidy", "--skip"]), 0);
    expectRun(w.ploop(["land", "red", "看板放到首页", "--", "node", "check.mjs"]), 0);
    w.write("board.txt", "看板在第一屏\n");
    w.git("add", "-A");
    w.git("commit", "-q", "-m", "看板放到首页\n\n阶段: 第 1 版的落地阶段\n队列: Q1");
    expectRun(w.ploop(["land", "green", "看板放到首页", "--", "node", "check.mjs"]), 0);
    expectRun(w.ploop(["land", "review", "--skip", "只改了一行"]), 0);
    const dir = ".product-loop/rounds/v1-落地-1";
    w.write(`${dir}/img/before.png`, solidPng(1400, 875, [220, 220, 220]));
    w.write(`${dir}/img/after.png`, solidPng(1400, 875, [0, 102, 219]));
    w.write(`${dir}/page.json`, JSON.stringify(page));
    expectRun(w.ploop(["page", "present"]), 0);
    const status = JSON.parse(w.ploop(["status", "--json"]).stdout) as {
      data: { project: { id: string } };
    };
    w.memo.set("path", `/p/${status.data.project.id}/r/v1-落地-1`);
  },
  steps: [
    {
      do: "打开落地的验收页",
      expect: "左边有「更改」一组。界面的更改是一对改前改后的图，文字的更改逐行对比。",
      run: async (w) => {
        const p = await openPage(w, w.memo.get("path") as string);
        w.memo.set("page", p);
        const nav = p.getByRole("navigation", { name: "这一页的每一条" });
        await nav.getByText("更改", { exact: true }).waitFor();
        await nav.getByRole("button", { name: "看板放到首页" }).click();
        await p.getByRole("img", { name: "改前的首页" }).waitFor();
        await p.getByRole("img", { name: "改后的首页" }).waitFor();
        await nav.getByRole("button", { name: "看板的说明改成一句" }).click();
        // 文字的更改逐行对比：改前两行、改后一行，改了的行里删的和加的各是一小段。
        await p.locator("del", { hasText: "每一列是一种状态" }).waitFor();
        await p.locator("ins", { hasText: "按状态分列" }).first().waitFor();
        // 半屏高的窗口：认可、不认可和下一屏都在窗口里，整个网页没有自己的滚动条。
        await p.setViewportSize({ width: 1440, height: 720 });
        for (const name of ["看板放到首页", "看板的说明改成一句"]) {
          await nav.getByRole("button", { name }).click();
          for (const target of [
            p.locator("label", { has: p.getByRole("radio", { name: /^认可$/u }) }),
            p.locator("label", { has: p.getByRole("radio", { name: /^不认可$/u }) }),
            p.getByRole("button", { name: "下一屏" }),
          ]) {
            const box = await target.boundingBox();
            check(
              box !== null && box.y >= 0 && box.y + box.height <= 720,
              `「${name}」这一屏里有按钮在窗口外，y ${box?.y}，高 ${box?.height}`,
            );
          }
          check(
            await p.evaluate("document.documentElement.scrollHeight <= innerHeight + 1"),
            "整个网页多出一条滚动条",
          );
        }
        await p.setViewportSize({ width: 1440, height: 1000 });
        await p.waitForTimeout(300);
      },
    },
    {
      do: "点图",
      expect: "放大，再点一下关掉。",
      run: async (w) => {
        const p = w.memo.get("page") as Page;
        await p
          .getByRole("navigation", { name: "这一页的每一条" })
          .getByRole("button", { name: "看板放到首页" })
          .click();
        await p.getByRole("button", { name: "改后的首页" }).click();
        const dialog = p.getByRole("dialog", { name: "改后的首页" });
        await dialog.waitFor();
        const big = await dialog.getByRole("img").boundingBox();
        const small = await p
          .locator("main")
          .getByRole("img", { name: "改后的首页" })
          .first()
          .boundingBox();
        check(big !== null && small !== null && big.width >= small.width, "放大的图没有更大");
        // 再点一下关掉：点放大的图本身。
        await dialog.getByRole("img").click();
        await dialog.waitFor({ state: "detached" });
        await p.waitForTimeout(300);
      },
    },
    {
      do: "只看不点",
      expect: "看过的更改不会被记成认可，提交不能点。",
      run: async (w) => {
        const p = w.memo.get("page") as Page;
        // 草稿隔半秒交给后端，多等一会儿再看。
        await pause(1500);
        const [, , pid, , round] = (w.memo.get("path") as string).split("/");
        const detail = (await w.api("GET", `/projects/${pid}/rounds/${round}`)) as {
          data: { pages: { id: number }[] };
        };
        const id = detail.data.pages[0]?.id;
        const draft = (await w.api("GET", `/projects/${pid}/pages/${id}/draft`)) as {
          data: { entries: Record<string, unknown> };
        };
        const names = Object.keys(draft.data.entries);
        check(names.length === 0, `没有动手，草稿里却有 ${names.join("、")}`);
        const nav = p.getByRole("navigation", { name: "这一页的每一条" });
        check((await nav.getByLabel("已点").count()) === 0, "只看不点，左边却有打勾的条");
        check(
          (await p.getByRole("button", { name: /看未点的 \d+ 条/u }).count()) > 0,
          "什么都没点，却没有「看未点的几条」",
        );
        check(
          await p.getByRole("button", { name: "提交", exact: true }).isDisabled(),
          "只看不点就能提交",
        );
      },
    },
    {
      do: "点了几条「认可」",
      expect: "左边这几条打勾，提交能点。没点的在确认框里写明还有几条。",
      run: async (w) => {
        const p = w.memo.get("page") as Page;
        const nav = p.getByRole("navigation", { name: "这一页的每一条" });
        for (const name of ["看板放到首页", "看板的说明改成一句"]) {
          await nav.getByRole("button", { name }).click();
          await pick(p, /^认可$/u);
        }
        await p.getByText("点过的都已存下").waitFor();
        for (const name of ["看板放到首页", "看板的说明改成一句"]) {
          await nav.getByRole("button", { name }).getByLabel("已点").waitFor();
        }
        check(
          (await nav.getByRole("button", { name: "看板的标题改短" }).getByLabel("已点").count()) ===
            0,
          "没点的那一条也打了勾",
        );
        check(
          await p.getByRole("button", { name: "提交", exact: true }).isEnabled(),
          "点了认可，提交还是灰的",
        );
        // 换一个窗口打开同一页，点过的认可还在。
        const again = await openPage(w, `${w.memo.get("path")}?item=board-first`);
        const radio = again.getByRole("radio", { name: /^认可$/u });
        await radio.waitFor();
        check(await radio.isChecked(), "刚才点的认可没有存下");
        show(w, p);
        // 点提交，确认框写明没点的还有几条。
        await p.getByRole("button", { name: "提交", exact: true }).click();
        const dialog = p.getByRole("dialog");
        await dialog.getByText("2 条回复，1 条没点").waitFor();
        await dialog.getByText("提交后不能改").waitFor();
        await dialog.getByRole("button", { name: "返回" }).click();
        await dialog.waitFor({ state: "detached" });
        await p.waitForTimeout(300);
      },
    },
    {
      do: "对一条改成「不认可」",
      expect: "要写一句为什么，没写时提交不能点，提示写原因。这一句进提交的内容。",
      run: async (w) => {
        const p = w.memo.get("page") as Page;
        await p
          .getByRole("navigation", { name: "这一页的每一条" })
          .getByRole("button", { name: "看板放到首页" })
          .click();
        await pick(p, /^不认可$/u);
        await p.getByText("不认可「看板放到首页」要写原因").waitFor();
        check(
          await p.getByRole("button", { name: "提交", exact: true }).isDisabled(),
          "没写为什么也能提交",
        );
        await p.getByPlaceholder("不认可的原因", { exact: true }).fill("首页太挤了");
        await p.getByText("点过的都已存下").waitFor();
        check(
          await p.getByRole("button", { name: "提交", exact: true }).isEnabled(),
          "写了为什么还是不能提交",
        );
        // 这一句进提交的内容：草稿里存着它。
        const [, , pid, , round] = (w.memo.get("path") as string).split("/");
        const detail = (await w.api("GET", `/projects/${pid}/rounds/${round}`)) as {
          data: { pages: { id: number }[] };
        };
        const id = detail.data.pages[0]?.id;
        const draft = (await w.api("GET", `/projects/${pid}/pages/${id}/draft`)) as {
          data: { entries: Record<string, unknown> };
        };
        check(
          JSON.stringify(draft.data.entries).includes("首页太挤了"),
          `草稿里没有写下的原因：${JSON.stringify(draft.data.entries)}`,
        );
        await p.waitForTimeout(300);
      },
    },
    {
      do: "点提交",
      expect: "提交区写「AI 已收到」。认可的每一条在回复里是一行，不认可的一行带原因。",
      run: async (w) => {
        const p = w.memo.get("page") as Page;
        await p.getByRole("button", { name: "提交", exact: true }).click();
        await p.getByRole("dialog").getByRole("button", { name: "提交" }).click();
        await p.getByText("等 AI 取走").waitFor();
        const waiting = w.launch(["reply", "wait", "--timeout", "30"]);
        await p.getByText("AI 已收到").waitFor({ timeout: 10_000 });
        const reply = await waiting.done;
        expectRun(reply, 0, "不认可一条更改", "首页太挤了", "认可一条更改");
        // 认可的每一条在回复里是一行，不认可的一行带原因：两行，各一条更改。
        const lines = reply.stdout.split("\n");
        check(
          lines.filter((line) => line.includes("认可一条更改") && !line.includes("不认可"))
            .length === 1 && lines.filter((line) => line.includes("不认可一条更改")).length === 1,
          `回复里的行：${reply.stdout.trim()}`,
        );
        // 认可的那一行由后端处理掉，留给 AI 的只有不认可的那一行。
        expectRun(w.ploop(["reply", "show"]), 0, "还没处理 1 行", "用户认可了这一条更改");
      },
    },
    {
      do: "看验收页左边的「工程证据」",
      expect:
        "写重构做了没有，和每件事先失败后通过。再写评审的意见或跳过的理由，和 AI 自己裁决的事。只看，不用点。",
      run: async (w) => {
        const p = w.memo.get("page") as Page;
        show(w, p);
        const nav = p.getByRole("navigation", { name: "这一页的每一条" });
        await nav.getByRole("button", { name: "工程证据" }).click();
        const block = p.locator("main");
        await block.getByRole("heading", { name: "工程证据" }).waitFor();
        const text = await block.innerText();
        // 重构做了没有：计划里写不要，tidy 记的是跳过。
        check(text.includes("不需要重构"), `没有写重构做了没有：${text.slice(0, 300)}`);
        // 每件事先失败后通过：一行一件，写状态和运行的命令。
        const row = block.getByRole("row", { name: /看板放到首页/u });
        await row.waitFor();
        const changed = await row.innerText();
        check(changed.includes("先失败后通过"), `这件事没有写先失败后通过：${changed}`);
        check(changed.includes("node check.mjs"), `没有写运行的命令：${changed}`);
        // 评审跳过的理由。
        check(text.includes("评审的意见和处置"), "没有写评审这一块");
        check(text.includes("只改了一行"), `没有写评审跳过的理由：${text.slice(0, 500)}`);
        // AI 自己裁决的事：计划里裁决表的一行。
        check(text.includes("AI 自己裁决的"), "没有写 AI 自己裁决的事");
        const verdict = block.getByRole("row", { name: /不重构/u });
        await verdict.waitFor();
        const verdictText = await verdict.innerText();
        check(
          verdictText.includes("改动小") && verdictText.includes("小"),
          `裁决的一行是：${verdictText}`,
        );
        // 只看，不用点：这一屏没有选项，也没有认可、不认可。
        check((await block.getByRole("radio").count()) === 0, "工程证据里有要点的选项");
        check(
          (await nav.getByRole("button", { name: "工程证据" }).getByLabel("已点").count()) === 0,
          "工程证据被当成点过的一条",
        );
        await p.waitForTimeout(300);
      },
    },
  ],
};
