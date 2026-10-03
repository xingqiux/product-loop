// 图表：文字定义交给 Mermaid 去画，只在页面里有图表时才加载它。目录树用等宽文字。
// Mermaid 加载或解析失败时，显示文字定义本身。
import { useEffect, useId, useState } from "react";

type Diagram = { readonly kind: string; readonly title: string; readonly code: string };

let mermaidReady: Promise<typeof import("mermaid").default> | undefined;

function loadMermaid() {
  mermaidReady ??= import("mermaid").then(({ default: mermaid }) => {
    mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: "neutral" });
    return mermaid;
  });
  return mermaidReady;
}

export function DiagramView({ diagram }: { diagram: Diagram }) {
  const id = useId().replace(/[^a-zA-Z0-9]/gu, "");
  const [svg, setSvg] = useState<string | undefined>();
  const [failed, setFailed] = useState(false);
  const tree = diagram.kind === "目录树";
  useEffect(() => {
    if (tree) return;
    let alive = true;
    // Mermaid 画的时候要一块容器量字的大小，不给就往 body 后面加一块，整个网页会闪一下滚动条。
    // 给一块窗口外、看不见的，量完就拿掉。
    const holder = document.createElement("div");
    holder.style.cssText = "position:fixed;left:-10000px;top:0;visibility:hidden";
    document.body.append(holder);
    loadMermaid()
      .then((mermaid) => mermaid.render(`dg${id}`, diagram.code, holder))
      .then((result) => {
        if (alive) setSvg(result.svg);
      })
      .catch(() => {
        if (alive) setFailed(true);
      })
      .finally(() => holder.remove());
    return () => {
      alive = false;
      holder.remove();
    };
  }, [diagram.code, id, tree]);
  return (
    <figure className="flex flex-col gap-2 rounded-lg p-3 ring-1 ring-secondary">
      <figcaption className="flex items-center gap-2 text-meta">
        <span className="rounded-md bg-secondary px-1.5 text-label text-tertiary">
          {diagram.kind}
        </span>
        {diagram.title}
      </figcaption>
      {tree || failed || svg === undefined ? (
        <pre className="overflow-x-auto font-mono text-meta whitespace-pre text-secondary">
          {diagram.code}
        </pre>
      ) : (
        // Mermaid 用 strict 画出的 SVG，不带脚本。
        // biome-ignore lint/style/useNamingConvention: React 定的属性名
        <div className="overflow-x-auto" dangerouslySetInnerHTML={{ __html: svg }} />
      )}
    </figure>
  );
}
