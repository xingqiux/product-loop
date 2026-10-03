import { describe, expect, it } from "vitest";
import { listDraftRevisions, readDraft, restoreDraftRevision, saveDraft } from "./drafts.ts";
import { failure, succeed } from "./pages/testing.ts";
import { withdrawPage } from "./pages/withdraw.ts";
import { submitReply } from "./replies/submit.ts";
import { presented, submitDeps } from "./replies/testing.ts";

// 草稿：整份存、按三条规则存旧版本、放回、只有在等的页能存。

const field = "asks/card-1";
const note = (text: string) => ({ [field]: { pick: "a", note: text } });
const long = "这一段写得很长，说明为什么选 a，还写了看板放在左边的理由和代价。";
const minute = 60 * 1000;

async function start() {
  const { core, pageId } = await presented();
  const t0 = new Date("2026-09-28T02:00:00Z");
  core.setNow(t0);
  const at = (ms: number) => core.setNow(new Date(t0.getTime() + ms));
  const save = (entries: Parameters<typeof saveDraft>[3]) =>
    succeed(saveDraft(core.ctx, "app", pageId, entries));
  const revisions = () => succeed(listDraftRevisions(core.ctx.db, "app", pageId));
  return { core, pageId, at, save, revisions };
}

describe("读和存草稿", () => {
  it("还没点过时是空的；存了以后读回整份，并发出 draft.saved", async () => {
    const { core, pageId, save } = await start();
    expect(succeed(readDraft(core.ctx.db, "app", pageId))).toEqual({
      page: pageId,
      entries: {},
      updatedAt: null,
      deleted: [],
    });
    save(note("选 a"));
    expect(succeed(readDraft(core.ctx.db, "app", pageId))).toMatchObject({
      entries: note("选 a"),
      updatedAt: "2026-09-28T02:00:00.000Z",
    });
    expect(core.received.map((e) => e.kind)).toContain("draft.saved");
  });

  it("已回复、已撤回的页不能再存", async () => {
    const a = await start();
    succeed(
      submitReply(
        a.core.ctx,
        "app",
        a.pageId,
        { source: "workbench", lines: [{ kind: "idea", note: "好" }] },
        submitDeps,
      ),
    );
    expect(failure(saveDraft(a.core.ctx, "app", a.pageId, note("x"))).code).toBe("CONFLICT");
    const b = await start();
    succeed(withdrawPage(b.core.ctx, "app", b.pageId, "重给"));
    expect(failure(saveDraft(b.core.ctx, "app", b.pageId, note("x"))).code).toBe("PAGE_GONE");
  });

  it("别的项目的页找不到", async () => {
    const { core, pageId } = await start();
    expect(failure(saveDraft(core.ctx, "other", pageId, note("x"))).code).toBe("NOT_FOUND");
  });
});

describe("删之前存旧版本", () => {
  it("少了二十字以上时，存下出现过的最长的一份，这一次的响应写明是哪个输入框", async () => {
    const { save, revisions } = await start();
    save(note("这一段"));
    save(note(long));
    const view = save(note("短了"));
    expect(view.deleted).toEqual([field]);
    expect(revisions()).toMatchObject([{ field, text: long, reason: "beforeDelete" }]);
  });

  it("按住退格慢慢删，比的是最长的一份，少的字累积起来", async () => {
    const { save, revisions } = await start();
    save(note(long));
    const chars = Array.from(long);
    for (let n = chars.length - 3; n > 0; n -= 3) save(note(chars.slice(0, n).join("")));
    // 最早存下的一份就是删之前最长的整段；之后从删剩的文字重新记
    const deleted = revisions().filter((r) => r.reason === "beforeDelete");
    expect(deleted.at(-1)?.text).toBe(long);
  });

  it("少了一半以上也存；最长的一份不到十个字时不存", async () => {
    const a = await start();
    a.save(note("一二三四五六七八九十十一十二"));
    a.save(note("一二三"));
    expect(a.revisions()).toHaveLength(1);
    const b = await start();
    b.save(note("一二三四五六七八九"));
    b.save(note(""));
    expect(b.revisions()).toEqual([]);
  });

  it("整个输入框从草稿里去掉，按清空处理", async () => {
    const { save, revisions } = await start();
    save(note(long));
    save({});
    expect(revisions()).toMatchObject([{ text: long, reason: "beforeDelete" }]);
  });
});

describe("定时存旧版本", () => {
  it("编辑期间每满两分钟存一份当时的文字，和上一份相同就不存", async () => {
    const { at, save, revisions } = await start();
    save(note("第一句"));
    at(1 * minute);
    save(note("第一句，第二句"));
    expect(revisions()).toEqual([]);
    at(2 * minute);
    save(note("第一句，第二句，第三句"));
    expect(revisions()).toMatchObject([{ text: "第一句，第二句，第三句", reason: "timer" }]);
    at(5 * minute);
    save({ [field]: { pick: "b", note: "第一句，第二句，第三句" } });
    expect(revisions()).toHaveLength(1);
  });
});

describe("放回旧版本", () => {
  it("放回之前先存下现在的文字，放回以后还能改回来", async () => {
    const { core, pageId, save, revisions } = await start();
    save(note(long));
    save(note("重写的一句"));
    const [deleted] = revisions();
    const view = succeed(restoreDraftRevision(core.ctx, "app", pageId, deleted?.id ?? 0));
    expect(view.entries[field]).toEqual({ pick: "a", note: long });
    expect(revisions()[0]).toMatchObject({ text: "重写的一句", reason: "beforeRestore" });
  });

  it("编号不在这一页的草稿里时找不到", async () => {
    const { core, pageId, save } = await start();
    save(note("x"));
    expect(failure(restoreDraftRevision(core.ctx, "app", pageId, 99)).code).toBe("NOT_FOUND");
  });
});
