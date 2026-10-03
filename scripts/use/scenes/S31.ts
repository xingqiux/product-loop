import type { Page } from "playwright-core";
import { openPage, pickFirstEverywhere, show } from "../browser.ts";
import { check, expectRun, type Scene, type World } from "../lib.ts";
import { solidPng } from "../pages.ts";

// S31 一版从构思走到提升。用户和 AI 一起，在一个新项目里把第 1 版从头走到尾。
// 命令行的部分 AI 敲，工作台的部分用户点：构思、检查、验收、提升四页由用户点选项并提交。
// 项目在第一步才开工，第一步以前只有一个临时的 git 仓库，里面有一个先失败后通过的小改动要做。
// 有窗口的步骤是用户在工作台点的那几步，每步截 1440 和 700 两个宽度；别的步骤是命令行，没有屏。

const think = ".product-loop/rounds/v1-构思-1";
const check1 = ".product-loop/rounds/v1-检查-1";
const land = ".product-loop/rounds/v1-落地-1";
const improve = ".product-loop/rounds/v1-提升-1";

const checkScript = [
  'import { readFileSync } from "node:fs";',
  'process.exit(readFileSync("board.txt", "utf8").includes("第一屏") ? 0 : 1);',
  "",
].join("\n");

/** 主线的十个部分，第 4 部分是场景清单。 */
const parts = [
  ["1 一句话新闻稿", "看板放到首页，用户一眼看到每件事。"],
  ["2 给谁用", "用户：每天开工时看看板的人。"],
  ["3 要完成的任务", "看到还有哪些事没做。"],
  [
    "4 场景清单",
    [
      "### S1 看队列",
      "谁在什么时候用：用户，想知道还有哪些事没做时。",
      "1. 点队列 → 看到看板。",
      "2. 点一件事 → 右边摆出详情。",
    ].join("\n"),
  ],
  ["5 不做什么和胃口", "不做手机端。胃口：一周。"],
  ["6 交付线", "打开首页就看到看板。用 S1 验证。"],
  ["7 四个风险", "价值：用户不看看板。对策：放到首页。"],
  ["8 常见问题与待定", "待定：深色配色。问用户。"],
  ["9 事前验尸", "原因：看板太长。对策：只列五列。"],
] as const;

const specParts = [
  "信息结构",
  "配色",
  "字体排版",
  "布局",
  "交互",
  "动效",
  "图标和 SVG",
  "文案",
  "给 AI 的界面",
  "状态",
  "无障碍",
  "做法和阶段",
] as const;

/** 主线.md：前 written 个部分写了内容，后面的只有标题。十个都写时，设计规范的十二个部分也写。 */
function mainlineOf(written: number, extra = ""): string {
  const lines = ["# 主线", ""];
  for (const [i, [title, body]] of parts.entries()) {
    lines.push(`## ${title}`, "");
    if (i < written) lines.push(i === 3 ? `${body}${extra}` : body, "");
  }
  lines.push("## 10 设计规范", "");
  for (const name of specParts) {
    lines.push(`### ${name}`, "");
    if (written >= 10) lines.push("无，这个项目没有。", "");
  }
  return lines.join("\n");
}

/** 一步一步的使用代码：S1 两步，各在两个宽度下截图。broken 为真时第 2 步在 1440 下断了。 */
function useScript(broken: boolean): string {
  const shots = [
    ["a", [0, 102, 219]],
    ["b", [21, 128, 61]],
    ["c", [203, 70, 0]],
    ["d", [141, 141, 141]],
  ] as const;
  const files = shots
    .map(
      ([name, rgb]) =>
        `writeFileSync(join(out, "${name}.png"), Buffer.from("${solidPng(64, 40, rgb).toString("base64")}", "base64"));`,
    )
    .join("\n");
  const step2 = broken
    ? `{ step: 2, width: 1440, do: "点一件事", expect: "右边摆出详情。", result: "断了", error: "点一件事没有反应，右边没有详情", screenshot: "c.png" }`
    : `{ step: 2, width: 1440, do: "点一件事", expect: "右边摆出详情。", result: "通过", screenshot: "c.png" },
       { step: 2, width: 700, do: "点一件事", expect: "右边摆出详情。", result: "通过", screenshot: "d.png" }`;
  return `
import { writeFileSync } from "node:fs";
import { join } from "node:path";
const out = process.env.PLOOP_USE_OUT;
${files}
const run = {
  schemaVersion: 1,
  scenes: [{ scene: "S1", steps: [
    { step: 1, width: 1440, do: "点队列", expect: "看到看板。", result: "通过", screenshot: "a.png" },
    { step: 1, width: 700, do: "点队列", expect: "看到看板。", result: "通过", screenshot: "b.png" },
    ${step2},
  ] }],
};
writeFileSync(join(out, "use-run.json"), JSON.stringify(run));
`;
}

