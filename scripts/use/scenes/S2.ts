import type { Page } from "playwright-core";
import { openPage } from "../browser.ts";
import { check, expectRun, type Scene } from "../lib.ts";
import { presentThink, projectId } from "../pages.ts";

// S2 看一个项目走到哪了。用户，想知道一个项目做到哪一步时。要定是等回复、接着做还是退回。
// 进度画错，用户会重做已收尾的阶段，或者漏掉在等的页。
// 摆好的状态：第 1 版的构思阶段收尾了，有一句话小结，里面有两页（第 1 页回复过，第 2 页只看）；
// 构思阶段又开了第 2 次，拿出两件事，进行中；决定表里有六条决定。

// 给第 1 次再给出一页只看的，没有回复它，这个阶段就收尾了：这一页留在已收尾的阶段里。
const leftBehind = {
  asks: [
    {
      id: "left-behind",
      title: "看板要不要加筛选",
      why: "队列里的事多了以后不好找。",
      sources: [{ name: "用户说的", saw: "「事多的时候找不到」", quote: true }],
      shared: { text: "两种放法都不改看板的列。" },
      rows: ["筛选放在哪里"],
      options: [
        {
          key: "a",
          title: "看板顶上",
          diffs: ["一排筛选。"],
          why: "一眼看到。",
          cost: "占一行。",
          when: "事很多时。",
        },
        {
          key: "b",
          title: "单独一页",
          diffs: ["项目页上的一个入口。"],
          why: "看板不变。",
          cost: "多点一下。",
          when: "事不多时。",
        },
      ],
    },
  ],
};

/** 第 3 次给出的一页：一张卡，盖住这个阶段拿出来的 Q4，等用户回复。 */
const waitingPage = {
  asks: [
    {
      id: "filter-again",
      queue: ["Q4"],
      title: "看板筛选的位置",
      why: "筛选放在看板顶上还是单独一页，要定一种。",
      sources: [{ name: "用户说的", saw: "「事多的时候找不到」", quote: true }],
      shared: { text: "两种放法都不改看板的列。" },
      rows: ["筛选放在哪里"],
      options: [
        {
          key: "a",
          title: "看板顶上",
          diffs: ["一排筛选。"],
          why: "一眼看到。",
          cost: "占一行。",
          when: "事很多时。",
        },
        {
          key: "b",
          title: "单独一页",
          diffs: ["项目页上的一个入口。"],
          why: "看板不变。",
          cost: "多点一下。",
          when: "事不多时。",
        },
      ],
    },
  ],
};

const doneItem = "补充看板的说明";
const doingItem = "看板要能筛选";

const decisions = [
  "看板放在每一页的最后",
  "备份提示七天内不再出现",
  "队列按阶段分五列",
  "项目页有四个页签",
  "主线只留一份准本",
  "使用代码逐字对齐主线",
];

/** 「现在」这一块里的三组：组名到组里每件事的文字。 */
async function nowGroups(page: Page): Promise<Map<string, string[]>> {
  const groups = (await page.evaluate(`(() => {
    const now = [...document.querySelectorAll("section")].find(
      (s) => s.querySelector("h2")?.textContent === "现在",
    );
    const out = {};
    for (const p of now.querySelectorAll("p")) {
      const m = /^(做完的|进行中的|要退回的)\\s*\\d+$/u.exec(p.textContent.trim());
      if (m) out[m[1]] = [...p.parentElement.children].slice(1).map((c) => c.textContent.trim());
    }
    return out;
  })()`)) as Record<string, string[]>;
  return new Map(Object.entries(groups));
}

