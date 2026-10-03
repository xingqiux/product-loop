import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  type Decision,
  decisionDocFileName,
  type ProjectIdentity,
  projectCacheDirName,
  projectIdentityFileName,
  projectIdentitySchema,
  renderCopy,
  renderDecisionDoc,
} from "@product-loop/model";
import { initCopy } from "../copy/init.ts";

// ploop init 建项目缓存，见「03 数据模型」第五节：身份文件 project.json 和说明文件夹的 README.md。
// 两个文件都只由命令写。主线.md 由主线的同步写，决定.md 由决定的命令重写，各个阶段的工作区由以后的命令写。

/** 项目缓存的文件夹。 */
export function projectCacheDir(root: string): string {
  return join(root, projectCacheDirName);
}

/** 只重写 project.json，例如主线同步以后改基准。 */
export async function writeProjectIdentity(root: string, identity: ProjectIdentity): Promise<void> {
  const dir = projectCacheDir(root);
  // 写之前按定义校验一次，写坏的 project.json 会让以后的每条命令都要先做迁移检查。
  const checked = projectIdentitySchema.parse(identity);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, projectIdentityFileName), `${JSON.stringify(checked, null, 2)}\n`);
}

/** 建好项目缓存，写 project.json 和 README.md，返回文件夹的路径。 */
export async function writeProjectCache(root: string, identity: ProjectIdentity): Promise<string> {
  await writeProjectIdentity(root, identity);
  const dir = projectCacheDir(root);
  await writeFile(join(dir, "README.md"), renderCopy(initCopy.readme));
  return dir;
}

/**
 * 重写决定.md：决定的只读视图，含已作废的，见「03 数据模型」第五节。
 * 命令从不回读它，每次按集中存储里的全部决定整份重写。返回文件的路径。
 */
export async function writeDecisionDoc(
  root: string,
  decisions: readonly Decision[],
): Promise<string> {
  const dir = projectCacheDir(root);
  await mkdir(dir, { recursive: true });
  const file = join(dir, decisionDocFileName);
  await writeFile(file, renderDecisionDoc(decisions));
  return file;
}
