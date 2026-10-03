import { z } from "zod";

// 事件流：GET /events，见「05 接口」第五节。
// 事件表里记的种类写成「对象.动作」，事件流按前缀把它们归到下面的事件，见约定 0002 第 9 条。
// 工作台只按事件名决定让哪些查询重取，所以事件的内容很小。
// 「05 接口」第五节的表以外，另有四个事件给工作台的项目页、验收页和使用区块用：
// 版本、落地记录、使用记录、项目本身的变化。

/** 事件流里的事件名。 */
export const streamEventNames = [
  "round.started",
  "round.closed",
  "page.presented",
  "page.withdrawn",
  "draft.saved",
  "submission.created",
  "reply.received",
  "line.handled",
  "queue.changed",
  "decision.changed",
  "mainline.changed",
  "issue.changed",
  "version.changed",
  "land.changed",
  "use.changed",
  "project.changed",
] as const;

export type StreamEventName = (typeof streamEventNames)[number];

const exact: ReadonlySet<string> = new Set(streamEventNames);

/** 按前缀归类的几种。前缀是种类里「.」前面的对象名。 */
const byObject: Readonly<Record<string, StreamEventName>> = {
  queue: "queue.changed",
  decision: "decision.changed",
  mainline: "mainline.changed",
  skillIssue: "issue.changed",
  version: "version.changed",
  land: "land.changed",
  useRun: "use.changed",
  project: "project.changed",
  root: "project.changed",
  legacy: "project.changed",
};

/** 事件表里的一个种类归到事件流的哪个事件。认不出的返回 undefined，不发。 */
export function streamEventOf(kind: string): StreamEventName | undefined {
  if (exact.has(kind)) return kind as StreamEventName;
  const [object] = kind.split(".");
  return object === undefined ? undefined : byObject[object];
}

/** 订阅事件流：可以只订阅一个项目。 */
export const eventsQuerySchema = z.strictObject({ project: z.string().min(1).optional() });

/** 事件流里一条事件的内容，写在 data 里。事件名写在 event，编号写在 id。 */
export const streamEventSchema = z.strictObject({
  /** 事件表里的种类，例如 decision.voided。 */
  kind: z.string(),
  project: z.string(),
  /** 改的是哪一类对象，用术语对照表里的英文名。 */
  objectType: z.string(),
  objectId: z.string(),
  at: z.iso.datetime({ offset: true }),
});

export type StreamEvent = z.infer<typeof streamEventSchema>;
