import type { Page } from "playwright-core";
import { openPage, pick, show } from "../browser.ts";
import { check, expectRun, type Scene, started } from "../lib.ts";
import { mainlineScenes } from "../mainline.ts";
import { projectId, solidPng } from "../pages.ts";

// S23 检查阶段逐条点发现的问题。用户，AI 检查完一版，给出发现问题的页时。
// 找问题是 AI 的活，用户只给每一条点一个选项。摆的状态：第 1 版的检查阶段，拿出三件要检查的事，
// 页上三张发现问题的卡，各带一处出现的位置（主线里 S3 的第 2、5、8 步），另有元素清单。
// 第 1 张点 a（要改），第 2 张只写备注，第 3 张点「不改」，提交以后 AI 收下、处理、开始落地。

const workspace = ".product-loop/rounds/v1-检查-1";

/** 三张卡指的位置：主线里 S3 的第几步。 */
const places = [2, 5, 8] as const;

const cards = [
  {
    queue: ["Q1"],
    title: "块名下面的说明",
    tag: "必要性",
    why: "读一条时，每一块的名字下面还有一句说明。",
    sources: [{ name: "选项页面", saw: "块的名字下面写着这一块怎么用。", img: "img/block.png" }],
    where: { scene: "S3", step: places[0] },
    evidence: [{ type: "截图", img: "img/block.png", caption: "选项页面" }],
    shared: { text: "块的名字和位置都不变。" },
    rows: ["说明"],
    options: [
      {
        key: "a",
        title: "删掉说明",
        diffs: ["每一块只留名字。"],
        why: "控件自己能说明怎么点。",
        cost: "第一次用的人少一句提示。",
        when: "用户已经用过一次。",
      },
      { key: "b", title: "不改", diffs: ["说明照旧。"] },
    ],
    stance: { pick: "a", because: "界面不解释自己，说明是多余的。" },
  },
  {
    queue: ["Q2"],
    title: "备注框叫法不一",
    tag: "认知一致性",
    why: "同一个框，有的卡叫「备注」，有的卡叫「回答」。",
    sources: [{ name: "用户的话", saw: "「这个框到底是备注还是回答」", quote: true }],
    where: { scene: "S3", step: places[1] },
    shared: { text: "框的位置和大小不变。" },
    rows: ["框的名字"],
    options: [
      {
        key: "a",
        title: "都叫备注",
        diffs: ["每张卡的框都写「备注」。"],
        why: "叫法只有一种。",
        cost: "只有备注框的卡，用户不知道该写答案。",
        when: "备注和回答没有区别。",
      },
      {
        key: "b",
        title: "都叫回答",
        diffs: ["每张卡的框都写「回答」。"],
        why: "有选项的卡也是在回答。",
        cost: "选了选项还要写回答，像是没选完。",
        when: "用户只在追问时写字。",
      },
      { key: "c", title: "不改", diffs: ["有选项写备注，没选项写回答。"] },
    ],
    stance: { pick: "a", because: "同一个框只该有一个名字。" },
  },
  {
    queue: ["Q3"],
    title: "提交前的确认",
    tag: "交互一致性",
    why: "只点了一条也能提交，确认框里没点的条数不显眼。",
    sources: [{ name: "确认框", saw: "还有几条没点写在第二行。", img: "img/confirm.png" }],
    where: { scene: "S3", step: places[2] },
    shared: { text: "确认框的按钮不变。" },
    rows: ["没点的条数"],
    options: [
      {
        key: "a",
        title: "写在第一行",
        diffs: ["第一行写有几条没点。"],
        why: "提交前一眼看到。",
        cost: "确认框多占一行。",
        when: "用户常常漏点。",
      },
      { key: "b", title: "不改", diffs: ["写在第二行。"] },
    ],
    stance: { pick: "b", because: "用户没有因为这里漏点过。" },
  },
];

const page = {
  findings: cards,
  screens: places.map((step, i) => ({
    name: ["选项页面", "备注框页面", "确认框页面"][i] ?? "",
    where: { scene: "S3", step },
    elements: [{ what: ["每一块的说明", "备注框", "确认框"][i] ?? "", answers: "这一步该做什么" }],
  })),
};

/** 主线里 S3 的这一步：卡上的位置要和它逐字相同。 */
function mainlineStep(step: number): { do: string; expect: string; count: number } {
  const steps = mainlineScenes().get("S3") ?? [];
  const found = steps[step - 1];
  if (found === undefined) throw new Error(`主线里 S3 没有第 ${step} 步`);
  return { ...found, count: steps.length };
}

