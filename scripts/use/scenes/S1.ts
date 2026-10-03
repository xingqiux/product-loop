import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Page } from "playwright-core";
import { openPage, show } from "../browser.ts";
import { check, expectRun, type Scene, type World } from "../lib.ts";
import { presentThink, projectId } from "../pages.ts";

// S1 看所有项目停在哪。用户，每天开工时，同时照看几个项目。要先处理在等自己的项目，不用逐个打开找。
// 首页写错，用户会去错的项目，所以必须准。
// 四个项目：app 有页在等；beta 停在旧版 skill，第 2 版还没开始阶段，队列里有一件停了十天的事；
// old 迁移没做完；gamma 的构思阶段做到第 2 次，进行中。

const dayMs = 24 * 60 * 60 * 1000;

/** 备份有问题时，工作台顶上要写的一行。沙盒里关了 Time Machine 的检查，在浏览器里给项目列表的响应加上它。 */
const backup = "Time Machine 最近一次备份在 2026-06-29，已有 92 天没有备份。";
const backupHint = "确认备份盘已连接。";

/** 打开首页，项目列表的响应里加上备份的警告。 */
function openWithBackup(w: World): Promise<Page> {
  return openPage(w, "/", 1440, async (tab) => {
    await tab.route(/\/api\/v1\/projects(\?.*)?$/u, async (route) => {
      const response = await route.fetch();
      const body = (await response.json()) as { warnings: unknown[] };
      body.warnings = [...body.warnings, { message: backup, hint: backupHint }];
      await route.fulfill({ response, json: body });
    });
  });
}

/** 首页表格里一个项目那一行的每一格，格里的字去掉前后的空白。 */
async function cellsOf(page: Page, name: string): Promise<string[]> {
  const row = page.getByRole("row").filter({ has: page.getByRole("link", { name, exact: true }) });
  return (await row.getByRole("cell").allInnerTexts()).map((text) =>
    text.replace(/\s+/gu, " ").trim(),
  );
}

/** 首页表格里每个项目的名字，按从上到下的顺序。 */
const namesInOrder = (page: Page): Promise<string[]> =>
  page.locator("tbody tr td:first-child a").allInnerTexts();

type Listed = {
  readonly project: { readonly id: string };
  readonly lastChangedAt: string;
  readonly waitingPages: readonly unknown[];
};

