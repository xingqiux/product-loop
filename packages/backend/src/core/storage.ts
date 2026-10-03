import { statSync } from "node:fs";
import { type AnyColumn, asc, eq, isNotNull, notExists, sql } from "drizzle-orm";
import { union } from "drizzle-orm/sqlite-core";
import {
  type BlobHash,
  blobRefs,
  blobs,
  pages,
  projects,
  rounds,
  screens,
  useRuns,
  useSteps,
} from "../store/schema/index.ts";
import type { Reader } from "./projects.ts";

// 集中存储的占用：`ploop storage`，接口是 GET /storage，见「03 数据模型」第六节。
// 附件按引用它的对象归到项目：页面、轮次、使用步骤、屏，以及迁移进来的旧页面的网页快照。
// 一个附件被几个项目引用时，每个项目各算一次，合计里只算一次。
// 草稿和回复的一行也会引用附件。第 43 步加上这两张表以后，在 projectBlobs 里接上。
// 数据库是一个文件，分不出每个项目各占多少，所以只给合计。

/** 几个附件和它们的字节数。 */
type BlobUsage = { readonly count: number; readonly bytes: number };

/** 一个项目引用的附件。 */
type ProjectStorage = {
  readonly project: string;
  readonly name: string;
  readonly blobs: BlobUsage;
};

export type StorageUsage = {
  /** 每个项目一项，按登记的先后排。 */
  readonly projects: readonly ProjectStorage[];
  /** 附件库的合计，每个附件算一次。 */
  readonly blobs: BlobUsage;
  /** 没有任何引用的附件。 */
  readonly unreferenced: BlobUsage;
  /** 数据库文件的字节数，含旁边的 -wal 和 -shm。 */
  readonly database: { readonly bytes: number };
};

/** 引用者的编号存成文字，和整数编号比较时先把编号转成文字。 */
const idText = (column: AnyColumn) => sql`cast(${column} as text)`;

/** 每个项目引用的附件，同一个项目里的同一个附件只出现一次。 */
function projectBlobs(db: Reader) {
  const byKind = (kind: "page" | "round" | "useStep" | "screen") => eq(blobRefs.referrerKind, kind);
  const fromPages = db
    .select({ project: pages.projectId, hash: blobRefs.blobHash })
    .from(blobRefs)
    .innerJoin(pages, eq(blobRefs.referrerId, idText(pages.id)))
    .where(byKind("page"));
  const fromRounds = db
    .select({ project: rounds.projectId, hash: blobRefs.blobHash })
    .from(blobRefs)
    .innerJoin(rounds, eq(blobRefs.referrerId, idText(rounds.id)))
    .where(byKind("round"));
  const fromSteps = db
    .select({ project: useRuns.projectId, hash: blobRefs.blobHash })
    .from(blobRefs)
    .innerJoin(useSteps, eq(blobRefs.referrerId, idText(useSteps.id)))
    .innerJoin(useRuns, eq(useRuns.id, useSteps.runId))
    .where(byKind("useStep"));
  const fromScreens = db
    .select({ project: screens.projectId, hash: blobRefs.blobHash })
    .from(blobRefs)
    .innerJoin(screens, eq(blobRefs.referrerId, idText(screens.id)))
    .where(byKind("screen"));
  // 旧页面的网页快照直接记在页面上，见 store/schema/pages.ts。
  const snapshots = db
    .select({ project: pages.projectId, hash: sql<BlobHash>`${pages.legacySnapshot}` })
    .from(pages)
    .where(isNotNull(pages.legacySnapshot));
  // union 去掉重复的「项目、附件」。
  return union(fromPages, fromRounds, fromSteps, fromScreens, snapshots).all();
}

/** 按项目统计附件，另给附件库和数据库的合计。databaseFile 是数据库文件的路径。 */
export function storageUsage(db: Reader, databaseFile: string): StorageUsage {
  const sizes = new Map(
    db
      .select({ hash: blobs.hash, size: blobs.size })
      .from(blobs)
      .all()
      .map((row) => [row.hash, row.size]),
  );
  const perProject = new Map<string, { count: number; bytes: number }>();
  for (const { project, hash } of projectBlobs(db)) {
    const usage = perProject.get(project) ?? { count: 0, bytes: 0 };
    usage.count += 1;
    usage.bytes += sizes.get(hash) ?? 0;
    perProject.set(project, usage);
  }
  const list = db
    .select({ id: projects.id, name: projects.name })
    .from(projects)
    .orderBy(asc(projects.createdAt), asc(projects.id))
    .all();
  const unreferenced = db
    .select({ size: blobs.size })
    .from(blobs)
    .where(
      notExists(db.select({ one: sql`1` }).from(blobRefs).where(eq(blobRefs.blobHash, blobs.hash))),
    )
    .all();
  return {
    projects: list.map(({ id, name }) => ({
      project: id,
      name,
      blobs: perProject.get(id) ?? { count: 0, bytes: 0 },
    })),
    blobs: total([...sizes.values()]),
    unreferenced: total(unreferenced.map((row) => row.size)),
    database: { bytes: databaseBytes(databaseFile) },
  };
}

function total(sizes: readonly number[]): BlobUsage {
  return { count: sizes.length, bytes: sizes.reduce((sum, size) => sum + size, 0) };
}

/** 数据库文件和旁边的 -wal、-shm 加起来的字节数。不在的文件算零。 */
function databaseBytes(file: string): number {
  let bytes = 0;
  for (const path of [file, `${file}-wal`, `${file}-shm`]) {
    const stats = statSync(path, { throwIfNoEntry: false });
    if (stats?.isFile() === true) bytes += stats.size;
  }
  return bytes;
}
