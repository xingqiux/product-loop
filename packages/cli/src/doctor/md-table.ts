// 迁移对照里的 Markdown 表格：迁移检查写出来，AI 改过以后命令再读回去，见「08 版本与迁移」第四节。
// 格子里的竖线写成 \|，换行写成 <br>。表头按列名找，AI 调换了列的顺序也读得出。

/** 一列：代码里的英文键和表头上的中文列名。 */
export type Column<K extends string> = readonly [K, string];

const escapeCell = (text: string) => text.replaceAll("|", "\\|").replace(/\r\n|\r|\n/gu, "<br>");

const unescapeCell = (text: string) => text.trim().replaceAll("\\|", "|").replaceAll("<br>", "\n");

/** 一行表格拆成各格。不是表格的行返回 undefined。 */
function splitRow(line: string): string[] | undefined {
  const text = line.trim();
  if (!text.startsWith("|")) return undefined;
  const cells: string[] = [];
  let cell = "";
  for (let i = 1; i < text.length; i++) {
    const char = text[i];
    if (char === "\\" && text[i + 1] === "|") {
      cell += "\\|";
      i++;
    } else if (char === "|") {
      cells.push(unescapeCell(cell));
      cell = "";
    } else cell += char;
  }
  if (cell.trim() !== "") cells.push(unescapeCell(cell));
  return cells;
}

/** 写出一张表：表头、分隔行和各行。 */
export function tableLines<K extends string>(
  columns: readonly Column<K>[],
  rows: readonly ReadonlyMap<K, string>[],
): string[] {
  const labels = columns.map(([, label]) => label);
  return [
    `| ${labels.join(" | ")} |`,
    `| ${labels.map(() => "---").join(" | ")} |`,
    ...rows.map(
      (row) => `| ${columns.map(([key]) => escapeCell(row.get(key) ?? "")).join(" | ")} |`,
    ),
  ];
}

/** 找到表头含全部列名的第一张表，按列名取每一行。找不到时返回 undefined。 */
export function readTable<K extends string>(
  text: string,
  columns: readonly Column<K>[],
): ReadonlyMap<K, string>[] | undefined {
  const lines = text.split(/\r\n|\r|\n/u);
  for (const [i, line] of lines.entries()) {
    const header = splitRow(line);
    if (header === undefined || !columns.every(([, label]) => header.includes(label))) continue;
    const rows: ReadonlyMap<K, string>[] = [];
    for (const next of lines.slice(i + 1)) {
      const cells = splitRow(next);
      if (cells === undefined) break;
      if (cells.length > 0 && cells.every((cell) => /^:?-+:?$/u.test(cell))) continue;
      rows.push(new Map(columns.map(([key, label]) => [key, cells[header.indexOf(label)] ?? ""])));
    }
    return rows;
  }
  return undefined;
}

/** 勾选的清单：「- [ ] 文字」和「- [x] 文字」。 */
export type Checklist = { readonly open: readonly string[]; readonly done: readonly string[] };

export function readChecklist(text: string): Checklist {
  const open: string[] = [];
  const done: string[] = [];
  for (const line of text.split(/\r\n|\r|\n/u)) {
    const m = /^\s*[-*]\s+\[([ xX])\]\s*(.*)$/u.exec(line);
    if (m === null) continue;
    (m[1] === " " ? open : done).push((m[2] ?? "").trim());
  }
  return { open, done };
}

export const checklistLine = (text: string) => `- [ ] ${text}`;
