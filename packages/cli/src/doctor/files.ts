import { lstat, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

// 迁移检查只读项目里的文件，不改任何文件，见「08 版本与迁移」第四节第 1 步。
// 这里只有读的操作：列目录、读文件、查类型。符号链接不跟进去，免得绕出项目。

/** 一个目录下的一项。 */
export type Entry = { readonly name: string; readonly dir: boolean };

/** 列出目录下的各项，按名字排。不存在、不是目录或读不出来时是空的。 */
export async function listDir(dir: string): Promise<Entry[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() || entry.isDirectory())
      .map((entry) => ({ name: entry.name, dir: entry.isDirectory() }))
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  } catch {
    return [];
  }
}

/** 读出文本文件。不存在或读不出来时是 undefined。 */
export async function readText(file: string): Promise<string | undefined> {
  try {
    return await readFile(file, "utf8");
  } catch {
    return undefined;
  }
}

/** 是一个文件，不跟符号链接。 */
export async function isFile(path: string): Promise<boolean> {
  try {
    return (await lstat(path)).isFile();
  } catch {
    return false;
  }
}

/** 是一个目录，不跟符号链接。 */
export async function isDir(path: string): Promise<boolean> {
  try {
    return (await lstat(path)).isDirectory();
  } catch {
    return false;
  }
}

/** 目录下全部的文件，写成相对这个目录的路径，按路径排。 */
export async function listFiles(dir: string, prefix = ""): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await listDir(dir)) {
    const path = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.dir) files.push(...(await listFiles(join(dir, entry.name), path)));
    else files.push(path);
  }
  return files;
}

/** 截图和图片的扩展名。 */
export const imagePattern = /\.(?:png|jpe?g|gif|webp|svg)$/iu;
