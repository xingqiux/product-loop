import { Option } from "@commander-js/extra-typings";
import { exitCode, ok, roundStep } from "@product-loop/model";
import stringWidth from "string-width";
import { describe, expect, it } from "vitest";
import { buildWithRoundStart, ploop, roundStartHelp } from "./fixture.ts";
import { wrapLine } from "./help.ts";
import type { Report } from "./output.ts";
import type { ProgramContext } from "./program.ts";

const headings = [
  "用法",
  "参数",
  "选项",
  "命令",
  "日常命令",
  "按需命令",
  "维护命令",
  "过渡命令（2026-12-31 删除）",
  "细节",
  "阶段的四步",
  "会拦截的情况",
  "读和写",
  "例子",
  "做完以后",
  "环境变量",
  "退出码",
];

/** 帮助按标题分成几节。标题以前的几行（命令和说明）记在空字符串下面。空行不记。 */
function sections(text: string): Map<string, string[]> {
  const result = new Map<string, string[]>();
  let heading = "";
  for (const line of text.trimEnd().split("\n")) {
    if (headings.includes(line)) heading = line;
    if (!result.has(heading)) result.set(heading, []);
    if (line !== "" && line !== heading) result.get(heading)?.push(line);
  }
  return result;
}

/** 一节里每一项的两栏：左栏和说明。 */
function columns(lines: readonly string[]): [string, string][] {
  return lines.map((line) => {
    const [term = "", text = ""] = line.trim().split(/ {2,}/u);
    return [term, text];
  });
}

/** 说明从第几列开始，按显示宽度算。 */
function textColumn(line: string): number {
  const found = /^( {2}\S.*?\S? {2,})\S/u.exec(line);
  return stringWidth(found?.[1] ?? "");
}

const waited: Report = { kind: "waited", data: null, lines: ["等到了"], next: [], warnings: [] };

