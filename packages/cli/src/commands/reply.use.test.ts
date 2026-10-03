import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { describe, expect, it } from "vitest";
import { fullMainline, sandbox } from "./testing.ts";

// ploop reply wait|show|handle|ingest，对着真的后端跑，见第一期计划第 46 步。
// 抄录 S17：后台运行 wait，测试经接口提交，命令以退出码 0 结束，打印每一行。
// 图下载到这个阶段的 reply-img/，写好 reply.md。重复运行 wait 立即返回同一份回复。
// handle --file 一次处理多行。到时退出码 7，页面撤回退出码 8，后端重启以后接着等。

/** 一像素的 PNG。 */
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);
const pngHash = createHash("sha256").update(png).digest("hex");

const ask = {
  queue: ["Q1"],
  title: "保存按钮被挡住",
  why: "窄屏下保存按钮落到了屏幕外面，要横着滚才看得到。",
  sources: [{ name: "设置页", saw: "保存按钮只露出一半。", img: "img/settings.png" }],
};

const screens = [
  {
    name: "设置页",
    where: { scene: "S1", step: 1 },
    elements: [{ what: "保存按钮", answers: "改的东西存下来没有" }],
  },
];

/** 开着第 1 版的检查阶段，给出了一页。返回项目编号和页面编号。 */
function presented() {
  const s = sandbox();
  const run = (...argv: string[]) => s.ploop("proj/app", ...argv);
  expect(run("init", "--repo", "自己的").code).toBe(0);
  const cache = join(s.at("proj/app"), ".product-loop");
  writeFileSync(join(cache, "主线.md"), fullMainline);
  expect(run("queue", "add", "设置页的保存按钮在窄屏被挡住", "--stage", "检查").code).toBe(0);
  expect(run("round", "start", "检查").code).toBe(0);
  const workspace = join(cache, "rounds", "v1-检查-1");
  mkdirSync(join(workspace, "img"), { recursive: true });
  writeFileSync(join(workspace, "page.json"), JSON.stringify({ asks: [ask], screens }));
  writeFileSync(join(workspace, "img", "settings.png"), png);
  const shown = JSON.parse(run("page", "present", "--json").stdout) as {
    data: { page: { id: number } };
  };
  const status = JSON.parse(run("status", "--json").stdout) as {
    data: { project: { id: string } };
  };
  const pid = status.data.project.id;
  const pageId = shown.data.page.id;
  /** 直接调后端的接口，像工作台那样。 */
  const api = async (method: string, path: string, body?: unknown, type = "application/json") => {
    const port = s.runInfo()?.port;
    const response = await fetch(`http://127.0.0.1:${port}/api/v1${path}`, {
      method,
      headers: { "X-Ploop-Client": "web/2.0.0", "Content-Type": type },
      ...(body === undefined ? {} : { body: body instanceof Buffer ? body : JSON.stringify(body) }),
    });
    return (await response.json()) as { ok: boolean; data: unknown };
  };
  return { s, run, cache, workspace, pid, pageId, api };
}

/** 等后台的命令发出第一次长轮询。 */
const settle = () => sleep(1500);

