import { readFileSync } from "node:fs";
import { crc32, inflateSync } from "node:zlib";
import { err, ok, type Result } from "@product-loop/model";
import { type BlobHash, blobPath } from "./blobs.ts";

// 屏的变化检测：同一屏的两张截图算不算变过，见「03 数据模型」第二节「使用记录和屏」。
// 做法按「02 技术选型」第十八节：先用差异哈希快速筛选，再逐个像素复核。
// 差异哈希：截图转成灰度，缩成 17 列 16 行的格子，每行相邻两格比亮暗，得到 16×16 共 256 位。
// 复核照 pixelmatch 的算法：按 YIQ 颜色空间比每个像素，差别超过 0.1 的算不同。
// 选型写的是 pngjs 和 pixelmatch 两个库。这里用 node:zlib 自己解码、自己比像素，不加依赖。
// 理由和选型相同：都是纯 JavaScript，不带原生库。pixelmatch 的抗锯齿识别没有做，见 differentPixels。

/** 截图的感知哈希和尺寸。 */
export type ScreenHash = {
  /** 256 位的差异哈希，写成 64 位小写十六进制，按格子的行从上到下、每行从左到右排。 */
  readonly hash: string;
  /** 截图的宽和高，单位是像素。 */
  readonly width: number;
  readonly height: number;
};

/**
 * 读不出截图的原因。
 * - notPng：不是 PNG。使用代码的截图统一是 PNG，见「02 技术选型」第十八节。
 * - corrupt：是 PNG，但文件坏了或者不合 PNG 的规定，例如校验码不对、数据不够。
 * - tooLarge：像素超过 maxScreenPixels。
 */
export type ScreenHashError = { readonly kind: "notPng" | "corrupt" | "tooLarge" };

/** 截图最多这么多像素。两倍像素密度下两千八百宽、一万四千高的整页截图也在其内。 */
export const maxScreenPixels = 40_000_000;

/**
 * 快速筛选的界线：差异哈希的距离超过它，不再复核，直接算变过。
 * 对真实截图的测量里，光标、滚动条、焦点框、整图挪一个像素都在 16 位以内。
 * 前后两天真实变过的屏大多在 45 位以上。
 */
export const hashChangeThreshold = 24;

/**
 * 复核的界线：两张截图不同的像素超过这么多，才算变过。
 * 输入框的光标约 20 个像素，算没变。多一个按钮、按钮换了颜色、多一行字，都在两千个像素上下。
 * 一小段文字换了，例如「3 分钟前」变成「7 分钟前」，约一百五十个像素，也算变过。
 * 按「12 风险」R8 的取舍，界线偏低，宁可多列几屏。
 */
export const pixelChangeThreshold = 100;

/** 两个像素的颜色差别超过它算不同，和 pixelmatch 的默认值相同。 */
const pixelTolerance = 0.1;

/** YIQ 颜色差别的最大值，照 pixelmatch。 */
const maxYiqDelta = 35215;

/** 格子的列数和行数。每行相邻两格比一次，所以列数比每行的位数多一。 */
const gridColumns = 17;
const gridRows = 16;

/** 两个感知哈希有几位不同。两个哈希要一样长。 */
export function hashDistance(a: string, b: string): number {
  if (a.length !== b.length) throw new Error(`两个感知哈希的长度不同：${a.length} 和 ${b.length}`);
  let distance = 0;
  for (let i = 0; i < a.length; i += 1) {
    distance += bitCount(Number.parseInt(a.charAt(i), 16) ^ Number.parseInt(b.charAt(i), 16));
  }
  return distance;
}

/** 四位数里有几个 1。 */
function bitCount(nibble: number): number {
  let n = nibble;
  let count = 0;
  while (n > 0) {
    count += n & 1;
    n >>= 1;
  }
  return count;
}

/**
 * 两张一样大的截图有几个像素不同，照 pixelmatch 的颜色差别算，不做抗锯齿识别。
 * 使用代码在同一台电脑上截图，没改的界面每次画出来都一样，所以不必识别抗锯齿。
 * 换了浏览器或系统版本以后，字的边缘会有差别，这一次多数屏会算变过。
 */
