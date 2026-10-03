import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { note } from "../install.ts";
import { check, expectRun, type Run, repoRoot, type Scene, started, type World } from "../lib.ts";

// S35 写好的文字发出前自查。AI，写要给用户看的文字，或者在会话里回复用户以前。
// 文字不合写作规范，用户读着费劲，页面数据也会被拦。
// 摆的状态：项目开着第 1 版的构思阶段，队列里一件事；主线是这个软件自己的主线，还没有「写作规范」一节。
// lint text 和 lint reply 从管道读文字，w.ploop 不带输入，所以这里自己敲，命令也记进这一步的命令记录。
// 全部在沙盒里做，只读的命令不写主线和队列；第 3 步往项目缓存的主线里加一节，再交上去。

/** 管道传入的文字：像 pbpaste | ploop lint text 那样敲一次 ploop。 */
function piped(w: World, argv: readonly string[], text: string): Run {
  const entry =
    w.app === undefined
      ? join(repoRoot, "packages", "cli", "src", "main.ts")
      : join(w.app, "ploop.mjs");
  const result = spawnSync(process.execPath, [entry, ...argv], {
    cwd: w.root,
    env: w.env,
    input: text,
    encoding: "utf8",
  });
  const run = { code: result.status, stdout: result.stdout, stderr: result.stderr };
  note(w, `ploop ${argv.join(" ")}`, run);
  return run;
}

/** 摆状态、核对用的命令，不记进这一步的命令记录。 */
function quiet(w: World, argv: readonly string[]): Run {
  const before = w.commands.length;
  const run = w.ploop(argv);
  w.commands.length = before;
  return run;
}

/** 有停用的说法，也有超过六十个字的一句。 */
const wrong =
  "用户点保留以后，页面会把这一条收起来，再把整个页面往下滚到下一个还没有点的选项上面，然后停住等用户继续操作下去。";
/** 改好的：术语换成「折叠」，长句拆成两句。 */
const fixed =
  "用户点保留以后，页面会把这一条折叠。再往下滚到下一个还没有点的选项，停住等用户继续。";
/** 只有警告：拿编号指代东西。 */
const warned = "场景 3 里写了这一步。";

/** 主线加一节写作规范：一张表写停用的说法和改成什么。 */
const spec = [
  "",
  "## 写作规范",
  "",
  "| 停用的说法 | 改成 |",
  "| --- | --- |",
  "| 点击 | 点 |",
  "",
].join("\n");

export const scene: Scene = {
  scene: "S35",
  setup: (w) => {
    started(w);
    expectRun(w.ploop(["queue", "add", "看板放在哪里", "--stage", "构思"]), 0);
    expectRun(w.ploop(["round", "start", "构思"]), 0, "开始了：第 1 版的构思阶段");
  },
  steps: [
    {
      do: "敲 ploop lint text，用管道传入一段文字",
      expect: "有拦截时退出码 1，写明哪里不对、怎么改和规矩名。只读，不写主线和队列。",
      run: (w) => {
        const mainline = quiet(w, ["mainline", "show"]).stdout;
        const queue = quiet(w, ["queue", "list"]).stdout;
        const blocked = piped(w, ["lint", "text"], `${wrong}\n`);
        expectRun(
          blocked,
          1,
          "拦截：出现了术语表停用的说法「收起来」，统一的术语是「折叠」",
          "怎么改：",
          "规矩：writing.term.banned",
        );
        // 只读：主线和队列和敲以前一字不差，没有交新的修订，没有放进新的事。
        check(quiet(w, ["mainline", "show"]).stdout === mainline, "lint text 以后主线变了");
        check(quiet(w, ["queue", "list"]).stdout === queue, "lint text 以后队列变了");
      },
    },
    {
      do: "按报错改好，再查",
      expect: "写「查过了：没有拦截」，退出码 0。只有警告时退出码也是 0，警告写在下面。",
      run: (w) => {
        const clean = piped(w, ["lint", "text"], `${fixed}\n`);
        expectRun(clean, 0, "查过了：没有拦截");
        check(!clean.stdout.includes("警告"), `改好的文字还带警告：${clean.stdout}`);
        // 只有警告：退出码还是 0，第一行写警告条数，警告写在下面，带怎么改和规矩名。
        const warning = piped(w, ["lint", "text"], `${warned}\n`);
        expectRun(
          warning,
          0,
          "查过了：没有拦截，警告 1 条",
          "警告：出现「场景 3」",
          "怎么改：",
          "规矩：writing.wording.numberRef",
        );
        const output = `${warning.stdout}${warning.stderr}`;
        check(
          output.indexOf("查过了：") < output.indexOf("警告：出现"),
          `警告没有写在结果下面：${output}`,
        );
      },
    },
    {
      do: "主线的「写作规范」一节加了停用的说法，再查",
      expect: "文字里有它就被拦截，写明要改成什么。",
      run: (w) => {
        const text = "用户点击保存，页面提示已存下。\n";
        // 主线里还没有这一说法时，同一段文字是干净的。
        expectRun(piped(w, ["lint", "text"], text), 0, "查过了：没有拦截");
        // 项目主线的「写作规范」一节加一张表，交成新的修订。
        w.write(".product-loop/主线.md", `${w.read(".product-loop/主线.md").trimEnd()}\n${spec}`);
        expectRun(w.ploop(["mainline", "push"]), 0, "交上了：主线修订");
        const blocked = piped(w, ["lint", "text"], text);
        expectRun(
          blocked,
          1,
          "拦截：出现了术语表停用的说法「点击」，统一的术语是「点」",
          "规矩：writing.term.banned",
        );
        // 换成写作规范里的说法，就过了。
        expectRun(
          piped(w, ["lint", "text"], "用户点保存，页面提示已存下。\n"),
          0,
          "查过了：没有拦截",
        );
      },
    },
    {
      do: "敲 ploop lint reply，用管道传入要发的回复",
      expect: "有拦截时退出码 1。首行没写当前的阶段、写了文件名，或链接后面还有字，都拦截。",
      run: (w) => {
        // 首行没写当前的阶段。
        const noStage = piped(w, ["lint", "reply"], "好的，我处理了。\n");
        expectRun(
          noStage,
          1,
          "拦截：回复的首行没有以当前的阶段「第 1 版的构思阶段」开头",
          "位置：第 1 行",
          "怎么改：首行写成「第 1 版的构思阶段：」加一句原因",
          "规矩：writing.reply.round",
        );
        // 写了文件名。
        const fileName = piped(
          w,
          ["lint", "reply"],
          "第 1 版的构思阶段：主线已经改好。\n\n改动都写进了主线.md。\n",
        );
        expectRun(
          fileName,
          1,
          "拦截：出现了文件名",
          "主线.md",
          "怎么改：把文件名换成它的内容",
          "规矩：writing.reply.fileName",
        );
        // 链接后面还有字。
        const linkLast = piped(
          w,
          ["lint", "reply"],
          "第 1 版的构思阶段：结果在下面的链接。\n\nhttps://example.com/result\n\n接着还有一句话。\n",
        );
        expectRun(linkLast, 1, "规矩：writing.reply.linkLast");
      },
    },
    {
      do: "改好再查",
      expect: "写「查过了：没有拦截」，退出码 0。",
      run: (w) => {
        const good = piped(
          w,
          ["lint", "reply"],
          "第 1 版的构思阶段：先定队列放在哪里。\n\n结果在下面的链接。\n\nhttps://example.com/result\n",
        );
        expectRun(good, 0, "查过了：没有拦截");
      },
    },
  ],
};
