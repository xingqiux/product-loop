import { cpSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "playwright-core";
import { openPage, pasteImage, pick, show } from "../browser.ts";
import { check, expectRun, type Scene } from "../lib.ts";
import { presentThink, projectId } from "../pages.ts";

// S3 逐条点选项并提交。用户，AI 给出一页等自己回复时。每一条定下来，AI 才能往下做。
// 选项丢了或提交没送到，AI 会做错方向，用户得重点一遍。
// 摆好的状态：构思阶段做到第 2 次，给出一页：先对齐、场景清单、设计规范、三张疑问卡（其中一张是设计类的，
// 每个选项有一张线稿）、参考、队列。

/** 设计类的疑问卡：来源里有外面的截图，每个选项有一张线稿。放在疑问的最前面。 */
const design = {
  id: "board-columns",
  title: "看板的列头样式",
  design: true,
  why: "列头现在太挤，要定列头写什么。",
  research: { tier: "不查", reason: "外面的做法一眼能看懂" },
  sources: [
    {
      name: "别家的看板",
      saw: "列头只写名字和件数。",
      img: "img/report-now.png",
      outside: true,
    },
    { name: "现在的看板", saw: "列头带着说明。", img: "img/s9-1.png" },
  ],
  shared: { text: "两种写法都保留五列。" },
  rows: ["列头写什么"],
  options: [
    {
      key: "a",
      title: "名字加件数",
      diffs: ["只写阶段名和件数。"],
      why: "一眼看出哪一列事多。",
      cost: "看不到这一列是做什么的。",
      when: "用户已经熟悉五个阶段。",
      sketch: '<div class="wf"><div class="wf-bar"></div></div>',
    },
    {
      key: "b",
      title: "名字加说明",
      diffs: ["阶段名下面写一句说明。"],
      why: "第一次用的人看得懂。",
      cost: "列头变高。",
      when: "用户第一次用。",
      sketch: '<div class="wf"><div class="wf-bar"></div><div class="wf-bar"></div></div>',
    },
  ],
  stance: { pick: "a", because: "用户每天都看，熟悉以后不需要说明。" },
};

const at = (page: Page) => new URL(page.url()).searchParams.get("item");

/** 左边一栏。 */
const sidebar = (page: Page) => page.getByRole("navigation", { name: "这一页的每一条" });

/** 「看未点的 N 条」里的 N。 */
async function unpicked(page: Page): Promise<number> {
  const label = await page.getByRole("button", { name: /看未点的 \d+ 条/u }).innerText();
  return Number(/\d+/u.exec(label)?.[0]);
}

export const scene: Scene = {
  scene: "S3",
  setup: (w) => {
    presentThink(w, (think) => ({ ...think, asks: [design, ...think.asks] }));
    // 第 1 次撤回、放弃，构思阶段开第 2 次，再给出同一页：页头要写第几次。
    expectRun(w.ploop(["page", "withdraw", "--reason", "重排一次"]), 0);
    expectRun(w.ploop(["round", "close", "--abort", "重开一次"]), 0);
    expectRun(w.ploop(["round", "start", "构思"]), 0);
    const from = join(w.root, ".product-loop", "rounds", "v1-构思-1");
    const to = join(w.root, ".product-loop", "rounds", "v1-构思-2");
    cpSync(join(from, "page.json"), join(to, "page.json"));
    cpSync(join(from, "img"), join(to, "img"), { recursive: true });
    expectRun(w.ploop(["page", "present"]), 0, "第 1 版的构思阶段（第 2 次）的第 1 页");
    w.memo.set("path", `/p/${projectId(w)}/r/${encodeURIComponent("v1-构思-2")}`);
  },
  steps: [
    {
      do: "打开等我的那一页",
      expect: "页头写第几版、阶段、第几次。左边列出每一条，下面有「看未点的几条」。",
      run: async (w) => {
        const page = await openPage(w, w.memo.get("path") as string);
        w.memo.set("page", page);
        await page.getByRole("heading", { name: "第 1 版的构思阶段（第 2 次）" }).waitFor();
        // 页头写第几版、阶段、第几次，状态写等用户回复。
        await page.getByText("等用户回复").first().waitFor();
        // 左边列出每一条：先对齐、场景清单、设计规范、疑问、参考、队列。
        const nav = sidebar(page);
        for (const name of [
          "信息结构",
          "看队列",
          "配色",
          "看板的列头样式",
          "队列看板放在哪里",
          "上次你自己排当天的事是什么时候",
        ]) {
          await nav.getByRole("button", { name, exact: true }).waitFor();
        }
        const left = await unpicked(page);
        check(left > 0, "什么都没点，「看未点的几条」写的是 0");
        w.memo.set("unpicked", left);
      },
    },
    {
      do: "读一条",
      expect: "来源一条一条配图，选项按行对照。设计类的选项各有一张线稿。最后是我的看法和理由。",
      run: async (w) => {
        const page = w.memo.get("page") as Page;
        // 别的疑问：来源配图，选项按行对照，最后是我的看法和理由。
        await sidebar(page).getByRole("button", { name: "队列看板放在哪里" }).click();
        await page.getByText("报告网页现在的样子").waitFor();
        check((await page.locator("main img").count()) > 0, "来源没有配图");
        for (const row of ["放在哪里", "理由", "代价", "适用场景"]) {
          check(
            (await page.getByText(row, { exact: true }).count()) > 0,
            `选项没有「${row}」这一行`,
          );
        }
        await page.getByText("选「每一页的最后」", { exact: true }).waitFor();
        await page.getByText("理由", { exact: true }).last().waitFor();
        await page.getByText("用户每一页都要看到队列。").waitFor();
        // 设计类的疑问，最后读它，这一步的截图停在线稿上：外面的截图和现在的截图各一张，每个选项有一张线稿。
        await sidebar(page).getByRole("button", { name: "看板的列头样式", exact: true }).click();
        await page.getByText("别家的看板").waitFor();
        await page.getByText("现在的看板").waitFor();
        check((await page.locator("main img").count()) >= 2, "两条来源没有各配一张图");
        const sketches = await page.locator("main .wf").count();
        check(sketches === 2, `两个选项应当各有一张线稿，页面上有 ${sketches} 张`);
        await page.getByText("我的看法", { exact: true }).first().waitFor();
        // 选项屏里内容比窗口高时，只有右边这一块自己滚，整个网页不再多一条滚动条。
        check(
          await page.evaluate("document.documentElement.scrollHeight <= innerHeight + 1"),
          "选项屏里整个网页多出一条滚动条",
        );
      },
    },
    {
      do: "点 a",
      expect: "这个选项选中，左边这一条打勾，页面不自己走。「下一屏」只有页面底下这一个。",
      run: async (w) => {
        const page = w.memo.get("page") as Page;
        await sidebar(page).getByRole("button", { name: "队列看板放在哪里" }).click();
        await pick(page, /每一页的最后/u);
        check(await page.getByRole("radio", { name: /每一页的最后/u }).isChecked(), "选项没有选中");
        const entry = sidebar(page).getByRole("button", { name: "队列看板放在哪里" });
        await entry.getByLabel("已点").waitFor();
        await entry.getByText("选了「每一页的最后」").waitFor();
        check(at(page) === "queue-board", `点了选项，页面自己走到了 ${at(page)}`);
        check(
          (await page.getByRole("button", { name: "下一屏" }).count()) === 1,
          "同一屏上的「下一屏」不是只有一个",
        );
        const before = w.memo.get("unpicked") as number;
        check((await unpicked(page)) === before - 1, "点了一条，「看未点的几条」没有少一条");
      },
    },
    {
      do: "按键盘右键",
      expect:
        "换到下一屏。光标在备注框里时，右键只移动光标。光标在选项上时，上下键换选项，左右键换屏。",
      run: async (w) => {
        const page = w.memo.get("page") as Page;
        // 光标在备注框里：右键只移动光标，不换屏。
        const note = page.getByPlaceholder("备注", { exact: true });
        await note.fill("看板放最后");
        await note.press("ArrowLeft");
        await note.press("ArrowRight");
        check(at(page) === "queue-board", `光标在备注框里时换了屏：${at(page)}`);
        // 光标在选项上：下键换到下一个选项，上键换回来，页面不动。
        const optionA = page.getByRole("radio", { name: /每一页的最后/u });
        const optionB = page.getByRole("radio", { name: /单独一页/u });
        await optionA.focus();
        await page.keyboard.press("ArrowDown");
        check(await optionB.isChecked(), "光标在选项上，下键没有换到下一个选项");
        check(at(page) === "queue-board", `上下键换选项时页面走了：${at(page)}`);
        await page.keyboard.press("ArrowUp");
        check(await optionA.isChecked(), "光标在选项上，上键没有换回上一个选项");
        // 光标在选项上：右键换到下一屏，左键换回来。
        await page.keyboard.press("ArrowRight");
        await page.getByPlaceholder("回答", { exact: true }).waitFor();
        check(at(page) === "last-time", `右键换到了 ${at(page)}`);
        await page.keyboard.press("Escape");
        await page.getByPlaceholder("回答", { exact: true }).blur();
        await page.locator("main").click({ position: { x: 5, y: 5 } });
        await page.keyboard.press("ArrowLeft");
        await page.getByPlaceholder("备注", { exact: true }).waitFor();
        check(at(page) === "queue-board", `左键换到了 ${at(page)}`);
        await page.keyboard.press("ArrowRight");
        await page.getByPlaceholder("回答", { exact: true }).waitFor();
      },
    },
    {
      do: "写备注，贴一张截图",
      expect: "截图立刻出现缩略图，文字里留下「〔图 1〕」。",
      run: async (w) => {
        const page = w.memo.get("page") as Page;
        const answer = page.getByPlaceholder("回答", { exact: true });
        await answer.fill("上周排过一次");
        await pasteImage(answer);
        await page.getByAltText("图 1").waitFor();
        check(
          (await answer.inputValue()) === "上周排过一次〔图 1〕",
          `文字是「${await answer.inputValue()}」`,
        );
        // 缩略图点开放大，再点关掉。
        await page.getByRole("button", { name: "图 1", exact: true }).click();
        const dialog = page.getByRole("dialog", { name: "图 1" });
        await dialog.getByRole("button").click();
        await dialog.waitFor({ state: "detached" });
      },
    },
    {
      do: "刷新页面，或者换一个浏览器打开",
      expect: "点过的选项、备注和截图都还在。",
      run: async (w) => {
        const page = w.memo.get("page") as Page;
        await page.getByText("点过的都已存下").waitFor();
        // 刷新页面：点过的选项、备注和截图都还在。
        await page.reload();
        await page.getByPlaceholder("回答", { exact: true }).waitFor();
        check(
          (await page.getByPlaceholder("回答", { exact: true }).inputValue()).includes("〔图 1〕"),
          "刷新以后截图的记号没有了",
        );
        await page.getByAltText("图 1").waitFor();
        await sidebar(page).getByRole("button", { name: "队列看板放在哪里" }).click();
        check(
          await page.getByRole("radio", { name: /每一页的最后/u }).isChecked(),
          "刷新以后选过的选项没有了",
        );
        check(
          (await page.getByPlaceholder("备注", { exact: true }).inputValue()) === "看板放最后",
          "刷新以后备注没有了",
        );
        // 换一个浏览器打开：新开的浏览器上下文，没有这一台浏览器里存的任何东西。
        const again = await openPage(w, `${w.memo.get("path")}?item=queue-board`);
        check(
          await again.getByRole("radio", { name: /每一页的最后/u }).isChecked(),
          "换浏览器以后选过的选项没有了",
        );
        check(
          (await again.getByPlaceholder("备注", { exact: true }).inputValue()) === "看板放最后",
          "换浏览器以后备注没有了",
        );
        await again.goto(w.url(`${w.memo.get("path")}?item=last-time`));
        await again.getByAltText("图 1").waitFor();
        check(
          (await again.getByPlaceholder("回答", { exact: true }).inputValue()).includes("〔图 1〕"),
          "换浏览器以后截图的记号没有了",
        );
      },
    },
    {
      do: "收起左边一栏",
      expect: "提交、看未点的几条、想法框都还在。展开以后左边一栏回来，刷新后仍是收起的。",
      run: async (w) => {
        const page = w.memo.get("page") as Page;
        show(w, page);
        await page.getByRole("button", { name: "折叠左边一栏" }).click();
        await page.getByRole("button", { name: "展开左边一栏" }).waitFor();
        check((await sidebar(page).count()) === 0, "左边一栏没有收起");
        const submit = page.getByRole("button", { name: "提交", exact: true });
        await submit.waitFor();
        const box = await submit.boundingBox();
        check(
          box !== null && box.y >= 0 && box.y + box.height <= 1000,
          `收起以后提交按钮不在窗口里：${JSON.stringify(box)}`,
        );
        await page.getByRole("button", { name: /看未点的 \d+ 条/u }).waitFor();
        await page.getByPlaceholder("想法", { exact: true }).waitFor();
        // 刷新后仍是收起的。
        await page.reload();
        await page.getByRole("button", { name: "展开左边一栏" }).waitFor();
        check((await sidebar(page).count()) === 0, "刷新以后左边一栏又出现了");
        // 展开以后左边一栏回来。
        await page.getByRole("button", { name: "展开左边一栏" }).click();
        await sidebar(page).waitFor();
        await page.getByRole("button", { name: "折叠左边一栏" }).waitFor();
      },
    },
    {
      do: "点了要回复的几条，点提交",
      expect:
        "确认框写有几条回复、几条没点，和「提交后不能改」。确认后页面变成只读，提交区写「等 AI 取走」。",
      run: async (w) => {
        const page = w.memo.get("page") as Page;
        // 只点了要回复的几条：选项一条，备注一条，没点的还有好几条。
        await page.getByText("点过的都已存下").waitFor();
        const left = await unpicked(page);
        check(left > 0, "还有没点的，「看未点的几条」写的是 0");
        const submit = page.getByRole("button", { name: "提交", exact: true });
        check(await submit.isEnabled(), "点了要回复的几条，提交还是灰的");
        await submit.click();
        const dialog = page.getByRole("dialog");
        const text = await dialog.innerText();
        const counts = /(\d+) 条回复，(\d+) 条没点/u.exec(text);
        check(counts !== null, `确认框没有写几条回复、几条没点：${text}`);
        check(Number(counts?.[1]) >= 2, `确认框写了 ${counts?.[1]} 条回复，点过的有两条`);
        check(
          Number(counts?.[2]) === left,
          `确认框写 ${counts?.[2]} 条没点，「看未点的几条」写 ${left}`,
        );
        check(text.includes("提交后不能改"), `确认框没有写「提交后不能改」：${text}`);
        await dialog.getByRole("button", { name: "提交" }).click();
        await page.getByText("等 AI 取走").waitFor();
        // 确认后页面变成只读：选项点不动，备注和想法框不能改。
        await sidebar(page).getByRole("button", { name: "队列看板放在哪里" }).click();
        const group = page.locator("main [role=radiogroup]").first();
        await group.locator("label").nth(1).click();
        check(await group.getByRole("radio").first().isChecked(), "提交以后还能改选项");
        check(
          !(await page.getByPlaceholder("备注", { exact: true }).isEditable()),
          "提交以后备注还能改",
        );
        check(
          (await page.getByRole("button", { name: "提交", exact: true }).count()) === 0,
          "提交以后还有提交按钮",
        );
      },
    },
  ],
};
