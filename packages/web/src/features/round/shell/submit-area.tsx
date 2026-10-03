// 提交区：未点的几条、想法框、提交。提交前在页面里确认。提交以后是「等 AI 取走」，
// 命令行取走以后是「AI 已收到」。已回复、所在的阶段已收尾和撤回的页不能提交，写明是哪一种，
// 状态词都写清指的是这一页还是阶段。撤回的有原因才写原因，没有原因只写状态。见「06 工作台」第四节和第九节。
import { beijingMinute } from "@product-loop/model";
import { useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useState } from "react";
import { Dialog, Modal, ModalOverlay } from "@/components/ui/application/modals/modal";
import { Button } from "@/components/ui/base/buttons/button";
import { errorCodeOf, isServiceLost, load } from "@/lib/api";
import { cx } from "@/lib/cx";
import { motionTokens } from "@/lib/motion";
import { keys } from "@/lib/query-keys";
import { useConnection } from "@/stores/connection";
import { usePage, useQueueContents } from "../context";
import { type SaveState, useDraft } from "../draft-store";
import { ideasField, missingReasons, type PageState, replyLines } from "../model";
import { NoteField } from "../note-field";

/** 北京时间的年月日时分。 */
function minuteOf(at: string | null | undefined): string {
  return at == null ? "" : beijingMinute(new Date(at));
}

/** 存不上：连不上本机服务，或者草稿交不上去。主线 S27 第 3 步，不写英文码。确认框和提交区说同一个词。 */
const cannotSave = "存不上";

/** 草稿存到哪一步的说法。存不上时草稿只在这个页面的内存里，连上以后自动重交。 */
const saveText: Record<SaveState, string> = {
  saved: "点过的都已存下",
  pending: "正在存",
  saving: "正在存",
  failed: cannotSave,
};

/** 提交没成功时，确认框里说草稿怎么样了。和提交区的说法一致：已存下，或者存不上。 */
export function draftNoteOf(save: SaveState): string {
  return save === "saved" ? "草稿已存下" : `草稿${cannotSave}`;
}

/** 确认框里的两行：几条回复、几条没点；提交以后的后果。 */
export function confirmLines(replies: number, pending: number): readonly [string, string] {
  return [`${replies} 条回复${pending > 0 ? `，${pending} 条没点` : ""}`, "提交后不能改"];
}

/** 不能提交时写在提交区的状态词，写清指的是这一页还是阶段，页头的徽章写的是阶段的状态。 */
export const stateTitle: Record<Exclude<PageState, "open" | "view">, string> = {
  waiting: "等 AI 取走",
  received: "AI 已收到",
  replied: "这一页已回复",
  closed: "阶段已收尾",
  withdrawn: "这一页已撤回",
};

/** 本机服务拒绝提交时写给用户的原因：这一页已经回复过，或者已经撤回、所在的阶段已收尾。 */
const refusals: Record<string, string> = {
  CONFLICT: "这一页已经回复过，不能再提交。",
  PAGE_GONE: "这一页已经撤回，或者所在的阶段已经收尾，不能再提交。",
};

/** 提交区摆在哪里：bar 是宽屏时页面底下固定的一条，page 是窄屏时长页最后的一块。 */
export type SubmitLayout = "bar" | "page";

type StatePage = {
  readonly submission: { readonly submittedAt: string; readonly takenAt: string | null } | null;
  readonly withdrawal: { readonly reason: string | null } | null;
};

/** 状态词下面那一行：提交和取走的时间，撤回的原因。没有的不写，不补一句「没有」。 */
export function stateHint(
  state: Exclude<PageState, "open" | "view">,
  page: StatePage,
): string | undefined {
  if (state === "waiting") return `${minuteOf(page.submission?.submittedAt)} 提交`;
  if (state === "received") return `${minuteOf(page.submission?.takenAt)} 取走`;
  if (state === "withdrawn") {
    const reason = page.withdrawal?.reason?.trim();
    return reason === undefined || reason === "" ? undefined : reason;
  }
  return undefined;
}

const dots: Record<Exclude<PageState, "open" | "view">, string> = {
  // 圆点呼吸是反馈，不是位移；系统开了减少动态效果时圆点不动。
  waiting: "bg-fg-brand-primary animate-pulse motion-reduce:animate-none",
  received: "bg-fg-success-primary",
  replied: "bg-fg-quaternary",
  closed: "bg-fg-quaternary",
  withdrawn: "bg-fg-quaternary",
};

export function SubmitArea({
  layout,
  pending,
  onPending,
}: {
  layout: SubmitLayout;
  pending: number;
  onPending: () => void;
}) {
  const { pid, page, state } = usePage();
  const still = useReducedMotion() === true;
  // 只看的页不等回复，没有提交区。
  if (state === "view") return null;
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={state}
        initial={{ opacity: 0, y: still ? 0 : 4 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0 }}
        transition={motionTokens.submit}
        className="flex flex-col gap-3"
      >
        {state === "open" ? (
          <OpenArea layout={layout} pid={pid} pending={pending} onPending={onPending} />
        ) : (
          <Status dot={dots[state]} title={stateTitle[state]} hint={stateHint(state, page)} />
        )}
      </motion.div>
    </AnimatePresence>
  );
}

