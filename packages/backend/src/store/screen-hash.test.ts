import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  decodePng,
  differentPixels,
  hashChangeThreshold,
  hashDistance,
  hashImage,
  maxScreenPixels,
  pixelChangeThreshold,
  type RgbImage,
  screenChanged,
  screenHash,
} from "./screen-hash.ts";
import {
  type Canvas,
  canvas,
  chunk,
  copyCanvas,
  encodePng,
  fill,
  type PngOptions,
  productScreen,
  text,
} from "./screen-testing.ts";

/** 画布铺在白底上的 RGB，解码的结果应当和它相同。 */
function onWhite(image: Canvas): Uint8Array {
  const out = new Uint8Array(image.width * image.height * 3);
  for (let i = 0; i < image.width * image.height; i += 1) {
    const a = image.rgba[i * 4 + 3] ?? 0;
    for (let c = 0; c < 3; c += 1) {
      const v = image.rgba[i * 4 + c] ?? 0;
      out[i * 3 + c] = a === 255 ? v : Math.floor((v * a + 255 * (255 - a) + 127) / 255);
    }
  }
  return out;
}

function decoded(png: Uint8Array): RgbImage {
  const result = decodePng(png);
  if (!result.ok) throw new Error(`解不出来：${result.error.kind}`);
  return result.value;
}

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex");

/** 按 screenChanged 的规则比较两张画布，像素复核用两张图解出来的结果。 */
function changed(before: Canvas, after: Canvas): boolean {
  const a = decoded(encodePng(before));
  const b = decoded(encodePng(after));
  return screenChanged(hashImage(a), hashImage(b), () => [a, b]);
}

/** 两张画布的哈希距离和不同的像素数。 */
function measure(before: Canvas, after: Canvas) {
  const a = decoded(encodePng(before));
  const b = decoded(encodePng(after));
  return {
    bits: hashDistance(hashImage(a).hash, hashImage(b).hash),
    pixels: differentPixels(a, b),
  };
}

