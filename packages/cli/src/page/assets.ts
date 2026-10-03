import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import {
  type ErrorBody,
  err,
  errorBody,
  type Issue,
  ok,
  parseLineRange,
  type Result,
  renderCopy,
} from "@product-loop/model";
import type { Backend } from "../connect.ts";
import { pageCopy } from "../copy/page.ts";
import { readFailure } from "../project/read-error.ts";

// 给出信息前命令行在项目里取的两样东西，见「05 接口」第四节和第七节：
// - 截图：按路径找到文件，算出哈希，先 HEAD 问后端有没有，没有再 PUT 上传。
// - 原文：来源写了 file 和 lines 的，读出这几行和文件的哈希，交给后端存成原文摘录。
// 找不到的文件一次报齐，退出码 4。

const text = pageCopy.errors;

type Path = readonly (string | number)[];

/**
 * 数据里的一张截图：在哪个字段，写的路径。页面数据的截图写在 img 里，和后端 blob.present 查的相同。
 * use-run.json 的截图写在 screenshot 里。
 */
function imageRefs(data: unknown, field: string): { where: Path; path: string }[] {
  const found: { where: Path; path: string }[] = [];
  const walk = (value: unknown, where: Path): void => {
    if (Array.isArray(value)) {
      for (const [i, item] of value.entries()) walk(item, [...where, i]);
      return;
    }
    if (typeof value !== "object" || value === null) return;
    for (const [key, inner] of Object.entries(value)) {
      if (key === field && typeof inner === "string")
        found.push({ where: [...where, key], path: inner });
      else walk(inner, [...where, key]);
    }
  };
  walk(data, []);
  return found;
}

/** 位置写成 asks[0].sources[1]，和后端的写法相同。 */
function whereOf(path: Path): string {
  return path
    .map((part, i) => (typeof part === "number" ? `[${part}]` : i === 0 ? part : `.${part}`))
    .join("");
}

const reasonOf = (error: unknown) => readFailure(error).reason;

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** 按扩展名定图片的类型，后端认得出的图片以文件头为准。 */
const imageTypes: ReadonlyMap<string, string> = new Map([
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
  [".gif", "image/gif"],
]);

export type Uploaded = {
  /** 页面数据引用的每张截图的路径和哈希，同一路径只写一次。 */
  readonly images: readonly { readonly path: string; readonly hash: string }[];
  /** 这次传上去的张数。 */
  readonly uploaded: number;
  /** 后端已有、不用传的张数。 */
  readonly kept: number;
};

type ImageInput = {
  readonly data: unknown;
  readonly dir: string;
  readonly shownDir: string;
  readonly locate: (where: string) => string;
  /** 截图写在哪个字段里，不写就是页面数据的 img。 */
  readonly field?: string;
};

type ImageFiles = ReadonlyMap<string, { readonly bytes: Uint8Array; readonly hash: string }>;

/** 读出数据引用的每张截图并算哈希，同一路径只读一次。找不到的文件一次报齐。不碰后端。 */
async function readImages(input: ImageInput): Promise<Result<ImageFiles, ErrorBody>> {
  const refs = imageRefs(input.data, input.field ?? "img");
  const files = new Map<string, { bytes: Uint8Array; hash: string }>();
  const issues: Issue[] = [];
  for (const ref of refs) {
    if (files.has(ref.path)) continue;
    try {
      const bytes = await readFile(join(input.dir, ref.path));
      files.set(ref.path, { bytes, hash: sha256(bytes) });
    } catch (error) {
      issues.push({
        message: renderCopy(text.image.message, { path: ref.path, reason: reasonOf(error) }),
        hint: renderCopy(text.image.hint, { dir: input.shownDir }),
        where: input.locate(whereOf(ref.where)),
      });
    }
  }
  const [first, ...rest] = issues;
  if (first !== undefined) return err(errorBody("NOT_FOUND", [first, ...rest]));
  return ok(files);
}

/**
 * 只查截图在不在、算出哈希，不上传。ploop page check 用：它只读，不往后端存任何东西。
 */
export async function checkImages(
  input: ImageInput,
): Promise<Result<Pick<Uploaded, "images">, ErrorBody>> {
  const files = await readImages(input);
  if (!files.ok) return files;
  return ok({ images: [...files.value].map(([path, { hash }]) => ({ path, hash })) });
}

/**
 * 找到数据引用的截图，先 HEAD 再 PUT，交回路径和哈希。
 * 截图的路径相对 dir：页面数据相对工作区，use-run.json 相对输出目录。找不到的文件一次报齐。
 */
