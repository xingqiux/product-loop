(() => {
  const data = JSON.parse(document.getElementById("report-data").textContent);
  const app = document.getElementById("app");
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  // 一个换行符代表一段；同一段里的句子连续显示，不自动拆行
  const lines = (s) => esc(String(s ?? "")).split("\n").filter((l) => l.trim()).map((l) => `<span class="ln">${l}</span>`).join("");
  const fig = (img, cls, label) => img && img.src ? `<figure class="${cls}"><img src="${esc(img.src)}" alt="${esc(img.caption)}" data-cap="${esc(img.caption)}"><figcaption>${label ? `<b>${label}</b>` : ""}${esc(img.caption)}</figcaption></figure>` : "";
  // 固定链接之后每一轮都在同一个地址上，所以按日期、阶段、轮次分开记
  const storeKey = `walk-reply:${data.system}:${data.date}:${data.stage}:${data.round}`;
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(storeKey) || "{}"); } catch { saved = {}; }

  // 块的定义：前缀、类型名、缩写、待决定那一栏叫什么
  const BLOCKS = {
    q: { name: "疑问", ab: "疑", why: "待决定", hint: "理由" },
    f: { name: "发现", ab: "发", why: "哪里不舒服", hint: "理由" },
    p: { name: "提升", ab: "提", why: "替用户解决什么", hint: "理由" },
    r: { name: "回到构思", ab: "回", why: "质疑的是哪一样", hint: "理由" },
    c: { name: "更改", ab: "改" },
  };

  const cur0 = (data.current || [])[0];
  const strip = `
    <details class="strip" id="strip">
      <summary><span class="pills">${(data.progress || []).map((x) => `<i class="${esc(x.state)}">${esc(x.stage)}</i>`).join("")}</span>${cur0 ? `<span class="now"><b>当前</b>${esc(cur0.problem)}</span>` : ""}<span class="more">展开</span></summary>
      <ol class="steps">
        ${(data.progress || []).map((x, k) => `<li class="step ${esc(x.state)}"><span class="dot">${x.state === "done" ? "✓" : k + 1}</span><div class="sb"><div class="name">${esc(x.stage)}${x.state === "current" ? `<small>现在</small>` : ""}</div><div class="sum">${esc(x.summary)}</div></div></li>`).join("")}
      </ol>
      ${(data.screens || []).length ? `<div class="seen"><span class="label">这一轮看过</span>${data.screens.map((x) => `<span class="sc">${esc(x.name)}</span>`).join("")}</div>` : ""}
      ${(data.current || []).length ? `<div class="current"><div class="label">当前</div><ol>${data.current.map((c) => `<li><b>${esc(c.problem)}</b>：${esc(c.fix)}</li>`).join("")}</ol></div>` : ""}
    </details>`;
  const head = `
    <div class="head">
      <h1>${esc(data.system)}</h1>
      <span class="chip">${esc(data.stage)}</span>
      <span class="chip round">第 ${esc(data.round)} 轮</span>
      <span class="muted">${esc(data.date)}</span>
    </div>
    ${strip}
  `;

  // ---- 证据可视化：从数据画，不手写 HTML
  const viz = (e) => {
    if (!e) return "";
    if (Array.isArray(e)) return e.map(viz).join("");
    const cap = e.caption ? `<div class="cap">${esc(e.caption)}</div>` : "";
    switch (e.type) {
      case "sizes": {
        const keep = new Set((e.keep || []).map(Number));
        const unit = e.unit || "px";
        return `<div class="viz-sizes">${(e.values || []).map((v) => `<div class="it${keep.has(Number(v)) ? " keep" : ""}"><div class="dot" style="width:${Number(v)}px;height:${Number(v)}px"></div><span>${esc(v)}${esc(unit)}</span></div>`).join("")}</div>${cap}`;
      }
      case "swatches":
        return `<div class="viz-swatches">${(e.values || []).map((v) => `<div class="it"><div class="sw" style="background:${esc(v.hex)}"></div><span>${esc(v.name || "")}</span><span>${esc(v.hex)}</span></div>`).join("")}</div>${cap}`;
      case "type":
        return `<div class="viz-type">${(e.values || []).map((v) => `<div class="it"><span style="font-size:${Number(v.size)}px;font-weight:${Number(v.weight) || 400};line-height:1.2">${esc(v.sample || "设计评审 从提交到定稿 Aa 12")}</span><span class="sm">${esc(v.size)}px${v.weight ? " " + esc(v.weight) : ""}</span></div>`).join("")}</div>${cap}`;
      case "spacing": {
        const keep = e.keep ? new Set(e.keep.map(Number)) : null;
        return `<div class="viz-spacing">${(e.values || []).map((v) => `<div class="it${keep && !keep.has(Number(v)) ? " off" : ""}"><div class="bar" style="width:${Math.max(2, Number(v)) * 3}px"></div><span>${esc(v)}px</span></div>`).join("")}${keep ? `<div class="cap">短的按比例画，不在档上的是灰的</div>` : ""}</div>${cap}`;
      }
      case "live": {
        // 真组件：脚本从真实界面抠出来的 HTML 和生效样式，隔在 iframe 里，能悬停、点、看它动
        const toggles = e.toggles || [];
        const doc = `<!doctype html><meta charset="utf-8"><style>html,body{margin:0}body{padding:16px;background:${e.bg || "#fff"};font:13px/1.5 system-ui,sans-serif}#tg{display:flex;gap:6px;flex-wrap:wrap;margin-top:14px;padding-top:10px;border-top:1px dashed #ccc}#tg button{font:12px system-ui;padding:3px 8px;border:1px solid #bbb;border-radius:6px;background:#fff;color:#333;cursor:pointer}#tg button.on{background:#222;color:#fff;border-color:#222}</style><style>${e.css || ""}</style><div id="stage">${String(e.html || "").replace(/<script[\s\S]*?<\/script>/gi, "")}</div><div id="tg"></div><scr${""}ipt>const T=${JSON.stringify(toggles).replace(/</g, "\\u003c")};const tg=document.getElementById("tg");T.forEach(t=>{const b=document.createElement("button");b.textContent=t.label;b.onclick=()=>{const on=b.classList.toggle("on");document.querySelectorAll("#stage "+(t.selector||"> *")).forEach(el=>{if(t.class)el.classList.toggle(t.class,on);if(t.attr)el.setAttribute(t.attr,on?(t.on??"true"):(t.off??"false"));});};tg.appendChild(b);});</scr${""}ipt>`;
        return `<iframe class="viz-live" sandbox="allow-scripts" style="width:100%;border:1px solid var(--line, #ddd);border-radius:8px;height:${Number(e.height) || 160}px" srcdoc="${esc(doc)}"></iframe><div class="cap">真组件，可以悬停、点；下面的按钮切换条件</div>${cap}`;
      }
      case "image":
        return fig({ src: e.src, caption: e.caption }, "", "");
      case "excerpt":
        return `<pre>${esc(e.text)}</pre>${cap}`;
      default:
        return e.src ? fig(e, "", "") : "";
    }
  };
  // 问题出现的位置：哪个场景、哪一步。场景和步骤都写名字，编号只用来点亮格子
  const vizWhere = (w) => {
    if (!w || !w.scenario) return "";
    const total = Number(w.scenarios) || Math.max(9, Number(w.scenario));
    const steps = Number(w.steps) || Number(w.step) || 0;
    const scen = Array.from({ length: total }, (_, i) => `<span class="c${i + 1 === Number(w.scenario) ? " on" : ""}">${i + 1}</span>`).join("");
    const dots = steps ? `<div class="lb">步骤</div><div class="nm">${esc(w.stepText || `第 ${w.step} 步`)}</div><div class="row">${Array.from({ length: steps }, (_, i) => `<span class="d${i + 1 === Number(w.step) ? " on" : ""}"></span>`).join("")}</div>` : "";
    return `<div class="viz-where"><div class="hd">问题出现的位置</div><div class="lb">场景</div><div class="nm">${esc(w.title || `场景 ${w.scenario}`)}</div><div class="row">${scen}</div>${dots}</div>`;
  };
  const vizPrior = (p) => p && p.length ? `<ul class="viz-list">${p.map((x) => `<li>${x.id !== undefined ? `<span class="id">决定 ${esc(x.id)}</span>` : ""}${esc(x.text)}</li>`).join("")}</ul>` : "";
  const vizImpact = (im) => im && im.length ? `<table class="viz-impact">${im.map((x) => `<tr><td>${esc(x.row)}</td><td class="sc">${(x.scenarios || []).map((s) => `场景 ${esc(s)}`).join("　")}</td></tr>`).join("")}</table>` : "";
  const srcPanel = (s) => s.kind === "file" || s.excerpt ? `<pre>${esc(s.excerpt || "")}</pre><div class="cap">${esc(s.label)}</div>` : fig({ src: s.src, caption: s.label }, "", "");

  // ---- 右栏：只放看的东西，直接展示，一样一块往下排。不放说明文字，不放按钮，不放纯文字摘录
  // ---- 横向展开的骨架：问题和待决定；来源一排，每个来源的字和它的图在同一格；证据一排；选项并排成列，同一行对同一行
  // 来源：每条写这样东西叫什么、在它上面看到了什么，图就在这一格里。用户说过的话是原话，不配图
  const srcRow = (f) => {
    const list = Array.isArray(f.sources) ? f.sources : [];
    if (!list.length) return f.saw ? `<div class="lab">来源</div><div class="saw">${lines(f.saw)}</div>` : "";
    let k = 0;
    return `<div class="lab">来源</div><div class="srcrow">${list.map((x) => {
      const q = !!x.quote; if (!q) k += 1;
      return `<div class="srccell${q ? " quote" : ""}"><div class="sh"><span class="sn${q ? " q" : ""}">${q ? "话" : k}</span><span class="snm">${esc(x.name)}</span></div>${x.saw ? `<div class="ssaw">${lines(x.saw)}</div>` : ""}${!q && x.src ? `<figure class="sfig"><img src="${esc(x.src)}" alt="${esc(x.name)}" data-cap="${esc(x.name)}" loading="lazy"></figure>` : ""}</div>`;
    }).join("")}</div>`;
  };
  // 图表：文字定义交给图表库去画；目录树用等宽文字。图表库加载失败时，显示文字定义本身
  const diagramHtml = (g) => `<figure class="dg" data-kind="${esc(g.kind)}"><figcaption class="dg-t"><span class="dg-k">${esc(g.kind)}</span>${esc(g.title)}</figcaption>${g.kind === "目录树" ? `<pre class="dg-tree">${esc(g.code)}</pre>` : `<pre class="dg-code">${esc(g.code)}</pre>`}</figure>`;
  // 证据：画出来的尺寸、颜色、字号、间距、真组件、问题出现的位置、线稿、操作流程。一样一格，横着排
  const evRow = (f) => {
    const evs = (f.evidence ? (Array.isArray(f.evidence) ? f.evidence : [f.evidence]) : []).filter((e) => e && e.type !== "excerpt");
    const blocks = evs.map((e) => viz(e));
    if (!evs.length && f.image && f.image.src) blocks.push(fig(f.image, "", ""));
    if (f.where && f.where.scenario) blocks.push(vizWhere(f.where));
    (f.diagrams || []).forEach((g) => blocks.push(diagramHtml(g)));
    if (f.mock) blocks.push(`<div class="mock">${f.mock}${f.mockCaption ? `<div class="cap">${esc(f.mockCaption)}</div>` : ""}</div>`);
    if (f.flow && f.flow.length) blocks.push(`<div class="flow">${f.flow.map((t, k) => `${k ? "<i>→</i>" : ""}<span>${esc(t)}</span>`).join("")}</div>`);
    const html = blocks.filter(Boolean).map((b) => `<div class="evcell">${b}</div>`).join("");
    return html ? `<div class="lab">证据</div><div class="evrow">${html}</div>` : "";
  };
  const optRow = (label, text) => `<div class="orow${text ? "" : " none"}">${text ? `<span class="t">${label}</span><span class="v">${lines(text)}</span>` : ""}</div>`;

  // 选项部分：独立成一个函数，卡片的其他部分不关心选项怎么摆
  const optionsBlock = (f, prefix, n, pick, B) => {
    const opts = f.options || [];
    if (!opts.length) return "";
    // 共同的部分只写一遍；选项是列，行名在左边只写一遍：各处差别、理由、代价、适用场景
    const names = [...(f.rows || []), B.hint, "代价", "适用场景"];
    const sh = f.shared && f.shared.text ? `<div class="lab">共同的部分</div><div class="shared"><p>${lines(f.shared.text)}</p>${(f.shared.diagrams || []).map(diagramHtml).join("")}</div>` : "";
    const cols = opts.length + (f.only ? 1 : 0);
    return `${sh}<div class="lab">${f.only ? "只有这一个方向" : "选项"}</div><div class="optcols" style="--n:${cols};--r:${names.length + 2}">
          <div class="rns" aria-hidden="true"><div class="rn"></div>${names.map((x) => `<div class="rn">${esc(x)}</div>`).join("")}<div class="rn"></div></div>
          ${opts.map((o) => `
            <label class="opt${pick === o.key ? " is-on" : ""}">
              <input type="radio" name="${prefix}${n}" value="${esc(o.key)}"${pick === o.key ? " checked" : ""}>
              <span class="ck">✓</span>
              <div class="ot"><span class="k">${esc(o.key)}</span><span class="otx">${esc(o.title)}</span>${f.stance && f.stance.pick === o.key ? `<span class="aipick">我的看法</span>` : ""}</div>
              ${names.map((x, k) => optRow(x, k < (f.rows || []).length ? (o.diffs || [])[k] : [o.why, o.cost, o.when][k - (f.rows || []).length])).join("")}
              <div class="sk">${o.sketch || ""}</div>
            </label>`).join("")}
          ${f.only ? `<label class="opt veto${pick === "否决" ? " is-on" : ""}"><input type="radio" name="${prefix}${n}" value="否决"${pick === "否决" ? " checked" : ""}><span class="ck">✓</span><div class="ot"><span class="k">否决</span>为什么，写在备注里</div></label>` : ""}
        </div>`;
  };

  const cards = (list, prefix) => (list || []).map((f, i) => {
    const n = i + 1;
    const pick = saved[`${prefix}${n}`] || "";
    const B = BLOCKS[prefix];
    const opts = f.options || [];
    return `
      <section class="card pane" id="${prefix}${n}" data-key="${prefix}${n}" data-n="${n}" data-has-opts="${opts.length ? 1 : 0}">
        <div class="chead"><span class="ptype">${B.name}</span><span class="num">${n}</span><h3>${esc(f.title)}</h3>${f.tag ? `<span class="tag">${esc(f.tag)}</span>` : ""}</div>
        ${prefix === "q" ? `<div class="al-warn" data-title="${esc(f.title)}" hidden></div>` : ""}
        ${f.why ? `<div class="lab">${B.why}</div><p class="why">${lines(f.why)}</p>` : ""}
        ${srcRow(f)}
        ${evRow(f)}
        ${optionsBlock(f, prefix, n, pick, B)}
        ${(f.dropped || []).length ? `<div class="lab">排除的方向</div><table class="dropped">${f.dropped.map((x) => `<tr><td class="dn">${esc(x.name)}</td><td class="db">${lines(x.because)}</td></tr>`).join("")}</table>` : ""}
        <div class="nextrow" hidden><button type="button" class="nx">下一条</button></div><div class="foot">${f.stance ? `<div class="stance">${stanceHtml(f.stance)}</div>` : ""}<div class="note"><textarea name="n${prefix}${n}" placeholder="备注（可不填）">${esc(saved[`n${prefix}${n}`] || "")}</textarea></div></div>
      </section>`;
  }).join("");
  // 固定两行：我的看法是 a / 因为……。旧数据「站 a。理由」也转成这个样子
  function stanceHtml(st) {
    let pick = "", because = "";
    if (st && typeof st === "object") { pick = st.pick || ""; because = st.because || ""; }
    else {
      const t = String(st || "");
      const m = t.match(/^(我的看法是|我站|站)\s*([a-z])(。|,|，|\s|$)/i);
      if (m) { pick = m[2]; because = t.slice(m[0].length).replace(/^[。，,\s]+/, ""); } else because = t;
    }
    because = String(because).replace(/^因为[，,：:\s]*/, "");
    return `${pick ? `<div class="ln"><span class="pick">我的看法是 ${esc(pick)}</span></div>` : ""}${because ? lines("因为 " + because) : ""}`;
  }

  const bhead = (key, heading, n, hint) => `<h2 id="h-${key}" class="bh b-${key}"><span class="bmark"></span>${heading}${n ? `<span class="bn">${n} 条</span>` : ""}${hint ? `<span class="bhint">${hint}</span>` : ""}</h2>`;
  const block = (key, list, heading) => (list || []).length ? `<div class="blk b-${key}">${bhead(key, heading, list.length, "要你点")}${cards(list, key)}</div>` : "";
  const asks = block("q", data.asks, "疑问");
  const findings = block("f", data.findings, "发现问题");
  const improvements = block("p", data.improvements, "提升");
  const rethink = block("r", data.rethink, "回到构思");

  // 文字的更改：逐行对比。删的涂红划线，加的涂绿；对比在生成网页的时候已经算好，这里只上色
  const tdiff = (c) => `<div class="tdiff">${c.textName ? `<div class="tn">${esc(c.textName)}</div>` : ""}${c.diff.map((r) => r.k === "gap" ? `<div class="tr gap">……</div>` : `<div class="tr ${r.k}"><span class="tm">${r.k === "del" ? "−" : r.k === "ins" ? "+" : r.k === "mix" ? "±" : ""}</span><span class="tx">${r.parts.map(([k, t]) => k === "same" ? esc(t) : `<${k === "del" ? "del" : "ins"}>${esc(t)}</${k === "del" ? "del" : "ins"}>`).join("") || "&nbsp;"}</span></div>`).join("")}</div>`;

  const changes = (data.changes || []).length ? `
    ${bhead("c", "更改", data.changes.length, "给你验收，不用点")}
    ${data.changes.map((c, i) => `
      <section class="change pane" id="c${i + 1}">
        <h3><span class="ptype">更改</span>${i + 1}　${esc(c.title)}</h3>
        <div class="cf"><div class="cfb"><span class="t">之前</span><div>${lines(c.problem)}</div></div><div class="cfa"><span class="t">现在</span><div>${lines(c.fix)}</div></div></div>
        ${c.diff ? tdiff(c) : `<div class="pair framed${c.before && c.before.src ? "" : " single"}">${fig(c.before, "before", "改前")}${fig(c.after, "after", "改后")}</div>`}
        ${(c.more || []).length ? `<div class="pair" style="margin-top:14px">${c.more.map((m) => fig(m, "after", "改后")).join("")}</div>` : ""}
      </section>`).join("")}
  ` : "";

  // 使用：每个场景一行，走通了还是断在哪一步；断的地方配截图；下面是覆盖表的缺口。只给人看，不用点
  const U = data.usage || {};
  const usage = (U.scenes || []).length ? `
    <section class="pane" id="pane-u">${bhead("u", "使用", U.scenes.length, "给你看，不用点")}
    <div class="usage">${U.scenes.map((u) => `
      <div class="urow ${u.state === "走通" ? "ok" : "bad"}">
        <span class="ust">${esc(u.state)}</span>
        <div class="ubody"><div class="unm">${esc(u.name)}</div>${u.stepText ? `<div class="ustep">${lines(u.stepText)}</div>` : ""}${(u.shots || []).length ? `<div class="ushots">${u.shots.map((x) => fig(x, "", "")).join("")}</div>` : ""}</div>
      </div>`).join("")}
    </div>
    ${(U.gaps || []).length ? `<h3 class="ugh">还没有被任何场景用到的</h3><ul class="ugaps">${U.gaps.map((g) => `<li>${esc(g)}</li>`).join("")}</ul>` : ""}</section>
  ` : "";

  // 场景清单：只在构思阶段出现。视觉优先：每个场景一条，步骤摊开成一串格子，上面做什么，下面该看到什么。保留、修改、删除落在场景上
  const SC = data.stage === "构思" ? (data.scenes || []) : [];
  const scenesBlock = SC.length ? `
    <section class="pane" id="pane-scenes">${bhead("scenes", "场景清单", SC.length, "每个场景点保留、修改或删除")}
    <div class="scenes">${SC.map((x, i) => `
      <section class="scn" id="s${i + 1}" data-name="${esc(x.name)}">
        <div class="scn-h"><div><span class="scn-nm">${esc(x.name)}</span>${x.mark ? `<span class="scn-mark">${esc(x.mark)}</span>` : ""}${x.who ? `<div class="scn-who">${esc(x.who)}</div>` : ""}</div>
          <div class="scn-act">${["保留", "修改", "删除"].map((v) => `<label><input type="radio" name="scn${i + 1}" value="${v}" ${(saved[`s${i + 1}`] || "") === v ? "checked" : ""}><span>${v}</span></label>`).join("")}</div></div>
        <div class="scn-steps">${(x.steps || []).map((st, k) => `<div class="scn-step"><div class="sn">${k + 1}</div><div class="sd">${esc(st.do)}</div><div class="ss">${esc(st.see)}</div>${st.src ? `<figure><img src="${esc(st.src)}" alt="${esc(st.do)}" data-cap="${esc(x.name)}：${esc(st.do)}" loading="lazy"></figure>` : ""}</div>`).join("")}</div>
        <textarea class="scn-edit" rows="2" placeholder="改哪一行，怎么改" ${(saved[`s${i + 1}`] || "") === "修改" ? "" : "hidden"}>${esc(saved[`ns${i + 1}`] || "")}</textarea>
      </section>`).join("")}
    </div></section>` : "";

  // 先对齐：本页选项会用到的术语，排在疑问前面。每个术语一张小卡，下面是明白、不明白和一个选填的输入框
  const AL = data.align || [];
  const alignPane = AL.length ? `<section class="pane" id="pane-align">${bhead("align", "先对齐", AL.length, "每个术语点明白或不明白")}
    <div class="als">${AL.map((a, i) => `
      <section class="al" id="a${i + 1}" data-name="${esc(a.name)}" data-used="${esc(JSON.stringify(a.usedIn || []))}">
        <div class="al-h"><span class="al-nm">${esc(a.name)}</span>
          <div class="scn-act">${["明白", "不明白"].map((v) => `<label><input type="radio" name="al${i + 1}" value="${v}" ${(saved[`a${i + 1}`] || "") === v ? "checked" : ""}><span>${v}</span></label>`).join("")}</div></div>
        <dl class="al-f"><dt>用在</dt><dd>${(a.usedIn || []).map((u) => `「${esc(u)}」`).join("")}</dd><dt>意思</dt><dd>${lines(a.meaning)}</dd><dt>例子</dt><dd>${lines(a.example)}</dd></dl>
        ${a.diagram ? diagramHtml(a.diagram) : ""}
        <input class="al-say" type="text" placeholder="用自己的话说一遍（可不填）" value="${esc(saved[`na${i + 1}`] || "")}">
      </section>`).join("")}
    </div></section>` : "";

  // 参考：外面看来的东西。概览一行一条，点开才是整张卡
  const REFS = data.refs || [];
  const REF_SHOWN = 8;  // 一组先显示八条再折叠
  const refsPane = REFS.length ? `<section class="pane" id="pane-refs">${bhead("refs", "参考", REFS.length, "点一条看它说了什么")}
    <div class="rfs">${REFS.map((r, i) => `<button type="button" class="rf${i >= REF_SHOWN ? " rf-hid" : ""}" data-n="${i}"><span class="rf-nm">${esc(r.name)}</span><span class="rf-kd">${esc(r.kind)}</span><span class="rf-ad">${esc(r.advice)}</span></button>`).join("")}${REFS.length > REF_SHOWN ? `<button type="button" class="rf-more">还有 ${REFS.length - REF_SHOWN} 条，全部展开</button>` : ""}</div></section>` : "";

  const SP = data.stage === "构思" ? (data.spec || []) : [];
  const specimen = (x) => {
    const v = x.values || [];
    switch (x.kind) {
      case "colors": return `<div class="sp-colors">${v.map((c) => `<div class="it"><u style="background:${esc(c.hex)}"></u><b>${esc(c.name)}</b><span>${esc(c.hex)}</span></div>`).join("")}</div>`;
      case "type": return `<div class="sp-type">${v.map((t) => `<div class="it"><span style="font-size:${Number(t.size)}px;font-weight:${Number(t.weight) || 400};line-height:1.25">${esc(t.sample || t.name)}</span><small>${esc(t.name)}　${esc(t.size)}px${t.weight ? "　" + esc(t.weight) : ""}</small></div>`).join("")}</div>`;
      case "radius": return `<div class="sp-radius">${v.map((r) => `<div class="it"><u style="border-radius:${Number(r)}px"></u><small>${esc(r)}px</small></div>`).join("")}</div>`;
      case "spacing": return `<div class="sp-spacing">${v.map((g) => `<div class="it"><u style="width:${Number(g)}px"></u><small>${esc(g)}px</small></div>`).join("")}</div>`;
      case "motion": return `<div class="sp-motion">${v.map((m, k) => `<button type="button" class="mo" data-ms="${Number(m.ms) || 200}" data-ease="${esc(m.easing || "ease")}" data-fx="${esc(m.effect || "move")}"><i></i><span>${esc(m.name)}</span><small>${Number(m.ms) || 200} 毫秒　${esc(m.easing || "ease")}</small></button>`).join("")}<div class="cap">点一下看它动</div></div>`;
      case "table": {
        const cols = x.columns || [];
        const cell = (c, val) => {
          const as = (c && c.as) || "text";
          if (val && typeof val === "object") return `<span class="stt ${esc(val.tone || "todo")}">${esc(val.text || "")}</span>`;
          if (as === "color") return `<span class="sp-sw" style="background:${esc(val)}"></span><code>${esc(val)}</code>`;
          if (as === "strong") return `<b>${esc(val)}</b>`;
          return `<span class="sp-c ${esc(as)}">${esc(val)}</span>`;
        };
        return `<div class="sp-table"><table><thead><tr>${cols.map((c) => `<th>${esc(c.name)}</th>`).join("")}</tr></thead><tbody>${(x.rows || []).map((r) => `<tr>${r.map((val, k) => `<td>${cell(cols[k], val)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
      }
      default: return `<div class="sp-text">${lines(x.text || "")}</div>`;
    }
  };
  const specBlock = SP.length ? `
    <section class="pane" id="pane-spec">${bhead("spec", "设计规范", SP.length, "每一格点保留、修改或删除")}
    <div class="specwall">${SP.map((x, i) => `
      <div class="spi${x.kind === "colors" || x.kind === "type" || x.kind === "table" ? " wide" : ""}" id="g${i + 1}" data-name="${esc(x.name)}">
        <div class="spi-h"><b>${esc(x.name)}</b>${x.for ? `<span class="spi-for">用在：${esc(x.for)}</span>` : ""}${x.note ? `<span class="spi-note">${esc(x.note)}</span>` : ""}<div class="scn-act">${["保留", "修改", "删除"].map((v) => `<label><input type="radio" name="spec${i + 1}" value="${v}" ${(saved[`g${i + 1}`] || "") === v ? "checked" : ""}><span>${v}</span></label>`).join("")}</div></div>
        ${specimen(x)}
        <textarea class="spi-edit" rows="2" placeholder="改哪一行，怎么改" ${(saved[`g${i + 1}`] || "") === "修改" ? "" : "hidden"}>${esc(saved[`ng${i + 1}`] || "")}</textarea>
      </div>`).join("")}
    </div></section>` : "";

  // 队列：一份只由队列脚本写入的数据，这里直接摆成看板。小卡只给简略，点开是展示卡片
  const STAGES = ["构思", "使用", "检查", "落地", "提升"];
  const STALE = 7;  // 停了七天还没轮到的，显示得淡一些
  const QU = (data.queue || []).map((x, i) => ({ ...x, n: String(i) }));
  const qdays = (s) => { const a = Date.parse(s), b = Date.parse(data.date); return Number.isNaN(a) || Number.isNaN(b) ? 0 : Math.max(0, Math.round((b - a) / 86400000)); };
  const qDropped = new Set(saved.qdrop || []);
  const qwaiting = QU.filter((x) => x.state === "等待");
  const qboard = QU.filter((x) => x.state !== "等待");
  const qtone = (s) => (s === "进行中" ? "doing" : s === "等待" ? "wait" : "todo");
  const qcard = (x, cls) => `<div class="${cls}${qdays(x.since) > STALE ? " stale" : ""}${qDropped.has(x.text) ? " cut" : ""}" data-n="${x.n}" role="button" tabindex="0"><span class="qst ${qtone(x.state)}">${esc(x.state)}</span><div class="qx">${esc(x.text)}</div>${cls === "qwi" ? `<div class="qw">在等${esc(x.dep || x.note || "别的事")}</div>` : ""}</div>`;
  const queue = `<section class="pane" id="pane-queue">${bhead("queue", "队列", QU.length, "还没做、先停着的事")}
    ${qwaiting.length ? `<div class="qwait"><div class="qwh">在等别的事，轮不到</div><div class="qwl">${qwaiting.map((x) => qcard(x, "qwi")).join("")}</div></div>` : ""}
    <div class="board">${STAGES.map((st) => { const items = qboard.filter((x) => x.stage === st); return `<div class="lane${st === data.stage ? " now" : ""}${items.length ? "" : " none"}"><div class="ln-h"><span>${st}</span><span class="ln-n">${items.length || ""}</span></div>${items.length ? items.map((x) => qcard(x, "qi")).join("") : `<div class="qempty">空</div>`}</div>`; }).join("")}</div></section>`;

  // 工程证据：落地的页才有。四样：重构、先失败后通过、评审的意见和处置、AI 自己裁决的。数据由生成网页的脚本从落地的记录里摆进来
  const LD = data.land && data.land.tidy && Array.isArray(data.land.changes) && Array.isArray(data.land.review) && Array.isArray(data.land.rulings) ? data.land : null;
  const landPane = LD ? `<section class="pane" id="pane-land">${bhead("land", "工程证据", 0, "给你看，不用点")}<div class="ld">
    <div class="ld-b"><div class="ld-h">重构</div><p>${LD.tidy.skipped ? "本轮不需要重构，理由写在计划里。" : `重构单独提交为 <code>${esc(LD.tidy.commit)}</code>。重构之后执行 <code>${esc(LD.tidy.cmd)}</code>，结果为通过。`}</p></div>
    <div class="ld-b"><div class="ld-h">先失败后通过</div><table class="ld-t ld-ch"><thead><tr><th>改动</th><th>改之前</th><th>改之后</th></tr></thead><tbody>${LD.changes.map((c) => `<tr><td><b>${esc(c.name)}</b><details class="ld-cmd"><summary>命令和输出</summary><div class="ld-cl">前后执行的是同一条命令</div><code>${esc(c.cmd)}</code><div class="ld-cl">改之前的输出</div><code>${esc((c.red || [])[0] || "")}</code></details></td><td class="ld-red">检查失败</td><td class="ld-green">检查通过</td></tr>`).join("")}</tbody></table></div>
    <div class="ld-b"><div class="ld-h">评审的意见和处置</div>${LD.review.length ? `<table class="ld-t ld-rv"><thead><tr><th>哪里</th><th>轻重</th><th>意见</th><th>处置</th></tr></thead><tbody>${LD.review.map((r) => `<tr><td><code>${esc(r.file)}:${esc(r.line)}</code></td><td><span class="stt ${r.level === "阻塞" ? "wait" : "todo"}">${esc(r.level)}</span></td><td>${esc(r.text)}</td><td>${esc(r.disposition || "")}</td></tr>`).join("")}</tbody></table>` : `<p class="ld-rv">评审的子代理没有提意见。</p>`}</div>
    <div class="ld-b"><div class="ld-h">AI 自己裁决的</div>${LD.rulings.length ? `<table class="ld-t"><thead><tr><th>裁决</th><th>理由</th><th>错了的代价</th></tr></thead><tbody>${LD.rulings.map((r) => `<tr>${(r || []).map((c, i) => `<td>${i ? esc(c) : `<b>${esc(c)}</b>`}</td>`).join("")}</tr>`).join("")}</tbody></table>` : `<p>这一轮没有。</p>`}</div>
  </div></section>` : "";

  const anyCards = ["asks", "findings", "improvements", "rethink"].some((k) => (data[k] || []).length) || (data.stage === "构思" && ((data.scenes || []).length > 0 || (data.spec || []).length > 0));
  const ideas = `
    <aside class="reply" id="rail">
      <div class="rl-h" id="h-reply">回复</div>
      <span class="remain" id="remain-bottom"></span>
      <pre id="reply-text" class="replytext"></pre>
      <div class="rbox"><textarea id="ideas-bar" rows="1" placeholder="想到的写在这里，会一起复制。也可以粘贴截图">${esc(saved.ideas || "")}</textarea><div class="shots" id="shots" hidden></div></div>
      <button class="btn" id="copy">复制回复</button>
    </aside>
  `;

  // 目录：每张卡一行
  const tocGroup = (key, list) => (list || []).length ? `<div class="tg"><div class="tl">${BLOCKS[key].name}</div>${list.map((f, i) => `<a href="#${key}${i + 1}" data-for="${key}${i + 1}"><span class="ck">✓</span><span class="ab">${i + 1}</span><span class="tt">${esc(f.title)}</span><span class="pk"></span></a>`).join("")}</div>` : "";
  const toc = `
    <aside class="toc">
      ${(U.scenes || []).length ? `<div class="tg"><div class="tl">使用</div>${U.scenes.map((u) => `<a href="#pane-u" data-for="pane-u"><span class="ck"></span><span class="ab">${u.state === "走通" ? "" : "!"}</span><span class="tt">${esc(u.name)}</span></a>`).join("")}</div>` : ""}
      ${SC.length ? `<div class="tg"><div class="tl">场景清单</div>${SC.map((x, i) => `<a href="#pane-scenes" data-for="pane-scenes" data-item="s${i + 1}"><span class="ck">✓</span><span class="ab">${i + 1}</span><span class="tt">${esc(x.name)}</span></a>`).join("")}</div>` : ""}${SP.length ? `<div class="tg"><div class="tl">设计规范</div>${SP.map((x, i) => `<a href="#pane-spec" data-for="pane-spec" data-item="g${i + 1}"><span class="ck">✓</span><span class="ab">${i + 1}</span><span class="tt">${esc(x.name)}</span></a>`).join("")}</div>` : ""}${AL.length ? `<div class="tg"><div class="tl">先对齐</div>${AL.map((a, i) => `<a href="#pane-align" data-for="pane-align" data-item="a${i + 1}"><span class="ck">✓</span><span class="ab">${i + 1}</span><span class="tt">${esc(a.name)}</span></a>`).join("")}</div>` : ""}${tocGroup("q", data.asks)}${tocGroup("f", data.findings)}${tocGroup("p", data.improvements)}${tocGroup("r", data.rethink)}
      ${(data.changes || []).length ? `<div class="tg"><div class="tl">更改</div>${data.changes.map((c, i) => `<a href="#c${i + 1}" data-for="c${i + 1}" data-seen="1"><span class="ck">✓</span><span class="ab">${i + 1}</span><span class="tt">${esc(c.title)}</span></a>`).join("")}</div>` : ""}
      ${REFS.length ? `<div class="tg"><div class="tl">参考</div><a href="#pane-refs" data-for="pane-refs"><span class="ck"></span><span class="ab"></span><span class="tt">${REFS.length} 条外面看来的</span></a></div>` : ""}
      ${LD ? `<div class="tg"><div class="tl">工程证据</div><a href="#pane-land" data-for="pane-land"><span class="ck"></span><span class="ab"></span><span class="tt">重构、先失败后通过、评审</span></a></div>` : ""}
      <div class="remain" id="remain-toc"></div>
      <div class="tg tq"><div class="tl">队列</div><a href="#pane-queue" data-for="pane-queue"><span class="ck"></span><span class="ab"></span><span class="tt">${(data.queue || []).length ? `还没做、先停着的事` : "空"}</span></a></div>
    </aside>`;

  let sideOff = false;
  try { sideOff = localStorage.getItem("walk-side-off") === "1"; } catch {}
  app.innerHTML = `<div class="topbar" id="remain-top"></div><div class="layout${sideOff ? " side-off" : ""}" id="layout"><div class="sidebar" id="sidebar"><button type="button" class="side-tg" id="side-tg" aria-expanded="${sideOff ? "false" : "true"}" aria-controls="sidebar"><span class="tg-ic">${sideOff ? "›" : "‹"}</span><span class="tg-tx">${sideOff ? "展开" : "收起"}</span></button>${toc}${ideas}</div><div class="main">${head}<div class="pager" id="pager"><button type="button" id="pg-prev">上一条</button><span id="pg-at"></span><button type="button" id="pg-next">下一条</button></div>${usage}${scenesBlock}${specBlock}${alignPane}${asks}${findings}${improvements}${rethink}${changes}${refsPane}${landPane}${queue}</div></div>`;
  // 右边一栏：目录和回复在一起，可以收起；收起之后正文用满宽度，记住这个人的选择
  document.getElementById("side-tg").addEventListener("click", (e) => {
    const off = document.getElementById("layout").classList.toggle("side-off");
    const b = e.currentTarget; b.setAttribute("aria-expanded", off ? "false" : "true");
    b.querySelector(".tg-ic").textContent = off ? "›" : "‹"; b.querySelector(".tg-tx").textContent = off ? "展开" : "收起";
    try { localStorage.setItem("walk-side-off", off ? "1" : "0"); } catch {}
  });

  // ---- 列表加详情：宽屏上右边一次只摆一屏；窄屏上所有的屏一条接一条往下排
  const panes = Array.from(document.querySelectorAll(".pane"));
  const order = []; document.querySelectorAll(".toc a[data-for]").forEach((a) => { if (!order.includes(a.dataset.for)) order.push(a.dataset.for); });
  const wideNow = () => window.matchMedia("(min-width: 1100px)").matches;
  let seen = new Set(saved.seen || []);
  let active = "";
  const activate = (id, scroll) => {
    if (!document.getElementById(id)) return;
    active = id;
    panes.forEach((x) => x.classList.toggle("on", x.id === id));
    document.querySelectorAll(".toc a[data-for]").forEach((a) => a.classList.toggle("on", a.dataset.for === id));
    if (/^c\d+$/.test(id)) { seen.add(id); saved.seen = [...seen]; try { localStorage.setItem(storeKey, JSON.stringify({ ...saved, imgs: (saved.imgs || []).filter((x) => x.id).map(({ local, ...x }) => x) })); } catch {} }
    document.querySelectorAll(".toc a[data-seen]").forEach((a) => a.classList.toggle("done", seen.has(a.dataset.for)));
    const k = order.indexOf(id);
    const at = document.getElementById("pg-at"); if (at) at.textContent = k >= 0 ? `${k + 1} / ${order.length}` : "";
    const pv = document.getElementById("pg-prev"), nx = document.getElementById("pg-next");
    if (pv) pv.disabled = k <= 0; if (nx) nx.disabled = k < 0 || k >= order.length - 1;
    if (scroll) { if (wideNow()) window.scrollTo({ top: 0 }); else document.getElementById(id).scrollIntoView({ behavior: "smooth", block: "start" }); }
  };
  document.querySelectorAll(".toc a[data-for]").forEach((a) => a.addEventListener("click", (e) => {
    e.preventDefault(); activate(a.dataset.for, true);
    if (a.dataset.item) { const el = document.getElementById(a.dataset.item); if (el) el.scrollIntoView({ behavior: "smooth", block: "center" }); }
  }));
  const step = (d) => { const k = order.indexOf(active); const to = order[k + d]; if (to) activate(to, true); };
  document.getElementById("pg-prev").addEventListener("click", () => step(-1));
  document.getElementById("pg-next").addEventListener("click", () => step(1));
  document.addEventListener("keydown", (e) => { if (e.target.closest("textarea, input")) return; if (e.key === "ArrowLeft") step(-1); if (e.key === "ArrowRight") step(1); });

  // ---- 状态：还剩几条、目录打勾、复制文本
  const remaining = () => {
    let n = 0; let first = null;
    document.querySelectorAll(".card").forEach((sec) => {
      const hasOpts = sec.dataset.hasOpts === "1";
      const on = sec.querySelector("input:checked");
      const note = sec.querySelector("textarea").value.trim();
      const done = hasOpts ? !!on : !!note;
      const link = document.querySelector(`.toc a[data-for="${sec.dataset.key}"]`);
      if (link) { link.classList.toggle("done", done); const pk = link.querySelector(".pk"); if (pk) pk.textContent = on ? on.value : ""; }
      if (hasOpts && !on) { n += 1; if (!first) first = sec; }
    });
    document.querySelectorAll(".scn").forEach((sec) => {
      const on = sec.querySelector("input:checked");
      const link = document.querySelector(`.toc a[data-item="${sec.id}"]`);
      if (link) link.classList.toggle("done", !!on);
      if (!on) { n += 1; if (!first) first = sec; }
    });
    document.querySelectorAll(".spi").forEach((sec) => {
      const on = sec.querySelector("input:checked");
      const link = document.querySelector(`.toc a[data-item="${sec.id}"]`);
      if (link) link.classList.toggle("done", !!on);
      if (!on) { n += 1; if (!first) first = sec; }
    });
    document.querySelectorAll(".al").forEach((sec) => {
      const on = sec.querySelector("input:checked");
      const link = document.querySelector(`.toc a[data-item="${sec.id}"]`);
      if (link) link.classList.toggle("done", !!on);
      if (!on) { n += 1; if (!first) first = sec; }
    });
    const none = !document.querySelector(".card, .scn, .spi, .al");
    const text = none ? "" : n ? `还剩 ${n} 条没点` : "都点完了";
    ["remain-bottom", "remain-toc", "remain-top"].forEach((id) => { const el = document.getElementById(id); if (el) { el.textContent = text; el.classList.toggle("zero", !n); el.dataset.first = first ? first.id : ""; } });
    return first;
  };
  const jumpFirst = (e) => { const id = e.currentTarget.dataset.first; if (!id) return; const el = document.getElementById(id); const pane = el.closest(".pane"); if (pane) activate(pane.id, true); if (!pane || pane !== el) el.scrollIntoView({ behavior: "smooth", block: "center" }); };
  ["remain-bottom", "remain-toc", "remain-top"].forEach((id) => { const el = document.getElementById(id); if (el) el.addEventListener("click", jumpFirst); });

  const compose = () => {
    const picks = { q: [], f: [], p: [], r: [] };
    document.querySelectorAll(".card").forEach((sec) => {
      const key = sec.dataset.key;
      const prefix = key[0];
      const n = sec.dataset.n;
      const on = sec.querySelector("input:checked");
      const note = sec.querySelector("textarea").value.trim();
      if (on || note) picks[prefix].push(`${n}${on ? on.value : ""}${note ? `（${note}）` : ""}`);
      saved[key] = on ? on.value : "";
      saved[`n${key}`] = note;
    });
    const ideasEl = document.getElementById("ideas-bar");
    const ideasText = ideasEl ? ideasEl.value.trim() : "";
    saved.ideas = ideasText;
    saved.qdrop = [...qDropped];
    const parts = [];
    // 场景清单：保留、修改、删除落在场景上，回复里写场景的名字，不写编号
    const sc = { 保留: [], 修改: [], 删除: [] };
    document.querySelectorAll(".scn").forEach((sec) => {
      const on = sec.querySelector("input:checked");
      const ta = sec.querySelector(".scn-edit");
      saved[sec.id] = on ? on.value : "";
      saved[`n${sec.id}`] = ta.value.trim();
      ta.hidden = !(on && on.value === "修改");
      sec.classList.toggle("cut", !!on && on.value === "删除");
      if (on) sc[on.value].push(on.value === "修改" ? `「${sec.dataset.name}」（${ta.value.trim() || "没写怎么改"}）` : `「${sec.dataset.name}」`);
    });
    ["保留", "修改", "删除"].forEach((k) => { if (sc[k].length) parts.push(`场景 ${k}：${sc[k].join("  ")}`); });
    // 设计规范：和场景清单一样，回复里写这一格的名字
    const sp = { 保留: [], 修改: [], 删除: [] };
    document.querySelectorAll(".spi").forEach((sec) => {
      const on = sec.querySelector("input:checked");
      const ta = sec.querySelector(".spi-edit");
      saved[sec.id] = on ? on.value : "";
      saved[`n${sec.id}`] = ta.value.trim();
      ta.hidden = !(on && on.value === "修改");
      sec.classList.toggle("cut", !!on && on.value === "删除");
      if (on) sp[on.value].push(on.value === "修改" ? `「${sec.dataset.name}」（${ta.value.trim() || "没写怎么改"}）` : `「${sec.dataset.name}」`);
    });
    ["保留", "修改", "删除"].forEach((k) => { if (sp[k].length) parts.push(`规范 ${k}：${sp[k].join("  ")}`); });
    // 先对齐：回复里写术语的名称；用户自己的话跟在后面。点了不明白的，用到它的疑问卡上出提示
    const al = { 明白: [], 不明白: [] }; const unclear = {};
    document.querySelectorAll(".al").forEach((sec) => {
      const on = sec.querySelector("input:checked");
      const say = sec.querySelector(".al-say").value.trim();
      saved[sec.id] = on ? on.value : "";
      saved[`n${sec.id}`] = say;
      if (on) al[on.value].push(`「${sec.dataset.name}」${say ? `（${say}）` : ""}`);
      if (on && on.value === "不明白") JSON.parse(sec.dataset.used || "[]").forEach((t) => { (unclear[t] = unclear[t] || []).push(sec.dataset.name); });
    });
    ["明白", "不明白"].forEach((k) => { if (al[k].length) parts.push(`对齐 ${k}：${al[k].join("  ")}`); });
    document.querySelectorAll(".al-warn").forEach((w) => {
      const names = unclear[w.dataset.title] || [];
      w.hidden = !names.length;
      w.textContent = names.length ? `这张卡用到了你还不明白的术语${names.map((x) => `「${x}」`).join("")}。本轮可以先不选，下一轮我换一种讲法。` : "";
    });
    // 场景、规范、对齐都写进 saved 之后再保存，最后一次点的才不会丢
    try { localStorage.setItem(storeKey, JSON.stringify({ ...saved, imgs: (saved.imgs || []).filter((x) => x.id).map(({ local, ...x }) => x) })); } catch {}
    if (qDropped.size) parts.push(`队列 不做了：${[...qDropped].map((x) => `「${x}」`).join("  ")}`);
    if (picks.q.length) parts.push(`疑问 ${picks.q.join("  ")}`);
    if (picks.f.length) parts.push(`发现 ${picks.f.join("  ")}`);
    if (picks.p.length) parts.push(`提升 ${picks.p.join("  ")}`);
    if (picks.r.length) parts.push(`回到构思 ${picks.r.join("  ")}`);
    if (ideasText) parts.push(`想法：${ideasText}`);
    // 粘贴进来的截图存在页面那一边，回复里只带编号和它的标识，AI 凭标识去读图
    const used = (saved.imgs || []).filter((x) => x.id && parts.join("\n").includes(`〔图 ${x.n}〕`));
    if (used.length) parts.push(`图：${used.map((x) => `图 ${x.n}=${String(x.id).slice(0, 6)}`).join("  ")}`);
    if (parts.length) parts.unshift(`${data.stage || ""}第 ${data.round} 轮`);
    const out = document.getElementById("reply-text");
    if (out) { out.textContent = parts.length ? parts.join("\n") : "还没有要复制的内容"; out.classList.toggle("empty", !parts.length); }
    remaining();
  };

  // ---- 每张卡：选项、备注、右栏标签、来源切换
  const lists = { q: data.asks || [], f: data.findings || [], p: data.improvements || [], r: data.rethink || [] };
  document.querySelectorAll(".card").forEach((sec) => {
    const key = sec.dataset.key;
    const f = lists[key[0]][Number(sec.dataset.n) - 1] || {};
    sec.addEventListener("change", () => {
      sec.querySelectorAll(".opt").forEach((o) => o.classList.toggle("is-on", o.querySelector("input").checked));
      syncNext();
      compose();
    });
    // 点了选项，选项下面出一个「下一条」，放在手边；页面不自己走
    const nextRow = sec.querySelector(".nextrow");
    const syncNext = () => { nextRow.hidden = !sec.querySelector(".opt input:checked") || order.indexOf(sec.id) === order.length - 1; };
    nextRow.querySelector(".nx").addEventListener("click", () => step(1));
    syncNext();
    sec.querySelector("textarea").addEventListener("input", compose);

    const panel = sec.querySelector("[data-panel]");
    const tabs = sec.querySelectorAll(".tab");
    const srcs = sec.querySelectorAll(".src");
    let activeSrc = -1;
    const render = (which) => {
      if (!panel) return;
      tabs.forEach((t) => t.classList.toggle("on", t.dataset.tab === which));
      if (!which) { panel.classList.add("hidden"); panel.innerHTML = ""; srcs.forEach((s) => s.classList.remove("on")); activeSrc = -1; return; }
      let html = "";
      if (which === "ev") {
        if (activeSrc >= 0) html = srcPanel(f.sources[activeSrc]);
        else html = viz(f.evidence) || fig(f.image, "", "");
      } else if (which === "where") html = vizWhere(f.where);
      else if (which === "prior") html = vizPrior(f.prior);
      else if (which === "impact") html = vizImpact(f.impact);
      panel.innerHTML = html;
      panel.classList.toggle("hidden", !html);
      bindZoom(panel);
    };
    tabs.forEach((t) => t.addEventListener("click", () => {
      const on = t.classList.contains("on");
      if (t.dataset.tab !== "ev") { activeSrc = -1; srcs.forEach((s) => s.classList.remove("on")); }
      render(on ? "" : t.dataset.tab);
    }));
    srcs.forEach((s) => s.addEventListener("click", () => {
      const k = Number(s.dataset.src);
      if (activeSrc === k) { render(""); return; }
      activeSrc = k;
      srcs.forEach((x) => x.classList.toggle("on", x === s));
      render("ev");
    }));
  });
  // 想到的只有底部这一个输入框；写得多的时候自动变高
  const ideasBar = document.getElementById("ideas-bar");
  const growBar = () => { if (!ideasBar) return; ideasBar.style.height = "auto"; ideasBar.style.height = Math.min(ideasBar.scrollHeight, 220) + "px"; };
  if (ideasBar) { ideasBar.addEventListener("input", () => { growBar(); compose(); }); growBar(); }
  document.querySelectorAll(".scn").forEach((sec) => { sec.addEventListener("change", compose); sec.querySelector(".scn-edit").addEventListener("input", compose); });
  document.querySelectorAll(".al").forEach((sec) => { sec.addEventListener("change", compose); sec.querySelector(".al-say").addEventListener("input", compose); });
  document.querySelectorAll(".spi").forEach((sec) => { sec.addEventListener("change", compose); sec.querySelector(".spi-edit").addEventListener("input", compose); });
  // 动效的样张：点一下，小方块按这一项写的时长和缓动动一次
  document.querySelectorAll(".sp-motion .mo").forEach((b) => b.addEventListener("click", () => {
    const dot = b.querySelector("i"); const ms = Number(b.dataset.ms); const fx = b.dataset.fx;
    const frames = fx === "fade" ? [{ opacity: 0.15 }, { opacity: 1 }] : fx === "grow" ? [{ transform: "scale(0.4)" }, { transform: "scale(1)" }] : [{ transform: "translateX(0)" }, { transform: "translateX(64px)" }, { transform: "translateX(0)" }];
    if (dot.animate) dot.animate(frames, { duration: fx === "move" ? ms * 2 : ms, easing: b.dataset.ease });
  }));
  compose();
  // 打开页面：先到第一条还没点的；都点完了，或者没有要点的，到第一屏
  { remaining(); const todo = Array.from(document.querySelectorAll(".toc a[data-for]")).find((a) => !a.dataset.seen && a.querySelector(".ck").textContent && !a.classList.contains("done")); const pane = todo ? document.getElementById(todo.dataset.for) : null; const hash = location.hash.slice(1); const hp = hash && document.getElementById(hash) ? document.getElementById(hash).closest(".pane") : null; activate((hp || pane || panes[0] || {}).id || "", false); }

  // ---- 粘贴截图：图存进发布的页面自己的存储，文字里只留「〔图 1〕」这样的标记。存不了的时候如实说，不假装成功
  const shotsEl = document.getElementById("shots");
  const pending = () => (saved.imgs || []).some((x) => !x.id);
  const drawShots = () => {
    if (!shotsEl) return;
    const list = saved.imgs || [];
    shotsEl.hidden = !list.length && !shotsEl.dataset.msg;
    shotsEl.innerHTML = list.map((x) => `<figure class="${x.id ? "" : "wait"}"><img src="${esc(x.local || x.url || "/_blob/" + x.id)}" alt="图 ${x.n}" data-cap="图 ${x.n}"><figcaption>图 ${x.n}${x.id ? "" : "　正在存"}</figcaption></figure>`).join("") + (shotsEl.dataset.msg ? `<span class="smsg">${esc(shotsEl.dataset.msg)}</span>` : "");
    if (typeof bindZoom === "function") bindZoom(shotsEl);
    const c = document.getElementById("copy");
    if (c && !c.classList.contains("ok")) { c.disabled = pending(); c.textContent = pending() ? "正在存图" : "复制回复"; }
  };
  const say = (msg) => { if (shotsEl) { shotsEl.dataset.msg = msg || ""; drawShots(); } };
  const persist = () => { try { localStorage.setItem(storeKey, JSON.stringify({ ...saved, imgs: (saved.imgs || []).filter((x) => x.id).map(({ local, ...x }) => x) })); } catch {} };
  document.addEventListener("paste", async (ev) => {
    const ta = ev.target && ev.target.closest ? ev.target.closest("textarea") : null;
    const item = Array.from((ev.clipboardData && ev.clipboardData.items) || []).find((it) => it.kind === "file" && it.type.startsWith("image/"));
    if (!ta || !item) return;
    ev.preventDefault();
    const blob = item.getAsFile();
    let assets = null;
    try { assets = window.claude && window.claude.use ? await window.claude.use("assets") : null; } catch { assets = null; }
    if (!assets) { say("这一页存不了图，截图请直接贴到会话里"); return; }
    const n = (saved.imgs || []).reduce((m, x) => Math.max(m, x.n), 0) + 1;
    const mark = `〔图 ${n}〕`;
    const entry = { n, id: "", local: URL.createObjectURL(blob) };
    saved.imgs = [...(saved.imgs || []), entry];
    const at = ta.selectionStart ?? ta.value.length;
    ta.value = ta.value.slice(0, at) + mark + ta.value.slice(ta.selectionEnd ?? at);
    ta.selectionStart = ta.selectionEnd = at + mark.length;
    say("");
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    try {
      const r = await assets.upload(blob, { type: blob.type || "image/png" });
      entry.id = r.id; entry.url = r.url;
      compose(); persist(); drawShots();
    } catch (e) {
      saved.imgs = saved.imgs.filter((x) => x !== entry);
      ta.value = ta.value.replace(mark, "");
      ta.dispatchEvent(new Event("input", { bubbles: true }));
      say(e && e.code === "too_large" ? "这张图太大，存不了，请直接贴到会话里" : "图没有存上，请直接贴到会话里");
    }
  });
  drawShots();

  const copy = document.getElementById("copy");
  if (copy) copy.addEventListener("click", async () => {
    const text = document.getElementById("reply-text").textContent;
    try { await navigator.clipboard.writeText(text); copy.textContent = "已复制"; copy.classList.add("ok"); }
    catch { copy.textContent = "复制失败，手动选中上面的文字"; }
    setTimeout(() => { copy.textContent = "复制回复"; copy.classList.remove("ok"); }, 1800);
  });

  // ---- 盖在页面上的那一层：放大看图和展示卡片共用这一套开关和按键
  const layer = (node, opts = {}) => {
    const close = () => { node.classList.remove("open"); document.removeEventListener("keydown", onKey); };
    const onKey = (e) => {
      if (e.key === "Escape") { close(); return; }
      if (e.key === "ArrowLeft" && opts.prev) opts.prev();
      if (e.key === "ArrowRight" && opts.next) opts.next();
    };
    return {
      open() { node.classList.add("open"); document.addEventListener("keydown", onKey); },
      close,
    };
  };

  // ---- 放大看图
  const box = document.getElementById("lightbox");
  const zoomLayer = layer(box);
  function bindZoom(root) {
    root.querySelectorAll("figure img, .sk img").forEach((img) => {
      if (img.dataset.zoom) return;
      img.dataset.zoom = "1";
      img.addEventListener("click", () => {
        box.querySelector("img").src = img.src;
        box.querySelector(".cap").textContent = img.dataset.cap || "";
        zoomLayer.open();
      });
    });
  }
  bindZoom(document);
  box.addEventListener("click", () => zoomLayer.close());

  // ---- 展示卡片：整页通用。概览只给简略，点开是居中的卡片，属性表在上、正文在下，卡片里能换条
  const sheetEl = document.getElementById("sheet");
  let sheetList = [], sheetAt = 0;
  const sheetShow = () => {
    const it = sheetList[sheetAt]; if (!it) return;
    sheetEl.querySelector(".sh-t").textContent = it.title;
    sheetEl.querySelector(".sh-at").textContent = `${sheetAt + 1} / ${sheetList.length}`;
    sheetEl.querySelector(".sh-attrs").innerHTML = (it.attrs || []).map(([k, v]) => `<div class="sh-attr"><dt>${esc(k)}</dt><dd>${lines(v)}</dd></div>`).join("");
    sheetEl.querySelector(".sh-body").innerHTML = (it.body ? `<p>${lines(it.body)}</p>` : "") + ((it.list || []).length ? `<div class="sh-lh">${esc(it.listLabel || "并列的几件")}</div><ul class="sh-list">${it.list.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : "");
    sheetEl.querySelector(".sh-foot").innerHTML = it.foot || "";
    bindZoom(sheetEl);
  };
  const sheetStep = (d) => { sheetAt = (sheetAt + d + sheetList.length) % sheetList.length; sheetShow(); };
  const sheetLayer = layer(sheetEl, { prev: () => sheetStep(-1), next: () => sheetStep(1) });
  const openSheet = (list, at) => { sheetList = list; sheetAt = at; sheetShow(); sheetLayer.open(); };
  sheetEl.querySelector(".sh-prev").addEventListener("click", () => sheetStep(-1));
  sheetEl.querySelector(".sh-next").addEventListener("click", () => sheetStep(1));
  sheetEl.querySelector(".sh-x").addEventListener("click", () => sheetLayer.close());
  sheetEl.addEventListener("click", (e) => { if (e.target === sheetEl) sheetLayer.close(); });

  // 参考：外面看来的东西，一行一条，点开是展示卡片
  const refMore = document.querySelector("#pane-refs .rf-more");
  if (refMore) refMore.addEventListener("click", () => {
    document.querySelectorAll("#pane-refs .rf-hid").forEach((el) => el.classList.remove("rf-hid"));
    refMore.remove();
  });
  document.querySelectorAll("#pane-refs .rf").forEach((el, i) => {
    el.addEventListener("click", () => openSheet(REFS.map((r) => ({
      title: r.name,
      attrs: [["类型", r.kind], ["阅读深度", r.depth], ["相关度", r.relevance], ["证据强度", r.strength], ["建议", r.advice], ["用在", r.where || "无"]],
      body: r.body,
    })), i));
  });

  // 队列：点一张小卡出展示卡片。页面上能做的只有取消这一项，点了写进回复
  const qSheet = (x) => ({
    title: x.text,
    attrs: [["阶段", x.stage], ["状态", x.state + (x.note ? `，${x.note}` : "")], ["提出", x.from || "无"],
            ["创建时间", `${x.since}，已 ${qdays(x.since)} 天`], ["依赖", x.dep || "无"],
            ["验收标准", x.accept || "无"], ["完成证据", x.proof || "无"], ["来源", x.origin || "无"]],
    list: x.items || [],
    listLabel: "子项",
    foot: `<button type="button" class="sh-drop${qDropped.has(x.text) ? " on" : ""}" data-t="${esc(x.text)}">${qDropped.has(x.text) ? "已写进回复：不做了" : "取消这一项"}</button>`,
  });
  document.querySelectorAll("#pane-queue .qi, #pane-queue .qwi").forEach((el) => {
    const go = () => openSheet(QU.map(qSheet), QU.findIndex((x) => x.n === el.dataset.n));
    el.addEventListener("click", go);
    el.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } });
  });
  sheetEl.addEventListener("click", (e) => {
    const b = e.target.closest(".sh-drop");
    if (!b) return;
    const text = b.dataset.t;
    if (qDropped.has(text)) qDropped.delete(text); else qDropped.add(text);
    b.classList.toggle("on", qDropped.has(text));
    b.textContent = qDropped.has(text) ? "已写进回复：不做了" : "取消这一项";
    QU.forEach((x, i) => { const el = document.querySelector(`#pane-queue [data-n="${i}"]`); if (el) el.classList.toggle("cut", qDropped.has(x.text)); });
    compose();
  });

})();
