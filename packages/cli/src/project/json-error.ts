// JSON 写坏时找出第一处出错的位置，报错写到行和列，见「04 命令行」第六节。
// JSON.parse 报的错有的带位置，有的不带，文字还会随 Node 的版本变，
// 所以出错以后按 JSON 的语法自己从头走一遍，停在第一处不合语法的地方。

/** 文字里的一个位置，行和列都从 1 数。列按 UTF-16 的码元数，一个汉字算一列。 */
export type TextPosition = { readonly line: number; readonly column: number };

const blank = new Set([" ", "\t", "\n", "\r"]);
const escaped = new Set(['"', "\\", "/", "b", "f", "n", "r", "t"]);
const isDigit = (ch: string) => ch >= "0" && ch <= "9";
const isHex = (ch: string) => /^[0-9A-Fa-f]$/u.test(ch);

/** 第一处不合 JSON 语法的地方，从 0 数。文字是合法的 JSON 时返回 undefined。 */
function firstBadOffset(text: string): number | undefined {
  let i = 0;
  // 读到文字末尾时是空字符串，下面的比较都不成立，按出错处理。
  const peek = () => text.charAt(i);
  const skipBlank = () => {
    while (blank.has(peek())) i += 1;
  };
  const digits = () => {
    const from = i;
    while (isDigit(peek())) i += 1;
    return i > from;
  };
  const word = (expected: string) => {
    for (const ch of expected) {
      if (peek() !== ch) return false;
      i += 1;
    }
    return true;
  };
  const stringValue = () => {
    i += 1;
    for (;;) {
      const ch = peek();
      if (ch === '"') {
        i += 1;
        return true;
      }
      // 控制字符要转义。文字末尾的空字符串也小于空格，按字符串没写完处理。
      if (ch < " ") return false;
      i += 1;
      if (ch === "\\") {
        if (peek() === "u") {
          i += 1;
          for (let k = 0; k < 4; k += 1) {
            if (!isHex(peek())) return false;
            i += 1;
          }
        } else if (escaped.has(peek())) {
          i += 1;
        } else {
          return false;
        }
      }
    }
  };
  const numberValue = () => {
    if (peek() === "-") i += 1;
    if (peek() === "0") i += 1;
    else if (!digits()) return false;
    if (peek() === ".") {
      i += 1;
      if (!digits()) return false;
    }
    if (peek() === "e" || peek() === "E") {
      i += 1;
      if (peek() === "+" || peek() === "-") i += 1;
      if (!digits()) return false;
    }
    return true;
  };
  const objectValue = () => {
    i += 1;
    skipBlank();
    if (peek() === "}") {
      i += 1;
      return true;
    }
    for (;;) {
      skipBlank();
      if (peek() !== '"' || !stringValue()) return false;
      skipBlank();
      if (peek() !== ":") return false;
      i += 1;
      if (!value()) return false;
      skipBlank();
      if (peek() === "}") {
        i += 1;
        return true;
      }
      if (peek() !== ",") return false;
      i += 1;
    }
  };
  const arrayValue = () => {
    i += 1;
    skipBlank();
    if (peek() === "]") {
      i += 1;
      return true;
    }
    for (;;) {
      if (!value()) return false;
      skipBlank();
      if (peek() === "]") {
        i += 1;
        return true;
      }
      if (peek() !== ",") return false;
      i += 1;
    }
  };
  const value = (): boolean => {
    skipBlank();
    const ch = peek();
    if (ch === "{") return objectValue();
    if (ch === "[") return arrayValue();
    if (ch === '"') return stringValue();
    if (ch === "t") return word("true");
    if (ch === "f") return word("false");
    if (ch === "n") return word("null");
    if (ch === "-" || isDigit(ch)) return numberValue();
    return false;
  };

  if (value()) {
    skipBlank();
    if (i === text.length) return undefined;
  }
  return i;
}

/** 第一处不合 JSON 语法的位置。文字是合法的 JSON 时返回 undefined。 */
export function jsonSyntaxError(text: string): TextPosition | undefined {
  const offset = firstBadOffset(text);
  if (offset === undefined) return undefined;
  const before = text.slice(0, offset);
  const lineStart = before.lastIndexOf("\n") + 1;
  return { line: before.split("\n").length, column: offset - lineStart + 1 };
}
