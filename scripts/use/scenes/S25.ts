import type { Page } from "playwright-core";
import { openPage, pick } from "../browser.ts";
import { check, expectRun, type Scene, started } from "../lib.ts";
import { projectId } from "../pages.ts";

// S25 阶段开始时取消的事。
// 谁在什么时候用：用户，AI 开始一个阶段并取消了几件不成立的事以后。取消要能被看见、被推翻。
// 悄悄取消了要做的事，用户会漏掉它。
// 摆的状态：队列里三件检查的事，Q1 首页的列头太挤，Q2 退款页的按钮位置不对，
// Q3 是早就取消的想法（在阶段开始以前取消，不在「取消的事」里）。
// 第 1 步开始检查阶段，取消 Q2，给出第 1 页；第 3 步用户同意，交第 1 页；
// 第 4 步用户不同意，AI 处理完第 1 页的回复，给出第 2 页，用户在第 2 页上点名捞回 Q2。

const stage = "v1-检查-1";

const droppedContent = "退款页的按钮位置不对";
const droppedReason = "退款页已经整页删掉";
const oldContent = "旧的想法：首页加一个天气";

/** 检查阶段的一页：Q1 一张发现问题的卡，元素清单盖住 S1 的第 2 步。 */
const checkPage = {
  findings: [
    {
      queue: ["Q1"],
      title: "首页的列头太挤",
      why: "首页的列头在窄屏下挤在一起，看不清每一列是什么。",
      sources: [{ name: "用户昨天说的", saw: "「列头看不清」", quote: true }],
      where: { scene: "S1", step: 3 },
      rows: ["列头怎么排"],
      shared: { text: "五个阶段的列都保留。" },
      options: [
        {
          key: "a",
          title: "列头折成两行",
          diffs: ["名字一行，件数一行。"],
          why: "窄屏下也放得下。",
          cost: "行高多一倍。",
          when: "首页常在半屏窗口里看。",
        },
        {
          key: "b",
          title: "不改",
          diffs: ["名字和件数写在一行。"],
        },
      ],
    },
  ],
  screens: [
    {
      name: "首页：队列列头",
      where: { scene: "S1", step: 3 },
      elements: [{ what: "阶段名和件数", answers: "每个阶段各有几件" }],
    },
  ],
};

const nav = (page: Page) => page.getByRole("navigation", { name: "这一页的每一条" });

const pagePath = (w: { memo: Map<string, unknown> }) => w.memo.get("path") as string;

/** 「取消的事」这一屏的备注框：换屏时新旧两屏同时在页面上，圈出这一屏。 */
const droppedNote = (page: Page) =>
  page
    .locator("div", { has: page.getByRole("heading", { name: "取消的事" }) })
    .getByPlaceholder("备注", { exact: true })
    .last();

/** 找出回复里来自「取消的事」的一行，返回它的行号。没有时返回 undefined。 */
function droppedLine(output: string): string | undefined {
  return output
    .split("\n")
    .map((line) => /^第 (\d+) 行\s+取消的事/u.exec(line)?.[1])
    .find((n) => n !== undefined);
}

