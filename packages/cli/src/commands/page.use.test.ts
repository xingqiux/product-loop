import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cliEnvelopeSchema } from "@product-loop/model";
import { describe, expect, it } from "vitest";
import { fullMainline, sandbox } from "./testing.ts";

// ploop page schema|check|present|withdraw，对着真的后端跑，见第一期计划第 42 步。
// 抄录 S16：JSON 写坏了报到行和列。一次列出全部拦截，每条写位置、怎么改、规矩编号。
// 来源写 file 和 lines 时由命令读出原文。截图先 HEAD 再 PUT。
// 已有一页在等时退出码 3 并写明是哪一页。最后打印这一页的地址。

/** 一像素的 PNG。 */
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

/** 开着第 1 版的检查阶段，拿出了 Q1。 */
function checking() {
  const s = sandbox();
  const run = (...argv: string[]) => s.ploop("proj/app", ...argv);
  expect(run("init", "--repo", "自己的").code).toBe(0);
  const cache = join(s.at("proj/app"), ".product-loop");
  writeFileSync(join(cache, "主线.md"), fullMainline);
  expect(run("queue", "add", "设置页的保存按钮在窄屏被挡住", "--stage", "检查").code).toBe(0);
  expect(run("round", "start", "检查").code).toBe(0);
  const workspace = join(cache, "rounds", "v1-检查-1");
  const write = (file: string, data: unknown) => {
    const path = join(workspace, file);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, typeof data === "string" ? data : JSON.stringify(data, null, 2));
  };
  return { s, run, workspace, write };
}

/** 合格的疑问卡：一条截图的来源，一条文字的来源。 */
const ask = {
  queue: ["Q1"],
  title: "保存按钮被挡住",
  why: "窄屏下保存按钮落到了屏幕外面，要横着滚才看得到。",
  sources: [
    { name: "设置页", saw: "保存按钮只露出一半。", img: "img/settings.png" },
    { name: "设置页的样式", saw: "按钮定宽四百像素。", file: "src/settings.css", lines: "2-3" },
  ],
};

/** 检查页要写的元素清单。 */
const screens = [
  {
    name: "设置页",
    where: { scene: "S1", step: 1 },
    elements: [{ what: "保存按钮", answers: "改的东西存下来没有" }],
  },
];

