import type { Page } from "playwright-core";
import { openPage, styleOf } from "../browser.ts";
import { check, expectRun, type Scene } from "../lib.ts";
import { presentThink } from "../pages.ts";

// S7 删改场景清单。用户，构思阶段定场景时。使用阶段要把场景逐个走一遍。删多了会漏测，留错了会白走。
// 构思的一页里有两个场景，都带编号：S9 看队列，和新加的 S32 导出队列。

const scene9 = "[data-item=look-at-queue]";
const exportScene = "[data-item=export-queue]";

// 配色 a：强调色 #0066db，删除的红色 #c62828，见 styles/theme.css。
const accent = "rgb(0, 102, 219)";
const del = "rgb(198, 40, 40)";

export const scene: Scene = {
  scene: "S7",
  setup: (w) => {
    w.memo.set(
      "path",
      presentThink(w, (page) => ({
        ...page,
        scenes: page.scenes.map((scene) =>
          scene.scene === undefined ? { ...scene, scene: "S32" } : scene,
        ),
      })),
    );
  },
  steps: [
    {
      do: "打开构思的那一页",
      expect: "场景清单单独一块，每个场景带编号，步骤摊开成一串格子。",
      run: async (w) => {
        const page = await openPage(w, `${w.memo.get("path")}?item=scenes`);
        w.memo.set("page", page);
        await page.getByRole("heading", { name: "场景清单" }).waitFor();
        // 场景清单单独一块：左边一栏里有「场景清单」这一组，里面是这两个场景。
        const nav = page.getByRole("navigation", { name: "这一页的每一条" });
        await nav.getByText("场景清单", { exact: true }).waitFor();
        await nav.getByRole("button", { name: "看队列" }).waitFor();
        await nav.getByRole("button", { name: "导出队列" }).waitFor();
        // 每个场景带编号，步骤摊开成一串格子，每格写第几步。
        for (const [selector, id, steps] of [
          [scene9, "S9", 2],
          [exportScene, "S32", 1],
        ] as const) {
          const text = await page.locator(selector).innerText();
          check(text.includes(id), `场景没有带编号 ${id}：「${text.slice(0, 120)}」`);
          for (let n = 1; n <= steps; n++) {
            check(
              text.includes(`第 ${n} 步`),
              `${id} 没有摊开第 ${n} 步：「${text.slice(0, 200)}」`,
            );
          }
        }
      },
    },
    {
      do: "点保留",
      expect: "左边这一条打勾，未点的少一条。选中的「保留」是蓝色。",
      run: async (w) => {
        const page = w.memo.get("page") as Page;
        await page.getByRole("button", { name: "看未点的 9 条" }).waitFor();
        await page.locator(scene9).locator("label", { hasText: "保留" }).click();
        const entry = page
          .getByRole("navigation", { name: "这一页的每一条" })
          .getByRole("button", { name: "看队列" });
        await entry.getByLabel("已点").waitFor();
        await page.getByRole("button", { name: "看未点的 8 条" }).waitFor();
        // 选中的保留是蓝色，和删除分开。颜色有过渡，等它走完。
        await page.waitForTimeout(300);
        const blue = await styleOf(page, `${scene9} label:has(input:checked)`, "color");
        check(blue === accent, `选中的保留是 ${blue}，应当是蓝色 ${accent}`);
      },
    },
    {
      do: "点修改",
      expect: "这一条下面出现输入框，写怎么改。没写内容时提交不能点。",
      run: async (w) => {
        const page = w.memo.get("page") as Page;
        await page.locator(exportScene).locator("label", { hasText: "修改" }).click();
        const box = page.locator(exportScene).getByPlaceholder("修改的内容");
        await box.waitFor();
        // 输入框在这一条的下面。
        const scene = await page.locator(exportScene).boundingBox();
        const field = await box.boundingBox();
        check(
          scene !== null && field !== null && field.y >= scene.y + scene.height / 2,
          "输入框不在这一条的下面",
        );
        // 没写内容时提交不能点，提示写明哪一条要写内容；写了内容才能点。
        const submit = page.getByRole("button", { name: "提交", exact: true });
        check(await submit.isDisabled(), "修改没写内容，提交却能点");
        await page.getByText("修改「导出队列」要写内容").waitFor();
        await box.fill("第 1 步改成点导出，选格式");
        check((await box.inputValue()).includes("选格式"), "输入框没有写进去");
        await page.getByText("点过的都已存下").waitFor();
        check(await submit.isEnabled(), "写了内容，提交还是不能点");
        check(
          (await page.getByText("修改「导出队列」要写内容").count()) === 0,
          "写了内容，提示还在",
        );
        await page.waitForTimeout(300);
      },
    },
    {
      do: "点删除",
      expect: "这一条变灰，选中的「删除」是红色，文字仍写着。",
      run: async (w) => {
        const page = w.memo.get("page") as Page;
        await page.locator(scene9).locator("label", { hasText: "删除" }).click();
        await page.waitForTimeout(300);
        const opacity = Number(await styleOf(page, scene9, "opacity"));
        check(opacity < 1, `删除以后不透明度是 ${opacity}`);
        // 决定 191：删除用红色，和保留、修改的蓝色分开。
        const selected = page.locator(`${scene9} label:has(input:checked)`);
        check((await selected.innerText()).trim() === "删除", "选中的不是删除");
        const red = await styleOf(page, `${scene9} label:has(input:checked)`, "color");
        check(red === del, `选中的删除是 ${red}，应当是红色 ${del}`);
        // 文字仍写着：场景的名字和步骤都还在。
        const text = await page.locator(scene9).innerText();
        check(text.includes("看队列") && text.includes("在项目页点队列"), "删除以后文字没有了");
      },
    },
    {
      do: "点提交",
      expect: "每个场景在回复里是一行，写场景的名字，和保留、修改或删除。",
      run: async (w) => {
        const page = w.memo.get("page") as Page;
        await page.getByRole("button", { name: "提交", exact: true }).click();
        await page.getByRole("dialog").getByRole("button", { name: "提交" }).click();
        await page.getByText("等 AI 取走").waitFor();
        const waiting = w.launch(["reply", "wait", "--timeout", "30"]);
        await page.getByText("AI 已收到").waitFor({ timeout: 10_000 });
        const reply = await waiting.done;
        expectRun(reply, 0, "看队列", "删除", "导出队列", "修改");
        // 每个场景一行：点过的两个场景各一行，行里写场景的名字和点的是哪一样。
        const rows = reply.stdout.split("\n");
        const rowOf = (name: string) => rows.filter((row) => row.includes(name));
        check(
          rowOf("看队列").length === 1 && rowOf("看队列")[0]?.includes("删除") === true,
          `看队列没有一行写删除：${reply.stdout.trim()}`,
        );
        check(
          rowOf("导出队列").length === 1 && rowOf("导出队列")[0]?.includes("修改") === true,
          `导出队列没有一行写修改：${reply.stdout.trim()}`,
        );
        check(reply.stdout.includes("第 1 步改成点导出，选格式"), "修改的内容没有写进回复");
      },
    },
  ],
};
