import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  type ErrorBody,
  err,
  errorBody,
  ok,
  type ProjectIdentity,
  type Result,
} from "@product-loop/model";
import { describe, expect, it } from "vitest";
import {
  type MainlineRemote,
  type RemotePushed,
  type RemoteRevision,
  syncMainline,
  syncNotices,
} from "./mainline-sync.ts";
import { identity, makeTree, tempRoot } from "./testing.ts";

// 主线的同步，见「03 数据模型」第五节。集中存储换成假的，记下每次调用，
// 行为照后端的 pushRevision：全文和最新的一版相同时不建新版本，基准不是最新的返回冲突，
// 没写编号的场景补上编号。

const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

function revisionOf(revision: number, text: string): RemoteRevision {
  return { revision, hash: sha256(text), text };
}

/** 一份假的集中存储：revisions 是已有的各版，按版本号从小到大。 */
function fakeRemote(texts: readonly string[] = []) {
  const revisions = texts.map((text, i) => revisionOf(i + 1, text));
  const calls: string[] = [];
  let failure: ErrorBody | undefined;
  const remote: MainlineRemote = {
    latest: async () => {
      calls.push("latest");
      return ok(revisions.at(-1) ?? null);
    },
    push: async (text, base): Promise<Result<RemotePushed, ErrorBody>> => {
      calls.push(`push ${base}`);
      if (failure !== undefined) return err(failure);
      const latest = revisions.at(-1);
      if (latest?.hash === sha256(text)) {
        return ok({
          revision: latest,
          created: false,
          assignedScenes: [],
          removedScenes: [],
          warnings: [],
        });
      }
      if (base !== (latest?.revision ?? null)) {
        const message = `交上来的主线以第 ${base} 版为基准，集中存储里最新的已经是第 ${latest?.revision} 版。`;
        return err(errorBody("CONFLICT", [{ message, hint: "先合并。", where: "baseRevision" }]));
      }
      // 没写编号的场景补上编号，和后端一样从用过的最大编号往后数。
      let next = revisions.length === 0 ? 1 : 3;
      const assignedScenes: { id: string; name: string }[] = [];
      const numbered = text.replace(/^### (?!S\d)(.+)$/gmu, (_whole, name: string) => {
        const id = `S${next++}`;
        assignedScenes.push({ id, name });
        return `### ${id} ${name}`;
      });
      const revision = revisionOf(revisions.length + 1, numbered);
      revisions.push(revision);
      return ok({ revision, created: true, assignedScenes, removedScenes: [], warnings: [] });
    },
  };
  return {
    remote,
    calls,
    revisions,
    fail: (error: ErrorBody) => {
      failure = error;
    },
  };
}

const v1 = "# 主线\n\n## 场景清单\n\n### S1 看队列\n1. 点队列 → 看到看板\n";
const v2 = `${v1}\n### S2 看决定\n1. 点决定 → 看到表格\n`;

/** 一个项目根目录，写好主线.md 和主线.远端.md。base 是基准那一版的全文。 */
function project(options: { file?: string; remoteFile?: string; base?: RemoteRevision } = {}) {
  const root = tempRoot();
  const cache = join(root, ".product-loop");
  makeTree(root, [
    ".product-loop/",
    ...(options.file === undefined ? [] : [[".product-loop/主线.md", options.file] as const]),
    ...(options.remoteFile === undefined
      ? []
      : [[".product-loop/主线.远端.md", options.remoteFile] as const]),
  ]);
  const start: ProjectIdentity =
    options.base === undefined
      ? identity
      : { ...identity, mainlineBase: { revision: options.base.revision, hash: options.base.hash } };
  const read = (name: string) =>
    existsSync(join(cache, name)) ? readFileSync(join(cache, name), "utf8") : undefined;
  const savedBase = () => {
    const file = read("project.json");
    return file === undefined ? undefined : JSON.parse(file).mainlineBase;
  };
  return { root, cache, identity: start, read, savedBase };
}

