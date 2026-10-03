import { createHash } from "node:crypto";
import { readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  type ErrorBody,
  err,
  errorBody,
  type Issue,
  mainlineTemplate,
  ok,
  type ProjectIdentity,
  type Result,
  renderCopy,
} from "@product-loop/model";
import type { Backend } from "../connect.ts";
import { mainlineCopy } from "../copy/mainline.ts";
import { projectCacheDir, writeProjectIdentity } from "./cache.ts";

// 主线的同步，见「03 数据模型」第五节。project.json 记着主线的基准：版本号和全文的 SHA-256。
// 结果要看最新主线的命令开始时比较主线.md 的哈希和基准，其余的命令只读，不交新的一版：
//   1. 文件变了：连同基准版本号交给后端，存成新的一版。补上的场景编号写回文件。
//   2. 文件没变，集中存储里有更新的一版：用它覆盖文件。
//   3. 两边都变了：后端返回冲突。集中存储里最新的一版写成主线.远端.md，退出码 3。
// 冲突时基准改成写进主线.远端.md 的那一版，AI 合并以后交上去，基准就是对的。
// 主线.远端.md 在的时候，表示冲突还没合并，别的命令一律停下，
// 以免没合并的主线.md 被自动交上去，盖掉别的会话的改动。
// AI 合并以后运行 ploop mainline push，或者删掉主线.远端.md，下一条命令就会交上去。
// 主线.md 不在或只有空白时算没写过，集中存储里有主线就写出来。

export const mainlineFileName = "主线.md";
const remoteMainlineFileName = "主线.远端.md";

const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

/** 集中存储里的一版：版本号、全文的哈希和全文。 */
export type RemoteRevision = {
  readonly revision: number;
  readonly hash: string;
  readonly text: string;
};

/** 交一版的结果，和 POST /projects/:pid/mainline/revisions 的响应相同，另带解析的警告。 */
export type RemotePushed = {
  readonly revision: RemoteRevision;
  readonly created: boolean;
  readonly assignedScenes: readonly { readonly id: string; readonly name: string }[];
  readonly removedScenes: readonly string[];
  readonly warnings: readonly Issue[];
};

/** 同步要用的两个接口。测试换成假的。 */
export type MainlineRemote = {
  /** 最新的一版。还没交过主线时是 null。 */
  readonly latest: () => Promise<Result<RemoteRevision | null, ErrorBody>>;
  /** 交一版，带基准版本号。 */
  readonly push: (
    text: string,
    baseRevision: number | null,
  ) => Promise<Result<RemotePushed, ErrorBody>>;
};

/**
 * 同步的三种做法。
 * - auto：每条命令开始时。主线.远端.md 在时停下。
 * - push：ploop mainline push。主线.远端.md 在时，当作 AI 已经合并好，交上去以后删掉它。
 * - pull：ploop mainline pull。不管主线.md，用最新的一版覆盖它，删掉主线.远端.md。
 */
export type SyncMode = "auto" | "push" | "pull";

/** 同步的结果。 */
export type Synced =
  /** 两边一致，什么都没做。revision 是基准的版本号，还没交过主线时是 null。 */
  | { readonly kind: "same"; readonly revision: number | null }
  /** 交了主线.md。rewritten 表示补上了场景编号，全文写回了主线.md。 */
  | {
      readonly kind: "pushed";
      readonly pushed: RemotePushed;
      readonly rewritten: boolean;
      readonly remoteRemoved: boolean;
    }
  /** 用集中存储里的一版覆盖了主线.md。discarded 表示主线.md 里有没交的改动被丢掉了。 */
  | {
      readonly kind: "pulled";
      readonly revision: number;
      readonly discarded: boolean;
      readonly remoteRemoved: boolean;
    };

export type SyncInput = {
  readonly root: string;
  readonly identity: ProjectIdentity;
  readonly remote: MainlineRemote;
  readonly mode: SyncMode;
  /** pull 时主线.md 里有没交的改动，写了 force 才丢掉，不写就拦下。 */
  readonly force?: boolean;
};

