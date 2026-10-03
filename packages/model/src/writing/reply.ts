import { stage } from "../names.ts";
import { checkProse, removeLinks, reportWording, type WritingOptions } from "./check.ts";
import { maskExceptions } from "./glossary.ts";
import { lstrip, space, splitLines, strip, word } from "./python.ts";
import { collect, type Report, type WritingResult } from "./rules.ts";

// 会话回复发出去之前的自查，从旧 check-reply.py 的 problems 移植。
// 查首行的阶段、文件名、「·」、链接的位置，再对正文跑写作校验里旧 writing.py 的那几项。
// 措辞一类（红方蓝方、口头说法、编号指代、统计数字）回复也查，只警告，是对旧脚本的有意改动；
// 间隔号回复有自己的拦截。「04 命令行」要求首行以当前的阶段开头，由后端另查。

// 文件名。Node.js 这类库名不算，前面紧跟英文字母的不算，后面紧跟字母或数字的也不算
const fileName = new RegExp(
  `(?<![A-Za-z])(?!(?:Node|Next|Vue|Nuxt|Three|D3|Express)\\.js(?![${word}]))[${word}\\-./]+\\.(?:md|json|html|py|mjs|js|css|png|jpg|txt|sh)(?![${word}])`,
  "iu",
);
const reason = new RegExp(`[：:][${space}]*[^${space}]`, "u");
// 表格的分隔行，整行只有竖线、冒号、短横和空白
const tableRule = new RegExp(`^[${space}|:\\-]+$`, "u");
const quoteMark = new RegExp(`^[${space}]*>[${space}]?`, "u");

// 首行开头写阶段的叫法，例如「第 2 版的检查阶段：……」，阶段名在里面，也算写了阶段。
// 「v2-检查-1：……」这样的内部编号不认，决定 211 不许对用户写它。
// 是不是当前的阶段，由后端的 writing.reply.round 查。
const roundStart = new RegExp(`^第\\s*\\d+\\s*版的?\\s*(?:${stage.labels.join("|")})阶段`, "u");
// 首行的阶段叫法带着数字（第 2 版、第 2 次），措辞的统计数字不查它。
const roundName = new RegExp(
  `^[${space}]*第\\s*\\d+\\s*版的?\\s*(?:${stage.labels.join("|")})阶段(?:[（(]第\\s*\\d+\\s*次[）)])?`,
  "u",
);

/** 查一份会话回复。拦截的有一条，就不该发出去。 */
export function checkReply(text: string, options: WritingOptions = {}): WritingResult {
  const { result, report } = collect();
  reportReply(text, options, report);
  return result;
}

/** 查法和 checkReply 相同，查出的每一处交给 report。规则框架由此按编号分给各条规则。 */
export function reportReply(text: string, options: WritingOptions, report: Report): void {
  const lines = splitLines(strip(text));
  const first = strip(lines[0] ?? "");
  const opening = stage.labels.some((label) => first.startsWith(label)) || roundStart.test(first);
  if (!(opening && reason.test(first))) {
    report("writing.reply.firstLine");
  }
  const body = removeLinks(maskExceptions(text, options.project?.exceptions ?? []));
  const name = fileName.exec(body)?.[0];
  if (name !== undefined) report("writing.reply.fileName", { name });
  if (body.includes("·")) report("writing.reply.interpunct");
  const last = lines.findLastIndex((line) => removeLinks(line) !== line);
  if (last !== -1 && lines.slice(last + 1).some((line) => strip(line) !== "")) {
    report("writing.reply.linkLast");
  }
  // 表格的每一格和引用行里的字，拆成一行一段交给写作校验
  const prose = lines
    .filter((line) => !tableRule.test(line))
    .map((line) =>
      /^[|>]/u.test(lstrip(line)) ? line.replace(quoteMark, "").replaceAll("|", "\n") : line,
    )
    .join("\n");
  checkProse(prose, options.project, report);
  reportWording(text.replace(roundName, ""), options.project, report, [
    "writing.wording.interpunct",
  ]);
}
