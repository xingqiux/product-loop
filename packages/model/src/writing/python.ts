// 旧脚本是 Python 写的。字符串处理有几处 Python 和 JS 不同，这里按 Python 的做法写出来，
// 移植过来的写作校验才能和旧脚本逐字相同。每处不同写在各个常量和函数的说明里。

// Python 的空白，也就是正则的 \s 和 str.isspace()，按码位列出。
// 和 JS 的 \s 相比，多了 0x1c 到 0x1f 和 0x85，少了 0xfeff。
const spaceCodes = [
  0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x1c, 0x1d, 0x1e, 0x1f, 0x20, 0x85, 0xa0, 0x1680, 0x2000, 0x2001,
  0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a, 0x2028, 0x2029, 0x202f,
  0x205f, 0x3000,
];

// str.splitlines() 断行的字符。回车后面紧跟换行时合起来算一处。
const lineBreakCodes = [0x0a, 0x0b, 0x0c, 0x0d, 0x1c, 0x1d, 0x1e, 0x85, 0x2028, 0x2029];

const charClass = (codes: readonly number[]) => codes.map((c) => `\\u{${c.toString(16)}}`).join("");

/** Python 的 \s，放进带 u 标志的正则的字符类里用，例如 new RegExp(`[${space}]`, "u")。 */
export const space = charClass(spaceCodes);

/** Python 的 \w：字母、数字和下划线。字母和数字包括汉字等各种文字，不只是 ASCII。 */
export const word = "\\p{L}\\p{N}_";

/** Python 的 \d：各种文字的十进制数字，包括全角数字。 */
export const digit = "\\p{Nd}";

const spaces = new Set(spaceCodes.map((c) => String.fromCodePoint(c)));
const lineBreak = new RegExp(`\\r\\n|[${charClass(lineBreakCodes)}]`, "u");

/** 对应 Python 的 str.strip()：去掉两头的空白。 */
export function strip(s: string): string {
  return rstrip(lstrip(s));
}

/** 对应 Python 的 str.lstrip()。 */
export function lstrip(s: string): string {
  let start = 0;
  while (start < s.length && spaces.has(s.charAt(start))) start++;
  return s.slice(start);
}

function rstrip(s: string): string {
  let end = s.length;
  while (end > 0 && spaces.has(s.charAt(end - 1))) end--;
  return s.slice(0, end);
}

/** 对应 Python 的 str.splitlines()：认十种断行，文字末尾的断行后面不再多出一行。 */
export function splitLines(s: string): string[] {
  const lines = s.split(lineBreak);
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

/** 对应 Python 的 len()：按码位数，一个表情算一个字。 */
export function len(s: string): number {
  return Array.from(s).length;
}

/** 对应 Python 的 s[:n]：前 n 个码位，不会把一个表情拆成两半。 */
export function head(s: string, n: number): string {
  return Array.from(s).slice(0, n).join("");
}

/** 对应 Python 的 s.count(x)。 */
export function count(s: string, x: string): number {
  return s.split(x).length - 1;
}
