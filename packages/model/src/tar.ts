// 归档包用的 tar 格式，只写不读：命令行打包旧文件，后端的测试也用它造包，见「08 版本与迁移」第四节。
// 每个文件前面先写一个 PAX 扩展头，路径写在里面，中文和长路径都不用截断。
// 普通头里的名字只放 ASCII 的替身，读包时以扩展头的路径为准。
// 这里只拼字节，不读文件、不压缩，所以网页里也能用。压缩由调用的一方用 gzip 做。

const block = 512;

/** 文字写成 UTF-8 的字节。model 不带 DOM 和 Node 的类型，所以自己写，不用 TextEncoder。 */
function utf8(text: string): Uint8Array {
  const bytes: number[] = [];
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 0x80) bytes.push(code);
    else if (code < 0x800) bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    else if (code < 0x10000) {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    } else {
      bytes.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
    }
  }
  return Uint8Array.from(bytes);
}

/** 写进头里的一段文字，不足的补 0。 */
function put(header: Uint8Array, start: number, length: number, text: string): void {
  header.set(utf8(text).subarray(0, length), start);
}

/** 数字写成八进制，前面补 0，后面留一个 0 字节。 */
function octal(value: number, length: number): string {
  return `${value.toString(8).padStart(length - 1, "0")}\0`;
}

/** 一个 512 字节的头：名字、大小和种类。校验和按规定先当成八个空格算。 */
function header(name: string, size: number, type: "0" | "x"): Uint8Array {
  const bytes = new Uint8Array(block);
  put(bytes, 0, 100, name);
  put(bytes, 100, 8, octal(0o644, 8));
  put(bytes, 108, 8, octal(0, 8));
  put(bytes, 116, 8, octal(0, 8));
  put(bytes, 124, 12, octal(size, 12));
  put(bytes, 136, 12, octal(0, 12));
  put(bytes, 148, 8, "        ");
  put(bytes, 156, 1, type);
  put(bytes, 257, 6, "ustar\0");
  put(bytes, 263, 2, "00");
  const sum = bytes.reduce((total, byte) => total + byte, 0);
  put(bytes, 148, 8, `${sum.toString(8).padStart(6, "0")}\0 `);
  return bytes;
}

/** PAX 的一条记录：「长度 path=路径\n」，长度按字节算，含它自己。 */
function paxRecord(path: string): Uint8Array {
  const body = utf8(` path=${path}\n`).byteLength;
  let length = body + 1;
  while (String(length).length + body !== length) length = String(length).length + body;
  return utf8(`${length} path=${path}\n`);
}

/** 补齐到 512 字节的整数倍要补几个 0。 */
export function tarPadding(size: number): Uint8Array {
  return new Uint8Array((block - (size % block)) % block);
}

/** 一个文件的头：扩展头和它的内容，再接普通头。文件内容和补齐的 0 由调用的一方接在后面。 */
export function tarFileHeader(path: string, size: number): Uint8Array {
  const record = paxRecord(path);
  const parts = [
    header("PaxHeader", record.byteLength, "x"),
    record,
    tarPadding(record.byteLength),
  ];
  const ascii = /^[\x20-\x7e]{1,99}$/u.test(path) ? path : "file";
  parts.push(header(ascii, size, "0"));
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.byteLength;
  }
  return out;
}

/** 归档包里的第一个文件：清单，写每个文件的路径、字节数和 SHA-256。 */
export const archiveManifestName = ".ploop-manifest.json";

/** 包的结尾：两个全 0 的块。 */
export function tarEnd(): Uint8Array {
  return new Uint8Array(block * 2);
}
