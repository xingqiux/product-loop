import { join } from "node:path";
import type { Page } from "playwright-core";
import { openPage } from "../browser.ts";
import { check, expectRun, type Scene, type World } from "../lib.ts";
import { presentThink, projectId } from "../pages.ts";

// S22 在半屏窗口上看各页。用户，把浏览器放在半屏，一边看会话一边看各页时。
// 七百到一千一百像素宽，页面不能破版：首页、项目页、队列、主线、决定、skill 的问题、一页在等的回复
// 都不出横向滚动条。摆了两个项目：app 有一页在等；另一个项目的名字和目录都很长。
// 步骤自己的宽度是 700 和 1024，运行器在自己的宽度截图，再多截 1440 和 700。

type Step = Scene["steps"][number];

/** 四个选项的一张卡，行名和内容都长，半屏放不下并排的表，要改成一个选项一张卡。 */
const wide = {
  id: "four-ways",
  title: "半屏窗口里要摆得下的四种放法",
  why: "选项多，每一行的内容也长，并排放不下的时候要摞起来。",
  sources: [{ name: "用户说的", saw: "「半屏的窗口里表格拖不动」", quote: true }],
  shared: { text: "四种放法都保留五列看板。" },
  rows: ["放在哪里", "改动的范围"],
  options: ["a", "b", "c", "d"].map((key) => ({
    key,
    title: `第 ${key} 种放法的名字写得长一些`,
    diffs: [`把看板放在第 ${key} 个位置，位置的名字写长一点。`, "只改这一页，别的页不动。"],
    why: "每一页都能看到队列，不用先点进去，也不用回到项目页再找。",
    cost: "页面变长，滚动的距离更远，手要多动几次。",
    when: "用户每个阶段都想看队列的时候。",
  })),
  stance: { pick: "a", because: "用户每一页都要看到队列。" },
};

/** 横向滚动的地方：整页能往右拖，或者里面某一块能往右拖。 */
const scrollables = `(() => {
  const found = [];
  for (const el of document.querySelectorAll("body *")) {
    const overflow = getComputedStyle(el).overflowX;
    if ((overflow === "auto" || overflow === "scroll") && el.scrollWidth > el.clientWidth + 1) {
      found.push(el.tagName.toLowerCase() + " " + el.scrollWidth + ">" + el.clientWidth);
    }
  }
  const page = document.documentElement;
  if (page.scrollWidth > page.clientWidth + 1) found.push("整页 " + page.scrollWidth + ">" + page.clientWidth);
  return found;
})()`;

/** 打开一页，等它读完，核对没有横向滚动。 */
async function noSideScroll(page: Page, url: string, ready: () => Promise<unknown>, at: string) {
  await page.goto(url);
  await ready();
  // 页面里的图和字体读完再量。
  await page.waitForLoadState("networkidle");
  const found = (await page.evaluate(scrollables)) as string[];
  check(
    found.length === 0,
    `${at} 宽的「${decodeURIComponent(url)}」有横向滚动：${found.join("；")}`,
  );
}

