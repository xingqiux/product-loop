import { crc32, deflateSync } from "node:zlib";

// 测试用的截图，只给测试用：一个简单的 PNG 编码器，和画出像产品界面的截图的几个函数。
// 编码器认五种颜色类型、各种位深、五种过滤方式和隔行扫描，用来核对 screen-hash.ts 的解码。

/** 测试里画的图，一个像素四个字节，依次是 R、G、B、A。 */
export type Canvas = {
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8Array;
};

/** 颜色：R、G、B，可以带透明度。 */
export type Color = readonly [number, number, number, number?];

export function canvas(width: number, height: number, color: Color = [255, 255, 255]): Canvas {
  const image = { width, height, rgba: new Uint8Array(width * height * 4) };
  fill(image, 0, 0, width, height, color);
  return image;
}

export function copyCanvas(image: Canvas): Canvas {
  return { ...image, rgba: image.rgba.slice() };
}

/** 填一块矩形，超出画布的部分不画。 */
export function fill(
  image: Canvas,
  x: number,
  y: number,
  width: number,
  height: number,
  color: Color,
): void {
  const [r, g, b, a = 255] = color;
  for (let row = Math.max(0, y); row < Math.min(image.height, y + height); row += 1) {
    for (let column = Math.max(0, x); column < Math.min(image.width, x + width); column += 1) {
      image.rgba.set([r, g, b, a], (row * image.width + column) * 4);
    }
  }
}

/** 一行字：高十个像素的一串小方块，每个字宽九个像素，字距五个像素。 */
export function text(image: Canvas, x: number, y: number, chars: number, color: Color): void {
  for (let i = 0; i < chars; i += 1) fill(image, x + i * 14, y, 9, 10, color);
}

/**
 * 一屏像产品界面的截图：顶栏、左边一栏、标题、几段字、三张卡片和一个主按钮。
 * seed 不同，字的长短不同，用来画不同的屏。
 */
export function productScreen(width = 1400, height = 900, seed = 1): Canvas {
  const image = canvas(width, height, [250, 250, 250]);
  fill(image, 0, 0, width, 56, [33, 37, 41]);
  text(image, 24, 23, 6, [240, 240, 240]);
  fill(image, 0, 56, 240, height - 56, [241, 243, 245]);
  for (let i = 0; i < 8; i += 1) text(image, 24, 90 + i * 36, 4 + ((seed + i) % 5), [70, 70, 80]);
  text(image, 280, 90, 12, [20, 20, 20]);
  for (let i = 0; i < 5; i += 1) {
    text(image, 280, 130 + i * 24, 20 + ((seed * 7 + i * 3) % 30), [90, 90, 90]);
  }
  for (let i = 0; i < 3; i += 1) {
    const x = 280 + i * 360;
    fill(image, x, 290, 330, 200, [255, 255, 255]);
    fill(image, x, 290, 330, 1, [220, 220, 225]);
    fill(image, x, 489, 330, 1, [220, 220, 225]);
    text(image, x + 20, 312, 8 + ((seed + i) % 6), [30, 30, 30]);
    for (let j = 0; j < 4; j += 1)
      text(image, x + 20, 344 + j * 22, 12 + ((seed + i + j) % 8), [110, 110, 110]);
  }
  fill(image, 280, 530, 120, 36, [37, 99, 235]);
  text(image, 300, 543, 6, [255, 255, 255]);
  return image;
}

export type PngOptions = {
  /** 0 灰度，2 RGB，3 调色板，4 灰度加透明度，6 RGBA。灰度只取 R 通道。默认 6。 */
  readonly colorType?: 0 | 2 | 3 | 4 | 6;
  readonly bitDepth?: 1 | 2 | 4 | 8 | 16;
  /** 每行用的过滤方式。写 cycle 时各行轮流用五种。默认 0。 */
  readonly filter?: 0 | 1 | 2 | 3 | 4 | "cycle";
  readonly interlace?: boolean;
  /** tRNS 块的内容，原样写进去。 */
  readonly transparency?: Uint8Array;
};

