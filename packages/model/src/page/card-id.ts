import { z } from "zod";
import { pageCopy } from "../copy/page.ts";
import { reportIssue } from "./issue.ts";

// 卡片编号：草稿和回复都按它记，工作台的地址 ?item= 也写它，见「03 数据模型」第二节。
// AI 可以自己写，例如 spec-twelve；没写的由命令按标题生成。写了的要在本页唯一。

const cardIdPattern = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;

/** 编号最长多少个字符。生成的编号是区块的前缀加七位，最长的是 improvement-xxxxxxx-9。 */
export const cardIdMaxLength = 48;

export function isCardId(text: string): boolean {
  return text.length <= cardIdMaxLength && cardIdPattern.test(text);
}

/** 卡片编号：小写英文字母、数字和短横，以字母开头，短横不连着写，也不在末尾。 */
export const cardIdSchema = z
  .string()
  .superRefine((id, ctx) => {
    if (!isCardId(id)) reportIssue(ctx, "page.cardId.shape", pageCopy.cardId.shape, { id });
  })
  .meta({ id: "cardId", pattern: cardIdPattern.source, maxLength: cardIdMaxLength });

/**
 * 32 位的 FNV-1a 哈希，按 UTF-8 的字节算。结果和平台、运行次数无关，
 * 浏览器和 Node 都能算，不用 node:crypto。
 *
 * 算法：h 从 0x811c9dc5 开始，对每个字节先 h ^= 字节，再 h = h × 0x01000193，取低 32 位。
 */
export function fnv1a32(text: string): number {
  let hash = 0x811c9dc5;
  for (const byte of utf8Bytes(text)) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** 字符串按 UTF-8 编成字节。单独出现的代理项按 U+FFFD 编，和 TextEncoder 的做法相同。 */
function* utf8Bytes(text: string): Generator<number> {
  for (const char of text) {
    let code = char.codePointAt(0) ?? 0xfffd;
    if (code >= 0xd800 && code <= 0xdfff) code = 0xfffd;
    if (code < 0x80) {
      yield code;
    } else if (code < 0x800) {
      yield 0xc0 | (code >> 6);
      yield 0x80 | (code & 0x3f);
    } else if (code < 0x10000) {
      yield 0xe0 | (code >> 12);
      yield 0x80 | ((code >> 6) & 0x3f);
      yield 0x80 | (code & 0x3f);
    } else {
      yield 0xf0 | (code >> 18);
      yield 0x80 | ((code >> 12) & 0x3f);
      yield 0x80 | ((code >> 6) & 0x3f);
      yield 0x80 | (code & 0x3f);
    }
  }
}

/** 标题先规整再算哈希：Unicode 按 NFC 合成，去掉首尾空白，中间连着的空白算一个空格。 */
export function normalizeTitle(title: string): string {
  return title.normalize("NFC").trim().replace(/\s+/gu, " ");
}

/**
 * 按标题生成的编号：区块的前缀、短横、标题哈希的 36 进制，补足七位。
 * 例如疑问卡「队列看板放在哪里」得到 ask- 加七位。同一个标题在同一个区块里总是得到同一个编号。
 * 同一页里撞上了别的编号时，由 assignCardIds 在后面加 -2、-3。
 */
export function cardIdFromTitle(prefix: string, title: string): string {
  return `${prefix}-${fnv1a32(normalizeTitle(title)).toString(36).padStart(7, "0")}`;
}
