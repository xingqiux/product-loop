import { z } from "zod";
import { type QueueStatus, queueStatus, stage } from "../names.ts";
import { queueEventReadSchema, queueItemSchema } from "../queue.ts";

// 队列的接口：请求和响应的定义，路径见「05 接口」第四节，按约定 0001 第 4 条挂在 /projects/:pid 下面。
// 放进一件用 queue.ts 的 queueItemCreateSchema，修改用 queueItemUpdateSchema，
// 一件事和它的状态变化用 queueItemSchema、queueEventReadSchema。这里补上其余几样。
// 枚举在接口上写中文，请求经 codec 解码成英文键，响应由后端编码回中文，见约定 0002 第 1 条。

/**
 * 查询参数里的一个或几个取值，写几个就把参数写几次，例如 ?stage=构思&stage=落地。
 * Hono 把只写一次的参数交成文字，写了几次的交成数组，这里都换成数组。
 */
function oneOrMore<T extends z.ZodType<unknown, string>>(item: T) {
  return z
    .union([z.string(), z.array(z.string())])
    .transform((value) => (typeof value === "string" ? [value] : value))
    .pipe(z.array(item));
}

/** GET /projects/:pid/queue 的查询参数：按阶段和状态筛选，不写就不按它筛。 */
export const queueQuerySchema = z.strictObject({
  stage: oneOrMore(stage.codec).optional(),
  status: oneOrMore(queueStatus.codec).optional(),
});

/** 队列事项，按编号排：GET /projects/:pid/queue，ploop queue list 和工作台的队列看板用。 */
export const queueListSchema = z.array(queueItemSchema).readonly();

/** 一件事的全部字段和状态变化，变化按先后排：GET /projects/:pid/queue/:qid，ploop queue show 用。 */
export const queueDetailSchema = z.strictObject({
  item: queueItemSchema,
  events: z.array(queueEventReadSchema).readonly(),
  /** 出现在哪几轮的哪几张卡上，按给出的先后。队列看板的展示卡片用。 */
  appearances: z
    .array(
      z.strictObject({
        round: z.string(),
        page: z.int().min(1),
        card: z.string(),
        title: z.string(),
      }),
    )
    .readonly(),
});

/** 改成的状态：接口上写中文，解码以后是英文键。写成函数，状态的键拼错时类型检查报错。 */
function toStatus<S extends QueueStatus>(key: S) {
  const label = queueStatus.label(key);
  return z.codec(z.literal(label), z.literal(key), { decode: () => key, encode: () => label });
}

/**
 * 改状态：POST /projects/:pid/queue/:qid/transitions，ploop queue wait、done、drop 用。
 * 等待写依赖，已完成写证据，已取消写原因，回到待办可以写一句说明。只写了空白的由内核报。
 * 改成进行中只在开始一轮时拿出来，所以不收。
 * 捞回已取消的事要看两样：是不是这一轮开始时取消的，用户有没有点名。
 * 这两样由处理回复的用例算出，不从请求里取。所以这个请求捞不回已取消的事，状态图照常拦截。
 */
export const queueTransitionSchema = z.discriminatedUnion("to", [
  z.strictObject({ to: toStatus("waiting"), dependsOn: z.string() }),
  z.strictObject({ to: toStatus("done"), evidence: z.string() }),
  z.strictObject({ to: toStatus("dropped"), reason: z.string() }),
  z.strictObject({ to: toStatus("todo"), note: z.string().optional() }),
]);
