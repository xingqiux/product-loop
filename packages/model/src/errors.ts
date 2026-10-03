import { z } from "zod";

// 错误码、HTTP 状态和命令行的退出码一一对应，见「05 接口」第九节。
// 这里只放数字和对应关系。退出码的含义、错误码的默认说明都在文案表里，见 copy/errors.ts。

/**
 * 命令行的退出码，见「04 命令行」第七节。AI 可以只看退出码决定下一步。
 * 7 和 130 没有对应的错误码：7 是等回复到了时限，130 是被中断。
 */
export const exitCode = {
  ok: 0,
  blocked: 1,
  usage: 2,
  conflict: 3,
  notFound: 4,
  backendDown: 5,
  needsDoctor: 6,
  stillWaiting: 7,
  pageGone: 8,
  interrupted: 130,
} as const;
export type ExitName = keyof typeof exitCode;
export type ExitCode = (typeof exitCode)[ExitName];

/** 错误码表的一行。 */
export type ErrorCodeRow = {
  readonly code: string;
  readonly http: number;
  readonly exit: ExitCode;
  /** 这个错误码的 error 必须写的字段。带 issues 时，每一条也要写。 */
  readonly requires?: "rule" | "hint";
  /** 响应带 Retry-After。客户端照它自动重试，重试超时以后才以 exit 结束。 */
  readonly retryAfter?: true;
};

/**
 * 错误码写成数组，因为错误码全大写，Biome 的命名规则不收这样的对象键。
 * 顺序和「05 接口」第九节的表相同。
 */
export const errorCodes = [
  // 校验规则拦截。error.rule 写规矩的编号，一次返回全部拦截。
  { code: "RULE_BLOCKED", http: 422, exit: exitCode.blocked, requires: "rule" },
  // 请求的格式不对。
  { code: "BAD_REQUEST", http: 400, exit: exitCode.usage },
  // 状态不允许，或修改计数对不上。
  { code: "CONFLICT", http: 409, exit: exitCode.conflict },
  // 对象不存在。
  { code: "NOT_FOUND", http: 404, exit: exitCode.notFound },
  // 后端在迁移或恢复。
  { code: "BUSY", http: 503, exit: exitCode.backendDown, retryAfter: true },
  // 项目停在旧版本的 skill，先体检。
  { code: "NEEDS_DOCTOR", http: 412, exit: exitCode.needsDoctor },
  // 在等的那一页已撤回或已被代替。
  { code: "PAGE_GONE", http: 410, exit: exitCode.pageGone },
  // 客户端版本太低。
  { code: "CLIENT_TOO_OLD", http: 426, exit: exitCode.usage },
  // 后端内部错误。error.hint 写日志的位置。
  { code: "INTERNAL", http: 500, exit: exitCode.backendDown, requires: "hint" },
] as const satisfies readonly ErrorCodeRow[];

export type ErrorCode = (typeof errorCodes)[number]["code"];
export type ErrorCodeInfo<C extends ErrorCode = ErrorCode> = Extract<
  (typeof errorCodes)[number],
  { readonly code: C }
>;

export const errorCodeSchema = z.enum(
  errorCodes.map((row) => row.code) as [ErrorCode, ...ErrorCode[]],
);

const rowByCode: ReadonlyMap<ErrorCode, ErrorCodeInfo> = new Map(
  errorCodes.map((row) => [row.code, row]),
);

/**
 * 按错误码取表里的一行。错误码是字面量时，HTTP 状态和退出码也是字面量，
 * 接口层返回的状态码因此能带着类型传到客户端。
 */
export function errorCodeInfo<C extends ErrorCode>(code: C): ErrorCodeInfo<C> {
  // 表里每个错误码都有一行，测试逐行核对过，所以一定取得到。
  return rowByCode.get(code) as ErrorCodeInfo<C>;
}
