import { type ErrorBody, errorBody, renderCopy } from "@product-loop/model";
import type { MiddlewareHandler } from "hono";
import { processCopy } from "../copy/process.ts";
import type { AppDeps, Busy } from "./deps.ts";
import { failure } from "./respond.ts";
import { isWriteMethod } from "./security.ts";

// 后端进程的状态在接口层的体现，见「01 架构」第六、七节和约定 0002 第 8 条：
// - 迁移数据、从快照恢复期间，写请求和 shutdown 返回 BUSY，带 Retry-After。读的请求照常。
// - 当天第一次写入之前先做每日快照。快照期间来的写请求等它做完，不返回 BUSY。
//   管理后端的接口不触发快照：退出在快照期间返回 BUSY，备份和恢复自己管快照。
// - 后端退出期间，响应都带 Connection: close。连接用完就关，手上的请求做完就能退出。
// 放在安全检查后面：被安全检查拒绝的请求不触发快照。

const adminPrefix = "/api/v1/admin/";
const shutdownPath = "/api/v1/admin/shutdown";

export function processGate(deps: AppDeps): MiddlewareHandler {
  return async (c, next) => {
    closeIfStopping(c.header, deps);
    if (isWriteMethod(c.req.method)) {
      const busy = deps.process.busy();
      if (busy !== undefined) {
        return failure(c, busyError(busy, c.req.path === shutdownPath, deps.now()));
      }
      if (!c.req.path.startsWith(adminPrefix)) await deps.dailySnapshot();
    }
    await next();
    // 处理这个请求的期间开始退出的，也关掉连接。
    closeIfStopping(c.header, deps);
  };
}

function closeIfStopping(header: (name: string, value: string) => void, deps: AppDeps): void {
  if (deps.process.stopping()) header("Connection", "close");
}

/** 写明后端在做什么、已经做了多久，命令行重试满六十秒时照着报给 AI。 */
function busyError(busy: Busy, shutdown: boolean, now: Date): ErrorBody<"BUSY"> {
  const text = shutdown ? processCopy.busy.shutdown : processCopy.busy.write;
  const task = renderCopy(processCopy.busy.task[busy.work]);
  const seconds = Math.max(0, Math.floor((now.getTime() - busy.since.getTime()) / 1000));
  const message = renderCopy(text.message, { task, seconds });
  return errorBody("BUSY", [{ message, hint: renderCopy(text.hint) }]);
}
