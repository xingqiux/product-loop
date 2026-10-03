import {
  describeMainlineProblems,
  err,
  errorBody,
  type Issue,
  type MainlineParse,
  mainlineDiffQuerySchema,
  mainlineDiffSchema,
  mainlinePartChangesSchema,
  mainlinePushedSchema,
  mainlinePushSchema,
  mainlineRevisionListSchema,
  mainlineRevisionSchema,
  mainlineSchema,
  mainlineStatusSchema,
  ok,
  type Result,
  renderCopy,
  sceneListSchema,
  sceneQuerySchema,
} from "@product-loop/model";
import { Hono } from "hono";
import { httpCopy } from "../../copy/http.ts";
import {
  diffRevisions,
  getRevision,
  latestRevision,
  listRevisions,
  listScenes,
  type MainlineRevision,
  mainlineStatus,
  partChanges,
  pushRevision,
} from "../../core/mainline.ts";
import { writeContext } from "../context.ts";
import type { AppDeps } from "../deps.ts";
import { failure, reply, respond } from "../respond.ts";
import { jsonBody, queryParams } from "../validate.ts";

// 主线的接口，见「05 接口」第四节。业务规则都在内核里，这里只解析请求、调用用例。
// 交一版时基准不是最新的一版，内核返回 CONFLICT，报错写明最新的是第几版。
// 来源一律记成项目缓存，处理回复和迁移时由各自的用例交主线，不经这个接口。
// 解析时查出的问题写成外壳的 warnings，位置写主线.md 的行号，数据里的解析结果不再带它们。
// 只有最新的一版报问题，因为命令同步以后，项目缓存的主线.md 就是最新的一版。
// 有三个是 05 里没写的：取某一版、比较两版、列出场景。
// 前两个给工作台切换和比较版本用，比较也给 ploop mainline diff 用。列出场景给按编号引用场景的地方用。

/** 项目缓存里主线的文件名，写进警告的位置。 */
const mainlineFile = "主线.md";

/** 解析时查出的问题，写成警告。 */
function problemWarnings(parsed: MainlineParse): Issue[] {
  return describeMainlineProblems(parsed.problems, mainlineFile);
}

/** 接口上的一版：解析结果不带查出的问题。 */
function withoutProblems(revision: MainlineRevision) {
  const { problems: _problems, ...parsed } = revision.parsed;
  return { ...revision, parsed };
}

/**
 * 版本号：从 1 起的整数，不补 0。写得不对时返回一条问题。
 * where 写查询参数的名字，路径里的版本号写原文。
 */
function revisionOf(text: string, where: string): Result<number, Issue> {
  const revision = /^[1-9]\d*$/u.test(text) ? Number(text) : Number.NaN;
  if (Number.isSafeInteger(revision)) return ok(revision);
  const copy = httpCopy.number.revision;
  return err({ message: renderCopy(copy.message, { text }), hint: renderCopy(copy.hint), where });
}

/** 一到多条问题拼成 BAD_REQUEST。 */
function badRequest(first: Issue, ...rest: Issue[]) {
  return errorBody("BAD_REQUEST", [first, ...rest]);
}

export function mainlineRoutes(deps: AppDeps) {
  return (
    new Hono()
      /** 最新的主线：全文、解析结果和缺哪几样。ploop mainline show、pull 和工作台用。 */
      .get("/projects/:pid/mainline", (c) => {
        const pid = c.req.param("pid");
        const latest = latestRevision(deps.db, pid);
        if (!latest.ok) return failure(c, latest.error);
        const revision = latest.value;
        const data = {
          latest: revision === null ? null : withoutProblems(revision),
          status: mainlineStatus(deps.db, pid),
        };
        const warnings = revision === null ? [] : problemWarnings(revision.parsed);
        return reply(c, 200, mainlineSchema, data, { warnings });
      })
      /**
       * 交一版，带基准版本号。ploop mainline push 和每条命令开始时的同步用。
       * 建了新的一版返回 201，全文和最新的一版相同时什么都不写，返回 200。
       */
      .post("/projects/:pid/mainline/revisions", ...jsonBody(mainlinePushSchema), (c) => {
        const input = { ...c.req.valid("json"), source: "cache" } as const;
        const result = pushRevision(writeContext(c, deps), c.req.param("pid"), input);
        if (!result.ok) return failure(c, result.error);
        const { revision, ...pushed } = result.value;
        const data = { ...pushed, revision: withoutProblems(revision) };
        const extras = { warnings: problemWarnings(revision.parsed) };
        return pushed.created
          ? reply(c, 201, mainlinePushedSchema, data, extras)
          : reply(c, 200, mainlinePushedSchema, data, extras);
      })
      /** 历次版本，不带全文。ploop mainline history 和工作台用。 */
      .get("/projects/:pid/mainline/revisions", (c) =>
        respond(c, listRevisions(deps.db, c.req.param("pid")), 200, mainlineRevisionListSchema),
      )
      /** 某一版的全文和解析结果。工作台切到某个历史版本时用。 */
      .get("/projects/:pid/mainline/revisions/:rev", (c) => {
        const text = c.req.param("rev");
        const rev = revisionOf(text, text);
        if (!rev.ok) return failure(c, badRequest(rev.error));
        const result = getRevision(deps.db, c.req.param("pid"), rev.value);
        if (!result.ok) return failure(c, result.error);
        return reply(c, 200, mainlineRevisionSchema, withoutProblems(result.value));
      })
      /** 任意两版的逐行比较。ploop mainline diff 和工作台的主线页用。 */
      .get("/projects/:pid/mainline/diff", queryParams(mainlineDiffQuerySchema), (c) => {
        const query = c.req.valid("query");
        const from = revisionOf(query.from, "from");
        const to = revisionOf(query.to, "to");
        if (!from.ok) return failure(c, badRequest(from.error, ...(to.ok ? [] : [to.error])));
        if (!to.ok) return failure(c, badRequest(to.error));
        const result = diffRevisions(deps.db, c.req.param("pid"), from.value, to.value);
        return respond(c, result, 200, mainlineDiffSchema);
      })
      /** 十样各是哪一版、哪一轮最近改的。工作台主线页的目录用。 */
      .get("/projects/:pid/mainline/parts", (c) =>
        respond(c, partChanges(deps.db, c.req.param("pid")), 200, mainlinePartChangesSchema),
      )
      /** 项目的场景，按编号排。写 ?includeRemoved=true 连删掉的一起列。 */
      .get("/projects/:pid/mainline/scenes", queryParams(sceneQuerySchema), (c) => {
        const { includeRemoved } = c.req.valid("query");
        const result = listScenes(deps.db, c.req.param("pid"), { includeRemoved });
        return respond(c, result, 200, sceneListSchema);
      })
      /** 十样在不在、场景的写法、设计规范的十二样。ploop mainline check 用。 */
      .get("/projects/:pid/mainline/check", (c) => {
        const pid = c.req.param("pid");
        const latest = latestRevision(deps.db, pid);
        if (!latest.ok) return failure(c, latest.error);
        const warnings = latest.value === null ? [] : problemWarnings(latest.value.parsed);
        return reply(c, 200, mainlineStatusSchema, mainlineStatus(deps.db, pid), { warnings });
      })
  );
}
