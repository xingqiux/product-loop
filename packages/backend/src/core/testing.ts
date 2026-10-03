import {
  type DesignSpecItem,
  designSpecItem,
  type MainlinePart,
  mainlinePart,
  type RoundStatus,
  type Stage,
} from "@product-loop/model";
import type Database from "better-sqlite3";
import { count, eq } from "drizzle-orm";
import { projects, rounds } from "../store/schema/index.ts";
import { openTempDatabase, tempHome } from "../store/testing.ts";
import { createNotifier, type StoredEvent } from "./events.ts";
import { mainlineStatus, pushRevision } from "./mainline.ts";
import {
  type ProjectView,
  type RegisterProjectInput,
  type ReservedDirs,
  registerProject,
} from "./projects.ts";
import type { WriteContext } from "./tx.ts";

// 内核测试用的写请求上下文，只给测试用。
// 数据库是临时的，时钟是假的，订阅者收到的事件按顺序记下。

/** 假时钟开始的时间。 */
export const startAt = new Date("2026-09-28T08:00:00Z");

/** 测试数据库里登记好的项目。 */
export const projectId = "demo";

export type TestCore = {
  /** 执行者是命令行，带着会话的标识，不带请求编号。 */
  readonly ctx: WriteContext;
  readonly sqlite: Database.Database;
  /** 订阅者按顺序收到的事件。 */
  readonly received: StoredEvent[];
  /** 订阅者抛出的错误。 */
  readonly subscriberErrors: unknown[];
  /** 把假时钟拨到某个时间。 */
  setNow(at: Date): void;
};

/** 打开临时数据库，登记一个项目，再订阅提交以后的通知。 */
export async function tempCore(): Promise<TestCore> {
  const core = await emptyCore();
  core.ctx.db
    .insert(projects)
    .values({ id: projectId, name: "演示", repoKind: "own", createdAt: startAt })
    .run();
  return core;
}

/** 打开临时数据库，订阅提交以后的通知，不登记项目。项目由测试经用例登记。 */
export async function emptyCore(): Promise<TestCore> {
  const { db, sqlite } = await openTempDatabase(tempHome());
  let now = startAt;
  const subscriberErrors: unknown[] = [];
  const notifier = createNotifier((error) => subscriberErrors.push(error));
  const received: StoredEvent[] = [];
  notifier.subscribe((event) => received.push(event));
  const actor = { client: "cli/2.0.0", session: "session-1" };
  const ctx: WriteContext = { db, notifier, now: () => now, actor };
  const setNow = (at: Date) => {
    now = at;
  };
  return { ctx, sqlite, received, subscriberErrors, setNow };
}

/** 测试里的家目录和集中存储。都是虚构的路径，内核不读文件系统。 */
export const reservedDirs: ReservedDirs = {
  userHome: "/Users/someone",
  home: "/Users/someone/.product-loop",
};

/** 经用例登记一个项目，仓库默认是自己的。登记失败时抛出，测试随之失败。 */
export function addProject(
  core: TestCore,
  root: string,
  input: Partial<RegisterProjectInput> = {},
): ProjectView {
  const result = registerProject(core.ctx, reservedDirs, { root, repoKind: "own", ...input });
  if (!result.ok) throw new Error(result.error.message);
  return result.value.project;
}

/** 测试里写进轮次表的一轮。没写状态时是已收尾。 */
export type TestRound = {
  readonly version: number;
  readonly stage: Stage;
  readonly seq: number;
  readonly status?: RoundStatus;
};

/**
 * 直接往轮次表里写一轮，开始时间是假时钟的现在，总序号接着这个项目已有的往下编。
 * 测试用它直接摆出各种状态的轮次，不经过开始一轮的用例。
 */
export function addRound(core: TestCore, project: string, round: TestRound): void {
  const { db } = core.ctx;
  const existing =
    db.select({ n: count() }).from(rounds).where(eq(rounds.projectId, project)).get()?.n ?? 0;
  const status = round.status ?? "closed";
  const at = core.ctx.now();
  db.insert(rounds)
    .values({
      projectId: project,
      version: round.version,
      stage: round.stage,
      seq: round.seq,
      ordinal: existing + 1,
      status,
      startedAt: at,
      closedAt: status === "closed" ? at : null,
    })
    .run();
}

/**
 * 主线全文：十个部分按顺序各写一个二级标题，skip 里的不写。
 * 设计规范一节写 spec 里的几样，每样写「无」和原因。
 */
export function mainlineText(
  skip: readonly MainlinePart[] = [],
  spec: readonly DesignSpecItem[] = designSpecItem.keys,
): string {
  const body = (part: MainlinePart): string[] => {
    switch (part) {
      case "scenes":
        return [
          "### 看所有项目停在哪",
          "谁在什么时候用：你，每天打开工作台的第一眼。",
          "1. 打开工作台 → 看到每个项目停在哪一轮。",
        ];
      case "designSpec":
        return spec.flatMap((item) => [
          `### ${designSpecItem.label(item)}`,
          "无，这是命令行产品。",
        ]);
      default:
        return ["这一样已经写好。"];
    }
  };
  const parts = mainlinePart.keys.filter((part) => !skip.includes(part));
  return [
    "# 主线",
    "",
    ...parts.flatMap((part) => [`## ${mainlinePart.label(part)}`, ...body(part), ""]),
  ].join("\n");
}

/** 交一版主线，基准是最新的一版。项目是 app。 */
export function pushMainline(core: TestCore, text: string): void {
  const baseRevision = mainlineStatus(core.ctx.db, "app").revision;
  const pushed = pushRevision(core.ctx, "app", { text, baseRevision, source: "cache" });
  if (!pushed.ok) throw new Error(pushed.error.message);
}