describe("每条命令开始时同步主线", () => {
  it("两边都没有主线：什么都不做", async () => {
    const p = project();
    const r = fakeRemote();
    const synced = await syncMainline({ ...p, remote: r.remote, mode: "auto" });
    expect(synced).toEqual({
      ok: true,
      value: { synced: { kind: "same", revision: null }, identity },
    });
    expect(r.calls).toEqual(["latest"]);
    expect(p.read("主线.md")).toBeUndefined();
  });

  it("文件变了就交一个新版本，基准改成新的一版", async () => {
    const base = revisionOf(1, v1);
    const p = project({ file: v2, base });
    const r = fakeRemote([v1]);
    const synced = await syncMainline({ ...p, remote: r.remote, mode: "auto" });
    expect(r.calls).toEqual(["push 1"]);
    expect(synced.ok && synced.value.synced).toMatchObject({
      kind: "pushed",
      rewritten: false,
      pushed: { created: true, revision: { revision: 2 } },
    });
    expect(p.savedBase()).toEqual({ revision: 2, hash: sha256(v2) });
    expect(p.read("主线.md")).toBe(v2);
  });

  it("还没交过主线：基准写 null，新场景推送后文件里补上 S 编号", async () => {
    const p = project({ file: "# 主线\n\n## 场景清单\n\n### 看队列\n1. 点队列 → 看到看板\n" });
    const r = fakeRemote();
    const synced = await syncMainline({ ...p, remote: r.remote, mode: "auto" });
    expect(r.calls).toEqual(["push null"]);
    expect(p.read("主线.md")).toBe(v1);
    expect(p.savedBase()).toEqual({ revision: 1, hash: sha256(v1) });
    if (!synced.ok) throw new Error("应当同步成功");
    expect(syncNotices(synced.value.synced)).toEqual([
      "同步了主线：主线.md 交成了修订 1。",
      "补上了场景编号 S1 看队列，已写回主线.md。",
    ]);
  });

  it("文件没变，集中存储里的也没变：只看一眼，不写 project.json", async () => {
    const base = revisionOf(1, v1);
    const p = project({ file: v1, base });
    const r = fakeRemote([v1]);
    const synced = await syncMainline({ ...p, remote: r.remote, mode: "auto" });
    expect(synced.ok && synced.value.synced).toEqual({ kind: "same", revision: 1 });
    expect(r.calls).toEqual(["latest"]);
    expect(p.read("project.json")).toBeUndefined();
  });

  it("集中存储新、文件没变：用新的修订覆盖文件", async () => {
    const base = revisionOf(1, v1);
    const p = project({ file: v1, base });
    const r = fakeRemote([v1, v2]);
    const synced = await syncMainline({ ...p, remote: r.remote, mode: "auto" });
    expect(synced.ok && synced.value.synced).toEqual({
      kind: "pulled",
      revision: 2,
      discarded: false,
      remoteRemoved: false,
    });
    expect(p.read("主线.md")).toBe(v2);
    expect(p.savedBase()).toEqual({ revision: 2, hash: sha256(v2) });
    if (synced.ok) {
      expect(syncNotices(synced.value.synced)).toEqual([
        "同步了主线：用集中存储里的修订 2 覆盖了主线.md。",
      ]);
    }
  });

  it("文件不在或只有空白：集中存储里有主线就写出来", async () => {
    for (const file of [undefined, "  \n"]) {
      const p = project(file === undefined ? {} : { file });
      const r = fakeRemote([v1]);
      const synced = await syncMainline({ ...p, remote: r.remote, mode: "auto" });
      expect(synced.ok && synced.value.synced.kind).toBe("pulled");
      expect(p.read("主线.md")).toBe(v1);
      expect(r.calls).toEqual(["latest"]);
    }
  });

  it("两边都变了：写主线.远端.md，退出码 3，基准改成远端的修订，主线.md 不动", async () => {
    const base = revisionOf(1, v1);
    const mine = `${v1}\n## 交付线\n\n第一期做命令行。\n`;
    const p = project({ file: mine, base });
    const r = fakeRemote([v1, v2]);
    const synced = await syncMainline({ ...p, remote: r.remote, mode: "auto" });
    expect(synced).toEqual({
      ok: false,
      error: {
        code: "CONFLICT",
        message: "交上来的主线以第 1 版为基准，集中存储里最新的已经是第 2 版。",
        hint: "集中存储里的修订 2 写进了主线.远端.md。把它合进主线.md，再运行 ploop mainline push。",
        where: join(p.cache, "主线.远端.md"),
      },
    });
    expect(r.calls).toEqual(["push 1", "latest"]);
    expect(p.read("主线.远端.md")).toBe(v2);
    expect(p.read("主线.md")).toBe(mine);
    expect(p.savedBase()).toEqual({ revision: 2, hash: sha256(v2) });
  });

  it("主线.远端.md 还在：别的命令停下，退出码 3，不碰集中存储", async () => {
    const base = revisionOf(2, v2);
    const p = project({ file: `${v2}\n改了一行\n`, remoteFile: v2, base });
    const r = fakeRemote([v1, v2]);
    const synced = await syncMainline({ ...p, remote: r.remote, mode: "auto" });
    expect(synced.ok ? undefined : synced.error).toMatchObject({
      code: "CONFLICT",
      message: "主线.远端.md 还在，上次同步主线时的冲突还没有合并。",
      where: join(p.cache, "主线.远端.md"),
    });
    expect(r.calls).toEqual([]);
  });

  it("冲突以后后端没有主线了：照原样报后端的错，不写主线.远端.md", async () => {
    const p = project({ file: v2, base: revisionOf(1, v1) });
    const r = fakeRemote();
    const noMainline = errorBody("CONFLICT", [
      { message: "集中存储里还没有主线。", hint: "运行 ploop doctor。" },
    ]);
    r.fail(noMainline);
    const synced = await syncMainline({ ...p, remote: r.remote, mode: "auto" });
    expect(synced).toEqual({ ok: false, error: noMainline });
    expect(p.read("主线.远端.md")).toBeUndefined();
  });

  it("别的错误照原样交回", async () => {
    const p = project({ file: "  x" });
    const r = fakeRemote();
    const down = errorBody("INTERNAL", [
      { message: "后端连不上。", hint: "运行 ploop backend logs。" },
    ]);
    r.fail(down);
    expect(await syncMainline({ ...p, remote: r.remote, mode: "auto" })).toEqual({
      ok: false,
      error: down,
    });
  });
});