/** 编码成 PNG。调色板按颜色出现的先后排，颜色多于位深能放下的就报错。 */
export function encodePng(image: Canvas, options: PngOptions = {}): Buffer {
  const colorType = options.colorType ?? 6;
  const bitDepth = options.bitDepth ?? 8;
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  const palette: number[] = [];
  const paletteIndex = new Map<number, number>();
  const pixel = (x: number, y: number): number[] => {
    const at = (y * image.width + x) * 4;
    const [r = 0, g = 0, b = 0, a = 0] = image.rgba.subarray(at, at + 4);
    if (colorType === 3) {
      const key = (r << 16) | (g << 8) | b;
      let index = paletteIndex.get(key);
      if (index === undefined) {
        index = paletteIndex.size;
        if (index >= 2 ** bitDepth) throw new Error("颜色太多，调色板放不下。");
        paletteIndex.set(key, index);
        palette.push(r, g, b);
      }
      return [index];
    }
    const values = { 0: [r], 2: [r, g, b], 4: [r, a], 6: [r, g, b, a] }[colorType];
    return bitDepth === 16 ? values.map((v) => v * 257) : values.map((v) => v >> (8 - bitDepth));
  };
  const passes = options.interlace
    ? [
        [0, 0, 8, 8],
        [4, 0, 8, 8],
        [0, 4, 4, 8],
        [2, 0, 4, 4],
        [0, 2, 2, 4],
        [1, 0, 2, 2],
        [0, 1, 1, 2],
      ]
    : [[0, 0, 1, 1]];
  const bytesPerPixel = Math.max(1, (channels * bitDepth) >> 3);
  const raw: Uint8Array[] = [];
  let rowNumber = 0;
  for (const [x0 = 0, y0 = 0, dx = 1, dy = 1] of passes) {
    const columns = image.width > x0 ? Math.ceil((image.width - x0) / dx) : 0;
    const rows = image.height > y0 ? Math.ceil((image.height - y0) / dy) : 0;
    if (columns === 0) continue;
    let previous = new Uint8Array(Math.ceil((columns * channels * bitDepth) / 8));
    for (let j = 0; j < rows; j += 1) {
      const line = new Uint8Array(previous.length);
      let bit = 0;
      for (let i = 0; i < columns; i += 1) {
        for (const value of pixel(x0 + i * dx, y0 + j * dy)) {
          if (bitDepth === 16) {
            line[bit >> 3] = value >> 8;
            line[(bit >> 3) + 1] = value & 0xff;
          } else {
            const shift = 8 - bitDepth - (bit & 7);
            line[bit >> 3] = (line[bit >> 3] ?? 0) | (value << shift);
          }
          bit += bitDepth;
        }
      }
      const filter = options.filter === "cycle" ? rowNumber % 5 : (options.filter ?? 0);
      rowNumber += 1;
      raw.push(Uint8Array.of(filter), applyFilter(filter, line, previous, bytesPerPixel));
      previous = line;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(image.width, 0);
  header.writeUInt32BE(image.height, 4);
  header.set([bitDepth, colorType, 0, 0, options.interlace ? 1 : 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    ...(colorType === 3 ? [chunk("PLTE", Buffer.from(palette))] : []),
    ...(options.transparency === undefined ? [] : [chunk("tRNS", options.transparency)]),
    chunk("IDAT", deflateSync(Buffer.concat(raw))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function applyFilter(
  type: number,
  line: Uint8Array,
  previous: Uint8Array,
  bytesPerPixel: number,
): Uint8Array {
  const out = new Uint8Array(line.length);
  for (let x = 0; x < line.length; x += 1) {
    const left = x >= bytesPerPixel ? (line[x - bytesPerPixel] ?? 0) : 0;
    const up = previous[x] ?? 0;
    const upLeft = x >= bytesPerPixel ? (previous[x - bytesPerPixel] ?? 0) : 0;
    const predicted = [0, left, up, (left + up) >> 1, paeth(left, up, upLeft)][type] ?? 0;
    out[x] = ((line[x] ?? 0) - predicted) & 0xff;
  }
  return out;
}

function paeth(left: number, up: number, upLeft: number): number {
  const p = left + up - upLeft;
  const [a, b, c] = [Math.abs(p - left), Math.abs(p - up), Math.abs(p - upLeft)];
  if (a <= b && a <= c) return left;
  return b <= c ? up : upLeft;
}

/** 一个 PNG 块：长度、名字、内容和校验码。 */
export function chunk(type: string, body: Uint8Array): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length, 0);
  head.write(type, 4, "latin1");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])), 0);
  return Buffer.concat([head, body, crc]);
}