export function differentPixels(a: RgbImage, b: RgbImage): number {
  if (a.width !== b.width || a.height !== b.height) {
    throw new Error("比较像素的两张截图要一样大。");
  }
  const limit = maxYiqDelta * pixelTolerance * pixelTolerance;
  let count = 0;
  for (let at = 0; at < a.rgb.length; at += 3) {
    const r1 = a.rgb[at] ?? 0;
    const g1 = a.rgb[at + 1] ?? 0;
    const b1 = a.rgb[at + 2] ?? 0;
    const r2 = b.rgb[at] ?? 0;
    const g2 = b.rgb[at + 1] ?? 0;
    const b2 = b.rgb[at + 2] ?? 0;
    if (r1 === r2 && g1 === g2 && b1 === b2) continue;
    const y = yiqY(r1, g1, b1) - yiqY(r2, g2, b2);
    const i = yiqI(r1, g1, b1) - yiqI(r2, g2, b2);
    const q = yiqQ(r1, g1, b1) - yiqQ(r2, g2, b2);
    if (0.5053 * y * y + 0.299 * i * i + 0.1957 * q * q > limit) count += 1;
  }
  return count;
}

const yiqY = (r: number, g: number, b: number) => r * 0.29889531 + g * 0.58662247 + b * 0.11448223;
const yiqI = (r: number, g: number, b: number) => r * 0.59597799 - g * 0.2741761 - b * 0.32180189;
const yiqQ = (r: number, g: number, b: number) => r * 0.21147017 - g * 0.52261711 + b * 0.31114694;

/**
 * 同一屏的两张截图是否算变过。依次看：
 * 1. 尺寸不同，算变过。
 * 2. 差异哈希的距离超过 hashChangeThreshold，算变过。
 * 3. 否则逐个像素复核，不同的像素超过 pixelChangeThreshold 才算变过。
 * 读像素只在第 3 步做，所以两张图的像素由调用的一方按需给出。读不出来时给 undefined，算变过。
 */
export function screenChanged(
  before: ScreenHash,
  after: ScreenHash,
  pixels: () => readonly [RgbImage, RgbImage] | undefined,
): boolean {
  if (before.width !== after.width || before.height !== after.height) return true;
  if (hashDistance(before.hash, after.hash) > hashChangeThreshold) return true;
  const images = pixels();
  if (images === undefined) return true;
  const [a, b] = images;
  if (a.width !== b.width || a.height !== b.height) return true;
  return differentPixels(a, b) > pixelChangeThreshold;
}

/** 读附件库里的一张截图。文件不在时返回 undefined。 */
export function readShot(
  blobsDir: string,
  hash: BlobHash,
): Result<RgbImage, ScreenHashError> | undefined {
  let png: Buffer;
  try {
    png = readFileSync(blobPath(blobsDir, hash));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    if (code === "ENOENT" || code === "ENOTDIR") return undefined;
    throw error;
  }
  return decodePng(png);
}

/** 算一张 PNG 截图的感知哈希。 */
export function screenHash(png: Uint8Array): Result<ScreenHash, ScreenHashError> {
  const image = decodePng(png);
  return image.ok ? ok(hashImage(image.value)) : image;
}

/** 算解好的截图的感知哈希。 */
export function hashImage(image: RgbImage): ScreenHash {
  const { width, height } = image;
  const means = cellMeans(image);
  let hash = "";
  let nibble = 0;
  let bits = 0;
  for (let row = 0; row < gridRows; row += 1) {
    for (let column = 0; column < gridColumns - 1; column += 1) {
      const at = row * gridColumns + column;
      // 左边比右边亮记 1。
      nibble = (nibble << 1) | ((means[at] ?? 0) > (means[at + 1] ?? 0) ? 1 : 0);
      bits += 1;
      if (bits === 4) {
        hash += nibble.toString(16);
        nibble = 0;
        bits = 0;
      }
    }
  }
  return { hash, width, height };
}

