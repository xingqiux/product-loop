import type { Page } from "playwright-core";
import { openPage, pick } from "../browser.ts";
import { check, expectRun, type Scene, started } from "../lib.ts";
import { projectId } from "../pages.ts";

// S24 提升阶段逐条点提升的卡和线稿。
// 谁在什么时候用：用户，落地做完一版，AI 站在整个产品上给出提升的页时。要定哪些功能留、加、删、重构、理清。
// 没有线稿，用户看不到改完的样子，只能凭文字猜。
// 摆的状态：开工，主线是这个软件自己的主线，直接开始提升阶段，给出一页三张卡：
// 加（线稿）、重构（操作流程）、删（只有一个方向，列出排除的方向）。

const improvements = {
  improvements: [
    {
      id: "queue-filter",
      title: "看板加筛选",
      tag: "加",
      why: "队列里的事多了，用户找不到当前阶段的事。补的是加分：没有筛选也能用，有了会被夸。用户在这一步想按阶段找事，现在做不了。",
      sources: [{ name: "用户昨天说的", saw: "「看队列要翻很久」", quote: true }],
      where: { scene: "S9", step: 1 },
      mock: '<div class="mk-top"><span class="mk-tab on">全部</span><span class="mk-tab">构思</span><span class="mk-tab">检查</span><span class="mk-tab">落地</span></div><div class="mk-cards"><div class="mk-card"><div class="mk-title">看板放到首页</div><div class="mk-sub">检查，待办</div></div></div>',
      mockCaption: "选 a 的样子，看板顶上多一排阶段",
      shared: { text: "两个方向都不改看板的五列。" },
      rows: ["筛选放哪里"],
      options: [
        {
          key: "a",
          title: "看板顶上一排",
          diffs: ["看板上方一排阶段名。"],
          why: "一眼看到，点一下就筛。",
          cost: "看板上方多一排。",
          when: "队列里的事经常超过十件。",
        },
        {
          key: "b",
          title: "并进项目页搜索",
          diffs: ["项目页的搜索框里写阶段名。"],
          why: "不加新东西，用已有的搜索。",
          cost: "要自己输入阶段名。",
          when: "队列里的事不多。",
        },
      ],
      stance: { pick: "a", because: "阶段是找事的第一个条件。" },
    },
    {
      id: "submit-flow",
      title: "提交的步骤",
      tag: "重构",
      why: "提交要点两次：先点提交，再在确认框里点提交。补的是欠债：绕了一步，用户会以为没点上。用户在这一步想一次提交，现在要点两次。",
      sources: [{ name: "用户昨天说的", saw: "「点了提交还要再点一次」", quote: true }],
      where: { scene: "S3", step: 8 },
      flow: ["点选项", "写备注", "点提交", "确认框点提交", "等 AI 取走"],
      shared: { text: "两个方向提交以后都不能再改。" },
      rows: ["确认在哪里"],
      options: [
        {
          key: "a",
          title: "确认写进提交区",
          diffs: ["提交按钮旁边写几条回复。"],
          why: "点一次就提交。",
          cost: "按错了没有后悔的机会。",
          when: "用户提交前都检查过。",
        },
        {
          key: "b",
          title: "保留确认框",
          diffs: ["点提交后弹出确认框。"],
          why: "提交前再看一眼。",
          cost: "多点一次。",
          when: "用户常常点错。",
        },
      ],
    },
    {
      id: "drop-proof",
      title: "删掉验证页",
      tag: "删",
      why: "开发时用的验证页留在代码里，发布出去的工作台没有它。补的是加分：删掉以后少维护一处，用户感觉不到。用户在这一步想看到找不到，现在也做得到。",
      sources: [{ name: "用户昨天说的", saw: "「这个页面是干什么用的」", quote: true }],
      where: { scene: "S1", step: 6 },
      only: true,
      rows: ["验证页"],
      options: [
        {
          key: "a",
          title: "删掉验证页",
          diffs: ["代码和地址一起去掉。"],
          why: "少维护一处。",
          cost: "开发时没有现成的验证页。",
        },
      ],
      dropped: [
        { name: "只在开发时打开", because: "发布时已经去掉，没有可改的。" },
        { name: "换成命令行自检", because: "命令行看不到版式的问题。" },
      ],
      stance: { pick: "a", because: "留着没有人用。" },
    },
  ],
};

