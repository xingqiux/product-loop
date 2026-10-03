// 从文件头读图片的类型和宽高，不依赖别的库。只认 PNG、JPEG、GIF 三种。
// 使用代码的截图统一是 PNG，见「02 技术选型」第十八节。旧项目里还有 JPEG 和动图。

export type ImageInfo = {
  readonly contentType: "image/png" | "image/jpeg" | "image/gif";
  /** 单位是像素。文件头里读不出来时为空。 */
  readonly width: number | null;
  readonly height: number | null;
};

/** 读图片信息最多看文件开头的这么多字节。JPEG 的帧头排在元数据后面，元数据可能有几十 KB。 */
export const imageHeadBytes = 256 * 1024;

const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** 按文件开头的字节认图片。不是这三种图片时返回 undefined。 */
export function readImageInfo(head: Buffer): ImageInfo | undefined {
  if (head.subarray(0, pngSignature.length).equals(pngSignature)) return png(head);
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return jpeg(head);
  const gifVersion = head.toString("latin1", 0, 6);
  if (gifVersion === "GIF87a" || gifVersion === "GIF89a") return gif(head);
  return undefined;
}

/** 宽或高是 0 时当作读不出来。 */
function info(contentType: ImageInfo["contentType"], width: number, height: number): ImageInfo {
  const known = width > 0 && height > 0;
  return { contentType, width: known ? width : null, height: known ? height : null };
}

/**
 * 签名后面第一块是 IHDR。块的开头是四个字节的长度和四个字节的名字，接着是宽和高。
 * 宽和高各四个字节，高位在前。
 */
function png(head: Buffer): ImageInfo {
  const ihdr = head.length >= 24 && head.toString("latin1", 12, 16) === "IHDR";
  if (!ihdr) return info("image/png", 0, 0);
  return info("image/png", head.readUInt32BE(16), head.readUInt32BE(20));
}

/** 签名后面是整张图的宽和高，各两个字节，低位在前。 */
function gif(head: Buffer): ImageInfo {
  if (head.length < 10) return info("image/gif", 0, 0);
  return info("image/gif", head.readUInt16LE(6), head.readUInt16LE(8));
}

/**
 * 从 SOI 之后逐段往下找帧头。每段以 FF 和一个标记开头，多数标记后面跟两个字节的段长。
 * 段长把这两个字节也算在内。帧头里依次是精度、高和宽。
 * 精度占一个字节，高和宽各两个字节，高位在前。
 */
function jpeg(head: Buffer): ImageInfo {
  let at = 2;
  while (at + 4 <= head.length && head[at] === 0xff) {
    const marker = head[at + 1] ?? 0;
    if (marker === 0xff) {
      // 标记前面可以有多余的 FF，用来填充。
      at += 1;
    } else if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      // 这几个标记后面没有段长。
      at += 2;
    } else if (isFrameHeader(marker)) {
      if (at + 9 > head.length) break;
      return info("image/jpeg", head.readUInt16BE(at + 7), head.readUInt16BE(at + 5));
    } else if (marker === 0xda || marker === 0xd9) {
      // 图像数据开始了，或者文件结束了，都还没见到帧头。
      break;
    } else {
      at += 2 + head.readUInt16BE(at + 2);
    }
  }
  return info("image/jpeg", 0, 0);
}

/** C0 到 CF 是各种帧头，C4、C8、CC 除外。 */
function isFrameHeader(marker: number): boolean {
  return marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
}
