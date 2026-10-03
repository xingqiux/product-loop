import { z } from "zod";
import { draftEntriesSchema } from "../draft.ts";
import { draftRevisionReason } from "../names.ts";

// 草稿的接口，路径见「05 接口」第四节的「页面」。
// GET、PUT /pages/:id/draft 读和存整份草稿；
// GET /pages/:id/draft/revisions 列出输入框的旧版本；POST .../revisions/:rev/restore 把一份放回输入框。

const timestamp = z.iso.datetime({ offset: true });

/** 存草稿：PUT /pages/:id/draft，交整份。 */
export const draftSaveSchema = z.strictObject({ entries: draftEntriesSchema });

/** 一份旧版本。 */
export const draftRevisionSchema = z.strictObject({
  id: z.int().min(1),
  /** 哪个输入框。 */
  field: z.string(),
  text: z.string(),
  reason: draftRevisionReason.codec,
  savedAt: timestamp,
});

/** 一页的草稿。还没点过时 entries 是空的，updatedAt 为空。 */
export const draftViewSchema = z.strictObject({
  page: z.int().min(1),
  entries: draftEntriesSchema,
  updatedAt: timestamp.nullable(),
  /** 这一次保存存下的「删之前」的旧版本。工作台据此在输入框下面出「找回刚删掉的文字」。 */
  deleted: z.array(z.string()).readonly(),
});

/** 列旧版本时可以只列一个输入框。 */
export const draftRevisionsQuerySchema = z.strictObject({ field: z.string().min(1).optional() });

export const draftRevisionsSchema = z.array(draftRevisionSchema).readonly();