export async function uploadImages(
  backend: Backend,
  input: ImageInput,
): Promise<Result<Uploaded, ErrorBody>> {
  const read = await readImages(input);
  if (!read.ok) return read;
  const files = read.value;

  let uploaded = 0;
  const hashes = new Set<string>();
  for (const [path, { bytes, hash }] of files) {
    if (hashes.has(hash)) continue;
    hashes.add(hash);
    const head = await backend.raw(`/api/v1/blobs/${hash}`, { method: "HEAD" });
    if (!head.ok) return head;
    if (head.value.status === 200) continue;
    const type = imageTypes.get(extname(path).toLowerCase()) ?? "application/octet-stream";
    const put = await backend.call((api) =>
      api.api.v1.blobs[":hash"].$put(
        { param: { hash } },
        { init: { body: bytes, headers: { "Content-Type": type } } },
      ),
    );
    if (!put.ok) {
      const issue = {
        message: renderCopy(text.upload.message, { path, reason: put.error.message }),
        hint: renderCopy(text.upload.hint),
        where: path,
      };
      return err(errorBody(put.error.code, [issue]));
    }
    uploaded += 1;
  }
  const images = [...files].map(([path, { hash }]) => ({ path, hash }));
  return ok({ images, uploaded, kept: hashes.size - uploaded });
}

/** 一段原文摘录，交给后端。 */
export type Excerpt = {
  readonly file: string;
  readonly lines: string;
  readonly text: string;
  readonly fileHash: string;
};

/** 来源写在这三种卡上，和后端存原文摘录的范围相同。 */
const sourceSections = ["asks", "findings", "improvements"] as const;

/** 页面数据里写了 file 和 lines 的来源。写法不对的留给数据定义报。 */
function textSources(data: unknown): { where: string; file: string; lines: string }[] {
  if (typeof data !== "object" || data === null) return [];
  const found: { where: string; file: string; lines: string }[] = [];
  for (const section of sourceSections) {
    const cards: unknown = (data as Record<string, unknown>)[section];
    if (!Array.isArray(cards)) continue;
    for (const [i, card] of cards.entries()) {
      const sources: unknown = (card as { sources?: unknown } | null)?.sources;
      if (!Array.isArray(sources)) continue;
      for (const [j, source] of sources.entries()) {
        const { file, lines } = (source ?? {}) as { file?: unknown; lines?: unknown };
        if (typeof file !== "string" || typeof lines !== "string") continue;
        found.push({ where: whereOf([section, i, "sources", j]), file, lines });
      }
    }
  }
  return found;
}

/**
 * 读出文字来源的原文：从起始行到结束行，行与行之间用换行连接，另算整个文件的哈希。
 * 文件的路径相对项目的根目录 root。同一段只读一次，找不到的一次报齐。
 */
export async function readExcerpts(input: {
  readonly data: unknown;
  readonly root: string;
  readonly locate: (where: string) => string;
}): Promise<Result<Excerpt[], ErrorBody>> {
  const excerpts: Excerpt[] = [];
  const issues: Issue[] = [];
  const seen = new Set<string>();
  const files = new Map<string, { lines: string[]; hash: string } | { error: unknown }>();
  for (const source of textSources(input.data)) {
    const key = `${source.file}\n${source.lines}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const range = parseLineRange(source.lines);
    if (!range.ok) continue;
    let content = files.get(source.file);
    if (content === undefined) {
      try {
        const bytes = await readFile(join(input.root, source.file));
        const body = bytes.toString("utf8").replace(/\r\n/gu, "\n");
        const lines = body.endsWith("\n") ? body.slice(0, -1).split("\n") : body.split("\n");
        content = { lines, hash: sha256(bytes) };
      } catch (error) {
        content = { error };
      }
      files.set(source.file, content);
    }
    const where = input.locate(source.where);
    if ("error" in content) {
      issues.push({
        message: renderCopy(text.textFile.message, {
          path: source.file,
          reason: reasonOf(content.error),
        }),
        hint: renderCopy(text.textFile.hint, { root: input.root }),
        where,
      });
      continue;
    }
    const { start, end } = range.value;
    if (end > content.lines.length) {
      issues.push({
        message: renderCopy(text.textLines.message, {
          path: source.file,
          count: content.lines.length,
          lines: source.lines,
        }),
        hint: renderCopy(text.textLines.hint),
        where,
      });
      continue;
    }
    excerpts.push({
      file: source.file,
      lines: source.lines,
      text: content.lines.slice(start - 1, end).join("\n"),
      fileHash: content.hash,
    });
  }
  const [first, ...rest] = issues;
  if (first !== undefined) return err(errorBody("NOT_FOUND", [first, ...rest]));
  return ok(excerpts);
}
