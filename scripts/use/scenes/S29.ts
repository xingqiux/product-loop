import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Page } from "playwright-core";
import { openPage, pick, show } from "../browser.ts";
import { check, expectRun, pause, type Run, type Scene, started } from "../lib.ts";
import { presentAsk, projectIdIn } from "../pages.ts";

// S29 多个项目同时有页在等。用户，两个项目的 AI 差不多同时给出页，回来一看都在等自己时。
// 三个项目：app（w.root）和 beta 各给出一页等回复，gamma 给出使用阶段的页，那一页只看。
// 项目在 setup 里开工，给出页放在步骤里，这样每一步敲过的命令都记进使用记录。
// 每个项目的会话，就是在它的根目录里敲命令，或者写 --project 指定它。

type Waiting = { readonly done: Promise<Run>; readonly running: () => boolean };
type Finished = { readonly run: Run; readonly at: number };

/** 使用阶段的项目 gamma：主线只有一个场景，使用代码走通它，覆盖表没有缺口，运行以后后端自己给出一页只看的页。 */
const gammaMainline = [
  "# 主线",
  "",
  "## 场景清单",
  "",
  "### S1 看队列",
  "谁在什么时候用：用户，想知道还有哪些事没做时。",
  "1. 点队列 → 看到看板。",
  "",
].join("\n");

const gammaScript = `
import { writeFileSync } from "node:fs";
import { join } from "node:path";
const run = {
  schemaVersion: 1,
  scenes: [{ scene: "S1", steps: [{ step: 1, do: "点队列", expect: "看到看板。", result: "通过" }] }],
};
writeFileSync(join(process.env.PLOOP_USE_OUT, "use-run.json"), JSON.stringify(run));
`;

const gammaCoverage = ["| 东西 | 场景 |", "| --- | --- |", "| 队列看板 | S1 |"].join("\n");

/** 首页每一行的文字，按从上到下的顺序。 */
async function rowsOf(page: Page): Promise<string[]> {
  await page.locator("tbody tr").first().waitFor();
  return page.locator("tbody tr").allInnerTexts();
}

/** 首页的行按项目名排成一串。 */
const namesOf = (rows: readonly string[]) =>
  rows.map(
    (row) => ["app", "beta", "gamma"].find((name) => row.startsWith(name)) ?? row.slice(0, 8),
  );

