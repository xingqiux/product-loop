import { readdirSync, readFileSync } from "node:fs";
import { checkWriting } from "@product-loop/model";
import { describe, expect, it } from "vitest";
import { checkMentions, commandEntries, renderCommandReference } from "./command-reference.ts";
import { transitionalDate } from "./copy/help.ts";
import { ploop } from "./fixture.ts";
import { buildProgram, commandGroups } from "./program.ts";

// 正文和命令的一致性，见第一期计划第 67 步。
// skill 正文和参考文件里写到的每条 ploop 命令和选项，都要在命令树里找得到。
// docs/命令参考.md 由程序生成，和命令树对不上时测试失败。

const repo = (path: string) => new URL(`../../../${path}`, import.meta.url);
const entries = commandEntries();

/** skill 的正文和全部参考文件。 */
const skillFiles = [
  "skill/SKILL.md",
  ...readdirSync(repo("skill/references"))
    .filter((name) => name.endsWith(".md"))
    .map((name) => `skill/references/${name}`),
];

/** 正文和全部参考文件，都要过写作校验。 */
const newTexts = skillFiles;

describe("正文和命令一致", () => {
  it("正文和参考文件里写到的命令和选项，命令树里都有", () => {
    const problems = skillFiles.flatMap((file) =>
      checkMentions(readFileSync(repo(file), "utf8"), entries).map(
        (mention) => `${file}:${mention.line} ${mention.text}（${mention.problem.name}）`,
      ),
    );
    expect(problems).toEqual([]);
  });

  it("故意写错一条时查得出来：子命令、选项、命令", () => {
    const text = [
      "运行 `ploop round strat 检查` 开始一个阶段。",
      "```",
      "ploop page present --nope",
      "```",
      "再运行 `ploop nosuch`。正文里顺口提到的 ploop round strat 不算。",
    ].join("\n");
    expect(checkMentions(text, entries).map(({ line, problem }) => [line, problem])).toEqual([
      [1, { kind: "subcommand", name: "ploop round strat" }],
      [3, { kind: "option", name: "ploop page present --nope" }],
      [5, { kind: "command", name: "ploop nosuch" }],
    ]);
  });

  it("写对的不报：参数、带值的选项、全局选项", () => {
    const text =
      "`ploop round start 落地 --take Q12,Q15 --json` 和 `ploop doctor --from ~/旧 --fix`";
    expect(checkMentions(text, entries)).toEqual([]);
  });

  it("--help --all 不报，单写 --all 才报", () => {
    expect(checkMentions("`ploop --help --all` 列全部", entries)).toEqual([]);
    expect(checkMentions("`ploop page check --all`", entries)).toEqual([
      {
        line: 1,
        text: "ploop page check --all",
        problem: { kind: "option", name: "ploop page check --all" },
      },
    ]);
  });

  it("新写的正文和参考文件，写作校验没有拦截", () => {
    const blocked = newTexts.flatMap((file) =>
      checkWriting(readFileSync(repo(file), "utf8")).block.map(
        (issue) => `${file}：${issue.message}`,
      ),
    );
    expect(blocked).toEqual([]);
  });
});

describe("SKILL.md 和命令的分工", () => {
  const body = readFileSync(repo("skill/SKILL.md"), "utf8");
  const lines = body.trimEnd().split("\n");

  it("正文不超过 182 行", () => {
    expect(lines.length).toBeLessThanOrEqual(182);
  });

  it("下一步由命令算：正文没有「看到什么状态，敲什么」的表，只让照 ploop 的下一步做", () => {
    expect(body).not.toContain("看到什么状态");
    expect(body).not.toMatch(/^\| 状态 \|/mu);
    expect(body).toContain("就运行 `ploop`");
    expect(body).toContain("照着做");
  });

  it("命令已经会拦的规矩不再写在正文里", () => {
    const blocked = [
      "不超过 16 个字", // 标题长度，页面校验拦
      "回复的第一行写当前的阶段", // lint reply 拦
      "不出现文件名", // lint reply 拦
      "要出现在某张卡的", // 拿出的事要写进卡的 queue，页面校验拦
      "要用户点的页至少有一张卡", // 页面校验拦
    ];
    for (const sentence of blocked) expect(body, sentence).not.toContain(sentence);
  });

  it("写明维护命令默认不列，覆盖或删除数据的命令要用户同意", () => {
    expect(body).toContain("`ploop --help --all`");
    for (const command of [
      "ploop backup restore --yes",
      "ploop mainline pull --force",
      "ploop backup gc",
      "ploop export --legacy",
    ]) {
      expect(body, command).toContain(command);
    }
    expect(body).toContain("先问用户，同意了才运行");
  });

  it("写明 --json 给脚本读，规矩名的用途，页面的例子和字段表怎么看", () => {
    expect(body).toContain("AI 读文字输出，脚本才读 `--json`");
    expect(body).toContain("规矩：xxx");
    expect(body).toContain("`ploop page example`");
    expect(body).toContain("`ploop page schema --brief`");
    expect(body).toContain("`ploop page check`");
  });

  it("场景的写法列了几条，标题就写几条", () => {
    const start = lines.findIndex((line) => line.startsWith("场景有"));
    expect(start).toBeGreaterThan(-1);
    const bullets = lines.slice(start + 1).filter((line, index, rest) => {
      const before = rest.slice(0, index);
      return line.startsWith("- ") && before.every((earlier) => earlier !== "");
    });
    expect(lines[start]).toBe(`场景有${["零", "一", "两", "三"][bullets.length]}条写法：`);
  });
});