describe("S17 等回复并处理", { timeout: 90_000 }, () => {
  it("后台等、经接口提交、打印每一行并下载图；再等一次立即返回；一次处理多行", async () => {
    const { s, run, cache, workspace, pid, pageId, api } = presented();
    const waiting = s.launch("proj/app", "reply", "wait", "--timeout", "0");
    await settle();
    const page = (await api("GET", `/projects/${pid}/pages/${pageId}`)) as {
      data: { sections: { asks: { id: string }[] } };
    };
    const card = page.data.sections.asks[0]?.id;
    expect((await api("PUT", `/blobs/${pngHash}`, png, "image/png")).ok).toBe(true);
    const submitted = await api("POST", `/projects/${pid}/pages/${pageId}/submission`, {
      lines: [
        { section: "疑问", card, kind: "只写了备注", note: "按钮改成跟着屏宽", images: [pngHash] },
        { section: "疑问", card, kind: "同意" },
        { kind: "想法", note: "设置页也要能导出" },
      ],
    });
    expect(submitted.ok).toBe(true);

    const done = await waiting.done;
    const lines = done.stdout.split("\n");
    expect(lines[0]).toBe(`收到了回复：第 1 版的检查阶段的第 1 页，3 行`);
    expect(lines[1]).toMatch(/^来源：工作台，提交于 \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/u);
    // 想法框里的话也是一行，后端不替 AI 定去处：这一行下面没有「去处」。
    expect(lines.slice(2, 7)).toEqual([
      "第 1 行  疑问「保存按钮被挡住」  只写了备注：按钮改成跟着屏宽",
      "  图：.product-loop/rounds/v1-检查-1/reply-img/1-1.png",
      "第 2 行  疑问「保存按钮被挡住」  同意",
      "第 3 行  想法：设置页也要能导出",
      "回复的副本：.product-loop/rounds/v1-检查-1/reply.md",
    ]);
    // F25 处理回复的写法和别处一样，放在下一步里。
    expect(done.stdout).toContain(
      "下一步：\n  1. ploop reply handle 1 <去处> <说明>\n  2. ploop reply handle --file <文件>\n",
    );
    expect(done.code).toBe(0);
    expect(readFileSync(join(workspace, "reply-img", "1-1.png"))).toEqual(png);
    // 每一行写卡片的标题，不写自动生成的编号；编号只在 --json 里（N02）。
    expect(done.stdout).not.toContain(card ?? "no-card");
    expect(readFileSync(join(workspace, "reply.md"), "utf8")).toContain(
      "第 1 行  疑问「保存按钮被挡住」  只写了备注：按钮改成跟着屏宽",
    );
    const json = JSON.parse(run("reply", "show", "--json").stdout) as {
      data: { lines: { card?: string; cardTitle?: string }[] };
    };
    expect(json.data.lines[0]).toMatchObject({ card, cardTitle: "保存按钮被挡住" });

    const again = run("reply", "wait");
    expect(again.stdout.split("\n")[0]).toBe(`收到了回复：第 1 版的检查阶段的第 1 页，3 行`);
    expect(again.code).toBe(0);

    const unread = run("reply", "handle", "1", "不处理", "已经改好");
    expect(unread.stderr).toContain("规矩：reply.images.read");
    expect(unread.code).toBe(1);

    writeFileSync(
      join(workspace, "destinations.json"),
      JSON.stringify([
        {
          line: 1,
          to: "队列",
          item: { content: "保存按钮跟着屏宽", stage: "落地", proposer: "用户" },
        },
        { line: 2, to: "不处理", reason: "用户同意现状，不用改" },
        {
          line: 3,
          to: "队列",
          item: { content: "设置页也要能导出", stage: "提升", proposer: "用户" },
        },
      ]),
    );
    const handled = run(
      "reply",
      "handle",
      "--file",
      "rounds/v1-检查-1/destinations.json",
      "--read-images",
    );
    expect(handled.stdout.split("\n")[0]).toBe("处理了 3 行：回复 1，第 1 版的检查阶段");
    expect(handled.stdout).toContain("放进队列 Q2：保存按钮跟着屏宽");
    expect(handled.stdout).toContain("放进队列 Q3：设置页也要能导出");
    expect(handled.stdout).toContain("这份回复的每一行都有了去处。");
    // 这个阶段拿出的 Q1 还在进行中，下一步是收尾：要先写结果。
    expect(handled.stdout).toContain("下一步：\n  1. ploop round close\n");
    expect(handled.code).toBe(0);

    const shown = run("reply", "show");
    expect(shown.stdout.split("\n")[0]).toBe(
      "回复 1：第 1 版的检查阶段的第 1 页，3 行，还没处理 0 行",
    );
    expect(shown.stdout).toContain("  去处：不处理，用户同意现状，不用改（命令行）");
    expect(existsSync(join(cache, "rounds", "v1-检查-1", "reply.md"))).toBe(true);

    // 接手的会话敲 round show 就能看到用户答了什么、每一行去了哪里，不用另敲 reply show（主线F10）。
    const roundShown = run("round", "show");
    expect(roundShown.stdout).toContain(
      [
        "收到的回复：",
        "  第 1 页的回复（回复 1），3 行，还没处理 0 行",
        "    第 1 行  疑问「保存按钮被挡住」  只写了备注：按钮改成跟着屏宽",
        "      去处：队列 Q2（命令行）",
        "    第 2 行  疑问「保存按钮被挡住」  同意",
        "      去处：不处理，用户同意现状，不用改（命令行）",
        "    第 3 行  想法：设置页也要能导出",
        "      去处：队列 Q3（命令行）",
      ].join("\n"),
    );
    expect(roundShown.stdout).not.toContain("hash");

    // 回复都处理完了，再等不当成新回复重放，写明现在没有在等的页，要看旧的用 reply show（N04）。
    const idle = run("reply", "wait", "--timeout", "1");
    expect(idle.code).toBe(4);
    expect(idle.stdout).toBe("");
    expect(idle.stderr).toContain("找不到：现在没有在等回复的页，上一份回复也处理完了。");
    expect(idle.stderr).toContain("要再看上一份回复，运行 ploop reply show。");
  });

  it("回复提交时每一行都被后端处理了，命令还没取走过：wait 照样返回它，取走以后再等才说处理完了", async () => {
    const { run, pid, pageId, api } = presented();
    const submitted = await api("POST", `/projects/${pid}/pages/${pageId}/submission`, {
      lines: [{ section: "队列看板", kind: "取消队列事项", queue: "Q1" }],
    });
    expect(submitted.ok).toBe(true);

    const first = run("reply", "wait", "--timeout", "1");
    expect(first.stdout.split("\n")[0]).toBe("收到了回复：第 1 版的检查阶段的第 1 页，1 行");
    expect(first.stdout).toContain("去处：队列 Q1（后端）");
    // 一行都不用处理时，下一步照项目状态：拿出的事都取消了，可以开下一个阶段。
    expect(first.stdout).toContain("下一步：\n  1. ploop round start 提升\n");
    expect(first.code).toBe(0);
    // 后端已经处理的行再处理：冲突，消息里不写回复的内部编号，位置就是消息里的这一行，不重复写，
    // 也不写成「第 1 行的 line」。
    const again = run("reply", "handle", "1", "不处理", "已经改好");
    expect(again.stderr).toBe(
      [
        "冲突：第 1 行已经处理过了，去处是队列。",
        "怎么改：一行只有一个去处。运行 ploop reply show，查看还没处理的行。",
        "",
      ].join("\n"),
    );
    expect(again.code).toBe(3);
    // 不是新回复，也没有没处理的行：取走一次以后就不再重放。
    const second = run("reply", "wait", "--timeout", "1");
    expect(second.code).toBe(4);
    expect(second.stderr).toContain("找不到：现在没有在等回复的页，上一份回复也处理完了。");
  });

  it("到时还没有回复，退出码 7；页面撤回，在等的命令退出码 8", async () => {
    const { s, run } = presented();
    const late = run("reply", "wait", "--timeout", "1");
    expect(late.stdout.split("\n")[0]).toBe(`还没有回复：第 1 版的检查阶段的第 1 页，等了 1 秒`);
    expect(late.stdout).toContain("下一步：\n  1. ploop reply wait\n");
    expect(late.code).toBe(7);

    const waiting = s.launch("proj/app", "reply", "wait");
    await settle();
    const withdrawn = run("page", "withdraw", "--reason", "用户在对话里回答了");
    expect(withdrawn.stdout).toBe(
      [
        "撤回了：第 1 版的检查阶段的第 1 页",
        "用户在对话里回答了，就按回答处理拿出来的事，再收尾。页有问题，就改好重新给出。",
        "",
        "下一步：",
        "  1. ploop round close",
        "  2. ploop page present",
        "",
      ].join("\n"),
    );
    expect(withdrawn.code).toBe(0);
    const gone = await waiting.done;
    expect(gone.stderr).toContain("页已不在：第 1 版的检查阶段的第 1 页已经撤回了。");
    expect(gone.code).toBe(8);
  });

  it("后端在等的期间重启，命令接上新的后端接着等", async () => {
    const { s, run, pid, pageId, api } = presented();
    const waiting = s.launch("proj/app", "reply", "wait", "--timeout", "0");
    await settle();
    const before = s.runInfo()?.pid;
    expect(run("backend", "stop").code).toBe(0);
    // 等命令拉起新的后端。
    for (let i = 0; i < 100 && (s.runInfo()?.pid ?? before) === before; i++) await sleep(100);
    expect(s.runInfo()?.pid).not.toBe(before);
    // 旧模板「复制回复」的第一行，是过渡格式，第一行写「检查第 1 轮」，见 model 的 legacy/reply-text.ts。
    const text = ["检查第 1 轮", "疑问 1（按钮改成跟着屏宽）"].join("\n");
    const submitted = await api("POST", `/projects/${pid}/pages/${pageId}/submission`, {
      source: "旧模板",
      text,
    });
    expect(submitted.ok).toBe(true);
    const done = await waiting.done;
    expect(done.stdout.split("\n")[0]).toBe(`收到了回复：第 1 版的检查阶段的第 1 页，1 行`);
    expect(done.code).toBe(0);
  });

  it("reply handle 报错：写第几行和命令里的选项，说明缺什么，决定缺项和 decision add 一样退出码 1", async () => {
    const { run, workspace, pid, pageId, api } = presented();
    const page = (await api("GET", `/projects/${pid}/pages/${pageId}`)) as {
      data: { sections: { asks: { id: string }[] } };
    };
    const card = page.data.sections.asks[0]?.id;
    const note = (text: string) => ({ section: "疑问", card, kind: "只写了备注", note: text });
    const submitted = await api("POST", `/projects/${pid}/pages/${pageId}/submission`, {
      lines: [note("一"), note("二"), note("三")],
    });
    expect(submitted.ok).toBe(true);

    const decision = run("reply", "handle", "1", "决定", "保存按钮固定在底部");
    expect(decision.code).toBe(1);
    expect(decision.stderr).toContain("拦截：决定、原因、案例三项都要写，这里缺了原因。");
    expect(decision.stderr).toContain("位置：第 1 行的 --reason");
    expect(decision.stderr).toContain("位置：第 1 行的 --case");
    expect(decision.stderr).toContain("规矩：decision.fields");
    expect(decision.stderr).toContain("--decision、--reason、--case");
    expect(decision.stderr).not.toMatch(/\[\d\]|\{value\}|对照这条命令的 --help/u);

    const queue = run("reply", "handle", "2", "队列", "导出功能");
    expect(queue.code).toBe(2);
    expect(queue.stderr).toContain("第 2 行要放进队列的是新的一件事，没写要做它的阶段。");
    expect(queue.stderr).toContain("位置：第 2 行的 --stage");
    expect(queue.stderr).toContain("加 --stage <阶段名>");
    expect(queue.stderr).not.toMatch(/\[\d\]|\{value\}/u);

    const noReason = join(workspace, "one.json");
    writeFileSync(noReason, JSON.stringify({ line: 3, to: "不处理" }));
    const missing = run("reply", "handle", "--file", noReason);
    expect(missing.code).toBe(2);
    expect(missing.stderr).toContain("位置：第 3 行的 reason");
    expect(missing.stderr).not.toMatch(/\[\d\]|请求体要写成一个 JSON 对象/u);

    // 一行时写一个对象也行，不再说「请求体要写成一个 JSON 对象」和数组互相矛盾。
    writeFileSync(noReason, JSON.stringify({ line: 3, to: "不处理", reason: "已经在第一屏" }));
    const one = run("reply", "handle", "--file", noReason);
    expect(one.stdout).toContain("处理了 1 行：回复 1，第 1 版的检查阶段");
    expect(one.code).toBe(0);
  });

  it("reply ingest 收下对话里贴回的文字，第一行写「第 1 版的检查阶段」", () => {
    const { s, run } = presented();
    writeFileSync(
      s.at("proj/app/reply.txt"),
      ["第 1 版的检查阶段", "疑问 1（按钮改成跟着屏宽）", "想法：设置页也要能导出"].join("\n"),
    );
    const ingested = run("reply", "ingest", "reply.txt");
    expect(ingested.stdout.split("\n")[0]).toBe(`收下了回复：第 1 版的检查阶段的第 1 页，2 行`);
    expect(ingested.stdout).toContain("来源：对话");
    expect(ingested.code).toBe(0);
  });

  it("reply ingest 第一行没写阶段时，报错和怎么改都不写「轮」（N05）", () => {
    const { s, run } = presented();
    writeFileSync(s.at("proj/app/reply.txt"), "疑问 1（按钮改成跟着屏宽）\n");
    const bad = run("reply", "ingest", "reply.txt");
    expect(bad.code).not.toBe(0);
    expect(bad.stderr).toContain("回复的第一行没有写是第几版的哪个阶段。");
    expect(bad.stderr).toContain("第一行写「第 1 版的检查阶段」");
    expect(bad.stderr).not.toContain("轮");
  });
});