describe("PNG 解码", () => {
  // 由 PIL 12.2 编码的小图，rgb 是 PIL 读出来、铺在白底上的结果。和测试里的编码器互相独立。
  const fromPil = [
    {
      name: "一位灰度",
      png: "iVBORw0KGgoAAAANSUhEUgAAAAcAAAAFAQAAAACh4ct1AAAADklEQVR4nGMIYVjFAMYAC5oCUTZBSiQAAAAASUVORK5CYII=",
      rgb: "000000ffffff000000ffffff000000ffffff000000ffffff000000ffffff000000ffffff000000ffffff000000ffffff000000ffffff000000ffffff000000ffffff000000ffffff000000ffffff000000ffffff000000ffffff000000ffffff000000ffffff000000",
    },
    {
      name: "两位调色板带透明",
      png: "iVBORw0KGgoAAAANSUhEUgAAAAcAAAAFAgMAAAD09B5LAAAADFBMVEXIHh4UoDwoPNz6+vp6wMz3AAAABHRSTlP/gAD/oaGUZgAAABFJREFUeJxjlP7LuPE/I4wEADCHBq67fQkkAAAAAElFTkSuQmCC",
      rgb: "c81e1e89cf9dfffffffafafac81e1e89cf9dfffffffffffffafafac81e1e89cf9dfffffffafafac81e1ec81e1e89cf9dfffffffafafac81e1e89cf9dfffffffffffffafafac81e1e89cf9dfffffffafafac81e1ec81e1e89cf9dfffffffafafac81e1e89cf9dffffff",
    },
    {
      name: "灰度加透明度",
      png: "iVBORw0KGgoAAAANSUhEUgAAAAcAAAAFCAQAAAAjkz5TAAAAFUlEQVR4nGNkYFA1QkAmbjlkSBIXAA7BBpC/khx0AAAAAElFTkSuQmCC",
      rgb: "ffffffd4d4d4b8b8b8aaaaaaabababbababaf9f9f9e2e2e2bebebea8a8a8a1a1a1a8a8a8f9f9f9f9f9f9c8c8c8aaaaaa9b9b9b9b9b9bfefefef5f5f5fbfbfbb1b1b1999999919191979797f5f5f5f3f3f3ffffff9c9c9c8b8b8b898989fafafaefefeff3f3f3616161",
    },
    {
      name: "按行挑过滤方式的 RGB",
      png: "iVBORw0KGgoAAAANSUhEUgAAAAcAAAAFCAIAAAAG+GGPAAAAJElEQVR42mNkYGDQwEAsDDYMDAy8aAguKoWMkEXV4QhN1ASCAOJPBHxHODcYAAAAAElFTkSuQmCC",
      rgb: "000000280000500000780000a00000c80000f00000003c00283c0d503c1a783c27a03c34c83c41f03c4e00780028781a50783478784ea07868c87882f0789c00b40028b42750b44e78b475a0b49cc8b4c3f0b4ea00f00028f03450f06878f09ca0f0d0c8f004f0f038",
    },
  ];

  it.each(fromPil)("解出 PIL 编码的$name，和 PIL 读出的相同", ({ png, rgb }) => {
    const image = decoded(Buffer.from(png, "base64"));
    expect([image.width, image.height]).toEqual([7, 5]);
    expect(hex(image.rgb)).toBe(rgb);
  });

  it("PIL 编码的十六位灰度只取高位的字节", () => {
    const png =
      "iVBORw0KGgoAAAANSUhEUgAAAAcAAAAFEAAAAAD8YXVHAAAAGklEQVR4nGNk1GHnQEAWQwtiuRwcjMd4kGUBkK4EDFzRdK0AAAAASUVORK5CYII=";
    const image = decoded(Buffer.from(png, "base64"));
    const expected = Array.from({ length: 35 }, (_, i) => (i * 1800 + 300) >> 8).flatMap((v) => [
      v,
      v,
      v,
    ]);
    expect([...image.rgb]).toEqual(expected);
  });

  /** 每格颜色都不同、带半透明的小图，宽和高不是八的倍数，隔行扫描的七遍都有像素。 */
  function colorful(): Canvas {
    const image = canvas(13, 11);
    for (let y = 0; y < 11; y += 1) {
      for (let x = 0; x < 13; x += 1) {
        fill(image, x, y, 1, 1, [(x * 19) % 256, (y * 23) % 256, (x * y * 7) % 256, 255 - x * 9]);
      }
    }
    return image;
  }

  /** 只有几种灰度的小图，灰度和调色板的低位深都放得下。 */
  function fewGrays(levels: number): Canvas {
    const image = canvas(13, 11);
    for (let y = 0; y < 11; y += 1) {
      for (let x = 0; x < 13; x += 1) {
        const v = Math.round((((x + 2 * y) % levels) * 255) / (levels - 1));
        fill(image, x, y, 1, 1, [v, v, v]);
      }
    }
    return image;
  }

  const combos: { name: string; image: () => Canvas; options: PngOptions }[] = [
    { name: "RGBA", image: colorful, options: { colorType: 6 } },
    { name: "RGBA 十六位", image: colorful, options: { colorType: 6, bitDepth: 16 } },
    { name: "RGB", image: () => opaque(colorful()), options: { colorType: 2 } },
    {
      name: "RGB 十六位",
      image: () => opaque(colorful()),
      options: { colorType: 2, bitDepth: 16 },
    },
    { name: "灰度", image: () => fewGrays(256), options: { colorType: 0 } },
    { name: "灰度十六位", image: () => fewGrays(256), options: { colorType: 0, bitDepth: 16 } },
    { name: "一位灰度", image: () => fewGrays(2), options: { colorType: 0, bitDepth: 1 } },
    { name: "两位灰度", image: () => fewGrays(4), options: { colorType: 0, bitDepth: 2 } },
    { name: "四位灰度", image: () => fewGrays(16), options: { colorType: 0, bitDepth: 4 } },
    { name: "灰度加透明度", image: () => grayAlpha(), options: { colorType: 4 } },
    {
      name: "灰度加透明度十六位",
      image: () => grayAlpha(),
      options: { colorType: 4, bitDepth: 16 },
    },
    { name: "四位调色板", image: () => fewGrays(16), options: { colorType: 3, bitDepth: 4 } },
    { name: "八位调色板", image: () => opaque(colorful()), options: { colorType: 3 } },
  ];

  function opaque(image: Canvas): Canvas {
    for (let i = 3; i < image.rgba.length; i += 4) image.rgba[i] = 255;
    return image;
  }

  function grayAlpha(): Canvas {
    const image = canvas(13, 11);
    for (let y = 0; y < 11; y += 1) {
      for (let x = 0; x < 13; x += 1) fill(image, x, y, 1, 1, [x * 17, x * 17, x * 17, y * 25]);
    }
    return image;
  }

  for (const { name, image, options } of combos) {
    for (const interlace of [false, true]) {
      it(`${name}${interlace ? "，隔行扫描" : ""}，五种过滤方式轮流用，解出来和原图相同`, () => {
        const source = image();
        const png = encodePng(source, { ...options, interlace, filter: "cycle" });
        expect(hex(decoded(png).rgb)).toBe(hex(onWhite(source)));
      });
    }
  }

  it("调色板的 tRNS 按序号给透明度，灰度的 tRNS 让那一种灰度透明", () => {
    const image = fewGrays(4);
    const palette = decoded(
      encodePng(image, { colorType: 3, bitDepth: 2, transparency: Uint8Array.from([0, 255]) }),
    );
    // 调色板按颜色出现的先后排，第一个像素的颜色是 0 号，它变成全透明，铺在白底上是白色。
    expect([...palette.rgb.subarray(0, 3)]).toEqual([255, 255, 255]);
    const gray = decoded(encodePng(image, { colorType: 0, transparency: Uint8Array.from([0, 0]) }));
    expect([...gray.rgb.subarray(0, 3)]).toEqual([255, 255, 255]);
    expect([...gray.rgb.subarray(3, 6)]).toEqual([85, 85, 85]);
  });

  it("不是 PNG 的报 notPng", () => {
    expect(decodePng(Buffer.from("GIF89a...")).ok).toBe(false);
    expect(decodePng(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toEqual({
      ok: false,
      error: { kind: "notPng" },
    });
  });

  it("校验码不对、数据截断、不认识的关键块、过滤方式不对，都报 corrupt", () => {
    const png = encodePng(productScreen(40, 30));
    const badCrc = Buffer.from(png);
    badCrc[30] = (badCrc[30] ?? 0) ^ 1;
    const truncated = png.subarray(0, png.length - 20);
    const signature = png.subarray(0, 8);
    const header = png.subarray(8, 33);
    const rest = png.subarray(33);
    const unknownCritical = Buffer.concat([
      signature,
      header,
      chunk("ABCD", Buffer.alloc(2)),
      rest,
    ]);
    const ancillary = Buffer.concat([signature, header, chunk("abCD", Buffer.alloc(2)), rest]);
    for (const bad of [badCrc, truncated, unknownCritical]) {
      expect(decodePng(bad)).toEqual({ ok: false, error: { kind: "corrupt" } });
    }
    expect(decodePng(ancillary).ok).toBe(true);

    const image = canvas(4, 2);
    const withFilter7 = encodePng(image, { filter: 0 });
    // IDAT 里第一行的过滤方式改成 7：重新编一个只有这一处不同的块。
    const idat = Buffer.from([7, ...new Uint8Array(16), 0, ...new Uint8Array(16)]);
    const broken = Buffer.concat([
      withFilter7.subarray(0, 33),
      chunk("IDAT", deflateSync(idat)),
      chunk("IEND", Buffer.alloc(0)),
    ]);
    expect(decodePng(broken)).toEqual({ ok: false, error: { kind: "corrupt" } });
  });

  it("像素超过上限的报 tooLarge，不去解压", () => {
    const header = Buffer.alloc(13);
    header.writeUInt32BE(10_000, 0);
    header.writeUInt32BE(Math.ceil(maxScreenPixels / 10_000) + 1, 4);
    header.set([8, 6, 0, 0, 0], 8);
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk("IHDR", header),
      chunk("IDAT", Buffer.alloc(4)),
      chunk("IEND", Buffer.alloc(0)),
    ]);
    expect(decodePng(png)).toEqual({ ok: false, error: { kind: "tooLarge" } });
  });
});