describe("命令参考", () => {
  it("docs/命令参考.md 和命令树相同", () => {
    const hint = "改了命令以后，运行 pnpm --filter @product-loop/cli commands-doc 重新生成";
    const doc = readFileSync(repo("docs/命令参考.md"), "utf8");
    expect(doc, hint).toBe(renderCommandReference(entries));
  });

  it("命令一览：除了 ploop 自己，每条命令一行，都写了分组；过渡命令在最后", () => {
    const doc = readFileSync(repo("docs/命令参考.md"), "utf8");
    const rows = doc
      .split("\n")
      .filter((line) => line.startsWith("| `ploop"))
      .map((line) => /^\| `(.+?)` \|.*\| (日常|按需|维护|过渡) \|$/u.exec(line));
    expect(rows.every((row) => row !== null)).toBe(true);
    const listed = rows.map((row) => row?.[1]);
    expect(listed).toEqual(
      expect.arrayContaining(entries.map((entry) => entry.path).filter((path) => path !== "ploop")),
    );
    expect(listed).toHaveLength(entries.length - 1);
    const groups = rows.map((row) => row?.[2]);
    const order = ["日常", "按需", "维护", "过渡"];
    expect(groups.map((group) => order.indexOf(group ?? ""))).toEqual(
      [...groups.map((group) => order.indexOf(group ?? ""))].sort((a, b) => a - b),
    );
    const transitional = rows.filter((row) => row?.[2] === "过渡").map((row) => row?.[1]);
    expect(transitional).toEqual(["ploop doctor", "ploop reply ingest", "ploop use ingest"]);
  });

  it("README 里的分组和命令树一致，写着过渡命令删除的日期", () => {
    const readme = readFileSync(repo("README.zh-CN.md"), "utf8");
    const bullet = (title: string) =>
      readme.split("\n").find((line) => line.startsWith(`- ${title}`)) ?? "";
    const mentions = (line: string, names: readonly string[]) =>
      names.filter((name) => !line.includes(`\`${name}\``));
    expect(mentions(bullet("日常命令"), commandGroups.daily)).toEqual([]);
    expect(mentions(bullet("按需命令"), commandGroups.onDemand)).toEqual([]);
    expect(mentions(bullet("维护命令"), commandGroups.maintenance)).toEqual([]);
    expect(bullet("维护命令")).toContain("`skill issues`");
    expect(mentions(bullet("过渡命令"), ["doctor", "reply ingest", "use ingest"])).toEqual([]);
    expect(bullet("过渡命令")).toContain(transitionalDate);
  });

  it("每一节和敲 --help 看到的相同，不多出 commander 自带的 help 子命令", async () => {
    const doc = readFileSync(repo("docs/命令参考.md"), "utf8");
    expect(doc).not.toContain("display help for command");
    for (const entry of entries) {
      // 文档是全部命令的参考：加 --all，帮助里默认不列的维护和过渡命令也在。
      const argv = [...entry.path.split(" ").slice(1), "--help", "--all"];
      const shown = await ploop(argv, { build: buildProgram });
      expect(shown.stdout.trimEnd(), entry.path).toBe(entry.help);
    }
  });

  it("每条命令一节，里面是它的 --help", () => {
    const paths = entries.map((entry) => entry.path);
    expect(paths.slice(0, 3)).toEqual(["ploop", "ploop init", "ploop status"]);
    expect(paths).toContain("ploop doctor");
    expect(paths).toContain("ploop reply handle");
  });
});