function Status({
  dot,
  title,
  hint,
}: {
  dot: string;
  title?: string | undefined;
  hint?: string | undefined;
}) {
  return (
    <div className="flex flex-col gap-1" role="status">
      {title !== undefined && (
        <p className="flex items-center gap-2 text-ui font-semibold">
          <span className={`size-2 rounded-full ${dot}`} />
          {title}
        </p>
      )}
      {hint !== undefined && <p className="text-meta text-tertiary">{hint}</p>}
    </div>
  );
}

function OpenArea({
  layout,
  pid,
  pending,
  onPending,
}: {
  layout: SubmitLayout;
  pid: string;
  pending: number;
  onPending: () => void;
}) {
  const { page } = usePage();
  const save = useDraft((s) => s.save);
  const entries = useDraft((s) => s.entries);
  const lost = useConnection((state) => state.status) === "lost";
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState<string | undefined>();
  const contents = useQueueContents();
  const lines = replyLines(page.sections, entries);
  const missing = missingReasons(page.sections, entries, contents);
  const submit = async () => {
    setSending(true);
    setFailed(undefined);
    try {
      await load((api) =>
        api.api.v1.projects[":pid"].pages[":id"].submission.$post({
          param: { pid, id: String(page.id) },
          json: { lines },
        }),
      );
      setConfirming(false);
      await queryClient.invalidateQueries({ queryKey: keys.page(pid, page.id) });
    } catch (error) {
      const code = errorCodeOf(error);
      const draft = draftNoteOf(useDraft.getState().save);
      setFailed(
        (code === undefined ? undefined : refusals[code]) ??
          (isServiceLost(error)
            ? `本机服务没有回应，${draft}，稍后再提交`
            : error instanceof Error
              ? error.message
              : `提交没有成功，${draft}，稍后再提交`),
      );
      // 别处已经回复、撤回或收尾了：重读这一页和这个阶段，提交区随之换成只能看的状态。
      if (code !== undefined && code in refusals) {
        void queryClient.invalidateQueries({ queryKey: keys.page(pid, page.id) });
        void queryClient.invalidateQueries({ queryKey: keys.round(pid, page.round) });
      }
    } finally {
      setSending(false);
    }
  };
  const bar = layout === "bar";
  return (
    <>
      <div className={bar ? "flex items-end gap-6" : "flex flex-col gap-3"}>
        <div className={bar ? "min-w-0 flex-1" : undefined}>
          <NoteField field={ideasField} readOnly={false} rows={bar ? 2 : 3} placeholder="想法" />
        </div>
        <div className={cx("flex flex-col gap-2", bar && "max-h-40 w-72 shrink-0 overflow-y-auto")}>
          <div className="flex items-center justify-between gap-3">
            {/* 窄屏时顶上一条已经写着未点的几条，这里不再写第二遍。 */}
            {bar && pending > 0 && (
              <button
                type="button"
                onClick={onPending}
                className="inline-flex min-h-6 items-center text-ui text-brand-secondary hover:underline"
              >
                看未点的 {pending} 条
              </button>
            )}
            <Button
              className="ml-auto"
              onClick={() => setConfirming(true)}
              isDisabled={lines.length === 0 || missing.length > 0}
            >
              提交
            </Button>
          </div>
          {missing.map((text) => (
            <p key={text} className="text-meta text-error-primary">
              {text}
            </p>
          ))}
          {/* 连不上本机服务时，点了、写了都存不上，不管点没点过都写。
              什么也没点、没写时，没有草稿可存，不写「都已存下」。 */}
          {lost ? (
            <p className="text-meta text-error-primary">{cannotSave}</p>
          ) : (
            (save !== "saved" || Object.keys(entries).length > 0) && (
              <p
                role={save === "failed" ? "alert" : undefined}
                className={
                  save === "failed" ? "text-meta text-error-primary" : "text-meta text-quaternary"
                }
              >
                {saveText[save]}
              </p>
            )
          )}
        </div>
      </div>
      <ModalOverlay isOpen={confirming} onOpenChange={setConfirming} isDismissable={!sending}>
        <Modal className="max-w-md">
          <Dialog aria-label="确认提交">
            <div className="flex flex-col gap-4 p-6">
              <h3 className="text-heading">提交回复</h3>
              <ul className="flex flex-col gap-1 text-ui text-secondary">
                {confirmLines(lines.length, pending).map((text) => (
                  <li key={text}>{text}</li>
                ))}
              </ul>
              {failed !== undefined && <p className="text-ui text-error-primary">{failed}</p>}
              <div className="flex justify-end gap-3">
                <Button color="secondary" onClick={() => setConfirming(false)} isDisabled={sending}>
                  返回
                </Button>
                <Button onClick={() => void submit()} isLoading={sending}>
                  提交
                </Button>
              </div>
            </div>
          </Dialog>
        </Modal>
      </ModalOverlay>
    </>
  );
}
