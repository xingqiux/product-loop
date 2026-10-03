import { join } from "node:path";
import type { Page } from "playwright-core";
import { openPage, show } from "../browser.ts";
import { check, expectRun, type Scene, started } from "../lib.ts";
import { projectId } from "../pages.ts";

// S20 报 skill 的问题。AI，用户同意把 skill 的问题报上去时。问题要回到维护 skill 的地方。只留在会话里，维护的人不知道。
// 摆的状态：项目 app 开着第 1 版的构思阶段；另有一个叫 product-loop 的项目，是维护 skill 的会话所在的地方，
// 处理问题只在产品循环自己的项目里放行。第 1 步和第 3 步在工作台的 skill 问题页上核对。

const example = "疑问卡 a 写了九行，右边的线稿被挤到了下面";

export const scene: Scene = {
  scene: "S20",
  setup: (w) => {
    started(w);
    expectRun(w.ploop(["queue", "add", "理清给谁用", "--stage", "构思"]), 0);
    expectRun(w.ploop(["round", "start", "构思"]), 0);
    // 维护 skill 的会话所在的项目，和 app 在同一个临时家目录下。
    w.write("../product-loop/.keep", "");
    expectRun(w.ploop(["init", "--repo", "自己的"], join(w.root, "..", "product-loop")), 0);
  },
  steps: [
    {
      do: "敲 ploop skill report，写方面和问题的类",
      expect: "打印问题的编号，工作台的 skill 问题页出现这一条。缺必填项时退出码 2，写明缺什么。",
      run: async (w) => {
        // 缺必填项：退出码 2，写明缺的是哪一项。
        expectRun(w.ploop(["skill", "report", "--aspect", "页面"]), 2, "缺少必填的选项 --class");
        const reported = w.ploop([
          "skill",
          "report",
          "--aspect",
          "页面",
          "--class",
          "选项卡太长",
          "--example",
          example,
        ]);
        expectRun(reported, 0, "报上了：问题 1", "页面：选项卡太长");
        // 工作台的 skill 问题页出现这一条：项目、阶段、方面、类和状态。
        const page = await openPage(w, "/");
        w.memo.set("page", page);
        await page.getByRole("link", { name: "skill 的问题" }).click();
        const row = page.locator("[data-issue='1']");
        await row.waitFor();
        const text = await row.innerText();
        for (const want of [projectId(w), "第 1 版的构思阶段", "页面", "选项卡太长", "新"]) {
          check(text.includes(want), `这一行没有「${want}」：${text}`);
        }
      },
    },
    {
      do: "维护 skill 的会话敲 ploop skill issues",
      expect: "列出新报上来的问题，每条写哪个项目、哪个阶段。",
      run: (w) => {
        const listed = w.ploop(["skill", "issues"], join(w.root, "..", "product-loop"));
        expectRun(
          listed,
          0,
          "skill 的问题：1 条",
          "1  新  app  第 1 版的构思阶段  页面：选项卡太长",
          `例子：${example}`,
        );
      },
    },
    {
      do: "在产品循环自己的项目里敲 ploop skill issues reply，写理解",
      expect: "问题页上这一条的状态变成「已理解」。",
      run: async (w) => {
        const page = w.memo.get("page") as Page;
        show(w, page);
        expectRun(
          w.ploop(
            ["skill", "issues", "reply", "1", "选项卡要限定行数，超出的放进展开"],
            join(w.root, "..", "product-loop"),
          ),
          0,
          "回了理解：问题 1",
        );
        const row = page.locator("[data-issue='1']");
        await row.getByText("已理解").waitFor();
        check(!(await row.innerText()).includes("新"), "状态还写着「新」");
      },
    },
    {
      do: "在别的项目里敲 ploop skill issues reply",
      expect: "退出码 1，写明只有维护者能处理。别的项目只能用 ploop skill report 报问题。",
      run: (w) => {
        // app 是别的项目，不是产品循环自己的项目。
        const blocked = w.ploop(["skill", "issues", "reply", "1", "我也想回一句"]);
        expectRun(
          blocked,
          1,
          "只有维护者能处理 skill 的问题",
          "别的项目只能用 ploop skill report 报问题",
          "skill.issues.maintainer",
        );
        // 拦下的命令什么也没改：问题还是「已理解」，回的理解还是维护者写的那一句。
        const listed = w.ploop(["skill", "issues", "--status", "已理解"]);
        expectRun(listed, 0, "1  已理解", "选项卡要限定行数，超出的放进展开");
        check(!listed.stdout.includes("我也想回一句"), "拦下的回复还是写进去了");
      },
    },
    {
      do: "维护 skill 的会话敲 ploop skill issues set，改成已改，写 --fixed-in",
      expect:
        "问题页上状态变成「已改」。卡片里写改在哪一版。不写 --fixed-in 时退出码 2，写明缺什么。",
      run: async (w) => {
        const maintainer = join(w.root, "..", "product-loop");
        // 改成已改要写在哪一版改的：不写 --fixed-in，退出码 2，写明缺什么，状态没变。
        expectRun(
          w.ploop(["skill", "issues", "set", "1", "已改"], maintainer),
          2,
          "要写在哪一版改的",
          "写上 skill 的版本",
        );
        expectRun(w.ploop(["skill", "issues", "--status", "已理解"], maintainer), 0, "1  已理解");
        expectRun(
          w.ploop(["skill", "issues", "set", "1", "已改", "--fixed-in", "0.0.2"], maintainer),
          0,
          "改了状态：问题 1 现在是「已改」",
        );
        // 工作台的问题页：这一条的状态变成「已改」，展示卡片里写改在哪一版。
        const page = w.memo.get("page") as Page;
        show(w, page);
        const row = page.locator("[data-issue='1']");
        await row.getByText("已改", { exact: true }).waitFor();
        check(!(await row.innerText()).includes("已理解"), "状态还写着「已理解」");
        await row.getByRole("button").first().click();
        const sheet = page.getByRole("dialog");
        await sheet.getByText("改的版本", { exact: true }).waitFor();
        const text = await sheet.innerText();
        check(text.includes("0.0.2"), `卡片里没有写改在哪一版：${text}`);
        check(text.includes("已改"), `卡片里的状态不是「已改」：${text}`);
        await page.keyboard.press("Escape");
        await sheet.waitFor({ state: "hidden" });
      },
    },
  ],
};