export const scene: Scene = {
  scene: "S22",
  setup: async (w) => {
    const path = presentThink(w, (think) => ({ ...think, asks: [wide, ...think.asks] }));
    w.memo.set("path", path);
    // 主线里加一张宽表和一行没有空格的长字，半屏的窗口里表要缩窄，长字要换行。
    const table = [
      "| 名字 | 说明 | 位置 |",
      "| --- | --- | --- |",
      "| 第一列的名字 | 这一列写得比较长，长到窄的窗口里要换行才放得下 | packages/web/src/features/queue/board.tsx |",
      "| 第二列的名字 | 另一段说明 | 一个很长很长很长很长很长很长很长很长很长很长很长的没有空格的词 |",
    ].join("\n");
    w.write(".product-loop/主线.md", `${w.read(".product-loop/主线.md").trimEnd()}\n\n${table}\n`);
    expectRun(w.ploop(["mainline", "push"]), 0);
    // 另一个项目：名字和目录名都很长，页头的位置一栏要截断。
    const longName = "a-project-with-a-really-long-name-to-check-the-header-at-half-width";
    const other = join(w.root, "..", longName);
    w.write(`../${longName}/.keep`, "");
    expectRun(w.ploop(["init", "--repo", "自己的"], other), 0);
    w.write(`../${longName}/.product-loop/主线.md`, w.read(".product-loop/主线.md"));
    expectRun(
      w.ploop(
        [
          "queue",
          "add",
          "取消一项以后，看不出原因要写在哪里，这一句写得很长很长",
          "--stage",
          "落地",
        ],
        other,
      ),
      0,
    );
    w.memo.set("other", longName);
    // 一条 skill 的问题，项目名很长。
    const otherId = (
      JSON.parse(w.ploop(["status", "--json"], other).stdout) as {
        data: { project: { id: string } };
      }
    ).data.project.id;
    w.memo.set("otherId", otherId);
    await w.api("POST", "/skill/issues", {
      project: otherId,
      aspect: "页面",
      issueClass: "半屏的窗口里表格拖不动",
      example: "首页的表格要往右拖才看得全",
    });
  },
  steps: [
    {
      do: "把窗口拉到 700 宽，打开首页",
      expect: "每个项目一张卡，没有横向滚动条。",
      run: async (w) => {
        const page = await openPage(w, "/", 700);
        w.memo.set("page", page);
        await page.getByRole("link", { name: "打开这一页" }).waitFor();
        await noSideScroll(page, w.url("/"), () => page.getByText("打开这一页").waitFor(), "700");
        check((await page.getByRole("table").count()) === 0, "半屏的首页还是一张表");
        check((await page.locator("main li").count()) === 2, "应当是两个项目两张卡");
      },
    },
    projectsAt(700, {
      do: "打开项目页、队列、主线、决定、skill 的问题",
      expect: "都没有横向滚动条。页头的「目录」一栏和阶段条不拆字，长路径在值里折行。",
    }),
    replyAt(700, {
      do: "打开一页在等的回复",
      expect: "退回一张长页，没有左边一栏。选项多的卡摞成一个选项一张，没有横向滚动条。",
    }),
    projectsAt(1024, {
      do: "把窗口拉到 1024 宽，再打开项目页、队列、主线、决定、skill 的问题",
      expect: "都没有横向滚动条。",
    }),
    replyAt(1024, {
      do: "打开同一页在等的回复",
      expect: "没有横向滚动条，提交在页面底下。",
    }),
  ],
};

/** 步骤的文字，照主线。 */
type Words = { readonly do: string; readonly expect: string };

