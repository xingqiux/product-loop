import type { Page } from "playwright-core";
import { openPage, styleOf } from "../browser.ts";
import { check, type Scene } from "../lib.ts";
import { presentThink } from "../pages.ts";

// S8 删改设计规范。用户，构思阶段定外观时。检查阶段逐屏对着设计规范查，值不对就查不出对错。

export const scene: Scene = {
  scene: "S8",
  setup: (w) => {
    w.memo.set("path", presentThink(w));
  },
  steps: [
    {
      do: "打开构思的那一页",
      expect:
        "设计规范是一面样张墙：色块、真实大小的字、真实大小的圆角和间距。每一项写着用在哪里。",
      run: async (w) => {
        const page = await openPage(w, `${w.memo.get("path")}?item=spec`);
        w.memo.set("page", page);
        await page.getByRole("heading", { name: "设计规范" }).waitFor();
        await page.locator("[data-item=palette]").getByText("#0066db").waitFor();
        const size = await styleOf(page, "[data-item=type-scale] [data-sample]", "font-size");
        check(size === "14px", `字号的样张是 ${size}`);
        const radius = await styleOf(
          page,
          "[data-item=radius] [data-radius='8']",
          "border-top-left-radius",
        );
        check(radius === "8px", `圆角的样张是 ${radius}`);
        const gap = await styleOf(page, "[data-item=spacing] [data-spacing='16']", "width");
        check(gap === "16px", `间距的样张是 ${gap}`);
        // 每一项写着用在哪里。
        for (const [item, use] of [
          ["palette", "整个工作台"],
          ["type-scale", "正文"],
          ["radius", "卡片"],
          ["spacing", "卡片之间"],
          ["screen-motion", "每个阶段的页面"],
        ] as const) {
          const text = await page.locator(`[data-item=${item}]`).innerText();
          check(
            text.includes(use),
            `「${item}」没有写用在哪里（${use}）：「${text.slice(0, 120)}」`,
          );
        }
      },
    },
    {
      do: "点一个动效的样张",
      expect: "小方块按样张上写的时长动一下，例如换一屏 220 毫秒。",
      run: async (w) => {
        const page = w.memo.get("page") as Page;
        const sample = page.locator("[data-item=screen-motion]").getByRole("button", {
          name: /换一屏/u,
        });
        const written = Number(/(\d+) 毫秒/u.exec(await sample.innerText())?.[1]);
        check(written === 220, `样张上写的是 ${written} 毫秒，应当是换一屏的 220 毫秒`);
        await sample.click();
        const duration = await page.evaluate(
          `document.querySelector("[data-item=screen-motion] button i").getAnimations().at(-1)?.effect.getTiming().duration ?? 0`,
        );
        check(duration === written, `小方块动了 ${duration} 毫秒，样张上写的是 ${written} 毫秒`);
        // 等这一次动画走完再截图。
        await page.waitForTimeout(500);
      },
    },
    {
      do: "系统开了「减少动态效果」，再点动效的样张",
      expect: "小方块只变透明度，不位移。",
      run: async (w) => {
        const page = w.memo.get("page") as Page;
        await page.emulateMedia({ reducedMotion: "reduce" });
        await page
          .locator("[data-item=screen-motion]")
          .getByRole("button", { name: /换一屏/u })
          .click();
        // 看这一次动画动了哪些属性：只有透明度，没有 transform 这样的位移。
        const moved = (await page.evaluate(`(() => {
          const a = document.querySelector("[data-item=screen-motion] button i").getAnimations().at(-1);
          const keys = new Set(a ? a.effect.getKeyframes().flatMap((f) => Object.keys(f)) : []);
          for (const k of ["offset", "computedOffset", "easing", "composite"]) keys.delete(k);
          return [...keys];
        })()`)) as string[];
        check(
          moved.every((key) => key === "opacity"),
          `系统开了「减少动态效果」，小方块动的属性是 ${moved.join("、")}，应当只有 opacity`,
        );
        await page.waitForTimeout(500);
      },
    },
    {
      do: "点保留、修改或删除",
      expect: "左边这一项打勾。修改的出输入框，删除的变灰。",
      run: async (w) => {
        const page = w.memo.get("page") as Page;
        await page.emulateMedia({ reducedMotion: "no-preference" });
        const nav = page.getByRole("navigation", { name: "这一页的每一条" });
        await page.locator("[data-item=palette]").locator("label", { hasText: "保留" }).click();
        await nav.getByRole("button", { name: "配色" }).getByLabel("已点").waitFor();
        await page
          .locator("[data-item=screen-motion]")
          .locator("label", { hasText: "修改" })
          .click();
        const box = page.locator("[data-item=screen-motion]").getByPlaceholder("修改的内容");
        await box.waitFor();
        await box.fill("换一屏改成 200 毫秒");
        await nav.getByRole("button", { name: "换一屏的动效" }).getByLabel("已点").waitFor();
        await page.locator("[data-item=type-scale]").locator("label", { hasText: "删除" }).click();
        await nav.getByRole("button", { name: "字号" }).getByLabel("已点").waitFor();
        await page.waitForTimeout(300);
        const opacity = Number(await styleOf(page, "[data-item=type-scale]", "opacity"));
        check(opacity < 1, `删除以后不透明度是 ${opacity}`);
      },
    },
  ],
};