export const scene: Scene = {
  scene: "S1",
  setup: async (w) => {
    presentThink(w);
    // beta：另一个项目，队列里放一件检查阶段的事，进第 2 版，再改成停了十天、停在旧版 skill 的样子。
    const beta = join(w.root, "..", "beta");
    w.write("../beta/.keep", "");
    expectRun(w.ploop(["init", "--repo", "自己的"], beta), 0);
    w.write("../beta/.product-loop/主线.md", w.read(".product-loop/主线.md"));
    expectRun(w.ploop(["queue", "add", "退款页的按钮位置不对", "--stage", "检查"], beta), 0);
    expectRun(w.ploop(["version", "next", "--reason", "先做下一版"], beta), 0);
    // old：迁移没做完。
    await w.api("POST", "/projects", { root: join(w.root, "..", "old"), repoKind: "自己的" });
    // gamma：构思阶段收尾以后又开了一次，进行中。
    const gamma = join(w.root, "..", "gamma");
    w.write("../gamma/.keep", "");
    expectRun(w.ploop(["init", "--repo", "自己的"], gamma), 0);
    w.write("../gamma/.product-loop/主线.md", w.read(".product-loop/主线.md"));
    expectRun(w.ploop(["round", "start", "构思"], gamma), 0);
    expectRun(w.ploop(["round", "close"], gamma), 0);
    expectRun(w.ploop(["round", "start", "构思"], gamma), 0);
    // 只在摆状态时直接改库。
    const db = new DatabaseSync(join(w.store, "data", "ploop.db"));
    db.prepare("UPDATE projects SET skill_version = NULL WHERE id = 'old'").run();
    db.prepare("UPDATE projects SET skill_version = 'v1-final' WHERE id = 'beta'").run();
    const item = "(SELECT id FROM queue_items WHERE project_id = 'beta')";
    db.prepare(`UPDATE queue_items SET created_at = created_at - ? WHERE id = ${item}`).run(
      10 * dayMs,
    );
    db.prepare(`UPDATE queue_events SET at = at - ? WHERE item_id = ${item}`).run(10 * dayMs);
    db.close();
  },
  steps: [
    {
      do: "打开工作台首页",
      expect:
        "每个项目一行，写第几版、阶段、第几次和状态。还没开始阶段的写「第 2 版，还没开始阶段」。",
      run: async (w) => {
        const page = await openPage(w, "/");
        w.memo.set("page", page);
        await page.getByRole("heading", { name: "所有项目", exact: true }).waitFor();
        await page.getByRole("row").filter({ hasText: "第 1 版的构思阶段" }).first().waitFor();
        check((await page.locator("tbody tr").count()) === 4, "应当是四个项目，一个项目一行");
        const app = (await cellsOf(page, projectId(w)))[1] ?? "";
        check(
          app.includes("第 1 版的构思阶段") && app.includes("等用户回复"),
          `app 这一行没有写第几版、阶段和状态：${app}`,
        );
        // 阶段做到第 2 次，写第几次；第 1 次不重复写。
        const gamma = (await cellsOf(page, "gamma"))[1] ?? "";
        check(
          gamma.includes("第 1 版的构思阶段（第 2 次）") && gamma.includes("进行中"),
          `gamma 这一行没有写第几次和状态：${gamma}`,
        );
        const beta = (await cellsOf(page, "beta"))[1] ?? "";
        check(beta.includes("第 2 版，还没开始阶段"), `beta 这一行写的是：${beta}`);
        check(!beta.includes("未开始"), "还写着「未开始」，让人以为整个项目没开始");
      },
    },
    {
      do: "找有页在等用户的项目",
      expect: "排在最前，行上有「打开这一页」，按下直达那一页。别的按最近改动排，新的在前。",
      run: async (w) => {
        const page = w.memo.get("page") as Page;
        await page.goto(w.url("/"));
        await page.locator("tbody tr").first().waitFor();
        const first = page.locator("tbody tr").first();
        check((await first.innerText()).includes(projectId(w)), "有页在等的项目不在第一行");
        check(
          (await page.getByRole("link", { name: "打开这一页" }).count()) === 1,
          "只有一个项目有页在等，却不是只有一个「打开这一页」",
        );
        // 别的按最近改动排，新的在前：顺序按接口里每个项目的最近改动时间算出来。
        const listed = (await w.api("GET", "/projects")) as { data: Listed[] };
        const expected = listed.data
          .filter((status) => status.waitingPages.length === 0)
          .sort((a, b) => Date.parse(b.lastChangedAt) - Date.parse(a.lastChangedAt))
          .map((status) => status.project.id);
        const names = await namesInOrder(page);
        check(names[0] === projectId(w), `第一行是 ${names[0]}`);
        check(
          names.slice(1).join() === expected.join(),
          `后面几行的顺序是 ${names.slice(1).join("、")}，按最近改动应当是 ${expected.join("、")}`,
        );
        check(names.slice(1).join() === "gamma,old,beta", `后三行的顺序是 ${names.slice(1)}`);
        await first.getByRole("link", { name: "打开这一页" }).click();
        await page.getByRole("heading", { name: "第 1 版的构思阶段" }).waitFor();
        check(decodeURIComponent(page.url()).endsWith("/r/v1-构思-1"), `到了 ${page.url()}`);
      },
    },
    {
      do: "看每个项目的队列",
      expect: "五个阶段各写有几件，零件写 0。停了七天以上的另写「停滞」。",
      run: async (w) => {
        const page = w.memo.get("page") as Page;
        await page.goto(w.url("/"));
        await page.locator("tbody tr").first().waitFor();
        // 列：项目、停在哪，然后是构思、使用、检查、落地、提升、最近改动。
        // 五个阶段的列头上有「队列」这一层，数字知道是什么的件数。
        check(
          (await page.getByRole("columnheader", { name: "队列", exact: true }).count()) === 1,
          "五个阶段的列头上没有「队列」",
        );
        for (const stage of ["构思", "使用", "检查", "落地", "提升"]) {
          check(
            (await page.getByRole("columnheader", { name: stage, exact: true }).count()) === 1,
            `列头上没有「${stage}」`,
          );
        }
        const counts = async (name: string) => (await cellsOf(page, name)).slice(2, 7);
        const app = await counts(projectId(w));
        check(
          app.join() === "1,0,0,0,1",
          `app 的五个阶段是 ${app.join("、")}，应当是 1、0、0、0、1`,
        );
        const beta = await counts("beta");
        check(
          beta.join("|") === "0|0|1 停滞 1|0|0",
          `beta 的五个阶段是 ${JSON.stringify(beta)}，检查一列应当是 1 和「停滞 1」，别的写 0`,
        );
        const gamma = await counts("gamma");
        check(gamma.join() === "0,0,0,0,0", `没有事的项目零件要写 0：${gamma.join("、")}`);
        check(
          !(await cellsOf(page, projectId(w))).join().includes("停滞"),
          "刚放进来的事不该标成停滞",
        );
        check(!(await cellsOf(page, "gamma")).join().includes("停滞"), "没有事的项目不该有停滞");
      },
    },
    {
      do: "看到某个项目停在旧版 skill",
      expect: "那一行写「旧版」和现在的版本号，行上不写命令。没迁移的写「未迁移」。",
      run: async (w) => {
        const page = w.memo.get("page") as Page;
        const current = /\d+\.\d+\.\d+/u.exec(w.ploop(["--version"]).stdout)?.[0];
        check(current !== undefined, "读不出现在的版本号");
        const beta = (await cellsOf(page, "beta")).join(" ");
        check(beta.includes(String(current)), `beta 这一行没有写现在的版本号 ${current}：${beta}`);
        check(!/ploop|doctor/u.test(beta), `行上不该写命令：${beta}`);
        const old = (await cellsOf(page, "old")).join(" ");
        check(old.includes("未迁移"), `没迁移的项目没有写「未迁移」：${old}`);
        check(!/ploop|doctor/u.test(old), `行上不该写命令：${old}`);
        // 其余都核对完再报：停在旧版 skill 的那一行要写「旧版」两个字。
        check(beta.includes("旧版"), `beta 这一行没有写「旧版」：${beta}`);
      },
    },
    {
      do: "备份有问题",
      expect:
        "首页和项目页顶上写一行，能关掉。这个浏览器里七天内不再出现，换浏览器还会出现。正在回复的页面上不出现。",
      run: async (w) => {
        const page = await openWithBackup(w);
        await page.getByText(backup).waitFor();
        // 顶上写两句：出了什么问题，怎么办。怎么办是要读的，写在顶上，不藏在悬停里。
        await page.getByText(backupHint).waitFor();
        check((await page.getByText(backup).getAttribute("title")) === null, "警告还带着悬停提示");
        await page.getByRole("link", { name: projectId(w), exact: true }).click();
        await page.getByRole("heading", { name: "进度" }).waitFor();
        await page.getByText(backup).waitFor();
        // 正在回复的页面上不出现。
        await page.goto(w.url(`/p/${projectId(w)}/r/${encodeURIComponent("v1-构思-1")}`));
        await page.getByRole("heading", { name: "第 1 版的构思阶段" }).waitFor();
        check((await page.getByText(backup).count()) === 0, "正在回复的那一页顶上也有备份的提示");
        // 能关掉：关掉以后，刷新和进项目页都不再出现。
        await page.goto(w.url("/"));
        await page.getByText(backup).waitFor();
        await page.getByRole("button", { name: "关闭", exact: true }).click();
        check((await page.getByText(backup).count()) === 0, "关掉以后还在");
        await page.reload();
        await page.getByRole("heading", { name: "所有项目", exact: true }).waitFor();
        check((await page.getByText(backup).count()) === 0, "刷新以后关掉的提示又出现了");
        await page.getByRole("link", { name: projectId(w), exact: true }).click();
        await page.getByRole("heading", { name: "进度" }).waitFor();
        check((await page.getByText(backup).count()) === 0, "项目页上关掉的提示又出现了");
        // 七天内不再出现：关掉的时间拨回 6 天前还是不出现，拨回 8 天前又出现。
        const moveDismissal = (days: number) =>
          page.evaluate(`(() => {
            const saved = JSON.parse(localStorage.getItem("ploop-ui"));
            saved.state.backupDismissedAt = Date.now() - ${days} * 24 * 60 * 60 * 1000;
            localStorage.setItem("ploop-ui", JSON.stringify(saved));
          })()`);
        await moveDismissal(6);
        await page.goto(w.url("/"));
        await page.getByRole("heading", { name: "所有项目", exact: true }).waitFor();
        check((await page.getByText(backup).count()) === 0, "关掉 6 天以后又出现了");
        await moveDismissal(8);
        await page.goto(w.url("/"));
        await page.getByText(backup).waitFor();
        // 换浏览器还会出现：新开的浏览器上下文没有关掉的记录。
        const other = await openWithBackup(w);
        await other.getByText(backup).waitFor();
        show(w, other);
      },
    },
    {
      do: "打开开发时用的验证页的地址",
      expect: "写「找不到这一页」，有页头和回到所有项目的入口。发布出去的工作台里没有验证页。",
      run: async (w) => {
        const page = await openPage(w, "/proof");
        await page.getByText("找不到这一页").waitFor();
        check(!(await page.locator("body").innerText()).includes("开工验证页"), "验证页还在");
        // 找不到的页有页头和回到首页的入口，不是一行裸字。
        await page.getByRole("link", { name: "产品循环" }).waitFor();
        await page.getByRole("link", { name: "回到所有项目" }).waitFor();
        await page.getByRole("link", { name: "回到所有项目" }).click();
        await page.getByRole("heading", { name: "所有项目", exact: true }).waitFor();
        // 回到所有项目以后，再走一遍验证页的地址，让这一步的截图停在找不到的那一页。
        await page.goto(w.url("/proof"));
        await page.getByText("找不到这一页").waitFor();
      },
    },
  ],
};