describe("S16 给出信息", { timeout: 60_000 }, () => {
  it("路径：帮助里的写法 rounds/<阶段的标识>/page.json 在项目根目录里也找得到；找不到时写明试过的两个位置", () => {
    const { run, write } = checking();
    write("page.json", { asks: [ask], screens });
    const byCache = run("page", "check", "rounds/v1-检查-1/page.json");
    expect(byCache.stderr).not.toContain("读不出来");
    expect(byCache.stderr).toContain("img/settings.png");
    const missing = run("page", "check", "rounds/v9-检查-9/page.json");
    expect(missing.stderr).toContain("页面数据读不出来：没有这个文件。");
    expect(missing.stderr).toContain("先按当前目录、再按项目缓存找过，试过：");
    expect(missing.stderr).toContain("、.product-loop/rounds/v9-检查-9/page.json");
    expect(missing.stderr).not.toContain("检查文件的权限");
    expect(missing.code).toBe(4);
  });

  it("还没写页面数据：page present 报找不到，写明写在哪里，第一次写先看 page example", () => {
    const { run } = checking();
    const missing = run("page", "present");
    expect(missing.stderr).toBe(
      [
        "找不到：没有找到页面数据：.product-loop/rounds/v1-检查-1/ 下没有 page.json。",
        "怎么改：把页面数据写进 .product-loop/rounds/v1-检查-1/page.json，或在命令后面写文件的路径。第一次写，运行 ploop page example 看例子。",
        "",
      ].join("\n"),
    );
    expect(missing.code).toBe(4);
  });

  it("第 1 步：JSON 写坏了报到行和列，退出码 1", () => {
    const { run, write } = checking();
    write("page.json", '{\n  "asks": [\n    { "title": }\n  ]\n}\n');
    const { code, stderr } = run("page", "check");
    expect(stderr).toContain("拦截：页面数据不是合法的 JSON。");
    expect(stderr).toContain("位置：.product-loop/rounds/v1-检查-1/page.json 第 3 行第 16 列");
    expect(stderr).toContain("规矩：page.json.syntax");
    expect(code).toBe(1);
  });

  it("第 1 步：一次列出全部拦截，每条写位置、怎么改、规矩编号；cards/ 下的按原文件写位置", () => {
    const { run, write } = checking();
    write("page.json", { asks: [ask], screens });
    write("cards/S1.json", {
      asks: [
        {
          title: "看板的列太多",
          why: `${"看板上每个阶段各占一列，窄屏上挤在一起，".repeat(4)}看不清。`,
          sources: [{ name: "看板" }],
        },
      ],
    });
    write("img/settings.png", png);
    const { code, stderr } = run("page", "check");
    const blocks = stderr.split("\n\n").filter((block) => block.startsWith("拦截："));
    expect(blocks.length).toBeGreaterThanOrEqual(2);
    for (const block of blocks) {
      expect(block).toMatch(/\n位置：/u);
      expect(block).toMatch(/\n规矩：/u);
    }
    expect(stderr).toContain(
      "位置：.product-loop/rounds/v1-检查-1/cards/S1.json → asks[0].sources[0]",
    );
    expect(stderr).toMatch(
      /cards\/S1\.json → asks\[0\]\.sources\[0\]\n怎么改：.+\n规矩：card\.source\.visual/u,
    );
    expect(stderr).toContain("规矩：writing.sentence.tooLong");
    expect(code).toBe(1);
  });

  it("截图找不到时退出码 4，写明相对哪个目录", () => {
    const { run, write } = checking();
    write("page.json", { asks: [ask] });
    const { code, stderr } = run("page", "check");
    expect(stderr).toContain("截图 img/settings.png 找不到：文件不存在。");
    expect(stderr).toContain(
      "位置：.product-loop/rounds/v1-检查-1/page.json → asks[0].sources[0].img",
    );
    expect(code).toBe(4);
  });

  it("文字来源的文件读不到，或行号超出文件，page check 就报，不等到 page present", () => {
    const { s, run, write } = checking();
    write("page.json", { asks: [ask], screens });
    write("img/settings.png", png);
    const missing = run("page", "check");
    expect(missing.stderr).toContain("文字来源 src/settings.css 读不出来：文件不存在。");
    expect(missing.stderr).toContain(
      "位置：.product-loop/rounds/v1-检查-1/page.json → asks[0].sources[1]",
    );
    expect(missing.code).toBe(4);
    mkdirSync(s.at("proj/app/src"), { recursive: true });
    writeFileSync(s.at("proj/app/src/settings.css"), ".save {\n}\n");
    const short = run("page", "check");
    expect(short.stderr).toContain("src/settings.css");
    expect(short.stderr).toContain("2-3");
    expect(short.code).toBe(4);
  });

  it("第 1 步和第 2 步：合格的写「通过」；给出时上传截图、摘录原文，打印地址", () => {
    const { s, run, write } = checking();
    write("page.json", { asks: [ask], screens });
    write("img/settings.png", png);
    mkdirSync(s.at("proj/app/src"), { recursive: true });
    writeFileSync(
      s.at("proj/app/src/settings.css"),
      ".save {\n  width: 400px;\n  float: right;\n}\n",
    );

    const checked = run("page", "check");
    expect(checked.stderr).toBe("");
    expect(checked.stdout).toBe(
      "通过：第 1 版的检查阶段的页面数据没有拦截\n\n下一步：\n  1. ploop page present\n",
    );
    expect(checked.code).toBe(0);

    const presented = run("page", "present");
    const lines = presented.stdout.split("\n");
    expect(lines[0]).toBe("给出了：第 1 版的检查阶段的第 1 页，要用户点");
    expect(lines[1]).toMatch(
      /^地址：http:\/\/127\.0\.0\.1:\d+\/p\/app\/r\/v1-%E6%A3%80%E6%9F%A5-1$/u,
    );
    // page check 只读，没有上传过：给出时才上传。
    expect(lines.slice(2, 5)).toEqual([
      "卡片：1 张",
      "截图：上传了 1 张，已有 0 张",
      "原文：摘录了 1 段",
    ]);
    expect(presented.code).toBe(0);
    expect(existsSync(join(s.store, "blobs"))).toBe(true);

    const again = run("page", "present", "--json");
    const envelope = cliEnvelopeSchema.parse(JSON.parse(again.stdout));
    expect(envelope).toMatchObject({
      ok: false,
      error: { code: "CONFLICT", rule: "page.oneWaiting" },
    });
    expect(JSON.stringify(envelope)).toContain("第 1 版的检查阶段的第 1 页还在等用户点");
    expect(again.code).toBe(3);
  });

  it("page check 只读：不上传截图，不把主线.md 交成新的一版；page present 才做（D06、F11）", () => {
    const { s, run, write } = checking();
    write("page.json", { asks: [ask], screens });
    write("img/settings.png", png);
    mkdirSync(s.at("proj/app/src"), { recursive: true });
    writeFileSync(
      s.at("proj/app/src/settings.css"),
      ".save {\n  width: 400px;\n  float: right;\n}\n",
    );
    const blobFiles = () => {
      const dir = join(s.store, "blobs");
      if (!existsSync(dir)) return [];
      return readdirSync(dir, { recursive: true, withFileTypes: true }).filter((e) => e.isFile());
    };
    const revisions = () => /主线有 (\d+) 次修订/u.exec(run("mainline", "history").stdout)?.[1];
    const before = revisions();
    const cache = join(s.at("proj/app"), ".product-loop");
    writeFileSync(
      join(cache, "主线.md"),
      `${readFileSync(join(cache, "主线.md"), "utf8")}\n改了一行。\n`,
    );
    const filesBefore = blobFiles().length;

    const checked = run("page", "check");
    expect(checked.code).toBe(0);
    expect(checked.stdout).not.toContain("同步了主线");
    expect(blobFiles()).toHaveLength(filesBefore);
    // 没有交新的一版：mainline history 里的修订数不变（history 本身不同步）。
    expect(revisions()).toBe(before);

    // 截图找不到还是会报，退出码 4：只读不等于不查文件。
    write("page.json", {
      asks: [{ ...ask, sources: [{ name: "设置页", saw: "只露一半。", img: "img/none.png" }] }],
      screens,
    });
    const missing = run("page", "check");
    expect(missing.stderr).toContain("img/none.png");
    expect(missing.code).toBe(4);
    write("page.json", { asks: [ask], screens });

    const presented = run("page", "present");
    expect(presented.code).toBe(0);
    expect(presented.stdout + presented.stderr).toContain("同步了主线");
    expect(blobFiles().length).toBeGreaterThan(filesBefore);
  });

  it("第 3 步：已有一页在等时再给出，退出码 3，写明在等的是哪一页；撤回以后可以再给出", () => {
    const { run, write } = checking();
    const plain = { ...ask, sources: [{ name: "用户的话", saw: "保存按钮找不到。", quote: true }] };
    write("page.json", { asks: [plain], screens });
    expect(run("page", "present").code).toBe(0);

    const again = run("page", "present");
    expect(again.stderr).toContain("冲突：第 1 版的检查阶段的第 1 页还在等用户点");
    expect(again.code).toBe(3);

    const withdrawn = run("page", "withdraw", "--reason", "用户在对话里回答了");
    expect(withdrawn.stdout.split("\n")[0]).toBe("撤回了：第 1 版的检查阶段的第 1 页");
    expect(withdrawn.code).toBe(0);
    expect(run("page", "present").stdout.split("\n")[0]).toBe(
      "给出了：第 1 版的检查阶段的第 2 页，要用户点",
    );
  });

  it("没有在等的页时撤回，退出码 4", () => {
    const { run } = checking();
    const { code, stderr } = run("page", "withdraw");
    expect(stderr).toContain("这个项目没有在等的页。");
    expect(code).toBe(4);
  });

  it("page schema 按当前阶段的阶段名打印 JSON Schema，也可以指定阶段", () => {
    const { run } = checking();
    const current = run("page", "schema");
    expect(current.code).toBe(0);
    const parsed = JSON.parse(current.stdout);
    expect(Object.keys(parsed.properties)).toContain("asks");
    const think = JSON.parse(run("page", "schema", "--stage", "构思").stdout);
    expect(Object.keys(think.properties)).toContain("scenes");
    expect(run("page", "schema", "--stage", "评审").code).toBe(2);
  });

  it("page schema --brief 一行一个字段；page example 打印能通过的最小页面数据（A01、F12）", () => {
    const { run, write } = checking();
    const brief = run("page", "schema", "--brief");
    expect(brief.code).toBe(0);
    const lines = brief.stdout.trimEnd().split("\n");
    expect(lines[0]).toBe(
      "检查的页面数据，字段名后带 * 的必填。完整的定义运行 ploop page schema，最小的例子运行 ploop page example。",
    );
    expect(lines).toContain("asks[]  列表：疑问：要用户定的事，或者要追问的事。");
    expect(lines).toContain("  title *  文字：一个名字，不超过 16 个字，不写成句子。");
    // 比完整的定义短得多。
    const full = run("page", "schema", "--stage", "检查").stdout;
    expect(brief.stdout.length * 3).toBeLessThan(full.length);
    const other = run("page", "schema", "--brief", "--stage", "构思").stdout;
    expect(other).toContain("scenes[]  ");

    // 例子：标准输出只有 JSON，可以存成 page.json，再原样校验通过（没有队列事项要盖，屏也不用盖）。
    const example = run("page", "example", "--stage", "检查");
    expect(example.code).toBe(0);
    const parsed = JSON.parse(example.stdout);
    expect(Object.keys(parsed).sort()).toEqual(["asks", "findings", "screens"]);
    expect(run("page", "example").stdout).toBe(example.stdout);
    expect(JSON.parse(run("page", "example", "--stage", "构思").stdout)).toHaveProperty("scenes");
    const wrong = run("page", "example", "--stage", "评审");
    expect(wrong.stderr).toContain("取值只能写下面之一：构思、使用、检查、落地、提升");
    expect(wrong.code).toBe(2);
    const json = JSON.parse(run("page", "example", "--stage", "使用", "--json").stdout);
    expect(json).toMatchObject({ ok: true, kind: "page.example" });
    write("page.json", parsed);
  });

  it("N23 说明里不放长清单：线稿积木用 --blocks 一块一行地列，顶层说明不写格式版本", () => {
    const { run } = checking();
    const schema = run("page", "schema", "--stage", "检查");
    const parsed = JSON.parse(schema.stdout);
    expect(parsed.description).toBe("检查阶段的区块：疑问、发现问题、元素清单。");
    expect(schema.stdout).not.toContain("mk-tab 是一个标签页");
    expect(schema.stdout).toContain("ploop page schema --blocks");
    const blocks = run("page", "schema", "--blocks");
    expect(blocks.code).toBe(0);
    const lines = blocks.stdout.trim().split("\n");
    expect(lines).toHaveLength(11);
    expect(lines[0]).toBe("mk-top：顶栏，里面横排。");
    // 不需要开着的阶段。
    expect(run("page", "schema", "--blocks", "--stage", "构思").code).toBe(0);
  });
});
