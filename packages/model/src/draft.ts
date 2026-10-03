import { z } from "zod";

// 草稿：用户在一页上已经点了、还没提交的选择，见「06 工作台」第四节和「03 数据模型」第二节。
// 工作台每点一下把整份草稿交给后端。草稿按输入框记，输入框的名字由工作台定，
// 写成「区块/卡片编号」这样，后端不解读，只按它存旧版本。
// 输入框的文字在三种时候存成旧版本，用来找回删掉的字，规则见 draftRevisionRules。

/** 存旧版本的几个数，见「06 工作台」第四节。字数按字符数，一个汉字算一个。 */
export const draftRevisionRules = {
  /** 出现过的最长的一份不到这么多字时，删了也不存。 */
  minLongest: 10,
  /** 比最长的一份少了这么多字以上，算删了一段。 */
  dropChars: 20,
  /** 或者少了一半以上。 */
  dropRatio: 0.5,
  /** 编辑期间每隔多久存一份。 */
  timedMs: 2 * 60 * 1000,
} as const;

/** 文字的字数：按字符数，一个汉字、一个表情都算一个。 */
export function textLength(text: string): number {
  return Array.from(text).length;
}

/** 新的文字比出现过的最长的一份少了一段：删之前要把最长的一份存成旧版本。 */
export function droppedMuch(longest: string, now: string): boolean {
  const before = textLength(longest);
  if (before < draftRevisionRules.minLongest) return false;
  const after = textLength(now);
  return (
    before - after >= draftRevisionRules.dropChars || after < before * draftRevisionRules.dropRatio
  );
}

/** 草稿里一个输入框或一张卡的状态。都不写的一项等于没点。 */
export const draftEntrySchema = z.strictObject({
  /** 点了哪个：选项的 key，或保留、修改、删除、明白这类表态。 */
  pick: z.string().min(1).optional(),
  /** 输入框里的文字。 */
  note: z.string().optional(),
  /** 贴进这个输入框的图，写附件的完整哈希。 */
  images: z.array(z.string()).optional(),
  /** 旧版工作台打开更改卡时自动记下的「看过了」。现在不再写，旧草稿里的照旧读得进来。 */
  seen: z.literal(true).optional(),
});
export type DraftEntry = z.infer<typeof draftEntrySchema>;

/** 整份草稿：输入框的名字对应它的状态。 */
export const draftEntriesSchema = z.record(z.string().min(1).max(200), draftEntrySchema);
export type DraftEntries = z.infer<typeof draftEntriesSchema>;
