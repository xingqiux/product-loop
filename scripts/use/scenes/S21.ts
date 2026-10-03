import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { openPage } from "../browser.ts";
import { check, expectRun, png, type Scene, type World } from "../lib.ts";
import { projectId, projectIdIn } from "../pages.ts";

// S21 给旧项目体检。AI，用户要迁移一个还用旧 skill 的项目时。
// 旧文件放在 docs/ 下，主线、决定、队列提交过，docs/ 里另有项目自己的设计文档，全部在临时目录里。
// app 走完整的迁移（第 1 到 6 步、第 8 和 9 步）；第 7 步另摆一个旧项目 beta，让 --fix 中途失败再接着做。

const mainline = [
  "# 主线",
  "",
  "## 4 场景清单",
  "",
  "### 场景 1：看结果",
  "1. 打开页面 → 看到结果",
  "",
].join("\n");

const decisions = `| # | 决定 | 原因 | 案例 | 日期 |
|---|---|---|---|---|
| 1 | 用 A | 因为快 | 第 1 轮 | 2026-09-20 |
| 2 | 用 C | 因为省 | 第 3 轮 |  |
`;

const queue = `| 内容 | 属于哪个阶段 | 谁提的 | 日期 | 状态 |
|---|---|---|---|---|
| 加搜索 | 构思 | 用户 | 2026-09-20 | 待办 |
| 修按钮 | 修复 | 我 | 2026-09-20 | 已进第 3 轮 |
`;

const page = (fields: object) => JSON.stringify({ date: "2026-09-20", ...fields });

/** 旧页面里有内容的一张疑问卡：迁移进来以后按现在的格式显示。 */
const oldAsk = {
  id: "old-card",
  title: "看板放在哪里",
  why: "两种放法各有各的用处，要定一种。",
  sources: [{ name: "用户说的", saw: "「每一页都滚到底才看到」", quote: true }],
  shared: { text: "两种放法都保留五列看板。" },
  rows: ["放在哪里"],
  options: [
    {
      key: "a",
      title: "放在页面最后",
      diffs: ["左边列表最下面一组。"],
      why: "每一页都能看到。",
      cost: "页面变长。",
      when: "每个阶段都要看。",
    },
    {
      key: "b",
      title: "单独一页",
      diffs: ["项目页上的一个入口。"],
      why: "每一页更短。",
      cost: "要多点一下。",
      when: "只在开始阶段时看。",
    },
  ],
};

/** 按编号改对照表里一行的几格，列按表头的列名找。 */
function setCells(file: string, id: string, values: readonly (readonly [string, string])[]): void {
  const cellsOf = (line: string) =>
    line
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim());
  const lines = readFileSync(file, "utf8").split("\n");
  const header = cellsOf(lines.find((line) => line.startsWith("| 编号")) ?? "");
  const edited = lines.map((line) => {
    const cells = cellsOf(line);
    if (cells[0] !== id) return line;
    for (const [column, value] of values) cells[header.indexOf(column)] = value;
    return `| ${cells.join(" | ")} |`;
  });
  writeFileSync(file, edited.join("\n"));
}

/** 在 dir（相对项目根目录）摆一个旧项目：旧文件在 docs/，主线、决定、队列和设计文档提交过。 */
function legacyProject(w: World, dir: string): void {
  const at = (path: string) => (dir === "" ? path : `${dir}/${path}`);
  const root = join(w.root, dir);
  w.write(at("docs/主线.md"), mainline);
  w.write(at("docs/决定.md"), decisions);
  w.write(at("docs/队列.md"), queue);
  w.write(at("docs/设计.md"), "# 设计\n");
  w.write(at("docs/walk/2026-09-20/think-1.json"), page({ stage: "构思", round: 1 }));
  w.write(at("docs/walk/2026-09-20/land-2.json"), page({ stage: "修复", round: 2 }));
  w.write(at("docs/walk/2026-09-20/report-img/a.png"), png);
  w.write(at("docs/walk/2026-09-21/report-3.html"), "<html></html>");
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: root, env: w.env, encoding: "utf8" });
  git("init", "-q");
  git("add", "docs/主线.md", "docs/决定.md", "docs/队列.md", "docs/设计.md");
  git("commit", "-q", "-m", "init");
}

/** 像 AI 一样确认：改对照表、补日期、定快照的阶段，勾上别的要确认的地方。migrate 是迁移对照的目录。 */
function confirmAll(migrate: string): void {
  setCells(join(migrate, "队列迁移对照.md"), "Q1", [["确认", "是"]]);
  setCells(join(migrate, "队列迁移对照.md"), "Q2", [
    ["新状态", "已完成"],
    ["完成证据", "提交 3f2a9c1"],
    ["确认", "是"],
  ]);
  setCells(join(migrate, "决定迁移对照.md"), "2", [
    ["日期", "2026-09-21"],
    ["确认", "是"],
  ]);
  const snapshot = join(migrate, "pages", "2026-09-21_report-3.json");
  writeFileSync(
    snapshot,
    readFileSync(snapshot, "utf8").replace('"阶段名": ""', '"阶段名": "检查"'),
  );
  const acks = join(migrate, "其他确认.md");
  if (existsSync(acks)) writeFileSync(acks, readFileSync(acks, "utf8").replaceAll("[ ]", "[x]"));
}

