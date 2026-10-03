import { z } from "zod";
import { renderCopy } from "../copy/define.ts";
import { pageCopy } from "../copy/page.ts";
import { pageFieldCopy } from "../copy/page-fields.ts";
import { cardIdSchema } from "./card-id.ts";
import { figureSchema, optionalText, queueRefsSchema, textSchema } from "./fields.ts";
import { reportIssue } from "./issue.ts";

// 更改：落地阶段交给用户验收的一件改动，之前哪里不对、现在什么样，再给改前改后。
// 改前改后有两种写法，只用一种，见旧格式第六版：
//
// - 界面：after 必填，有改前的图再写 before，more 是补充的改后图。
// - 文字：textBefore 和 textAfter 都写原文，textName 写这一段叫什么。逐行对比由后端算。
//
// 工作台上每条更改多一个「不认可」，按了写进回复，按卡片编号记，所以更改也有编号。

const imageKeys = ["before", "after", "more"] as const;
const textKeys = ["textBefore", "textAfter", "textName"] as const;

export const changeCardSchema = z
  .strictObject({
    id: cardIdSchema.optional().describe(renderCopy(pageFieldCopy.card.id)),
    queue: queueRefsSchema.optional().describe(renderCopy(pageFieldCopy.card.queue)),
    title: textSchema.describe(renderCopy(pageFieldCopy.change.title)),
    /** 之前哪里不对。 */
    problem: textSchema.describe(renderCopy(pageFieldCopy.change.problem)),
    /** 现在什么样。 */
    fix: textSchema.describe(renderCopy(pageFieldCopy.change.fix)),
    before: figureSchema.optional().describe(renderCopy(pageFieldCopy.change.before)),
    after: figureSchema.optional().describe(renderCopy(pageFieldCopy.change.after)),
    more: z.array(figureSchema).min(1).optional().describe(renderCopy(pageFieldCopy.change.more)),
    textName: optionalText.describe(renderCopy(pageFieldCopy.change.textName)),
    textBefore: optionalText.describe(renderCopy(pageFieldCopy.change.textBefore)),
    textAfter: optionalText.describe(renderCopy(pageFieldCopy.change.textAfter)),
  })
  .superRefine((change, ctx) => {
    const { title } = change;
    const image = imageKeys.filter((key) => change[key] !== undefined);
    const text = textKeys.filter((key) => change[key] !== undefined);
    if (image.length > 0 && text.length > 0) {
      reportIssue(ctx, "page.change.twoForms", pageCopy.change.twoForms, { title });
      return;
    }
    const [present] = [...image, ...text];
    if (present === undefined) {
      reportIssue(ctx, "page.change.noForm", pageCopy.change.noForm, { title });
      return;
    }
    const required: readonly ("after" | "textBefore" | "textAfter")[] =
      image.length > 0 ? ["after"] : ["textBefore", "textAfter"];
    const missing = required.find((key) => change[key] === undefined);
    if (missing !== undefined) {
      const values = { title, present, missing };
      reportIssue(ctx, "page.change.incomplete", pageCopy.change.incomplete, values, [missing]);
    }
  });

export type ChangeCard = z.output<typeof changeCardSchema>;
