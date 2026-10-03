import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { onTestFinished } from "vitest";

// 测试用的目录树，只给测试用。每个测试一个临时目录，测试结束就删掉。
// 家目录也用临时目录代替，不碰真实的家目录和项目，见「10 工程规范与流程」第五节。

/** 一个合格的 project.json。 */
export const identity = { schemaVersion: 1, projectId: "app", skillVersion: "0.0.1" } as const;

/** 建一个临时目录，返回解开符号链接以后的路径。macOS 的 /var 是 /private/var 的链接。 */
export function tempRoot(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "ploop-discover-")));
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** 目录树的一项：以 / 结尾的是目录；其余是文件，内容写空的，要写内容时写成 [路径, 内容]。 */
export type TreeItem = string | readonly [path: string, content: string];

/** 在 base 下按清单建目录和文件，缺的上级目录一并建好。 */
export function makeTree(base: string, items: readonly TreeItem[]): void {
  for (const item of items) {
    const [path, content] = typeof item === "string" ? [item, ""] : item;
    const full = join(base, path);
    if (path.endsWith("/")) {
      mkdirSync(full, { recursive: true });
    } else {
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, content);
    }
  }
}

/** 项目根目录下的 project.json，内容默认是合格的。 */
export function projectJson(root: string, content: string = JSON.stringify(identity)): TreeItem {
  return [join(root, ".product-loop", "project.json"), content];
}