describe("感知哈希", () => {
  it("是 256 位，写成 64 位十六进制，同样的像素换一种编法哈希不变", () => {
    const screen = productScreen();
    const hashes = [
      encodePng(screen),
      encodePng(screen, { colorType: 2, filter: "cycle" }),
      encodePng(screen, { interlace: true, filter: 4 }),
    ].map((png) => {
      const result = screenHash(png);
      if (!result.ok) throw new Error(result.error.kind);
      return result.value;
    });
    expect(hashes[0]?.hash).toMatch(/^[0-9a-f]{64}$/u);
    expect(new Set(hashes.map((h) => h.hash)).size).toBe(1);
    expect(hashes[0]).toMatchObject({ width: 1400, height: 900 });
  });

  it("比格子还小的图也算得出", () => {
    const tiny = canvas(3, 2, [0, 0, 0]);
    fill(tiny, 1, 0, 1, 2, [255, 255, 255]);
    const result = screenHash(encodePng(tiny));
    expect(result.ok && result.value.hash.length).toBe(64);
  });

  it("距离是不同的位数，长度不同时报错", () => {
    expect(hashDistance("00f0", "00f0")).toBe(0);
    expect(hashDistance("00f0", "01f1")).toBe(2);
    expect(hashDistance("ffff", "0000")).toBe(16);
    expect(() => hashDistance("00", "000")).toThrow();
  });
});

