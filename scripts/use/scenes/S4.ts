import { join } from "node:path";
import type { Page } from "playwright-core";
import { openPage, pick, show, styleOf } from "../browser.ts";
import { check, expectRun, pause, type Scene, type World } from "../lib.ts";
import { presentThink, projectId } from "../pages.ts";

// S4 提交以后 AI 接着做。用户，提交完回到对话时。不想再复制粘贴，也想知道 AI 有没有收到。
// 提交后没人取走，用户会白等，所以要看得出来。
// 摆好的状态：app 的构思阶段给出一页，AI 在等。beta 也给出一页，没有 AI 在等它。
// 用户在 app 的页上点五条、写一句想法，提交；AI 取走以后把每一行放去不同的地方。

type Waiting = ReturnType<World["launch"]>;

const nextPage = {
  asks: [
    {
      id: "filter",
      title: "看板要不要加筛选",
      why: "上一个阶段的想法里提到看板事多时不好找。",
      sources: [{ name: "上一个阶段的想法", saw: "「事多的时候找不到」", quote: true }],
    },
  ],
};

/** beta 的一页：一张疑问卡，没有 AI 在等它。 */
const betaPage = {
  asks: [
    {
      id: "filter",
      queue: ["Q1"],
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

const sidebar = (page: Page) => page.getByRole("navigation", { name: "这一页的每一条" });

/** 提交：点提交，再在确认框里点提交。 */
async function submit(page: Page): Promise<void> {
  await page.getByText("点过的都已存下").waitFor();
  await page.getByRole("button", { name: "提交", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "提交" }).click();
  await page.getByText("等 AI 取走").waitFor();
}

export const scene: Scene = {
  scene: "S4",
  setup: (w) => {
    w.memo.set("path", presentThink(w));
    // beta：另一个项目，给出一页，没有 AI 在等它。
    const beta = join(w.root, "..", "beta");
    w.write("../beta/.keep", "");
    expectRun(w.ploop(["init", "--repo", "自己的"], beta), 0);
    w.write("../beta/.product-loop/主线.md", w.read(".product-loop/主线.md"));
    expectRun(w.ploop(["queue", "add", "看板要不要加筛选", "--stage", "构思"], beta), 0);
    expectRun(w.ploop(["round", "start", "构思"], beta), 0);
    w.write("../beta/.product-loop/rounds/v1-构思-1/page.json", JSON.stringify(betaPage));
    expectRun(w.ploop(["page", "present"], beta), 0);
  },
  steps: [
    {
      do: "提交，AI 正在等这一页",
      expect:
        "五秒内，提交区从「等 AI 取走」变成「AI 已收到」。没有 AI 在等时，一直写「等 AI 取走」。",
      run: async (w) => {
        // AI 在后台等 app 的这一页。
        const waiting = w.launch(["reply", "wait", "--timeout", "60"]);
        w.memo.set("waiting", waiting);
        await pause(1000);
        const page = await openPage(w, w.memo.get("path") as string);
        w.memo.set("page", page);
        // 用户点五条、写一句想法：疑问的选项、疑问的回答、场景要改、设计规范保留，再加想法框。
        await sidebar(page).getByRole("button", { name: "队列看板放在哪里" }).click();
        await pick(page, /每一页的最后/u);
        await sidebar(page).getByRole("button", { name: "上次你自己排当天的事是什么时候" }).click();
        await page.getByPlaceholder("回答", { exact: true }).fill("上周排过一次");
        await sidebar(page).getByRole("button", { name: "看队列", exact: true }).click();
        const scene9 = page.locator("[data-item=look-at-queue]");
        await scene9.locator("label", { hasText: "修改" }).click();
        await scene9.getByPlaceholder("修改的内容").fill("第 2 步改成点一张卡");
        await sidebar(page).getByRole("button", { name: "配色", exact: true }).click();
        await page.locator("[data-item=palette]").locator("label", { hasText: "保留" }).click();
        await page.getByPlaceholder("想法", { exact: true }).fill("看板事多的时候不好找");
        // 提交以后，提交区从「等 AI 取走」变成「AI 已收到」，不超过五秒。
        await page.getByText("点过的都已存下").waitFor();
        await page.getByRole("button", { name: "提交", exact: true }).click();
        await page.getByRole("dialog").getByRole("button", { name: "提交" }).click();
        const submitted = Date.now();
        await page.getByText("AI 已收到").waitFor({ timeout: 5000 });
        check(Date.now() - submitted < 5000, "提交以后超过五秒才写「AI 已收到」");
        // 没有 AI 在等的页：提交以后一直写「等 AI 取走」，过了五秒还是。
        const other = await openPage(w, "/p/beta/r/v1-构思-1?item=filter");
        await pick(other, /看板顶上/u);
        await submit(other);
        await pause(6000);
        check(
          (await other.getByText("AI 已收到").count()) === 0,
          "没有 AI 在等这一页，提交区却写了「AI 已收到」",
        );
        await other.getByText("等 AI 取走").waitFor();
        show(w, page);
      },
    },
    {
      do: "回到对话",
      expect: "AI 已经在处理这一页的回复，不用复制粘贴。",
      run: async (w) => {
        const done = await (w.memo.get("waiting") as Waiting).done;
        // AI 等着的命令自己退出，打印回复的每一行，不用用户复制粘贴。
        expectRun(
          done,
          0,
          "收到了回复：第 1 版的构思阶段的第 1 页",
          "选了选项 a",
          "上周排过一次",
          "想法：看板事多的时候不好找",
        );
        w.memo.set("reply", done.stdout);
        const page = w.memo.get("page") as Page;
        await page.getByText("AI 已收到").waitFor();
      },
    },
    {
      do: "打开 AI 给出的下一页",
      expect:
        "顶上一块写着上一个阶段每一行去了哪里。去处是主线、决定、队列、当场做，或者不处理和原因。",
      run: async (w) => {
        // AI 把每一行放去不同的地方：先看回复，每行的行号取自它。
        const shown = w.ploop(["reply", "show"]);
        expectRun(shown, 0);
        const lineOf = (text: string): string => {
          const found = shown.stdout.split("\n").find((line) => line.includes(text));
          const line = /^第 (\d+) 行/u.exec(found ?? "")?.[1];
          check(line !== undefined, `回复里找不到「${text}」这一行：${shown.stdout}`);
          return String(line);
        };
        // 主线：先改主线.md 交成新修订，再处理。
        w.write(
          ".product-loop/主线.md",
          w.read(".product-loop/主线.md").replace("### S9 看队列", "### S9 看队列和取消"),
        );
        expectRun(w.ploop(["mainline", "push"]), 0);
        expectRun(w.ploop(["reply", "handle", lineOf("看队列"), "主线", "场景清单"]), 0);
        expectRun(
          w.ploop([
            "reply",
            "handle",
            lineOf("选了选项 a"),
            "决定",
            "--decision",
            "队列看板放在每一页的最后",
            "--reason",
            "用户每一页都要看到队列",
            "--case",
            "第 1 版的构思阶段第 1 页",
          ]),
          0,
        );
        expectRun(w.ploop(["reply", "handle", lineOf("上周排过一次"), "当场做", "已记下"]), 0);
        expectRun(w.ploop(["reply", "handle", lineOf("配色"), "不处理", "已经写进设计规范"]), 0);
        // 想法框里的话也是一行，由 AI 定去处：放进队列，阶段标提升。
        expectRun(
          w.ploop([
            "reply",
            "handle",
            lineOf("想法：看板事多的时候不好找"),
            "队列",
            "看板事多的时候不好找",
            "--stage",
            "提升",
          ]),
          0,
        );
        expectRun(w.ploop(["round", "close", "--done", "Q1=看板放在每一页的最后"]), 0);
        expectRun(w.ploop(["round", "start", "构思"]), 0);
        w.write(".product-loop/rounds/v1-构思-2/page.json", JSON.stringify(nextPage));
        expectRun(w.ploop(["page", "present"]), 0, "给出了：第 1 版的构思阶段（第 2 次）的第 1 页");
        const page = w.memo.get("page") as Page;
        await page.goto(
          w.url(`/p/${projectId(w)}/r/${encodeURIComponent("v1-构思-2")}?item=previous`),
        );
        await page.getByRole("heading", { name: "回复去处" }).waitFor();
        // 这一块在最顶上：它是左边第一条，打开就先看到它。
        const heading = await page.getByRole("heading", { name: "回复去处" }).boundingBox();
        const first = await page.locator("main h2").first().innerText();
        check(first === "回复去处", `顶上第一块是「${first}」`);
        check(heading !== null && heading.y < 400, `「回复去处」不在最顶上：${heading?.y}`);
        const text = await page.locator("main").innerText();
        // 每一行去了哪里：主线、决定、队列、当场做、不处理和原因。
        check(text.includes("主线的「场景清单」"), `没有写去了主线：${text.slice(0, 500)}`);
        check(
          text.includes("决定：队列看板放在每一页的最后"),
          "没有写去了决定，或者写的不是决定的内容",
        );
        check(text.includes("队列：看板事多的时候不好找"), "没有写想法去了队列，或者写的不是内容");
        check(text.includes("当场做了：已记下"), "没有写当场做了什么");
        check(text.includes("不处理：已经写进设计规范"), "没有写不处理和原因");
        check(!/Q\d+/u.test(text), `回复去处里还写着队列编号：${text.slice(0, 300)}`);
        // 回复的一行写卡的标题和选项的标题，不写卡的编号和选项的字母。
        check(text.includes("队列看板放在哪里"), "没有写第 1 行是哪一张卡");
        check(!text.includes("queue-board"), "还写着卡的编号");
      },
    },
    {
      do: "看这一页的想法框",
      expect: "是空的，上一页写的字没有带过来。",
      run: async (w) => {
        const page = w.memo.get("page") as Page;
        const ideas = page.getByPlaceholder("想法", { exact: true });
        check((await ideas.inputValue()) === "", `想法框里是「${await ideas.inputValue()}」`);
      },
    },
    {
      do: "AI 撤回这一页，又给出一页",
      expect:
        "页头右边是两个页签，撤回的写「已撤回」，不靠划线。打开撤回的一页，提交区写状态，有原因才写原因。",
      run: async (w) => {
        expectRun(w.ploop(["page", "withdraw", "--reason", "补一个问题"]), 0);
        expectRun(w.ploop(["page", "present"]), 0, "第 2 页");
        const page = w.memo.get("page") as Page;
        await page.goto(w.url(`/p/${projectId(w)}/r/${encodeURIComponent("v1-构思-2")}`));
        const tabs = page.getByRole("navigation", { name: "这个阶段的几页" });
        await tabs.getByRole("button", { name: /^第 1 页 已撤回$/u }).waitFor();
        const current = await tabs
          .getByRole("button", { name: /^第 2 页$/u })
          .getAttribute("aria-current");
        check(current === "page", `当前的一页没有标出来：${current}`);
        const line = await styleOf(
          page,
          'nav[aria-label="这个阶段的几页"] button',
          "text-decoration-line",
        );
        check(!line.includes("line-through"), "撤回的页还靠划线表示");
        // 打开撤回的那一页：提交区写状态和原因，页签不再重复写「已撤回」。
        await tabs.getByRole("button", { name: /^第 1 页 已撤回$/u }).click();
        const status = page.getByRole("status").filter({ hasText: "这一页已撤回" });
        await status.waitFor();
        check((await status.innerText()).includes("补一个问题"), "撤回的页没有写撤回的原因");
        await tabs.getByRole("button", { name: /^第 1 页$/u }).waitFor();
        const body = await page.locator("body").innerText();
        check(
          body.split("已撤回").length === 2,
          `「已撤回」在这一页上写了不止一处：${body.split("已撤回").length - 1} 处`,
        );
        check(!body.includes("没写原因"), "撤回没有原因时，还写着没有原因");
        // 撤回时不写原因：提交区只有状态，下面不补一句「没有」。
        expectRun(w.ploop(["page", "withdraw"]), 0);
        await page.goto(w.url(`/p/${projectId(w)}/r/${encodeURIComponent("v1-构思-2")}`));
        await tabs.getByRole("button", { name: /^第 2 页( 已撤回)?$/u }).click();
        const bare = page.getByRole("status").filter({ hasText: "这一页已撤回" });
        await bare.waitFor();
        check(
          (await bare.innerText()).trim() === "这一页已撤回",
          "没有原因的撤回，提交区还写了别的",
        );
        check(!(await page.locator("body").innerText()).includes("没写原因"), "还写着没写原因");
      },
    },
  ],
};
