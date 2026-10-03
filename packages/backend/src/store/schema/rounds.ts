import { roundStatus, stage } from "@product-loop/model";
import { foreignKey, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { enumCheck, enumText, notKey } from "./enum.ts";
import { productVersions } from "./projects.ts";

/** 落地轮开始时一个根目录的提交，这一批改动从它算起，见约定 0001 第 12 条。 */
export type BaseCommit = {
  /** 登记过的项目根目录。 */
  readonly root: string;
  /** 这个根目录当时的 HEAD，完整的提交号。 */
  readonly commit: string;
};

/**
 * 轮次：一个阶段里的一轮，字段见「03 数据模型」第二节。
 * 写法 `v2-落地-3` 拆成版本、阶段、轮号三列存，拼写见 model 的 round-label.ts。
 */
export const rounds = sqliteTable(
  "rounds",
  {
    id: integer().primaryKey({ autoIncrement: true }),
    projectId: text().notNull(),
    version: integer().notNull(),
    stage: enumText(stage).notNull(),
    /** 轮号：这一版里这个阶段的第几轮，从 1 数。 */
    seq: integer().notNull(),
    /** 项目内的总序号，只用于排序，不显示给用户。 */
    ordinal: integer().notNull(),
    status: enumText(roundStatus).notNull(),
    startedAt: integer({ mode: "timestamp_ms" }).notNull(),
    closedAt: integer({ mode: "timestamp_ms" }),
    /** 收尾说明。 */
    closeNote: text(),
    /** 迁移前的旧编号，例如 fix-13，只用于展示和查找，可以重名。 */
    legacyId: text(),
    /**
     * 开这一轮的会话，取自 X-Ploop-Session 请求头，见约定 0002 第 12 条。
     * 已有一轮开着时，报错写明是哪个会话开的。取不到会话、迁移进来的轮次为空。
     */
    openedBySession: text(),
    /** 开这一轮的客户端和版本，例如 cli/2.0.0。迁移进来的轮次为空。 */
    openedByClient: text(),
    /** 落地轮开始时各个根目录的提交，按请求里的先后。别的阶段和没交提交的落地轮为空。 */
    baseCommits: text({ mode: "json" }).$type<readonly BaseCommit[]>(),
  },
  (t) => [
    foreignKey({
      columns: [t.projectId, t.version],
      foreignColumns: [productVersions.projectId, productVersions.version],
    }),
    uniqueIndex("rounds_label").on(t.projectId, t.version, t.stage, t.seq),
    uniqueIndex("rounds_ordinal").on(t.projectId, t.ordinal),
    // 一个项目同一时间只有一个开着的轮次，由这个索引保证，见「01 架构」第七节。
    uniqueIndex("rounds_one_open").on(t.projectId).where(notKey(t.status, "closed")),
    enumCheck(t.stage, stage),
    enumCheck(t.status, roundStatus),
  ],
);