export const scene: Scene = {
  scene: "S25",
  setup: (w) => {
    started(w);
    expectRun(w.ploop(["queue", "add", "首页的列头太挤", "--stage", "检查"]), 0);
    expectRun(w.ploop(["queue", "add", droppedContent, "--stage", "检查"]), 0);
    expectRun(w.ploop(["queue", "add", oldContent, "--stage", "检查"]), 0);
    // Q3 在阶段开始以前就取消了：早就取消的事。
    expectRun(w.ploop(["queue", "drop", "Q3", "--reason", "用户说不要天气"]), 0);
    w.memo.set("path", `/p/${projectId(w)}/r/${encodeURIComponent(stage)}`);
  },
  steps: [
    {
      do: "AI 敲 ploop round start 检查，再敲 ploop queue drop Q2，写原因",
      expect: "这件事变成已取消，不再上这个阶段的页。",
      run: async (w) => {
        expectRun(w.ploop(["round", "start", "检查"]), 0, "开始了：第 1 版的检查阶段");
        expectRun(w.ploop(["queue", "drop", "Q2", "--reason", droppedReason]), 0);
        const shown = w.ploop(["queue", "show", "Q2"]);
        expectRun(shown, 0, "已取消", droppedReason);
        // 不再上这个阶段的页：这一页的卡只盖住 Q1，检查命令不要求盖住 Q2。
        w.write(`.product-loop/rounds/${stage}/page.json`, JSON.stringify(checkPage));
        expectRun(w.ploop(["page", "check"]), 0);
        expectRun(w.ploop(["page", "present"]), 0, "给出了：第 1 版的检查阶段的第 1 页");
        // 阶段里 Q2 已取消，这一页只盖 Q1。
        expectRun(w.ploop(["round", "show"]), 0, "Q1  进行中", "Q2  已取消");
      },
    },
    {
      do: "用户打开这个阶段的页",
      expect: "左边有「取消的事」一组。每件写内容和「取消的原因：…」。",
      run: async (w) => {
        const page = await openPage(w, pagePath(w));
        w.memo.set("page", page);
        await page.getByRole("heading", { name: "第 1 版的检查阶段" }).waitFor();
        // 左边一栏有「取消的事」一组，和发现问题的卡分开。
        await nav(page).getByRole("button", { name: "取消的事" }).waitFor();
        await nav(page).getByRole("button", { name: "首页的列头太挤" }).waitFor();
        await nav(page).getByRole("button", { name: "取消的事" }).click();
        // 这一屏每件写内容和取消的原因：只有 Q2，Q3 不是这个阶段开始时取消的。
        const main = page.locator("main");
        await main.getByText(droppedContent, { exact: true }).waitFor();
        await main.getByText(`取消的原因：${droppedReason}`, { exact: true }).waitFor();
        const text = await main.innerText();
        check(!text.includes(oldContent), "阶段开始以前取消的事也列在「取消的事」里");
        check(!/Q\d+/u.test(text), `「取消的事」里还写着队列编号：${text.slice(0, 200)}`);
      },
    },
    {
      do: "用户同意",
      expect: "这一组什么都不点，点完别的条再提交。回复里没有这一组的行，取消的事保持已取消。",
      run: async (w) => {
        const page = w.memo.get("page") as Page;
        // 这一组什么都不点：看一眼，备注留空。点完别的条：发现问题的那一张点 a。
        await nav(page).getByRole("button", { name: "取消的事" }).click();
        await page.getByText(`取消的原因：${droppedReason}`, { exact: true }).waitFor();
        check((await droppedNote(page).inputValue()) === "", "同意的一组备注里有字");
        await nav(page).getByRole("button", { name: "首页的列头太挤" }).click();
        await pick(page, /列头折成两行/u);
        await page.getByText("点过的都已存下").waitFor();
        await page.getByRole("button", { name: "提交", exact: true }).click();
        const dialog = page.getByRole("dialog");
        check((await dialog.innerText()).includes("1 条回复"), "确认框里回复的条数不对");
        await dialog.getByRole("button", { name: "提交" }).click();
        await page.getByText("等 AI 取走").waitFor();
        // AI 取走回复：只有发现问题的那一行，没有「取消的事」的行。
        const got = w.ploop(["reply", "wait", "--timeout", "10"]);
        expectRun(got, 0, "首页的列头太挤", "选了选项 a");
        check(droppedLine(got.stdout) === undefined, `回复里有「取消的事」的行：${got.stdout}`);
        check(!got.stdout.includes("取消的事"), "回复里写到了「取消的事」");
        // 取消的事保持已取消。
        expectRun(w.ploop(["queue", "show", "Q2"]), 0, "已取消");
      },
    },
    {
      do: "用户不同意一件",
      expect: "在这一组的备注里写这件事的名字和「还要做」，点提交。",
      run: async (w) => {
        // AI 处理完第 1 页的回复，再给出第 2 页：同一个阶段里，取消的事还是那一件。
        expectRun(w.ploop(["reply", "handle", "1", "不处理", "第 2 页再看一遍"]), 0);
        expectRun(w.ploop(["page", "present"]), 0, "给出了：第 1 版的检查阶段的第 2 页");
        const page = w.memo.get("page") as Page;
        await page.goto(w.url(pagePath(w)));
        await page.getByRole("heading", { name: "第 1 版的检查阶段" }).waitFor();
        await nav(page).getByRole("button", { name: "取消的事" }).click();
        await page.getByText(`取消的原因：${droppedReason}`, { exact: true }).waitFor();
        // 在「取消的事」这一组的备注里写这件事的名字和「还要做」。
        const note = `${droppedContent}，还要做`;
        await droppedNote(page).fill(note);
        // 另外点一个选项，回复里另有一行，第 8 步用它。
        await nav(page).getByRole("button", { name: "首页的列头太挤" }).click();
        await pick(page, /列头折成两行/u);
        await page.getByText("点过的都已存下").waitFor();
        await page.getByRole("button", { name: "提交", exact: true }).click();
        const dialog = page.getByRole("dialog");
        check((await dialog.innerText()).includes("2 条回复"), "确认框里回复的条数不对");
        await dialog.getByRole("button", { name: "提交" }).click();
        await page.getByText("等 AI 取走").waitFor();
      },
    },
    {
      do: "AI 敲 ploop reply show",
      expect: "有一行来自「取消的事」，内容是用户写的备注。",
      run: async (w) => {
        expectRun(w.ploop(["reply", "wait", "--timeout", "10"]), 0);
        const shown = w.ploop(["reply", "show"]);
        expectRun(shown, 0, "取消的事", `${droppedContent}，还要做`);
        const n = droppedLine(shown.stdout);
        check(n !== undefined, `回复里没有来自「取消的事」的一行：${shown.stdout}`);
        w.memo.set("line", n);
        // 内容是用户写的备注，不是原因，也不是队列的编号。
        const row = shown.stdout.split("\n").find((line) => line.includes("取消的事")) ?? "";
        check(row.includes(`${droppedContent}，还要做`), `这一行的内容不是用户的备注：${row}`);
      },
    },
    {
      do: "AI 敲 ploop reply handle，这一行填「队列」和那件事的编号",
      expect: "这件事回到待办，编号不变。状态说明写「用户在回复里点名捞回这件事」。",
      run: async (w) => {
        const line = w.memo.get("line") as string;
        expectRun(w.ploop(["reply", "handle", line, "队列", "Q2"]), 0, "Q2");
        const shown = w.ploop(["queue", "show", "Q2"]);
        expectRun(shown, 0, "待办", "用户在回复里点名捞回这件事");
        // 编号不变：队列里没有多出一件同名的事。
        const list = w.ploop(["queue", "list", "--all"]);
        check(
          (list.stdout.match(new RegExp(droppedContent, "gu")) ?? []).length === 1,
          `队列里同名的事不止一件：${list.stdout}`,
        );
      },
    },
    {
      do: "用户打开项目的队列看板",
      expect: "这件事又在它的阶段那一列里。展开它，状态写待办。",
      run: async (w) => {
        const page = await openPage(w, `/p/${projectId(w)}`);
        await page.getByRole("link", { name: "队列", exact: true }).click();
        // 检查一列里有这件事。
        const column = page
          .locator("section", { has: page.getByText("检查", { exact: true }) })
          .filter({ has: page.locator("[data-item=Q2]") })
          .last();
        await column.locator("[data-item=Q2]").waitFor();
        await column.getByText(droppedContent, { exact: true }).waitFor();
        // 待办是常态，小卡上不写词；点开展示卡片，状态写待办，状态变化里写着捞回。
        await page.locator("[data-item=Q2]").click();
        const dialog = page.getByRole("dialog");
        await dialog.getByText("状态", { exact: true }).waitFor();
        check((await dialog.innerText()).includes("待办"), "展示卡片里没有写待办");
        // 状态一栏和状态变化里都写了这句，读到哪一处都算。
        await dialog.getByText("用户在回复里点名捞回这件事").first().waitFor();
      },
    },
    {
      do: "AI 用 ploop reply handle 把一行指向早就取消的事",
      expect: "被拦截。写明要重新做就放进一件新的，来源写旧的编号。",
      run: async (w) => {
        // 回复的第 2 行是发现问题的那一张，指向阶段开始以前就取消的 Q3。
        const line = w.memo.get("line") as string;
        const other = line === "1" ? "2" : "1";
        const blocked = w.ploop(["reply", "handle", other, "队列", "Q3"]);
        expectRun(blocked, 1, "Q3", "新的", "来源");
        check(
          /来源.*Q3|Q3.*来源/u.test(`${blocked.stdout}${blocked.stderr}`),
          "没有写来源写旧的编号",
        );
        // 拦截以后 Q3 还是已取消。
        expectRun(w.ploop(["queue", "show", "Q3"]), 0, "已取消");
      },
    },
  ],
};
