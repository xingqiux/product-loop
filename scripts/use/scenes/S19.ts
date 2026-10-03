import { renameSync } from "node:fs";
import { join } from "node:path";
import { check, expectRun, type Scene, started } from "../lib.ts";
import { solidPng } from "../pages.ts";

// S19 跑使用代码。AI，使用阶段。要像用户一样把产品每个场景用一遍，断点先修。没有截图，检查阶段就没有屏可看。
// 被跑的使用代码是沙盒项目里的一段小脚本，不递归跑这个软件自己的 scripts/use/run.ts：
// 它按使用代码的输出格式写 use-run.json，每一步存 1440 和 700 两张截图。
// 第一次运行 S2 第 2 步断了，覆盖表还有一行没有场景；改好以后第二次运行没有断点也没有缺口。

/** 每一步的两张截图，颜色不同，哈希就不同。 */
const shots = (scene: string, step: number, seed: number) =>
  [1440, 700].map((width, i) => ({
    file: `screens/${scene}-${step}-${width}.png`,
    base64: solidPng(width === 1440 ? 32 : 16, 20, [(seed * 40 + i * 90) % 256, 102, 219]).toString(
      "base64",
    ),
  }));

const steps = [
  { scene: "S1", step: 1, do: "点队列", expect: "看到看板。" },
  { scene: "S1", step: 2, do: "点一件事", expect: "右边摆出详情。" },
  { scene: "S2", step: 1, do: "点导出", expect: "下载一份表格。" },
  { scene: "S2", step: 2, do: "打开下载的表格", expect: "每一件事一行。" },
];

/** 被跑的使用代码：命令行参数写 fixed 时 S2 第 2 步走通，不写时它断了。 */
const script = `
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
const out = process.env.PLOOP_USE_OUT;
const fixed = process.argv[2] === "fixed";
const steps = ${JSON.stringify(steps)};
const shots = ${JSON.stringify(steps.map((one, i) => shots(one.scene, one.step, i)))};
const scenes = [];
steps.forEach((one, i) => {
  let scene = scenes.find((s) => s.scene === one.scene);
  if (scene === undefined) scenes.push((scene = { scene: one.scene, steps: [] }));
  const broken = !fixed && one.scene === "S2" && one.step === 2;
  const list = broken ? shots[i].slice(0, 1) : shots[i];
  for (const shot of list) {
    mkdirSync(dirname(join(out, shot.file)), { recursive: true });
    writeFileSync(join(out, shot.file), Buffer.from(shot.base64, "base64"));
    scene.steps.push({
      step: one.step,
      width: shot.file.includes("1440") ? 1440 : 700,
      do: one.do,
      expect: one.expect,
      result: broken ? "断了" : "通过",
      ...(broken ? { error: "表格没有下载下来" } : {}),
      screenshot: shot.file,
    });
  }
});
writeFileSync(join(out, "use-run.json"), JSON.stringify({ schemaVersion: 1, scenes }));
process.exit(fixed ? 0 : 1);
`;

/** 主线里两个场景，各两步：使用代码的每一步都要走到。 */
const mainline = [
  "# 主线",
  "",
  "## 场景清单",
  "",
  "### S1 看队列",
  "谁在什么时候用：用户，想知道还有哪些事没做时。",
  "1. 点队列 → 看到看板。",
  "2. 点一件事 → 右边摆出详情。",
  "",
  "### S2 导出队列",
  "谁在什么时候用：用户，想把队列带走时。",
  "1. 点导出 → 下载一份表格。",
  "2. 打开下载的表格 → 每一件事一行。",
  "",
].join("\n");

const coverageFile = "scripts/use/覆盖表.md";
const withGap = [
  "| 东西 | 场景 |",
  "| --- | --- |",
  "| 队列看板 | S1 |",
  "| 导出按钮 | |",
  "",
].join("\n");
const full = withGap.replace("| 导出按钮 | |", "| 导出按钮 | S2 |");

