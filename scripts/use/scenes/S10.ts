import { join } from "node:path";
import type { Page } from "playwright-core";
import { openPage, styleOf, tabTo } from "../browser.ts";
import { check, expectRun, type Scene } from "../lib.ts";
import { mainlineScenes } from "../mainline.ts";
import { presentThink, projectId, projectIdIn } from "../pages.ts";

// S10 看主线和决定。用户，想知道一件事为什么这样定时。找不到依据，用户会把已经定下的事再谈一遍。
// 摆的状态：决定 1 来自一行回复，改过文字；决定 2 被决定 3 推翻；主线交了第二次修订。

/** 决定 1 改后的决定和原因，决定 2（已作废）改后的原因。 */
const decisionOne = "队列看板放在每个阶段页的最后";
const reasonOne = "用户每一页都要看到队列，不想翻回队列页去找";
const reasonTwo = "作废的看着乱，也占地方";
/** 一句超过 40 个字的决定：新增和修改都会被拦下。 */
const tooLong =
  "决定表默认只列有效的，作废的用小字放在下面，点开能看到它被哪一条推翻，也能看到当时的原因";

type Listed = { data: { id: number; date: string }[] };

export const scene: Scene = {
  scene: "S10",
  setup: async (w) => {
    presentThink(w);
    const pid = projectId(w);
    // 用户回了一行，AI 把它记成一条决定。
    const view = (await w.api(
      "GET",
      `/projects/${pid}/rounds/${encodeURIComponent("v1-构思-1")}`,
    )) as {
      data: { pages: { id: number }[] };
    };
    await w.api("POST", `/projects/${pid}/pages/${view.data.pages[0]?.id}/submission`, {
      lines: [{ section: "疑问", card: "queue-board", kind: "选了选项", option: "a" }],
    });
    expectRun(w.ploop(["reply", "wait", "--timeout", "5"]), 0);
    expectRun(
      w.ploop([
        "reply",
        "handle",
        "1",
        "决定",
        "--decision",
        "队列看板放在每一页的最后",
        "--reason",
        "用户每一页都要看到队列",
        "--case",
        "第 1 版的构思阶段的疑问",
      ]),
      0,
    );
    // 另记一条，再被推翻。
    expectRun(
      w.ploop([
        "decision",
        "add",
        "--decision",
        "决定表只列有效的",
        "--reason",
        "作废的看着乱",
        "--case",
        "第 1 版的构思阶段",
      ]),
      0,
    );
    expectRun(
      w.ploop([
        "decision",
        "add",
        "--decision",
        "决定表默认只列有效的，能切换成全部",
        "--reason",
        "要能查作废的来龙去脉",
        "--case",
        "第 1 版的构思阶段",
      ]),
      0,
    );
    expectRun(w.ploop(["decision", "void", "2", "--by", "3", "--reason", "要能查作废的"]), 0);
    // 决定的「决定」一项超过 40 个字：新增和修改都拦下，提示把细节写进原因，决定表不多也不改。
    expectRun(
      w.ploop([
        "decision",
        "add",
        "--decision",
        tooLong,
        "--reason",
        "细节写在原因里",
        "--case",
        "第 1 版的构思阶段",
      ]),
      1,
      "缩短到 40 个字以内，细节写进原因",
      "decision.decision.tooLong",
    );
    expectRun(
      w.ploop(["decision", "edit", "1", "--decision", tooLong]),
      1,
      "缩短到 40 个字以内，细节写进原因",
      "decision.decision.tooLong",
    );
    // 改文字：决定的内容、有效的和已作废的原因都能改，编号和日期不变，决定.md 跟着重写，作废的仍标着已作废。
    const before = JSON.parse(w.ploop(["decision", "list", "--all", "--json"]).stdout) as Listed;
    check(before.data.length === 3, `决定有 ${before.data.length} 条，应当是 3 条`);
    expectRun(
      w.ploop(["decision", "edit", "1", "--decision", decisionOne, "--reason", reasonOne]),
      0,
      "改好了决定：第 1 条",
      "重写了 .product-loop/决定.md",
    );
    expectRun(w.ploop(["decision", "edit", "2", "--reason", reasonTwo]), 0, "改好了决定：第 2 条");
    const after = JSON.parse(w.ploop(["decision", "list", "--all", "--json"]).stdout) as Listed;
    check(
      JSON.stringify(after.data.map(({ id, date }) => [id, date])) ===
        JSON.stringify(before.data.map(({ id, date }) => [id, date])),
      "改文字以后决定的编号或日期变了",
    );
    const doc = w.read(".product-loop/决定.md");
    check(doc.includes(reasonOne) && doc.includes(reasonTwo), "决定.md 没有写上改后的原因");
    check(!doc.includes("用户每一页都要看到队列 |"), "决定.md 里还留着改以前的原因");
    check(/\| 2 \| .*已作废/u.test(doc), "改过文字的决定 2 在决定.md 里不再标已作废");
    // 主线的每个部分补一句，在这个阶段里交成新的一次修订：目录里每个部分最近一次改它的都在这个阶段。
    const text = w
      .read(".product-loop/主线.md")
      .replace(/\n(## \d+ )/gu, "\n本次修订补了一句。\n\n$1");
    w.write(".product-loop/主线.md", `${text.trimEnd()}\n\n补一句：看板放在每一页的最后。\n`);
    expectRun(w.ploop(["mainline", "push"]), 0);
  },
  steps: [
    {
      do: "在项目页点主线",
      expect: "主线全文，右边是十个部分的目录。每个部分写最近一次改它的修订、日期和阶段。",
      run: async (w) => {
        const page = await openPage(w, `/p/${projectId(w)}`);
        w.memo.set("page", page);
        await page.getByRole("link", { name: "主线", exact: true }).click();
        const toc = page.locator("aside", { hasText: "目录" });
        await toc.getByText("一句话新闻稿").waitFor();
        await toc.getByText("设计规范").waitFor();
        // 主线全文在左边，画成排好版的样子。
        await page.getByRole("heading", { name: "主线（产品循环自己的）" }).waitFor();
        // 十个部分，每个部分写最近一次改它的是哪次修订、哪天、哪个阶段，不写「第 3 版」，那是产品的版本。
        const entries = await toc.getByRole("button").allInnerTexts();
        check(entries.length === 10, `目录有 ${entries.length} 个部分，应当是十个`);
        for (const entry of entries) {
          check(
            /修订 \d+，\d{4}-\d{2}-\d{2}/u.test(entry) && entry.includes("第 1 版的构思阶段"),
            `目录里这一个部分没有写修订、日期和阶段：${entry.replaceAll("\n", " ")}`,
          );
        }
        check((await toc.getByText(/^第 \d+ 版，/u).count()) === 0, "目录里还把修订写成第几版");
        // 主线里的有序列表要有序号：列表项一变成 flex，序号和圆点就没了。
        const display = await styleOf(page, "main ol > li", "display");
        check(display === "list-item", `主线里的列表项 display 是 ${display}，序号会丢`);
      },
    },
    {
      do: "切到「原文比较」，选两次修订",
      expect: "按原文逐行对比。删的字红色划线，加的字绿色。",
      run: async (w) => {
        const page = w.memo.get("page") as Page;
        await page.getByRole("radio", { name: "原文比较" }).click();
        // 默认比最近的两次修订：加的一句是绿字。加的空行也是一个 ins，找有字的那个。
        await page.locator("ins", { hasText: "补一句" }).waitFor();
        // 选两次修订：起点选最新的，终点选最早的，反过来比，那一句就成了删的。
        await page.getByRole("combobox", { name: "起点修订" }).selectOption({ index: 0 });
        await page.getByRole("combobox", { name: "终点修订" }).selectOption({ index: 1 });
        const removed = page.locator("del", { hasText: "补一句" });
        await removed.waitFor();
        const through = await styleOf(page, "del", "text-decoration-line");
        check(through.includes("line-through"), `删的字是 ${through}`);
        // 删的字偏红，加的字偏绿。
        // 算出来的颜色可能写成 oklch，画到一个像素上读回 rgb。
        const tint = async (selector: string, property: string) =>
          (await page.evaluate(`(() => {
            const css = getComputedStyle(document.querySelector(${JSON.stringify(selector)}))
              .getPropertyValue(${JSON.stringify(property)});
            const canvas = document.createElement("canvas");
            canvas.width = canvas.height = 1;
            const g = canvas.getContext("2d");
            g.fillStyle = css;
            g.fillRect(0, 0, 1, 1);
            return [...g.getImageData(0, 0, 1, 1).data].slice(0, 3);
          })()`)) as number[];
        const [dr = 0, dg = 0, db = 0] = await tint("del", "color");
        check(dr > dg && dr > db, `删的字不是红的：rgb(${dr}, ${dg}, ${db})`);
        // 换回默认的两次修订，看加的。
        await page.getByRole("combobox", { name: "起点修订" }).selectOption({ index: 1 });
        await page.getByRole("combobox", { name: "终点修订" }).selectOption({ index: 0 });
        const added = page.locator("ins", { hasText: "补一句" });
        await added.waitFor();
        const [ar = 0, ag = 0, ab = 0] = await tint("ins:not(:empty)", "color");
        check(ag > ar && ag > ab, `加的字不是绿的：rgb(${ar}, ${ag}, ${ab})`);
        check(
          !(await styleOf(page, "ins:not(:empty)", "text-decoration-line")).includes("underline"),
          "加的字带下划线",
        );
        // 逐行：改过的每一行是一个带底的块，加的字在行里，不是把全文缠在一起。
        const rows = await page
          .locator("ins:not(:empty)")
          .evaluateAll((marks) =>
            marks.map((mark) => mark.parentElement?.parentElement?.className ?? ""),
          );
        check(
          rows.length >= 10 && rows.every((row) => row.includes("flex")),
          `改过的行不是一行一块：${rows.length}`,
        );
      },
    },
    {
      do: "切到「场景」",
      expect: "每个场景一块，写编号、名字、谁在什么时候用和步骤。",
      run: async (w) => {
        const page = w.memo.get("page") as Page;
        await page.getByRole("radio", { name: "场景" }).click();
        const first = page.locator("main section", { hasText: "看所有项目停在哪" }).first();
        await first.waitFor();
        const text = await first.innerText();
        check(text.includes("S1"), `这一块没有写编号：${text.slice(0, 100)}`);
        check(
          text.includes("用户，每天开工时"),
          `这一块没有写谁在什么时候用：${text.slice(0, 200)}`,
        );
        check(text.includes("第 1 步"), "这一块没有写步骤");
        check(text.includes("打开工作台首页"), "步骤里没有写做什么");
        // 每个场景一块：主线里有多少个场景，就有多少块。
        const blocks = await page.locator("main section h3").count();
        const written = mainlineScenes().size;
        check(blocks === written, `场景有 ${blocks} 块，主线里是 ${written} 个`);
      },
    },
    {
      do: "点决定",
      expect: "一张表，最近的在最上面。默认只列有效的，作废的划掉，并写被哪一条推翻。",
      run: async (w) => {
        const page = w.memo.get("page") as Page;
        await page.getByRole("link", { name: "决定", exact: true }).click();
        await page.getByText(decisionOne).waitFor();
        check(
          (await page.getByText("决定表只列有效的", { exact: true }).count()) === 0,
          "默认列出了作废的",
        );
        await page.getByRole("radio", { name: "全部" }).click();
        const voided = page.getByText("决定表只列有效的", { exact: true });
        await voided.waitFor();
        const line = await styleOf(page, "td span.line-through", "text-decoration-line");
        check(
          line === "line-through" &&
            (await page.locator("td span.line-through").innerText()) === "决定表只列有效的",
          "作废的没有划掉",
        );
        await page.getByText("被「决定表默认只列有效的，能切换成全部」推翻").first().waitFor();
        // 状态只写「已作废」，推翻它的决定另起一行，在展示卡片里。
        await page.getByText("决定表只列有效的", { exact: true }).click();
        const sheet = page.getByRole("dialog");
        await sheet.getByText("已作废", { exact: true }).waitFor();
        await sheet.getByText("推翻它的决定", { exact: true }).waitFor();
        await sheet.getByText("决定表默认只列有效的，能切换成全部").first().waitFor();
        check(!(await sheet.innerText()).includes("已作废，被"), "状态里还写着被哪一条推翻");
        // 已作废的也改过文字：卡片里是改后的原因，编号的顺序不变（下面查）。
        await sheet.getByText(reasonTwo, { exact: true }).waitFor();
        await page.keyboard.press("Escape");
        await sheet.waitFor({ state: "hidden" });
        check(
          !(await page.locator("main").innerText()).includes("第 3 条"),
          "推翻它的决定还写成第几条",
        );
        // 最近定的在最上面：编号 3、2、1。
        const ids = await page.locator("tbody tr td:first-child").allInnerTexts();
        check(ids.join(",") === "3,2,1", `决定表的顺序是 ${ids.join(",")}，应当是最近的在最上面`);
      },
    },
    {
      do: "搜一个词",
      expect: "只留下决定、原因或案例里有这个词的。搜不到时表头还在，写「没有找到」。",
      run: async (w) => {
        const page = w.memo.get("page") as Page;
        const box = page.getByRole("textbox", { name: "搜索决定" });
        const only = async (word: string, count: number) => {
          await box.fill(word);
          await page.getByText(`${count} / 3 条`).waitFor();
          check(
            (await page.locator("tbody tr").count()) === count,
            `搜「${word}」留下的不是 ${count} 条`,
          );
        };
        // 决定里的词、原因里的词、案例里的词，各搜一次，只有决定 1 有。
        await only("阶段页的最后", 1);
        await only("翻回队列页", 1);
        await only("构思阶段的疑问", 1);
        // 决定 2 和 3 的案例都写第 1 版的构思阶段，搜它留下三条。
        await only("第 1 版的构思阶段", 3);
        // 搜不到时表头留着，表里只有一行「没有找到」，不列决定。
        await box.fill("没有这个词");
        await page.getByText("0 / 3 条").waitFor();
        check(
          (await page.locator("tbody tr").count()) === 1 &&
            (await page.locator("tbody").innerText()).includes("没有找到"),
          "搜不到时表里没有只写一句没有找到",
        );
        check((await page.locator("thead th").count()) > 0, "搜不到时表头也没有了");
        await box.fill("");
        await page.getByText("3 条", { exact: true }).waitFor();
        check((await page.locator("tbody tr").count()) === 3, "清空以后没有全部回来");
      },
    },
    {
      do: "点一条决定",
      expect: "卡片标题写这条决定的内容，改过文字的写改后的。卡片写它来自哪个阶段的哪一行回复。",
      run: async (w) => {
        const page = w.memo.get("page") as Page;
        await page.getByText(decisionOne).click();
        const dialog = page.getByRole("dialog");
        // 卡片的标题写这条决定的内容，不写「第 1 条」。改过文字的写改后的，改以前的没有留在卡片里。
        await dialog.getByRole("heading", { name: decisionOne }).waitFor();
        check(!(await dialog.innerText()).includes("第 1 条"), "卡片的标题还写着第几条");
        check(
          !(await dialog.innerText()).includes("队列看板放在每一页的最后"),
          "卡片里还写着改以前的决定",
        );
        await dialog.getByText(reasonOne, { exact: true }).waitFor();
        check(
          (await dialog.getByText("用户每一页都要看到队列", { exact: true }).count()) === 0,
          "卡片里还写着改以前的原因",
        );
        // 来自哪个阶段的哪一行回复：写阶段，链接到那一页，再写那一行回复的内容，不写第几行。
        await dialog.getByRole("link", { name: "第 1 版的构思阶段" }).waitFor();
        await dialog.getByText("的回复", { exact: false }).first().waitFor();
        await dialog.getByText("队列看板放在哪里").waitFor();
        check(!(await dialog.innerText()).includes("第 1 行"), "卡片里还写着回复的第几行");
      },
    },
    {
      do: "用键盘 Tab 到一条决定，按 Enter 或空格",
      expect: "停在这一条上时整行有框线，按下去打开展示卡片。Esc 关掉后键盘仍停在这一条上。",
      run: async (w) => {
        const page = w.memo.get("page") as Page;
        await page.keyboard.press("Escape");
        await page.getByRole("dialog").waitFor({ state: "hidden" });
        const reached = await tabTo(
          page,
          page.getByRole("textbox", { name: "搜索决定" }),
          "tbody tr",
        );
        check(reached, "从搜索框按 Tab，到不了决定表里的一行");
        // 焦点看得见：这一行有框线。
        const outline = await styleOf(page, "tbody tr:has(button:focus-visible)", "outline-style");
        check(outline === "solid", `键盘停在这一行上，框线是 ${outline}`);
        const heading = { name: "决定表默认只列有效的，能切换成全部" };
        const dialog = page.getByRole("dialog");
        const focusedRow = () =>
          page.evaluate(`document.activeElement?.closest("tbody tr")?.innerText ?? ""`);
        const row = (await focusedRow()) as string;
        check(row.includes("决定表默认只列有效的"), `键盘停在的不是最上面一条：${row}`);
        // Enter 打开展示卡片，键盘进到卡片里以后，Esc 才关得掉它；关掉以后键盘仍停在这一条上。
        await page.keyboard.press("Enter");
        await dialog.getByRole("heading", heading).waitFor();
        await page.waitForFunction("document.activeElement?.closest('[role=dialog]') != null");
        await page.keyboard.press("Escape");
        await dialog.waitFor({ state: "hidden" });
        check(
          ((await focusedRow()) as string) === row,
          `Esc 关掉以后键盘不在这一条上：${await focusedRow()}`,
        );
        const back = await styleOf(page, "tbody tr:has(button:focus-visible)", "outline-style");
        check(back === "solid", `Esc 关掉以后这一行没有框线：${back}`);
        // 空格也能打开。
        await page.keyboard.press("Space");
        await dialog.getByRole("heading", heading).waitFor();
      },
    },
    {
      do: "打开一个还没有记过决定的项目，点决定",
      expect: "写「没有决定」，不摆只有表头的空表。",
      run: async (w) => {
        const page = w.memo.get("page") as Page;
        // 另一个项目 beta：刚开工，一条决定都没记过。
        w.write("../beta/.keep", "");
        expectRun(w.ploop(["init", "--repo", "自己的"], join(w.root, "..", "beta")), 0);
        const beta = projectIdIn(w, "../beta");
        await page.goto(w.url(`/p/${beta}`));
        await page.getByRole("heading", { name: beta, exact: true }).waitFor();
        await page.getByRole("link", { name: "决定", exact: true }).click();
        await page.getByText("没有决定", { exact: true }).waitFor();
        check(page.url().endsWith(`/p/${beta}/decisions`), `到了 ${page.url()}`);
        // 没有决定就没有表：不摆只有表头的空表，也不写「没有找到」。
        check((await page.locator("table").count()) === 0, "没有决定，页面上却摆着表");
        check((await page.getByText("没有找到").count()) === 0, "没有决定，却写了「没有找到」");
        // 页头和四个页签都在。
        const tabs = page.getByRole("navigation", { name: "项目" });
        for (const name of ["概览", "队列", "主线", "决定"]) {
          await tabs.getByRole("link", { name, exact: true }).waitFor();
        }
        await page.getByRole("link", { name: "所有项目" }).waitFor();
      },
    },
  ],
};
