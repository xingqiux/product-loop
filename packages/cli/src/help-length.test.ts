import type { CommandUnknownOpts } from "@commander-js/extra-typings";
import { describe, expect, it } from "vitest";
import { helpEnvCopy, helpGroupCopy } from "./copy/help.ts";
import { commandPath, helpExtras } from "./help.ts";
import { buildProgram } from "./program.ts";

// 帮助里的文字要短，见决定 224：
// - 命令的说明和分组的名字是名字，不超过 20 个字，不写成句子；
// - 别的文字每句不超过 40 个字，句子按句号、问号、叹号和换行断开；
// - 放不下的话，写进这条命令自己的帮助里的「细节」，每项一句。
// 字数不数空白。例子和「做完以后」是完整的命令，不量。

const nameLimit = 20;
const sentenceLimit = 40;

const size = (text: string) => [...text.replace(/\s/gu, "")].length;
const sentences = (text: string) =>
  text
    .split(/(?<=[。！？])|\n/u)
    .map((part) => part.trim())
    .filter((part) => part !== "");

const program = buildProgram({
  cwd: "/",
  env: {},
  userHome: "/",
  columns: undefined,
  notice: () => {},
  settle: () => {},
}) as CommandUnknownOpts;

function commands(root: CommandUnknownOpts): CommandUnknownOpts[] {
  return [root, ...root.commands.flatMap((sub) => commands(sub as CommandUnknownOpts))];
}

/** 每一条超长的文字：写明在哪、多少个字、原文。 */
function tooLong(): string[] {
  const found: string[] = [];
  const name = (where: string, text: string) => {
    if (size(text) > nameLimit) found.push(`${where}：${size(text)} 个字：${text}`);
    if (text.endsWith("。")) found.push(`${where}：名字不写句号：${text}`);
  };
  const long = (where: string, text: string) => {
    for (const sentence of sentences(text)) {
      if (size(sentence) > sentenceLimit) {
        found.push(`${where}：${size(sentence)} 个字：${sentence}`);
      }
    }
  };
  for (const command of commands(program)) {
    const path = commandPath(command);
    if (command.parent !== null) name(`${path} 的说明`, command.description());
    for (const option of command.options)
      long(`${path} 的选项 ${option.flags}`, option.description);
    for (const argument of command.registeredArguments) {
      long(`${path} 的参数 ${argument.name()}`, argument.description);
    }
    const extra = helpExtras(command);
    for (const text of extra.details ?? []) long(`${path} 的细节`, text);
    for (const [situation, fix] of extra.blocks ?? []) {
      long(`${path} 会拦截的情况`, situation);
      long(`${path} 会拦截的情况的改法`, fix);
    }
    long(`${path} 读`, extra.reads ?? "");
    long(`${path} 写`, extra.writes ?? "");
    for (const [variable, text] of extra.envs ?? []) long(`${path} 的环境变量 ${variable}`, text);
    for (const [code, text] of extra.exits ?? []) long(`${path} 的退出码 ${code}`, text);
  }
  long("ploop 的说明", program.description());
  return found;
}

describe("帮助里的文字要短", () => {
  it("命令的说明是不超过 20 个字的名字，别的每句不超过 40 个字", () => {
    expect(tooLong()).toEqual([]);
  });

  it("分组的名字不超过 20 个字，环境变量的说明每条不超过 40 个字", () => {
    for (const entry of Object.values(helpGroupCopy)) {
      expect(size(entry.text.replace("{date}", "2026-12-31"))).toBeLessThanOrEqual(nameLimit);
    }
    for (const { name, text } of helpEnvCopy) {
      expect(size(text.text), name).toBeLessThanOrEqual(sentenceLimit);
    }
  });

  it("有细节的命令，细节每项是一句话", () => {
    let withDetails = 0;
    for (const command of commands(program)) {
      const details = helpExtras(command).details ?? [];
      withDetails += details.length > 0 ? 1 : 0;
      for (const text of details) expect(sentences(text), commandPath(command)).toHaveLength(1);
    }
    // 不少命令把放不下的话挪进了细节，这条挡住把细节整个删掉的改动。
    expect(withDetails).toBeGreaterThan(30);
  });
});