/** 页上标题是 title 的那张卡。换屏的一刻新旧两屏同时在页上，按标题认，不认第一张。 */
const cardOf = (page: Page, title: string) =>
  page.locator("article", { has: page.getByRole("heading", { name: title, exact: true }) });

const nav = (page: Page) => page.getByRole("navigation", { name: "这一页的每一条" });

const at = (page: Page) => new URL(page.url()).searchParams.get("item");

export const scene: Scene = {
  scene: "S23",
  setup: (w) => {
    started(w);
    expectRun(w.ploop(["mainline", "push"]), 0);
    for (const content of ["逐屏查每一块的说明", "逐屏查备注框的叫法", "逐屏查提交前的确认"]) {
      expectRun(w.ploop(["queue", "add", content, "--stage", "检查"]), 0);
    }
    expectRun(w.ploop(["round", "start", "检查"]), 0);
    w.write(`${workspace}/page.json`, JSON.stringify(page));
    w.write(`${workspace}/img/block.png`, solidPng(240, 150, [0, 102, 219]));
    w.write(`${workspace}/img/confirm.png`, solidPng(240, 150, [21, 128, 61]));
    expectRun(w.ploop(["page", "present"]), 0, "给出了：第 1 版的检查阶段的第 1 页");
    w.memo.set("path", `/p/${projectId(w)}/r/${encodeURIComponent("v1-检查-1")}`);
  },
  steps: [
    {
      do: "打开检查阶段的页",
      expect: "页头写第几版的检查阶段和状态。左边一栏列出每张发现问题的卡，一张一行。",
      run: async (w) => {
        const page = await openPage(w, w.memo.get("path") as string);
        w.memo.set("page", page);
        await page.getByRole("heading", { name: "第 1 版的检查阶段" }).waitFor();
        await page.getByText("等用户回复", { exact: true }).first().waitFor();
        // 左边一栏：每张卡一行，标题就是卡的标题，三张各一行。
        for (const card of cards) {
          const entries = nav(page).getByRole("button", { name: card.title });
          await entries.first().waitFor();
          check((await entries.count()) === 1, `左边一栏里「${card.title}」不是一行`);
        }
        await nav(page).getByText("发现问题", { exact: true }).waitFor();
      },
    },
    {
      do: "读一张卡",
      expect:
        "卡头写「发现问题」，和它属于必要性、认知一致性、交互一致性哪一类。下面依次是问题、来源和证据。",
      run: async (w) => {
        const page = w.memo.get("page") as Page;
        await nav(page).getByRole("button", { name: "块名下面的说明" }).click();
        await page.getByRole("heading", { name: "块名下面的说明" }).waitFor();
        const head = cardOf(page, "块名下面的说明").locator("header");
        const label = (await head.innerText()).replaceAll("\n", " ");
        check(label.includes("发现问题") && label.includes("必要性"), `卡头写的是「${label}」`);
        // 三类各有一张卡，卡头写的是它自己的那一类。
        for (const card of cards.slice(1)) {
          await nav(page).getByRole("button", { name: card.title }).click();
          await page.getByRole("heading", { name: card.title }).waitFor();
          const own = (await cardOf(page, card.title).locator("header").innerText()).replaceAll(
            "\n",
            " ",
          );
          check(
            own.includes("发现问题") && own.includes(card.tag),
            `「${card.title}」的卡头写的是「${own}」`,
          );
        }
        // 下面依次是问题、来源、证据：三个小标题在页面上从上到下的先后。
        await nav(page).getByRole("button", { name: "块名下面的说明" }).click();
        await page.getByRole("heading", { name: "块名下面的说明" }).waitFor();
        const tops: number[] = [];
        for (const name of ["问题", "来源", "证据"]) {
          const box = await cardOf(page, "块名下面的说明")
            .locator("p", { hasText: new RegExp(`^${name}$`, "u") })
            .first()
            .boundingBox();
          check(box !== null, `卡上没有「${name}」这一块`);
          tops.push(box?.y ?? 0);
        }
        check(
          tops[0] !== undefined &&
            tops[1] !== undefined &&
            tops[2] !== undefined &&
            tops[0] < tops[1] &&
            tops[1] < tops[2],
          `问题、来源、证据的先后不对：${tops.join("、")}`,
        );
      },
    },
    {
      do: "看证据里的问题出现的位置",
      expect: "写场景的名字、这一步做什么、该看到什么，和第几步共几步。文字和主线里那一步一致。",
      run: async (w) => {
        const page = w.memo.get("page") as Page;
        const main = mainlineStep(places[0]);
        const where = cardOf(page, "块名下面的说明")
          .locator("section", { hasText: "出现位置" })
          .last();
        await where.waitFor();
        await where.scrollIntoViewIfNeeded();
        const text = await where.innerText();
        check(text.includes("S3 逐条点选项并提交"), `没有写场景的名字：${text}`);
        check(
          text.includes(main.do),
          `这一步做什么和主线不同，主线写「${main.do}」，页上：${text}`,
        );
        check(
          text.includes(`该看到：${main.expect}`),
          `该看到什么和主线不同，主线写「${main.expect}」，页上：${text}`,
        );
        check(
          text.includes(`第 ${places[0]} 步，共 ${main.count} 步`),
          `没有写第几步共几步：${text}`,
        );
      },
    },
    {
      do: "看选项",
      expect: "两到三个选项按行对照，共同的部分只写一遍。最后是我的看法和理由。",
      run: async (w) => {
        const page = w.memo.get("page") as Page;
        // 两个选项的卡和三个选项的卡，都按行对照：左边一列行名，每个选项一列。
        const counts: number[] = [];
        for (const card of cards) {
          await nav(page).getByRole("button", { name: card.title }).click();
          await page.getByRole("heading", { name: card.title }).waitFor();
          const own = cardOf(page, card.title);
          const options = await own.getByRole("radio").count();
          counts.push(options);
          check(options >= 2 && options <= 3, `「${card.title}」有 ${options} 个选项`);
          check(options === card.options.length, `「${card.title}」的选项数不对：${options}`);
          for (const row of [...card.rows, "理由", "代价"]) {
            check(
              (await own.getByText(row, { exact: true }).count()) > 0,
              `「${card.title}」的选项没有「${row}」这一行`,
            );
          }
          // 共同的部分只写一遍：卡上只出现一次，选项的格子里不重复。
          check(
            (await own.getByText(card.shared.text, { exact: true }).count()) === 1,
            `「${card.title}」的共同点不是只写了一遍`,
          );
          // 最后是我的看法和理由，在选项的下面。
          const stance = own.locator("dt", { hasText: "我的看法" });
          await stance.waitFor();
          const stanceBox = await stance.boundingBox();
          const lastOption = await own
            .getByRole("radio")
            .last()
            .locator("xpath=ancestor::label")
            .boundingBox();
          check(
            stanceBox !== null && lastOption !== null && stanceBox.y > lastOption.y,
            `「${card.title}」的我的看法不在选项下面`,
          );
          const reason = await own.locator("dt", { hasText: "理由" }).boundingBox();
          check(
            reason !== null && stanceBox !== null && reason.y > stanceBox.y,
            `「${card.title}」的理由不在我的看法后面`,
          );
        }
        check(
          counts.includes(2) && counts.includes(3),
          `选项数是 ${counts.join("、")}，两个和三个的卡都要有`,
        );
        await nav(page).getByRole("button", { name: "块名下面的说明" }).click();
        await page.getByRole("heading", { name: "块名下面的说明" }).waitFor();
      },
    },
    {
      do: "点 a",
      expect: "这个选项选中，左边这一张打勾，页面不自己走。",
      run: async (w) => {
        const page = w.memo.get("page") as Page;
        const before = at(page);
        await pick(page, /删掉说明/u);
        check(await page.getByRole("radio", { name: /删掉说明/u }).isChecked(), "选项没有选中");
        const entry = nav(page).getByRole("button", { name: "块名下面的说明" });
        await entry.getByLabel("已点").waitFor();
        await entry.getByText("选了「删掉说明」").waitFor();
        check(at(page) === before, `点了选项，页面自己走到了 ${at(page)}`);
      },
    },
    {
      do: "在另一张卡上不点选项，只写备注",
      expect: "备注保存，提交时这一张是回复的一行。",
      run: async (w) => {
        const page = w.memo.get("page") as Page;
        await nav(page).getByRole("button", { name: "备注框叫法不一" }).click();
        await page.getByRole("heading", { name: "备注框叫法不一" }).waitFor();
        const note = cardOf(page, "备注框叫法不一").getByPlaceholder("备注", { exact: true });
        await note.fill("先看有没有别的卡也这样叫");
        await page.getByText("点过的都已存下").waitFor();
        check(
          (await page.getByRole("radio", { checked: true }).count()) === 0,
          "另一张卡上的选项被点中了",
        );
        // 备注存在服务器上：换一个窗口打开这张卡，备注还在。
        const again = await openPage(w, `${w.memo.get("path")}?item=${at(page)}`);
        check(
          (await again.getByPlaceholder("备注", { exact: true }).inputValue()) ===
            "先看有没有别的卡也这样叫",
          "备注没有保存",
        );
        await again.close();
        show(w, page);
      },
    },
    {
      do: "点提交",
      expect:
        "提交区写「等 AI 取走」。AI 敲 ploop reply wait，收到每张卡一行，写卡的标题和选的选项。",
      run: async (w) => {
        const page = w.memo.get("page") as Page;
        // 第三张卡点「不改」：提交时有一张选了要改的，一张只有备注，一张选了不改的。
        await nav(page).getByRole("button", { name: "提交前的确认" }).click();
        await page.getByRole("heading", { name: "提交前的确认" }).waitFor();
        await pick(page, /不改/u);
        await page.getByText("点过的都已存下").waitFor();
        await page.getByRole("button", { name: "提交", exact: true }).click();
        await page.getByRole("dialog").getByRole("button", { name: "提交" }).click();
        await page.getByText("等 AI 取走").waitFor();
        const waited = w.ploop(["reply", "wait", "--timeout", "10"]);
        expectRun(
          waited,
          0,
          "收到了回复：第 1 版的检查阶段的第 1 页，3 行",
          "发现问题「块名下面的说明」",
          "发现问题「备注框叫法不一」",
          "发现问题「提交前的确认」",
        );
        // 每张卡一行：写卡的标题和选的选项，只有备注的那张写备注。
        const lines = waited.stdout.split("\n").filter((line) => line.startsWith("第 "));
        check(lines.length === 3, `收到的行不是三行：${lines.join("｜")}`);
        check(lines[0]?.includes("选了选项 a") === true, `第 1 行没有写选的选项：${lines[0]}`);
        check(
          lines[1]?.includes("先看有没有别的卡也这样叫") === true,
          `第 2 行没有写备注：${lines[1]}`,
        );
        check(lines[2]?.includes("选了选项 b") === true, `第 3 行没有写选的选项：${lines[2]}`);
      },
    },
    {
      do: "AI 敲 ploop reply handle",
      expect: "选了要改的填「队列」，标落地。选了不改的填「不处理」，写原因。",
      run: (w) => {
        // 选了要改的：放进队列，标落地。
        expectRun(
          w.ploop(["reply", "handle", "1", "队列", "删掉每一块名字下面的说明", "--stage", "落地"]),
          0,
          "队列",
        );
        // 只写了备注的那张：用户想先看有没有别的卡也这样叫，先不改，写原因。
        expectRun(
          w.ploop(["reply", "handle", "2", "不处理", "用户要先看别的卡，现在不改"]),
          0,
          "不处理",
        );
        // 选了不改的：不处理，写原因。
        expectRun(
          w.ploop(["reply", "handle", "3", "不处理", "用户选了不改，确认框照旧"]),
          0,
          "不处理",
        );
        const shown = w.ploop(["reply", "show"]);
        expectRun(shown, 0);
        check(
          shown.stdout.includes("队列") && shown.stdout.includes("不处理"),
          `每行的去处没有写出来：${shown.stdout}`,
        );
        const queue = w.ploop(["queue", "show", "Q4"]);
        expectRun(queue, 0, "删掉每一块名字下面的说明", "落地");
      },
    },
    {
      do: "AI 敲 ploop round start 落地",
      expect: "拿出来的事里有用户选中的那几件。",
      run: (w) => {
        // 检查阶段要先收尾，才能开始落地：三件要检查的事都查完了。
        expectRun(
          w.ploop([
            "round",
            "close",
            "--done",
            "Q1=查完了，块名下面的说明要改",
            "--done",
            "Q2=查完了，备注框的叫法先不改",
            "--done",
            "Q3=查完了，确认框不改",
          ]),
          0,
        );
        const opened = w.ploop(["round", "start", "落地"]);
        expectRun(opened, 0, "开始了：第 1 版的落地阶段", "删掉每一块名字下面的说明");
        check(
          !opened.stdout.includes("备注框的叫法") && !opened.stdout.includes("确认框"),
          `拿出来的事里有用户没选要改的：${opened.stdout}`,
        );
      },
    },
  ],
};
