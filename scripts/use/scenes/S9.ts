import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Page } from "playwright-core";
import { openPage, styleOf } from "../browser.ts";
import { check, expectRun, type Scene } from "../lib.ts";
import { presentThink, projectId } from "../pages.ts";

// S9 看队列。用户，想知道还有哪些事没做时。要定这个阶段做哪几件，哪几件不做了。
// 看板和实际不一致，用户会漏做或重做。
// 摆的状态：Q1 构思，Q2 提升（等别的事，这一阶段的页里能取消它），Q3 检查（停了十天），Q4 到 Q13 十件提升。
// 提升一列有十件，上面另有一件等待，列头写「10，另有 1 件等待」。

type Waiting = ReturnType<Parameters<Scene["steps"][number]["run"]>[0]["launch"]>;

const dayMs = 24 * 60 * 60 * 1000;

/** 一句超过 40 个字的内容：放进队列和改内容都会被拦下。 */
const tooLong =
  "队列看板按阶段分五列，等待的事放在最上面，停了七天的卡片显示得淡一些，点开卡片能看到各项属性";

const boardStages = ["构思", "使用", "检查", "落地", "提升"];

export const scene: Scene = {
  scene: "S9",
  setup: (w) => {
    w.memo.set("path", presentThink(w));
    // 细节写在备注里，内容只写一句名字。
    expectRun(
      w.ploop([
        "queue",
        "add",
        "看板停了七天的卡片要淡一些",
        "--stage",
        "检查",
        "--note",
        "停了七天没人动的事，卡片颜色淡一些。\n七天从最近一次变动算起。",
      ]),
      0,
    );
    // 内容超过 40 个字：放进去和改内容都拦下，写明字数，提示把细节写进 --note，队列里不多出一件。
    expectRun(
      w.ploop(["queue", "add", tooLong, "--stage", "检查"]),
      1,
      "内容有 43 个字，超过 40 个字",
      "缩短到 40 个字以内，细节写进 --note",
      "queue.content.tooLong",
    );
    expectRun(
      w.ploop(["queue", "edit", "Q1", "--content", tooLong]),
      1,
      "缩短到 40 个字以内，细节写进 --note",
      "queue.content.tooLong",
    );
    // 提升一列放十件：加上 Q2 等待的一件，列头才是「10，另有 1 件等待」。
    for (let n = 1; n <= 10; n++) {
      expectRun(w.ploop(["queue", "add", `提升的第 ${n} 件事`, "--stage", "提升"]), 0);
    }
    expectRun(w.ploop(["queue", "show", "Q14"]), 4);
    expectRun(w.ploop(["queue", "wait", "Q2", "--depends-on", "等构思定下场景 S4"]), 0);
    // Q3 放进来、最近一次变动都改到十天以前。只在摆状态时直接改库。
    const db = new DatabaseSync(join(w.store, "data", "ploop.db"));
    const item = "(SELECT id FROM queue_items WHERE number = 3)";
    db.prepare(`UPDATE queue_items SET created_at = created_at - ? WHERE id = ${item}`).run(
      10 * dayMs,
    );
    db.prepare(`UPDATE queue_events SET at = at - ? WHERE item_id = ${item}`).run(10 * dayMs);
    db.close();
  },
  steps: [
    {
      do: "在项目页点队列",
      expect:
        "五列看板。等别的事的小卡放在五列上面，写明在等什么。有等待的那一列，列头写成「10，另有 1 件等待」。",
      run: async (w) => {
        const page = await openPage(w, `/p/${projectId(w)}`);
        w.memo.set("page", page);
        await page.getByRole("link", { name: "队列", exact: true }).click();
        const waiting = page.locator("section", { hasText: "等待 1" }).last();
        await waiting.waitFor();
        // 五列：每一列的列头是「阶段名 件数」两个字段。
        const heads = (await page.evaluate(
          `[...document.querySelectorAll("main section > p")]
            .map((p) => [...p.children].map((c) => c.textContent))
            .filter((cells) => cells.length === 2)`,
        )) as string[][];
        check(
          heads.map(([stage]) => stage).join("、") === boardStages.join("、"),
          `看板不是五列：${JSON.stringify(heads)}`,
        );
        const head = (stage: string) => heads.find(([name]) => name === stage)?.[1];
        check(head("提升") === "10，另有 1 件等待", `提升一列的列头是「${head("提升")}」`);
        check(head("检查") === "1", `没有等待的一列，列头只写自己的件数：「${head("检查")}」`);
        check(head("使用") === "0", `没有事的一列写 0：「${head("使用")}」`);
        // 等待的小卡放在五列上面，写明在等什么。
        const box = await waiting.boundingBox();
        const column = await page
          .locator("section", { has: page.getByText("10，另有 1 件等待", { exact: true }) })
          .last()
          .boundingBox();
        check(box !== null && column !== null, "找不到等待的一块或提升一列");
        check(
          (box?.y ?? 0) + (box?.height ?? 0) <= (column?.y ?? 0),
          `等待的小卡没有放在五列上面：${JSON.stringify(box)}，${JSON.stringify(column)}`,
        );
        await waiting.getByText("等构思定下场景 S4", { exact: true }).waitFor();
        await waiting.getByText("提升", { exact: true }).waitFor();
      },
    },
    {
      do: "点一张小卡",
      expect:
        "出展示卡片，属性列阶段、状态、提出和加入时间，没有值的不列。有状态变化和出现在哪几个阶段。项目页上没有取消的按钮。",
      run: async (w) => {
        const page = w.memo.get("page") as Page;
        await page.locator("[data-item=Q1]").click();
        const dialog = page.getByRole("dialog");
        for (const name of ["阶段", "状态", "提出", "加入时间"]) {
          await dialog.getByText(name, { exact: true }).waitFor();
        }
        // 没有值的属性整行不画，不写一句「无」。
        for (const name of ["备注", "依赖", "验收标准", "完成证据", "来源"]) {
          check(
            (await dialog.getByText(name, { exact: true }).count()) === 0,
            `没有${name}的事，展示卡片上还列着「${name}」`,
          );
        }
        check(!(await dialog.innerText()).includes("无"), "展示卡片上还写着「无」");
        await dialog.getByText("状态变化").waitFor();
        // 出现在哪几个阶段：给出过这件事的那一页，链接写第几版的什么阶段。
        await dialog.getByText("出现阶段", { exact: true }).waitFor();
        await dialog.getByRole("link", { name: "第 1 版的构思阶段" }).waitFor();
        // 项目页上只看，取消要到阶段的页里做。
        check(
          (await dialog.getByRole("button", { name: /取消/u }).count()) === 0,
          "项目页的展示卡片上有取消的按钮",
        );
        check(
          (await page.getByRole("button", { name: /取消/u }).count()) === 0,
          "项目页上有取消的按钮",
        );
      },
    },
    {
      do: "看停了七天以上的",
      expect: "小卡的底和边变淡，字保持原色，写着「停滞」。",
      run: async (w) => {
        const page = w.memo.get("page") as Page;
        await page.keyboard.press("Escape");
        await page.getByRole("dialog").waitFor({ state: "hidden" });
        await page.locator("[data-item=Q3]").getByText("停滞", { exact: true }).waitFor();
        // 淡的是卡片的底和边（没有白底和阴影，融进这一列），字不淡：字叠上不透明度以后对比度不够。
        const fadedBg = await styleOf(page, "[data-item=Q3]", "background-color");
        const freshBg = await styleOf(page, "[data-item=Q1]", "background-color");
        check(fadedBg !== freshBg, `停了七天的小卡底色和别的一样：${fadedBg}`);
        // 鼠标停在哪张卡上，那张卡的框会变深，先移开再量。
        await page.mouse.move(0, 0);
        const fadedEdge = await styleOf(page, "[data-item=Q3]", "box-shadow");
        const freshEdge = await styleOf(page, "[data-item=Q1]", "box-shadow");
        check(fadedEdge !== freshEdge, `停了七天的小卡边和别的一样：${fadedEdge}`);
        // 边真的变淡了：框线的颜色更透明。算出来的颜色画到一个像素上读回不透明度。
        const alphaOf = async (selector: string) =>
          (await page.evaluate(`(() => {
            const css = getComputedStyle(document.querySelector(${JSON.stringify(selector)}))
              .getPropertyValue("--tw-ring-color");
            const canvas = document.createElement("canvas");
            canvas.width = canvas.height = 1;
            const g = canvas.getContext("2d");
            g.fillStyle = css;
            g.fillRect(0, 0, 1, 1);
            return g.getImageData(0, 0, 1, 1).data[3];
          })()`)) as number;
        const fadedAlpha = await alphaOf("[data-item=Q3]");
        const freshAlpha = await alphaOf("[data-item=Q1]");
        check(
          fadedAlpha < freshAlpha,
          `停了七天的小卡框线不透明度是 ${fadedAlpha}，别的是 ${freshAlpha}，应当更淡`,
        );
        const fadedInk = await styleOf(page, "[data-item=Q3] .text-ui", "color");
        const freshInk = await styleOf(page, "[data-item=Q1] .text-ui", "color");
        check(fadedInk === freshInk, `停了七天的字色是 ${fadedInk}，别的是 ${freshInk}`);
        const opacity = await styleOf(page, "[data-item=Q3]", "opacity");
        check(opacity === "1", `停了七天的小卡不该用不透明度，是 ${opacity}`);
        check(
          (await page.getByText("停滞", { exact: true }).count()) === 1,
          "只有停了七天的一件该写「停滞」",
        );
      },
    },
    {
      do: "在一个阶段的页里点「取消这一项」",
      expect: "要写原因，没写时提交不能点。这一句进提交的内容。",
      run: async (w) => {
        const page = w.memo.get("page") as Page;
        await page.goto(w.url(`${w.memo.get("path")}?item=queue`));
        await page.getByRole("button", { name: /决定表要能切换全部/u }).click();
        await page.getByRole("dialog").getByRole("button", { name: "取消这一项" }).click();
        await page.getByText(/^取消「决定表要能切换全部.*」要写原因$/u).waitFor();
        check(
          await page.getByRole("button", { name: "提交", exact: true }).isDisabled(),
          "没写原因也能提交",
        );
        await page.getByPlaceholder("取消的原因", { exact: true }).fill("和决定表的事一起做");
        await page.keyboard.press("Escape");
        await page.getByText("点过的都已存下").waitFor();
        await page.getByRole("button", { name: "提交", exact: true }).click();
        await page.getByRole("dialog").getByRole("button", { name: "提交" }).click();
        await page.getByText(/等 AI 取走|AI 已收到/u).waitFor();
        const done = await (w.launch(["reply", "wait", "--timeout", "10"]) as Waiting).done;
        expectRun(done, 0, "取消队列事项 Q2", "和决定表的事一起做");
      },
    },
  ],
};
