import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { openPage } from "../browser.ts";
import { check, expectRun, pause, png, type Scene, started, type World } from "../lib.ts";

// S17 等回复并处理。AI，给出一页以后。用户一提交就要接着做，不占用对话。回复丢了行，用户的选择就没有被处理。
// 摆的状态：一个检查阶段，给出的页有五张卡。用户在工作台点提交，由使用代码调接口代替。
// 回复 1 有六行：五张卡各一行，加想法框里的一句话。第 3 步把它们分别放去主线、决定、队列、当场做、不处理。
// 第 4 步再给出一页，用户又提交一份回复，留着一行不处理，看命令拦不拦。

const workspace = ".product-loop/rounds/v1-检查-1";

const card = (title: string, why: string, saw: string, queue?: string[]) => ({
  ...(queue === undefined ? {} : { queue }),
  title,
  why,
  sources: [{ name: "用户的话", saw, quote: true }],
});

const page = {
  asks: [
    card("保存按钮被挡住", "窄屏下保存按钮落到了屏幕外面。", "保存按钮找不到。", ["Q1"]),
    card("说明文字太长", "设置页的说明有三行。", "说明太啰嗦。"),
    card("导出入口的位置", "设置页里找不到导出。", "导出在哪里？"),
    card("按钮上的错别字", "保存按钮上的字写错了。", "保村是什么。"),
    card("主线要不要写窄屏", "主线里没有写窗口最窄多少。", "窄屏到底支持多窄？"),
  ],
  screens: [
    {
      name: "设置页",
      where: { scene: "S3", step: 1 },
      elements: [{ what: "保存按钮", answers: "改的东西存下来没有" }],
    },
  ],
};

/** 第 4 步再给出的一页。 */
const nextPage = {
  asks: [card("导出入口放在哪里", "导出入口要不要挪到设置页底部。", "导出入口太靠上了。")],
  screens: page.screens,
};

const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

type Waiting = ReturnType<World["launch"]>;

type PageView = { data: { sections: { asks: { id: string }[] } } };

/** 一页上每张卡的编号，按页上的先后。 */
async function cardIds(w: World, pageId: number): Promise<string[]> {
  const view = (await w.api("GET", `/projects/${w.memo.get("pid")}/pages/${pageId}`)) as PageView;
  return view.data.sections.asks.map((ask) => ask.id);
}

/** 用户在工作台点提交：用接口交一份回复。 */
async function submit(w: World, pageId: number, lines: unknown[]): Promise<void> {
  const done = (await w.api("POST", `/projects/${w.memo.get("pid")}/pages/${pageId}/submission`, {
    lines,
  })) as { ok: boolean };
  check(done.ok, `提交没有成功：${JSON.stringify(done)}`);
}