/**
 * 每一格盖住的像素的平均亮度，按行排。亮度用 PIL 的整数公式。
 * 图的宽或高不到格子数时，格子之间共用像素，每一格至少取一个像素。
 */
function cellMeans(image: RgbImage): Float64Array {
  const { width, height, rgb } = image;
  const columns = spans(width, gridColumns);
  const rows = spans(height, gridRows);
  // 先把每一行格子盖住的像素按列加起来，再按格子的列合起来。
  const sums = new Float64Array(gridRows * width);
  for (const [r, [y0, y1]] of rows.entries()) {
    const base = r * width;
    for (let y = y0; y < y1; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const at = (y * width + x) * 3;
        sums[base + x] =
          (sums[base + x] ?? 0) + luma(rgb[at] ?? 0, rgb[at + 1] ?? 0, rgb[at + 2] ?? 0);
      }
    }
  }
  const means = new Float64Array(gridRows * gridColumns);
  for (const [r, [y0, y1]] of rows.entries()) {
    for (const [c, [x0, x1]] of columns.entries()) {
      let sum = 0;
      for (let x = x0; x < x1; x += 1) sum += sums[r * width + x] ?? 0;
      means[r * gridColumns + c] = sum / ((x1 - x0) * (y1 - y0));
    }
  }
  return means;
}

/** 把 size 个像素分给 cells 个格子，每格是一段 [开始, 结束)。 */
function spans(size: number, cells: number): (readonly [number, number])[] {
  return Array.from({ length: cells }, (_, i) => {
    const start = Math.min(Math.floor((i * size) / cells), size - 1);
    const end = Math.max(start + 1, Math.floor(((i + 1) * size) / cells));
    return [start, end] as const;
  });
}

// ── PNG 解码 ──
// 按 PNG 规范（ISO/IEC 15948）解出每个像素的颜色：五种颜色类型、各种位深、tRNS 透明、隔行扫描都认。
// 透明的像素按铺在白底上算，和 pixelmatch 的做法相同。

/** 解出来的截图，一个像素三个字节，依次是 R、G、B，按行排。 */
export type RgbImage = {
  readonly width: number;
  readonly height: number;
  readonly rgb: Uint8Array;
};

const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** IHDR 里用到的几项。 */
type Header = {
  readonly width: number;
  readonly height: number;
  readonly bitDepth: number;
  readonly colorType: number;
  readonly interlaced: boolean;
};

/** 每种颜色类型一个像素有几个通道，和允许的位深。 */
const colorTypes: ReadonlyMap<number, { channels: number; depths: readonly number[] }> = new Map([
  // 灰度
  [0, { channels: 1, depths: [1, 2, 4, 8, 16] }],
  // RGB
  [2, { channels: 3, depths: [8, 16] }],
  // 调色板
  [3, { channels: 1, depths: [1, 2, 4, 8] }],
  // 灰度加透明度
  [4, { channels: 2, depths: [8, 16] }],
  // RGBA
  [6, { channels: 4, depths: [8, 16] }],
]);

/** 隔行扫描的七遍，每遍从哪个像素开始、隔几个取一个。 */
type Pass = { readonly x0: number; readonly y0: number; readonly dx: number; readonly dy: number };

const wholeImage: readonly Pass[] = [{ x0: 0, y0: 0, dx: 1, dy: 1 }];

const adam7: readonly Pass[] = [
  { x0: 0, y0: 0, dx: 8, dy: 8 },
  { x0: 4, y0: 0, dx: 8, dy: 8 },
  { x0: 0, y0: 4, dx: 4, dy: 8 },
  { x0: 2, y0: 0, dx: 4, dy: 4 },
  { x0: 0, y0: 2, dx: 2, dy: 4 },
  { x0: 1, y0: 0, dx: 2, dy: 2 },
  { x0: 0, y0: 1, dx: 1, dy: 2 },
];

const corrupt: Result<never, ScreenHashError> = err({ kind: "corrupt" });

