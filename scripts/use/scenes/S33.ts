import type { Page } from "playwright-core";
import { openPage } from "../browser.ts";
import { check, type Scene } from "../lib.ts";
import { presentThink } from "../pages.ts";

// S33 读构思页上的参考和图表。用户，构思阶段的页上，AI 查过外面的资料、画了图时。
// 要看 AI 的建议凭什么，才敢定。资料写错或图画错，用户会照着错的依据定，事后要求修。
// 摆的状态：构思阶段的一页，参考十条（先摆八条，其余折起来），第一张疑问卡带三张图表：
// 一张流程图（交给 Mermaid 画）、一张目录树（等宽文字）、一张写坏的流程图（画不出来）。

const kinds = ["书", "文章", "规范", "产品", "开源项目", "研究"] as const;
const advices = ["采用", "试用", "观察", "不用"] as const;

/** 按下标循环取一个：下标超出时从头再来。 */
const cycle = <T>(list: readonly T[], i: number): T => list[i % list.length] as T;

/** 十条参考，名字各不相同，每条五个属性都写了。 */
const refs = Array.from({ length: 10 }, (_, i) => ({
  name: `参考资料${i + 1}`,
  kind: cycle(kinds, i),
  depth: i % 2 === 0 ? "已读原文" : "仅摘要",
  relevance: cycle(["高", "中", "低"] as const, i),
  strength: cycle(["强", "中", "弱"] as const, i),
  advice: cycle(advices, i),
  body: `第 ${i + 1} 条讲了看板怎么分列。这个项目用到了按状态分列。`,
  where: `队列看板的第 ${i + 1} 种排法`,
}));

const flowTitle = "看板的读取路径";
const treeTitle = "页面的四层";
const brokenTitle = "写坏的图";
const brokenCode = "flowchart LR\n A[[[ -->> ??";

const diagrams = [
  { kind: "流程图", title: flowTitle, code: "flowchart LR\n A[项目页] --> B[队列看板]" },
  { kind: "目录树", title: treeTitle, code: "页\n└ 区块\n  └ 卡" },
  { kind: "流程图", title: brokenTitle, code: brokenCode },
];

/** 左边一栏。 */
const sidebar = (page: Page) => page.getByRole("navigation", { name: "这一页的每一条" });

/** 展示图表的那一块：标题写在 figcaption 里。 */
const figureOf = (page: Page, title: string) =>
  page.locator("figure", { has: page.locator("figcaption", { hasText: title }) });

/** 参考这一屏里的每一行。 */
const rowsOf = (page: Page) => page.locator("main ul.divide-y > li");

