// 图表库只在页面上有图表时才加载。渲染失败的那一张保留文字定义，不影响别的图
(() => {
  const nodes = Array.from(document.querySelectorAll(".dg pre.dg-code"));
  if (!nodes.length) return;
  const dark = document.documentElement.dataset.theme === "dark" || (document.documentElement.dataset.theme !== "light" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  import("https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs").then(async ({ default: mermaid }) => {
    mermaid.initialize({ startOnLoad: false, theme: dark ? "dark" : "neutral", securityLevel: "strict", flowchart: { useMaxWidth: true }, themeVariables: { fontSize: "14px" } });
    let i = 0;
    for (const pre of nodes) {
      try {
        const { svg } = await mermaid.render(`dg-${++i}`, pre.textContent);
        const box = document.createElement("div"); box.className = "dg-svg"; box.innerHTML = svg; pre.replaceWith(box);
      } catch (e) {
        // 图表库渲染失败时会在页面末尾留下一张报错图，删掉；这一张保留文字定义
        pre.classList.add("dg-failed");
        document.querySelectorAll(`#ddg-${i}, #dg-${i}`).forEach((el) => { if (!el.closest(".dg")) el.remove(); });
      }
    }
  }).catch(() => nodes.forEach((pre) => pre.classList.add("dg-failed")));
})();