/** 同步以后的结果和 project.json 的新内容。 */
export type SyncDone = { readonly synced: Synced; readonly identity: ProjectIdentity };

async function readText(file: string): Promise<string | undefined> {
  try {
    return await readFile(file, "utf8");
  } catch {
    return undefined;
  }
}

/** 项目缓存里主线.md 现在的内容。没有这个文件时是 undefined。 */
export function localMainlineText(root: string): Promise<string | undefined> {
  return readText(join(projectCacheDir(root), mainlineFileName));
}

async function exists(file: string): Promise<boolean> {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

/**
 * 主线.md 有没有还没交上去的改动，只读，什么都不写。读命令不交新的一版，
 * 靠它在输出里提醒：显示的是上一次交上去的那一版。还没交过主线时，和模板一样不算改动。
 */
export async function hasUnpushedChange(root: string, identity: ProjectIdentity): Promise<boolean> {
  const text = await readText(join(projectCacheDir(root), mainlineFileName));
  if (text === undefined || text.trim() === "") return false;
  const base = identity.mainlineBase;
  return base === undefined ? text !== mainlineTemplate() : sha256(text) !== base.hash;
}

/** 同步主线，按需要写主线.md、主线.远端.md 和 project.json 的基准。 */
export async function syncMainline(input: SyncInput): Promise<Result<SyncDone, ErrorBody>> {
  const { root, remote, mode } = input;
  const dir = projectCacheDir(root);
  const file = join(dir, mainlineFileName);
  const remoteFile = join(dir, remoteMainlineFileName);
  const text = await readText(file);
  const pending = await exists(remoteFile);
  let identity = input.identity;
  const base = identity.mainlineBase;

  /** 改 project.json 的基准。和原来相同时不写。 */
  const saveBase = async (revision: RemoteRevision) => {
    if (base?.revision === revision.revision && base.hash === revision.hash) return;
    identity = { ...identity, mainlineBase: { revision: revision.revision, hash: revision.hash } };
    await writeProjectIdentity(root, identity);
  };

  /** 用集中存储里的一版覆盖主线.md。 */
  const pull = async (
    latest: RemoteRevision,
    discarded: boolean,
  ): Promise<Extract<Synced, { readonly kind: "pulled" }>> => {
    if (text !== latest.text) await writeFile(file, latest.text);
    await saveBase(latest);
    return { kind: "pulled", revision: latest.revision, discarded, remoteRemoved: false };
  };

  const done = (synced: Synced) => ok({ synced, identity });

  if (mode === "pull") {
    const latest = await remote.latest();
    if (!latest.ok) return latest;
    if (latest.value === null) return done({ kind: "same", revision: null });
    const changed = text !== undefined && (base === undefined || sha256(text) !== base.hash);
    const discarded = (pending || changed) && text !== latest.value.text;
    if (discarded && input.force !== true) {
      const { message, hint } = pending
        ? mainlineCopy.sync.pullUnmerged
        : mainlineCopy.sync.pullDiscards;
      const issue = { message: renderCopy(message), hint: renderCopy(hint), where: file };
      return err(errorBody("CONFLICT", [issue]));
    }
    const synced = await pull(latest.value, discarded);
    if (!pending) return done(synced);
    await rm(remoteFile, { force: true });
    return done({ ...synced, remoteRemoved: true });
  }

  if (pending && mode === "auto") {
    const { message, hint } = mainlineCopy.sync.pending;
    const issue = { message: renderCopy(message), hint: renderCopy(hint), where: remoteFile };
    return err(errorBody("CONFLICT", [issue]));
  }

  if (text === undefined && mode === "push") {
    const { message, hint } = mainlineCopy.sync.missing;
    return err(
      errorBody("NOT_FOUND", [
        { message: renderCopy(message), hint: renderCopy(hint), where: file },
      ]),
    );
  }

  // 没写过主线：集中存储里有就写出来。
  if (text === undefined || (text.trim() === "" && mode === "auto")) {
    const latest = await remote.latest();
    if (!latest.ok) return latest;
    if (latest.value === null) return done({ kind: "same", revision: null });
    return done(await pull(latest.value, false));
  }

  const changed = mode === "push" || base === undefined || sha256(text) !== base.hash;
  if (!changed) {
    const latest = await remote.latest();
    if (!latest.ok) return latest;
    // 集中存储里没有主线而基准还在，是两边对不上了，由迁移检查处理，这里不动。
    if (latest.value === null || latest.value.hash === base.hash) {
      return done({ kind: "same", revision: base.revision });
    }
    return done(await pull(latest.value, false));
  }

  const pushed = await remote.push(text, base?.revision ?? null);
  if (pushed.ok) {
    const { revision } = pushed.value;
    const rewritten = revision.text !== text;
    if (rewritten) await writeFile(file, revision.text);
    await saveBase(revision);
    if (pending) await rm(remoteFile, { force: true });
    return done({ kind: "pushed", pushed: pushed.value, rewritten, remoteRemoved: pending });
  }
  if (pushed.error.code !== "CONFLICT") return pushed;

  // 两边都改了。冲突的响应不带全文，另取最新的一版写成主线.远端.md。
  const latest = await remote.latest();
  if (!latest.ok || latest.value === null) return pushed;
  await writeFile(remoteFile, latest.value.text);
  await saveBase(latest.value);
  const hint = renderCopy(mainlineCopy.sync.conflictHint, { latest: latest.value.revision });
  const { message } = pushed.error;
  return err(errorBody("CONFLICT", [{ message, hint, where: remoteFile }]));
}

/** 自动同步做了事时，给人看的几行。什么都没做时没有。 */
export function syncNotices(synced: Synced): string[] {
  const { sync } = mainlineCopy;
  switch (synced.kind) {
    case "same":
      return [];
    case "pulled":
      return [renderCopy(sync.pulled, { revision: synced.revision })];
    case "pushed": {
      const { pushed } = synced;
      const lines = pushed.created
        ? [renderCopy(sync.pushed, { revision: pushed.revision.revision })]
        : [];
      if (pushed.assignedScenes.length > 0) {
        lines.push(renderCopy(sync.assigned, { scenes: sceneList(pushed.assignedScenes) }));
      }
      if (pushed.created && pushed.warnings.length > 0) {
        lines.push(renderCopy(sync.problems, { count: pushed.warnings.length }));
      }
      return lines;
    }
  }
}

/** 补上的场景写成「S4 看队列、S5 改设置」。 */
export function sceneList(scenes: RemotePushed["assignedScenes"]): string {
  return scenes.map(({ id, name }) => `${id} ${name}`).join("、");
}

/** 同步用的接口，接到真的后端上。 */
export function backendRemote(backend: Backend, pid: string): MainlineRemote {
  return {
    latest: async () => {
      const result = await backend.call((api) =>
        api.api.v1.projects[":pid"].mainline.$get({ param: { pid } }),
      );
      if (!result.ok) return result;
      const { latest } = result.value.data;
      return ok(latest === null ? null : pick(latest));
    },
    push: async (text, baseRevision) => {
      const result = await backend.call((api) =>
        api.api.v1.projects[":pid"].mainline.revisions.$post({
          param: { pid },
          json: { text, baseRevision },
        }),
      );
      if (!result.ok) return result;
      const { data, warnings } = result.value;
      return ok({
        revision: pick(data.revision),
        created: data.created,
        assignedScenes: data.assignedScenes,
        removedScenes: data.removedScenes,
        warnings,
      });
    },
  };
}

function pick(revision: RemoteRevision): RemoteRevision {
  return { revision: revision.revision, hash: revision.hash, text: revision.text };
}