export const scene: Scene = {
  scene: "S17",
  setup: (w) => {
    started(w);
    expectRun(w.ploop(["queue", "add", "设置页的保存按钮在窄屏被挡住", "--stage", "检查"]), 0);
    expectRun(w.ploop(["round", "start", "检查"]), 0);
    w.write(`${workspace}/page.json`, JSON.stringify(page));
    const shown = w.ploop(["page", "present", "--json"]);
    expectRun(shown, 0);
    const status = JSON.parse(w.ploop(["status", "--json"]).stdout) as {
      data: { project: { id: string } };
    };
    w.memo.set("pid", status.data.project.id);
    w.memo.set(
      "pageId",
      (JSON.parse(shown.stdout) as { data: { page: { id: number } } }).data.page.id,
    );
  },
  steps: [
    {
      do: "在后台敲 ploop reply wait",
      expect: "命令挂着等，不占用对话。到时限还没人提交，退出码 7，再敲一次。",
      run: async (w) => {
        const waiting = w.launch(["reply", "wait", "--timeout", "0"]);
        await pause(1500);
        check(waiting.running(), "reply wait 没有挂着等，已经退出了");
        w.memo.set("waiting", waiting);
        // 另外敲一次带时限的：到时限还没人提交，退出码 7，写明等了多久，下一步就是再敲一次。
        const late = w.ploop(["reply", "wait", "--timeout", "1"]);
        expectRun(
          late,
          7,
          "还没有回复：第 1 版的检查阶段的第 1 页，等了 1 秒",
          "1. ploop reply wait",
        );
        expectRun(w.ploop(["reply", "wait", "--timeout", "1"]), 7, "还没有回复");
        check((w.memo.get("waiting") as Waiting).running(), "再敲一次以后，后台的命令退出了");
      },
    },
    {
      do: "用户在工作台点提交",
      expect: "命令退出码 0，打印回复的每一行。回复里的图已下载到项目缓存。",
      run: async (w) => {
        const pageId = w.memo.get("pageId") as number;
        const [a, b, c, d, e] = await cardIds(w, pageId);
        const uploaded = (await w.api("PUT", `/blobs/${hash(png)}`, png, "image/png")) as {
          ok: boolean;
        };
        check(uploaded.ok, "图没有传上去");
        await submit(w, pageId, [
          {
            section: "疑问",
            card: a,
            kind: "只写了备注",
            note: "按钮改成跟着屏宽",
            images: [hash(png)],
          },
          { section: "疑问", card: b, kind: "同意" },
          { section: "疑问", card: c, kind: "只写了备注", note: "导出放在设置页顶上" },
          { section: "疑问", card: d, kind: "只写了备注", note: "「保村」要改成「保存」" },
          { section: "疑问", card: e, kind: "只写了备注", note: "主线里写明窗口最窄 700 像素" },
          { kind: "想法", note: "设置页也要能导出" },
        ]);
        const done = await (w.memo.get("waiting") as Waiting).done;
        check(done.code === 0, `reply wait 的退出码是 ${done.code}`);
        const lines = done.stdout.split("\n");
        check(
          lines[0] === "收到了回复：第 1 版的检查阶段的第 1 页，6 行",
          `第一行是「${lines[0]}」`,
        );
        for (const text of [
          "第 1 行  疑问「保存按钮被挡住」  只写了备注：按钮改成跟着屏宽",
          "第 2 行  疑问「说明文字太长」  同意",
          "第 3 行  疑问「导出入口的位置」  只写了备注：导出放在设置页顶上",
          "第 4 行  疑问「按钮上的错别字」  只写了备注：「保村」要改成「保存」",
          "第 5 行  疑问「主线要不要写窄屏」  只写了备注：主线里写明窗口最窄 700 像素",
          "第 6 行  想法：设置页也要能导出",
        ]) {
          check(done.stdout.includes(text), `输出里没有「${text}」：${done.stdout.slice(0, 600)}`);
        }
        // 回复里的图已下载到项目缓存，内容和交上去的一样。
        check(done.stdout.includes(`图：${workspace}/reply-img/1-1.png`), "输出里没有写图存在哪里");
        check(w.exists(`${workspace}/reply-img/1-1.png`), "图没有下载到项目缓存");
        check(
          hash(readFileSync(join(w.root, workspace, "reply-img", "1-1.png"))) === hash(png),
          "下载的图和交上去的不一样",
        );
      },
    },
    {
      do: "敲 ploop reply handle，给每一行定去处",
      expect:
        "每行一个去处：主线、决定、队列、当场做，或不处理和原因。想法框里的话也是一行，由 AI 定去处。",
      run: (w) => {
        // 第 5 行：先在主线里写上，处理时交成新修订。
        w.write(
          ".product-loop/主线.md",
          `${w.read(".product-loop/主线.md")}\n- 窗口最窄 700 像素，写进主线。\n`,
        );
        const handled = [
          w.ploop([
            "reply",
            "handle",
            "1",
            "队列",
            "保存按钮跟着屏宽",
            "--stage",
            "落地",
            "--read-images",
          ]),
          w.ploop(["reply", "handle", "2", "不处理", "用户同意现状，不用改"]),
          w.ploop([
            "reply",
            "handle",
            "3",
            "决定",
            "--decision",
            "导出入口放在设置页顶上",
            "--reason",
            "用户在设置页顶上找导出",
            "--case",
            "第 1 版的检查阶段第 3 行",
          ]),
          w.ploop(["reply", "handle", "4", "当场做", "保存按钮上的字已经改对"]),
          w.ploop(["reply", "handle", "5", "主线", "5 不做什么和胃口"]),
          // 想法框里的话也是一行，和别的行一样由 AI 定去处，这里放进队列，阶段标提升。
          w.ploop(["reply", "handle", "6", "队列", "设置页也要能导出", "--stage", "提升"]),
        ];
        for (const run of handled) expectRun(run, 0, "处理了 1 行");
        const shown = w.ploop(["reply", "show"]);
        expectRun(shown, 0, "还没处理 0 行");
        for (const to of ["队列 Q", "不处理，用户同意现状，不用改", "决定 ", "当场做", "主线"]) {
          check(shown.stdout.includes(`去处：${to}`), `回复里没有「去处：${to}」：${shown.stdout}`);
        }
        check(!shown.stdout.includes("还没有去处"), `还有行没有去处：${shown.stdout}`);
      },
    },
    {
      do: "还有一行没定去处就给出下一页",
      expect: "退出码 1，列出没处理的行。开始下一个阶段也一样。",
      run: async (w) => {
        // 回复 1 都处理完了，再给出一页；用户又提交一份回复，AI 一行都没处理。
        w.write(`${workspace}/page.json`, JSON.stringify(nextPage));
        const shown = w.ploop(["page", "present", "--json"]);
        expectRun(shown, 0);
        const second = (JSON.parse(shown.stdout) as { data: { page: { id: number } } }).data.page
          .id;
        const [only] = await cardIds(w, second);
        await submit(w, second, [
          { section: "疑问", card: only, kind: "只写了备注", note: "导出入口改放在设置页底部" },
        ]);
        expectRun(w.ploop(["reply", "wait", "--timeout", "3"]), 0, "收到了回复");
        // 回复 2 的第 1 行没有去处，接着给出下一页和开始下一个阶段都被拦下。
        expectRun(w.ploop(["page", "present"]), 1, "第 1 行", "reply.line.handled");
        expectRun(w.ploop(["round", "start", "落地"]), 1, "第 1 行", "reply.line.handled");
      },
    },
    {
      do: "用户在回复里改主意，推翻一条旧决定",
      expect:
        "AI 敲 ploop decision add 记新的一条，再敲 ploop decision void 12 --by 15。决定页上旧的一条划掉，写被哪一条推翻。",
      run: async (w) => {
        // 第 3 步把第 3 行记成了决定 1：导出入口放在设置页顶上。回复 2 的第 1 行是用户改了主意。
        const added = w.ploop([
          "decision",
          "add",
          "--decision",
          "导出入口放在设置页底部",
          "--reason",
          "用户改主意，设置页顶上太挤",
          "--case",
          "第 1 版的检查阶段的第 2 页第 1 行",
        ]);
        expectRun(added, 0, "记下了决定：第 2 条");
        expectRun(
          w.ploop(["decision", "void", "1", "--by", "2"]),
          0,
          "作废了决定：第 1 条，被第 2 条推翻",
        );
        expectRun(
          w.ploop(["reply", "handle", "1", "不处理", "已记成决定 2，推翻了决定 1"]),
          0,
          "这份回复的每一行都有了去处",
        );
        // 决定页：默认只列有效的，切到全部，旧的一条划掉，写被哪一条推翻。
        const page = await openPage(w, `/p/${w.memo.get("pid")}`);
        await page.getByRole("link", { name: "决定", exact: true }).click();
        await page.getByText("导出入口放在设置页底部").waitFor();
        await page.getByRole("radio", { name: "全部" }).click();
        const old = page.locator("td span.line-through");
        await old.waitFor();
        check(
          (await old.innerText()) === "导出入口放在设置页顶上",
          `划掉的是「${await old.innerText()}」，应当是旧的一条`,
        );
        await page.getByText("被「导出入口放在设置页底部」推翻").first().waitFor();
      },
    },
  ],
};