export const scene: Scene = {
  scene: "S2",
  setup: async (w) => {
    presentThink(w);
    for (const decision of decisions) {
      expectRun(
        w.ploop([
          "decision",
          "add",
          "--decision",
          decision,
          "--reason",
          "用户每天开工先看这里",
          "--case",
          "第 1 版的构思阶段第 1 行",
        ]),
        0,
      );
    }
    // 用户提交、AI 取走，再收尾，第 1 次有一句话小结。
    const pid = projectId(w);
    const view = (await w.api(
      "GET",
      `/projects/${pid}/rounds/${encodeURIComponent("v1-构思-1")}`,
    )) as {
      data: { pages: { id: number }[] };
    };
    const id = view.data.pages[0]?.id;
    await w.api("POST", `/projects/${pid}/pages/${id}/submission`, {
      lines: [{ section: "疑问", card: "queue-board", kind: "选了选项", option: "a" }],
    });
    expectRun(w.ploop(["reply", "wait", "--timeout", "5"]), 0);
    expectRun(w.ploop(["reply", "handle", "1", "不处理", "只是看看"]), 0);
    w.write(".product-loop/rounds/v1-构思-1/page.json", JSON.stringify(leftBehind));
    expectRun(w.ploop(["page", "present", "--view"]), 0);
    expectRun(
      w.ploop([
        "round",
        "close",
        "--done",
        "Q1=看板放在每一页的最后",
        "--summary",
        "定下了看板放在哪里",
      ]),
      0,
    );
    // 构思阶段的第 2 次：拿出两件事，进行中。
    expectRun(w.ploop(["queue", "add", doneItem, "--stage", "构思"]), 0);
    expectRun(w.ploop(["queue", "add", doingItem, "--stage", "构思"]), 0);
    expectRun(w.ploop(["round", "start", "构思"]), 0);
  },
  steps: [
    {
      do: "点一个项目",
      expect: "进度按版本一行、阶段五列摆开。每个阶段一个方块，方块里有符号，不单靠颜色。",
      run: async (w) => {
        const page = await openPage(w, "/");
        w.memo.set("page", page);
        await page.getByRole("link", { name: projectId(w), exact: true }).click();
        await page.getByRole("link", { name: "第 1 版的构思阶段", exact: true }).waitFor();
        await page
          .getByRole("link", { name: "第 1 版的构思阶段（第 2 次）", exact: true })
          .waitFor();
        // 版本一行、阶段五列：列头是五个阶段，行头是第几版。
        const progress = page.locator("section", {
          has: page.getByRole("heading", { name: "进度" }),
        });
        for (const stage of ["构思", "使用", "检查", "落地", "提升"]) {
          await progress.getByRole("columnheader", { name: stage, exact: true }).waitFor();
        }
        check((await progress.locator("tbody tr").count()) === 1, "一版应当只有一行");
        check(
          (await progress.locator("tbody tr").innerText()).includes("第 1 版"),
          "行里没有写第几版",
        );
        // 收尾的和进行中的方块符号不同：颜色不是唯一的区别。
        const closed = await page
          .getByRole("link", { name: "第 1 版的构思阶段", exact: true })
          .innerHTML();
        const working = await page
          .getByRole("link", { name: "第 1 版的构思阶段（第 2 次）", exact: true })
          .innerHTML();
        check(closed.includes("<svg") && working.includes("<svg"), "方块里没有符号");
        check(closed !== working, "已收尾和进行中的方块只有颜色不同");
      },
    },
    {
      do: "悬停或聚焦一个方块",
      expect: "已收尾的写一句话小结，进行中的写「进行中」和开始日期。",
      run: async (w) => {
        const page = w.memo.get("page") as Page;
        const closedLink = page.getByRole("link", { name: "第 1 版的构思阶段", exact: true });
        const box = await closedLink.boundingBox();
        check(box !== null, "找不到第 1 版构思阶段的方块");
        check(
          box !== null && box.width >= 24 && box.height >= 24,
          `方块只有 ${box?.width} 乘 ${box?.height} 像素，点不中`,
        );
        // 悬停已收尾的方块：写这个阶段的一句话小结。
        await page.mouse.move(0, 0);
        await page.mouse.move((box?.x ?? 0) + 5, (box?.y ?? 0) + 5, { steps: 5 });
        const summary = page.getByRole("tooltip").filter({ hasText: "定下了看板放在哪里" });
        await summary.waitFor();
        await summary.getByText("第 1 版的构思阶段").waitFor();
        check(!(await summary.innerText()).includes("v1-"), "提示里还写着 v1-构思-1 这类写法");
        // 聚焦进行中的方块：写「进行中」和开始日期。
        await page.mouse.move(0, 0);
        await closedLink.focus();
        await page.keyboard.press("Tab");
        const working = page.getByRole("tooltip").filter({ hasText: "进行中，" });
        await working.waitFor();
        const text = await working.innerText();
        check(/进行中，\d{4}-\d{2}-\d{2} 开始/u.test(text), `进行中的方块写的是：${text}`);
        check(text.includes("第 1 版的构思阶段（第 2 次）"), `提示里没有写是哪一次：${text}`);
      },
    },
    {
      do: "看「现在」这一块",
      expect:
        "当前阶段拿出来的事分三组：做完的、进行中的、要退回的。阶段没收尾，做完的也已分出来。",
      run: async (w) => {
        const page = w.memo.get("page") as Page;
        const problems: string[] = [];
        // 阶段没收尾：一件做完了，一件还在做。
        expectRun(w.ploop(["queue", "done", "Q3", "--evidence", "提交 a1b2c3d"]), 0);
        await page.reload();
        await page.getByRole("heading", { name: "现在" }).waitFor();
        const now = page.locator("section", { has: page.getByRole("heading", { name: "现在" }) });
        await now.getByText("第 1 版的构思阶段（第 2 次）").waitFor();
        await now.getByText(doingItem, { exact: true }).waitFor();
        check(
          !(await now.innerText()).includes("做完的 0"),
          "没有的组不写，不写「做完的 0」这样的零",
        );
        let groups = await nowGroups(page);
        if (!groups.get("进行中的")?.some((text) => text.includes(doingItem))) {
          problems.push(`进行中的组里没有「${doingItem}」：${JSON.stringify([...groups])}`);
        }
        if (!groups.get("做完的")?.some((text) => text.includes(doneItem))) {
          problems.push(
            `阶段没收尾，做完的「${doneItem}」没有分到「做完的」组：${JSON.stringify([...groups])}`,
          );
        }
        // 阶段收尾以后：做完的一组，要退回的一组。
        expectRun(w.ploop(["round", "close", "--return", `Q4=${doingItem}还没定`]), 0);
        await page.reload();
        await page.getByRole("heading", { name: "现在" }).waitFor();
        await now.getByText(doingItem, { exact: true }).waitFor();
        groups = await nowGroups(page);
        if (!groups.get("做完的")?.some((text) => text.includes(doneItem))) {
          problems.push(
            `收尾以后「做完的」组里没有「${doneItem}」：${JSON.stringify([...groups])}`,
          );
        }
        const returned = groups.get("要退回的");
        if (!returned?.some((text) => text.includes(doingItem))) {
          problems.push(`收尾以后退回的组里没有「${doingItem}」：${JSON.stringify([...groups])}`);
        }
        // 再开一次构思阶段，退回的事回到进行中；后面几步看这一次。
        expectRun(w.ploop(["round", "start", "构思"]), 0);
        await page.reload();
        await page.getByRole("heading", { name: "现在" }).waitFor();
        await now.getByText("第 1 版的构思阶段（第 3 次）").waitFor();
        // 这个阶段还没有给出页面，没有页在等，页头和「现在」里都没有要打开的。
        check(
          (await page.getByRole("link", { name: "打开这一页" }).count()) === 0,
          "没有页在等，却有「打开这一页」",
        );
        check(!/轮|v1-/u.test(await now.innerText()), "「现在」里还写着轮或 v1-");
        check(problems.length === 0, problems.join("；"));
      },
    },
    {
      do: "点一个方块",
      expect: "进到那个阶段的页。页头和阶段条写现在的状态，标签页的标题写项目和阶段。",
      run: async (w) => {
        const page = w.memo.get("page") as Page;
        await page.mouse.move(0, 0);
        await page.getByRole("link", { name: "第 1 版的构思阶段", exact: true }).click();
        await page.getByRole("heading", { name: "第 1 版的构思阶段" }).waitFor();
        // 标签页的标题写项目和这一次阶段，同时开几个项目的页面时分得出来。
        check(
          (await page.title()) === `${projectId(w)} 第 1 版的构思阶段 - 产品循环`,
          `标签页的标题是「${await page.title()}」`,
        );
        // 这个阶段有两页：没有在等的，先打开最后给出的一页，回复过的是第 1 页。
        await page
          .getByRole("navigation", { name: "这个阶段的几页" })
          .getByRole("button", { name: "第 1 页" })
          .click();
        await page.getByText("AI 已收到").waitFor();
        // 页头、阶段条写的都是现在的状态：这个阶段收尾了，不是给出这一页时的等用户回复。
        await page.getByText("已收尾", { exact: true }).first().waitFor();
        await page.locator('[title="构思阶段，已收尾"]').first().waitFor();
        await page.locator('[title="构思阶段（第 3 次），进行中"]').waitFor();
        // 页头阶段条里的方块也带符号。
        check(
          (await page.locator('[title="构思阶段，已收尾"] svg').count()) >= 1,
          "阶段条里的方块没有符号",
        );
        const text = await page.locator("main").innerText();
        check(!text.includes("现在是"), `阶段条下面还写着存下的那一句：${text.slice(0, 300)}`);
        check(!text.includes("等用户回复"), `页面上还写着等用户回复：${text.slice(0, 300)}`);
        check(!/轮|v1-/u.test(text), `页面上还写着轮或 v1-：${text.slice(0, 300)}`);
      },
    },
    {
      do: "打开已收尾且没有回复的那一页",
      expect: "选项点不了，没有输入框和提交，写着「阶段已收尾」。",
      run: async (w) => {
        const page = w.memo.get("page") as Page;
        await page
          .getByRole("navigation", { name: "这个阶段的几页" })
          .getByRole("button", { name: "第 2 页" })
          .click();
        await page.getByText("阶段已收尾", { exact: true }).first().waitFor();
        // 只看的页没有要点的条，打开先到第一屏（上一个阶段的回复去处）；再到那张卡上看选项。
        await page
          .getByRole("navigation", { name: "这一页的每一条" })
          .getByRole("button", { name: /看板要不要加筛选/u })
          .click();
        const first = page.getByRole("radio", { name: /看板顶上/u });
        await first.waitFor();
        await page.locator("label", { has: first }).click();
        check(!(await first.isChecked()), "已收尾的阶段里的页还能点选项");
        check((await page.getByRole("textbox").count()) === 0, "已收尾的阶段里的页有输入框");
        check(
          (await page.getByRole("button", { name: "提交", exact: true }).count()) === 0,
          "已收尾的阶段里的页还有提交",
        );
      },
    },
    {
      do: "打开不存在的阶段或项目的地址",
      expect: "马上写「找不到这一页」。页头和回到上一级的入口都在。",
      run: async (w) => {
        const page = w.memo.get("page") as Page;
        // 不存在的阶段：回到这个项目。
        const started = Date.now();
        await page.goto(w.url(`/p/${projectId(w)}/r/${encodeURIComponent("v9-落地-9")}`));
        await page.getByText("找不到这一页").waitFor({ timeout: 3000 });
        check(Date.now() - started < 3000, "找不到这一页等了三秒以上才显示");
        await page.getByRole("link", { name: "产品循环" }).waitFor();
        await page.getByRole("link", { name: "回到这个项目" }).click();
        await page.getByRole("heading", { name: projectId(w) }).waitFor();
        // 不存在的项目：回到所有项目。
        const again = Date.now();
        await page.goto(w.url("/p/no-such-project"));
        await page.getByText("找不到这一页").waitFor({ timeout: 3000 });
        check(Date.now() - again < 3000, "不存在的项目等了三秒以上才写找不到这一页");
        await page.getByRole("link", { name: "产品循环" }).waitFor();
        await page.getByRole("link", { name: "回到所有项目" }).waitFor();
      },
    },
    {
      do: "看「主线」和「决定」两块",
      expect:
        "主线块写现在是第几次修订，十个部分各一行，写了的打勾。决定块列最近几条，「全部」进决定页。",
      run: async (w) => {
        const page = w.memo.get("page") as Page;
        await page.goto(w.url(`/p/${projectId(w)}`));
        const block = (name: string) =>
          page.locator("section", { has: page.getByRole("heading", { name, exact: true }) });
        const mainline = block("主线");
        await mainline.waitFor();
        // 块的标题先出来，里面的数据是各自向后端取的，晚一点才到：先等修订那一句和十个部分，再读。
        // 十个部分是同一次渲染出来的，第一行在，十行都在。
        await mainline.getByText(/修订 \d+/u).waitFor();
        const parts = mainline.getByRole("listitem");
        await parts.first().waitFor();
        // 写现在是第几次修订。
        const revision = /修订 (\d+)/u.exec(await mainline.innerText());
        check(revision !== null, `主线块没有写第几次修订：${await mainline.innerText()}`);
        // 十个部分各一行，写了的打勾：这个软件自己的主线十个部分都写了，十行都带对勾。
        check((await parts.count()) === 10, `主线块有 ${await parts.count()} 行，应当是十个部分`);
        const ticked = (list: typeof parts) => list.locator("svg").count();
        check((await ticked(parts)) === 10, `十个部分都写了，却有 ${await ticked(parts)} 行带对勾`);
        // 删掉一个部分再交一次修订：只有没写的那一行不带对勾，修订的次数加一。
        const text = w.read(".product-loop/主线.md");
        const cut = text.replace(/\n## 9 事前验尸[\s\S]*?(?=\n## 10 )/u, "\n");
        check(cut !== text, "主线里找不到事前验尸这一部分");
        w.write(".product-loop/主线.md", cut);
        expectRun(w.ploop(["mainline", "push"]), 0);
        await page.reload();
        await mainline.getByText(`修订 ${Number(revision?.[1]) + 1}`).waitFor();
        await parts.first().waitFor();
        check((await ticked(parts)) === 9, `删掉一个部分以后有 ${await ticked(parts)} 行带对勾`);
        const bare = parts.filter({ hasText: "事前验尸" });
        check((await ticked(bare)) === 0, "没写的「事前验尸」还带着对勾");
        // 主线块的「读全文」进主线页。
        const full = mainline.getByRole("link", { name: "读全文" });
        check(
          ((await full.getAttribute("href")) ?? "").endsWith(`/p/${projectId(w)}/mainline`),
          `读全文指向 ${await full.getAttribute("href")}`,
        );
        // 决定块列最近几条，最新的在最上面；「全部」进决定页。
        const recent = block("决定");
        await recent.waitFor();
        // 决定块的标题先出来，几条决定晚一点才到；allInnerTexts 不等，先等第一条。五条是同一次渲染出来的。
        await recent.getByRole("listitem").first().waitFor();
        const rows = await recent.getByRole("listitem").allInnerTexts();
        check(rows.length === 5, `决定块列了 ${rows.length} 条，应当是最近的 5 条`);
        check(rows[0]?.includes(decisions[5] ?? "") === true, `最上面一条是：${rows[0]}`);
        check(!rows.join("").includes(decisions[0] ?? ""), "最早的一条不该在最近几条里");
        await recent.getByRole("link", { name: "全部" }).click();
        // 等到了决定页再往下：决定页上没有叫「决定」的标题，叫这个名字的标题是项目页上的这一块，
        // 只在路由换过去以前还在。等它，会在负载高、换得快时永远等不到。决定页有的是那张表的表头。
        await page.getByRole("columnheader", { name: "决定", exact: true }).waitFor();
        check(page.url().endsWith(`/p/${projectId(w)}/decisions`), `到了 ${page.url()}`);
        await page.getByText(decisions[0] ?? "").waitFor();
      },
    },
    {
      do: "项目有页在等回复，回到项目页",
      expect: "页头和「现在」里各有「打开这一页」，按下都到那一页。没有页在等时，两处都没有。",
      run: async (w) => {
        const page = w.memo.get("page") as Page;
        const now = page.locator("section", { has: page.getByRole("heading", { name: "现在" }) });
        const header = page.locator("h1").locator("xpath=..");
        // 没有页在等：页头和「现在」里都没有要打开的。
        await page.goto(w.url(`/p/${projectId(w)}`));
        await now.getByText("第 1 版的构思阶段（第 3 次）").waitFor();
        check(
          (await header.getByRole("link", { name: "打开这一页" }).count()) === 0,
          "没有页在等，页头却有「打开这一页」",
        );
        check(
          (await now.getByRole("link", { name: "打开这一页" }).count()) === 0,
          "没有页在等，「现在」里却有「打开这一页」",
        );
        // AI 给出一页，等用户回复：这个阶段拿出来的事是 Q4。
        w.write(".product-loop/rounds/v1-构思-3/page.json", JSON.stringify(waitingPage));
        expectRun(w.ploop(["page", "present"]), 0, "第 1 版的构思阶段（第 3 次）的第 1 页");
        await page.reload();
        await page.getByRole("link", { name: "打开这一页" }).first().waitFor();
        // 页头右边和「现在」里各有一个，都不是另外的地方多出来的。
        check(
          (await header.getByRole("link", { name: "打开这一页" }).count()) === 1,
          "页头里没有一个「打开这一页」",
        );
        check(
          (await now.getByRole("link", { name: "打开这一页" }).count()) === 1,
          "「现在」里没有一个「打开这一页」",
        );
        check(
          (await page.getByRole("link", { name: "打开这一页" }).count()) === 2,
          "项目页上的「打开这一页」不是两个",
        );
        // 按下都到那一页，页头写第几版、阶段和第几次。
        const path = `/p/${projectId(w)}/r/${encodeURIComponent("v1-构思-3")}`;
        for (const where of [header, now]) {
          await page.goto(w.url(`/p/${projectId(w)}`));
          await where.getByRole("link", { name: "打开这一页" }).click();
          await page.getByRole("heading", { name: "第 1 版的构思阶段（第 3 次）" }).waitFor();
          check(
            decodeURIComponent(new URL(page.url()).pathname).startsWith(decodeURIComponent(path)),
            `到了 ${page.url()}，不是等回复的那一页`,
          );
          await page.getByText("看板筛选的位置").first().waitFor();
        }
        // 回到项目页停下：截图里页头和「现在」的两个入口都在。
        await page.goto(w.url(`/p/${projectId(w)}`));
        await now.getByRole("link", { name: "打开这一页" }).waitFor();
      },
    },
  ],
};
