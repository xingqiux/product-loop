// 参考实现：Electron + CDP（9222 端口）。换项目要改：TABS（tab 名）、HOST_TABS_JS 里的标签、FACTS_JS 里的 class 选择器、导航探测的按钮文字、场景编号。Web 项目把 connect/page 换成 Playwright，FACTS_JS 原样可用。
// 使用代码的积木：以用户身份用 Design 面板：多宽度截图 + DOM 量数 + 导航探测。只读，不改产品。
// 结果用 use-out.mjs 写成 use-run.json，放在环境变量 PLOOP_USE_OUT 指定的目录里。用法：
//   ploop use run -- node use-cdp-screens.mjs
// 下面两个场景编号 S1、S2 是例子，换成主线里对应场景的编号，步号也和主线里的步骤编号对上。
import { openRun } from "./use-out.mjs";

const run = openRun();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function connect(url) {
  const ws = new WebSocket(url);
  await new Promise((r) => ws.addEventListener("open", r, { once: true }));
  let seq = 0; const pending = new Map();
  ws.addEventListener("message", ({ data }) => { const m = JSON.parse(String(data)); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
  const send = (method, params = {}) => new Promise((resolve) => { const id = ++seq; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
  const evaluate = async (expression) => { const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }); if (r.result?.exceptionDetails) return { error: r.result.exceptionDetails.text }; return r.result?.result?.value; };
  return { send, evaluate, close: () => ws.close() };
}

const list = async () => (await fetch("http://127.0.0.1:9222/json/list")).json();
const targets = await list();
const pageT = targets.find((t) => t.type === "page" && !/devtools/u.test(t.url));
const page = await connect(pageT.webSocketDebuggerUrl);

const TABS = ["我的设计", "工作台", "设计系统", "模板"];
const HOST_TABS_JS = `(() => {
  const labels = ${JSON.stringify(["设计平台", ...TABS])};
  const els = [...document.querySelectorAll('button,[role="tab"],a,div,span')].filter(e => labels.includes(e.textContent.trim()));
  const inner = els.filter(e => ![...e.querySelectorAll('*')].some(c => labels.includes(c.textContent.trim())));
  return inner.map(e => { const el = e.closest('button,[role="tab"],a') || e; const r = el.getBoundingClientRect();
    return { t: e.textContent.trim(), tag: el.tagName, role: el.getAttribute('role'), sel: el.getAttribute('aria-selected') || el.getAttribute('data-state') || (/active|selected/.test(el.className) ? 'cls' : null), cursor: getComputedStyle(el).cursor, x: Math.round(r.x), w: Math.round(r.width) }; });
})()`;
const clickHostTab = (label) => page.evaluate(`(() => { const els = [...document.querySelectorAll('button,[role="tab"],a,div,span')].filter(e => e.textContent.trim() === ${JSON.stringify(label)}); const e = els[els.length-1]; if (!e) return 'notfound'; (e.closest('button,[role="tab"],a') || e).click(); return 'clicked'; })()`);

const FACTS_JS = `(() => {
  const vw = innerWidth, vh = innerHeight;
  const vis = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < vh; };
  const rect = el => { const r = el.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)]; };
  const grids = [...document.querySelectorAll('.dx-card-grid')].filter(vis).map(g => { const kids = [...g.children].filter(vis); const cols = getComputedStyle(g).gridTemplateColumns.split(' ').length; const gr = g.getBoundingClientRect(); const rowEnd = kids.slice(0, cols).map(k => k.getBoundingClientRect().right); const last = rowEnd.length ? Math.max(...rowEnd) : gr.right; return { cls: g.className.replace('dx-card-grid', '').trim(), width: Math.round(gr.width), cols, cards: kids.length, rightGap: Math.round(gr.right - last), cardW: kids.length ? Math.round(kids[0].getBoundingClientRect().width) : 0 }; });
  const inputs = [...document.querySelectorAll('input,textarea,select')].filter(vis).map(i => ({ type: i.type || i.tagName.toLowerCase(), name: (i.placeholder || i.name || i.getAttribute('aria-label') || '').slice(0, 18), w: Math.round(i.getBoundingClientRect().width) }));
  const btns = [...document.querySelectorAll('button,[role="button"],[role="tab"],a')].filter(vis).slice(0, 80).map(b => { const cs = getComputedStyle(b); return { t: b.textContent.trim().slice(0, 14), dis: !!(b.disabled || b.getAttribute('aria-disabled') === 'true'), sel: b.getAttribute('aria-pressed') || b.getAttribute('aria-selected') || (/is-active|is-selected|active/.test(b.className) ? 'cls' : null), c: cs.color, bg: cs.backgroundColor, bd: cs.borderColor, r: rect(b) }; });
  const rails = [...document.querySelectorAll('.wb-template-picker-card')].filter(vis).map(rect);
  const crumbs = [...document.querySelectorAll('.wb-crumbs')].filter(vis).map(n => n.textContent.trim().replace(/\\s+/g, ' ').slice(0, 90));
  const headings = [...document.querySelectorAll('h1,h2,h3,.dx-designs-heading,.dx-section-title')].filter(vis).slice(0, 8).map(h => h.textContent.trim().slice(0, 24));
  const all = [...document.querySelectorAll('body *')].filter(vis);
  const maxRight = Math.round(Math.max(0, ...all.map(e => e.getBoundingClientRect().right)));
  const texts = [...document.querySelectorAll('p,span,div,label')].filter(vis).map(e => e.childNodes.length && [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()) ? e.textContent.trim().replace(/\\s+/g, ' ').slice(0, 60) : '').filter(Boolean).slice(0, 40);
  return { vw, vh, scrollW: document.documentElement.scrollWidth, grids, inputs, btns, rails, crumbs, headings, maxRight, texts };
})()`;

async function panelFacts() {
  const ts = (await list()).filter((t) => t.url === "about:srcdoc");
  let best = null;
  for (const t of ts) {
    const c = await connect(t.webSocketDebuggerUrl);
    const w = await c.evaluate("innerWidth");
    if (w > 0) { const facts = await c.evaluate(FACTS_JS); c.close(); if (!best || (facts?.texts?.length ?? 0) > (best.texts?.length ?? 0)) best = facts; }
    else c.close();
  }
  return best;
}
const clickInPanel = async (label) => {
  const ts = (await list()).filter((t) => t.url === "about:srcdoc");
  for (const t of ts) {
    const c = await connect(t.webSocketDebuggerUrl);
    const r = await c.evaluate(`(() => { if (innerWidth === 0) return 'hidden'; const e = [...document.querySelectorAll('button,[role="button"],a')].find(b => b.textContent.trim() === ${JSON.stringify(label)}); if (!e) return 'notfound'; e.click(); return 'clicked'; })()`);
    c.close();
    if (r === "clicked") return r;
  }
  return "notfound";
};

async function shot(ctx, name) {
  const r = await page.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
  if (!r.result?.data) throw new Error(`截图失败：${name}`);
  await ctx.screenshot(name, Buffer.from(r.result.data, "base64"));
}

// 场景 S1：逐个 tab、逐个宽度看一遍。一个 tab 是一步，三个宽度各记一项。
// 这里只量事实，不判断排版好不好：使用阶段只认断点，排版留给检查阶段看截图和事实。
const s1 = run.scene("S1");
for (const [i, tab] of TABS.entries()) {
  for (const width of [700, 1400, 2000]) {
    await s1.step(
      { step: i + 1, do: `在 ${width} 宽下点「${tab}」`, expect: "这个 tab 打开，内容显示出来", width },
      async (ctx) => {
        await page.send("Emulation.setDeviceMetricsOverride", { width, height: 923, deviceScaleFactor: 1, mobile: false });
        await sleep(600);
        if ((await clickHostTab(tab)) === "notfound") throw new Error(`找不到 tab「${tab}」`);
        await sleep(1300);
        await shot(ctx, `${width}-${tab}`);
        const facts = await panelFacts();
        ctx.facts({ ...facts, host: await page.evaluate(HOST_TABS_JS) });
      },
    );
  }
}

// 场景 S2：导航探测（1400 宽）。点新建设计，再点返回，看落点对不对。
const s2 = run.scene("S2");
const active = async () => (await page.evaluate(HOST_TABS_JS)).filter((t) => t.sel && t.sel !== "false" && t.sel !== "inactive").map((t) => t.t);
await s2.step({ step: 1, do: "在「我的设计」点「新建设计」", expect: "进入分步新建页" }, async (ctx) => {
  await page.send("Emulation.setDeviceMetricsOverride", { width: 1400, height: 923, deviceScaleFactor: 1, mobile: false });
  await sleep(500);
  await clickHostTab("我的设计"); await sleep(1000);
  if ((await clickInPanel("新建设计")) !== "clicked") throw new Error("没有找到「新建设计」按钮");
  await sleep(1500);
  await shot(ctx, "nav-after-new");
  const f = await panelFacts();
  ctx.facts({ active: await active(), backs: f?.btns.filter((b) => /返回|重新选择/.test(b.t)).map((b) => b.t), headings: f?.headings });
});
await s2.step({ step: 2, do: "点返回", expect: "回到来的地方" }, async (ctx) => {
  if ((await clickInPanel("返回工作台")) !== "clicked") throw new Error("没有找到返回按钮");
  await sleep(1200);
  await shot(ctx, "nav-after-back");
  const f = await panelFacts();
  ctx.facts({ active: await active(), crumbs: f?.crumbs, headings: f?.headings });
});
await s2.step({ step: 3, do: "点顶上的「设计平台」", expect: "点了以后页面有反应" }, async (ctx) => {
  const before = await active();
  const r = await clickHostTab("设计平台");
  await sleep(800);
  const after = await active();
  ctx.facts({ click: r, before, after });
});
await page.send("Emulation.clearDeviceMetricsOverride");
page.close();
process.exit(run.finish());
