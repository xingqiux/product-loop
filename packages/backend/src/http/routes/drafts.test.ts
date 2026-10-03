import { describe, expect, it } from "vitest";
import { recordLandSteps, registerBlobs, succeed } from "../../core/pages/testing.ts";
import { addQueueItem } from "../../core/queue.ts";
import { present } from "../../core/replies/testing.ts";
import { startRound } from "../../core/rounds/start.ts";
import { addProject } from "../../core/testing.ts";
import { dataOf, errorOf, testApp } from "../testing.ts";

// 草稿的四个接口：读、存、列旧版本、放回。规则的细节在 core/drafts.test.ts。

async function presented() {
  const t = await testApp();
  addProject(t.core, "/work/app");
  succeed(
    addQueueItem(t.core.ctx, "app", { content: "看板放到首页", stage: "land", proposer: "ai" }),
  );
  succeed(startRound(t.core.ctx, "app", { stage: "land" }));
  recordLandSteps(t.core);
  registerBlobs(t.core);
  return { t, base: `/api/v1/projects/app/pages/${present(t.core)}/draft` };
}

const long = "这一段写得很长，说明为什么选 a，还写了看板放在左边的理由和代价。";

describe("草稿的接口", () => {
  it("存了读回来；删了一大段以后列出旧版本，放回", async () => {
    const { t, base } = await presented();
    expect(dataOf(await t.request("GET", base))).toMatchObject({ entries: {}, updatedAt: null });
    await t.request("PUT", base, { body: { entries: { idea: { note: long } } } });
    const saved = dataOf(
      await t.request("PUT", base, { body: { entries: { idea: { note: "短" } } } }),
    );
    expect(saved).toMatchObject({ deleted: ["idea"] });
    const revisions = dataOf(await t.request("GET", `${base}/revisions?field=idea`));
    expect(revisions).toMatchObject([{ field: "idea", text: long, reason: "删之前" }]);
    const [first] = revisions as { id: number }[];
    const restored = dataOf(await t.request("POST", `${base}/revisions/${first?.id}/restore`));
    expect(restored).toMatchObject({ entries: { idea: { note: long } } });
  });

  it("草稿的内容写错、旧版本的编号写错时返回 BAD_REQUEST", async () => {
    const { t, base } = await presented();
    const bad = await t.request("PUT", base, { body: { entries: { idea: { seen: false } } } });
    expect(errorOf(bad).code).toBe("BAD_REQUEST");
    expect(errorOf(await t.request("POST", `${base}/revisions/abc/restore`)).code).toBe(
      "BAD_REQUEST",
    );
  });
});
