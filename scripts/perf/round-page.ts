// 一轮页面打开的耗时测量，见第二期计划第 23 步和「06 工作台」第四节。
// 用法：node scripts/perf/round-page.ts，不用先构建，脚本自己把运行目录打进临时文件夹。
//
// 步骤：
// 1. 把运行目录打进临时文件夹，等同 `pnpm build`，只是输出目录换成临时的。
// 2. 在隔离的沙盒里摆出检查阶段的一页：三十张卡（疑问和发现问题各半，都带选项和来源），
//    一百张图，敲 `ploop page present`，见 scripts/use/lib.ts 和 packages/cli/src/commands/open.use.test.ts。
// 3. 无头 Chrome 分别用宽屏（1440）和窄屏（700）两种视口打开这一页，量到「能用」为止：
//    - 宽屏：左边一栏的三十一条都出现（三十张卡加队列一条），且第一屏（第一张疑问卡）出现。
//    - 窄屏：没有侧栏，所有屏一次铺开，量的是三十一屏都出现。
//    两边取的都是 performance.now()，也就是从这一页的 navigation start 到条件成立的毫秒数。
// 4. 各测五次取中位数，打印毫秒数。中位数超过一千毫秒，退出码写 1。
//
// 全程只碰临时目录和临时的 PLOOP_HOME，不碰真实的集中存储和正在运行的后端。
// 结束时关掉自己拉起的后端、删掉临时目录，无论中途是不是出错。

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { type Browser, chromium } from "playwright-core";
import { expectRun, repoRoot, started, world } from "../use/lib.ts";

const budgetMs = 1000;
const samples = 5;

// ---- 生成截图：字节各不相同（哈希也各不相同），尺寸和真截图相当（800×500）。

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const byte of buf) c = (crcTable[(c ^ byte) & 0xff] as number) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBuf = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([length, typeBuf, data, crc]);
}

const clamp255 = (n: number) => Math.max(0, Math.min(255, n));

