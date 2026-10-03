import { check, expectRun, type Scene } from "../lib.ts";

// S18 落地一批。AI，落地阶段。改代码要留证据，用户验收才有依据。不认可的事被记成完成，用户拿到手的就是没改好的。
// 在临时 git 仓库里做一件先失败后通过的改动：第 1 到 6 步是第 1 次落地阶段，用户对这件事点了不认可，
// 退回队列后收尾。第 7、8 步是第 2 次落地阶段，看没提交的代码和没给用户看过页时收尾会不会被拦。

const plan = [
  "## 要做的事",
  "看板放到首页。",
  "## 现状",
  "看板在第二屏。",
  "## 要不要先重构",
  "不要。改动都很小，不碰结构。",
  "## 功能改动",
  "1. 看板放到首页",
  "   对应 Q1。检查 `node check.mjs`，查看板在第一屏。",
  "## 用什么锁住现有的行为",
  "`node check.mjs`",
  "## 对应哪个场景",
  "S1 看队列。",
  "## 裁决",
  "| 裁决 | 理由 | 错了的代价 |",
  "| --- | --- | --- |",
  "| 不重构 | 改动小 | 小 |",
].join("\n");

const checkScript = [
  'import { readFileSync } from "node:fs";',
  'const board = readFileSync("board.txt", "utf8");',
  "console.log(board.trim());",
  'process.exit(board.includes("第一屏") ? 0 : 1);',
  "",
].join("\n");

/** 验收页：一条文字的更改，对应 Q1。 */
const acceptance = {
  changes: [
    {
      id: "board-first",
      queue: ["Q1"],
      title: "看板放到首页",
      problem: "看板在第二屏，要往下滚才看到。",
      fix: "看板放到第一屏。",
      textName: "看板的位置",
      textBefore: "看板在第二屏。",
      textAfter: "看板在第一屏。",
    },
  ],
};

const workspace = (n: number) => `.product-loop/rounds/v1-落地-${n}`;

/** 一句超过四十个字的内容。 */
const longContent =
  "设置页的保存按钮在窄屏下被挡住，用户要横着滚动才能看到它，另外提交按钮的位置也不对，一起在落地阶段修好";

