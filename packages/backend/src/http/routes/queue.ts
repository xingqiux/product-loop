import {
  type ErrorBody,
  err,
  errorBody,
  ifMatchHeader,
  ok,
  queueBoardSchema,
  queueDetailSchema,
  queueItemCreateSchema,
  queueItemSchema,
  queueItemUpdateSchema,
  queueListSchema,
  queueQuerySchema,
  queueTransitionSchema,
  type Result,
  renderCopy,
} from "@product-loop/model";
import { Hono } from "hono";
import { httpCopy } from "../../copy/http.ts";
import { projectWritingSpec } from "../../core/mainline.ts";
import { queueBoard } from "../../core/pages/fill.ts";
import {
  addQueueItem,
  editQueueItem,
  getQueueItem,
  listQueueItems,
  reopenQueueItem,
  transitionQueueItem,
} from "../../core/queue.ts";
import { writeContext } from "../context.ts";
import type { AppDeps } from "../deps.ts";
import { failure, reply, respond } from "../respond.ts";
import { jsonBody, queryParams } from "../validate.ts";

// 队列的接口，见「05 接口」第四节。按约定 0001 第 4 条挂在 /projects/:pid 下面，业务规则都在内核里。
// 放进和修改时，写作校验带上项目主线的「写作规范」一节，见「07 校验」第五节。
// 写作校验的警告放进外壳的 warnings。
// 修改要带 If-Match，写这件事的修改计数，对不上返回 CONFLICT，见「05 接口」第三节。
// 改状态的接口写待办就是改回待办，等待和已取消的事都能改回。处理回复时的捞回另有两个条件，由用例算出。

/** If-Match 写修改计数，例如 3。也收加了引号的 "3"，这是 HTTP 里 ETag 的写法。 */
const editCountPattern = /^(?:(0|[1-9]\d*)|"(0|[1-9]\d*)")$/u;

/** 取 If-Match 写的修改计数。没带或写得不对时返回 BAD_REQUEST，id 是要改的那件事。 */
function editCountOf(
  value: string | undefined,
  id: string,
): Result<number, ErrorBody<"BAD_REQUEST">> {
  const match = editCountPattern.exec(value?.trim() ?? "");
  const count = Number(match?.[1] ?? match?.[2]);
  if (Number.isSafeInteger(count)) return ok(count);
  const text = httpCopy.ifMatch;
  const message =
    value === undefined ? renderCopy(text.missing, { id }) : renderCopy(text.invalid, { value });
  const hint = renderCopy(text.hint, { id });
  return err(errorBody("BAD_REQUEST", [{ message, hint, where: ifMatchHeader }]));
}

export function queueRoutes(deps: AppDeps) {
  return (
    new Hono()
      /** 队列事项，按编号排，可按阶段和状态筛选。ploop queue list 和工作台的队列看板用。 */
      .get("/projects/:pid/queue", queryParams(queueQuerySchema), (c) => {
        const { stage, status } = c.req.valid("query");
        const filter = { stages: stage, statuses: status };
        const result = listQueueItems(deps.db, c.req.param("pid"), filter);
        return respond(c, result, 200, queueListSchema);
      })
      /** 放进一件，编号从 Q1 起连续编。ploop queue add 用。 */
      .post("/projects/:pid/queue", ...jsonBody(queueItemCreateSchema), (c) => {
        const pid = c.req.param("pid");
        const writing = { project: projectWritingSpec(deps.db, pid) };
        const result = addQueueItem(writeContext(c, deps), pid, c.req.valid("json"), writing);
        if (!result.ok) return failure(c, result.error);
        const { item, warnings } = result.value;
        return reply(c, 201, queueItemSchema, item, { warnings });
      })
      /** 一件事的全部字段和状态变化。ploop queue show 和看板上的展示卡片用。 */
      /** 现在的看板：在等的放上面，其余按阶段分五列，停了七天的标出来。工作台的队列页用。 */
      .get("/projects/:pid/queue/board", (c) => {
        const result = queueBoard(deps.db, c.req.param("pid"), deps.now());
        return respond(c, result, 200, queueBoardSchema);
      })
      .get("/projects/:pid/queue/:qid", (c) => {
        const result = getQueueItem(deps.db, c.req.param("pid"), c.req.param("qid"));
        return respond(c, result, 200, queueDetailSchema);
      })
      /** 改内容、验收标准、子项或来源，带 If-Match。ploop queue edit 用。 */
      .patch("/projects/:pid/queue/:qid", ...jsonBody(queueItemUpdateSchema), (c) => {
        const pid = c.req.param("pid");
        const qid = c.req.param("qid");
        const ifMatch = editCountOf(c.req.header(ifMatchHeader), qid);
        if (!ifMatch.ok) return failure(c, ifMatch.error);
        const ctx = writeContext(c, deps);
        const writing = { project: projectWritingSpec(deps.db, pid) };
        const result = editQueueItem(ctx, pid, qid, ifMatch.value, c.req.valid("json"), writing);
        if (!result.ok) return failure(c, result.error);
        const { item, warnings } = result.value;
        return reply(c, 200, queueItemSchema, item, { warnings });
      })
      /** 改成等待、已完成、已取消，或者回到待办。ploop queue wait、done、drop 用。 */
      .post("/projects/:pid/queue/:qid/transitions", ...jsonBody(queueTransitionSchema), (c) => {
        const change = c.req.valid("json");
        const pid = c.req.param("pid");
        const qid = c.req.param("qid");
        const ctx = writeContext(c, deps);
        // 改回待办是明确的要求，等待和已取消的事都能改回，见 reopenQueueItem。
        const result =
          change.to === "todo"
            ? reopenQueueItem(ctx, pid, qid, change.note)
            : transitionQueueItem(ctx, pid, qid, change);
        return respond(c, result, 200, queueItemSchema);
      })
  );
}