describe("ploop mainline push 和 pull", () => {
  it("push：合并好以后交上去，删掉主线.远端.md", async () => {
    const merged = `${v2}\n## 交付线\n\n第一期做命令行。\n`;
    const p = project({ file: merged, remoteFile: v2, base: revisionOf(2, v2) });
    const r = fakeRemote([v1, v2]);
    const synced = await syncMainline({ ...p, remote: r.remote, mode: "push" });
    expect(synced.ok && synced.value.synced).toMatchObject({
      kind: "pushed",
      remoteRemoved: true,
      pushed: { created: true, revision: { revision: 3 } },
    });
    expect(r.calls).toEqual(["push 2"]);
    expect(p.read("主线.远端.md")).toBeUndefined();
    expect(p.savedBase()).toEqual({ revision: 3, hash: sha256(merged) });
  });

  it("push：文件和基准相同也交，全文和最新的一版相同时不建新版本", async () => {
    const p = project({ file: v1, base: revisionOf(1, v1) });
    const r = fakeRemote([v1]);
    const synced = await syncMainline({ ...p, remote: r.remote, mode: "push" });
    expect(synced.ok && synced.value.synced).toMatchObject({
      kind: "pushed",
      pushed: { created: false, revision: { revision: 1 } },
    });
    expect(r.calls).toEqual(["push 1"]);
  });

  it("push：没有主线.md 时找不到，退出码 4", async () => {
    const p = project();
    const r = fakeRemote([v1]);
    const synced = await syncMainline({ ...p, remote: r.remote, mode: "push" });
    expect(synced.ok ? undefined : synced.error.code).toBe("NOT_FOUND");
    expect(r.calls).toEqual([]);
  });

  it("pull：主线.md 有没交的改动时先拦下，什么都不丢，说明怎么办", async () => {
    const edited = `${v1}改了\n`;
    const p = project({ file: edited, base: revisionOf(1, v1) });
    const r = fakeRemote([v1, v2]);
    const synced = await syncMainline({ ...p, remote: r.remote, mode: "pull" });
    expect(synced.ok ? undefined : synced.error.code).toBe("CONFLICT");
    expect(synced.ok ? undefined : synced.error.message).toContain("还没交上去的改动");
    expect(synced.ok ? undefined : synced.error.hint).toContain("--force");
    expect(p.read("主线.md")).toBe(edited);
  });

  it("pull：上一次同步留下了主线.远端.md 还没合并时也拦下", async () => {
    const p = project({ file: v1, remoteFile: v2, base: revisionOf(1, v1) });
    const r = fakeRemote([v1, v2]);
    const synced = await syncMainline({ ...p, remote: r.remote, mode: "pull" });
    expect(synced.ok ? undefined : synced.error.code).toBe("CONFLICT");
    expect(p.read("主线.远端.md")).toBe(v2);
  });

  it("pull --force：丢掉没交的改动，删掉主线.远端.md，基准改成最新的一版", async () => {
    const p = project({ file: `${v1}改了\n`, remoteFile: v2, base: revisionOf(2, v2) });
    const r = fakeRemote([v1, v2]);
    const synced = await syncMainline({ ...p, remote: r.remote, mode: "pull", force: true });
    expect(synced.ok && synced.value.synced).toEqual({
      kind: "pulled",
      revision: 2,
      discarded: true,
      remoteRemoved: true,
    });
    expect(p.read("主线.md")).toBe(v2);
    expect(p.read("主线.远端.md")).toBeUndefined();
  });

  it("pull：集中存储里没有主线时什么都不做", async () => {
    const p = project({ file: v1 });
    const r = fakeRemote();
    const synced = await syncMainline({ ...p, remote: r.remote, mode: "pull" });
    expect(synced.ok && synced.value.synced).toEqual({ kind: "same", revision: null });
    expect(p.read("主线.md")).toBe(v1);
  });
});
