import {
  formatQueueId,
  type Issue,
  parseQueueId,
  type ReplyLineKind,
  renderCopy,
} from "@product-loop/model";
import { and, eq } from "drizzle-orm";
import { repliesCopy } from "../../copy/replies.ts";
import { replyLines } from "../../store/schema/index.ts";
import { appendEvent } from "../events.ts";
import { moveQueueItem } from "../queue.ts";
import type { WriteScope } from "../tx.ts";

// 收到回复时由后端自动处理的两种行，见「03 数据模型」第二节「页面和回复」：
// - 取消队列事项：把那件事改成已取消，原因写明是用户在回复里取消的。原因会显示在工作台上，不写回复和行的编号。
// - 认可一条更改：用户认可了，没有要做的事，去处是不处理，原因写明是用户认可。
// 取消的去处是队列，指向那件事。想法框里的话不在这里：它和别的行一样，由 AI 用 ploop reply handle 定去处
// （主线 S17 第 3 步）。其余的行也留给 AI 处理，见第 44 步。
// 要取消的事改不成已取消时，例如它已经完成了，这一行不处理，留给 AI，另报一条警告。

/** 后端自动处理的行，执行者写这个，见 model 的 replyLineSchema。 */
export const autoHandler = "后端";

/** 自动处理要看的一行：行号、种类和点名的队列事项。 */
export type AutoLine = {
  readonly line: number;
  readonly kind: ReplyLineKind;
  /** 点名的队列事项，Q12 存成 12。 */
  readonly queue: number | null;
};

/** 在提交回复的写事务里自动处理取消队列事项和认可更改，返回没能处理的行的警告。 */
export function autoHandle(
  w: WriteScope,
  projectId: string,
  submission: number,
  lines: readonly AutoLine[],
): Issue[] {
  const warnings: Issue[] = [];
  for (const line of lines) {
    const fromLine = { submission, line: line.line };
    if (line.kind === "changeApproved") {
      handledAsNoAction(w, projectId, fromLine, renderCopy(repliesCopy.auto.approvedReason));
    } else if (line.kind === "queueDrop" && line.queue !== null) {
      const reason = renderCopy(repliesCopy.auto.dropReason);
      const moved = moveQueueItem(w, projectId, line.queue, { to: "dropped", reason });
      if (moved.ok) {
        handled(w, projectId, fromLine, moved.value.id);
        continue;
      }
      const text = repliesCopy.auto.dropFailed;
      warnings.push({
        message: renderCopy(text.message, {
          line: line.line,
          queue: formatQueueId(line.queue),
          reason: moved.error.message,
        }),
        hint: renderCopy(text.hint),
        where: renderCopy(repliesCopy.where, { line: line.line }),
      });
    }
  }
  return warnings;
}

/** 记下这一行不处理，写明原因，再记一条 line.handled。 */
function handledAsNoAction(
  w: WriteScope,
  projectId: string,
  ref: { readonly submission: number; readonly line: number },
  reason: string,
): void {
  w.tx
    .update(replyLines)
    .set({ destination: "noAction", handledNote: reason, handledAt: w.now, handledBy: autoHandler })
    .where(and(eq(replyLines.submissionId, ref.submission), eq(replyLines.line, ref.line)))
    .run();
  appendEvent(w, {
    projectId,
    kind: "line.handled",
    objectType: "replyLine",
    objectId: `${ref.submission}:${ref.line}`,
    detail: { ...ref, to: "noAction", note: reason, by: autoHandler },
  });
}

/** 记下这一行的去处是队列里的这件事，再记一条 line.handled。 */
function handled(
  w: WriteScope,
  projectId: string,
  ref: { readonly submission: number; readonly line: number },
  queueId: string,
): void {
  const number = parseQueueId(queueId);
  // 编号由队列的用例生成，一定写得对。
  if (!number.ok) throw new Error(`队列事项的编号写错了：${queueId}`);
  w.tx
    .update(replyLines)
    .set({ destination: "queue", toQueue: number.value, handledAt: w.now, handledBy: autoHandler })
    .where(and(eq(replyLines.submissionId, ref.submission), eq(replyLines.line, ref.line)))
    .run();
  appendEvent(w, {
    projectId,
    kind: "line.handled",
    objectType: "replyLine",
    objectId: `${ref.submission}:${ref.line}`,
    detail: { ...ref, to: "queue", queue: queueId, by: autoHandler },
  });
}
