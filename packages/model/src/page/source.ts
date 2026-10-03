import { z } from "zod";
import { renderCopy } from "../copy/define.ts";
import { pageCopy } from "../copy/page.ts";
import { pageFieldCopy } from "../copy/page-fields.ts";
import {
  filePathSchema,
  flagSchema,
  imgPathSchema,
  lineRangeSchema,
  optionalText,
  parseLineRange,
  textSchema,
} from "./fields.ts";
import { reportIssue } from "./issue.ts";

// 来源：一条写一样东西，它叫什么、在它上面看到了什么。按种类有三种写法，见「07 校验」第二节：
//
// - 界面：写 img，值是截图的路径。截图来自已有的产品或网上的设计时，另写 outside: true。
// - 文字：写 file 和 lines，要标出的行写进 mark，原文由命令摘录，存进原文摘录。
// - 用户的原话：写 quote: true，原话写在 saw 里，不配图。
//
// 定义只拒绝写法本身不对的：
// - 两种写法混在一起。
// - 文字缺了 file 或 lines。
// - 原话没有写出来。
// - 行号的写法不对。
//
// 一种写法都没有的来源，由第 25 步的规则 card.source.visual 拦截。
// 它的报错写明三种写法怎么选，见「04 命令行」第六节。

export const sourceSchema = z
  .strictObject({
    /** 这样东西叫什么。 */
    name: textSchema.describe(renderCopy(pageFieldCopy.source.name)),
    /** 在它上面看到了什么。原话的来源，这里照原样写出用户的话。 */
    saw: optionalText.describe(renderCopy(pageFieldCopy.source.saw)),
    img: imgPathSchema.optional().describe(renderCopy(pageFieldCopy.source.img)),
    outside: flagSchema.describe(renderCopy(pageFieldCopy.source.outside)),
    file: filePathSchema.optional().describe(renderCopy(pageFieldCopy.source.file)),
    /** 摘哪几行，写成 12-20，只摘一行写 12。 */
    lines: lineRangeSchema.optional().describe(renderCopy(pageFieldCopy.source.lines)),
    /** 要标出的行号，在 lines 的范围里。 */
    mark: z
      .array(z.int().positive())
      .min(1)
      .optional()
      .describe(renderCopy(pageFieldCopy.source.mark)),
    quote: flagSchema.describe(renderCopy(pageFieldCopy.source.quote)),
  })
  .superRefine((source, ctx) => {
    const { name } = source;
    const forms = (["img", "file", "quote"] as const).filter((key) => source[key] !== undefined);
    const [first, second] = forms;
    if (first !== undefined && second !== undefined) {
      reportIssue(ctx, "page.source.twoForms", pageCopy.source.twoForms, { name, first, second });
    }

    const textKeys = (["file", "lines", "mark"] as const).filter(
      (key) => source[key] !== undefined,
    );
    const [present] = textKeys;
    const missing = source.file === undefined ? "file" : source.lines === undefined ? "lines" : "";
    if (present !== undefined && missing !== "") {
      const values = { name, present, missing };
      reportIssue(ctx, "page.source.textIncomplete", pageCopy.source.textIncomplete, values, [
        missing,
      ]);
    }
    if (source.lines !== undefined && source.mark !== undefined) {
      checkMark(source.lines, source.mark, ctx);
    }

    if (source.quote !== undefined && source.saw === undefined) {
      reportIssue(ctx, "page.source.quoteWithoutSaw", pageCopy.source.quoteWithoutSaw, { name }, [
        "saw",
      ]);
    }
    if (source.outside !== undefined && (source.file !== undefined || source.quote !== undefined)) {
      reportIssue(ctx, "page.source.outsideNotImage", pageCopy.source.outsideNotImage, { name }, [
        "outside",
      ]);
    }
  })
  .meta({ id: "source" });

export type Source = z.output<typeof sourceSchema>;

/** mark 的行号不重复，并且都在 lines 的范围里。lines 本身写错时，由 lines 自己报。 */
function checkMark(lines: string, mark: readonly number[], ctx: z.RefinementCtx<unknown>): void {
  const range = parseLineRange(lines);
  if (!range.ok) return;
  mark.forEach((line, i) => {
    if (mark.indexOf(line) !== i) {
      reportIssue(ctx, "page.lines.markDuplicate", pageCopy.lines.markDuplicate, { line }, [
        "mark",
        i,
      ]);
    } else if (line < range.value.start || line > range.value.end) {
      reportIssue(ctx, "page.lines.markOutside", pageCopy.lines.markOutside, { line, lines }, [
        "mark",
        i,
      ]);
    }
  });
}

/** 来源的三种写法。一种都没有写时是 undefined，由规则 card.source.visual 拦截。 */
export type SourceForm = "img" | "text" | "quote";

export function sourceForm(source: Source): SourceForm | undefined {
  if (source.img !== undefined) return "img";
  if (source.file !== undefined) return "text";
  if (source.quote !== undefined) return "quote";
  return undefined;
}

/** 卡片的来源，至少一条。 */
export const sourcesSchema = z.array(sourceSchema).min(1);
