// 证据：尺寸、色块、字号、间距、截图、真组件，从数据画，见「06 工作台」第九节和旧模板的 viz。
// 色值来自页面数据，按数据上色，不是组件里写死的颜色。
import { useRef, useState } from "react";
import { cx } from "@/lib/cx";
import type { Sections } from "../context";
import { Figure } from "./figure";

type Card = NonNullable<Sections["asks"]>[number];
type Evidence = NonNullable<Card["evidence"]>[number];

function Caption({ text }: { text: string | undefined }) {
  return text === undefined ? null : <p className="text-meta text-tertiary">{text}</p>;
}

export function EvidenceView({ evidence }: { evidence: Evidence }) {
  switch (evidence.type) {
    case "尺寸": {
      const keep = new Set(evidence.keep ?? []);
      const unit = evidence.unit ?? "px";
      return (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-end gap-4">
            {evidence.values.map((value) => (
              <div key={value} className="flex flex-col items-center gap-1">
                <div
                  className={cx(
                    "rounded-full",
                    keep.has(value) ? "bg-fg-brand-primary" : "bg-quaternary",
                  )}
                  style={{ width: value, height: value }}
                />
                <span className="text-label text-tertiary tabular-nums">
                  {value}
                  {unit}
                </span>
              </div>
            ))}
          </div>
          <Caption text={evidence.caption} />
        </div>
      );
    }
    case "色块":
      return (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-3">
            {evidence.values.map((value) => (
              <div key={`${value.name}${value.hex}`} className="flex w-20 flex-col gap-1">
                <div
                  className="h-12 rounded-md ring-1 ring-secondary"
                  style={{ background: value.hex }}
                />
                <span className="text-label">{value.name}</span>
                <span className="font-mono text-label text-tertiary">{value.hex}</span>
              </div>
            ))}
          </div>
          <Caption text={evidence.caption} />
        </div>
      );
    case "字号":
      return (
        <div className="flex flex-col gap-2">
          {evidence.values.map((value) => (
            <div key={`${value.size}-${value.weight ?? 400}`} className="flex items-baseline gap-3">
              <span
                style={{ fontSize: value.size, fontWeight: value.weight ?? 400, lineHeight: 1.2 }}
              >
                {value.sample ?? "设计评审 从提交到定稿 Aa 12"}
              </span>
              <span className="text-label text-tertiary tabular-nums">
                {value.size}px{value.weight === undefined ? "" : ` ${value.weight}`}
              </span>
            </div>
          ))}
          <Caption text={evidence.caption} />
        </div>
      );
    case "间距": {
      const keep = evidence.keep === undefined ? undefined : new Set(evidence.keep);
      return (
        <div className="flex flex-col gap-1.5">
          {evidence.values.map((value) => (
            <div key={value} className="flex items-center gap-3">
              <div
                className={cx(
                  "h-2 rounded-sm",
                  keep !== undefined && !keep.has(value) ? "bg-quaternary" : "bg-fg-brand-primary",
                )}
                style={{ width: Math.max(2, value) * 3 }}
              />
              <span className="text-label text-tertiary tabular-nums">{value}px</span>
            </div>
          ))}
          <Caption text={evidence.caption} />
        </div>
      );
    }
    case "截图":
      return <Figure img={evidence.img} caption={evidence.caption} />;
    case "真组件":
      return <LiveView evidence={evidence} />;
  }
}

type Live = Extract<Evidence, { type: "真组件" }>;

/**
 * 真组件：取来的 HTML 和样式放进隔离的内嵌框架，框里不许运行脚本。
 * 下面的按钮由页面切换框里元素的类名或属性，所以框和页面同源，但框里没有脚本。
 */
function LiveView({ evidence }: { evidence: Live }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [on, setOn] = useState<readonly number[]>([]);
  const html = evidence.html.replace(/<script[\s\S]*?<\/script>/giu, "");
  const doc = `<!doctype html><meta charset="utf-8"><style>html,body{margin:0}body{padding:16px;background:${evidence.bg ?? "white"};font:13px/1.5 system-ui,sans-serif}</style><style>${evidence.css}</style><div id="stage">${html}</div>`;
  const toggle = (index: number) => {
    const t = evidence.toggles?.[index];
    const stage = frame.current?.contentDocument?.getElementById("stage");
    if (t === undefined || stage === null || stage === undefined) return;
    const next = !on.includes(index);
    setOn(next ? [...on, index] : on.filter((n) => n !== index));
    for (const element of Array.from(stage.querySelectorAll(t.selector))) {
      if ("class" in t) element.classList.toggle(t.class, next);
      else element.setAttribute(t.attr, next ? (t.on ?? "true") : (t.off ?? "false"));
    }
  };
  return (
    <div className="flex flex-col gap-2">
      <iframe
        ref={frame}
        title={evidence.from}
        sandbox="allow-same-origin"
        srcDoc={doc}
        className="w-full rounded-lg ring-1 ring-secondary"
        style={{ height: evidence.height ?? 160 }}
      />
      {(evidence.toggles ?? []).length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {(evidence.toggles ?? []).map((t, index) => (
            <button
              key={t.label}
              type="button"
              onClick={() => toggle(index)}
              className={cx(
                "min-h-6 rounded-md px-2 py-0.5 text-label ring-1 ring-secondary",
                on.includes(index) ? "bg-brand-solid text-white" : "bg-primary text-secondary",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}
      <Caption text={evidence.caption} />
    </div>
  );
}
