import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type Api,
  type CallError,
  type CallOptions,
  type DataOf,
  isUnreachable,
  type Reply,
} from "@product-loop/client";
import {
  type BackendFiles,
  backendFiles,
  createNodeClient,
  type EnsureFailure,
  type EnsureOptions,
  failureIssue,
  isEnsureFailure,
} from "@product-loop/client/node";
import {
  buildNumber,
  type ErrorBody,
  err,
  errorBody,
  ok,
  type Result,
  renderCopy,
  resolveHome,
} from "@product-loop/model";
import { backendCopy } from "./copy/backend.ts";

// 命令行和后端之间的连接：集中存储在哪里、后端的入口是哪个文件、构建号，
// 以及调用接口时失败的几种写成报错，见「01 架构」第六到第八节。
// 后端没开时自动拉起，成功就照常输出，不多打印一行，见 S13 第 2 步。
// 拉起八秒还没就绪、后端正忙要等时，各打印一行说明，写到标准错误。

type Env = Readonly<Record<string, string | undefined>>;

/** 命令执行时的环境，由进程入口传进来，测试换成临时目录。 */
export type CommandEnv = {
  readonly cwd: string;
  readonly env: Env;
  /** 用户的家目录，见约定 0002 第 13 条。 */
  readonly userHome: string;
  /** 执行中途给人看的一行，写到标准错误。--json 时不写。 */
  readonly notice: (line: string) => void;
};

/**
 * 命令行的构建号，和拉起的后端比，见约定 0001 第 22 条。
 * 开发时是 dev。打包时注入版本、提交短号和构建时间，见 model 的 build.ts。
 */
export const cliBuild = buildNumber;

const here = dirname(fileURLToPath(import.meta.url));

/**
 * 后端的入口文件。环境变量 PLOOP_BACKEND_ENTRY 优先，见约定 0001 第 22 条。
 * 打包以后后端是命令行入口旁边的 backend.mjs，见第 15 步。开发时是源码里后端的 main.ts。
 * 和后端的 main.ts 一样，看入口旁边有没有打包的文件来分辨。
 */
export function backendEntry(env: Env, cwd: string): string {
  const fromEnv = env.PLOOP_BACKEND_ENTRY;
  if (fromEnv !== undefined && fromEnv !== "") return resolve(cwd, fromEnv);
  const bundled = join(here, "backend.mjs");
  return existsSync(bundled) ? bundled : join(here, "..", "..", "backend", "src", "main.ts");
}

/** 调用接口的结果。失败时一律写成报错，退出码按错误码取。 */
export type Called<D> = Result<Reply<D>, ErrorBody>;

export type Backend = {
  /** 集中存储的目录。 */
  readonly home: string;
  readonly files: BackendFiles;
  /** 拉起后端要用的设置，ploop backend start 直接用它。 */
  readonly ensureOptions: EnsureOptions;
  /** 调一次接口。后端没开时先拉起。 */
  readonly call: <R>(
    send: (api: Api) => Promise<R>,
    options?: CallOptions,
  ) => Promise<Called<DataOf<R>>>;
  /** 发一个不套外壳的请求，例如附件的 HEAD 和 GET。path 从 /api/v1 写起。 */
  readonly raw: (
    path: string,
    init?: RequestInit,
    options?: CallOptions,
  ) => Promise<Result<Response, ErrorBody>>;
};

/** 会话标识：可见的英文字符，不含空白。 */
const sessionPattern = /^[\x21-\x7e]*$/u;

function badSessionError(value: string): ErrorBody<"BAD_REQUEST"> {
  const { message, hint } = backendCopy.call.badSession;
  return errorBody("BAD_REQUEST", [
    { message: renderCopy(message, { value }), hint: renderCopy(hint) },
  ]);
}

/** 接上后端。这时还不发请求，第一次调用接口时才确认后端在运行。 */
export function connect(ctx: CommandEnv): Backend {
  const home = resolveHome(ctx.env, { userHome: ctx.userHome, cwd: ctx.cwd });
  const files = backendFiles(home);
  const ensureOptions: EnsureOptions = {
    home,
    backendEntry: backendEntry(ctx.env, ctx.cwd),
    build: cliBuild,
    env: ctx.env,
    onSlowStart: (notice) => ctx.notice(notice.message),
  };
  // 会话标识从环境变量取，取不到就不带，见约定 0001 第 22 条。
  // 它放在请求头里，只能是可见的英文字符：写了别的，不发请求，按用法错误报。
  const session = ctx.env.PLOOP_SESSION;
  const badSession =
    session !== undefined && !sessionPattern.test(session) ? badSessionError(session) : undefined;
  const client = createNodeClient({
    ...ensureOptions,
    ...(session === undefined || session === "" ? {} : { session }),
    onBusy: (error, waitMs) => {
      const seconds = Math.ceil(waitMs / 1000);
      ctx.notice(renderCopy(backendCopy.call.busy, { seconds, message: error.message }));
    },
  });
  return {
    home,
    files,
    ensureOptions,
    call: async (send, options) => {
      if (badSession !== undefined) return err(badSession);
      const result = await client.call(send, options);
      return result.ok ? result : err(callFailure(result.error, files.log));
    },
    raw: async (path, init, options) => {
      if (badSession !== undefined) return err(badSession);
      const result = await client.raw(path, init, options);
      return result.ok ? result : err(callFailure(result.error, files.log));
    },
  };
}

/**
 * 调用接口失败的三种写成报错：后端给出的报错照原样，后端起不来和没拿到应答都以退出码 5 结束。
 * 错误码表里退出码 5 只有 BUSY 和 INTERNAL，起不来和连不上都不是忙，所以按 INTERNAL 报，
 * 见约定 0002 第 7 条。
 */
export function callFailure(error: CallError | EnsureFailure, logFile: string): ErrorBody {
  if (isEnsureFailure(error)) return backendDown(error);
  if (!isUnreachable(error)) return error;
  const text = backendCopy.call.unreachable;
  return errorBody("INTERNAL", [
    {
      message: renderCopy(text.message, { detail: error.detail }),
      hint: renderCopy(text.hint),
      where: logFile,
    },
  ]);
}

/** 后端起不来：退出码 5，报出原因和日志的最后几行。 */
export function backendDown(failure: EnsureFailure): ErrorBody<"INTERNAL"> {
  return errorBody("INTERNAL", [failureIssue(failure)]);
}

/** 成功的结果原样交回，失败的换成报错。给不经过 connect 的调用用。 */
export function settleCall<D>(result: Result<Reply<D>, CallError>, logFile: string): Called<D> {
  return result.ok ? ok(result.value) : err(callFailure(result.error, logFile));
}
