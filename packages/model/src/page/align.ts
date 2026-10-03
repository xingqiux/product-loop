import { z } from "zod";
import { renderCopy } from "../copy/define.ts";
import { pageFieldCopy } from "../copy/page-fields.ts";
import { cardIdSchema } from "./card-id.ts";
import { diagramSchema, queueRefsSchema, textSchema } from "./fields.ts";

// 先对齐：本页选项会用到的术语，排在疑问前面，每个术语点明白或不明白（决定 114）。
// 四项都要写。前两条由第 26 步的规则查，第三条要看上一轮的回复，由后端的 align.unclear.reworded 查：
// - usedIn 对不对得上本页疑问卡的标题。
// - 名称有没有重复。
// - 上一轮点了不明白的，这一轮换没换讲法。

export const alignTermSchema = z.strictObject({
  id: cardIdSchema.optional().describe(renderCopy(pageFieldCopy.card.id)),
  queue: queueRefsSchema.optional().describe(renderCopy(pageFieldCopy.card.queue)),
  /** 术语的名称，全篇只用这一个。 */
  name: textSchema.describe(renderCopy(pageFieldCopy.align.name)),
  /** 用到它的疑问卡的标题。 */
  usedIn: z.array(textSchema).min(1).describe(renderCopy(pageFieldCopy.align.usedIn)),
  /** 意思，一句话。 */
  meaning: textSchema.describe(renderCopy(pageFieldCopy.align.meaning)),
  /** 例子，这个项目里的一件真事。 */
  example: textSchema.describe(renderCopy(pageFieldCopy.align.example)),
  diagram: diagramSchema.optional().describe(renderCopy(pageFieldCopy.align.diagram)),
});

export type AlignTerm = z.output<typeof alignTermSchema>;
