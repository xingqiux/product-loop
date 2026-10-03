import { check, expectRun, type Scene, started } from "../lib.ts";
import { solidPng } from "../pages.ts";

// S15 开始一个阶段。AI，进入一个阶段时。只拿这个阶段的事，不成立的事不带上页。
// 不成立的事上了页，用户要白点一次。
// 摆的状态：队列里九件事，Q1 和 Q2 是检查的，Q3 到 Q9 是落地的；主线的场景清单只留 S1 一个场景，
// 使用阶段跑过一次，S1 的第 1 步截了一张图，所以检查阶段开始时，这一版有一屏是新出现的。
// 设计规范缺部分的项目在第 5 步里另开一个目录。

const queue = [
  ["设置页的保存按钮在窄屏被挡住", "检查"],
  ["看板的列在窄屏挤在一起", "检查"],
  ["队列页加筛选", "落地"],
  ["导出队列成表格", "落地"],
  ["项目页加搜索", "落地"],
  ["决定页加导出", "落地"],
  ["主线页加目录", "落地"],
  ["首页加排序", "落地"],
  ["先做导出再做排序", "落地"],
] as const;

const shot = solidPng(64, 40, [40, 120, 200]).toString("base64");

/** 被跑的使用代码：S1 一步，走通，带一张截图。 */
const script = `
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const out = process.env.PLOOP_USE_OUT;
mkdirSync(join(out, "screens"), { recursive: true });
writeFileSync(join(out, "screens", "S1-1-1440.png"), Buffer.from("${shot}", "base64"));
writeFileSync(join(out, "use-run.json"), JSON.stringify({
  schemaVersion: 1,
  scenes: [{ scene: "S1", steps: [{
    step: 1, width: 1440, do: "打开首页", expect: "每个项目一行。",
    result: "通过", screenshot: "screens/S1-1-1440.png",
  }] }],
}));
`;

const scenes = `## 4 场景清单

### S1 看所有项目停在哪

谁在什么时候用：用户，每天开工时。

1. 打开首页 → 每个项目一行。

`;

const workspace = ".product-loop/rounds/v1-检查-1";

/** 检查阶段的一页：只盖住 Q1，元素清单盖住 S1 的第 1 步。 */
const checkPage = {
  asks: [
    {
      queue: ["Q1"],
      title: "保存按钮被挡住",
      why: "窄屏下保存按钮落到了屏幕外面，要横着滚才看得到。",
      sources: [{ name: "设置页", saw: "保存按钮只露出一半。", img: "img/settings.png" }],
    },
  ],
  screens: [
    {
      name: "首页",
      where: { scene: "S1", step: 1 },
      elements: [{ what: "项目一行", answers: "写没写第几版" }],
    },
  ],
};