describe("「04 命令行」第四节的帮助", () => {
  it("round start 的帮助和样例逐行相同", async () => {
    const { code, stdout, stderr } = await ploop(["round", "start", "--help"]);
    expect(stdout.split("\n")).toEqual([...roundStartHelp.split("\n"), ""]);
    expect(stderr).toBe("");
    expect(code).toBe(0);
  });

  it("不是终端时不折行，超过八十列的说明也原样输出", async () => {
    const { stdout } = await ploop(["round", "start", "--help"]);
    expect(stdout.split("\n").filter((line) => /^ {3,}\S/u.test(line))).toEqual([]);
    expect(Math.max(...stdout.split("\n").map((line) => stringWidth(line)))).toBeGreaterThan(80);
  });

  it("终端里按终端的宽度折行，续行对齐说明的那一列", async () => {
    const { stdout } = await ploop(["round", "start", "--help"], { columns: 80 });
    const parts = sections(stdout);
    // 例子和做完以后是完整的命令，不折行，下一条测试单独查。
    for (const heading of ["", "参数", "选项", "细节", "会拦截的情况", "读和写"]) {
      for (const line of parts.get(heading) ?? []) {
        expect(stringWidth(line)).toBeLessThanOrEqual(80);
      }
    }
    expect(parts.get("选项")).toEqual([
      "  --take <编号,…>        落地阶段定这一批，例如 Q12,Q15；不写拿全部待办",
      "  --defer <编号>=<依赖>  这件事要等别的事，改成等待并写明依赖；可以写多次",
      "  --all-screens          检查时列出全部的屏，不只列这一版新出现或变过的",
      "  --json                 输出机读的结果",
    ]);
    expect(parts.get("会拦截的情况")?.slice(0, 2)).toEqual([
      "  上一个阶段的回复还有行没有处理        先运行 ploop reply show，再用 ploop",
      "                                        reply handle 处理",
    ]);
  });

  it("终端很窄时，说明在汉字之间断开，逗号句号不放在行首", async () => {
    const { stdout } = await ploop(["round", "start", "--help"], { columns: 44 });
    const parts = sections(stdout);
    expect(parts.get("")?.[0]).toBe("ploop round start <阶段名>");
    // 「细节」每项一句，比终端宽时在汉字之间断开，续行缩进和第一行对齐。
    const details = parts.get("细节") ?? [];
    expect(details.length).toBeGreaterThan(2);
    expect(details.join("").replaceAll(" ", "")).toBe(
      "从队列拿出这个阶段的事，编好第几版和第几次。主线缺几个部分也会写出来。",
    );
    for (const line of details) {
      expect(stringWidth(line)).toBeLessThanOrEqual(44);
      expect(line).toMatch(/^ {2}\S/u);
      expect(line.trim()).not.toMatch(/^[，。、；：]/u);
    }
  });

  it("例子和做完以后是完整的命令，终端里也不折行", async () => {
    const { stdout } = await ploop(["round", "start", "--help"], { columns: 60 });
    const parts = sections(stdout);
    const sample = sections(roundStartHelp);
    expect(parts.get("例子")).toEqual(sample.get("例子"));
    expect(parts.get("做完以后")).toEqual(sample.get("做完以后"));
  });

  it("ploop 的帮助列出全部全局选项和日常、按需命令，最后是「阶段的四步」；维护和过渡命令加 --all 才列", async () => {
    const { stdout } = await ploop(["--help"]);
    const parts = sections(stdout);
    expect([...parts.keys()]).toEqual([
      "",
      "用法",
      "选项",
      "日常命令",
      "按需命令",
      "细节",
      "阶段的四步",
      "环境变量",
      "退出码",
    ]);
    expect(parts.get("")).toEqual(["ploop", "产品循环的命令行"]);
    expect(parts.get("细节")).toEqual([
      "  不写命令，等同 ploop status。",
      "  维护命令和过渡命令默认不列，运行 ploop --help --all 列出全部。",
      "  输出里的时间一律是北京时间。",
      "  文件夹名里的时间是 UTC，以 Z 结尾。",
    ]);
    expect(parts.get("用法")).toEqual(["  ploop [选项] <命令>"]);
    expect(columns(parts.get("选项") ?? [])).toEqual([
      ["--json", "输出机读的结果"],
      ["--project <项目名或路径>", "指定项目：项目名，或项目里的路径；不写按当前目录找"],
      ["-V, --version", "显示命令行自己的版本号和构建号"],
      ["-h, --help", "显示帮助"],
    ]);
    const names = (heading: string) => columns(parts.get(heading) ?? []).map(([name]) => name);
    // 命令分四组，见决定 209；组里的命令按命令树的顺序列。
    expect(names("日常命令")).toEqual([
      "init",
      "status",
      "round",
      "page",
      "reply",
      "queue",
      "mainline",
      "land",
      "use",
    ]);
    expect(names("按需命令")).toEqual(["prime", "open", "decision", "lint", "skill", "version"]);
    expect(parts.has("维护命令")).toBe(false);
    expect(parts.has("过渡命令（2026-12-31 删除）")).toBe(false);
    const all = sections((await ploop(["--help", "--all"])).stdout);
    expect([...all.keys()].slice(3, 7)).toEqual([
      "日常命令",
      "按需命令",
      "维护命令",
      "过渡命令（2026-12-31 删除）",
    ]);
    const allNames = (heading: string) => columns(all.get(heading) ?? []).map(([name]) => name);
    expect(allNames("维护命令")).toEqual(["backend", "backup", "export", "storage", "setup"]);
    expect(allNames("过渡命令（2026-12-31 删除）")).toEqual(["doctor"]);
    expect(parts.get("阶段的四步")).toEqual([
      "  开始      ploop round start <阶段名>",
      "  给出信息  ploop page present",
      "  回复      ploop reply wait",
      "  处理      ploop reply handle",
    ]);
    // 四步的名字取共用定义里一个阶段四步的中文标签。
    expect(roundStep.labels).toEqual(["开始", "给出信息", "回复", "处理"]);
  });

  it("ploop 的帮助末尾列出退出码表，每个退出码一行，含义取自共用的文案", async () => {
    const { stdout } = await ploop(["--help"]);
    const rows = columns(sections(stdout).get("退出码") ?? []);
    expect(rows.map(([code]) => code)).toEqual(Object.values(exitCode).map(String));
    const byCode = new Map(rows);
    expect(byCode.get("0")).toBe("成功，看「下一步」");
    expect(byCode.get("2")).toBe("用法错误：参数缺失或取值不对，看 --help");
    expect(byCode.get("7")).toBe("还在等：到了时限，用户还没提交，再运行一次同样的命令");
    expect(byCode.get("130")).toBe("被中断");
    // 退出码是帮助的最后一节。
    expect([...sections(stdout).keys()].at(-1)).toBe("退出码");
  });

  it("ploop 的帮助列出环境变量，只有 ploop 自己的帮助有这一节", async () => {
    const { stdout } = await ploop(["--help"]);
    const names = columns(sections(stdout).get("环境变量") ?? []).map(([name]) => name);
    expect(names).toContain("PLOOP_HOME");
    expect(names).toContain("PLOOP_SESSION");
    expect(names).toContain("PLOOP_USE_OUT");
    const round = await ploop(["round", "start", "--help"]);
    expect(round.stdout).not.toContain("环境变量");
    expect(round.stdout).not.toContain("退出码");
  });

  it("有子命令的命令列出子命令，用法里写 <命令>，不列 commander 自带的 help 子命令", async () => {
    const { stdout } = await ploop(["round", "--help"]);
    const parts = sections(stdout);
    expect(parts.get("用法")).toEqual(["  ploop round [选项] <命令>"]);
    expect(columns(parts.get("命令") ?? [])).toEqual([
      ["start <阶段名>", "开始一个阶段"],
      ["list", "列出这一版的阶段"],
      ["show [阶段]", "查看一个阶段"],
      ["close", "收尾一个阶段"],
    ]);
  });

  it("子命令的帮助只列 --json 这一个全局选项，不列 --help、--version 和 --project", async () => {
    const { stdout } = await ploop(["round", "start", "--help"]);
    expect(columns(sections(stdout).get("选项") ?? []).map(([term]) => term)).toEqual([
      "--take <编号,…>",
      "--defer <编号>=<依赖>",
      "--all-screens",
      "--json",
    ]);
  });

  it("取值、默认值和环境变量写成中文，说明对齐在同一列", async () => {
    const build = (context: ProgramContext) => {
      const program = buildWithRoundStart(context);
      program
        .command("wait")
        .description("等用户提交")
        .argument("[阶段]", "要等的阶段", "v2-检查-1")
        .addOption(new Option("--timeout <秒>", "最多等多久").default(540))
        .addOption(new Option("--stage <阶段>", "只等这个阶段").choices(["构思", "使用"]))
        .addOption(new Option("--port <端口>", "后端的端口").env("PLOOP_TEST_PORT"))
        .addOption(new Option("--quiet", "不打印回复").default(false))
        .action(() => context.settle(ok(waited)));
      return program;
    };
    const { stdout } = await ploop(["wait", "--help"], { build });
    const parts = sections(stdout);
    expect(columns(parts.get("参数") ?? [])).toEqual([["[阶段]", "要等的阶段（默认：v2-检查-1）"]]);
    expect(columns(parts.get("选项") ?? [])).toEqual([
      ["--timeout <秒>", "最多等多久（默认：540）"],
      ["--stage <阶段>", "只等这个阶段（取值：构思、使用）"],
      ["--port <端口>", "后端的端口（环境变量：PLOOP_TEST_PORT）"],
      ["--quiet", "不打印回复"],
      ["--json", "输出机读的结果"],
    ]);
    const items = [...(parts.get("参数") ?? []), ...(parts.get("选项") ?? [])];
    expect(new Set(items.map(textColumn))).toEqual(new Set([18]));
    expect(stdout).not.toMatch(/Usage|Options|Arguments|Commands|default|choices|env:/u);
  });
});