export const scene: Scene = {
  scene: "S19",
  setup: (w) => {
    started(w);
    // 使用阶段的运行要把主线的每一步都走到，这个场景的使用代码只有两个场景，所以主线换成只有这两个。
    w.write(".product-loop/主线.md", mainline);
    w.write("scripts/use/run.mjs", script);
    w.write(coverageFile, withGap);
    expectRun(w.ploop(["queue", "add", "走一遍看队列和导出", "--stage", "使用"]), 0);
    expectRun(w.ploop(["round", "start", "使用"]), 0);
    const status = JSON.parse(w.ploop(["status", "--json"]).stdout) as {
      data: { project: { id: string } };
    };
    w.memo.set("pid", status.data.project.id);
  },
  steps: [
    {
      do: "敲 ploop use run",
      expect: "逐个场景运行使用代码，走通，或者断在哪一步。每一步存两张截图，宽度是 1440 和 700。",
      run: async (w) => {
        // 使用代码照输出格式的定义写结果，定义里有截图和宽度这两个字段。
        expectRun(w.ploop(["use", "schema"]), 0, "screenshot", "width");
        // S1 两步走通，S2 断在第 2 步：命令收下这次运行，列出断了的那一步，退出码 1。
        const ran = w.ploop(["use", "run", "--", "node", "scripts/use/run.mjs"]);
        expectRun(
          ran,
          1,
          "收下了使用代码的运行：通过 6 步，断了 1 步",
          "S2 第 2 步（1440 宽）：表格没有下载下来",
          "截图：上传 7 张",
        );
        // 走通的每一步都存了两张截图，宽度是 1440 和 700。
        const latest = (await w.api("GET", `/projects/${w.memo.get("pid")}/use-runs/latest`)) as {
          data: {
            scenes: { scene: string; steps: { step: number; width: number; shot: string }[] }[];
          };
        };
        for (const { scene: id, steps: list } of latest.data.scenes) {
          for (const step of new Set(list.map((one) => one.step))) {
            const widths = list.filter((one) => one.step === step && one.shot !== null);
            const want = id === "S2" && step === 2 ? "1440" : "1440,700";
            check(
              widths
                .map((one) => one.width)
                .sort((a, b) => b - a)
                .join() === want,
              `${id} 第 ${step} 步的截图宽度是 ${widths.map((one) => one.width).join("、")}，应当是 ${want}`,
            );
          }
        }
      },
    },
    {
      do: "敲 ploop use coverage",
      expect: "列出覆盖表的缺口。有缺口时退出码 1，覆盖表不存在时退出码 4。",
      run: (w) => {
        expectRun(w.ploop(["use", "coverage"]), 1, "覆盖表第 4 行「导出按钮」没有场景用到。");
        // 覆盖表不在：把它挪走，退出码 4，写明找不到哪个文件。
        const file = join(w.root, coverageFile);
        renameSync(file, `${file}.bak`);
        expectRun(w.ploop(["use", "coverage"]), 4, "覆盖表.md");
        renameSync(`${file}.bak`, file);
      },
    },
    {
      do: "敲 ploop use changed",
      expect: "按场景分组列出这一版新出现或变过的屏。",
      run: (w) => {
        const changed = w.ploop(["use", "changed"]);
        expectRun(changed, 0, "第 1 版新出现或变过的屏");
        for (const row of ["S1 看队列", "S2 导出队列"]) {
          check(changed.stdout.includes(row), `没有按场景列出「${row}」：${changed.stdout}`);
        }
      },
    },
    {
      do: "给出使用阶段的那一页",
      expect: "使用区块由后端从这次运行生成，AI 不手写。这一页不等回复，直接收尾。",
      run: async (w) => {
        // 改好断点，补上覆盖表里的缺口，再跑一次：没有断点也没有缺口，后端自己给出这一页。
        w.write(coverageFile, full);
        const ran = w.ploop(["use", "run", "--", "node", "scripts/use/run.mjs", "fixed"]);
        expectRun(
          ran,
          0,
          "收下了使用代码的运行：通过 8 步，断了 0 步",
          "给用户看了一页使用记录",
          "不等回复",
        );
        const pid = w.memo.get("pid");
        // 页由后端从这次运行生成：AI 没有写 page.json，页上没有要点的卡，有使用区块。
        check(!w.exists(".product-loop/rounds/v1-使用-1/page.json"), "AI 手写了页面数据");
        const round = (await w.api(
          "GET",
          `/projects/${pid}/rounds/${encodeURIComponent("v1-使用-1")}`,
        )) as {
          data: { pages: { id: number; purpose: string; status: string }[] };
        };
        const page = round.data.pages.at(-1);
        check(page !== undefined, "这个阶段没有给出的页");
        check(page?.purpose === "只看", `这一页是「${page?.purpose}」，应当只看`);
        const view = (await w.api("GET", `/projects/${pid}/pages/${page?.id}`)) as {
          data: {
            fill: { use: { scenes: { scene: string }[] } | null };
            sections: { asks?: unknown[] };
          };
        };
        const use = view.data.fill.use;
        check(use !== null, "页面没有使用区块");
        check(
          use?.scenes.map((one) => one.scene).join() === "S1,S2",
          `使用区块里的场景是 ${use?.scenes.map((one) => one.scene).join()}`,
        );
        check((view.data.sections.asks ?? []).length === 0, "这一页上有要点的卡");
        // 不等回复：没有在等的页，直接收尾。
        expectRun(w.ploop(["status"]), 0, "在等的页：没有");
        expectRun(
          w.ploop(["round", "close", "--done", "Q1=使用记录没有断点和缺口"]),
          0,
          "收尾了：第 1 版的使用阶段",
        );
      },
    },
  ],
};