export const scene: Scene = {
  scene: "S33",
  setup: (w) => {
    const path = presentThink(w, (think) => ({
      ...think,
      refs,
      asks: think.asks.map((ask, i) =>
        i === 0 ? { ...ask, shared: { ...ask.shared, diagrams } } : ask,
      ),
    }));
    w.memo.set("path", path);
  },
  steps: [
    {
      do: "打开构思的页，点左边的「参考」",
      expect: "每条参考一行，写名称、类型和建议。没有要点的选项，不算在没点的几条里。",
      run: async (w) => {
        const page = await openPage(w, w.memo.get("path") as string);
        w.memo.set("page", page);
        const nav = sidebar(page);
        await nav.getByRole("button", { name: "参考", exact: true }).click();
        await page.getByRole("heading", { name: "参考", exact: true }).waitFor();
        // 每条一行：写名称、类型和建议。
        await rowsOf(page).first().waitFor();
        const first = await rowsOf(page).first().innerText();
        for (const want of [refs[0]?.name ?? "", refs[0]?.kind ?? "", refs[0]?.advice ?? ""]) {
          check(want !== "" && first.includes(want), `第一条参考这一行没有「${want}」：${first}`);
        }
        // 只看，没有要点的选项：这一屏里没有单选、没有输入框。
        const block = page.locator("xpath=//main//h2[normalize-space()='参考']/ancestor::div[1]");
        const inputs = await block.locator("input, textarea, [role=radio]").count();
        check(inputs === 0, `参考这一屏里有 ${inputs} 个要点的东西`);
        // 参考在左边一栏里没有圆点，不算在没点的几条里：「看未点的 N 条」的 N 等于有圆点的行数。
        const dotted = nav.getByRole("button").filter({ has: page.locator("span.rounded-full") });
        const refEntry = nav.getByRole("button", { name: "参考", exact: true });
        check(
          (await refEntry.locator("span.rounded-full").count()) === 0,
          "左边一栏的「参考」有圆点，被当成要点的一条",
        );
        const label = await page.getByRole("button", { name: /看未点的 \d+ 条/u }).innerText();
        const unpicked = Number(/\d+/u.exec(label)?.[0]);
        const dots = await dotted.count();
        check(
          unpicked === dots && unpicked > 0,
          `看未点的是 ${unpicked} 条，左边有圆点的是 ${dots} 行，参考被算进去了`,
        );
      },
    },
    {
      do: "按一条参考",
      expect:
        "出展示卡片，写类型、阅读深度、相关度、证据强度、建议和用在哪里，下面是正文。Esc 关掉。",
      run: async (w) => {
        const page = w.memo.get("page") as Page;
        const target = refs[2];
        if (target === undefined) throw new Error("没有摆第三条参考");
        await rowsOf(page).nth(2).getByRole("button").click();
        const sheet = page.getByRole("dialog");
        await sheet.waitFor();
        check(
          (await sheet.getByRole("heading", { name: target.name }).count()) === 1,
          "展示卡片的标题不是这一条参考的名称",
        );
        const text = await sheet.innerText();
        const wants: [string, string][] = [
          ["类型", target.kind],
          ["阅读深度", target.depth],
          ["相关度", target.relevance],
          ["证据强度", target.strength],
          ["建议", target.advice],
          ["用在", target.where],
        ];
        for (const [name, value] of wants) {
          const row = sheet.locator("dl > div", { has: page.locator("dt", { hasText: name }) });
          const got = (await row.locator("dd").innerText()).trim();
          check(got === value, `展示卡片里「${name}」写的是「${got}」，应当是「${value}」`);
        }
        // 下面是正文。
        check(text.includes(target.body.split("。")[0] ?? ""), `展示卡片里没有正文：${text}`);
        await page.keyboard.press("Escape");
        await sheet.waitFor({ state: "hidden" });
      },
    },
    {
      do: "参考多于八条",
      expect: "先摆八条，下面写「展开其余几条」。按下，其余的接着摆出来。",
      run: async (w) => {
        const page = w.memo.get("page") as Page;
        check((await rowsOf(page).count()) === 8, `先摆的不是八条：${await rowsOf(page).count()}`);
        const more = page.getByRole("button", { name: /^展开其余 \d+ 条$/u });
        const rest = refs.length - 8;
        check(
          (await more.innerText()).includes(`展开其余 ${rest} 条`),
          `展开的按钮写的是「${await more.innerText()}」`,
        );
        await more.click();
        await rowsOf(page)
          .nth(refs.length - 1)
          .waitFor();
        check((await rowsOf(page).count()) === refs.length, "按下以后没有摆出全部的参考");
        check((await more.count()) === 0, "全部摆出来以后还有「展开其余」");
        const last = await rowsOf(page).last().innerText();
        check(last.includes(refs.at(-1)?.name ?? ""), `最后一条不是第十条：${last}`);
      },
    },
    {
      do: "读带图表的疑问卡",
      expect: "流程图画成图，目录树写成等宽的文字。每张图上写种类和标题。",
      run: async (w) => {
        const page = w.memo.get("page") as Page;
        await sidebar(page).getByRole("button", { name: "队列看板放在哪里" }).click();
        const flow = figureOf(page, flowTitle);
        // Mermaid 是页面里动态加载的，画好以后才有 svg。
        await flow.locator("svg").first().waitFor({ timeout: 30_000 });
        check((await flow.locator("pre").count()) === 0, "流程图画好以后还留着文字定义");
        check(
          (await flow.locator("figcaption").innerText()).replace(/\s+/gu, "") ===
            `流程图${flowTitle}`,
          `流程图上没有写种类和标题：${await flow.locator("figcaption").innerText()}`,
        );
        // 目录树：等宽的文字，不交给 Mermaid，没有 svg。
        const tree = figureOf(page, treeTitle);
        await tree.waitFor();
        check((await tree.locator("svg").count()) === 0, "目录树被画成了图");
        const pre = tree.locator("pre");
        check(
          (await pre.innerText()).includes("└ 区块"),
          `目录树的文字不对：${await pre.innerText()}`,
        );
        const family = (await page.evaluate(`(() => {
          for (const figure of document.querySelectorAll("figure")) {
            const caption = figure.querySelector("figcaption");
            if (caption?.textContent?.includes(${JSON.stringify(treeTitle)})) {
              return getComputedStyle(figure.querySelector("pre")).fontFamily;
            }
          }
          return "";
        })()`)) as string;
        check(/mono/iu.test(family), `目录树不是等宽字体：${family}`);
        check(
          (await tree.locator("figcaption").innerText()).replace(/\s+/gu, "") ===
            `目录树${treeTitle}`,
          `目录树上没有写种类和标题：${await tree.locator("figcaption").innerText()}`,
        );
        // 截图要看得到图：滚到流程图那里。
        await flow.evaluate((figure) => figure.scrollIntoView({ block: "center" }));
      },
    },
    {
      do: "图表的文字定义写坏了，画不出来",
      expect: "这一张显示文字定义本身，不留空白。别的图照常。",
      run: async (w) => {
        const page = w.memo.get("page") as Page;
        const broken = figureOf(page, brokenTitle);
        await broken.waitFor();
        // 流程图已经画好了，说明 Mermaid 已经加载、也试过画这一张：稍等，让它画完。
        await figureOf(page, flowTitle).locator("svg").first().waitFor();
        await page.waitForTimeout(500);
        check((await broken.locator("svg").count()) === 0, "写坏的图被画出了一张图");
        const pre = broken.locator("pre");
        await pre.waitFor();
        const shown = (await pre.innerText()).replace(/\s+/gu, " ").trim();
        check(
          shown === brokenCode.replace(/\s+/gu, " ").trim(),
          `写坏的这张没有显示文字定义本身：「${shown}」`,
        );
        // 标题还在，不留空白。
        check(
          (await broken.locator("figcaption").innerText()).includes(brokenTitle),
          "写坏的这张没有标题",
        );
        // 别的图照常：流程图还是图，目录树还是文字。
        check(
          (await figureOf(page, flowTitle).locator("svg").count()) > 0,
          "写坏了一张，别的流程图也画不出来了",
        );
        check(
          (await figureOf(page, treeTitle).locator("pre").count()) === 1,
          "写坏了一张，目录树也不对了",
        );
        await broken.scrollIntoViewIfNeeded();
      },
    },
  ],
};
