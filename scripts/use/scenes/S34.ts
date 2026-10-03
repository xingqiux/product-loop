import type { Page, Route } from "playwright-core";
import { openPage } from "../browser.ts";
import { check, expectRun, type Scene, started } from "../lib.ts";
import { projectId } from "../pages.ts";

// S34 工作台读数据慢或出错。用户，打开工作台的页，本机服务答得慢或读不出来时。
// 要知道是在读、读不出来，还是能再试一次。页面空白或者一直转，用户会以为工作台坏了。
// 摆的状态：一个项目，队列里一件事，两条决定，一条 skill 的问题。
// 本机服务的状态用浏览器里拦请求来模拟：不放行就是还没答，返回 500 就是读不出来。全部在沙盒里做。

const decisionText = ["决定表默认只列有效的", "队列按阶段分五列"];
const queueText = "看板放在每一页的最后";

/** 本机服务读不出来：500 和错误外壳。页面上的原因写「本机服务内部出错」。 */
const failure = {
  status: 500,
  contentType: "application/json",
  body: JSON.stringify({
    ok: false,
    error: { code: "INTERNAL", message: "读取时出错了", hint: "看后端的日志。" },
  }),
} as const;

const fail = (route: Route) => route.fulfill(failure);

/** 各个读取接口的地址：只拦 GET。pid 是项目的编号。 */
const urls = {
  decisions: (pid: string) => new RegExp(`/api/v1/projects/${pid}/decisions(\\?.*)?$`, "u"),
  projects: /\/api\/v1\/projects(\?.*)?$/u,
  board: (pid: string) => new RegExp(`/api/v1/projects/${pid}/queue/board(\\?.*)?$`, "u"),
  revisions: (pid: string) =>
    new RegExp(`/api/v1/projects/${pid}/mainline/revisions(\\?.*)?$`, "u"),
  issues: /\/api\/v1\/skill\/issues(\?.*)?$/u,
};

/** 页头：项目名，和概览、队列、主线、决定四个页签。 */
async function checkHeader(page: Page, name: string): Promise<void> {
  await page.getByRole("heading", { name, exact: true }).waitFor();
  const tabs = page.getByRole("navigation", { name: "项目" });
  for (const tab of ["概览", "队列", "主线", "决定"]) {
    await tabs.getByRole("link", { name: tab, exact: true }).waitFor();
  }
}

const retry = (page: Page) => page.getByRole("button", { name: "重试", exact: true });

