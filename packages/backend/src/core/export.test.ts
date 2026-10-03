import { describe, expect, it } from "vitest";
import { addDecision, voidDecision } from "./decisions.ts";
import { exportProject } from "./export.ts";
import { presentPage } from "./pages/present.ts";
import { deps, landRound, pageData, presentInput, succeed } from "./pages/testing.ts";

// 导出一个项目，见「03 数据模型」第九节。

async function presented() {
  const core = await landRound();
  succeed(presentPage(core.ctx, "app", presentInput(pageData()), deps));
  const add = (decision: string) =>
    succeed(addDecision(core.ctx, "app", { decision, reason: "用户定的", case: "看板放在首页" }));
  add("看板放在首页");
  add("看板放在第一屏");
  succeed(voidDecision(core.ctx, "app", 1, { by: 2 }));
  return core;
}

describe("导出", () => {
  it("决定含已作废的，队列按阶段分组，每个阶段一个 JSON，页面和枚举写中文", async () => {
    const core = await presented();
    const bundle = succeed(exportProject(core.ctx.db, "app"));
    expect(bundle.files.map((file) => file.path)).toEqual([
      "决定.md",
      "队列.md",
      "rounds/v1-落地-1.json",
    ]);
    const text = (path: string) => bundle.files.find((file) => file.path === path)?.text ?? "";
    expect(text("决定.md")).toContain("| 1 | 看板放在首页 | 用户定的 | 看板放在首页 |");
    expect(text("决定.md")).toContain("已作废，被第 2 条推翻");
    expect(text("队列.md")).toContain("## 落地\n\n### 进行中\n");
    const round = JSON.parse(text("rounds/v1-落地-1.json")) as {
      round: { label: string; stage: string };
      pages: { page: { purpose: string; sections: { asks: unknown[] } }; reply: unknown }[];
    };
    expect(round.round).toMatchObject({ label: "v1-落地-1", stage: "落地" });
    expect(round.pages).toHaveLength(1);
    expect(round.pages[0]?.page.purpose).toBe("要用户点");
    expect(round.pages[0]?.page.sections.asks).toHaveLength(1);
    expect(round.pages[0]?.reply).toBeNull();
  });

  it("按旧格式：主线、旧表头的决定和旧格式的队列.json", async () => {
    const core = await presented();
    const bundle = succeed(exportProject(core.ctx.db, "app", { legacy: true }));
    expect(bundle.files.map((file) => file.path)).toEqual(["决定.md", "队列.json"]);
    const queue = new Map(Object.entries(JSON.parse(bundle.files[1]?.text ?? "") as object));
    expect(queue.get("版本")).toBe(1);
    expect(queue.get("事项")).toHaveLength(3);
    expect(bundle.files[0]?.text).toContain("| 1 | 已作废（被第 2 条推翻）。看板放在首页 |");
  });

  it("项目不存在返回 NOT_FOUND", async () => {
    const core = await presented();
    const result = exportProject(core.ctx.db, "nope");
    expect(result.ok ? "" : result.error.code).toBe("NOT_FOUND");
  });
});