export const scene: Scene = {
  scene: "S18",
  setup: (w) => {
    w.git("init", "-q");
    w.write("check.mjs", checkScript);
    w.write("board.txt", "看板在第二屏\n");
    w.write("sub/keep.txt", "子目录\n");
    w.git("add", "-A");
    w.git("commit", "-q", "-m", "起点");
    expectRun(w.ploop(["init", "--repo", "自己的"]), 0);
    w.git("add", "-A");
    w.git("commit", "-q", "-m", "忽略项目缓存");
    expectRun(w.ploop(["queue", "add", "看板放到首页", "--stage", "落地"]), 0);
    const status = JSON.parse(w.ploop(["status", "--json"]).stdout) as {
      data: { project: { id: string } };
    };
    w.memo.set("pid", status.data.project.id);
  },
  steps: [
    {
      do: "敲 ploop round start 落地",
      expect: "这一批要做的事逐件列出，中途冒出来的事只能进队列。",
      run: (w) => {
        const started = w.ploop(["round", "start", "落地"]);
        expectRun(started, 0, "开始了：第 1 版的落地阶段", "Q1  看板放到首页");
        // 计划、重构：落地的前两步，后面的红绿和评审要用。
        w.write(`${workspace(1)}/计划.md`, plan);
        expectRun(w.ploop(["land", "plan"]), 0, "交了计划：第 1 版的落地阶段，功能改动 1 件");
        expectRun(w.ploop(["land", "tidy", "--skip"]), 0, "跳过了重构");
        // 这一批只有 Q1：round show 里拿出来的事只有它。
        const shown = w.ploop(["round", "show"]);
        expectRun(shown, 0, "Q1");
        check(!shown.stdout.includes("Q2"), `这一批里不该有别的事：${shown.stdout}`);
      },
    },
    {
      do: "落地时发现别的问题，敲 ploop queue add，写内容和 --stage",
      expect: "打印新的编号，这件事不进这一批。内容超过四十个字被拦截，写明细节写进 --note。",
      run: (w) => {
        const added = w.ploop(["queue", "add", "设置页的保存按钮在窄屏被挡住", "--stage", "落地"]);
        expectRun(added, 0, "Q2");
        // 新的一件不进这一批：这个阶段拿出来的事还是 Q1。
        const shown = w.ploop(["round", "show"]);
        check(!shown.stdout.includes("Q2"), `新的一件进了这一批：${shown.stdout}`);
        // 拦截的话写明细节写进 --note，加上 --note 就放得进去。
        const long = w.ploop(["queue", "add", longContent, "--stage", "落地"]);
        expectRun(long, 1, "超过 40 个字", "细节写进 --note", "queue.content.tooLong");
        expectRun(
          w.ploop([
            "queue",
            "add",
            "保存按钮在窄屏被挡住的细节",
            "--stage",
            "落地",
            "--note",
            "窄屏下用户要横着滚动才能看到保存按钮。",
          ]),
          0,
          "Q3",
        );
      },
    },
    {
      do: "每件用 ploop land red 和 ploop land green 跑同一条命令",
      expect: "先记失败后记通过，两次的结果和提交号由命令记下。",
      run: (w) => {
        expectRun(
          w.ploop(["land", "red", "看板放到首页", "--", "node", "check.mjs"], `${w.root}/sub`),
          0,
          "记了失败：看板放到首页，退出码 1",
        );
        w.write("board.txt", "看板在第一屏\n");
        w.git("add", "-A");
        w.git("commit", "-q", "-m", "看板放到首页\n\n阶段: 第 1 版的落地阶段\n队列: Q1");
        const passed = w.ploop(["land", "green", "看板放到首页", "--", "node", "check.mjs"]);
        expectRun(passed, 0, "记了通过：看板放到首页，提交 ");
        const status = w.ploop(["land", "status"]);
        check(
          /先失败后通过/u.test(status.stdout),
          `land status 没有记下先失败后通过：${status.stdout}`,
        );
      },
    },
    {
      do: "敲 ploop land review",
      expect:
        "改动不超过六十行、三个文件时，可以加 --skip 写理由，命令核对后写明改了多少。超过时被拦截，要求评审。",
      run: (w) => {
        expectRun(
          w.ploop(["land", "review", "--skip", "只改了一行"]),
          0,
          "跳过了评审：改动 2 行、1 个文件，在界线以内",
        );
        // 改动超过六十行：加 --skip 被拦截，写明要评审。查完把这个提交退掉。
        w.write(
          "big.txt",
          `${Array.from({ length: 70 }, (_, i) => `第 ${i + 1} 行`).join("\n")}\n`,
        );
        w.git("add", "-A");
        w.git("commit", "-q", "-m", "一次改很多");
        // 评审看的是这一批改动的差异，刚提交的大文件在里面。
        expectRun(w.ploop(["land", "diff"]), 0, "big.txt");
        const blocked = w.ploop(["land", "review", "--skip", "改得不多"]);
        expectRun(blocked, 1, "改了", "land.review.required");
        w.git("reset", "-q", "--hard", "HEAD~1");
      },
    },
    {
      do: "用户对一条更改点了不认可，AI 敲 ploop round close --done 这一件",
      expect: "被拦截。写明不认可的事不能算做完，要用 --return 退回。",
      run: async (w) => {
        // 给出验收页，用户对这条更改点了不认可（用接口代替工作台）。
        w.write(`${workspace(1)}/page.json`, JSON.stringify(acceptance));
        const shown = w.ploop(["page", "present", "--json"]);
        expectRun(shown, 0);
        const pageId = (JSON.parse(shown.stdout) as { data: { page: { id: number } } }).data.page
          .id;
        const submitted = (await w.api(
          "POST",
          `/projects/${w.memo.get("pid")}/pages/${pageId}/submission`,
          {
            lines: [
              {
                section: "更改",
                card: "board-first",
                kind: "不认可一条更改",
                note: "第一屏还是被挡住",
              },
            ],
          },
        )) as { ok: boolean };
        check(submitted.ok, `提交没有成功：${JSON.stringify(submitted)}`);
        expectRun(w.ploop(["reply", "wait", "--timeout", "3"]), 0, "不认可一条更改");
        expectRun(w.ploop(["reply", "handle", "1", "队列", "Q1"]), 0);
        expectRun(
          w.ploop(["round", "close", "--done", "Q1=提交看板放到首页"]),
          1,
          "用户对「看板放到首页」点了不认可，Q1 不能记成做完。",
          "--return",
          "land.change.rejected",
        );
      },
    },
    {
      do: "用 --return 写原因退回这一件，再敲 ploop round close",
      expect: "这件事回到队列，收尾成功。",
      run: (w) => {
        expectRun(
          w.ploop(["round", "close", "--return", "Q1:落地=第一屏还是被挡住"]),
          0,
          "收尾了：第 1 版的落地阶段",
        );
        const item = w.ploop(["queue", "show", "Q1"]);
        expectRun(item, 0, "状态：待办", "状态说明：第一屏还是被挡住");
      },
    },
    {
      do: "有没提交的代码时敲 ploop round close",
      expect: "被拒绝，列出没提交的文件。",
      run: (w) => {
        // 第 2 次落地阶段：退回的 Q1 和第 2 步放进来的两件都在这一批里。
        expectRun(w.ploop(["round", "start", "落地"]), 0, "开始了：第 1 版的落地阶段（第 2 次）");
        w.write("scratch.txt", "草稿\n");
        expectRun(
          w.ploop([
            "round",
            "close",
            "--done",
            "Q1=提交看板放到首页",
            "--done",
            "Q2=提交保存按钮",
            "--done",
            "Q3=提交保存按钮的细节",
          ]),
          1,
          "有 1 个文件没有提交：scratch.txt。",
          "规矩：land.commit.clean",
        );
      },
    },
    {
      do: "没给用户看过一页就收尾",
      expect: "被拦截，写明落地阶段收尾前要给用户看过至少一页。",
      run: (w) => {
        w.git("clean", "-fq");
        expectRun(
          w.ploop([
            "round",
            "close",
            "--done",
            "Q1=提交看板放到首页",
            "--done",
            "Q2=提交保存按钮",
            "--done",
            "Q3=提交保存按钮的细节",
          ]),
          1,
          "还没有给用户看过要点的页，也没有给看过更改",
          "规矩：land.page.shown",
        );
      },
    },
  ],
};
