import { allEnums } from "./names.ts";
import { terms } from "./terms.ts";

// docs/术语对照.md 的全文，由 terms.ts 和 names.ts 的名称表生成，见「10 工程规范与流程」第一节。
// 测试核对仓库里的文件和生成的结果逐字相同。
// 改了这两个文件以后，运行 pnpm --filter @product-loop/model terms-doc 重新生成。

type EnumTable = {
  readonly keys: readonly string[];
  readonly table: Readonly<Record<string, string>>;
};

const cell = (s: string) => s.replaceAll("|", "\\|");

export function renderTermsDoc(): string {
  const enums: Readonly<Record<string, EnumTable>> = allEnums;
  const out = [
    "# 术语对照",
    "",
    "中文术语和代码里的名字一一对应，每个中文术语只对应一个英文名。依据是「10 工程规范与流程」第一节。",
    "",
    "本文由程序生成，不要手改。名词取自 `packages/model/src/terms.ts`，名称表取自同一目录的 `names.ts`。",
    "改了这两个文件以后，运行 `pnpm --filter @product-loop/model terms-doc` 重新生成。",
    "",
    "## 一、名词",
    "",
    "| 中文术语 | 代码里的名字 | 说明 |",
    "| --- | --- | --- |",
    ...terms.map((t) => `| ${cell(t.term)} | \`${t.code}\` | ${cell(t.note ?? "")} |`),
    "",
    "## 二、名称表",
    "",
    "名称表里的英文键存进数据库，对外一律显示中文。每张表的英文名是它在代码里的名字。",
  ];
  for (const [name, def] of Object.entries(enums)) {
    out.push("", `### \`${name}\``, "", "| 中文 | 代码里的名字 |", "| --- | --- |");
    for (const key of def.keys) out.push(`| ${cell(def.table[key] ?? "")} | \`${key}\` |`);
  }
  return `${out.join("\n")}\n`;
}
