import { check, expectRun, type Scene } from "../lib.ts";
import { presentThink, projectId } from "../pages.ts";

// S14 会话中途接手。AI，会话被压缩或换了一个会话时。要接着上一个会话做，不重来。
// 接不上，AI 会重复开阶段或重复给出页，用户得重讲一遍。
// 摆的状态：第 1 版的构思阶段第 1 次给出一页，用户回复，AI 处理完并收尾；
// 第 2 次开始，拿出一件事，给出一页，这一页在等用户。上一个会话到这里被压缩。

/** 第 2 次给出的一页：只有一张卡，盖住这个阶段拿出来的 Q3。 */
const secondPage = {
  asks: [
    {
      id: "filter",
      queue: ["Q3"],
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

export const scene: Scene = {
  scene: "S14",
  setup: async (w) => {
    presentThink(w);
    // 第 1 次：用户提交，AI 取走、逐行处理，再收尾。
    const pid = projectId(w);
    const view = (await w.api(
      "GET",
      `/projects/${pid}/rounds/${encodeURIComponent("v1-构思-1")}`,
    )) as { data: { pages: { id: number }[] } };
    const id = view.data.pages[0]?.id;
    await w.api("POST", `/projects/${pid}/pages/${id}/submission`, {
      lines: [
        { section: "疑问", card: "queue-board", kind: "选了选项", option: "a" },
        { section: "疑问", card: "last-time", kind: "只写了备注", note: "很久没排了" },
      ],
    });
    expectRun(w.ploop(["reply", "wait", "--timeout", "5"]), 0);
    expectRun(w.ploop(["reply", "handle", "1", "不处理", "先看看"]), 0);
    expectRun(w.ploop(["reply", "handle", "2", "不处理", "只是看看"]), 0);
    expectRun(
      w.ploop(["round", "close", "--done", "Q1=看板放在每一页的最后", "--summary", "定下了看板"]),
      0,
    );
    // 第 2 次：拿出一件事，给出一页，等用户。
    expectRun(w.ploop(["queue", "add", "看板要不要加筛选", "--stage", "构思"]), 0);
    expectRun(w.ploop(["round", "start", "构思"]), 0, "第 2 次");
    w.write(".product-loop/rounds/v1-构思-2/page.json", JSON.stringify(secondPage));
    expectRun(w.ploop(["page", "present"]), 0, "第 1 版的构思阶段（第 2 次）的第 1 页");
  },
  steps: [
    {
      do: "敲 ploop",
      expect: "写当前第几版、哪个阶段、第几次，有没有一页在等，下一步敲什么。",
      run: (w) => {
        expectRun(
          w.ploop([]),
          0,
          "项目 app：第 1 版的构思阶段（第 2 次），等用户回复",
          "在等的页：第 1 版的构思阶段（第 2 次）的第 1 页，要用户点",
          "下一步：",
          "ploop reply wait",
        );
      },
    },
    {
      do: "敲 ploop round show",
      expect: "写这个阶段的状态、开始时间、拿出来的事和给出过的页。",
      run: (w) => {
        const run = w.ploop(["round", "show"]);
        expectRun(
          run,
          0,
          "第 1 版的构思阶段（第 2 次）：等用户回复",
          "拿出来的事：",
          "Q3  进行中  看板要不要加筛选",
          "给出过的页：",
          "第 1 页，要用户点，已给出",
        );
        check(
          /开始：\d{4}-\d{2}-\d{2} \d{2}:\d{2}/u.test(run.stdout),
          `没有写开始时间：${run.stdout}`,
        );
      },
    },
    {
      do: "敲 ploop reply show",
      expect: "列出最近一份回复的每一行，每行写卡片的标题和行的种类。",
      run: (w) => {
        expectRun(
          w.ploop(["reply", "show"]),
          0,
          "回复 1：第 1 版的构思阶段的第 1 页，2 行",
          "第 1 行  疑问「队列看板放在哪里」  选了选项 a",
          "第 2 行  疑问「上次你自己排当天的事是什么时候」  只写了备注：很久没排了",
        );
      },
    },
    {
      do: "上一个会话留下了没交上去的主线.md 改动，敲 ploop mainline pull",
      expect: "被拦截，退出码 3。写明取回会丢掉这些改动，先交上去，或者加 --force。",
      run: (w) => {
        const file = ".product-loop/主线.md";
        const before = w.read(file);
        // 上一个会话改了主线.md，压缩以前没来得及交上去。
        const left = `${before.trimEnd()}\n\n上一个会话留下的一行改动。\n`;
        w.write(file, left);
        w.memo.set("left", left);
        const refused = w.ploop(["mainline", "pull"]);
        expectRun(
          refused,
          3,
          "主线.md 里有还没交上去的改动，取回会把它们丢掉",
          "ploop mainline push",
          "ploop mainline pull --force",
        );
        // 被拦下的命令什么也没动：改动还在文件里。
        check(w.read(file) === left, "被拦截以后主线.md 变了");
      },
    },
    {
      do: "确定不要这些改动，敲 ploop mainline pull --force",
      expect: "主线.md 换成最新的修订，写明没交的改动已丢掉。",
      run: (w) => {
        const file = ".product-loop/主线.md";
        const left = w.memo.get("left") as string;
        const pulled = w.ploop(["mainline", "pull", "--force"]);
        expectRun(pulled, 0, "取回了：主线修订", "覆盖了主线.md", "主线.md 里没交的改动已丢掉。");
        const now = w.read(file);
        check(!now.includes("上一个会话留下的一行改动"), "没交的改动还在主线.md 里");
        check(now !== left, "主线.md 没有换掉");
        // 换成的正是集中存储里最新的修订：show 打印的修订号和取回的一致，文件里没有没交的改动了。
        const revision = /取回了：主线修订 (\d+)/u.exec(pulled.stdout)?.[1];
        check(revision !== undefined, `没有写取回的是第几次修订：${pulled.stdout}`);
        const shown = w.ploop(["mainline", "show"]);
        expectRun(shown, 0, `修订 ${revision}`);
        // 再敲 status 不再提醒有没交的改动。
        const status = w.ploop(["status"]);
        expectRun(status, 0);
        check(!status.stderr.includes("还没交上去的改动"), `status 还在提醒：${status.stderr}`);
      },
    },
  ],
};
