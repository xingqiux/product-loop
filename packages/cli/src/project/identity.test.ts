import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { errorCodeInfo } from "@product-loop/model";
import { describe, expect, it } from "vitest";
import { readProjectIdentity } from "./identity.ts";
import { identity, tempRoot } from "./testing.ts";

const hint = "project.json 只由命令写，不要手改。运行 ploop doctor 做迁移检查。";

/** 把内容写进临时目录里的 project.json，返回文件的路径。 */
function write(content: string): string {
  const file = join(tempRoot(), "project.json");
  writeFileSync(file, content);
  return file;
}

describe("读 project.json", () => {
  it("合格的照样读出来，交过主线的另有主线的基准", async () => {
    expect(await readProjectIdentity(write(JSON.stringify(identity)))).toEqual({
      ok: true,
      value: identity,
    });
    const hash = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";
    const synced = { ...identity, mainlineBase: { revision: 3, hash } };
    expect(await readProjectIdentity(write(JSON.stringify(synced, null, 2)))).toEqual({
      ok: true,
      value: synced,
    });
  });

  it("写坏了都按要先做迁移检查报，退出码 6", async () => {
    const result = await readProjectIdentity(write("{"));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("NEEDS_DOCTOR");
    expect(errorCodeInfo(result.error.code).exit).toBe(6);
  });

  it("不是合法的 JSON：位置写到行和列", async () => {
    const file = write(
      '{\n  "schemaVersion": 1,\n  "projectId": "app"\n  "skillVersion": "2.0.0"\n}',
    );
    expect(await readProjectIdentity(file)).toEqual({
      ok: false,
      error: {
        code: "NEEDS_DOCTOR",
        message: "project.json 不是合法的 JSON。",
        hint,
        where: `${file} 第 4 行第 3 列`,
      },
    });
  });

  it("最外层不是对象：位置写到文件", async () => {
    const file = write("[]");
    expect(await readProjectIdentity(file)).toEqual({
      ok: false,
      error: {
        code: "NEEDS_DOCTOR",
        message: "project.json 的最外层要是一个 JSON 对象。",
        hint,
        where: file,
      },
    });
  });

  it("格式不对：每一处各报一条，写明缺了什么、应当写什么，位置写到字段", async () => {
    const file = write(
      JSON.stringify({
        schemaVersion: 2,
        projectId: "App",
        mainlineBase: { revision: 0, hash: "9f86d0" },
        root: "/Users/me/proj/app",
      }),
    );
    const result = await readProjectIdentity(file);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.issues?.map(({ message, where }) => [message, where])).toEqual([
      ["project.json 的 schemaVersion 写法不对，应当写格式版本 1。", `${file} → schemaVersion`],
      [
        "project.json 的 projectId 写法不对，应当写项目名，只用小写字母、数字和短横。",
        `${file} → projectId`,
      ],
      [
        "project.json 缺少 skillVersion，应当写项目所用的 skill 版本，例如 0.0.1。",
        `${file} → skillVersion`,
      ],
      [
        "project.json 的 mainlineBase.revision 写法不对，应当写主线的基准修订 revision 和全文的 SHA-256 hash。",
        `${file} → mainlineBase.revision`,
      ],
      [
        "project.json 的 mainlineBase.hash 写法不对，应当写主线的基准修订 revision 和全文的 SHA-256 hash。",
        `${file} → mainlineBase.hash`,
      ],
      ["project.json 里有不认识的字段 root。", `${file} → root`],
    ]);
    expect(result.error.issues?.every((issue) => issue.hint === hint)).toBe(true);
    expect(result.error.total).toBe(6);
  });

  it("读不出来：写明原因，不露出系统错误码", async () => {
    const dir = join(tempRoot(), "project.json");
    mkdirSync(dir);
    expect(await readProjectIdentity(dir)).toEqual({
      ok: false,
      error: {
        code: "NEEDS_DOCTOR",
        message: "project.json 读不出来：这是一个文件夹，不是文件。",
        hint,
        where: dir,
      },
    });
  });
});
