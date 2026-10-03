import { rm } from "node:fs/promises";
import { join } from "node:path";
import {
  archiveReceivedSchema,
  type ErrorBody,
  err,
  errorBody,
  type Issue,
  legacyCompletedSchema,
  legacyImportedSchema,
  legacyImportSchema,
  legacyPageCheckSchema,
  legacyStatusSchema,
  ok,
  pageCheckReportSchema,
  type Result,
  renderCopy,
} from "@product-loop/model";
import { Hono } from "hono";
import { legacyCopy } from "../../copy/legacy.ts";
import {
  type ArchiveRecord,
  canArchive,
  completeLegacy,
  importLegacy,
  legacyState,
  recordArchive,
} from "../../core/legacy.ts";
import { checkHistoryPage, checkReport } from "../../core/pages/check.ts";
import {
  type ArchiveMismatch,
  checkArchive,
  readArchive,
  receiveArchive,
} from "../../store/archives.ts";
import { type BlobHash, hasBlob } from "../../store/blobs.ts";
import { writeContext } from "../context.ts";
import type { AppDeps } from "../deps.ts";
import { failure, reply } from "../respond.ts";
import { jsonBody } from "../validate.ts";

// 迁移的接口，见「05 接口」第四节「写作校验、导出和迁移」和第一期计划第 60、61 步。业务规则在 core/legacy.ts。
// 归档包的请求体是 tar.gz 本身，不受五兆的上限，边收边写进 archives/，见 store/archives.ts。
// 导入按全局操作做，期间别的写请求返回 BUSY，见「01 架构」第七节。

const hashPattern = /^[0-9a-f]{64}$/u;

/** 归档包的文件名：项目编号加上 UTC 的时间，时间以 Z 结尾，和快照的名字一样。 */
const archiveName = (projectId: string, now: Date) =>
  `${projectId}-${now.toISOString().replace(/[-:]/gu, "").replace(/\..*$/u, "")}Z.tar.gz`;

function mismatchIssue(mismatch: ArchiveMismatch): Issue {
  const text = legacyCopy.archive;
  if (mismatch.kind === "noManifest") {
    return { message: renderCopy(text.noManifest.message), hint: renderCopy(text.noManifest.hint) };
  }
  const entry = text[mismatch.kind];
  return {
    message: renderCopy(entry.message, { path: mismatch.path }),
    hint: renderCopy(entry.hint),
    where: mismatch.path,
  };
}

function badRequest(issues: readonly Issue[]): ErrorBody<"BAD_REQUEST"> {
  const [first, ...rest] = issues;
  if (first === undefined) throw new Error("没有问题却要报 BAD_REQUEST。");
  return errorBody("BAD_REQUEST", [first, ...rest]);
}

/** 收包、读包、核对清单。不通过时删掉收下的文件。 */
async function takeArchive(
  deps: AppDeps,
  projectId: string,
  body: ReadableStream<Uint8Array> | null,
  expected: string,
): Promise<Result<ArchiveRecord, ErrorBody<"BAD_REQUEST">>> {
  const dir = deps.paths.dirs.archives;
  const text = legacyCopy.archive;
  const received = await receiveArchive(
    dir,
    archiveName(projectId, deps.now()),
    body ?? new ReadableStream({ start: (controller) => controller.close() }),
    expected,
  );
  if (!received.ok) {
    const params = { expected: expected.slice(0, 8), actual: received.error.actual.slice(0, 8) };
    return err(
      badRequest([
        {
          message: renderCopy(text.hashMismatch.message, params),
          hint: renderCopy(text.hashMismatch.hint),
        },
      ]),
    );
  }
  const path = join(dir, received.value.file);
  try {
    const contents = await readArchive(path);
    const issues = checkArchive(contents);
    if (issues.length > 0) {
      await rm(path, { force: true });
      return err(badRequest(issues.map(mismatchIssue)));
    }
    return ok({ ...received.value, manifest: contents.manifest ?? [] });
  } catch (error) {
    await rm(path, { force: true });
    const reason = error instanceof Error ? error.message : String(error);
    const message = renderCopy(text.unreadable.message, { reason });
    return err(badRequest([{ message, hint: renderCopy(text.unreadable.hint) }]));
  }
}

export function legacyRoutes(deps: AppDeps) {
  const store = { db: deps.db, dir: deps.paths.dirs.blobs };
  const importDeps = { hasBlob: (hash: BlobHash) => hasBlob(store, hash) };
  return (
    new Hono()
      /** 历史页面模式的校验，项目还没登记也能用，不记命中。ploop doctor 用。 */
      .post("/legacy/pages/check", ...jsonBody(legacyPageCheckSchema), (c) => {
        const { data, stage, pageDate } = c.req.valid("json");
        const report = checkReport(checkHistoryPage(data, stage, pageDate));
        return reply(c, 200, pageCheckReportSchema, report);
      })
      /** 迁移停在哪里。ploop doctor 用。 */
      .get("/projects/:pid/legacy", (c) => {
        const result = legacyState(deps.db, c.req.param("pid"));
        if (!result.ok) return failure(c, result.error);
        return reply(c, 200, legacyStatusSchema, result.value);
      })
      /** 收归档包：请求体是 tar.gz，查询参数 sha256 写整个包的哈希。ploop doctor --fix 用。 */
      .post("/projects/:pid/legacy/archive", async (c) => {
        const pid = c.req.param("pid");
        const expected = c.req.query("sha256") ?? "";
        if (!hashPattern.test(expected)) {
          const text = legacyCopy.archive.hashInvalid;
          const message = renderCopy(text.message, { text: expected });
          return failure(
            c,
            badRequest([{ message, hint: renderCopy(text.hint), where: "sha256" }]),
          );
        }
        const allowed = canArchive(deps.db, pid);
        if (!allowed.ok) return failure(c, allowed.error);
        const taken = await takeArchive(deps, pid, c.req.raw.body, expected);
        if (!taken.ok) return failure(c, taken.error);
        const recorded = recordArchive(writeContext(c, deps), pid, taken.value);
        const dir = deps.paths.dirs.archives;
        if (!recorded.ok) {
          await rm(join(dir, taken.value.file), { force: true });
          return failure(c, recorded.error);
        }
        if (recorded.value.replaced !== null) {
          await rm(join(dir, recorded.value.replaced), { force: true });
        }
        const archive = recorded.value.state.archive;
        if (archive === null) throw new Error("刚记下的归档包不见了。");
        return reply(c, 201, archiveReceivedSchema, archive);
      })
      /** 导入旧数据，核对不通过时整批撤回。ploop doctor --fix 用。 */
      .post("/projects/:pid/legacy/import", ...jsonBody(legacyImportSchema), async (c) => {
        const ctx = writeContext(c, deps);
        const input = c.req.valid("json");
        const result = await deps.process.during("migrate", async () =>
          importLegacy(ctx, c.req.param("pid"), input, importDeps),
        );
        if (!result.ok) return failure(c, result.error);
        return reply(c, 200, legacyImportedSchema, { counts: result.value });
      })
      /** 核对数量，标记迁移完成，返回要清理的旧文件。ploop doctor --fix 用。 */
      .post("/projects/:pid/legacy/complete", (c) => {
        const result = completeLegacy(writeContext(c, deps), c.req.param("pid"));
        if (!result.ok) return failure(c, result.error);
        return reply(c, 200, legacyCompletedSchema, result.value);
      })
  );
}