/** 在这个宽度下打开项目页、队列、主线、决定、skill 的问题。 */
function projectsAt(width: number, words: Words): Step {
  return {
    ...words,
    run: async (w: World) => {
      const page = w.memo.get("page") as Page;
      await page.setViewportSize({ width, height: 1000 });
      const pid = projectId(w);
      const other = w.memo.get("otherId") as string;
      const at = String(width);
      await noSideScroll(page, w.url("/"), () => page.getByText("打开这一页").waitFor(), at);
      for (const id of [pid, other]) {
        const base = `/p/${encodeURIComponent(id)}`;
        await noSideScroll(
          page,
          w.url(base),
          () => page.getByRole("heading", { name: "进度" }).waitFor(),
          at,
        );
        await noSideScroll(
          page,
          w.url(`${base}/queue`),
          () => page.getByText("落地").first().waitFor(),
          at,
        );
        await noSideScroll(
          page,
          w.url(`${base}/decisions`),
          () => page.getByRole("textbox", { name: "搜索决定" }).waitFor(),
          at,
        );
      }
      await noSideScroll(
        page,
        w.url(`/p/${pid}/mainline`),
        () => page.getByText("第一列的名字").waitFor(),
        at,
      );
      await noSideScroll(page, w.url("/skill"), () => page.getByText(other).first().waitFor(), at);
      // 页头：阶段条的每个阶段名在一行里，「目录」两个字不被挤成竖排，长路径在值里折行。
      await page.goto(w.url(`/p/${encodeURIComponent(other)}`));
      const strip = page.getByRole("list", { name: "阶段" }).getByText("构思", { exact: true });
      await strip.waitFor();
      const box = await strip.boundingBox();
      check(box !== null && box.height < 30, `阶段名被拆成了两行，高 ${box?.height}`);
      const label = page.locator("dt", { hasText: "目录" });
      // 格子会跟着值一起拉高，量文字自己占几行：两个字在同一行才没有拆字。
      const labelLines = (await page.evaluate(`(() => {
        const el = [...document.querySelectorAll("dt")].find((dt) => dt.textContent.includes("目录"));
        const range = document.createRange();
        range.selectNodeContents(el);
        return new Set([...range.getClientRects()].map((rect) => Math.round(rect.top))).size;
      })()`)) as number;
      const labelBox = await label.boundingBox();
      check(labelLines === 1 && labelBox !== null && labelBox.width >= 24, "「目录」拆成了几行");
      const value = page.locator("dd", { hasText: other });
      const valueBox = await value.boundingBox();
      check(valueBox !== null && valueBox.x + valueBox.width <= width, "长路径伸出了窗口");
      // 半屏的宽度放不下这条长路径，值要折成好几行；一千零二十四宽不要求折行。
      if (width <= 700) {
        check(
          valueBox !== null && valueBox.height > 30,
          `长路径没有折行，值只有 ${valueBox?.height} 高`,
        );
      }
      // 页头右边的入口还在窗口里，没有被挤出去。
      const skill = await page.getByRole("link", { name: "skill 的问题" }).boundingBox();
      check(skill !== null && skill.x + skill.width <= width, "页头右边的入口被挤出了窗口");
    },
  };
}

/** 在这个宽度下打开一页在等的回复。 */
function replyAt(width: number, words: Words): Step {
  return {
    ...words,
    run: async (w: World) => {
      const page = w.memo.get("page") as Page;
      const path = w.memo.get("path") as string;
      await noSideScroll(
        page,
        w.url(path),
        () => page.getByText("第 a 种放法的名字写得长一些").first().waitFor(),
        String(width),
      );
      check(
        (await page.getByRole("navigation", { name: "这一页的每一条" }).count()) === 0,
        "半屏的窗口里还有左边一栏",
      );
      const submit = page.getByRole("button", { name: "提交", exact: true });
      await submit.waitFor();
      if (width <= 700) {
        // 四个选项摞成一个选项一张卡：左边对齐，一个在一个下面。
        const cards = await Promise.all(
          ["a", "b", "c", "d"].map((key) =>
            page
              .locator("label", {
                has: page.getByRole("radio", { name: new RegExp(`第 ${key} 种`, "u") }),
              })
              .boundingBox(),
          ),
        );
        for (const [i, card] of cards.entries()) {
          check(card !== null, `第 ${i + 1} 个选项没有画出来`);
          const before = cards[i - 1];
          if (card === null || before === undefined || before === null) continue;
          check(
            Math.abs(card.x - before.x) < 2 && card.y >= before.y + before.height - 1,
            `第 ${i + 1} 个选项没有摞在上一个下面：${JSON.stringify([before, card])}`,
          );
        }
      } else {
        // 提交在页面底下：滚到页面最底，提交按钮贴着窗口下沿，不在页面中间。
        await page.evaluate("window.scrollTo(0, document.documentElement.scrollHeight)");
        const box = await submit.boundingBox();
        const height = page.viewportSize()?.height ?? 1000;
        check(
          box !== null && box.y + box.height <= height && box.y > height / 2,
          `提交不在页面底下：${JSON.stringify(box)}`,
        );
      }
    },
  };
}