/** 把 PNG 解成 RGB。 */
export function decodePng(png: Uint8Array): Result<RgbImage, ScreenHashError> {
  const chunks = readChunks(png);
  if (!chunks.ok) return chunks;
  const { header, palette, transparency, data } = chunks.value;
  const { width, height, bitDepth, colorType } = header;
  const channels = colorTypes.get(colorType)?.channels ?? 1;
  const bitsPerPixel = channels * bitDepth;
  const bytesPerPixel = Math.max(1, bitsPerPixel >> 3);
  const rowBytes = (pixels: number) => Math.ceil((pixels * bitsPerPixel) / 8);

  const passes = (header.interlaced ? adam7 : wholeImage).map((pass) => ({
    ...pass,
    columns: width > pass.x0 ? Math.ceil((width - pass.x0) / pass.dx) : 0,
    rows: height > pass.y0 ? Math.ceil((height - pass.y0) / pass.dy) : 0,
  }));
  const expected = passes.reduce(
    (sum, pass) => sum + (pass.columns === 0 ? 0 : pass.rows * (1 + rowBytes(pass.columns))),
    0,
  );
  let raw: Buffer;
  try {
    raw = inflateSync(data, { maxOutputLength: expected });
  } catch {
    return corrupt;
  }
  if (raw.length !== expected) return corrupt;

  const write = pixelWriter(header, palette, transparency);
  const rgb = new Uint8Array(width * height * 3);
  let offset = 0;
  for (const pass of passes) {
    if (pass.columns === 0 || pass.rows === 0) continue;
    const stride = rowBytes(pass.columns);
    let previous = new Uint8Array(stride);
    let current = new Uint8Array(stride);
    for (let j = 0; j < pass.rows; j += 1) {
      const filter = raw[offset] ?? 0;
      const line = raw.subarray(offset + 1, offset + 1 + stride);
      if (!unfilter(filter, line, previous, current, bytesPerPixel)) return corrupt;
      offset += 1 + stride;
      const start = (pass.y0 + j * pass.dy) * width + pass.x0;
      for (let i = 0; i < pass.columns; i += 1) write(current, i, rgb, (start + i * pass.dx) * 3);
      [previous, current] = [current, previous];
    }
  }
  return ok({ width, height, rgb });
}

type Chunks = {
  readonly header: Header;
  /** 调色板，每种颜色三个字节。 */
  readonly palette: Uint8Array | undefined;
  /** tRNS 块的内容。 */
  readonly transparency: Uint8Array | undefined;
  /** 全部 IDAT 块接起来的压缩数据。 */
  readonly data: Buffer;
};

/** 逐块读出 PNG，核对每块的校验码。不认识的辅助块跳过，不认识的关键块当作坏了。 */
function readChunks(png: Uint8Array): Result<Chunks, ScreenHashError> {
  const bytes = Buffer.from(png.buffer, png.byteOffset, png.byteLength);
  if (!bytes.subarray(0, pngSignature.length).equals(pngSignature)) return err({ kind: "notPng" });
  let header: Header | undefined;
  let palette: Uint8Array | undefined;
  let transparency: Uint8Array | undefined;
  const data: Buffer[] = [];
  let at = pngSignature.length;
  for (;;) {
    // 块的开头是四个字节的长度和四个字节的名字，最后是四个字节的校验码。
    if (at + 12 > bytes.length) return corrupt;
    const length = bytes.readUInt32BE(at);
    const end = at + 12 + length;
    if (end > bytes.length) return corrupt;
    const type = bytes.toString("latin1", at + 4, at + 8);
    const body = bytes.subarray(at + 8, at + 8 + length);
    if (crc32(bytes.subarray(at + 4, at + 8 + length)) !== bytes.readUInt32BE(end - 4)) {
      return corrupt;
    }
    at = end;
    if (header === undefined) {
      if (type !== "IHDR") return corrupt;
      const parsed = readHeader(body);
      if (!parsed.ok) return parsed;
      header = parsed.value;
    } else if (type === "IEND") {
      break;
    } else if (type === "IDAT") {
      data.push(body);
    } else if (type === "PLTE") {
      palette = body;
    } else if (type === "tRNS") {
      transparency = body;
    } else if (isCritical(type)) {
      return corrupt;
    }
  }
  const paletteOk = palette === undefined || (palette.length % 3 === 0 && palette.length <= 768);
  if (data.length === 0 || !paletteOk || (header.colorType === 3 && palette === undefined)) {
    return corrupt;
  }
  return ok({ header, palette, transparency, data: Buffer.concat(data) });
}

