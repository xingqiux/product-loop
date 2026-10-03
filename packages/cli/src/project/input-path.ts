import { stat } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";

// 命令里写的文件路径怎么找：先相对当前目录，找不到再相对项目缓存，见「04 命令行」第六节。
// 帮助里的例子写成 rounds/v2-检查-1/page.json，在项目根目录里运行也能找到。

/** 找到的路径，和试过的位置。都找不到时路径是相对当前目录的那一个，报错里写出试过的位置。 */
export type LocatedInput = { readonly path: string; readonly tried: readonly string[] };

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/** 先按当前目录找，找不到再按项目缓存找。绝对路径只有一个位置。没有项目缓存时只按当前目录。 */
export async function locateInput(
  cwd: string,
  cache: string | undefined,
  path: string,
): Promise<LocatedInput> {
  const first = resolve(cwd, path);
  const tried = cache === undefined || isAbsolute(path) ? [first] : [first, resolve(cache, path)];
  for (const candidate of tried) {
    if (await exists(candidate)) return { path: candidate, tried };
  }
  return { path: first, tried };
}
