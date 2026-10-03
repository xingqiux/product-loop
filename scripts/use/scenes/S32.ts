import type { Locator, Page } from "playwright-core";
import { openPage, pick, show } from "../browser.ts";
import { check, expectRun, type Scene, type World } from "../lib.ts";
import { presentThink, projectId } from "../pages.ts";

// S32 先对齐的词没看懂。用户，构思阶段的页上摆出新词时。词没看懂，要能说出来，让 AI 换一种讲法。
// 只能点明白的话，用户会照着没懂的词定事，事后要求修。
// 摆好的状态：构思阶段第 1 次给出一页，先对齐两个词（看板、五列），一张疑问卡用到它们。
// 第 1 到 4 步用户在工作台上点；第 5 到 7 步 AI 敲命令，浏览器窗口一直开着，每一步都有截图。

const cardTitle = "队列看板放在哪里";

/** 先对齐的两个词。「看板」用户会点不明白，AI 下一页要换讲法；「五列」点明白，下一页不用换。 */
const terms = [
  {
    id: "term-board",
    name: "看板",
    usedIn: [cardTitle],
    meaning: "把事情按状态分成几列，摆在一张图上。",
    example: "待办、进行中、已完成各占一列。",
  },
  {
    id: "term-columns",
    name: "五列",
    usedIn: [cardTitle],
    meaning: "看板固定分成的五个阶段。",
    example: "构思、使用、检查、落地、提升各一列。",
  },
] as const;

/** 用户用自己的话说一遍：三十多个字，删掉大半以后才会存下「删之前」的旧版本。 */
const ownWords = "就是一列一列的卡片，像墙上贴的便利贴，从左到右看每件事做到了哪一步。";

/** AI 换的讲法：意思和例子都改了。 */
const reworded = {
  meaning: "一张表，每一列是一种状态，事情写在卡片上，从一列挪到下一列。",
  example: "买菜清单：想买的放左边，买到的挪到右边。",
};

const workspace = ".product-loop/rounds/v1-构思-1";

/** 左边一栏。 */
const sidebar = (page: Page) => page.getByRole("navigation", { name: "这一页的每一条" });

/** 左边一栏里一个词那一行：按行上的名字找，不会碰到名字里带这个词的疑问卡。 */
const entryOf = (page: Page, name: string) =>
  sidebar(page)
    .locator("button")
    .filter({ has: page.getByText(name, { exact: true }) });

/** 一个词的那张卡。 */
const cardOf = (page: Page, id: string) => page.locator(`[data-item="${id}"]`);

/** 一个词的表态：明白或不明白，点它的整块，和用户一样。 */
async function say(card: Locator, choice: "明白" | "不明白"): Promise<void> {
  await card
    .locator("label")
    .filter({ has: card.page().getByRole("radio", { name: choice, exact: true }) })
    .click();
}

/** 页面数据：先对齐的两个词，加一张疑问卡。 */
const pageOf =
  (first: { meaning: string; example: string }) => (think: { asks: readonly unknown[] }) => ({
    align: terms.map((term) =>
      term.id === "term-board" ? { ...term, meaning: first.meaning, example: first.example } : term,
    ),
    asks: [think.asks[0]],
  });

/** 后端上这一页的地址，seq 是这一次的第几页。 */
const pathOf = (w: World) => `/p/${projectId(w)}/r/${encodeURIComponent("v1-构思-1")}`;

