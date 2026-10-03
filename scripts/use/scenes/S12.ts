import type { Page } from "playwright-core";
import { openPage } from "../browser.ts";
import { check, type Scene } from "../lib.ts";
import { presentThink } from "../pages.ts";

// S12 在窄屏上看。用户，把浏览器放在半屏，一边看会话一边点页面时。
// 窗口窄了，一页也要能点完。窄屏上点不了，用户只能换回全屏。
// 摆的状态：第 1 版构思阶段的一页在等回复，一共 9 条要点。

/** 第一组还没选的选项在不在窗口里。 */
const firstOpenInView = `(() => {
  const group = [...document.querySelectorAll("main [role=radiogroup]")].find(
    (g) => g.querySelector("input:checked") === null,
  );
  if (group === undefined) return "没有没点的";
  const box = group.getBoundingClientRect();
  return box.top >= 0 && box.top < window.innerHeight ? "在" : "不在，top " + Math.round(box.top);
})()`;

/** 第一条还没点的那一条，它的开头离窗口顶多远。 */
const firstOpenTop = `(() => {
  const group = [...document.querySelectorAll("main [role=radiogroup]")].find(
    (g) => g.querySelector("input:checked") === null,
  );
  return group.closest("[data-item], section[id^=screen-]").getBoundingClientRect().top;
})()`;

/** 记下滚动事件，看是一步到位，还是一路滑过去。 */
const watchScroll = `(() => {
  window.__scrolls = [];
  window.addEventListener("scroll", () => window.__scrolls.push(Math.round(window.scrollY)));
})()`;

const scrollsSeen = (page: Page) => page.evaluate("window.__scrolls.length") as Promise<number>;

export const scene: Scene = {
  scene: "S12",
  setup: (w) => {
    w.memo.set("path", presentThink(w));
  },
  steps: [
    {
      do: "把窗口拉到 1000 宽，打开一页在等的回复",
      expect: "没有左边一栏，所有的屏依次往下排。顶上有「看未点的几条」。",
      run: async (w) => {
        const page = await openPage(w, w.memo.get("path") as string, 1000);
        w.memo.set("page", page);
        await page.getByRole("heading", { name: "第 1 版的构思阶段" }).waitFor();
        check((await page.viewportSize())?.width === 1000, "窗口不是 1000 宽");
        check(
          (await page.getByRole("navigation", { name: "这一页的每一条" }).count()) === 0,
          "1000 宽的窗口里还有左边一栏",
        );
        // 所有的屏依次往下排：每一屏都在前一屏的下面。
        const tops = (await page.evaluate(
          `[...document.querySelectorAll("main section[id^=screen-]")].map((s) => Math.round(s.getBoundingClientRect().top + scrollY))`,
        )) as number[];
        check(tops.length > 3, `屏没有依次往下排，只有 ${tops.length} 屏`);
        check(
          tops.every((top, i) => i === 0 || top > (tops[i - 1] ?? 0)),
          `各屏不是一屏在一屏下面：${tops.join("，")}`,
        );
        const bar = page.getByRole("button", { name: "看未点的 9 条" }).first();
        await bar.waitFor();
        const box = await bar.boundingBox();
        check(box !== null && box.y < 120, `看未点的几条不在顶上，y ${box?.y}`);
      },
    },
    {
      do: "点顶上的「看未点的几条」",
      expect: "滑到第一条还没点的，那一条贴在窗口顶上。",
      run: async (w) => {
        const page = w.memo.get("page") as Page;
        // 先把窗口里的点掉，第一条没点的就在窗口下面。
        const open = page.locator("main [role=radiogroup]:not(:has(input:checked))");
        while ((await page.evaluate(firstOpenInView)) === "在") {
          await open.first().locator("label").first().click();
          await page.evaluate("window.scrollTo({ top: 0, behavior: 'instant' })");
        }
        const left = await open.count();
        const bar = page.getByRole("button", { name: `看未点的 ${left} 条` }).first();
        await page.evaluate(watchScroll);
        await bar.click();
        await page.waitForFunction(`${firstOpenInView} === "在"`, undefined, { timeout: 5000 });
        // 平滑滚动要过一会儿才停，等滚动停下再量。
        await page.waitForFunction(
          `new Promise((done) => {
            const start = window.scrollY;
            setTimeout(() => done(window.scrollY === start), 300);
          })`,
        );
        w.memo.set("smooth", await scrollsSeen(page));
        const box = await bar.boundingBox();
        check(box !== null && box.y < 60, "滚动以后「看未点的几条」没有留在顶上");
        // 那一条贴在窗口顶上：开头（标题和表态）没有被顶上的栏盖住，也没有离顶上很远。
        const top = (await page.evaluate(firstOpenTop)) as number;
        check(top >= 36, `第一条没点的开头被顶上的栏盖住了，离窗口顶 ${Math.round(top)} 像素`);
        check(top < 120, `第一条没点的没有贴在窗口顶上，离窗口顶 ${Math.round(top)} 像素`);
      },
    },
    {
      do: "系统开了「减少动态效果」，再点一次",
      expect: "直接到位，不平滑滚动。",
      run: async (w) => {
        const page = w.memo.get("page") as Page;
        await page.emulateMedia({ reducedMotion: "reduce" });
        await page.evaluate("window.scrollTo({ top: 0, behavior: 'instant' })");
        const left = await page.locator("main [role=radiogroup]:not(:has(input:checked))").count();
        const bar = page.getByRole("button", { name: `看未点的 ${left} 条` }).first();
        await page.evaluate(watchScroll);
        await bar.click();
        await page.waitForFunction(`${firstOpenInView} === "在"`, undefined, { timeout: 5000 });
        await page.waitForTimeout(600);
        // 直接到位：滚动事件只有一两下，不是一路滑过去。没开减少动态效果时上一步是滑过去的。
        const jumps = await scrollsSeen(page);
        check(jumps <= 2, `开了减少动态效果，滚动还是分了 ${jumps} 次才到位`);
        const smooth = w.memo.get("smooth") as number;
        check(
          smooth > jumps,
          `没开减少动态效果时滚动 ${smooth} 次，开了以后是 ${jumps} 次，没有区别`,
        );
        const top = (await page.evaluate(firstOpenTop)) as number;
        check(top >= 36 && top < 120, `没有到位，第一条没点的离窗口顶 ${Math.round(top)} 像素`);
      },
    },
    {
      do: "把窗口拉到 1100 宽",
      expect: "左边一栏回来，一次只摆一屏。",
      run: async (w) => {
        const page = w.memo.get("page") as Page;
        await page.emulateMedia({ reducedMotion: "no-preference" });
        await page.setViewportSize({ width: 1100, height: 1000 });
        await page.getByRole("navigation", { name: "这一页的每一条" }).waitFor();
        // 一次只摆一屏。
        await page.locator("main section[id^=screen-]").first().waitFor();
        const screens = await page.locator("main section[id^=screen-]").count();
        check(screens === 1, `1100 宽时一次摆了 ${screens} 屏`);
        check(
          (await page.getByRole("button", { name: "下一屏" }).count()) === 1,
          "1100 宽时没有页面底下的「下一屏」",
        );
      },
    },
  ],
};
