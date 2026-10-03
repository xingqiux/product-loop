// 参考实现：Electron + CDP（9222 端口）。换项目要改：tab 名、按钮文字、class 选择器、场景编号。Web 项目把 connect/page 换成 Playwright，量数的 JS 原样可用。
// 补三个动作：进场景参数页、切模板筛选、测筛选联动。只读，只量事实，不判断好不好。
// 结果用 use-out.mjs 写成 use-run.json，放在环境变量 PLOOP_USE_OUT 指定的目录里。用法：
//   ploop use run -- node use-cdp-probes.mjs
// 下面的场景编号 S3、S4 是例子，换成主线里对应场景的编号，步号也和主线里的步骤编号对上。
import { openRun } from "./use-out.mjs";
const run = openRun();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function connect(url) {
  const ws = new WebSocket(url);
  await new Promise((r) => ws.addEventListener("open", r, { once: true }));
  let seq = 0; const pending = new Map();
  ws.addEventListener("message", ({ data }) => { const m = JSON.parse(String(data)); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
  const send = (method, params = {}) => new Promise((resolve) => { const id = ++seq; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
  const evaluate = async (expression) => { const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }); return r.result?.exceptionDetails ? { error: r.result.exceptionDetails.text } : r.result?.result?.value; };
  return { send, evaluate, close: () => ws.close() };
}
const list = async () => (await fetch("http://127.0.0.1:9222/json/list")).json();
const pageT = (await list()).find((t) => t.type === "page" && !/devtools/u.test(t.url));
const page = await connect(pageT.webSocketDebuggerUrl);
const clickHostTab = (label) => page.evaluate(`(() => { const els = [...document.querySelectorAll('span')].filter(e => e.textContent.trim() === ${JSON.stringify(label)}); const e = els[els.length-1]; if (!e) return 'notfound'; e.click(); return 'clicked'; })()`);
async function inPanel(js) {
  // 宿主页里当前显示的那个 srcdoc iframe：按 nonce 对上 CDP target，避免点到隐藏 tab 的同名元素。
  const nonce = await page.evaluate(`(() => { const fs = [...document.querySelectorAll('iframe[srcdoc]')].map(f => ({ w: f.getBoundingClientRect().width, n: (f.srcdoc.match(/nonce="([a-f0-9]+)"/) || [])[1] })).filter(f => f.w > 0).sort((a, b) => b.w - a.w); return fs[0]?.n || null; })()`);
  for (const t of (await list()).filter((t) => t.url === "about:srcdoc")) {
    const c = await connect(t.webSocketDebuggerUrl);
    const n = await c.evaluate("document.querySelector('script')?.nonce || null");
    if (n && n === nonce) { const v = await c.evaluate(js); c.close(); return v; }
    c.close();
  }
  return undefined;
}
const clickText = (label, exact = true) => inPanel(`(() => { const all = [...document.querySelectorAll('button,[role="button"],a,[role="option"]')]; const e = all.find(b => ${exact ? "b.textContent.trim() === L" : "b.textContent.trim().startsWith(L)"}.call(null)) ; })()`.replace("L", JSON.stringify(label)).replace("(b => ", "(b => ").replace(".call(null))", ")") + ";" + `(() => { const all = [...document.querySelectorAll('button,[role="button"],a,[role="option"]')]; const L=${JSON.stringify(label)}; const e = all.find(b => ${exact ? "b.textContent.trim() === L" : "b.textContent.trim().startsWith(L)"}); if (!e) return '__skip__'; e.click(); return 'clicked'; })()`);
async function shot(ctx, name) { const r = await page.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true }); if (!r.result?.data) throw new Error(`截图失败：${name}`); await ctx.screenshot(name, Buffer.from(r.result.data, "base64")); }
const FORM_JS = `(() => { const vis = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const inputs = [...document.querySelectorAll('input,textarea,select')].filter(vis);
  const chips = [...document.querySelectorAll('button')].filter(vis).filter(b => b.getBoundingClientRect().height < 44 && b.textContent.trim().length > 0 && b.textContent.trim().length <= 10);
  const sections = [...document.querySelectorAll('h2,h3,h4,[class*="section-title"],[class*="card-title"],legend,label')].filter(vis).map(h => h.textContent.trim().slice(0, 12));
  return { title: document.querySelector('h1,h2,[class*="title"]')?.textContent.trim().slice(0, 20), inputs: inputs.length, chips: chips.length, sections: [...new Set(sections)].slice(0, 20), scrollH: document.scrollingElement.scrollHeight, viewH: innerHeight }; })()`;