const coverageGap = [
  "| 东西 | 场景 |",
  "| --- | --- |",
  "| 队列看板 | S1 |",
  "| 看板的详情 | |",
].join("\n");
const coverageFull = [
  "| 东西 | 场景 |",
  "| --- | --- |",
  "| 队列看板 | S1 |",
  "| 看板的详情 | S1 |",
].join("\n");

/** 一张有两个选项的卡，点第一个。 */
function card(id: string, title: string, first: string, second: string) {
  return {
    id,
    title,
    why: "两种做法各有各的用处，要定一种。",
    sources: [{ name: "用户说的", saw: "「每次都要往下滚才看到看板」", quote: true }],
    shared: { text: "两种做法都保留五列看板。" },
    rows: ["怎么做"],
    options: [
      {
        key: "a",
        title: first,
        diffs: ["首页顶部。"],
        why: "打开就看得到。",
        cost: "首页上方的位置变少。",
        when: "每天开工都要看。",
      },
      {
        key: "b",
        title: second,
        diffs: ["首页最下面。"],
        why: "首页保持原样。",
        cost: "要往下滚。",
        when: "很少看看板。",
      },
    ],
  };
}

const thinkPage = { asks: [card("board-place", "看板放在哪里", "放到首页顶部", "留在最下面")] };

/** 检查页：一张发现问题的卡，选项 a 是要改的。元素清单盖住的屏由 covered 定。 */
function checkPage(covered: readonly number[]) {
  const finding = {
    ...card("board-hidden", "看板要往下滚才看到", "放到首页第一屏", "不改"),
    where: { scene: "S1", step: 2 },
  };
  // 最后一个「不改」不写理由、代价和适用场景。
  const [first, second] = finding.options;
  return {
    findings: [
      {
        ...finding,
        options: [first, { key: second?.key ?? "b", title: "不改", diffs: ["首页最下面。"] }],
      },
    ],
    screens: covered.map((step) => ({
      name: step === 1 ? "首页：看板" : "看板的详情",
      where: { scene: "S1", step },
      elements: [{ what: step === 1 ? "看板标题" : "详情卡片", answers: "这一块是什么" }],
    })),
  };
}

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

const acceptPage = {
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
  ],
};

const improvePage = {
  improvements: [
    {
      id: "board-filter",
      title: "看板加一个筛选",
      why: "事多的时候找不到当前阶段的事。",
      sources: [{ name: "用户说的", saw: "「事多了找不到」", quote: true }],
      where: { scene: "S1", step: 2 },
      only: true,
      rows: ["筛选"],
      options: [
        {
          key: "a",
          title: "按阶段筛选",
          diffs: ["看板上方一排阶段。"],
          why: "阶段是找事的第一个条件。",
          cost: "多一排按钮。",
        },
      ],
      dropped: [{ name: "按提出者筛选", because: "用户没有按提出者找过事。" }],
    },
  ],
};

