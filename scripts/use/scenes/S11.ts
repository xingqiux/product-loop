import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Page } from "playwright-core";
import { openPage, show, styleOf, tabTo } from "../browser.ts";
import { check, expectRun, type Scene, started } from "../lib.ts";
import { projectId } from "../pages.ts";

// S11 skill 的问题回到维护的地方。用户，在别的项目里发现 skill 本身有问题时。
// 问题要回到维护 skill 的地方，不用在两个会话之间转述。问题丢了，同样的规矩会一直坑别的项目。
// 摆的状态：app 是报问题的项目；product-loop 是维护 skill 的项目；old 没有迁移；
// app 的阶段和事停了十天，一条规矩在两个项目里被拦截。

const dayMs = 24 * 60 * 60 * 1000;

export const scene: Scene = {
  scene: "S11",
  setup: async (w) => {
    started(w);
    expectRun(w.ploop(["queue", "add", "补上使用阶段的截图", "--stage", "使用"]), 0);
    expectRun(w.ploop(["queue", "add", "理清给谁用", "--stage", "构思"]), 0);
    expectRun(w.ploop(["round", "start", "构思"]), 0);
    // 另登记一个项目，改成迁移没做完的样子。
    await w.api("POST", "/projects", { root: join(w.root, "..", "old"), repoKind: "自己的" });
    // 处理问题只在产品循环自己的项目里放行，维护的会话就在这个项目里。
    await w.api("POST", "/projects", {
      root: join(w.root, "..", "product-loop"),
      repoKind: "自己的",
    });
    // 摆出三类信号：app 的一轮和一件事都停了十天，old 没有迁移，一条规矩在两个项目里被拦截。
    // 只在摆状态时直接改库。
    const db = new DatabaseSync(join(w.store, "data", "ploop.db"));
    const app = "(SELECT id FROM projects WHERE id = 'app')";
    db.prepare("UPDATE projects SET skill_version = NULL WHERE id = 'old'").run();
    db.prepare("UPDATE rounds SET started_at = started_at - ?").run(10 * dayMs);
    db.prepare(`UPDATE events SET created_at = created_at - ? WHERE project_id = ${app}`).run(
      10 * dayMs,
    );
    db.prepare("UPDATE queue_items SET created_at = created_at - ? WHERE number = 1").run(
      10 * dayMs,
    );
    db.prepare(
      "UPDATE queue_events SET at = at - ? WHERE item_id = (SELECT id FROM queue_items WHERE number = 1)",
    ).run(10 * dayMs);
    const hit = db.prepare(
      `INSERT INTO rule_hits (created_at, project_id, command, mode, layer, rule, level, message)
       VALUES (?, ?, 'page present', 'current', 'writing', 'writing.sentence.tooLong', 'block', ?)`,
    );
    const now = Date.now();
    hit.run(now - 2 * dayMs, "app", "这一句有七十字，超过了六十字。");
    hit.run(now - dayMs, "app", "这一句有八十字，超过了六十字。");
    hit.run(now - 3600_000, "old", "这一句有六十五字，超过了六十字。");
    db.close();
  },
  steps: [
    {
      do: "在那个项目的会话里，同意把问题报上去",
      expect: "会话用一条命令报上去，打印问题的编号。用户不用转述。",
      run: (w) => {
        expectRun(
          w.ploop([
            "skill",
            "report",
            "--aspect",
            "页面",
            "--class",
            "选项卡太长",
            "--example",
            "疑问卡 a 写了九行，右边的线稿被挤到了下面",
          ]),
          0,
          "报上了：问题 1",
        );
      },
    },
    {
      do: "打开 skill 的问题页",
      expect: "这一条在列表里，写项目、阶段、方面和类，状态是「新」。",
      run: async (w) => {
        const page = await openPage(w, "/");
        w.memo.set("page", page);
        await page.getByRole("link", { name: "skill 的问题" }).click();
        const row = page.locator("[data-issue='1']");
        await row.waitFor();
        const text = await row.innerText();
        for (const want of [projectId(w), "第 1 版的构思阶段", "页面", "选项卡太长", "新"]) {
          check(text.includes(want), `这一行没有「${want}」：${text}`);
        }
        check((await page.locator("[data-issue]").count()) === 1, "列表里不是只有这一条");
      },
    },
    {
      do: "维护 skill 的会话回了理解",
      expect: "状态变成「已理解」，展开能看到原始情况和回复。卡片里只读，没有改状态的控件。",
      run: async (w) => {
        const page = w.memo.get("page") as Page;
        // 维护的会话在产品循环自己的项目里，不在报问题的那个项目里。
        expectRun(
          w.ploop(
            [
              "--project",
              "product-loop",
              "skill",
              "issues",
              "reply",
              "1",
              "选项卡要限定行数，超出的放进展开",
            ],
            w.store,
          ),
          0,
          "回了理解：问题 1",
        );
        const row = page.locator("[data-issue='1']");
        await row.getByText("已理解").waitFor();
        await row.click();
        const dialog = page.getByRole("dialog");
        await dialog.getByText("疑问卡 a 写了九行，右边的线稿被挤到了下面").waitFor();
        await dialog.getByText("选项卡要限定行数，超出的放进展开").waitFor();
        // 卡片是只读的：状态由维护的会话用命令改，网页上没有改状态的控件。
        check(
          (await dialog.getByRole("button", { name: "保存" }).count()) === 0 &&
            (await dialog.getByRole("radio").count()) === 0 &&
            (await dialog.getByRole("combobox").count()) === 0 &&
            (await dialog.getByRole("textbox").count()) === 0,
          "卡片里还有改状态的控件",
        );
      },
    },
    {
      do: "用键盘 Tab 到一条问题，按 Enter",
      expect: "整行有框线，按下去打开展示卡片。Esc 关掉后键盘仍停在这一行。",
      run: async (w) => {
        const page = w.memo.get("page") as Page;
        // 上一步的卡片还开着，先关掉，键盘从页头开始 Tab。
        await page.keyboard.press("Escape");
        await page.getByRole("dialog").waitFor({ state: "hidden" });
        const reached = await tabTo(
          page,
          page.getByRole("link", { name: "产品循环" }),
          "[data-issue]",
        );
        check(reached, "从页头按 Tab，到不了问题表里的一行");
        const outline = await styleOf(
          page,
          "[data-issue]:has(button:focus-visible)",
          "outline-style",
        );
        check(outline === "solid", `键盘停在这一行上，框线是 ${outline}`);
        await page.keyboard.press("Enter");
        const dialog = page.getByRole("dialog");
        await dialog.getByText("选项卡太长").first().waitFor();
        await page.waitForFunction("document.activeElement?.closest('[role=dialog]') != null");
        await page.keyboard.press("Escape");
        await dialog.waitFor({ state: "hidden" });
        check(
          await page.evaluate("document.activeElement?.closest('[data-issue]') !== null"),
          "关掉卡片以后，键盘没有回到这一条上",
        );
        const back = await styleOf(page, "[data-issue]:has(button:focus-visible)", "outline-style");
        check(back === "solid", `关掉卡片以后这一行没有框线：${back}`);
      },
    },
    {
      do: "往下看",
      expect:
        "后端算出三样信号：反复被拦截的规矩、停在旧版本的项目、停了很多天的事。点信号里的项目，进那个项目的页。",
      run: async (w) => {
        const page = w.memo.get("page") as Page;
        const region = (name: string) => page.getByRole("region", { name });
        // 反复被拦截的规矩：写它查什么的一句话，不写编号，和最近一次被拦的原文。
        const blocked = region("被拦规矩");
        await blocked.getByText("一句不超过六十字").waitFor();
        const text = await blocked.innerText();
        check(text.includes("这一句有六十五字"), `没有写最近一次的原文：${text}`);
        // 停在旧版本的项目：没有迁移的写版本，没有版本时不写「没有记录」。
        const outdated = region("旧版项目");
        await outdated.getByRole("link", { name: "old" }).waitFor();
        check(!(await outdated.innerText()).includes("没有记录"), "版本没有时还写着「没有记录」");
        // 停了很多天的事：停了十天的阶段和事。
        await region("停滞阶段").getByText("第 1 版的构思阶段").waitFor();
        await region("停滞的事").getByText("补上使用阶段的截图").waitFor();
        // 点信号里的项目，进那个项目的页。在另一个窗口里点，这一步的截图留在信号上。
        const other = await openPage(w, new URL(page.url()).pathname);
        await other
          .getByRole("region", { name: "停滞的事" })
          .getByRole("link", { name: projectId(w) })
          .first()
          .click();
        await other.waitForURL(`**/p/${projectId(w)}`);
        await other.getByRole("heading", { name: projectId(w) }).waitFor();
        show(w, page);
      },
    },
  ],
};