describe("同一屏变没变", () => {
  const before = productScreen(1000, 600);

  it("一模一样的不算变过", () => {
    expect(changed(before, copyCanvas(before))).toBe(false);
  });

  it("只差几个像素的不算变过：输入框里的光标、按钮悬停时暗一点", () => {
    const caret = copyCanvas(before);
    fill(caret, 900, 140, 1, 18, [20, 20, 20]);
    const hover = copyCanvas(before);
    // 悬停时按钮暗百分之六，颜色差别在 0.1 以内。
    fill(hover, 280, 530, 120, 36, [35, 93, 221]);
    text(hover, 300, 543, 6, [255, 255, 255]);
    for (const after of [caret, hover]) {
      const { bits, pixels } = measure(before, after);
      expect(bits).toBeLessThanOrEqual(hashChangeThreshold);
      expect(pixels).toBeLessThanOrEqual(pixelChangeThreshold);
      expect(changed(before, after)).toBe(false);
    }
  });

  // 三次像素复核单独跑要五六秒，机器忙时会超过默认的五秒。
  it("哈希几乎不动的小改动由像素复核认出：多一个按钮、按钮换了颜色、多两个字", {
    timeout: 30_000,
  }, () => {
    const button = copyCanvas(before);
    fill(button, 420, 530, 96, 36, [30, 30, 30]);
    const recolor = copyCanvas(before);
    fill(recolor, 280, 530, 120, 36, [190, 24, 93]);
    text(recolor, 300, 543, 6, [255, 255, 255]);
    const word = copyCanvas(before);
    text(word, 280 + 32 * 14, 130, 2, [90, 90, 90]);
    for (const after of [button, recolor, word]) {
      const { bits, pixels } = measure(before, after);
      expect(bits).toBeLessThanOrEqual(hashChangeThreshold);
      expect(pixels).toBeGreaterThan(pixelChangeThreshold);
      expect(changed(before, after)).toBe(true);
    }
  });

  it("换了一块内容的，哈希的距离就超过界线，不用复核", () => {
    const after = productScreen(1000, 600, 1);
    fill(after, 240, 56, 760, 544, [250, 250, 250]);
    for (let i = 0; i < 20; i += 1) text(after, 280, 80 + i * 26, 40 + (i % 7) * 5, [40, 40, 40]);
    const a = hashImage(decoded(encodePng(before)));
    const b = hashImage(decoded(encodePng(after)));
    expect(hashDistance(a.hash, b.hash)).toBeGreaterThan(hashChangeThreshold);
    expect(
      screenChanged(a, b, () => {
        throw new Error("不该复核");
      }),
    ).toBe(true);
  });

  it("尺寸不同的算变过，读不出上一张图时也算变过", () => {
    const taller = hashImage(decoded(encodePng(productScreen(1000, 800))));
    const same = hashImage(decoded(encodePng(before)));
    expect(screenChanged(same, taller, () => undefined)).toBe(true);
    expect(screenChanged(same, { ...same, hash: same.hash }, () => undefined)).toBe(true);
  });
});