/** 用户在工作台点完这一页的每一条，点提交，确认。ids 是每张卡的编号，选项点第一个。 */
async function answer(w: World, page: Page, round: string, ids: readonly string[]): Promise<void> {
  for (const id of ids) {
    await page.goto(w.url(`/p/app/r/${encodeURIComponent(round)}?item=${id}`));
    await page.locator("main [role=radiogroup]").first().waitFor();
    await pickFirstEverywhere(page);
  }
  await page.getByText("点过的都已存下").waitFor();
  check(
    (await page.getByRole("button", { name: /看未点的 \d+ 条/u }).count()) === 0,
    "点完了，还有未点的",
  );
  await page.getByRole("button", { name: "提交", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "提交" }).click();
  await page.getByText("等 AI 取走").waitFor();
}

/** reply show 里每一行回复下面都写着去处：行数和「去处：」的个数相同，而且不是 0。 */
function everyRowHasPlace(shown: string): void {
  const rows = shown.split("\n").filter((line) => /^第 \d+ 行/u.test(line)).length;
  const places = shown.split("\n").filter((line) => line.startsWith("  去处：")).length;
  check(rows > 0 && rows === places, `回复有 ${rows} 行，写了去处的有 ${places} 行：${shown}`);
}

/** 没有浏览器的步骤：放掉上一步的窗口，截图就不会是别的步骤的样子。 */
function noScreen(w: World): void {
  w.frame.current = undefined;
}

