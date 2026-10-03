import { err, ok, type Result } from "./result.ts";

// 项目内的编号：队列事项写成 Q12，场景写成 S14，都从 1 起连续编，见「03 数据模型」第二节。

/**
 * - shape：样子不对，例如小写的 q、数字前面补了 0、只有字母没有数字。
 * - zero：写了 0，编号从 1 起。
 */
export type IdError = "shape" | "zero";

function parseId(prefix: string, text: string): Result<number, IdError> {
  if (!text.startsWith(prefix)) return err("shape");
  const digits = text.slice(prefix.length);
  if (digits === "0") return err("zero");
  if (!/^[1-9]\d*$/u.test(digits)) return err("shape");
  const n = Number(digits);
  return Number.isSafeInteger(n) ? ok(n) : err("shape");
}

export const formatQueueId = (n: number): string => `Q${n}`;
export const parseQueueId = (text: string): Result<number, IdError> => parseId("Q", text);

export const formatSceneId = (n: number): string => `S${n}`;
export const parseSceneId = (text: string): Result<number, IdError> => parseId("S", text);

/**
 * 解析 `Q12,Q15` 这样的列表，逗号、顿号和空白都算分隔。重复的只留第一个。
 * 有写错的，一次报出写错的全部几个。空列表照常返回，由调用的地方决定收不收。
 */
export function parseQueueIdList(text: string): Result<number[], { readonly bad: string[] }> {
  const parts = text.split(/[,，、\s]+/u).filter((part) => part !== "");
  const ids: number[] = [];
  const bad: string[] = [];
  for (const part of parts) {
    const id = parseQueueId(part);
    if (!id.ok) bad.push(part);
    else if (!ids.includes(id.value)) ids.push(id.value);
  }
  return bad.length > 0 ? err({ bad }) : ok(ids);
}