/** 这一步只敲命令，没有屏：不拿上一步的网页当这一步的截图。 */
const commandOnly = (w: World) => {
  w.frame.current = undefined;
};

const migrateOf = (w: World, dir = "") => join(w.root, dir, ".product-loop", "migrate");

export const scene: Scene = {
  scene: "S21",
  setup: (w) => {
    legacyProject(w, "");
  },
  steps: [
    {
      do: "在旧项目里敲任何一条命令",
      expect: "退出码 6，写项目停在旧版本，先敲 ploop doctor。",
      run: (w) => {
        // 停在旧版本的项目，任何一条命令都一样：先做迁移检查。
        expectRun(w.ploop([]), 6, "ploop doctor");
        expectRun(w.ploop(["queue", "list"]), 6, "ploop doctor");
        expectRun(w.ploop(["round", "start", "构思"]), 6, "ploop doctor");
      },
    },
    {
      do: "敲 ploop doctor",
      expect:
        "列出要迁移的内容，要判断的写进 .product-loop/migrate/。每处要确认的地方一行，以「确认：」开头。",
      run: (w) => {
        const first = w.ploop(["doctor"]);
        expectRun(
          first,
          0,
          "写好了迁移对照：队列迁移对照.md、决定迁移对照.md、pages/ 下 3 份",
          "旧文件的位置：",
        );
        // 要迁移的内容：每一项一段，写发现了什么、--fix 会做什么。
        for (const part of ["身份", "位置", "主线", "决定", "队列"]) {
          check(first.stdout.includes(`${part}：`), `没有列出「${part}」这一项`);
        }
        // 每处要确认的地方一行，以「确认：」开头。
        const confirms = first.stdout
          .split("\n")
          .filter((line) => line.trim().startsWith("确认："));
        check(
          confirms.length === 6,
          `要确认的地方应当是 6 处，实际 ${confirms.length} 处：${confirms.join("｜")}`,
        );
        for (const text of [
          "看不出仓库是自己的还是共用的",
          "Q1、Q2 还没确认",
          "第 2 条：没有日期",
        ]) {
          check(
            confirms.some((line) => line.includes(text)),
            `没有「确认：…${text}」这一行`,
          );
        }
        // 要判断的写进 .product-loop/migrate/。
        for (const file of ["队列迁移对照.md", "决定迁移对照.md"]) {
          check(w.exists(`.product-loop/migrate/${file}`), `migrate/ 里没有 ${file}`);
        }
        check(
          readdirSync(join(migrateOf(w), "pages")).length === 3,
          "migrate/pages/ 下不是 3 份旧页面的快照",
        );
        // 只报告，没有动旧文件。
        check(w.exists("docs/主线.md"), "体检把旧文件删了");
        // 还有要确认的地方时，--fix 不执行。
        expectRun(w.ploop(["doctor", "--fix", "--repo", "自己的"]), 3, "--fix 没有执行");
      },
    },
    {
      do: "按「迁移的做法」改好 migrate/ 里的文件，再敲 ploop doctor",
      expect: "不再列出要确认的地方。",
      run: (w) => {
        confirmAll(migrateOf(w));
        const again = w.ploop(["doctor", "--repo", "自己的"]);
        expectRun(again, 0, "没有要确认的地方");
        check(!again.stdout.includes("确认："), "还列着要确认的地方");
      },
    },
    {
      do: "敲 ploop doctor --fix",
      expect: "归档、导入、核对数量、写 project.json，最后清理旧文件。",
      run: (w) => {
        const fixed = w.ploop(["doctor", "--fix", "--repo", "自己的"]);
        expectRun(
          fixed,
          0,
          "归档：",
          "导入并核对：3 个阶段、3 页、2 条决定",
          "还有 2 件队列事项、1 张截图",
          "迁移完成：项目 app",
          "清理：删了 7 个旧文件",
        );
        // 归档、导入、核对、写 project.json、清理，先后就是这个顺序。
        const order = ["归档：", "导入并核对：", "清理："].map((text) =>
          fixed.stdout.indexOf(text),
        );
        check(
          order.every((at, i) => at >= 0 && (i === 0 || at > (order[i - 1] ?? 0))),
          `输出里各步的先后不对：${order.join("、")}`,
        );
        check(readdirSync(join(w.store, "archives")).length === 1, "没有归档");
        const project = JSON.parse(w.read(".product-loop/project.json")) as {
          projectId: string;
          skillVersion: string;
        };
        check(project.projectId === "app", `project.json 里的项目是 ${project.projectId}`);
        check(project.skillVersion === "0.0.1", `skill 版本是 ${project.skillVersion}`);
        // 清理旧文件：主线、决定、队列没有了，项目自己的设计文档还在，迁移对照也清掉了。
        for (const file of ["主线.md", "决定.md", "队列.md"]) {
          check(!w.exists(`docs/${file}`), `旧的 docs/${file} 还在`);
        }
        check(w.exists("docs/设计.md"), "项目自己的设计文档被删了");
        check(!existsSync(migrateOf(w)), "migrate/ 没有清掉");
      },
    },
    {
      do: "在工作台里打开迁移进来的旧网页",
      expect: "只写标题、日期和「旧页面无法显示」。没有内容的写「没有内容」，不显示旧页面的数据。",
      run: async (w) => {
        // 有当时页面数据的那一页：只有队列，没有别的内容，写「没有内容」，日期是那一页给出的日期。
        const think = await openPage(w, `/p/${projectId(w)}/r/${encodeURIComponent("v1-构思-1")}`);
        await think.getByRole("heading", { name: /构思/u }).waitFor();
        await think.getByText("2026-09-20", { exact: true }).waitFor();
        await think.getByText("没有内容").waitFor();
        check(
          !(await think.locator("main").innerText()).includes("加搜索"),
          "旧页面上出现了现在的队列",
        );
        // 只有网页文件的那一页：写「旧页面无法显示」，不显示旧页面里的东西。
        await think.goto(w.url(`/p/${projectId(w)}/r/${encodeURIComponent("v1-检查-1")}`));
        await think.getByRole("heading", { name: /检查/u }).waitFor();
        await think.getByText("旧页面无法显示").waitFor();
        check((await think.locator("iframe").count()) === 0, "还在显示旧页面的数据");
        const text = await think.locator("main").innerText();
        check(!text.includes("{") && !text.includes("<html"), `页面上有旧页面的数据：${text}`);
      },
    },
    {
      do: "已提交进 git 的旧文件",
      expect:
        "用 git 删除，单独提交一次，提交里只有这几个文件。再敲 ploop doctor 写「没有要迁移的地方」。",
      run: (w) => {
        commandOnly(w);
        const last = w
          .git("-c", "core.quotepath=false", "show", "--name-status", "--format=%s", "HEAD")
          .trim()
          .split("\n");
        const deleted = last.filter((line) => line.startsWith("D\t")).sort();
        check(
          deleted.join(",") === "D\tdocs/主线.md,D\tdocs/决定.md,D\tdocs/队列.md",
          `最后一次提交删的是：${deleted.join("、")}`,
        );
        const others = last.slice(1).filter((line) => line !== "" && !line.startsWith("D\t"));
        check(others.length === 0, `提交里还有别的改动：${others.join("、")}`);
        check(last[0] === "chore: 产品循环的旧文件搬到集中存储", `提交的说明是「${last[0]}」`);
        expectRun(w.ploop(["doctor"]), 0, "没有要迁移的地方");
      },
    },
    {
      do: "--fix 中途有一步失败",
      expect:
        "命令停下并列出原因，不清理旧文件。改好 migrate/ 后再敲 ploop doctor --fix，从停下的那一步接着做。",
      run: (w) => {
        commandOnly(w);
        // 另一个旧项目 beta：决定 1 写成被第 9 条推翻，可是没有第 9 条，导入的一步过不去。
        legacyProject(w, "../beta");
        const beta = join(w.root, "..", "beta");
        expectRun(w.ploop(["doctor"], beta), 0, "写好了迁移对照");
        const migrate = migrateOf(w, "../beta");
        confirmAll(migrate);
        setCells(join(migrate, "决定迁移对照.md"), "1", [
          ["状态", "已作废"],
          ["被哪一条推翻", "9"],
          ["作废原因", "改了主意"],
        ]);
        const failed = w.ploop(["doctor", "--fix", "--repo", "自己的"], beta);
        check(failed.code !== 0, `--fix 应当停下，退出码是 ${failed.code}`);
        check(failed.stderr.includes("9"), `没有列出原因：${failed.stderr.slice(0, 300)}`);
        // 不清理旧文件：主线还在，迁移对照还在，还没有写 project.json。
        check(existsSync(join(beta, "docs", "主线.md")), "失败以后旧的主线被清掉了");
        check(existsSync(migrate), "失败以后迁移对照被清掉了");
        check(
          !existsSync(join(beta, ".product-loop", "project.json")),
          "失败了还写了 project.json",
        );
        // 改好迁移对照，再敲一次：从停下的那一步接着做，不再归档。
        setCells(join(migrate, "决定迁移对照.md"), "1", [
          ["状态", "有效"],
          ["被哪一条推翻", ""],
          ["作废原因", ""],
        ]);
        const fixed = w.ploop(["doctor", "--fix", "--repo", "自己的"], beta);
        expectRun(fixed, 0, "导入并核对：3 个阶段", "迁移完成：项目 beta");
        check(!fixed.stdout.includes("归档："), "接着做的时候又归档了一次");
        check(!existsSync(join(beta, "docs", "主线.md")), "接着做完以后旧的主线还在");
        check(existsSync(join(beta, ".product-loop", "project.json")), "没有写 project.json");
      },
    },
    {
      do: "迁移完成后敲 ploop",
      expect: "写第 2 版，还没开始任何阶段。旧的阶段都在第 1 版。下一步写 ploop round start 构思。",
      run: (w) => {
        commandOnly(w);
        const status = w.ploop([]);
        expectRun(status, 0, "第 2 版", "还没开始任何阶段", "ploop round start 构思");
        // 旧的阶段都在第 1 版：迁移进来的三个阶段按第 1 版叫得出来，都是已收尾；这一版是第 2 版，还没有阶段。
        for (const [name, stage] of [
          ["v1-构思-1", "构思"],
          ["v1-落地-1", "落地"],
          ["v1-检查-1", "检查"],
        ] as const) {
          expectRun(w.ploop(["round", "show", name]), 0, `第 1 版的${stage}阶段：已收尾`);
        }
        expectRun(w.ploop(["round", "list"]), 0, "第 2 版", "这一版还没有阶段");
      },
    },
    {
      do: "想退回旧 skill，敲 ploop export --legacy",
      expect: "按旧格式写回主线、决定和队列，并写明把 skill 的链接改回旧正文。",
      run: (w) => {
        commandOnly(w);
        const legacy = w.ploop(["export", "--legacy"]);
        expectRun(legacy, 0, "按旧格式写回了：.product-loop");
        for (const file of ["主线.md", "决定.md", "队列.json"]) {
          check(legacy.stdout.includes(file), `没有写回 ${file}`);
          check(w.exists(`.product-loop/${file}`), `项目缓存里没有 ${file}`);
        }
        check(
          `${legacy.stdout}${legacy.stderr}`.includes("把 skill 的链接改回旧正文"),
          `没有写明把 skill 的链接改回旧正文：${legacy.stdout.trim()}`,
        );
      },
    },
    {
      do: "在工作台里打开迁移进来的、有内容的旧页面",
      expect: "内容照常显示，选项点不动。提交区写「这一页已回复」，没有提交按钮。",
      run: async (w) => {
        // 另一个旧项目 gamma：它的构思页面数据里有一张疑问卡，迁移进来以后有内容，状态是已回复，没有提交的记录。
        legacyProject(w, "../gamma");
        w.write(
          "../gamma/docs/walk/2026-09-20/think-1.json",
          page({ stage: "构思", round: 1, asks: [oldAsk] }),
        );
        const gamma = join(w.root, "..", "gamma");
        expectRun(w.ploop(["doctor"], gamma), 0, "写好了迁移对照");
        confirmAll(migrateOf(w, "../gamma"));
        expectRun(
          w.ploop(["doctor", "--fix", "--repo", "自己的"], gamma),
          0,
          "导入并核对：3 个阶段、3 页",
          "迁移完成：项目 gamma",
        );
        const view = await openPage(
          w,
          `/p/${projectIdIn(w, "../gamma")}/r/${encodeURIComponent("v1-构思-1")}`,
        );
        // 内容照常显示：卡片的标题、选项。
        await view.getByRole("heading", { name: /构思/u }).waitFor();
        await view.getByRole("heading", { name: "看板放在哪里" }).waitFor();
        const first = view.getByRole("radio", { name: /放在页面最后/u });
        await first.waitFor();
        await view.getByRole("radio", { name: /单独一页/u }).waitFor();
        // 选项点不动：点它的整块，还是没选上。
        await view.locator("label", { has: first }).click();
        check(!(await first.isChecked()), "迁移进来的页面里的选项还能点");
        // 提交区写「这一页已回复」，没有提交按钮，也没有想法框。
        await view.getByText("这一页已回复", { exact: true }).waitFor();
        check(
          (await view.getByRole("button", { name: "提交", exact: true }).count()) === 0,
          "已回复的旧页面还有提交",
        );
        check((await view.getByRole("textbox").count()) === 0, "已回复的旧页面还有输入框");
        check(
          !(await view.locator("main").innerText()).includes("旧页面无法显示"),
          "有内容的页面写了无法显示",
        );
      },
    },
  ],
};
