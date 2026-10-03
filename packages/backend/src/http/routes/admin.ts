import { statSync } from "node:fs";
import { basename } from "node:path";
import {
  backupListSchema,
  backupTakenSchema,
  errorBody,
  gcResultSchema,
  renderCopy,
  restoredSchema,
  restorePreviewSchema,
  restoreRequestSchema,
  shutdownSchema,
} from "@product-loop/model";
import { Hono } from "hono";
import { backupCopy } from "../../copy/backup.ts";
import { httpCopy } from "../../copy/http.ts";
import type { RestoreError } from "../../store/backup.ts";
import { listSnapshots, snapshotIssue, snapshotRunning } from "../../store/backup.ts";
import { gcBlobs } from "../../store/blobs.ts";
import type { AppDeps } from "../deps.ts";
import { failure, reply } from "../respond.ts";
import { jsonBody, queryParams } from "../validate.ts";

// 管理后端的接口，见「05 接口」第四节：退出、备份、列出快照、恢复、清理附件。
// 恢复是全局操作，期间写请求和退出返回 BUSY，见「01 架构」第七节。
// 恢复以后后端做一次体检：完整性检查和外键核对，查出的问题随结果返回。

const bytesOf = (file: string) => {
  try {
    return statSync(file).size;
  } catch {
    return 0;
  }
};

/** 恢复出错时的报错。快照找不到是 NOT_FOUND，快照坏了是 CONFLICT，其余是后端的问题。 */
function restoreFailure(error: RestoreError, log: string) {
  const text = backupCopy.restore;
  switch (error.kind) {
    case "notFound":
      return errorBody("NOT_FOUND", [
        {
          message: renderCopy(text.notFound.message, { name: error.name }),
          hint: renderCopy(text.notFound.hint),
        },
      ]);
    case "corrupt":
      return errorBody("CONFLICT", [
        {
          message: renderCopy(text.corrupt.message, {
            name: error.name,
            count: error.problems.length,
          }),
          hint: renderCopy(text.corrupt.hint),
        },
      ]);
    case "keepFailed":
      return errorBody("INTERNAL", [
        {
          message: renderCopy(text.keepFailed.message, { detail: error.message }),
          hint: renderCopy(text.keepFailed.hint, { log }),
        },
      ]);
    case "restoreFailed":
      return errorBody("INTERNAL", [
        {
          message: renderCopy(text.restoreFailed.message, { detail: error.message }),
          hint: renderCopy(text.restoreFailed.hint, { kept: basename(error.kept), log }),
        },
      ]);
  }
}

export function adminRoutes(deps: AppDeps) {
  const backupsDir = deps.paths.dirs.backups;
  return (
    new Hono()
      /**
       * 请后端退出，命令行在升级以后替换旧的后端时用。
       * 正在做每日快照时返回 BUSY，命令行按 Retry-After 重试，等它做完。
       */
      .post("/admin/shutdown", (c) => {
        if (snapshotRunning(backupsDir)) {
          const text = httpCopy.busy.snapshot;
          const issue = { message: renderCopy(text.message), hint: renderCopy(text.hint) };
          return failure(c, errorBody("BUSY", [issue]));
        }
        deps.shutdown();
        return reply(c, 202, shutdownSchema, { pid: process.pid });
      })
      /** 立即做一份手动快照。ploop backup now 用。 */
      .post("/admin/backup", async (c) => {
        const taken = await deps.backups.snapshotNow();
        if (!taken.ok) return failure(c, errorBody("INTERNAL", [snapshotIssue(taken.error)]));
        const file = taken.value;
        const name = basename(file);
        return reply(c, 201, backupTakenSchema, {
          name,
          when: name.replace(/^manual-|\.db$/gu, ""),
          bytes: bytesOf(file),
        });
      })
      /**
       * 列出四种快照。ploop backup list 用。
       * 备份的警告（今天的快照没做成、Time Machine 不满足）只在这里给命令行，见审查报告 P29。
       */
      .get("/admin/backups", async (c) => {
        const list = listSnapshots(backupsDir);
        const entries = (files: typeof list.daily) =>
          files.map(({ name, file, when }) => ({ name, when, bytes: bytesOf(file) }));
        return reply(
          c,
          200,
          backupListSchema,
          {
            daily: entries(list.daily),
            manual: entries(list.manual),
            preMigration: entries(list.preMigration),
            preRestore: entries(list.preRestore),
          },
          { warnings: await deps.backupWarnings(deps.now()) },
        );
      })
      /** 恢复之前看快照里登记着哪些项目，命令行据此预告会消失的项目。只读。 */
      .get("/admin/restore/preview", queryParams(restoreRequestSchema), (c) => {
        const { snapshot } = c.req.valid("query");
        const result = deps.backups.preview(snapshot);
        if (!result.ok) return failure(c, restoreFailure(result.error, deps.log.file));
        return reply(c, 200, restorePreviewSchema, result.value);
      })
      /** 从快照恢复，恢复以后做一次体检。ploop backup restore 用。 */
      .post("/admin/restore", ...jsonBody(restoreRequestSchema), async (c) => {
        const { snapshot } = c.req.valid("json");
        const result = await deps.process.during("restore", () => deps.backups.restore(snapshot));
        if (!result.ok) return failure(c, restoreFailure(result.error, deps.log.file));
        const { problems, kept } = result.value;
        const [first] = problems;
        const text = backupCopy.restore.problems;
        const warnings =
          first === undefined
            ? []
            : [
                {
                  message: renderCopy(text.message, { count: problems.length, problem: first }),
                  hint: renderCopy(text.hint, { kept: basename(kept) }),
                },
              ];
        return reply(
          c,
          200,
          restoredSchema,
          { ...result.value, snapshot: basename(result.value.snapshot), kept: basename(kept) },
          { warnings },
        );
      })
      /** 删掉没有引用、超过七天的附件。ploop backup gc 用。 */
      .post("/admin/gc", async (c) => {
        const result = await gcBlobs({ db: deps.db, dir: deps.paths.dirs.blobs }, deps.now());
        return reply(c, 200, gcResultSchema, {
          removed: result.removed.length,
          bytes: result.bytes,
          tempFiles: result.tempFiles,
        });
      })
  );
}