const TPL_JS = `(() => { const vis = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const rows = [...document.querySelectorAll('[role="group"], .dx-tpl-filter-row, .dx-tag-filter, .dx-segmented')].filter(vis).map(g => ({ label: g.getAttribute('aria-label') || g.className.slice(0, 24), chips: [...g.querySelectorAll('button')].filter(vis).map(b => { const cs = getComputedStyle(b); return { t: b.textContent.trim().slice(0, 10), sel: b.getAttribute('aria-pressed') || b.getAttribute('aria-checked') || (/is-active|is-selected|active|selected/.test(b.className) ? 'cls' : null), c: cs.color, bg: cs.backgroundColor, bd: cs.borderColor }; }) }));
  const cards = [...document.querySelectorAll('.dx-card-grid > *')].filter(vis).map(c => { const r = c.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; });
  const disabled = [...document.querySelectorAll('button[disabled],[aria-disabled="true"]')].filter(vis).slice(0, 3).map(b => { const cs = getComputedStyle(b); return { t: b.textContent.trim().slice(0, 10), c: cs.color, bg: cs.backgroundColor, bd: cs.borderColor }; });
  const count = [...document.querySelectorAll('*')].find(e => /个模板$/.test(e.textContent.trim()) && e.children.length === 0)?.textContent.trim();
  return { rows, cardSizes: [...new Set(cards.map(c => c.join('x')))], cards: cards.length, disabled, count }; })()`;
await page.send("Emulation.setDeviceMetricsOverride", { width: 1400, height: 923, deviceScaleFactor: 1, mobile: false });
const found = (r, what) => { if (r === "notfound" || r === "__skip__") throw new Error(`没有找到${what}`); };

// 场景 S3：四个场景的参数页各进一次。一个场景是一步。
const s3 = run.scene("S3");
const scenarios = ["网站复刻", "幻灯片", "原型", "图片"];
for (const [i, name] of scenarios.entries()) {
  await s3.step({ step: i + 1, do: `进入「${name}」的参数页`, expect: "参数页打开，能填写" }, async (ctx) => {
    if (i === 0) {
      await clickHostTab("我的设计"); await sleep(800);
      found(await clickText("新建设计"), "「新建设计」按钮"); await sleep(1200);
    }
    found(await clickText(name, false), `场景「${name}」`); await sleep(1200);
    await shot(ctx, `new-${name}`);
    ctx.facts(await inPanel(FORM_JS));
    await clickText("重新选择场景"); await sleep(800);
  });
}

// 场景 S4：模板筛选和联动。三步：回到全部，选一个分类，再选一个载体。
const s4 = run.scene("S4");
await s4.step({ step: 1, do: "打开「模板」，筛选选「全部」", expect: "列出全部模板" }, async (ctx) => {
  await clickText("返回工作台"); await sleep(600);
  await clickHostTab("模板"); await sleep(1000);
  await clickText("全部"); await sleep(600);
  await shot(ctx, "tpl-all");
  ctx.facts(await inPanel(TPL_JS));
});
await s4.step({ step: 2, do: "第一行选「学术与教学」", expect: "模板数量变化，别的行跟着联动" }, async (ctx) => {
  found(await clickText("学术与教学"), "分类「学术与教学」"); await sleep(900);
  await shot(ctx, "tpl-category");
  ctx.facts(await inPanel(TPL_JS));
});
await s4.step({ step: 3, do: "第二行选「幻灯片」", expect: "模板数量再变化" }, async (ctx) => {
  found(await clickText("幻灯片"), "载体「幻灯片」"); await sleep(900);
  await shot(ctx, "tpl-surface");
  ctx.facts(await inPanel(TPL_JS));
});

await page.send("Emulation.clearDeviceMetricsOverride");
page.close();
process.exit(run.finish());
