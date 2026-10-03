import {
  type PageSections,
  pagePurpose,
  pageSection,
  pageStatus,
  type WithCardIds,
} from "@product-loop/model";
import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { type BlobHash, blobs } from "./blobs.ts";
import { bareColumn, enumCheck, enumText, isKey } from "./enum.ts";
import { projects } from "./projects.ts";
import { rounds } from "./rounds.ts";

// 页面、卡片索引和原文摘录，字段见「03 数据模型」第二节「页面和回复」「附件和原文摘录」。
// 页面数据在给出信息时校验一次，通过以后整份存下，之后不再修改。
// 页面出错只能撤回再给出一页，旧的一页留着，状态是已撤回。
// 页面数据和后端填的部分都存成 JSON，枚举是英文键。接口按「05 接口」第一节换成中文。

/** 页面里一张截图：页面数据里写的路径，和它在附件库里的哈希。 */
export type PageImageRef = { readonly path: string; readonly hash: BlobHash };

/**
 * 页面：一轮里的一页，要用户点的或只看的。编号是后端生成的全局整数（约定 0001 第 4 条）。
 * 页面数据、截图和后端填的部分给出以后不改。只有状态和撤回的两列会变。
 */
export const pages = sqliteTable(
  "pages",
  {
    id: integer().primaryKey({ autoIncrement: true }),
    /** 项目。和轮次的项目相同，另存一列给「一页在等」的唯一索引用。 */
    projectId: text()
      .notNull()
      .references(() => projects.id),
    roundId: integer()
      .notNull()
      .references(() => rounds.id),
    /** 页序号：这一轮的第几页，从 1 数，撤回的页也占一个序号。 */
    seq: integer().notNull(),
    purpose: enumText(pagePurpose).notNull(),
    /** 页面数据的格式版本，见 model 的 pageFormatVersion。 */
    formatVersion: integer().notNull(),
    /** AI 写的各个区块，解析以后的样子，卡片编号已填好。 */
    sections: text({ mode: "json" }).$type<WithCardIds<PageSections>>().notNull(),
    /** 页面数据引用的截图，按路径在数据里第一次出现的先后。 */
    images: text({ mode: "json" }).$type<readonly PageImageRef[]>().notNull(),
    /** 后端填的部分：页头、窄带、队列看板、位置等。类型见 core/pages/fill.ts。 */
    fill: text({ mode: "json" }).notNull(),
    status: enumText(pageStatus).notNull(),
    presentedAt: integer({ mode: "timestamp_ms" }).notNull(),
    /** 撤回的时间。没撤回的为空。 */
    withdrawnAt: integer({ mode: "timestamp_ms" }),
    /** 撤回的原因，工作台在这一页顶上写出来。撤回时可以不写。 */
    withdrawReason: text(),
    /** 迁移进来的旧页面的网页快照，存在附件库里。新给出的页面为空，见「08 版本与迁移」。 */
    legacySnapshot: text()
      .$type<BlobHash>()
      .references(() => blobs.hash),
  },
  (t) => [
    uniqueIndex("pages_round_seq").on(t.roundId, t.seq),
    // 一个项目同一时间只有一页在等用户点，只看的页不占名额，见「04 命令行」第十节。
    // 给出信息的写事务里先查一遍，这个索引兜底。
    uniqueIndex("pages_one_waiting")
      .on(t.projectId)
      .where(sql`${isKey(t.purpose, "ask")} and ${isKey(t.status, "presented")}`),
    enumCheck(t.purpose, pagePurpose),
    enumCheck(t.status, pageStatus),
    // 撤回的页写撤回的时间，别的页不写。
    check(
      "pages_withdrawn_at",
      sql`(${isKey(t.status, "withdrawn")}) = (${bareColumn(t.withdrawnAt)} is not null)`,
    ),
  ],
);

/**
 * 卡片索引：页面里有卡片编号的每一项一行，见「03 数据模型」第二节。
 * 只是索引，内容以页面数据为准。「这件事出现在哪几页」「这个场景被哪些卡提到」这类查询用它，
 * 不用解析整份页面数据。「这一轮开始时取消的事」由后端摆出，没有卡片编号，不在这里。
 */
export const cards = sqliteTable(
  "cards",
  {
    pageId: integer()
      .notNull()
      .references(() => pages.id),
    /** 在页面数据的哪个区块，例如 asks。 */
    section: enumText(pageSection).notNull(),
    cardId: text().notNull(),
    /** 在页面上的顺序，从 0 数，各个区块连着数。 */
    position: integer().notNull(),
    /** 标题：卡片和更改的 title，场景、规范和先对齐的 name。 */
    title: text().notNull(),
    /** 引用的队列事项，Q12 存成 12，按页面数据里的先后。 */
    queue: text({ mode: "json" }).$type<readonly number[]>().notNull(),
    /** 引用的场景，S3 存成 3：场景清单写的编号，和位置里的场景。 */
    scenes: text({ mode: "json" }).$type<readonly number[]>().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.pageId, t.cardId] }),
    uniqueIndex("cards_page_position").on(t.pageId, t.position),
    enumCheck(t.section, pageSection),
  ],
);

/**
 * 原文摘录：文字来源的一段原文，见「03 数据模型」第二节。给出信息时存下，之后文件再改，
 * 页面上看到的仍是当时的原文。每条文字来源一行，同一段原文被引用两次就存两行。
 */
export const excerpts = sqliteTable(
  "excerpts",
  {
    id: integer().primaryKey({ autoIncrement: true }),
    pageId: integer()
      .notNull()
      .references(() => pages.id),
    /** 这条来源在页面数据里的位置，例如 asks[0].sources[1]。 */
    where: text().notNull(),
    /** 文件路径，相对项目的根目录。 */
    file: text().notNull(),
    startLine: integer().notNull(),
    endLine: integer().notNull(),
    /** 要标出的行号。没写时为空。 */
    mark: text({ mode: "json" }).$type<readonly number[]>(),
    /** 原文：从起始行到结束行，行与行之间用换行连接。 */
    text: text().notNull(),
    /** 摘录时文件的 SHA-256，写成六十四位小写十六进制。 */
    fileHash: text().notNull(),
    createdAt: integer({ mode: "timestamp_ms" }).notNull(),
  },
  (t) => [
    uniqueIndex("excerpts_page_where").on(t.pageId, t.where),
    index("excerpts_file").on(t.file),
    check(
      "excerpts_lines",
      sql`${bareColumn(t.startLine)} >= 1 and ${bareColumn(t.startLine)} <= ${bareColumn(t.endLine)}`,
    ),
  ],
);