/** 三张卡在左边一栏里的名字，和每张卡的标签。 */
const cards = [
  { title: "看板加筛选", tag: "加" },
  { title: "提交的步骤", tag: "重构" },
  { title: "删掉验证页", tag: "删" },
] as const;

/** 选中的那件事写进主线：S9 多一步（第 5 步）。 */
const addedStep = "5. 在看板顶上点一个阶段 → 看板只留这个阶段的小卡，点「全部」回到五列。";

const addedQueue = "看板顶上加阶段筛选";

const path = (w: { memo: Map<string, unknown> }) => w.memo.get("path") as string;

const nav = (page: Page) => page.getByRole("navigation", { name: "这一页的每一条" });

/** 一张卡的备注框：换屏时新旧两屏同时在页面上，按卡的标题圈出这一张。 */
const noteOf = (page: Page, title: string) =>
  page
    .locator("article", { has: page.getByRole("heading", { name: title, level: 2 }) })
    .getByPlaceholder("备注", { exact: true });

const open = (page: Page, title: string) => nav(page).getByRole("button", { name: title }).click();

export const scene: Scene = {
  scene: "S24",
  setup: (w) => {
    started(w);
    expectRun(w.ploop(["round", "start", "提升"]), 0, "开始了：第 1 版的提升阶段");
    w.write(".product-loop/rounds/v1-提升-1/page.json", JSON.stringify(improvements));
    expectRun(w.ploop(["page", "check"]), 0);
    expectRun(w.ploop(["page", "present"]), 0, "给出了：第 1 版的提升阶段的第 1 页");
    w.memo.set("path", `/p/${projectId(w)}/r/${encodeURIComponent("v1-提升-1")}`);
  },
  steps: [
    {
      do: "打开提升阶段的页",
      expect: "左边一栏列出每张提升的卡。每张卡的标签写它是留、加、删、重构、理清里的哪一种。",
      run: async (w) => {
        const page = await openPage(w, path(w));
        w.memo.set("page", page);
        await page.getByRole("heading", { name: "第 1 版的提升阶段" }).waitFor();
        // 左边一栏：分组叫「提升」，每张卡一行。
        const left = nav(page);
        await left.getByText("提升", { exact: true }).waitFor();
        for (const { title } of cards) await left.getByRole("button", { name: title }).waitFor();
        // 每张卡的标签写在标题旁边，逐张打开看。
        for (const { title, tag } of cards) {
          await open(page, title);
          await page.getByRole("heading", { name: title, level: 2 }).waitFor();
          await page.getByText(tag, { exact: true }).first().waitFor();
        }
        await open(page, cards[0].title);
      },
    },
    {
      do: "读一张卡",
      expect:
        "写它解决什么，补的是欠债还是加分。位置写在哪个场景的第几步，用户在这一步想做而做不了的是什么。",
      run: async (w) => {
        const page = w.memo.get("page") as Page;
        await open(page, cards[0].title);
        await page.getByRole("heading", { name: "看板加筛选", level: 2 }).waitFor();
        const text = await page.locator("main").innerText();
        check(text.includes("解决什么"), "卡上没有「解决什么」");
        check(text.includes("补的是加分"), "卡上没有写补的是欠债还是加分");
        // 位置：场景的名字、这一步做什么、第几步共几步，文字取自主线。
        await page.getByText("出现位置", { exact: true }).waitFor();
        check(text.includes("S9 看队列"), "位置里没有写场景的编号和名字");
        check(text.includes("在项目页点队列"), "位置里没有写这一步做什么");
        check(text.includes("第 1 步，共 4 步"), "位置里没有写第几步共几步");
        check(text.includes("想按阶段找事，现在做不了"), "没有写用户在这一步想做而做不了的是什么");
        // 另一张卡补的是欠债。
        await open(page, cards[1].title);
        await page.getByRole("heading", { name: "提交的步骤", level: 2 }).waitFor();
        check(
          (await page.locator("main").innerText()).includes("补的是欠债"),
          "第二张卡没有写欠债",
        );
      },
    },
    {
      do: "看选项",
      expect:
        "两到三个选项按行对照。选项从删掉、合并、换成已有的机制、不改里来，不成立的方向不写。",
      run: async (w) => {
        const page = w.memo.get("page") as Page;
        await open(page, cards[0].title);
        await page.getByRole("heading", { name: "看板加筛选", level: 2 }).waitFor();
        const radios = page.getByRole("radio");
        const count = await radios.count();
        check(count >= 2 && count <= 3, `选项有 ${count} 个，应当是两到三个`);
        // 按行对照：行名在左边只写一遍，每个选项逐行写。
        const group = page.getByRole("radiogroup");
        for (const row of ["筛选放哪里", "理由", "代价", "适用场景"]) {
          check(
            (await group.getByText(row, { exact: true }).count()) === 1,
            `「${row}」这一行不是只写了一遍`,
          );
        }
        for (const cell of ["看板上方一排阶段名。", "项目页的搜索框里写阶段名。"]) {
          await page.getByText(cell).waitFor();
        }
        // 共同的部分只写一遍。
        check(
          (await page.getByText("两个方向都不改看板的五列。").count()) === 1,
          "共同点写了不止一遍",
        );
        // 两个选项：加一排，和并进已有的搜索，后者是换成已有的机制。
        await page.getByRole("radio", { name: /看板顶上一排/u }).waitFor();
        await page.getByRole("radio", { name: /并进项目页搜索/u }).waitFor();
      },
    },
    {
      do: "看卡右边的线稿",
      expect: "用项目里的真文字画出改完的样子，下面有一句说明。它不是截图。",
      run: async (w) => {
        const page = w.memo.get("page") as Page;
        await open(page, cards[0].title);
        await page.getByRole("heading", { name: "看板加筛选", level: 2 }).waitFor();
        // 线稿是页面里的真文字：标签页、小卡都是可以选中的文字。
        await page.getByText("看板放到首页", { exact: true }).waitFor();
        await page.getByText("落地", { exact: true }).first().waitFor();
        await page.getByText("选 a 的样子，看板顶上多一排阶段", { exact: true }).waitFor();
        // 它不是截图：线稿在一个隔开样式的容器里，里面是文字，没有图片。
        const cell = page
          .getByText("选 a 的样子，看板顶上多一排阶段", { exact: true })
          .locator("xpath=..");
        await cell.getByText("看板放到首页", { exact: true }).waitFor();
        check((await cell.locator("img").count()) === 0, "线稿里有图片，应当是文字");
      },
    },
    {
      do: "看另一张卡的操作流程",
      expect: "每步一句，画成一串带箭头的步骤。",
      run: async (w) => {
        const page = w.memo.get("page") as Page;
        await open(page, cards[1].title);
        await page.getByRole("heading", { name: "提交的步骤", level: 2 }).waitFor();
        const steps = ["点选项", "写备注", "点提交", "确认框点提交", "等 AI 取走"];
        for (const step of steps) await page.getByText(step, { exact: true }).waitFor();
        // 五步之间有四个箭头，箭头是画出来的图标，不是字。
        const flow = page
          .locator("div", { has: page.getByText("确认框点提交", { exact: true }) })
          .last();
        check((await flow.locator("svg").count()) === steps.length - 1, "步骤之间不是四个箭头");
      },
    },
    {
      do: "看只有一个方向的卡",
      expect:
        "写着只有这一个方向，下面列出排除的方向和原因。用户点同意或否决，也能在备注里点名捞回排除的方向。",
      run: async (w) => {
        const page = w.memo.get("page") as Page;
        await open(page, cards[2].title);
        await page.getByRole("heading", { name: "删掉验证页", level: 2 }).waitFor();
        await page.getByText("只有这一个方向", { exact: true }).waitFor();
        // 排除的方向和原因：一行一个。
        await page.getByText("排除的方向", { exact: true }).waitFor();
        for (const line of [
          "只在开发时打开",
          "发布时已经去掉，没有可改的。",
          "换成命令行自检",
          "命令行看不到版式的问题。",
        ]) {
          await page.getByText(line, { exact: true }).waitFor();
        }
        // 用户点同意（这一个方向）或否决。
        await page.getByRole("radio", { name: /删掉验证页/u }).waitFor();
        await page.getByRole("radio", { name: "否决" }).waitFor();
        // 也能在备注里点名捞回排除的方向：备注框在，写了字能存下。
        const note = noteOf(page, cards[2].title);
        await note.fill("排除的「只在开发时打开」还要留着");
        await page.getByText("点过的都已存下").waitFor();
        await page.reload();
        await open(page, cards[2].title);
        check(
          (await noteOf(page, cards[2].title).inputValue()) === "排除的「只在开发时打开」还要留着",
          "备注刷新以后没有存下",
        );
        // 备注清空以后草稿又是空的：存完，「都已存下」不再写。
        await noteOf(page, cards[2].title).fill("");
        await page.getByText("点过的都已存下").waitFor({ state: "hidden" });
      },
    },
    {
      do: "点 a，另一张点否决，点提交",
      expect: "提交区写「等 AI 取走」。",
      run: async (w) => {
        const page = w.memo.get("page") as Page;
        await open(page, cards[0].title);
        await pick(page, /看板顶上一排/u);
        check(await page.getByRole("radio", { name: /看板顶上一排/u }).isChecked(), "a 没有选中");
        await open(page, cards[2].title);
        await pick(page, "否决");
        check(await page.getByRole("radio", { name: "否决" }).isChecked(), "否决没有选中");
        await page.getByText("点过的都已存下").waitFor();
        await page.getByRole("button", { name: "提交", exact: true }).click();
        const dialog = page.getByRole("dialog");
        const said = await dialog.innerText();
        check(said.includes("2 条回复"), `确认框没有写有几条回复：${said}`);
        check(said.includes("1 条没点"), `确认框没有写有几条没点：${said}`);
        await dialog.getByRole("button", { name: "提交" }).click();
        await page.getByText("等 AI 取走").waitFor();
      },
    },
    {
      do: "AI 先把选中的写进主线，再敲 ploop reply handle 填「队列」，写 --stage",
      expect: "队列里记了一件。它标着要做它的阶段。",
      run: async (w) => {
        // AI 取走回复：第 1 行是选了 a 的那张卡，第 2 行是否决的那张。
        const got = w.ploop(["reply", "wait", "--timeout", "10"]);
        expectRun(got, 0, "看板加筛选", "选了选项 a", "删掉验证页", "否决");
        // 先把选中的写进主线：S9 多一步（第 5 步），再交成新修订。
        const file = ".product-loop/主线.md";
        const mainline = w.read(file);
        const s9 = mainline.indexOf("### S9 看队列");
        const next = mainline.indexOf("### S10 ");
        check(s9 >= 0 && next > s9, "主线里找不到 S9");
        const scene9 = mainline.slice(s9, next).trimEnd();
        w.write(file, `${mainline.slice(0, s9)}${scene9}\n${addedStep}\n\n${mainline.slice(next)}`);
        expectRun(w.ploop(["mainline", "push"]), 0, "交上了：主线修订");
        // 交成了新的一次修订，和上一次比，多出来的就是选中的这一步。
        expectRun(w.ploop(["mainline", "history"]), 0, "次修订");
        expectRun(w.ploop(["mainline", "diff"]), 0, "在看板顶上点一个阶段");
        // 再填「队列」，写 --stage：选中的一件记进队列，标落地。否决的一行不处理。
        expectRun(w.ploop(["reply", "handle", "1", "队列", addedQueue, "--stage", "落地"]), 0);
        expectRun(w.ploop(["reply", "handle", "2", "不处理", "用户否决，验证页保留"]), 0);
        const list = w.ploop(["queue", "list"]);
        expectRun(list, 0, addedQueue, "落地");
        check(
          (list.stdout.match(new RegExp(addedQueue, "gu")) ?? []).length === 1,
          `队列里记的不是一件：${list.stdout}`,
        );
      },
    },
    {
      do: "AI 敲 ploop round start 构思",
      expect: "写「开始了：第 2 版的构思阶段」。选中的那几件已在主线的场景清单里。",
      run: async (w) => {
        // 提升阶段先收尾，下一步才是开始构思，命令同时换成新一版。
        expectRun(w.ploop(["round", "close"]), 0, "收尾了：第 1 版的提升阶段");
        expectRun(w.ploop(["round", "start", "构思"]), 0, "开始了：第 2 版的构思阶段");
        // 选中的事已经在主线的场景清单里：S9 多出来的第 5 步。
        const shown = w.ploop(["mainline", "show", "--text"]);
        expectRun(shown, 0, "在看板顶上点一个阶段");
        check(w.read(".product-loop/主线.md").includes(addedStep), "主线.md 里没有选中的那一步");
      },
    },
  ],
};
