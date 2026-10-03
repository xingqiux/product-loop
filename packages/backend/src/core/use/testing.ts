import { createHash } from "node:crypto";
import {
  type ErrorBody,
  type Result,
  type UseRunOutput,
  useRunOutputSchema,
} from "@product-loop/model";
import { and, eq, isNull, ne } from "drizzle-orm";
import type { z } from "zod";
import { type BlobHash, putBlob } from "../../store/blobs.ts";
import { rounds, scenes } from "../../store/schema/index.ts";
import { type Canvas, encodePng } from "../../store/screen-testing.ts";
import { tempDir } from "../../store/testing.ts";
import { pushRevision } from "../mainline.ts";
import { addProject, addRound, emptyCore, type TestCore } from "../testing.ts";
import { currentVersionRow, nextVersion } from "../versions.ts";
import { ingestUseRun } from "./ingest.ts";

// 使用记录的测试用的东西，只给测试用：登记好的项目、附件库、开着的一轮和交好的主线。

export type UseTestCore = TestCore & {
  /** 附件库的目录。 */
  readonly blobsDir: string;
};

/** 项目 app 的主线：S1 看队列有两步，S2 在窄屏上看有一步。 */
const mainline = [
  "# 主线",
  "",
  "## 场景清单",
  "",
  "### S1 看队列",
  "谁在什么时候用：你，想知道还有哪些事没做时。",
  "1. 点队列 → 看到五列看板。",
  "2. 点一件事 → 右边摆出这件事的详情。",
  "",
  "### S2 在窄屏上看",
  "谁在什么时候用：你，窗口拉窄的时候。",
  "1. 把窗口拉窄 → 左边一栏换成图标。",
  "",
].join("\n");

/** 登记项目 app，交好主线，开着第 1 版的一轮使用。 */
export async function useCore(): Promise<UseTestCore> {
  const core = await emptyCore();
  addProject(core, "/work/app");
  succeed(pushRevision(core.ctx, "app", { text: mainline, baseRevision: null, source: "cache" }));
  const t = { ...core, blobsDir: tempDir("ploop-blobs-") };
  openUseRound(t, 1);
  return t;
}

/** 成功时取出结果，失败时抛出，测试随之失败。 */
export function succeed<T>(result: Result<T, ErrorBody>): T {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

/**
 * 收掉开着的一轮，进到第 version 版，再开一轮使用。
 * 收尾的用例在第 37 步，这里直接改轮次表。
 */
export function openUseRound(t: UseTestCore, version: number): void {
  const { db } = t.ctx;
  db.update(rounds)
    .set({ status: "closed", closedAt: t.ctx.now() })
    .where(and(eq(rounds.projectId, "app"), ne(rounds.status, "closed")))
    .run();
  while (currentVersionRow(db, "app").version < version) {
    succeed(nextVersion(t.ctx, "app", "测试里进到下一版"));
  }
  const seq = db
    .select()
    .from(rounds)
    .where(and(eq(rounds.projectId, "app"), eq(rounds.version, version), eq(rounds.stage, "use")))
    .all().length;
  addRound(t, "app", { version, stage: "use", seq: seq + 1, status: "open" });
}

/** 把一张图编成 PNG 上传，返回哈希。 */
export async function upload(t: UseTestCore, image: Canvas | Uint8Array): Promise<BlobHash> {
  const bytes = image instanceof Uint8Array ? image : encodePng(image);
  const hash = createHash("sha256").update(bytes).digest("hex") as BlobHash;
  const stored = await putBlob({ db: t.ctx.db, dir: t.blobsDir }, bytes, hash, {
    contentType: "image/png",
    source: "test",
  });
  if (!stored.ok) throw new Error(stored.error.kind);
  return hash;
}

/** 按 use-run.json 的写法写一次运行，用共用定义解析，结果换成英文键。 */
export function useRunFile(file: z.input<typeof useRunOutputSchema>): UseRunOutput {
  return useRunOutputSchema.parse(file);
}

/** 覆盖表的快照：两行都有场景用到。 */
const fullCoverage = [
  "| 东西 | 场景 |",
  "| --- | --- |",
  "| 队列看板 | S1 |",
  "| 详情 | S1 |",
].join("\n");

export type UseRunShape = {
  /** 第 2 步断了。 */
  readonly broken?: boolean;
  /** 覆盖表的快照，写 null 就不带。不写用 fullCoverage。 */
  readonly coverage?: string | null;
  /** ploop use run 运行的命令。不写就像 ploop use ingest 收下的，没有命令。 */
  readonly command?: readonly string[];
  /** 这次运行不走的场景编号，主线里这几个场景的步就成了没走到的缺口。S1 一定会走。 */
  readonly skipScenes?: readonly number[];
};

/**
 * 给项目 app 开着的一轮收进一次命令行场景的运行，不带截图。
 * 收尾使用轮的测试用它满足 use.leave。
 */
export function recordUseRun(core: TestCore, shape: UseRunShape = {}): void {
  const second = shape.broken
    ? ({ result: "断了", error: "右边是空的" } as const)
    : ({ result: "通过" } as const);
  // 主线里的每一步都走到：S1 的前两步是这里写的，主线里别的步也都通过。
  const live = core.ctx.db
    .select({ number: scenes.number, steps: scenes.steps })
    .from(scenes)
    .where(and(eq(scenes.projectId, "app"), isNull(scenes.removedInRevision)))
    .all();
  const passed = (step: { step: number; do: string; expect: string }) => ({
    step: step.step,
    do: step.do,
    expect: step.expect,
    result: "通过" as const,
  });
  const first = live.find((row) => row.number === 1)?.steps ?? [];
  const output = useRunFile({
    schemaVersion: 1,
    scenes: [
      {
        scene: "S1",
        steps: [
          { step: 1, do: "点队列", expect: "五列看板", result: "通过" },
          { step: 2, do: "点一件事", expect: "右边摆出详情", ...second },
          ...first.filter((step) => step.step > 2).map(passed),
        ],
      },
      ...live
        .filter((row) => row.number !== 1 && !(shape.skipScenes ?? []).includes(row.number))
        .map((row) => ({ scene: `S${row.number}`, steps: row.steps.map(passed) })),
    ],
  });
  const coverage = shape.coverage === undefined ? fullCoverage : shape.coverage;
  succeed(
    ingestUseRun(core.ctx, tempDir("ploop-blobs-"), "app", {
      output,
      screenshots: [],
      ...(coverage === null ? {} : { coverage }),
      ...(shape.command === undefined ? {} : { command: shape.command }),
    }),
  );
}