export const scene: Scene = {
  scene: "S34",
  setup: (w) => {
    started(w);
    expectRun(w.ploop(["queue", "add", queueText, "--stage", "构思"]), 0);
    for (const decision of decisionText) {
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
    expectRun(
      w.ploop([
        "skill",
        "report",
        "--aspect",
        "页面",
        "--class",
        "选项卡太长",
        "--example",
        "疑问卡写了九行",
      ]),
      0,
    );
  },
  steps: [
    {
      do: "打开决定页，本机服务还没答",
      expect: "表的位置写「正在读取」。页头和四个页签已经在，没有空表。",
      run: async (w) => {
        const pid = projectId(w);
        const held: Route[] = [];
        // 决定列表的请求发出去，本机服务不答：拦下来不放行。
        const page = await openPage(w, `/p/${pid}/decisions`, 1440, async (tab) => {
          await tab.route(urls.decisions(pid), (route) => {
            held.push(route);
          });
        });
        w.memo.set("page", page);
        w.memo.set("held", held);
        const status = page.getByRole("status");
        await status.getByText("正在读取").waitFor();
        await checkHeader(page, pid);
        check((await page.getByRole("table").count()) === 0, "还没读到就摆出了表");
        check((await page.getByText("没有决定").count()) === 0, "还没读到就写了「没有决定」");
        check((await retry(page).count()) === 0, "还没读到就有了「重试」");
        check(held.length > 0, "决定列表的请求没有发出去");
      },
    },
    {
      do: "本机服务答了，说读不出来",
      expect: "换成「读不到决定。」，下面写原因，有「重试」。页头和页签还在。",
      run: async (w) => {
        const pid = projectId(w);
        const page = w.memo.get("page") as Page;
        await page.unroute(urls.decisions(pid));
        await page.route(urls.decisions(pid), fail);
        await page.reload();
        const alert = page.getByRole("alert");
        await alert.getByText("读不到决定。").waitFor();
        const text = await alert.innerText();
        check(text.includes("本机服务内部出错"), `下面没有写原因：${text}`);
        await retry(page).waitFor();
        check((await page.getByRole("status").count()) === 0, "读不出来了，还写着「正在读取」");
        check((await page.getByRole("table").count()) === 0, "读不出来，却摆出了表");
        await checkHeader(page, pid);
        // 上一步拦下没放行的请求，页面已经换了，放它们走，不留悬着的。
        for (const route of w.memo.get("held") as Route[]) await route.continue().catch(() => {});
      },
    },
    {
      do: "本机服务好了，按「重试」",
      expect: "重新读取，决定表出来。「读不到决定。」和「重试」都不见了。",
      run: async (w) => {
        const pid = projectId(w);
        const page = w.memo.get("page") as Page;
        await page.unroute(urls.decisions(pid), fail);
        await retry(page).click();
        await page
          .getByText(decisionText[0] ?? "")
          .first()
          .waitFor();
        await page.getByRole("table").waitFor();
        check((await page.getByText("读不到决定。").count()) === 0, "读回来了，出错的话还在");
        check((await retry(page).count()) === 0, "读回来了，「重试」还在");
        check((await page.getByRole("alert").count()) === 0, "读回来了，出错的提示还在");
        await checkHeader(page, pid);
      },
    },
    {
      do: "首页、队列、主线和 skill 的问题读不出来时",
      expect: "各写一句读不到什么，和原因，都有「重试」。按下能读回来。",
      run: async (w) => {
        const pid = projectId(w);
        const page = w.memo.get("page") as Page;
        // 每一页：读取的接口、页面的路径、读不到的那一句、读回来以后该有的东西。
        const cases: {
          name: string;
          url: RegExp;
          path: string;
          said: string;
          back: () => Promise<void>;
        }[] = [
          {
            name: "首页",
            url: urls.projects,
            path: "/",
            said: "读不到项目。",
            back: () => page.getByRole("link", { name: pid, exact: true }).first().waitFor(),
          },
          {
            name: "队列",
            url: urls.board(pid),
            path: `/p/${pid}/queue`,
            said: "读不到队列。",
            back: () => page.getByText(queueText).first().waitFor(),
          },
          {
            name: "主线",
            url: urls.revisions(pid),
            path: `/p/${pid}/mainline`,
            said: "读不到主线。",
            back: () => page.getByRole("radio", { name: "全文" }).waitFor(),
          },
          {
            name: "skill 的问题",
            url: urls.issues,
            path: "/skill",
            said: "读不到问题。",
            back: () => page.locator("[data-issue='1']").waitFor(),
          },
        ];
        for (const item of cases) {
          await page.route(item.url, fail);
          await page.goto(w.url(item.path));
          const alert = page.getByRole("alert");
          await alert.getByText(item.said).waitFor();
          const text = await alert.innerText();
          check(text.includes("本机服务内部出错"), `${item.name}没有写原因：${text}`);
          check((await retry(page).count()) === 1, `${item.name}没有「重试」`);
          // 好了以后按「重试」，能读回来，出错的提示和「重试」都不见了。
          await page.unroute(item.url, fail);
          await retry(page).click();
          await item.back();
          check(
            (await page.getByText(item.said).count()) === 0,
            `${item.name}读回来了，出错的话还在`,
          );
          check((await retry(page).count()) === 0, `${item.name}读回来了，「重试」还在`);
        }
      },
    },
  ],
};
