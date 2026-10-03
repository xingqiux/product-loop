import { len, space, splitLines, strip } from "./python.ts";

// 长度的两种算法和断句，从旧 writing.py 的 length、width、sentences 移植，见「07 校验」第五节。
// 行名不超过八个字按显示宽度算，一格和一句的长度按读起来的长度算。

const asciiRun = /[A-Za-z0-9_./:-]+/gu;
const uncounted = new RegExp(`[${space}，、；：。！？（）()\\-*|#>\`]`, "gu");
const printable = /[!-~]/gu;

/** 读起来的长度：一串英文或数字算一个字，标点和空白不算。 */
export function readingLength(s: string): number {
  return len(s.replace(asciiRun, "x").replace(uncounted, ""));
}

/** 显示的宽度：一个汉字算一个字，两个英文字母或数字算一个字，标点和空白不算。 */
export function displayWidth(s: string): number {
  const plain = s.replace(uncounted, "");
  const ascii = plain.match(printable)?.length ?? 0;
  return len(plain) - ascii + Math.ceil(ascii / 2);
}

/** 按句号、问号、叹号断句，换行处也断开。去掉两头的空白，空的句子不算。 */
export function splitSentences(text: string): string[] {
  return splitLines(text)
    .flatMap((line) => line.split(/(?<=[。！？])/u))
    .map(strip)
    .filter((s) => s !== "");
}