export const scene: Scene = {
  scene: "S31",
  setup: (w) => {
    w.git("init", "-q");
    w.write("check.mjs", checkScript);
    w.write("board.txt", "看板在第二屏\n");
    w.git("add", "-A");
    w.git("commit", "-q", "-m", "起点");
  },
  steps: [
    {
      do: "在新项目里敲 ploop init --repo 自己的，再敲 ploop round start 构思",
      expect: "写「开始了：第 1 版的构思阶段」。同时写主线缺几个部分。",
      run: (w) => {
        noScreen(w);
        expectRun(w.ploop(["init", "--repo", "自己的"]), 0, "开工了：项目 app");
        w.git("add", "-A");
        w.git("commit", "-q", "-m", "忽略项目缓存");
        expectRun(
          w.ploop(["round", "start", "构思"]),
          0,
          "开始了：第 1 版的构思阶段",
          "主线缺 10 个部分",
        );
      },
    },
    {
      do: "补齐主线的十个部分，敲 ploop mainline push，给出构思的页，用户点完提交，AI 处理",
      expect: "回复的每一行有去处。",
      run: async (w) => {
        w.write(".product-loop/主线.md", mainlineOf(10));
        expectRun(w.ploop(["mainline", "check"]), 0, "主线：10 个部分齐全");
        expectRun(w.ploop(["mainline", "push"]), 0, "交上了：主线修订 2");
        w.write(`${think}/page.json`, JSON.stringify(thinkPage));
        expectRun(w.ploop(["page", "present"]), 0, "给出了：第 1 版的构思阶段的第 1 页");
        const page = await openPage(w, `/p/app/r/${encodeURIComponent("v1-构思-1")}`);
        w.memo.set("page", page);
        await answer(w, page, "v1-构思-1", ["board-place"]);
        expectRun(
          w.ploop(["reply", "wait", "--timeout", "10"]),
          0,
          "收到了回复：第 1 版的构思阶段的第 1 页，1 行",
          "选了选项 a",
        );
        expectRun(w.ploop(["reply", "handle", "1", "不处理", "已经写进主线的第 1 部分"]), 0);
        // 回复的每一行有去处：reply show 里每一行都写着去处。
        const shown = w.ploop(["reply", "show"]);
        expectRun(shown, 0, "第 1 行", "还没处理 0 行");
        everyRowHasPlace(shown.stdout);
        await page.getByText("AI 已收到").waitFor({ timeout: 10_000 });
      },
    },
    {
      do: "主线还缺部分时敲 ploop round close",
      expect: "被拦截，写明缺哪几个部分。补齐后收尾成功，下一步写开始使用。",
      run: (w) => {
        noScreen(w);
        const full = w.read(".product-loop/主线.md");
        // 主线被改回只剩三个部分：像合并时丢了后面的部分。交上去以后收尾要被拦住。
        w.write(".product-loop/主线.md", mainlineOf(3));
        expectRun(w.ploop(["mainline", "push"]), 0, "交上了：主线修订 3");
        const blocked = w.ploop(["round", "close"]);
        expectRun(
          blocked,
          1,
          "拦截：主线十个部分只写了 3 个，缺 7 个，第 1 版的构思阶段不能收尾。",
          "规矩：think.leave",
        );
        // 拦截里写明缺哪几个部分：逐个写出名字，和 mainline check 列的一致。
        const names = [
          "场景清单",
          "不做什么和胃口",
          "交付线",
          "四个风险",
          "常见问题与待定",
          "事前验尸",
          "设计规范",
        ];
        for (const name of names) {
          check(
            blocked.stderr.includes(name),
            `收尾的拦截里没有写缺「${name}」：${blocked.stderr}`,
          );
        }
        const missing = w.ploop(["mainline", "check"]);
        expectRun(missing, 0, "主线缺 7 个部分：");
        for (const name of names) {
          check(missing.stdout.includes(name), `mainline check 没有写缺「${name}」`);
        }
        // 补齐以后收尾成功。
        w.write(".product-loop/主线.md", full);
        expectRun(w.ploop(["mainline", "push"]), 0, "交上了：主线修订 4");
        const closed = w.ploop(["round", "close"]);
        expectRun(closed, 0, "收尾了：第 1 版的构思阶段", "ploop round start 使用");
      },
    },
    {
      do: "敲 ploop round start 使用，再敲 ploop use run",
      expect: "使用代码逐个场景运行。有断点或覆盖缺口时，ploop round close 被拦截。",
      run: (w) => {
        noScreen(w);
        expectRun(w.ploop(["round", "start", "使用"]), 0, "开始了：第 1 版的使用阶段");
        w.write("scripts/use/run.mjs", useScript(true));
        w.write("scripts/use/覆盖表.md", coverageGap);
        const ran = w.ploop(["use", "run", "--", "node", "scripts/use/run.mjs"]);
        expectRun(ran, 1, "断了 1 步", "S1 第 2 步");
        const blocked = w.ploop(["round", "close"]);
        expectRun(blocked, 1, "规矩：use.leave");
        check(/断点|断了/u.test(blocked.stderr + blocked.stdout), "没有写有断点");
        check(/缺口|没有场景用到/u.test(blocked.stderr + blocked.stdout), "没有写覆盖表的缺口");
      },
    },
    {
      do: "修好断点，补齐缺口，给出使用阶段的页，敲 ploop round close",
      expect: "页只给用户看，收尾成功。",
      run: async (w) => {
        w.write("scripts/use/run.mjs", useScript(false));
        w.write("scripts/use/覆盖表.md", coverageFull);
        const ran = w.ploop(["use", "run", "--", "node", "scripts/use/run.mjs"]);
        expectRun(
          ran,
          0,
          "通过 4 步，断了 0 步",
          "缺口 0 行",
          "给用户看了一页使用记录：第 1 页，不等回复",
        );
        // 没有断点也没有缺口，使用阶段的页由后端自己给出，页只给用户看。
        const page = w.memo.get("page") as Page;
        await page.goto(w.url(`/p/app/r/${encodeURIComponent("v1-使用-1")}`));
        show(w, page);
        await page.getByRole("heading", { name: "第 1 版的使用阶段" }).waitFor();
        // 使用区块在「使用」这一屏：走通的场景一行写「走通」；页上没有输入框和提交。
        await page
          .getByRole("navigation", { name: "这一页的每一条" })
          .getByRole("button", { name: "使用" })
          .click();
        await page.getByText("走通").first().waitFor();
        const main = await page.locator("main").innerText();
        check(main.includes("S1"), `使用阶段的页上没有写 S1：${main.slice(0, 200)}`);
        check((await page.getByRole("textbox").count()) === 0, "使用阶段的页有输入框");
        check(
          (await page.getByRole("button", { name: "提交", exact: true }).count()) === 0,
          "使用阶段的页有提交",
        );
        w.git("add", "-A");
        w.git("commit", "-q", "-m", "使用代码");
        expectRun(w.ploop(["round", "close"]), 0, "收尾了：第 1 版的使用阶段");
        expectRun(w.ploop(["round", "show", "第 1 版的使用阶段"]), 0, "第 1 页，只看，已给出");
      },
    },
    {
      do: "敲 ploop round start 检查",
      expect:
        "列出这一版变过的屏。检查页没盖住变过的屏时，ploop page present 被拦截，列出没盖住的屏。",
      run: (w) => {
        noScreen(w);
        const started = w.ploop(["round", "start", "检查"]);
        expectRun(started, 0, "开始了：第 1 版的检查阶段", "S1");
        w.write(`${check1}/page.json`, JSON.stringify(checkPage([1])));
        const blocked = w.ploop(["page", "present"]);
        expectRun(blocked, 1, "规矩：screens.coverChanged");
        check(
          /S1.*第 2 步|第 2 步/u.test(blocked.stderr + blocked.stdout),
          "没有列出没盖住的第 2 步",
        );
      },
    },
    {
      do: "盖住以后给出检查的页，用户点完提交，AI 处理",
      expect: "选了要改的进队列，标落地。",
      run: async (w) => {
        w.write(`${check1}/page.json`, JSON.stringify(checkPage([1, 2])));
        expectRun(w.ploop(["page", "present"]), 0, "给出了：第 1 版的检查阶段的第 1 页");
        const page = w.memo.get("page") as Page;
        await answer(w, page, "v1-检查-1", ["board-hidden"]);
        show(w, page);
        expectRun(w.ploop(["reply", "wait", "--timeout", "10"]), 0, "选了选项 a");
        expectRun(
          w.ploop(["reply", "handle", "1", "队列", "看板放到首页", "--stage", "落地"]),
          0,
          "Q1",
        );
        expectRun(w.ploop(["queue", "list"]), 0, "Q1  待办  落地  看板放到首页");
        expectRun(w.ploop(["round", "close"]), 0, "收尾了：第 1 版的检查阶段");
      },
    },
    {
      do: "敲 ploop round start 落地，改完，给出验收页，用户认可每一条",
      expect: "每件做完，代码提交，ploop round close 成功。",
      run: async (w) => {
        expectRun(
          w.ploop(["round", "start", "落地"]),
          0,
          "开始了：第 1 版的落地阶段",
          "Q1  看板放到首页",
        );
        w.write(`${land}/计划.md`, plan);
        expectRun(w.ploop(["land", "plan"]), 0, "交了计划");
        expectRun(w.ploop(["land", "tidy", "--skip"]), 0, "跳过了重构");
        expectRun(
          w.ploop(["land", "red", "看板放到首页", "--", "node", "check.mjs"]),
          0,
          "记了失败：看板放到首页，退出码 1",
        );
        w.write("board.txt", "看板在第一屏\n");
        w.git("add", "-A");
        w.git("commit", "-q", "-m", "看板放到首页\n\n阶段: 第 1 版的落地阶段\n队列: Q1");
        expectRun(
          w.ploop(["land", "green", "看板放到首页", "--", "node", "check.mjs"]),
          0,
          "记了通过：看板放到首页",
        );
        expectRun(w.ploop(["land", "review", "--skip", "只改了一行"]), 0, "跳过了评审");
        w.write(`${land}/img/before.png`, solidPng(1400, 875, [220, 220, 220]));
        w.write(`${land}/img/after.png`, solidPng(1400, 875, [0, 102, 219]));
        w.write(`${land}/page.json`, JSON.stringify(acceptPage));
        expectRun(w.ploop(["page", "present"]), 0, "给出了：第 1 版的落地阶段的第 1 页");
        const page = w.memo.get("page") as Page;
        await answer(w, page, "v1-落地-1", ["board-first", "board-copy"]);
        show(w, page);
        expectRun(w.ploop(["reply", "wait", "--timeout", "10"]), 0, "认可一条更改");
        // 认可的每一条，后端已经记成不处理；没有还要处理的行，收尾不被拦。
        const shown = w.ploop(["reply", "show"]);
        expectRun(shown, 0, "认可一条更改", "还没处理 0 行");
        everyRowHasPlace(shown.stdout);
        // 每件做完，代码提交：工作区里没有没提交的文件，改动在提交里。
        check(w.git("status", "--porcelain").trim() === "", "落地收尾前还有没提交的文件");
        check(w.git("log", "--oneline").includes("看板放到首页"), "改动没有提交");
        expectRun(
          w.ploop(["round", "close", "--done", "Q1=看板放到首页"]),
          0,
          "收尾了：第 1 版的落地阶段",
          "Q1  做完  看板放到首页",
        );
      },
    },
    {
      do: "敲 ploop round start 提升，用户点完提交，AI 处理",
      expect: "选中的写进主线，队列里记了一件。",
      run: async (w) => {
        expectRun(w.ploop(["round", "start", "提升"]), 0, "开始了：第 1 版的提升阶段");
        w.write(`${improve}/page.json`, JSON.stringify(improvePage));
        expectRun(w.ploop(["page", "present"]), 0, "给出了：第 1 版的提升阶段的第 1 页");
        const page = w.memo.get("page") as Page;
        await answer(w, page, "v1-提升-1", ["board-filter"]);
        show(w, page);
        expectRun(w.ploop(["reply", "wait", "--timeout", "10"]), 0);
        // 选中的先写进主线：场景清单里多一个场景。
        w.write(
          ".product-loop/主线.md",
          mainlineOf(
            10,
            [
              "",
              "### S2 按阶段筛选看板",
              "谁在什么时候用：用户，看板上的事多了以后。",
              "1. 点一个阶段 → 看板只留这个阶段的事。",
            ].join("\n"),
          ),
        );
        expectRun(w.ploop(["mainline", "push"]), 0, "交上了：主线修订 5");
        const handled = w.ploop([
          "reply",
          "handle",
          "1",
          "队列",
          "看板加按阶段筛选",
          "--stage",
          "构思",
        ]);
        expectRun(handled, 0, "放进队列 Q2：看板加按阶段筛选", "这份回复的每一行都有了去处。");
        check(
          w.read(".product-loop/主线.md").includes("### S2 按阶段筛选看板"),
          "选中的没有写进主线",
        );
        expectRun(
          w.ploop(["queue", "list"]),
          0,
          "列出了 1 件事：",
          "Q2  待办  构思  看板加按阶段筛选",
        );
        expectRun(w.ploop(["round", "close"]), 0, "收尾了：第 1 版的提升阶段");
      },
    },
    {
      do: "敲 ploop round start 构思",
      expect: "写「开始了：第 2 版的构思阶段」。第 1 版结束，它的阶段都留在第 1 版。",
      run: async (w) => {
        expectRun(
          w.ploop(["round", "start", "构思"]),
          0,
          "开始了：第 2 版的构思阶段",
          "进入了第 2 版，第 1 版已结束",
        );
        // 现在是第 2 版，第 1 版已经结束。
        expectRun(w.ploop(["version", "show"]), 0, "第 2 版：进行中");
        const list = w.ploop(["round", "list"]);
        expectRun(list, 0, "第 2 版", "第 2 版的构思阶段");
        check(!list.stdout.includes("第 1 版的"), "第 1 版的阶段跑到了第 2 版里");
        // 第 1 版的五个阶段都留在第 1 版，各自收尾了。
        for (const stage of ["构思", "使用", "检查", "落地", "提升"]) {
          expectRun(w.ploop(["round", "show", `第 1 版的${stage}阶段`]), 0, "已收尾");
        }
        const page = w.memo.get("page") as Page;
        await page.goto(w.url("/p/app"));
        show(w, page);
        await page.getByRole("link", { name: "第 1 版的提升阶段", exact: true }).waitFor();
        await page.getByRole("link", { name: "第 2 版的构思阶段", exact: true }).waitFor();
      },
    },
  ],
};
