import { z } from "zod";
import { renderCopy } from "./copy/define.ts";
import { envelopeCopy } from "./copy/errors.ts";
import { type ErrorCode, type ErrorCodeRow, errorCodeInfo, errorCodeSchema } from "./errors.ts";

// 响应的外壳，见「05 接口」第一节：成功时 {ok, data, warnings, next}，失败时 {ok, error}。
// 命令行 --json 输出同一个外壳，外面加上格式版本和种类，见「04 命令行」第五节。
// 外壳都是严格的：多出不认识的字段就拒绝，所以 ok 为 true 时带着 error 也会被拒绝。

/** 一条拦截或警告：什么不对、在哪里、怎么改，以及规矩的编号。 */
export type Issue = {
  /** 规矩的编号，例如 card.source.visual。每条拦截都要写。 */
  readonly rule?: string;
  /** 什么不对。 */
  readonly message: string;
  /** 怎么改：能直接执行的命令，或者要改的字段和取值。 */
  readonly hint?: string;
  /** 在哪里：文件和字段的路径，或者轮次。 */
  readonly where?: string;
};

const issueShape = {
  rule: z.string().min(1).optional(),
  message: z.string().min(1),
  hint: z.string().min(1).optional(),
  where: z.string().min(1).optional(),
};
const issueFields = ["rule", "message", "hint", "where"] as const;

export const issueSchema: z.ZodType<Issue> = z.strictObject(issueShape);

/**
 * 失败时的 error。一次要报出全部拦截，所以另有 issues：顶层写第一条，
 * issues 写全部，total 写总条数（第一期约定第 5 条）。只有一条时可以不写 issues 和 total。
 */
export type ErrorBody<C extends ErrorCode = ErrorCode> = Issue & {
  readonly code: C;
  readonly issues?: readonly Issue[];
  readonly total?: number;
};

export const errorBodySchema: z.ZodType<ErrorBody> = z
  .strictObject({
    code: errorCodeSchema,
    ...issueShape,
    issues: z.array(issueSchema).min(1).optional(),
    total: z.int().min(1).optional(),
  })
  .superRefine((body, ctx) => {
    const { requires }: ErrorCodeRow = errorCodeInfo(body.code);
    if (requires !== undefined) {
      const message = renderCopy(envelopeCopy.requires, { code: body.code, field: requires });
      if (body[requires] === undefined) ctx.addIssue({ code: "custom", path: [requires], message });
      body.issues?.forEach((issue, i) => {
        if (issue[requires] === undefined) {
          ctx.addIssue({ code: "custom", path: ["issues", i, requires], message });
        }
      });
    }
    const { issues, total } = body;
    if (issues === undefined || total === undefined) {
      if (issues !== undefined || total !== undefined) {
        const path = [issues === undefined ? "total" : "issues"];
        ctx.addIssue({ code: "custom", path, message: renderCopy(envelopeCopy.issuesWithTotal) });
      }
      return;
    }
    if (total !== issues.length) {
      const message = renderCopy(envelopeCopy.total, { total, count: issues.length });
      ctx.addIssue({ code: "custom", path: ["total"], message });
    }
    const [first] = issues;
    for (const field of issueFields) {
      if (first !== undefined && body[field] !== first[field]) {
        const message = renderCopy(envelopeCopy.firstIssue, { field });
        ctx.addIssue({ code: "custom", path: [field], message });
      }
    }
  });

export type ApiOk<D = unknown> = {
  readonly ok: true;
  readonly data: D;
  readonly warnings: readonly Issue[];
  /** 下一步：完整的命令或动作。 */
  readonly next: readonly string[];
};
export type ApiErr<C extends ErrorCode = ErrorCode> = {
  readonly ok: false;
  readonly error: ErrorBody<C>;
};
export type ApiEnvelope<D = unknown, C extends ErrorCode = ErrorCode> = ApiOk<D> | ApiErr<C>;

const okShape = {
  ok: z.literal(true),
  data: z.unknown(),
  warnings: z.array(issueSchema),
  next: z.array(z.string().min(1)),
};
const errShape = { ok: z.literal(false), error: errorBodySchema };

export const apiEnvelopeSchema: z.ZodType<ApiEnvelope> = z.discriminatedUnion("ok", [
  z.strictObject(okShape),
  z.strictObject(errShape),
]);

/** 命令行 --json 输出的格式版本。外壳的形状变了才加一。 */
export const cliSchemaVersion = 1;

/** 种类写成 round.started 这样，小驼峰的几段用点连起来。失败时一律是 error。 */
const kindSchema = z.string().regex(/^[a-z][a-zA-Z]*(?:\.[a-z][a-zA-Z]*)*$/u);

export type CliEnvelope<D = unknown, C extends ErrorCode = ErrorCode> =
  | ({ readonly schemaVersion: typeof cliSchemaVersion; readonly kind: string } & ApiOk<D>)
  | ({ readonly schemaVersion: typeof cliSchemaVersion; readonly kind: "error" } & ApiErr<C>);

export const cliEnvelopeSchema: z.ZodType<CliEnvelope> = z.discriminatedUnion("ok", [
  z.strictObject({ schemaVersion: z.literal(cliSchemaVersion), kind: kindSchema, ...okShape }),
  z.strictObject({
    schemaVersion: z.literal(cliSchemaVersion),
    kind: z.literal("error"),
    ...errShape,
  }),
]);

/** 命令行把接口的响应原样输出，外面加上格式版本和种类。 */
export function toCliEnvelope<D, C extends ErrorCode>(
  kind: string,
  envelope: ApiEnvelope<D, C>,
): CliEnvelope<D, C> {
  return envelope.ok
    ? { schemaVersion: cliSchemaVersion, kind, ...envelope }
    : { schemaVersion: cliSchemaVersion, kind: "error", ...envelope };
}

/** 只取一条问题的四个字段，没写的不带。 */
function pickIssue({ rule, message, hint, where }: Issue): Issue {
  return {
    ...(rule === undefined ? {} : { rule }),
    message,
    ...(hint === undefined ? {} : { hint }),
    ...(where === undefined ? {} : { where }),
  };
}

/** 由一到多条问题拼出 error：顶层写第一条，多于一条时另写全部和总条数。 */
export function errorBody<C extends ErrorCode>(
  code: C,
  issues: readonly [Issue, ...Issue[]],
): ErrorBody<C> {
  const top = { code, ...pickIssue(issues[0]) };
  return issues.length === 1
    ? top
    : { ...top, issues: issues.map(pickIssue), total: issues.length };
}

/** error 里的全部问题：写了 issues 就是 issues，没写就是顶层那一条。 */
export function issuesOf(error: ErrorBody): readonly Issue[] {
  return error.issues ?? [pickIssue(error)];
}