describe("按显示宽度断行", () => {
  it("在汉字之间断开，一个汉字算两列", () => {
    expect(wrapLine("一二三四五六七八九十", 8)).toEqual(["一二三四", "五六七八", "九十"]);
  });

  it("在空白处断开，续行开头的空白去掉", () => {
    expect(wrapLine("运行 ploop reply show 再处理", 12)).toEqual([
      "运行 ploop",
      "reply show",
      "再处理",
    ]);
  });

  it("占位的写法和路径整个不拆，放不下时独占一行", () => {
    expect(wrapLine("写进rounds/<阶段的标识>/page.json里", 10)).toEqual([
      "写进",
      "rounds/<阶段的标识>/page.json",
      "里",
    ]);
    expect(wrapLine("先写<编号>再写[选项]", 6)).toEqual(["先写", "<编号>", "再写", "[选项]"]);
  });

  it("避头尾：逗号、句号、右引号不放行首，左引号不放行尾", () => {
    expect(wrapLine("一二三，四五六。", 6)).toEqual(["一二", "三，四", "五六。"]);
    expect(wrapLine("一二「三四」", 6)).toEqual(["一二", "「三", "四」"]);
  });

  it("空行折完还是一个空行", () => {
    expect(wrapLine("", 10)).toEqual([""]);
  });
});
