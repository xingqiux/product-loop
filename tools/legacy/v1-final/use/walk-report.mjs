// 产品循环 skill 自己的使用阶段，面向人的那一面：替人把报告网页按场景走一遍，每步截图、记事实。
// 用法：node walk-report.mjs <样页.html> <输出目录> [使用页.html] [带场景清单的构思页.html] [带设计规范的构思页.html] [落地的页.html]
// 按用户看得见的文字找元素。断了的那一步记下来，后面的步骤不再走。
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

const require = createRequire(process.env.PLAYWRIGHT_FROM || "/Users/alice/code/xy/atlas/package.json");
const { chromium } = require("playwright-core");

const [page1, outDir, usagePage, scenesPage, specPage, landPage] = process.argv.slice(2);
// 页面是列表加详情：人先点左边的一项，右边才是那一屏。脚本也这样走
const openItem = async (p, id) => { await p.locator(`.toc a[data-for="${id}"]`).first().click(); await p.waitForTimeout(250); if (!(await p.locator(`#${id}`).isVisible())) throw new Error(`点了左边的这一项，右边没有换成「${id}」这一屏`); };
fs.mkdirSync(path.join(outDir, "shots"), { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const results = [];

async function scene(name, file, steps, init, viewport) {
  const ctx = await browser.newContext({ viewport: viewport || { width: 1400, height: 1000 }, permissions: ["clipboard-read", "clipboard-write"] });
  const p = await ctx.newPage();
  const errs = [];
  p.on("pageerror", (e) => errs.push(String(e)));
  if (init) await p.addInitScript(init);
  await p.goto("file://" + path.resolve(file));
  await p.waitForTimeout(400);
  const r = { name, state: "走通", steps: [], shots: [] };
  for (let i = 0; i < steps.length; i += 1) {
    const [text, fn] = steps[i];
    const shot = path.join(outDir, "shots", `${name}-${i + 1}.png`);
    try {
      const fact = await fn(p);
      await p.screenshot({ path: shot });
      r.steps.push({ n: i + 1, text, ok: true, fact: fact || "" });
      r.shots.push(shot);
    } catch (e) {
      await p.screenshot({ path: shot }).catch(() => {});
      r.steps.push({ n: i + 1, text, ok: false, fact: String(e.message || e).split("\n")[0] });
      r.shots.push(shot);
      r.state = "断了";
      r.step = i + 1;
      r.stepText = `断在「${text}」：${String(e.message || e).split("\n")[0]}`;
      break;
    }
  }
  if (errs.length) { r.pageErrors = errs; }
  results.push(r);
  await ctx.close();
}

const must = (cond, msg) => { if (!cond) throw new Error(msg); };
const remainNum = async (p) => Number(((await p.locator("#remain-toc").textContent()) || "").replace(/\D/g, "") || 0);

await scene("回答疑问", page1, [
  ["打开网页，看到系统、阶段、第几轮、顶上一条窄带里的五个阶段和当前、左边的列表、还剩几条；右边只摆着一屏", async (p) => {
    must(await p.locator(".head h1").isVisible(), "页头没有系统名");
    must((await p.locator(".strip .pills i").count()) === 5, "窄带里不是五个阶段");
    must(await p.locator(".strip .now").isVisible(), "窄带里没有当前");
    must((await p.locator(".toc a").count()) > 0, "左边的列表是空的");
    const shown = await p.locator(".pane").evaluateAll((els) => els.filter((e) => e.offsetParent !== null).length);
    must(shown === 1, `右边同时摆着 ${shown} 屏`);
    const t = await p.locator("#remain-bottom").textContent();
    must(/还剩/.test(t), "左下角没有写还剩几条");
    return t;
  }],
  ["读第一条：待决定、来源、选项、我的看法；来源一排，每个来源的字和它的图在同一格；选项并排", async (p) => {
    await openItem(p, "q1");
    const c = p.locator("#q1");
    for (const w of ["待决定", "来源", "选项", "我的看法是"]) must(await c.getByText(w, { exact: false }).first().isVisible(), `第一条里找不到「${w}」`);
    const cells = c.locator(".srccell:not(.quote)");
    const n = await cells.count();
    must(n > 0, "来源不是一格一格的");
    for (let k = 0; k < n; k += 1) must(await cells.nth(k).locator("figure img").count(), `来源第 ${k + 1} 格里没有它的图`);
    const opts = c.locator(".optcols .opt:not(.veto)");
    if (await opts.count() >= 2) {
      const a = await opts.nth(0).boundingBox(), b = await opts.nth(1).boundingBox();
      must(Math.abs(a.y - b.y) < 2 && b.x > a.x + a.width - 2, "选项没有并排");
      const ra = await opts.nth(0).locator(".orow").nth(2).boundingBox(), rb = await opts.nth(1).locator(".orow").nth(2).boundingBox();
      must(Math.abs(ra.y - rb.y) < 2, "两个选项的代价那一行没有对齐");
    }
    return `来源 ${n} 格都带着自己的图；选项并排，同一行对同一行`;
  }],
  ["点 a：选项上色，左边这一条打勾并写着选了 a，还剩几条少一条", async (p) => {
    const before = await remainNum(p);
    await p.locator("#q1 label.opt, #q1 .opt").first().click();
    must(await p.locator("#q1 input:checked").count(), "点了 a 没有选中");
    must(await p.locator('.toc a[data-for="q1"].done').count(), "左边这一条没有打勾");
    must(((await p.locator('.toc a[data-for="q1"] .pk').textContent()) || "").trim() === "a", "左边这一条没有写选了什么");
    const after = await remainNum(p);
    must(after === before - 1, `还剩几条没有少一条：${before} → ${after}`);
    return `${before} → ${after}`;
  }],
  ["写备注：备注进复制结果", async (p) => {
    await p.locator("#q1 textarea").fill("这一条的备注");
    await p.locator("#q1 textarea").dispatchEvent("input");
    const t = await p.locator("#reply-text").textContent();
    must(t.includes("这一条的备注"), "复制结果里没有备注");
    return t;
  }],
  ["点选项下面的下一条：右边换成下一条，页面不自己走", async (p) => {
    must(await p.locator("#q1").isVisible(), "点了选项，页面自己换走了");
    const nx = p.locator("#q1 .nextrow .nx");
    must(await nx.isVisible(), "点了选项，选项下面没有出现下一条");
    await nx.click(); await p.waitForTimeout(250);
    must(!(await p.locator("#q1").isVisible()), "点了下一条，右边没有换");
    await openItem(p, "q1");
  }],
  ["想到别的：底部的输入框随时能写，写得多会变高", async (p) => {
    await p.locator("#ideas-bar").fill("突然想到的一句");
    await p.locator("#ideas-bar").dispatchEvent("input");
    must(!(await p.locator("#ideas").count()), "最下面的想法块还在");
    must((await p.locator("#reply-text").textContent()).includes("突然想到的一句"), "复制结果里没有想法");
    const h1 = await p.locator("#ideas-bar").evaluate((el) => el.offsetHeight);
    await p.locator("#ideas-bar").fill("第一行\n第二行\n第三行\n第四行");
    await p.locator("#ideas-bar").dispatchEvent("input");
    const h2 = await p.locator("#ideas-bar").evaluate((el) => el.offsetHeight);
    must(h2 > h1, "写得多的时候输入框没有变高");
  }],
  ["点底部的还剩几条：跳到第一条没点的", async (p) => {
    await p.evaluate(() => window.scrollTo(0, 0));
    const first = await p.locator("#remain-bottom").getAttribute("data-first");
    must(first, "底部没有记着第一条没点的是哪一条");
    await p.locator("#remain-bottom").click();
    await p.waitForTimeout(600);
    must(await p.locator(`#${first}`).isVisible(), "右边没有换成第一条没点的那一屏");
    return first;
  }],
  ["全部点完，点复制回复：得到几行", async (p) => {
    const ids = await p.locator(".card").evaluateAll((els) => els.map((e) => e.id));
    for (const id of ids) { const c = p.locator(`#${id}`); if (!(await c.locator("input:checked").count()) && (await c.locator(".opt").count())) { await openItem(p, id); await c.locator(".opt").first().click(); } }
    if (await p.locator(".al").count()) { await openItem(p, "pane-align"); for (const a of await p.locator(".al").all()) if (!(await a.locator("input:checked").count())) await a.locator("label", { hasText: /^明白$/ }).click(); }
    must(/都点完了/.test(await p.locator("#remain-bottom").textContent()), "全部点完之后底部没有写都点完了");
    await p.locator("#copy").click();
    await p.waitForTimeout(300);
    const btn = await p.locator("#copy").textContent();
    const text = await p.locator("#reply-text").textContent();
    must(text.split("\n").length >= 2, "复制结果不到两行");
    let clip = "";
    try { clip = await p.evaluate(() => navigator.clipboard.readText()); } catch { clip = "（环境：无头浏览器读不到剪贴板）"; }
    return `按钮变成「${btn}」；${clip.startsWith("（环境") ? clip : clip === text ? "剪贴板里的字和页面上一样" : "剪贴板里的字和页面上不一样"}`;
  }],
]);

await scene("验收更改", page1, [
  ["打开网页，目录里有更改这一组", async (p) => { must(await p.locator(".toc .tl", { hasText: "更改" }).count(), "目录里没有更改"); }],
  ["点左边的一条更改：右边换成这一条，之前和现在两格字，改前改后一对图；左边这一条打勾，算看过了", async (p) => {
    await openItem(p, "c1");
    must(await p.locator("#c1 .pair figure").count() >= 2, "第一条更改没有一对图");
    must(await p.locator("#c1 .cf .cfb").isVisible() && await p.locator("#c1 .cf .cfa").isVisible(), "没有之前和现在两格字");
    must(await p.locator('.toc a[data-for="c1"].done').count(), "看过的更改左边没有打勾");
  }],
  ["点下一条、上一条：右边跟着换", async (p) => {
    const nx = p.locator("#pg-next");
    if (await nx.isDisabled()) return "这是最后一条，下一条点不了";
    await nx.click(); await p.waitForTimeout(250);
    must(!(await p.locator("#c1").isVisible()), "点了下一条，右边没有换");
    await p.locator("#pg-prev").click(); await p.waitForTimeout(250);
    must(await p.locator("#c1").isVisible(), "点了上一条，没有回来");
  }],
  ["点图放大，再点关掉", async (p) => {
    await p.locator("#c1 figure img").first().click();
    must(await p.locator("#lightbox.open").count(), "点图没有放大");
    await p.locator("#lightbox").click();
    must(!(await p.locator("#lightbox.open").count()), "再点没有关掉");
  }],
  ["不认可的，截一块贴进输入框并写一句", async () => "见场景「截图反馈」"],
]);

// 截图反馈：存图依赖发布的平台，这里用替身走。替身过两秒半才存好，为的是看得到「正在存图」
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAEAAAAAgCAIAAAAt/+nTAAAAKklEQVR4nO3PMQ0AAAgDsM2/aFBBwtEq6Ey+a4CAgICAgICAgICAgMC1BX7VAT8Kc1yTAAAAAElFTkSuQmCC";
const pasteShot = (p) => p.evaluate((b64) => {
  const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i += 1) u[i] = bin.charCodeAt(i);
  const dt = new DataTransfer(); dt.items.add(new File([u], "s.png", { type: "image/png" }));
  const ta = document.querySelector("#ideas-bar"); ta.focus();
  ta.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
}, PNG);
const standIn = () => { window.claude = { use: async (n) => (n === "assets" ? { upload: async (blob) => (await new Promise((r) => setTimeout(r, 2500)), { id: "c54a7437aeef357f9ddb8c709508f55d", url: URL.createObjectURL(blob), sizeBytes: blob.size, contentType: blob.type }) } : null) }; };

await scene("截图反馈", page1, [
  ["在输入框里粘贴截图：立刻出现缩略图，文字里多出〔图 1〕", async (p) => {
    await p.locator("#ideas-bar").fill("这一块的间距不对");
    await pasteShot(p);
    await p.waitForTimeout(300);
    must(await p.locator("#shots figure img").count() === 1, "没有出现缩略图");
    must((await p.locator("#ideas-bar").inputValue()).includes("〔图 1〕"), "文字里没有〔图 1〕");
  }],
  ["图还在存：复制按钮写着正在存图，点不了；存好之后变回复制回复", async (p) => {
    const c = p.locator("#copy");
    must((await c.textContent()).trim() === "正在存图" && await c.isDisabled(), "存图的时候复制按钮没有变");
    await p.waitForTimeout(2700);
    must((await c.textContent()).trim() === "复制回复" && !(await c.isDisabled()), "存好之后复制按钮没有变回来");
  }],
  ["点缩略图放大，再点关掉", async (p) => {
    await p.locator("#shots img").first().click();
    must(await p.locator("#lightbox.open").count(), "点缩略图没有放大");
    await p.locator("#lightbox").click();
    must(!(await p.locator("#lightbox.open").count()), "再点没有关掉");
  }],
  ["点复制回复：最后一行是「图：」，带标识的前六位", async (p) => {
    const last = ((await p.locator("#reply-text").textContent()) || "").trim().split("\n").pop();
    must(/^图：图 1=[0-9a-f]{6}$/.test(last), `最后一行是「${last}」`);
    await p.locator("#copy").click();
    return `最后一行：${last}`;
  }],
  ["贴回会话，AI 读到图", async () => "这一步依赖发布的平台，脚本走不了；每一版靠用户真贴一次"],
], standIn);

await scene("截图反馈，存不了的时候", page1, [
  ["页面存不了图的时候粘贴：页面如实写出来，提示贴到会话里", async (p) => {
    await pasteShot(p);
    await p.waitForTimeout(400);
    must(await p.getByText("这一页存不了图，截图请直接贴到会话里").count(), "没有写出存不了");
    must(!(await p.locator("#ideas-bar").inputValue()).includes("〔图"), "存不了却留下了标记");
  }],
]);

await scene("决定发现和提升", page1, [
  ["读发现：哪里不舒服、来源、证据、选项；证据里有真组件或截图，和问题出现的位置，写着名字", async (p) => {
    await openItem(p, "f1");
    const c = p.locator("#f1");
    for (const w of ["来源", "哪里不舒服", "选项"]) must(await c.getByText(w).first().isVisible(), `发现里找不到「${w}」`);
    must(await c.locator(".viz-where .nm").count(), "问题出现的位置没有写场景的名字");
    return await c.locator(".viz-where .nm").first().textContent();
  }],
  ["真组件：可以悬停、点，下面的按钮切换条件", async (p) => {
    const fr = p.frameLocator("#f1 iframe.viz-live");
    const btn = fr.locator("#tg button").first();
    must(await btn.count(), "真组件下面没有切换条件的按钮");
    const label = await btn.textContent();
    await btn.click();
    must(await fr.locator("#tg button.on, #tg button[aria-pressed='true']").count(), "点了按钮看不出条件已经切换");
    return `点了「${label}」`;
  }],
  ["读提升：证据那一排是线稿、效果图或操作流程", async (p) => {
    await openItem(p, "p1");
    const c = p.locator("#p1");
    must(await c.locator(".evrow .flow, .evrow .mock, .evrow figure").count(), "提升的证据里没有线稿、效果图或操作流程");
  }],
  ["点选项，复制结果第一行是阶段和第几轮，下面每一行以块的名字开头", async (p) => {
    await openItem(p, "f1"); await p.locator("#f1 .opt").first().click();
    await openItem(p, "p1"); await p.locator("#p1 .opt").first().click();
    const t = await p.locator("#reply-text").textContent();
    const ls = t.split("\n");
    must(/第 \d+ 轮/.test(ls[0]), "第一行不是阶段和第几轮");
    must(ls.some((l) => l.startsWith("发现 ")) && ls.some((l) => l.startsWith("提升 ")), "发现和提升那两行没有以块的名字开头");
    return t;
  }],
]);

await scene("中途接手", page1, [
  ["换一次会话打开网页：顶上的窄带一眼看到现在在哪个阶段、当前是什么；点开看全", async (p) => {
    must(await p.locator(".strip .pills i.current").count() === 1, "窄带里没有标出现在在哪个阶段");
    await p.locator(".strip summary").click();
    must(await p.locator(".steps .step.current").count() === 1, "进度里没有标出现在在哪个阶段");
    must(await p.locator(".current li").count(), "没有当前这一块");
    must(await p.locator(".seen .sc").count(), "页头没有写这一轮看过哪几屏");
  }],
  ["点左边最下面的队列：看到还停着哪些事，各属于哪个阶段", async (p) => {
    await openItem(p, "pane-queue");
    must(await p.locator(".board .lane").count() === 5, "队列没有按五个阶段排开");
    must(await p.locator(".board .lane:not(.none) .qi").count() >= 2, "队列里停着的事没有落在各自的阶段下面");
    await p.locator(".board .lane:not(.none) .qi").first().click();
    await p.waitForSelector(".sheet.open", { timeout: 5000 });
    must(await p.locator(".sheet .sh-list li").count() >= 3, "并列的几件事没有摆成无序列表");
    must(await p.locator(".sheet .sh-attr", { hasText: "来源" }).count(), "来源没有单独一格");
    await p.keyboard.press("Escape");
    must(!(await p.locator("#h-queue + p").count()), "队列的名字下面还有一句说明");
  }],
  ["主线和决定两个文件：看得到每条为什么这样定", async () => "这一步看的是文件，不在页面上"],
]);

if (usagePage && fs.existsSync(usagePage)) {
  await scene("看使用阶段的结果", usagePage, [
    ["打开使用阶段的那一页：每个场景一行，走通了还是断在哪一步", async (p) => {
      must(await p.locator(".usage .urow").count() >= 4, "使用这一块没有每个场景一行");
      must(!(await p.locator(".card").count()), "这一页不应该有要点的卡片");
    }],
    ["断了的，或者没有走的那一行：写着原因", async (p) => {
      const bad = p.locator(".usage .urow.bad");
      if (!(await bad.count())) return "这一次没有断的行";
      must(await bad.first().locator(".ustep").count(), "断了的那一行没有写断在哪里");
    }],
    ["往下：缺口列在下面", async (p) => {
      must(await p.locator(".ugaps li").count(), "没有列出缺口");
      await p.locator(".ugaps").scrollIntoViewIfNeeded();
    }],
  ]);
}

if (scenesPage && fs.existsSync(scenesPage)) {
  await scene("删改场景清单", scenesPage, [
    ["打开构思阶段的那一页：场景清单单独一块，每个场景一条，步骤摊开成格子", async (p) => {
      must(await p.locator("#h-scenes").count(), "没有场景清单这一块");
      must(await p.locator(".scn").count() >= 2, "没有每个场景一条");
      must(await p.locator(".scn").first().locator(".scn-step .sd").count() >= 2 && await p.locator(".scn").first().locator(".scn-step .ss").count() >= 2, "步骤没有摊开成做什么、该看到什么");
    }],
    ["点保留：目录里这一条打勾，还剩几条少一条", async (p) => {
      const before = await remainNum(p);
      await openItem(p, "pane-scenes");
      await p.locator(".scn").nth(0).getByText("保留", { exact: true }).click();
      must(await remainNum(p) === before - 1, "还剩几条没有少");
      must(await p.locator('.toc a[data-item="s1"].done').count(), "目录里没有打勾");
    }],
    ["点修改：这一条下面出一个输入框，写怎么改", async (p) => {
            const sec = p.locator(".scn").nth(1);
      must(await sec.locator(".scn-edit").isHidden(), "没点改就出了输入框");
      await sec.getByText("修改", { exact: true }).click();
      await sec.locator(".scn-edit").fill("第一步之前先收到通知");
    }],
    ["点删除：这一条变灰", async (p) => {
      await p.locator(".scn").nth(2).getByText("删除", { exact: true }).click();
      must(await p.locator(".scn").nth(2).evaluate((el) => el.classList.contains("cut")), "点删没有变灰");
    }],
    ["看回复：每行写场景的名字，改的带上怎么改", async (p) => {
      const t = (await p.locator("#reply-text").textContent()) || "";
      must(/场景 保留：「/.test(t) && /场景 修改：「.+」（第一步之前先收到通知）/.test(t) && /场景 删除：「/.test(t), `回复是：${t}`);
      await p.locator("#h-reply").scrollIntoViewIfNeeded();
      return t;
    }],
  ]);
}

if (specPage && fs.existsSync(specPage)) {
  await scene("删改设计规范", specPage, [
    ["打开构思阶段的那一页：设计规范是一面样张墙，颜色是色块，字号是真实大小的字，圆角和间距是真实大小的方块", async (p) => {
      await openItem(p, "pane-spec");
      must(await p.locator(".specwall .spi").count() >= 4, "样张墙没有一格一格");
      must(await p.locator(".sp-colors u").count() >= 3, "配色不是色块");
      const big = await p.locator(".sp-type .it span").first().evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
      must(big >= 18, "字号的样张不是真实大小");
      must(await p.locator(".sp-radius u").count() && await p.locator(".sp-spacing u").count(), "圆角和间距没有画出来");
    }],
    ["点动效的样张：小方块动一下", async (p) => {
      const b = p.locator(".sp-motion .mo").first();
      await b.click();
      const moving = await b.locator("i").evaluate((el) => el.getAnimations().length);
      must(moving > 0, "点了没有动");
    }],
    ["并列的几条规范是一张表：每一类有自己的列，一行一条，状态摆的是真的标签，写着用在哪个组件上", async (p) => {
      must(await p.locator(".spi .sp-table tbody tr").count() >= 2, "规范的表没有一行一条");
      must(await p.locator(".spi .sp-table .stt").count() >= 2, "状态没有摆成真的标签");
      must(await p.locator(".spi .spi-for").count(), "没有写用在哪个组件上");
    }],
    ["点保留、修改、删除：左边那一项打勾，改的出输入框，删的变灰，还剩几条跟着少", async (p) => {
      const before = await remainNum(p);
      await p.locator(".spi").nth(0).getByText("保留", { exact: true }).click();
      await p.locator(".spi").nth(1).getByText("修改", { exact: true }).click();
      await p.locator(".spi").nth(1).locator(".spi-edit").fill("正文再大一号");
      await p.locator(".spi").nth(2).getByText("删除", { exact: true }).click();
      must(await remainNum(p) === before - 3, "还剩几条没有少三条");
      must(await p.locator('.toc a[data-item="g1"].done').count(), "左边没有打勾");
      must(await p.locator(".spi").nth(2).evaluate((el) => el.classList.contains("cut")), "点删没有变灰");
    }],
    ["看回复：每行写这一格的名字，改的带上怎么改", async (p) => {
      const t = (await p.locator("#reply-text").textContent()) || "";
      must(/规范 保留：「/.test(t) && /规范 修改：「.+」（正文再大一号）/.test(t) && /规范 删除：「/.test(t), `回复是：${t}`);
      return t;
    }],
  ]);
}

await scene("读一段论证", page1, [
  ["打开第一条疑问：待决定的文字按段落显示，同一段里的几句话连在一起，不拆成一句一行", async (p) => {
    await openItem(p, "q1");
    const n = await p.locator("#q1 .why .ln").count();
    must(n === 2, `数据里写了两段，页面上显示成了 ${n} 段`);
  }],
  ["图表占满证据区的整行，不挤在半栏里", async (p) => {
    const w = await p.locator("#q1 .evcell:has(.dg)").first().evaluate((el) => el.getBoundingClientRect().width / el.parentElement.getBoundingClientRect().width);
    must(w > 0.9, `图表只占了证据区宽度的 ${Math.round(w * 100)}%`);
  }],
  ["证据里的表格也占满整行，列不会被挤成一两个字宽", async (p) => {
    const w = await p.locator("#q1 .evcell:has(table)").first().evaluate((el) => el.getBoundingClientRect().width / el.parentElement.getBoundingClientRect().width);
    must(w > 0.9, `表格只占了证据区宽度的 ${Math.round(w * 100)}%`);
  }],
]);

await scene("展开一条参考", page1, [
  ["左边有「参考」这一项；打开后一行一条，只显示名称和类型", async (p) => {
    await openItem(p, "pane-refs");
    const n = await p.locator("#pane-refs .rf").count();
    must(n >= 2, "参考不是一行一条");
    must(!(await p.locator("#pane-refs .rf .rf-body").count()), "概览里就把正文摊开了");
  }],
  ["超过八条时只先显示八条，其余折叠起来，点一下才全露出来", async (p) => {
    const total = await p.locator("#pane-refs .rf").count();
    const shown = await p.locator("#pane-refs .rf").evaluateAll((els) => els.filter((e) => e.offsetParent !== null).length);
    if (total <= 8) { must(shown === total, "不到八条也折叠了"); return `一共 ${total} 条，没有折叠`; }
    must(shown === 8, `折叠之前显示了 ${shown} 条`);
    await p.locator("#pane-refs .rf-more").click();
    must(await p.locator("#pane-refs .rf").evaluateAll((els) => els.filter((e) => e.offsetParent !== null).length) === total, "点开之后没有全部露出来");
    return `一共 ${total} 条，先显示八条`;
  }],
  ["点第一条：出居中的卡片，属性表在上、正文在下", async (p) => {
    await p.locator("#pane-refs .rf").first().click();
    await p.waitForSelector(".sheet.open", { timeout: 5000 });
    for (const k of ["类型", "阅读深度", "相关度", "证据强度", "建议"]) must(await p.locator(".sheet .sh-attr", { hasText: k }).count(), `属性表里没有「${k}」`);
    const at = await p.locator(".sheet .sh-attrs").boundingBox(), bt = await p.locator(".sheet .sh-body").boundingBox();
    must(at.y + at.height <= bt.y + 1, "属性表没有排在正文上面");
  }],
  ["卡片里写着第几条，点下一条换成第二条，按左右键也能换", async (p) => {
    must(/1\s*\/\s*\d/.test(await p.locator(".sheet .sh-at").textContent()), "卡片里没有写第几条");
    const t1 = await p.locator(".sheet .sh-t").textContent();
    await p.locator(".sheet .sh-next").click();
    must((await p.locator(".sheet .sh-t").textContent()) !== t1, "点下一条没有换");
    await p.keyboard.press("ArrowLeft");
    must((await p.locator(".sheet .sh-t").textContent()) === t1, "按左键没有回到上一条");
    await p.keyboard.press("Escape");
    must(!(await p.locator(".sheet.open").count()), "按 Escape 没有关掉卡片");
  }],
]);

await scene("看队列看板", page1, [
  ["左边有「队列」这一项；打开后是五列看板，属于当前阶段的那一列标出来", async (p) => {
    await openItem(p, "pane-queue");
    must(await p.locator("#pane-queue .lane").count() === 5, "看板不是五列");
    must(await p.locator("#pane-queue .lane.now").count() === 1, "没有标出属于当前阶段的那一列");
  }],
  ["在等别的事的，在看板上面单独显示，并写明在等什么", async (p) => {
    const w = p.locator("#pane-queue .qwait .qwi");
    must(await w.count(), "在等别的事的没有单独显示");
    must(/等/.test(await w.first().textContent()), "没有写明在等什么");
    const ids = await p.locator("#pane-queue .lane .qi").evaluateAll((els) => els.map((e) => e.dataset.n));
    const wids = await w.evaluateAll((els) => els.map((e) => e.dataset.n));
    must(!wids.some((x) => ids.includes(x)), "在等别的事的在看板里又出现了一遍");
  }],
  ["小卡只给简略：内容加状态，来源和验收标准不摊在外面", async (p) => {
    must(await p.locator("#pane-queue .lane .qi .qst").count(), "小卡上没有状态");
    const kids = await p.locator("#pane-queue .lane .qi").first().evaluate((e) => Array.from(e.children).map((c) => c.className));
    must(kids.length === 2, `小卡上不止状态和内容两样：${kids.join(" / ")}`);
  }],
  ["停了很久还没轮到的小卡显示得淡一些", async (p) => {
    must(await p.locator("#pane-queue .qi.stale").count(), "停了很久的小卡没有变淡");
  }],
  ["点一张小卡：出展示卡片，属性表里有阶段、状态、提出、创建时间、验收标准", async (p) => {
    await p.locator("#pane-queue .lane .qi").first().click();
    await p.waitForSelector(".sheet.open", { timeout: 5000 });
    for (const k of ["阶段", "状态", "提出", "创建时间", "验收标准"]) must(await p.locator(".sheet .sh-attr", { hasText: k }).count(), `属性表里没有「${k}」`);
    must(await p.locator(".sheet .sh-lh").count(), "并列的几件上面没有写它们是什么");
  }],
  ["在等别的事的横着排，不比看板还占地方", async (p) => {
    const w = await p.locator("#pane-queue .qwait").boundingBox();
    const b = await p.locator("#pane-queue .board").boundingBox();
    must(w.height < b.height, "在等别的事的那一块比看板还高");
  }],
  ["卡片里能做的只有取消这一项，点过之后回复里多一行", async (p) => {
    const t = (await p.locator(".sheet .sh-t").textContent()).trim();
    must(await p.locator(".sheet .sh-drop").count() === 1, "卡片里没有取消这一项，或者还有别的操作");
    await p.locator(".sheet .sh-drop").click();
    await p.keyboard.press("Escape");
    await p.locator("#copy").click();
    await p.waitForTimeout(300);
    const text = await p.locator("#reply-text").textContent();
    must(text.includes("不做了") && text.includes(t.slice(0, 8)), "回复里没有取消这一项的那一行");
    return `回复里多了一行：不做了 ${t.slice(0, 10)}`;
  }],
]);

await scene("图表的文字定义写错了", page1, [
  ["打开第二条疑问：写错的那张图保留文字定义，页面上不出现图表库自己的报错图", async (p) => {
    await openItem(p, "q2");
    await p.waitForSelector("#q2 pre.dg-failed", { timeout: 20000 });
    must(!(await p.getByText("Syntax error", { exact: false }).count()), "页面上出现了图表库的报错图");
  }],
]);

await scene("比较选项", page1, [
  ["打开第一条疑问：选项上面先有「共同的部分」，写一遍并配图", async (p) => {
    await openItem(p, "q1");
    must(await p.locator("#q1 .shared").isVisible(), "没有共同的部分");
    must(/四条/.test(await p.locator("#q1 .shared").textContent()), "共同的部分没有显示文字");
    must(await p.locator("#q1 .shared .dg").count(), "共同的部分没有配图");
  }],
  ["选项横向对成一张表：行名在左边只写一遍，依次是各处差别、理由、代价、适用场景", async (p) => {
    const names = (await p.locator("#q1 .optcols .rn").allTextContents()).map((x) => x.trim()).filter(Boolean);
    must(names.join("|") === "任务的数量|没发生过的那条|理由|代价|适用场景", `左边的行名是「${names.join("|")}」`);
    const lab = await p.locator("#q1 .opt .orow .t").evaluateAll((els) => els.filter((e) => e.offsetParent !== null).length);
    must(lab === 0, "宽屏上每个选项的格子里还重复显示着行名");
  }],
  ["每个选项是一列，同一行的格子上下对齐；行名和它那一行的格子也对齐", async (p) => {
    const a = p.locator("#q1 .opt").nth(0), b = p.locator("#q1 .opt").nth(1);
    for (let k = 0; k < 5; k += 1) {
      const ra = await a.locator(".orow").nth(k).boundingBox(), rb = await b.locator(".orow").nth(k).boundingBox(), rn = await p.locator("#q1 .optcols .rn").nth(k + 1).boundingBox(); // 第一格是列头那一行的空格
      must(Math.abs(ra.y - rb.y) < 2, `两个选项的第 ${k + 1} 行没有对齐`);
      must(Math.abs(ra.y - rn.y) < 2, `行名和第 ${k + 1} 行的格子没有对齐`);
    }
  }],
  ["我的看法标在列头上", async (p) => { must(await p.locator("#q1 .opt .ot .aipick").count() === 1, "列头上没有「我的看法」"); }],
]);

await scene("先对齐术语", page1, [
  ["左边有「先对齐」这一项，排在疑问前面；打开后每个术语一张小卡，有名称、用在、意思、例子", async (p) => {
    await openItem(p, "pane-align");
    must(await p.locator("#pane-align .al").count() === 2, "小卡的数量和数据里写的不一致");
    const t = await p.locator("#pane-align .al").first().textContent();
    for (const k of ["用在", "意思", "例子"]) must(t.includes(k), `小卡上没有「${k}」`);
    const order = await p.locator(".toc .tl").allTextContents();
    must(order.indexOf("先对齐") >= 0 && order.indexOf("先对齐") < order.indexOf("疑问"), "「先对齐」没有排在疑问前面");
  }],
  ["第一张点「明白」并用自己的话写一遍，第二张点「不明白」：回复里各有一行", async (p) => {
    await p.locator("#pane-align .al").nth(0).locator("label", { hasText: /^明白$/ }).click();
    await p.locator("#pane-align .al").nth(0).locator(".al-say").fill("先拆函数再加功能");
    await p.locator("#pane-align .al").nth(1).locator("label", { hasText: "不明白" }).click();
    const r = await p.locator("#reply-text").textContent();
    must(r.includes("对齐 明白：「重构」（先拆函数再加功能）"), "回复里没有「明白」那一行和用户自己的话");
    must(r.includes("对齐 不明白：「构建校验」"), "回复里没有「不明白」那一行");
    must(await p.locator('.toc a[data-item="a1"].done').count() && await p.locator('.toc a[data-item="a2"].done').count(), "点过的术语在左边没有打勾");
    return r;
  }],
  ["不等别的操作，直接刷新页面：刚才的选择、复述和回复里的两行都还在", async (p) => {
    await p.reload(); await p.waitForTimeout(400);
    must(await p.locator('#a2 input[value="不明白"]').isChecked(), "刷新之后最后一次点的「不明白」丢了");
    must((await p.locator("#a1 .al-say").inputValue()) === "先拆函数再加功能", "刷新之后复述的文字丢了");
    must((await p.locator("#reply-text").textContent()).includes("对齐 不明白：「构建校验」"), "刷新之后回复里的那一行丢了");
  }],
  ["用到「构建校验」的那张疑问卡上出现提示：这个术语还没对齐，本轮可以先不选", async (p) => {
    await openItem(p, "q2");
    must(await p.locator("#q2 .al-warn").isVisible(), "用到不明白术语的卡上没有提示");
    must((await p.locator("#q2 .al-warn").textContent()).includes("构建校验"), "提示里没有写是哪个术语");
    must(!(await p.locator("#q1 .al-warn").count()) || !(await p.locator("#q1 .al-warn").evaluate((el) => !el.hidden)), "已经明白的术语也出了提示");
  }],
]);

await scene("查看图表", page1, [
  ["打开第一条疑问：证据里有一张流程图，带标题，画出来的是图形", async (p) => {
    await openItem(p, "q1");
    await p.waitForSelector("#q1 .dg svg", { timeout: 15000 });
    must(/落地的五个步骤/.test(await p.locator("#q1 .dg").first().textContent()), "图表没有显示标题");
  }],
  ["同一条里还有一棵目录树，用等宽文字显示", async (p) => {
    must(await p.locator("#q1 .dg pre.dg-tree").count(), "没有目录树");
    must(/走查脚本/.test(await p.locator("#q1 .dg pre.dg-tree").textContent()), "目录树里没有文字");
  }],
]);

if (landPage && fs.existsSync(landPage)) {
  await scene("看工程证据", landPage, [
    ["打开落地的页，左边有工程证据这一项", async (p) => { must(await p.locator('.toc a[data-for="pane-land"]').count(), "左边没有工程证据"); }],
    ["点它：右边是四样，重构、先失败后通过、评审意见和处置、AI 自己裁决的", async (p) => {
      await openItem(p, "pane-land");
      for (const t of ["重构", "先失败后通过", "评审", "裁决"]) must(await p.locator("#pane-land .ld-h", { hasText: t }).count(), `工程证据里没有「${t}」`);
      must(await p.locator("#pane-land .ld-red").count() && await p.locator("#pane-land .ld-green").count(), "先失败后通过没有失败和通过两格");
      must(await p.locator("#pane-land .ld-rv tbody tr").count() >= 2, "评审的意见没有一行一条");
      must(/改了/.test(await p.locator("#pane-land .ld-rv").textContent()), "阻塞的意见没有露出处置");
      const over = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      must(over <= 1, `工程证据这一屏横着超出了页面 ${over} 像素`);
    }],
    ["先失败后通过的表里只有改动的说明和两个状态，命令和输出默认折叠", async (p) => {
      must(/^\s*检查失败\s*$/.test(await p.locator("#pane-land .ld-red").first().textContent()), "改之前显示的不是「检查失败」这个状态");
      must(/^\s*检查通过\s*$/.test(await p.locator("#pane-land .ld-green").first().textContent()), "改之后显示的不是「检查通过」这个状态");
      const d = p.locator("#pane-land details.ld-cmd").first();
      must(await d.count(), "没有可展开的命令和输出");
      must(!(await d.locator("code").first().isVisible()), "命令没有默认折叠");
    }],
    ["展开之后能看到执行的命令和失败时的那一行输出", async (p) => {
      const d = p.locator("#pane-land details.ld-cmd").first();
      await d.locator("summary").click();
      must(await d.locator("code").first().isVisible(), "展开后看不到命令");
      must(await d.locator("code").nth(1).isVisible() && /断了/.test(await d.locator("code").nth(1).textContent()), "展开后看不到失败时的输出");
    }],
  ]);
}

await scene("在窄屏上看", page1, [
  ["窄屏打开：没有左边一栏，所有的屏一条接一条往下排，顶上写着还剩几条，回复粘在底部", async (p) => {
    must(await p.locator(".toc").isHidden(), "窄屏上左边的列表还在");
    must(await p.locator("#q1 .optcols .rns").isHidden(), "窄屏上对照表左边的行名列还在");
    must(await p.locator("#q1 .opt .orow .t").first().isVisible(), "窄屏上每一格里没有重新显示行名");
    const shown = await p.locator(".pane").evaluateAll((els) => els.filter((e) => e.offsetParent !== null).length);
    must(shown >= 2, "窄屏上不是所有的屏都摆出来");
    must(/还剩|都点完/.test(await p.locator("#remain-top").textContent()), "顶上没有写还剩几条");
    const box = await p.locator("#copy").boundingBox(); const vh = p.viewportSize().height;
    must(box && box.y + box.height <= vh + 1 && box.y > vh / 2, "复制回复不在屏幕底部");
  }],
  ["点顶上的还剩几条：滑到第一条没点的", async (p) => {
    const first = await p.locator("#remain-top").getAttribute("data-first");
    await p.locator("#remain-top").click(); await p.waitForTimeout(900);
    const top = await p.locator(`#${first}`).evaluate((el) => el.getBoundingClientRect().top);
    must(top > -200 && top < 700, `没有滑到第一条没点的：它离屏幕顶部 ${Math.round(top)}`);
  }],
], null, { width: 420, height: 860 });

fs.writeFileSync(path.join(outDir, "walk-facts.json"), JSON.stringify(results, null, 1));
for (const r of results) console.log(r.state, r.name, r.stepText || "");
await browser.close();
