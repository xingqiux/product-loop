import { z } from "zod";
import { renderCopy } from "../copy/define.ts";
import { pageFieldCopy } from "../copy/page-fields.ts";
import { cardIdSchema } from "./card-id.ts";
import {
  imgPathSchema,
  optionalText,
  queueRefsSchema,
  sceneRefSchema,
  textSchema,
} from "./fields.ts";

// 场景清单：构思阶段给用户看的场景草稿，每个场景点保留、修改或删除，见旧格式第八版。
// 已经在主线里的场景写场景编号。新场景还没有编号时可以不写，
// 编号由命令收进主线时补上，见「09 skill 与软件」第三节。

/**
 * 场景的一步：做什么，该看到什么，可以配这一步的截图。
 * 字段名和主线解析出的步骤相同，该看到什么写 expect，见术语对照。
 */
export const sceneStepSchema = z.strictObject({
  do: textSchema.describe(renderCopy(pageFieldCopy.scene.do)),
  expect: textSchema.describe(renderCopy(pageFieldCopy.scene.expect)),
  img: imgPathSchema.optional().describe(renderCopy(pageFieldCopy.scene.img)),
});

/** 场景清单里的一个场景。 */
export const sceneDraftSchema = z.strictObject({
  id: cardIdSchema.optional().describe(renderCopy(pageFieldCopy.card.id)),
  queue: queueRefsSchema.optional().describe(renderCopy(pageFieldCopy.card.queue)),
  /** 场景编号，例如 S3。 */
  scene: sceneRefSchema.optional().describe(renderCopy(pageFieldCopy.scene.scene)),
  name: textSchema.describe(renderCopy(pageFieldCopy.scene.name)),
  /** 谁在什么时候用。 */
  who: optionalText.describe(renderCopy(pageFieldCopy.scene.who)),
  /** 名字旁边的小标记，例如「新」「改过」。 */
  mark: optionalText.describe(renderCopy(pageFieldCopy.scene.mark)),
  steps: z.array(sceneStepSchema).min(1).describe(renderCopy(pageFieldCopy.scene.steps)),
});

export type SceneDraft = z.output<typeof sceneDraftSchema>;
