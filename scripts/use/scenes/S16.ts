import { check, expectRun, png, type Scene, started } from "../lib.ts";

// S16 给出信息。AI，这个阶段的活做完、要给用户看时。
// 页面数据不合规矩，用户会看到读不懂或点不完的页，所以交上去之前要拦。
// 摆的状态：检查阶段开着，拿出一件事 Q1，工作区里有一张截图。

const workspace = ".product-loop/rounds/v1-检查-1";

const page = {
  asks: [
    {
      queue: ["Q1"],
      title: "保存按钮被挡住",
      why: "窄屏下保存按钮落到了屏幕外面，要横着滚才看得到。",
      sources: [{ name: "设置页", saw: "保存按钮只露出一半。", img: "img/settings.png" }],
    },
  ],
  screens: [
    {
      name: "设置页",
      where: { scene: "S3", step: 1 },
      elements: [{ what: "保存按钮", answers: "改的东西存下来没有" }],
    },
  ],
};

/** 内容不合规矩：标题不是名字，理由是一整段长句。 */
const badPage = {
  ...page,
  asks: [
    {
      ...page.asks[0],
      title: "窄屏下设置页的保存按钮被挡住了，用户要横着滚才看得到",
      why: "窄屏下保存按钮落到了屏幕外面，用户要先把页面往右滚，再找到按钮才能点，而且滚动条藏在页面最底下，很多人根本不知道还能滚，所以就以为这个页面没有保存按钮。",
    },
  ],
};

type Round = { data: { pages: { id: number; status: string }[] } };

async function pagesOf(w: Parameters<Scene["steps"][number]["run"]>[0]): Promise<Round> {
  return (await w.api("GET", `/projects/app/rounds/${encodeURIComponent("v1-检查-1")}`)) as Round;
}

export const scene: Scene = {
  scene: "S16",
  setup: (w) => {
    started(w);
    expectRun(w.ploop(["queue", "add", "设置页的保存按钮在窄屏被挡住", "--stage", "检查"]), 0);
    expectRun(w.ploop(["round", "start", "检查"]), 0);
    w.write(`${workspace}/img/settings.png`, png);
  },
  steps: [
    {
      do: "写好页面数据，敲 ploop page check",
      expect: "不合格的每一条写明位置和怎么改，退出码 1。合格的写「通过」。",
      run: (w) => {
        // 写页面数据以前先看字段和例子，AI 照着它们写。
        expectRun(w.ploop(["page", "schema", "--brief", "--stage", "检查"]), 0, "必填");
        const example = w.ploop(["page", "example", "--stage", "检查"]);
        expectRun(example, 0);
        check(
          "findings" in (JSON.parse(example.stdout) as Record<string, unknown>),
          "检查阶段的例子里没有发现问题的卡",
        );
        // 写法就不对：不是合法的 JSON。
        w.write(`${workspace}/page.json`, '{\n  "asks": [\n    { "title": }\n  ]\n}\n');
        expectRun(
          w.ploop(["page", "check"]),
          1,
          "拦截：",
          "位置：",
          "第 3 行",
          "怎么改：",
          "规矩：",
        );
        // 写法对，内容不合规矩：每一条各写位置、怎么改和规矩名，一次报齐。
        w.write(`${workspace}/page.json`, JSON.stringify(badPage, null, 2));
        const bad = w.ploop(["page", "check"]);
        expectRun(bad, 1, "拦截：");
        const blocks = bad.stderr.split(/\n\s*\n/u).filter((block) => block.includes("拦截："));
        check(
          blocks.length >= 2,
          `不合格的地方应当一次报齐，只报了 ${blocks.length} 条：${bad.stderr}`,
        );
        for (const block of blocks) {
          check(
            block.includes("位置：") && block.includes("规矩："),
            `没有写位置或规矩名：${block}`,
          );
        }
        // 每一条都写了怎么改：卡片标题的一条单写「怎么改」，写作规矩的一条把改法写在拦截的句子里。
        const title = blocks.find((block) => block.includes("card.title.name"));
        check(title?.includes("怎么改：改成一个名字") === true, `标题那一条没有写怎么改：${title}`);
        const long = blocks.find((block) => block.includes("writing.sentence.tooLong"));
        check(long?.includes("拆成两句") === true, `长句那一条没有写怎么改：${long}`);
        // 合格的写「通过」。
        w.write(`${workspace}/page.json`, JSON.stringify(page, null, 2));
        expectRun(w.ploop(["page", "check"]), 0, "通过");
      },
    },
    {
      do: "敲 ploop page present",
      expect: "截图上传，打印工作台里这一页的地址。",
      run: async (w) => {
        const present = w.ploop(["page", "present"]);
        expectRun(
          present,
          0,
          "给出了：第 1 版的检查阶段的第 1 页",
          "截图：上传了 1 张",
          "地址：http://127.0.0.1:",
        );
        // 打印的地址真的能打开工作台里的这一页，截图已经在附件库里。
        const address = /地址：(\S+)/u.exec(present.stdout)?.[1];
        check(address !== undefined, `没有打印地址：${present.stdout}`);
        const opened = await fetch(address ?? "");
        check(opened.ok, `打印的地址打不开：${address}，状态 ${opened.status}`);
        const round = await pagesOf(w);
        const stored = (await w.api("GET", `/projects/app/pages/${round.data.pages[0]?.id}`)) as {
          data: { images: { path: string; hash: string }[] };
        };
        const image = stored.data.images[0];
        check(
          image?.path === "img/settings.png",
          `页里没有登记截图：${JSON.stringify(stored.data.images)}`,
        );
        const blob = await fetch(w.url(`/api/v1/blobs/${image?.hash}`));
        check(blob.ok, `截图没有上传到附件库：${blob.status}`);
      },
    },
    {
      do: "已有一页在等用户时再给出",
      expect: "退出码 3，写明在等的是哪一页，和怎么撤回。",
      run: (w) => {
        expectRun(
          w.ploop(["page", "present"]),
          3,
          "第 1 版的检查阶段的第 1 页还在等用户点",
          "ploop page withdraw",
          "page.oneWaiting",
        );
      },
    },
    {
      do: "敲 ploop page withdraw，写原因",
      expect: "这一页的页签写「已撤回」，可以再给出新的一页。",
      run: async (w) => {
        expectRun(
          w.ploop(["page", "withdraw", "--reason", "元素清单漏了一屏"]),
          0,
          "撤回了：第 1 版的检查阶段的第 1 页",
        );
        // 页签上的字来自这一页的状态和原因。页签在浏览器里的样子见 S4 的第 5 步。
        const stored = (await w.api(
          "GET",
          `/projects/app/pages/${(await pagesOf(w)).data.pages[0]?.id}`,
        )) as {
          data: { status: string; withdrawal: { reason: string } };
        };
        check(stored.data.status === "已撤回", `这一页的状态是「${stored.data.status}」`);
        check(stored.data.withdrawal.reason === "元素清单漏了一屏", "没有记下撤回的原因");
        expectRun(w.ploop(["round", "show"]), 0, "第 1 页，要用户点，已撤回");
        // 撤回以后可以再给出新的一页，第 1 页留着，标着已撤回。
        expectRun(w.ploop(["page", "present"]), 0, "给出了：第 1 版的检查阶段的第 2 页");
        const pages = (await pagesOf(w)).data.pages;
        check(
          pages.map((entry) => entry.status).join("、") === "已撤回、已给出",
          `两页的状态是 ${pages.map((entry) => entry.status).join("、")}`,
        );
      },
    },
  ],
};