export const scene: Scene = {
  scene: "S29",
  setup: (w) => {
    started(w);
    const mainline = w.read(".product-loop/主线.md");
    for (const name of ["beta", "gamma"]) {
      w.write(`../${name}/.keep`, "");
      expectRun(w.ploop(["init", "--repo", "自己的"], join(w.root, "..", name)), 0);
      w.write(`../${name}/.product-loop/主线.md`, name === "gamma" ? gammaMainline : mainline);
    }
  },
  steps: [
    {
      do: "两个项目各给出一页，打开首页",
      expect:
        "这两个项目排在最前，都写「等用户回复」。各有「打开这一页」，顶上写有几个项目有页在等。",
      run: async (w) => {
        const app = presentAsk(w, ".", "队列看板放在哪里");
        // 两个项目给出页的时间隔开，最近改动的先后才分得出来。
        await pause(1100);
        const beta = presentAsk(w, "../beta", "退款页的按钮放在哪里");
        w.memo.set("paths", { app, beta });
        const page = await openPage(w, "/");
        w.memo.set("page", page);
        const rows = await rowsOf(page);
        check(rows.length === 3, `应当是三个项目，看到 ${rows.length} 个`);
        for (const row of rows.slice(0, 2)) {
          check(row.includes("等用户回复"), `前两行没有都写「等用户回复」：${row.slice(0, 80)}`);
          check(row.includes("打开这一页"), `前两行没有都带「打开这一页」：${row.slice(0, 80)}`);
        }
        const [first, second, third] = namesOf(rows);
        check(
          [first, second].sort().join() === "app,beta" && third === "gamma",
          `排在最前的不是有页在等的两个项目：${namesOf(rows).join("、")}`,
        );
        check(!rows[2]?.includes("等用户回复"), "没有给出页的项目也写了「等用户回复」");
        check(
          (await page.getByRole("link", { name: "打开这一页" }).count()) === 2,
          "「打开这一页」不是两个",
        );
        await page.getByText("2 个项目有页在等").waitFor();
      },
    },
    {
      do: "看这两个项目的先后",
      expect: "最近改动的排在前。改动时间相同时顺序固定，刷新不变。",
      run: async (w) => {
        const page = w.memo.get("page") as Page;
        // beta 的页给出得晚，最近改动的是它。
        check(
          namesOf(await rowsOf(page)).join() === "beta,app,gamma",
          "最近改动的 beta 没有排在前",
        );
        // 只在摆状态时直接改库：把两个项目的改动时间改成同一刻。
        const db = new DatabaseSync(join(w.store, "data", "ploop.db"));
        const same = "(SELECT MAX(created_at) FROM events WHERE project_id IN ('app', 'beta'))";
        db.prepare(
          `UPDATE events SET created_at = ${same} WHERE project_id IN ('app', 'beta')`,
        ).run();
        db.close();
        const orders: string[] = [];
        for (let i = 0; i < 3; i++) {
          await page.reload();
          orders.push(namesOf(await rowsOf(page)).join());
        }
        check(
          new Set(orders).size === 1 && orders[0] === "app,beta,gamma",
          `改动时间相同时顺序不固定，或者不是按编号排：${orders.join(" | ")}`,
        );
      },
    },
    {
      do: "按第一个项目的「打开这一页」",
      expect: "到那个项目的那一页，页头写项目名、第几版和阶段。",
      run: async (w) => {
        const page = w.memo.get("page") as Page;
        const first = page.locator("tbody tr").first();
        await first.getByRole("link", { name: "打开这一页" }).click();
        await page.getByRole("heading", { name: "第 1 版的构思阶段" }).waitFor();
        const paths = w.memo.get("paths") as { app: string };
        check(page.url().endsWith(paths.app), `到了 ${page.url()}，不是第一个项目的那一页`);
        const header = await page.locator("header").first().innerText();
        check(header.includes("app"), `页头没有写项目名：${header}`);
        const head = await page.locator("main").innerText();
        check(head.includes("第 1 版的构思阶段"), "页头没有写第几版和阶段");
      },
    },
    {
      do: "在那一页点完提交，回到首页",
      expect: "这个项目不再排在等回复的那一组，写「进行中」。另一个仍排在最前，顶上的个数少一个。",
      run: async (w) => {
        const page = w.memo.get("page") as Page;
        await pick(page, /放在页面最后/u);
        await page.getByText("点过的都已存下").waitFor();
        // 两个项目的会话各挂着一个 reply wait：app 的等到提交，beta 的只等三秒。
        const app = w.launch(["reply", "wait", "--timeout", "30"]);
        const beta = w.launch(["reply", "wait", "--timeout", "3", "--project", "beta"]);
        const at = (waiting: Waiting): Promise<Finished> =>
          waiting.done.then((run) => ({ run, at: Date.now() }));
        w.memo.set("app", at(app));
        w.memo.set("beta", at(beta));
        await pause(600);
        check(app.running() && beta.running(), "reply wait 没有挂着等");
        await page.getByRole("button", { name: "提交", exact: true }).click();
        await page.getByRole("dialog").getByRole("button", { name: "提交" }).click();
        // app 的会话已经在等这一页，提交后马上就被取走。
        await page.getByText("AI 已收到").waitFor({ timeout: 10_000 });
        await page.getByRole("link", { name: "产品循环" }).click();
        await page.getByRole("heading", { name: "所有项目", exact: true }).waitFor();
        const rows = await rowsOf(page);
        check(namesOf(rows).join() === "beta,app,gamma", `回到首页的顺序：${namesOf(rows).join()}`);
        const appRow = rows[1] ?? "";
        check(appRow.includes("进行中"), `提交了的项目没有写「进行中」：${appRow.slice(0, 80)}`);
        check(!appRow.includes("等用户回复"), "提交了的项目还写着「等用户回复」");
        check(!appRow.includes("打开这一页"), "提交了的项目还有「打开这一页」");
        check(
          (rows[0] ?? "").includes("等用户回复") && (rows[0] ?? "").includes("打开这一页"),
          "另一个项目不再排在最前，或者没有写「等用户回复」",
        );
        await page.getByText("1 个项目有页在等").waitFor();
        check((await page.getByText("2 个项目有页在等").count()) === 0, "顶上的个数没有少一个");
      },
    },
    {
      do: "另一个项目会话里的 ploop reply wait 加 --timeout 3",
      expect: "退出码 7，写还没有回复。只有提交的那个项目的命令被唤醒。",
      run: async (w) => {
        const app = (await w.memo.get("app")) as Finished;
        const beta = (await w.memo.get("beta")) as Finished;
        expectRun(beta.run, 7, "还没有回复");
        expectRun(app.run, 0, "收到了回复：第 1 版的构思阶段的第 1 页", "选了选项 a");
        check(app.at < beta.at, "提交的那个项目的命令没有先醒：另一个项目的命令等到了时限才退出");
        // 命令行这一步没有新的页面，窗口还是首页。
        show(w, w.memo.get("page") as Page);
      },
    },
    {
      do: "同时有第三个项目给出使用阶段的页",
      expect: "那一行写「进行中」，有「打开这一页」。它排在等回复的项目后面，不计入有页在等。",
      run: async (w) => {
        const gamma = join(w.root, "..", "gamma");
        w.write("../gamma/scripts/use/run.mjs", gammaScript);
        w.write("../gamma/scripts/use/覆盖表.md", gammaCoverage);
        expectRun(w.ploop(["queue", "add", "走一遍看队列", "--stage", "使用"], gamma), 0);
        expectRun(w.ploop(["round", "start", "使用"], gamma), 0);
        expectRun(
          w.ploop(["use", "run", "--", "node", "scripts/use/run.mjs"], gamma),
          0,
          "收下了使用代码的运行：通过 1 步，断了 0 步",
        );
        check(projectIdIn(w, "../gamma") === "gamma", "第三个项目的编号不是 gamma");
        const page = w.memo.get("page") as Page;
        await page.reload();
        const rows = await rowsOf(page);
        const order = namesOf(rows);
        check(order[0] === "beta", `等回复的 beta 没有排在最前：${order.join("、")}`);
        check(order[1] === "gamma", `第三个项目没有排在等回复的项目后面：${order.join("、")}`);
        const row = rows[1] ?? "";
        check(row.includes("进行中"), `使用阶段的那一行没有写「进行中」：${row.slice(0, 80)}`);
        check(row.includes("打开这一页"), "使用阶段的那一行没有「打开这一页」");
        check(!row.includes("等用户回复"), "使用阶段的页只看，却写了「等用户回复」");
        await page.getByText("1 个项目有页在等").waitFor();
        check(
          (await page.getByText("2 个项目有页在等").count()) === 0,
          "使用阶段的页被计入有页在等",
        );
        check(
          (await page.getByRole("link", { name: "打开这一页" }).count()) === 2,
          "「打开这一页」应当是 beta 和 gamma 两个",
        );
      },
    },
  ],
};