/** 块名的第一个字母是大写的是关键块，解码的一方必须认得。 */
function isCritical(type: string): boolean {
  return (type.charCodeAt(0) & 0x20) === 0;
}

function readHeader(body: Uint8Array): Result<Header, ScreenHashError> {
  if (body.length !== 13) return corrupt;
  const view = Buffer.from(body.buffer, body.byteOffset, body.byteLength);
  const width = view.readUInt32BE(0);
  const height = view.readUInt32BE(4);
  const [bitDepth = 0, colorType = 0, compression, filter, interlace] = body.subarray(8);
  const depthOk = colorTypes.get(colorType)?.depths.includes(bitDepth) === true;
  const sizeOk = width > 0 && height > 0 && width < 2 ** 31 && height < 2 ** 31;
  if (!depthOk || !sizeOk || compression !== 0 || filter !== 0 || (interlace ?? 2) > 1) {
    return corrupt;
  }
  if (width * height > maxScreenPixels) return err({ kind: "tooLarge" });
  return ok({ width, height, bitDepth, colorType, interlaced: interlace === 1 });
}

/**
 * 还原一行过滤过的数据，见 PNG 规范第九章。结果写进 out。
 * previous 是上一行还原以后的数据，第一行时全是 0。过滤方式认不出来时返回 false。
 */
function unfilter(
  type: number,
  line: Uint8Array,
  previous: Uint8Array,
  out: Uint8Array,
  bytesPerPixel: number,
): boolean {
  const n = line.length;
  switch (type) {
    case 0:
      out.set(line);
      return true;
    case 1:
      for (let x = 0; x < n; x += 1) {
        out[x] = ((line[x] ?? 0) + (x >= bytesPerPixel ? (out[x - bytesPerPixel] ?? 0) : 0)) & 0xff;
      }
      return true;
    case 2:
      for (let x = 0; x < n; x += 1) out[x] = ((line[x] ?? 0) + (previous[x] ?? 0)) & 0xff;
      return true;
    case 3:
      for (let x = 0; x < n; x += 1) {
        const left = x >= bytesPerPixel ? (out[x - bytesPerPixel] ?? 0) : 0;
        out[x] = ((line[x] ?? 0) + ((left + (previous[x] ?? 0)) >> 1)) & 0xff;
      }
      return true;
    case 4:
      for (let x = 0; x < n; x += 1) {
        const left = x >= bytesPerPixel ? (out[x - bytesPerPixel] ?? 0) : 0;
        const upLeft = x >= bytesPerPixel ? (previous[x - bytesPerPixel] ?? 0) : 0;
        out[x] = ((line[x] ?? 0) + paeth(left, previous[x] ?? 0, upLeft)) & 0xff;
      }
      return true;
    default:
      return false;
  }
}

function paeth(left: number, up: number, upLeft: number): number {
  const p = left + up - upLeft;
  const toLeft = Math.abs(p - left);
  const toUp = Math.abs(p - up);
  const toUpLeft = Math.abs(p - upLeft);
  if (toLeft <= toUp && toLeft <= toUpLeft) return left;
  return toUp <= toUpLeft ? up : upLeft;
}

/** 按 PIL 的整数公式算亮度：R、G、B 的权重是 0.299、0.587、0.114。 */
function luma(r: number, g: number, b: number): number {
  return (r * 19595 + g * 38470 + b * 7471 + 0x8000) >> 16;
}