export const scene: Scene = {
  scene: "S15",
  setup: (w) => {
    started(w);
    // 主线的场景清单只留 S1，使用代码只要走这一个场景。
    const mainline = w.read(".product-loop/主线.md");
    const from = mainline.indexOf("## 4 场景清单");
    const to = mainline.indexOf("## 5 ");
    w.write(".product-loop/主线.md", mainline.slice(0, from) + scenes + mainline.slice(to));
    for (const [content, stage] of queue) {
      expectRun(w.ploop(["queue", "add", content, "--stage", stage]), 0);
    }
    w.write("scripts/use/run.mjs", script);
    w.write("scripts/use/覆盖表.md", "| 东西 | 场景 |\n| --- | --- |\n| 首页 | S1 |\n");
    expectRun(w.ploop(["round", "start", "使用"]), 0);
    expectRun(
      w.ploop(["use", "run", "--", "node", "scripts/use/run.mjs"]),
      0,
      "通过 1 步，断了 0 步",
    );
  },
  steps: [
    {
      do: "敲 ploop round start 检查",
      expect: "写「开始了：第 1 版的检查阶段」。逐件列出队列里检查的事，和这一版变过的屏。",
      run: (w) => {
        const start = w.ploop(["round", "start", "检查"]);
        expectRun(
          start,
          0,
          "开始了：第 1 版的检查阶段",
          "拿出来的事：",
          "Q1  设置页的保存按钮在窄屏被挡住",
          "Q2  看板的列在窄屏挤在一起",
          "这一版新出现或变过的屏",
          "S1 看所有项目停在哪",
          "第 1 步",
        );
        // 只拿检查的事，落地的事留在队列里。
        check(!start.stdout.includes("Q3  "), `检查阶段拿了落地的事：${start.stdout}`);
      },
    },
    {
      do: "逐件看拿出来的事，不成立的敲 ploop queue drop",
      expect: "必须写原因。这件事不上这个阶段的页，页上列在「取消的事」里。",
      run: async (w) => {
        expectRun(w.ploop(["queue", "drop", "Q2"]), 2, "--reason");
        expectRun(w.ploop(["queue", "show", "Q2"]), 0, "状态：进行中");
        expectRun(
          w.ploop(["queue", "drop", "Q2", "--reason", "看板已经改成一列"]),
          0,
          "取消了：Q2",
        );
        expectRun(
          w.ploop(["queue", "show", "Q2"]),
          0,
          "状态：已取消",
          "状态说明：看板已经改成一列",
        );
        // 给出这一页：只盖住 Q1，不用管 Q2；后端把 Q2 摆进页里的「取消的事」。
        w.write(`${workspace}/img/settings.png`, solidPng(64, 40, [200, 40, 40]));
        w.write(`${workspace}/page.json`, JSON.stringify(checkPage));
        expectRun(w.ploop(["page", "check"]), 0, "通过");
        expectRun(w.ploop(["page", "present"]), 0);
        const pid = "app";
        const round = (await w.api(
          "GET",
          `/projects/${pid}/rounds/${encodeURIComponent("v1-检查-1")}`,
        )) as { data: { pages: { id: number }[] } };
        const page = (await w.api("GET", `/projects/${pid}/pages/${round.data.pages[0]?.id}`)) as {
          data: {
            sections: { asks: { queue: string[] }[] };
            fill: { droppedAtStart: { id: string; content: string; reason: string }[] };
          };
        };
        check(
          page.data.sections.asks.every((ask) => !ask.queue.includes("Q2")),
          "取消的 Q2 还在页面的卡片里",
        );
        const dropped = page.data.fill.droppedAtStart;
        check(
          dropped.length === 1 &&
            dropped[0]?.id === "Q2" &&
            dropped[0].reason === "看板已经改成一列",
          `页上「取消的事」是 ${JSON.stringify(dropped)}`,
        );
      },
    },
    {
      do: "这件事要等别的事，敲 ploop round start 落地，加 --defer Q9=依赖",
      expect: "Q9 变成等待，写着依赖。队列看板上它放在五列上面。",
      run: async (w) => {
        const pid = "app";
        // 开落地阶段以前，先把检查阶段收尾：撤回还在等的页，Q1 退回队列。
        expectRun(w.ploop(["page", "withdraw", "--reason", "先不看这一页"]), 0);
        expectRun(w.ploop(["round", "close", "--return", "Q1=下一次检查再看"]), 0);
        const start = w.ploop(["round", "start", "落地", "--defer", "Q9=依赖"]);
        expectRun(
          start,
          0,
          "开始了：第 1 版的落地阶段",
          "改成等待的事：",
          "Q9  先做导出再做排序（等：依赖）",
        );
        for (const id of ["Q3", "Q4", "Q5", "Q6", "Q7", "Q8"]) {
          check(start.stdout.includes(`${id}  `), `落地阶段没有拿 ${id}`);
        }
        expectRun(w.ploop(["queue", "show", "Q9"]), 0, "状态：等待", "依赖：依赖");
        expectRun(w.ploop(["queue", "list"]), 0, "Q9  等待    落地  先做导出再做排序");
        // 队列看板上它放在五列上面：看板的数据里，等待的事单独一组，不在五列的任何一列里。
        // 看板画出来的样子在浏览器里看，见 S9 的第 1 步。
        const board = (await w.api("GET", `/projects/${pid}/queue/board`)) as {
          data: {
            waiting: { id: string; dependsOn: string }[];
            columns: { items: { id: string }[] }[];
          };
        };
        check(
          board.data.waiting.length === 1 &&
            board.data.waiting[0]?.id === "Q9" &&
            board.data.waiting[0].dependsOn === "依赖",
          `看板上等待的事是 ${JSON.stringify(board.data.waiting)}`,
        );
        check(
          board.data.columns.every((column) => column.items.every((item) => item.id !== "Q9")),
          "等待的 Q9 又出现在五列里",
        );
      },
    },
    {
      do: "同一个项目已有一个阶段开着时再开",
      expect: "退出码 3。写明开着的是哪个阶段、什么时候开的、怎么收尾。",
      run: (w) => {
        const run = w.ploop(["round", "start", "检查"]);
        expectRun(run, 3, "第 1 版的落地阶段还没收尾", "ploop round close");
        check(
          /在 \d{4}-\d{2}-\d{2} \d{2}:\d{2} 开始/u.test(run.stderr),
          `没有写什么时候开的：${run.stderr}`,
        );
      },
    },
    {
      do: "设计规范还缺部分时开检查阶段",
      expect: "退出码 1。写明缺几个部分，和怎么补。",
      run: (w) => {
        // 另一个项目：刚开工，主线只有模板标题，设计规范的十二个部分一个都没写。
        const fresh = "../fresh";
        w.write(`${fresh}/.keep`, "");
        expectRun(w.ploop(["init", "--repo", "自己的"], `${w.root}/${fresh}`), 0);
        expectRun(
          w.ploop(["round", "start", "检查"], `${w.root}/${fresh}`),
          1,
          "设计规范缺 12 个部分",
          "ploop mainline check",
          "mainline.spec.twelve",
        );
      },
    },
    {
      do: "等的事等到了，取消的事要再做，敲 ploop queue reopen",
      expect: "事项改回待办，编号不变。等待的事不再放在看板五列上面，回到它的阶段那一列。",
      run: async (w) => {
        const pid = "app";
        // 现在 Q9 是等待，Q2 是已取消。两件都改回待办。
        expectRun(w.ploop(["queue", "show", "Q9"]), 0, "状态：等待");
        expectRun(w.ploop(["queue", "show", "Q2"]), 0, "状态：已取消");
        expectRun(
          w.ploop(["queue", "reopen", "Q9", "--reason", "依赖的事做完了"]),
          0,
          "改回待办：Q9",
          "先做导出再做排序",
        );
        expectRun(
          w.ploop(["queue", "reopen", "Q2", "--reason", "用户改主意了"]),
          0,
          "改回待办：Q2",
          "看板的列在窄屏挤在一起",
        );
        // 编号不变，内容不变，状态是待办。
        expectRun(w.ploop(["queue", "show", "Q9"]), 0, "Q9：先做导出再做排序", "状态：待办");
        expectRun(w.ploop(["queue", "show", "Q2"]), 0, "Q2：看板的列在窄屏挤在一起", "状态：待办");
        expectRun(
          w.ploop(["queue", "list"]),
          0,
          "Q9  待办    落地  先做导出再做排序",
          "Q2  待办    检查  看板的列在窄屏挤在一起",
        );
        // 等待的事不再放在五列上面，回到它的阶段那一列。
        const board = (await w.api("GET", `/projects/${pid}/queue/board`)) as {
          data: {
            waiting: { id: string }[];
            columns: { stage: string; items: { id: string }[] }[];
          };
        };
        check(
          board.data.waiting.every((item) => item.id !== "Q9"),
          `Q9 还放在五列上面：${JSON.stringify(board.data.waiting)}`,
        );
        const land = board.data.columns.find((column) => column.stage === "落地");
        check(
          land?.items.some((item) => item.id === "Q9") === true,
          `落地那一列里没有 Q9：${JSON.stringify(land)}`,
        );
        const inspect = board.data.columns.find((column) => column.stage === "检查");
        check(
          inspect?.items.some((item) => item.id === "Q2") === true,
          `检查那一列里没有 Q2：${JSON.stringify(inspect)}`,
        );
      },
    },
  ],
};