export const scene: Scene = {
  scene: "S32",
  setup: (w) => {
    presentThink(w, pageOf(terms[0]));
    w.memo.set("path", pathOf(w));
  },
  steps: [
    {
      do: "打开构思的页，看先对齐里的两张词卡",
      expect:
        "一个词一张卡：名称、用在哪张疑问卡、意思和例子。旁边有「明白」「不明白」和一个备注框。",
      run: async (w) => {
        const page = await openPage(w, w.memo.get("path") as string);
        w.memo.set("page", page);
        await page.getByRole("heading", { name: "第 1 版的构思阶段" }).waitFor();
        await page.getByRole("heading", { name: "先对齐", exact: true }).waitFor();
        check(
          (await page.locator("main section[data-item]").count()) === 2,
          "先对齐里不是两张词卡",
        );
        for (const term of terms) {
          const card = cardOf(page, term.id);
          await card.getByRole("heading", { name: term.name, exact: true }).waitFor();
          const text = await card.innerText();
          for (const want of [
            "用在",
            `「${cardTitle}」`,
            "意思",
            term.meaning,
            "例子",
            term.example,
          ]) {
            check(text.includes(want), `「${term.name}」这张卡里没有「${want}」：${text}`);
          }
          for (const choice of ["明白", "不明白"]) {
            check(
              (await card.getByRole("radio", { name: choice, exact: true }).count()) === 1,
              `「${term.name}」这张卡里没有「${choice}」`,
            );
          }
          check(
            (await card.getByPlaceholder("备注", { exact: true }).count()) === 1,
            `「${term.name}」这张卡里没有备注框`,
          );
          // 什么都没点：左边这一项还没打勾。
          check(
            (await entryOf(page, term.name).getByLabel("已点").count()) === 0,
            `「${term.name}」还没点，左边已经打勾`,
          );
        }
      },
    },
    {
      do: "对一个词点「不明白」，用自己的话说一遍",
      expect: "「不明白」选中，左边这一项打勾。页面不自己走，写的话存下来，刷新后还在。",
      run: async (w) => {
        const page = w.memo.get("page") as Page;
        const card = cardOf(page, "term-board");
        await say(card, "不明白");
        check(
          await card.getByRole("radio", { name: "不明白", exact: true }).isChecked(),
          "「不明白」没有选中",
        );
        await card.getByPlaceholder("备注", { exact: true }).fill(ownWords);
        await entryOf(page, "看板").getByLabel("已点").waitFor();
        // 页面不自己走：先对齐还在眼前，两张词卡都在，地址里没有换到别的一项。
        await page.getByRole("heading", { name: "先对齐", exact: true }).waitFor();
        check(
          (await page.locator("main section[data-item]").count()) === 2,
          "点了以后页面自己走到了别处",
        );
        // 刷新后还在：点过的选项和写的话都存下来了。
        await page.getByText("点过的都已存下").waitFor();
        await page.reload();
        const again = cardOf(page, "term-board");
        await again.getByRole("radio", { name: "不明白", exact: true }).waitFor();
        check(
          await again.getByRole("radio", { name: "不明白", exact: true }).isChecked(),
          "刷新以后「不明白」没有选中",
        );
        const kept = await again.getByPlaceholder("备注", { exact: true }).inputValue();
        check(kept === ownWords, `刷新以后备注是「${kept}」`);
        await entryOf(page, "看板").getByLabel("已点").waitFor();
      },
    },
    {
      do: "一下删掉备注框里大半的字",
      expect: "框下面出现「找回刚删掉的文字」。按下，删掉的字回到框里。",
      run: async (w) => {
        const page = w.memo.get("page") as Page;
        const card = cardOf(page, "term-board");
        const box = card.getByPlaceholder("备注", { exact: true });
        await page.getByText("点过的都已存下").waitFor();
        check((await card.getByText("找回刚删掉的文字").count()) === 0, "还没删，就有找回的按钮");
        // 一下删掉大半：只剩两个字。草稿隔半秒交给后端，后端存下删之前的一份，按钮才出现。
        await box.fill("不懂");
        const recover = card.getByRole("button", { name: "找回刚删掉的文字" });
        await recover.waitFor();
        check((await box.inputValue()) === "不懂", "删掉以后备注框里不是剩下的两个字");
        await recover.click();
        // 后端放回旧版本要一小会儿：等备注框里的字变回来。
        await page.waitForFunction(
          `[...document.querySelectorAll("textarea")].some((area) => area.value === ${JSON.stringify(ownWords)})`,
        );
        await recover.waitFor({ state: "detached" });
        const back = await box.inputValue();
        check(back === ownWords, `按下以后备注框里是「${back}」，不是删掉的那段话`);
        // 放回以后也存下了：刷新还是那段话。
        await page.getByText("点过的都已存下").waitFor();
        await page.reload();
        const kept = await cardOf(page, "term-board")
          .getByPlaceholder("备注", { exact: true })
          .inputValue();
        check(kept === ownWords, `刷新以后备注是「${kept}」`);
      },
    },
    {
      do: "点另一个词的「明白」和疑问卡的 a，再点提交",
      expect: "确认框写几条回复和「提交后不能改」。确认后提交区写「等 AI 取走」。",
      run: async (w) => {
        const page = w.memo.get("page") as Page;
        await say(cardOf(page, "term-columns"), "明白");
        await entryOf(page, "五列").getByLabel("已点").waitFor();
        await sidebar(page).getByRole("button", { name: cardTitle }).click();
        await pick(page, /每一页的最后/u);
        check(await page.getByRole("radio", { name: /每一页的最后/u }).isChecked(), "a 没有选中");
        await page.getByText("点过的都已存下").waitFor();
        await page.getByRole("button", { name: "提交", exact: true }).click();
        const dialog = page.getByRole("dialog");
        const text = await dialog.innerText();
        check(/3 条回复/u.test(text), `确认框没有写 3 条回复：${text}`);
        check(!/没点/u.test(text), `三条都点了，确认框还写着没点：${text}`);
        check(text.includes("提交后不能改"), `确认框没有写「提交后不能改」：${text}`);
        await dialog.getByRole("button", { name: "提交" }).click();
        await page.getByText("等 AI 取走").waitFor();
      },
    },
    {
      do: "AI 敲 ploop reply wait，再敲 ploop reply handle",
      expect:
        "「不明白」那一行写词的名字和用户说的话。用到这个词的疑问卡定为不处理，写原因，不记进决定。",
      run: (w) => {
        const waited = w.ploop(["reply", "wait", "--timeout", "10"]);
        expectRun(
          waited,
          0,
          "收到了回复：第 1 版的构思阶段的第 1 页，3 行",
          `第 1 行  先对齐「看板」  不明白：${ownWords}`,
          "第 2 行  先对齐「五列」  明白",
          `第 3 行  疑问「${cardTitle}」  选了选项 a`,
        );
        const reason = "用到「看板」的疑问，这一次不算定";
        expectRun(
          w.ploop(["reply", "handle", "1", "不处理", "用到它的疑问这一次不算定"]),
          0,
          "去处：不处理",
        );
        expectRun(w.ploop(["reply", "handle", "2", "不处理", "明白，不用改"]), 0, "去处：不处理");
        expectRun(
          w.ploop(["reply", "handle", "3", "不处理", reason]),
          0,
          "去处：不处理",
          "这份回复的每一行都有了去处",
        );
        // 不记进决定：决定表里没有这张疑问卡的选择。
        const decisions = w.ploop(["decision", "list"]);
        expectRun(decisions, 0);
        check(
          !decisions.stdout.includes("每一页的最后") && !decisions.stdout.includes(cardTitle),
          `决定表里有这张疑问卡的选择：${decisions.stdout}`,
        );
        check(/还没有有效的决定/u.test(decisions.stdout), `决定表不是空的：${decisions.stdout}`);
      },
    },
    {
      do: "AI 写好下一页，词的意思和例子没改，敲 ploop page check",
      expect: "通过，带一条警告。警告写用户点了不明白，讲法没变。点了明白的词不报。",
      run: (w) => {
        // 下一页还是问这张疑问卡：先对齐的两个词原样不动，AI 没有换讲法。
        w.write(`${workspace}/page.json`, JSON.stringify(pageOf(terms[0])({ asks: readAsks(w) })));
        const checked = w.ploop(["page", "check"]);
        expectRun(checked, 0, "通过：第 1 版的构思阶段的页面数据没有拦截");
        const warnings = checked.stderr.match(/规矩：align\.unclear\.reworded/gu) ?? [];
        check(
          warnings.length === 1,
          `警告应当只有一条，实际 ${warnings.length} 条：${checked.stderr}`,
        );
        check(
          checked.stderr.includes("点了不明白的「看板」，这一页的意思和例子都没变"),
          `警告没有写用户点了不明白、讲法没变：${checked.stderr}`,
        );
        check(!checked.stderr.includes("「五列」"), `点了明白的词也报了警告：${checked.stderr}`);
        check(checked.stderr.includes("换一种讲法"), `警告没有写怎么改：${checked.stderr}`);
      },
    },
    {
      do: "AI 换一种讲法，敲 ploop page present",
      expect: "给出了，没有这条警告。用户打开这一页，这个词的意思和例子是新的，备注框是空的。",
      run: async (w) => {
        w.write(`${workspace}/page.json`, JSON.stringify(pageOf(reworded)({ asks: readAsks(w) })));
        const shown = w.ploop(["page", "present"]);
        expectRun(shown, 0, "给出了：第 1 版的构思阶段的第 2 页");
        check(
          !`${shown.stdout}${shown.stderr}`.includes("align.unclear.reworded"),
          `换了讲法还有这条警告：${shown.stderr}`,
        );
        // 用户打开这一页：同一个窗口换到新的一页。
        const page = w.memo.get("page") as Page;
        await page.goto(w.url(`${w.memo.get("path")}?page=2`));
        show(w, page);
        const card = cardOf(page, "term-board");
        await card.waitFor();
        const text = await card.innerText();
        check(text.includes(reworded.meaning), `这个词的意思不是新的：${text}`);
        check(text.includes(reworded.example), `这个词的例子不是新的：${text}`);
        check(!text.includes(terms[0].meaning), `还留着旧的意思：${text}`);
        for (const term of terms) {
          const value = await cardOf(page, term.id)
            .getByPlaceholder("备注", { exact: true })
            .inputValue();
          check(value === "", `「${term.name}」的备注框不是空的：${value}`);
        }
        check(
          (await card.getByRole("radio", { name: "不明白", exact: true }).isChecked()) === false,
          "上一页点的「不明白」带到了这一页",
        );
      },
    },
  ],
};

/** 这一页的疑问卡：从后端存着的页面数据里取，下一页照样问它。 */
function readAsks(w: World): readonly unknown[] {
  return JSON.parse(w.read(`${workspace}/page.json`)).asks as unknown[];
}
