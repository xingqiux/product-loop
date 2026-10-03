import {
  draftRevisionsQuerySchema,
  draftRevisionsSchema,
  draftSaveSchema,
  draftViewSchema,
  type ErrorBody,
  err,
  errorBody,
  ok,
  type Result,
  renderCopy,
} from "@product-loop/model";
import { Hono } from "hono";
import { httpCopy } from "../../copy/http.ts";
import {
  listDraftRevisions,
  readDraft,
  restoreDraftRevision,
  saveDraft,
} from "../../core/drafts.ts";
import { writeContext } from "../context.ts";
import type { AppDeps } from "../deps.ts";
import { failure, reply } from "../respond.ts";
import { jsonBody, queryParams } from "../validate.ts";
import { pageIdOf } from "./pages.ts";

// 草稿的接口，见「05 接口」第四节的「页面」和 core/drafts.ts。
// 工作台每点一下交整份草稿，旧版本由后端按规则存下。

/** 旧版本的编号：从 1 起的整数。 */
function revisionIdOf(text: string): Result<number, ErrorBody<"BAD_REQUEST">> {
  const id = /^[1-9]\d*$/u.test(text) ? Number(text) : Number.NaN;
  if (Number.isSafeInteger(id)) return ok(id);
  const copy = httpCopy.number.draftRevision;
  const issue = { message: renderCopy(copy.message, { text }), hint: renderCopy(copy.hint) };
  return err(errorBody("BAD_REQUEST", [{ ...issue, where: text }]));
}

export function draftRoutes(deps: AppDeps) {
  return (
    new Hono()
      /** 一页的草稿，还没点过时是空的。 */
      .get("/projects/:pid/pages/:id/draft", (c) => {
        const pageId = pageIdOf(c.req.param("id"));
        if (!pageId.ok) return failure(c, pageId.error);
        const result = readDraft(deps.db, c.req.param("pid"), pageId.value);
        if (!result.ok) return failure(c, result.error);
        return reply(c, 200, draftViewSchema, result.value);
      })
      /** 存整份草稿。 */
      .put("/projects/:pid/pages/:id/draft", ...jsonBody(draftSaveSchema), (c) => {
        const pageId = pageIdOf(c.req.param("id"));
        if (!pageId.ok) return failure(c, pageId.error);
        const { entries } = c.req.valid("json");
        const result = saveDraft(writeContext(c, deps), c.req.param("pid"), pageId.value, entries);
        if (!result.ok) return failure(c, result.error);
        return reply(c, 200, draftViewSchema, result.value);
      })
      /** 草稿的旧版本，新的在前。 */
      .get(
        "/projects/:pid/pages/:id/draft/revisions",
        queryParams(draftRevisionsQuerySchema),
        (c) => {
          const pageId = pageIdOf(c.req.param("id"));
          if (!pageId.ok) return failure(c, pageId.error);
          const { field } = c.req.valid("query");
          const result = listDraftRevisions(deps.db, c.req.param("pid"), pageId.value, field);
          if (!result.ok) return failure(c, result.error);
          return reply(c, 200, draftRevisionsSchema, result.value);
        },
      )
      /** 把一份旧版本放回输入框，放回之前先存下现在的文字。 */
      .post("/projects/:pid/pages/:id/draft/revisions/:rev/restore", (c) => {
        const pageId = pageIdOf(c.req.param("id"));
        if (!pageId.ok) return failure(c, pageId.error);
        const rev = revisionIdOf(c.req.param("rev"));
        if (!rev.ok) return failure(c, rev.error);
        const ctx = writeContext(c, deps);
        const result = restoreDraftRevision(ctx, c.req.param("pid"), pageId.value, rev.value);
        if (!result.ok) return failure(c, result.error);
        return reply(c, 200, draftViewSchema, result.value);
      })
  );
}