/** 一张 800×500 的假截图：按 seed 算像素，互不相同，画一块「按钮」和几道细纹，别压成几乎空的文件。 */
function fakeScreenshot(seed: number): Buffer {
  const width = 800;
  const height = 500;
  const base: [number, number, number] = [
    30 + ((seed * 53) % 190),
    30 + ((seed * 97) % 190),
    30 + ((seed * 131) % 190),
  ];
  const accent: [number, number, number] = [255 - base[0], 255 - base[1], (base[2] + 120) % 256];
  const raw = Buffer.alloc((width * 3 + 1) * height);
  let offset = 0;
  const barTop = Math.floor(height * 0.15);
  const barBottom = Math.floor(height * 0.3);
  const barLeft = Math.floor(width * 0.1);
  const barRight = Math.floor(width * 0.4);
  for (let y = 0; y < height; y++) {
    raw[offset++] = 0; // 每行不过滤
    const inBar = y >= barTop && y < barBottom;
    for (let x = 0; x < width; x++) {
      const onBar = inBar && x >= barLeft && x < barRight;
      const stripe = (x + y + seed) % 37 < 2;
      const [r, g, b] = onBar ? accent : [base[0] - (stripe ? 12 : 0), base[1], base[2]];
      raw[offset++] = clamp255(r);
      raw[offset++] = clamp255(g);
      raw[offset++] = clamp255(b);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // 位深
  ihdr[9] = 2; // 颜色类型：真彩色，不带透明
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([
    signature,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw, { level: 6 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---- 摆一页数据：三十张卡（疑问、发现问题各十五张），一百张图，一条队列事项，一条元素清单。

const nouns = [
  "保存按钮",
  "搜索框",
  "筛选器",
  "头像",
  "导航栏",
  "分页",
  "上传按钮",
  "删除确认",
  "提示条",
  "加载动画",
  "空状态",
  "表格排序",
  "侧边栏折叠",
  "面包屑",
  "标签页切换",
  "下拉菜单",
  "日期选择器",
  "颜色选择器",
  "文件预览",
  "评论区",
  "点赞按钮",
  "分享按钮",
  "设置项",
  "权限提示",
  "版本号",
  "反馈入口",
  "帮助文档链接",
  "快捷键提示",
  "离线提示",
  "同步状态",
];

type ImageFile = { readonly path: string; readonly bytes: Buffer };

/** 一张卡：疑问和发现问题形状相同，差别只在标题、有没有 queue，和发现问题必须写 where。 */
function makeCard(
  kind: "ask" | "finding",
  globalIndex: number,
  images: ImageFile[],
): Record<string, unknown> {
  const noun = nouns[globalIndex % nouns.length];
  const id = `${kind}-${String(globalIndex).padStart(2, "0")}`;
  const title = kind === "ask" ? `${noun}要不要挪个位置` : `${noun}把旁边的东西挡住了`;
  const why = kind === "ask" ? `${noun}现在的位置是不是最好的。` : `${noun}挡住了旁边的东西。`;
  // 前十张卡带四张来源图，其余二十张带三张，一百张图正好分完。
  const imgCount = globalIndex < 10 ? 4 : 3;
  const sources = Array.from({ length: imgCount }, (_, i) => {
    const path = `img/${id}-${i}.png`;
    images.push({ path, bytes: fakeScreenshot(globalIndex * 10 + i) });
    return { name: `${noun}的截图`, saw: "看到的样子是这样。", img: path };
  });
  const options = [
    {
      key: "a",
      title: "改这里",
      diffs: ["调整这一处的样子。"],
      why: "看的人更容易懂。",
      cost: "要多花一点时间。",
      when: "有空排上的时候。",
    },
    {
      key: "b",
      title: "先不改",
      diffs: ["保持原来的样子。"],
      why: "改动小，风险低。",
      cost: "问题还在。",
      when: "先看看有没有人在意。",
    },
  ];
  const card: Record<string, unknown> = {
    id,
    title,
    why,
    sources,
    options,
    rows: ["怎么办"],
    shared: { text: "两种做法都不影响别的地方。" },
    where: { scene: "S3", step: 1 },
  };
  if (kind === "ask" && globalIndex === 0) card.queue = ["Q1"];
  return card;
}

/** 三十张卡、一百张图、一条元素清单，凑成检查阶段一页合格的数据。 */
function buildPage(): { data: unknown; images: readonly ImageFile[] } {
  const images: ImageFile[] = [];
  const asks = Array.from({ length: 15 }, (_, i) => makeCard("ask", i, images));
  const findings = Array.from({ length: 15 }, (_, i) => makeCard("finding", 15 + i, images));
  const data = {
    asks,
    findings,
    screens: [
      {
        name: "设置页",
        where: { scene: "S3", step: 1 },
        elements: [{ what: "保存按钮", answers: "改的东西存下来没有" }],
      },
    ],
  };
  return { data, images };
}

// ---- 打开浏览器，量到「能用」为止。

/** 宽屏：左边一栏三十一条都出现，且第一屏（第一张疑问卡）出现。窄屏：三十一屏都一次铺开。 */
const screenTotal = 30 + 1; // 三十张卡各一屏，加队列一屏

const wideCondition = `() => document.querySelectorAll('nav[aria-label="这一页的每一条"] button').length === ${screenTotal} && document.getElementById('screen-ask-00') !== null`;
const narrowCondition = `() => document.querySelectorAll('[id^="screen-"]').length === ${screenTotal}`;

async function openBrowser(): Promise<Browser> {
  return chromium
    .launch({ channel: "chrome", headless: true })
    .catch(() => chromium.launch({ headless: true }));
}

/** 打开一次，等条件成立，返回 performance.now()：从这一页的 navigation start 到能用的毫秒数。 */
async function openOnce(
  browser: Browser,
  url: string,
  viewport: { width: number; height: number },
  condition: string,
): Promise<number> {
  const context = await browser.newContext({ viewport });
  try {
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "commit" });
    await page.waitForFunction(condition, undefined, { timeout: 10_000 });
    return await page.evaluate(() => performance.now());
  } finally {
    await context.close();
  }
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2
    : (sorted[mid] as number);
}

async function measure(
  browser: Browser,
  url: string,
  label: string,
  viewport: { width: number; height: number },
  condition: string,
): Promise<number> {
  const durations: number[] = [];
  for (let i = 0; i < samples; i++) {
    durations.push(await openOnce(browser, url, viewport, condition));
  }
  const m = median(durations);
  console.log(
    `${label}：${durations.map((d) => Math.round(d)).join(", ")} ms，中位数 ${Math.round(m)} ms`,
  );
  return m;
}

async function main(): Promise<number> {
  const workDir = mkdtempSync(join(tmpdir(), "ploop-perf-"));
  const appDir = join(workDir, "app");
  console.log("构建运行目录……");
  execFileSync(process.execPath, [join(repoRoot, "scripts", "build.ts"), appDir], {
    stdio: "inherit",
  });

  process.env.PLOOP_TEST_APP = appDir;
  const w = world();
  let browser: Browser | undefined;
  try {
    started(w);
    expectRun(w.ploop(["queue", "add", "设置页的保存按钮在窄屏被挡住", "--stage", "检查"]), 0);
    expectRun(w.ploop(["round", "start", "检查"]), 0);
    const workspace = ".product-loop/rounds/v1-检查-1";
    const { data, images } = buildPage();
    for (const image of images) w.write(`${workspace}/${image.path}`, image.bytes);
    w.write(`${workspace}/page.json`, JSON.stringify(data, null, 2));
    const presented = w.ploop(["page", "present"]);
    expectRun(presented, 0);
    const url = `${presented.stdout}\n${presented.stderr}`.match(/https?:\/\/\S+/u)?.[0];
    if (url === undefined) throw new Error(`给出信息以后的输出里没有地址：${presented.stdout}`);
    console.log(`地址：${url}`);

    browser = await openBrowser();
    const wide = await measure(
      browser,
      url,
      "宽屏（1440）",
      { width: 1440, height: 900 },
      wideCondition,
    );
    const narrow = await measure(
      browser,
      url,
      "窄屏（700）",
      { width: 700, height: 900 },
      narrowCondition,
    );

    const overBudget = wide > budgetMs || narrow > budgetMs;
    console.log(
      overBudget
        ? `超过一秒的预算：宽屏 ${Math.round(wide)} ms，窄屏 ${Math.round(narrow)} ms`
        : `都在一秒以内：宽屏 ${Math.round(wide)} ms，窄屏 ${Math.round(narrow)} ms`,
    );
    return overBudget ? 1 : 0;
  } finally {
    if (browser !== undefined) await browser.close();
    await w.cleanup();
    rmSync(workDir, { recursive: true, force: true });
  }
}

process.exit(await main());
