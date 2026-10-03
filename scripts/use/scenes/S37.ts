import { createHash } from "node:crypto";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { check, expectRun, type Scene, type World } from "../lib.ts";
import { presentThink, solidPng } from "../pages.ts";

// S37 查看和清理集中存储。用户，集中存储越来越大，想知道谁占了地方、清掉没用的附件时。
// 误删有引用的附件，页面上的图会裂开。不清，占用只增不减。
// 摆的状态：项目 app 给出了构思的一页，页里有两张图，两个附件都有引用；
// 另外放进一个没有任何引用的附件，刚存下。全部在沙盒里做，集中存储是临时的 PLOOP_HOME。
// 第 3 步只在沙盒里直接改库，把那个附件存下的时间改到八天前，不用等七天。

const day = 24 * 60 * 60 * 1000;

/** 没有引用的附件：一张纯色的小图，颜色和页里的两张都不同。 */
const stray = solidPng(16, 10, [200, 40, 40]);
const strayHash = createHash("sha256").update(stray).digest("hex");

/** 库里所有附件的哈希，按存下的先后。 */
function blobHashes(w: World): string[] {
  const db = new DatabaseSync(join(w.store, "data", "ploop.db"), { readOnly: true });
  try {
    return db
      .prepare("SELECT hash FROM blobs ORDER BY created_at, hash")
      .all()
      .map((row) => String(row.hash));
  } finally {
    db.close();
  }
}

/** 页面上引用着的附件：库里除了没有引用的那一个。 */
const referenced = (w: World): string[] => blobHashes(w).filter((hash) => hash !== strayHash);

/** 像页面那样取一张图：后端上的附件地址。返回状态码和内容类型。 */
async function fetchBlob(w: World, hash: string): Promise<{ status: number; type: string }> {
  const response = await fetch(w.url(`/api/v1/blobs/${hash}`));
  await response.arrayBuffer();
  return { status: response.status, type: response.headers.get("content-type") ?? "" };
}

/** 页面上的图都还打得开：每一张返回 200，是图片。 */
async function imagesOpen(w: World): Promise<void> {
  const hashes = referenced(w);
  check(hashes.length === 2, `页面上引用着的附件应当是 2 个，库里有 ${hashes.length} 个`);
  for (const hash of hashes) {
    const got = await fetchBlob(w, hash);
    check(
      got.status === 200 && got.type.startsWith("image/"),
      `附件 ${hash.slice(0, 8)} 打不开：状态 ${got.status}，类型 ${got.type}`,
    );
  }
}

export const scene: Scene = {
  scene: "S37",
  setup: async (w) => {
    presentThink(w);
    const put = (await w.api("PUT", `/blobs/${strayHash}`, stray, "image/png")) as { ok: boolean };
    check(put.ok, `没有引用的附件没有传上去：${JSON.stringify(put)}`);
  },
  steps: [
    {
      do: "敲 ploop storage",
      expect:
        "写附件的个数和大小、数据库的大小，按项目列出各自引用的附件。另写没有引用的附件个数和大小，和「超过七天的，ploop backup gc 会删除」。",
      run: (w) => {
        const run = w.ploop(["storage"]);
        expectRun(
          run,
          0,
          "集中存储的占用：附件 3 个，",
          "数据库 ",
          "  app  附件 2 个，",
          "没有引用的附件 1 个，",
          "超过七天的，ploop backup gc 会删除。",
        );
        // 大小写成「多少 B」这样的数。
        check(
          /附件 3 个，\d+(\.\d+)? (B|KB|MB)；数据库 \d+(\.\d+)? (B|KB|MB)/u.test(run.stdout),
          `没有写大小：${run.stdout.split("\n")[0]}`,
        );
        check(
          /没有引用的附件 1 个，\d+(\.\d+)? (B|KB|MB)/u.test(run.stdout),
          "没有写没有引用的附件的大小",
        );
      },
    },
    {
      do: "没有引用的附件才存下不到七天，敲 ploop backup gc",
      expect: "写清理了 0 个附件。附件还在，没有引用的个数不变。",
      run: async (w) => {
        expectRun(w.ploop(["backup", "gc"]), 0, "清理了 0 个附件和 0 个临时文件，腾出 0 B");
        check(blobHashes(w).includes(strayHash), "才存下的附件被删了");
        expectRun(w.ploop(["storage"]), 0, "没有引用的附件 1 个，");
        await imagesOpen(w);
      },
    },
    {
      do: "那个附件存下超过七天，再敲 ploop backup gc",
      expect: "写清理了几个附件、腾出多少字节。页面上引用着的图一张都没删。",
      run: async (w) => {
        // 只在摆状态时直接改库：把没有引用的那个附件存下的时间改到八天前。
        const db = new DatabaseSync(join(w.store, "data", "ploop.db"));
        db.prepare("UPDATE blobs SET created_at = created_at - ? WHERE hash = ?").run(
          8 * day,
          strayHash,
        );
        db.close();
        const run = w.ploop(["backup", "gc"]);
        expectRun(run, 0, "清理了 1 个附件和 0 个临时文件，腾出 ");
        check(/腾出 [1-9]\d* B/u.test(run.stdout), `没有写腾出多少字节：${run.stdout.trim()}`);
        check(!blobHashes(w).includes(strayHash), "存下超过七天的附件还在库里");
        // 引用着的两张图一张都没删：库里、接口上都还在。
        await imagesOpen(w);
        expectRun(w.ploop(["storage"]), 0, "  app  附件 2 个，");
      },
    },
    {
      do: "再敲 ploop storage",
      expect: "没有引用的附件写 0 个。页面上的图还打得开。",
      run: async (w) => {
        expectRun(
          w.ploop(["storage"]),
          0,
          "集中存储的占用：附件 2 个，",
          "没有引用的附件 0 个，0 B",
        );
        await imagesOpen(w);
      },
    },
  ],
};