/** 铺在白底上的一个通道。alpha 是 0 到 255。 */
function onWhite(channel: number, alpha: number): number {
  if (alpha === 255) return channel;
  return Math.floor((channel * alpha + 255 * (255 - alpha) + 127) / 255);
}

/** 把还原好的一行里第 i 个像素的 R、G、B 写进 out 的 at 处。 */
type PixelWriter = (row: Uint8Array, i: number, out: Uint8Array, at: number) => void;

/**
 * 按颜色类型和位深取像素的颜色。十六位的只取高位的字节，比较透明色时用完整的十六位。
 * 调色板的序号超出调色板时当作黑色。
 */
function pixelWriter(
  header: Header,
  palette: Uint8Array | undefined,
  transparency: Uint8Array | undefined,
): PixelWriter {
  const { bitDepth, colorType } = header;
  const byte = (row: Uint8Array, i: number) => row[i] ?? 0;
  const word = (row: Uint8Array, i: number) => ((row[2 * i] ?? 0) << 8) | (row[2 * i + 1] ?? 0);
  const trns = transparency === undefined ? undefined : Buffer.from(transparency);
  const sample =
    bitDepth === 16
      ? word
      : bitDepth === 8
        ? byte
        : (row: Uint8Array, i: number) => {
            const bit = i * bitDepth;
            const shift = 8 - bitDepth - (bit & 7);
            return ((row[bit >> 3] ?? 0) >> shift) & ((1 << bitDepth) - 1);
          };
  const to8 = (value: number) =>
    bitDepth === 16 ? value >> 8 : bitDepth === 8 ? value : (value * 255) / ((1 << bitDepth) - 1);
  const put = (out: Uint8Array, at: number, r: number, g: number, b: number, alpha: number) => {
    out[at] = onWhite(r, alpha);
    out[at + 1] = onWhite(g, alpha);
    out[at + 2] = onWhite(b, alpha);
  };
  switch (colorType) {
    case 0: {
      const clear = trns !== undefined && trns.length >= 2 ? trns.readUInt16BE(0) : undefined;
      return (row, i, out, at) => {
        const value = sample(row, i);
        const gray = to8(value);
        put(out, at, gray, gray, gray, value === clear ? 0 : 255);
      };
    }
    case 2: {
      const clear = trns !== undefined && trns.length >= 6 ? trns : undefined;
      return (row, i, out, at) => {
        const [r, g, b] = [sample(row, 3 * i), sample(row, 3 * i + 1), sample(row, 3 * i + 2)];
        const transparent =
          clear !== undefined &&
          r === clear.readUInt16BE(0) &&
          g === clear.readUInt16BE(2) &&
          b === clear.readUInt16BE(4);
        put(out, at, to8(r), to8(g), to8(b), transparent ? 0 : 255);
      };
    }
    case 3: {
      const table = new Uint8Array(256 * 3);
      for (let index = 0; index < 256; index += 1) {
        const base = index * 3;
        const inPalette = palette !== undefined && base + 2 < palette.length;
        const color = inPalette
          ? [palette[base] ?? 0, palette[base + 1] ?? 0, palette[base + 2] ?? 0]
          : [0, 0, 0];
        put(table, base, color[0] ?? 0, color[1] ?? 0, color[2] ?? 0, trns?.[index] ?? 255);
      }
      return (row, i, out, at) => {
        const base = sample(row, i) * 3;
        out[at] = table[base] ?? 0;
        out[at + 1] = table[base + 1] ?? 0;
        out[at + 2] = table[base + 2] ?? 0;
      };
    }
    case 4:
      return (row, i, out, at) => {
        const gray = to8(sample(row, 2 * i));
        put(out, at, gray, gray, gray, to8(sample(row, 2 * i + 1)));
      };
    default:
      return (row, i, out, at) => {
        const r = to8(sample(row, 4 * i));
        const g = to8(sample(row, 4 * i + 1));
        const b = to8(sample(row, 4 * i + 2));
        put(out, at, r, g, b, to8(sample(row, 4 * i + 3)));
      };
  }
}
