// 草稿：每点一下先改这里，再隔半秒把整份草稿交给后端，见「06 工作台」第九节。
// 交不上时顶上提示，隔几秒再交，连上后端以后马上重交。页面以这里为准，
// 事件流让草稿的查询重取时不覆盖这里。
import type { DraftEntries, DraftEntry } from "@product-loop/model";
import { create } from "zustand";
import { load, markLeaving } from "@/lib/api";

type Target = { readonly pid: string; readonly page: number };

export type SaveState = "saved" | "pending" | "saving" | "failed";

type DraftState = {
  target: Target | undefined;
  entries: DraftEntries;
  save: SaveState;
  /** 最近一次保存时后端存下「删之前」旧版本的输入框。 */
  deleted: readonly string[];
  /** 换到一页：用后端读到的草稿开始。同一页重复调用不覆盖。 */
  open: (target: Target, entries: DraftEntries) => void;
  /** 改一项。改完是空的一项从草稿里去掉。 */
  update: (field: string, patch: Partial<DraftEntry>) => void;
  /** 后端放回了一份旧版本：换成后端交回的一项，后端已经存下，不用再交。 */
  restored: (field: string, entry: DraftEntry | undefined) => void;
};

const debounceMs = 500;
const retryMs = 3_000;

let timer: ReturnType<typeof setTimeout> | undefined;
let inFlight = false;
let dirty = false;

function isEmpty(entry: DraftEntry): boolean {
  return (
    entry.pick === undefined &&
    (entry.note ?? "") === "" &&
    (entry.images ?? []).length === 0 &&
    entry.seen === undefined
  );
}

/** 去掉值为 undefined 的键，草稿的定义是严格的。 */
function clean(entry: DraftEntry): DraftEntry {
  return Object.fromEntries(
    Object.entries(entry).filter(([, value]) => value !== undefined),
  ) as DraftEntry;
}

export const useDraft = create<DraftState>()((set, get) => ({
  target: undefined,
  entries: {},
  save: "saved",
  deleted: [],
  open: (target, entries) => {
    const current = get().target;
    if (current?.pid === target.pid && current.page === target.page) return;
    clearTimeout(timer);
    dirty = false;
    set({ target, entries, save: "saved", deleted: [] });
  },
  update: (field, patch) => {
    const merged = clean({ ...get().entries[field], ...patch });
    const entries = { ...get().entries };
    if (isEmpty(merged)) delete entries[field];
    else entries[field] = merged;
    set({ entries, save: "pending" });
    schedule(debounceMs);
  },
  restored: (field, entry) => {
    const entries = { ...get().entries };
    if (entry === undefined) delete entries[field];
    else entries[field] = entry;
    set({ entries, deleted: get().deleted.filter((name) => name !== field) });
  },
}));

function schedule(ms: number): void {
  clearTimeout(timer);
  timer = setTimeout(() => void flush(), ms);
}

/** 把整份草稿交给后端。正在交的时候又改了，交完再交一次。 */
async function flush(): Promise<void> {
  const { target, entries } = useDraft.getState();
  if (target === undefined) return;
  if (inFlight) {
    dirty = true;
    return;
  }
  inFlight = true;
  dirty = false;
  useDraft.setState({ save: "saving" });
  try {
    const reply = await load((api) =>
      api.api.v1.projects[":pid"].pages[":id"].draft.$put({
        param: { pid: target.pid, id: String(target.page) },
        json: { entries },
      }),
    );
    const still = useDraft.getState().target;
    if (still?.pid === target.pid && still.page === target.page) {
      // 找回的按钮留到放回或换页为止，后面再存一次也不去掉。
      const deleted = [...new Set([...useDraft.getState().deleted, ...reply.data.deleted])];
      useDraft.setState({ save: dirty ? "pending" : "saved", deleted });
    }
  } catch {
    useDraft.setState({ save: "failed" });
    schedule(retryMs);
  } finally {
    inFlight = false;
  }
  if (dirty) schedule(0);
}

// 点完马上离开这一页时，半秒的等待还没到。离开时把没交的马上交出去。
if (typeof window !== "undefined") {
  window.addEventListener("pagehide", () => {
    const { save } = useDraft.getState();
    if (save !== "pending" && save !== "failed") return;
    markLeaving(true);
    clearTimeout(timer);
    void flush();
  });
  window.addEventListener("pageshow", () => markLeaving(false));
}

/** 连上后端以后，没交上的马上重交。 */
export function retryDraftNow(): void {
  if (useDraft.getState().save === "failed") schedule(0);
}
