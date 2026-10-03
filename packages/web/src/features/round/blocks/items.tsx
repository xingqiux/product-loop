// 先对齐、场景清单、设计规范：整个区块一屏，每一项点一个表态。见「06 工作台」第四节。
import { useEffect, useRef } from "react";
import { cx } from "@/lib/cx";
import { prefersReducedMotion, scrollBehavior } from "@/lib/motion";
import { type Sections, usePage } from "../context";
import { useDraft } from "../draft-store";
import { DiagramView } from "../evidence/diagram";
import { Figure } from "../evidence/figure";
import { Paragraphs } from "../evidence/text";
import { fieldOf } from "../model";
import { NoteField } from "../note-field";
import { Choice } from "./choice";

const keepChoices = ["保留", "修改", "删除"] as const;

/** 左边点了屏里的某一项时，把它滚到中间。 */
function useScrollTo(item: string | undefined) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (item === undefined) return;
    root.current
      ?.querySelector(`[data-item="${CSS.escape(item)}"]`)
      ?.scrollIntoView({ block: "center", behavior: scrollBehavior() });
  }, [item]);
  return root;
}

/** 块的名字。名字下面不加说明，要靠说明才懂的控件先改控件。 */
function BlockTitle({ title }: { title: string }) {
  return (
    <header className="flex items-baseline gap-3">
      <h2 className="text-title">{title}</h2>
    </header>
  );
}

export function AlignBlock({ item }: { item: string | undefined }) {
  const { page, readOnly } = usePage();
  const root = useScrollTo(item);
  const terms = page.sections.align ?? [];
  return (
    <div ref={root} className="flex flex-col gap-5">
      <BlockTitle title="先对齐" />
      {terms.map((term) => {
        const field = fieldOf("align", term.id);
        return (
          <section
            key={term.id}
            data-item={term.id}
            className="flex flex-col gap-3 rounded-xl p-5 ring-1 ring-secondary"
          >
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-heading">{term.name}</h3>
              <Choice
                field={field}
                choices={["明白", "不明白"]}
                label={term.name}
                readOnly={readOnly}
              />
            </div>
            <dl className="grid grid-cols-[4rem_1fr] gap-x-4 gap-y-2 text-ui">
              <dt className="text-tertiary">用在</dt>
              <dd>{term.usedIn.map((title) => `「${title}」`).join("")}</dd>
              <dt className="text-tertiary">意思</dt>
              <dd>
                <Paragraphs text={term.meaning} />
              </dd>
              <dt className="text-tertiary">例子</dt>
              <dd>
                <Paragraphs text={term.example} />
              </dd>
            </dl>
            {term.diagram !== undefined && <DiagramView diagram={term.diagram} />}
            <NoteField field={field} readOnly={readOnly} rows={1} placeholder="备注" />
          </section>
        );
      })}
    </div>
  );
}

export function ScenesBlock({ item }: { item: string | undefined }) {
  const { page, readOnly } = usePage();
  const root = useScrollTo(item);
  const scenes = page.sections.scenes ?? [];
  return (
    <div ref={root} className="flex flex-col gap-5">
      <BlockTitle title="场景清单" />
      {scenes.map((scene) => (
        <SceneItem key={scene.id} scene={scene} readOnly={readOnly} />
      ))}
    </div>
  );
}

type Scene = NonNullable<Sections["scenes"]>[number];

function SceneItem({ scene, readOnly }: { scene: Scene; readOnly: boolean }) {
  const field = fieldOf("scenes", scene.id);
  const pick = useDraft((state) => state.entries[field]?.pick);
  return (
    <section
      data-item={scene.id}
      className={cx(
        "flex flex-col gap-3 rounded-xl p-5 ring-1 ring-secondary",
        pick === "删除" && "opacity-60",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h3 className="flex items-center gap-2 text-heading">
            {scene.scene !== undefined && (
              <span className="text-meta text-tertiary">{scene.scene}</span>
            )}
            <span className={cx(pick === "删除" && "line-through")}>{scene.name}</span>
            {scene.mark !== undefined && (
              <span className="rounded-md px-1.5 text-label text-brand-secondary ring-1 ring-secondary">
                {scene.mark}
              </span>
            )}
          </h3>
          {scene.who !== undefined && <p className="text-meta text-tertiary">{scene.who}</p>}
        </div>
        <Choice field={field} choices={keepChoices} label={scene.name} readOnly={readOnly} />
      </div>
      <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {scene.steps.map((step, index) => (
          <li
            key={`${step.do}-${index}`}
            className="flex flex-col gap-1 rounded-lg bg-secondary p-3"
          >
            <span className="text-label text-tertiary">第 {index + 1} 步</span>
            <p className="text-ui">{step.do}</p>
            <p className="text-meta text-tertiary">该看到：{step.expect}</p>
            {step.img !== undefined && <Figure img={step.img} />}
          </li>
        ))}
      </ol>
      {pick === "修改" && <NoteField field={field} readOnly={readOnly} placeholder="修改的内容" />}
    </section>
  );
}

export function SpecBlock({ item }: { item: string | undefined }) {
  const { page, readOnly } = usePage();
  const root = useScrollTo(item);
  const specs = page.sections.spec ?? [];
  return (
    <div ref={root} className="flex flex-col gap-5">
      <BlockTitle title="设计规范" />
      <div className="grid gap-4 lg:grid-cols-2">
        {specs.map((spec) => (
          <SpecItem key={spec.id} spec={spec} readOnly={readOnly} />
        ))}
      </div>
    </div>
  );
}

type Spec = NonNullable<Sections["spec"]>[number];

function SpecItem({ spec, readOnly }: { spec: Spec; readOnly: boolean }) {
  const field = fieldOf("spec", spec.id);
  const pick = useDraft((state) => state.entries[field]?.pick);
  const wide = spec.kind === "颜色" || spec.kind === "字号" || spec.kind === "表格";
  return (
    <section
      data-item={spec.id}
      className={cx(
        "flex flex-col gap-3 rounded-xl p-5 ring-1 ring-secondary",
        wide && "lg:col-span-2",
        pick === "删除" && "opacity-60",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h3 className={cx("text-heading", pick === "删除" && "line-through")}>{spec.name}</h3>
          {spec.for !== undefined && <p className="text-meta text-tertiary">用在：{spec.for}</p>}
          {spec.note !== undefined && <p className="text-meta text-tertiary">{spec.note}</p>}
        </div>
        <Choice field={field} choices={keepChoices} label={spec.name} readOnly={readOnly} />
      </div>
      <Specimen spec={spec} />
      {pick === "修改" && <NoteField field={field} readOnly={readOnly} placeholder="修改的内容" />}
    </section>
  );
}

const toneClass = new Map<string, string>([
  ["待办", "text-secondary"],
  ["进行中", "text-brand-secondary"],
  ["等待", "text-warning-primary"],
  ["已完成", "text-success-primary"],
  ["已取消", "text-tertiary line-through"],
]);

/** 样张：按规范的种类画出来。色值、字号、圆角都来自页面数据。 */
function Specimen({ spec }: { spec: Spec }) {
  switch (spec.kind) {
    case "颜色":
      return (
        <div className="flex flex-wrap gap-3">
          {spec.values.map((color) => (
            <div key={color.name} className="flex w-24 flex-col gap-1">
              <div
                className="h-14 rounded-md ring-1 ring-secondary"
                style={{ background: color.hex }}
              />
              <span className="text-label font-medium">{color.name}</span>
              <span className="font-mono text-label text-tertiary">{color.hex}</span>
            </div>
          ))}
        </div>
      );
    case "字号":
      return (
        <div className="flex flex-col gap-2">
          {spec.values.map((font) => (
            <div key={font.name} className="flex flex-col">
              <span
                data-sample={font.size}
                style={{ fontSize: font.size, fontWeight: font.weight ?? 400, lineHeight: 1.25 }}
              >
                {font.sample ?? font.name}
              </span>
              <span className="text-label text-tertiary">
                {font.name}　{font.size}px{font.weight === undefined ? "" : `　${font.weight}`}
              </span>
            </div>
          ))}
        </div>
      );
    case "圆角":
      return (
        <div className="flex flex-wrap gap-4">
          {spec.values.map((radius) => (
            <div key={radius} className="flex flex-col items-center gap-1">
              <div
                data-radius={radius}
                className="size-12 bg-secondary ring-1 ring-fg-quaternary"
                style={{ borderRadius: radius }}
              />
              <span className="text-label text-tertiary">{radius}px</span>
            </div>
          ))}
        </div>
      );
    case "间距":
      return (
        <div className="flex flex-col gap-1.5">
          {spec.values.map((gap) => (
            <div key={gap} className="flex items-center gap-3">
              <div
                data-spacing={gap}
                className="h-3 rounded-sm bg-fg-brand-primary"
                style={{ width: Math.max(2, gap) }}
              />
              <span className="text-label text-tertiary">{gap}px</span>
            </div>
          ))}
        </div>
      );
    case "动效":
      return <MotionSpecimen values={spec.values} />;
    case "表格":
      return (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-ui">
            <thead className="text-meta text-tertiary">
              <tr>
                {spec.columns.map((column) => (
                  <th
                    key={column.name}
                    className="border-b border-secondary py-2 pr-4 font-normal whitespace-nowrap"
                  >
                    {column.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-secondary">
              {spec.rows.map((row, r) => (
                // 表格的行不会重排，用下标当键。
                <tr key={r}>
                  {row.map((cell, c) => {
                    const as = spec.columns[c]?.as;
                    return (
                      <td key={c} className="py-2 pr-4 align-top">
                        {typeof cell !== "string" ? (
                          <span className={cx("text-label", toneClass.get(cell.tone))}>
                            {cell.text}
                          </span>
                        ) : as === "色块" ? (
                          <span className="flex items-center gap-2">
                            <span
                              className="size-4 rounded-sm ring-1 ring-secondary"
                              style={{ background: cell }}
                            />
                            <code className="font-mono text-label">{cell}</code>
                          </span>
                        ) : (
                          <span
                            className={cx(
                              // 短的词不折行：两个字被挤成一字一行没法读。
                              cell.length <= 6 && "whitespace-nowrap",
                              as === "加粗" && "font-semibold",
                              as === "正例" && "text-success-primary",
                              as === "反例" && "text-error-primary",
                              as === "旧叫法" && "text-tertiary line-through",
                            )}
                          >
                            {cell}
                          </span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "文字":
      return <Paragraphs text={spec.text} className="text-ui" />;
  }
}

type MotionValue = {
  readonly name: string;
  readonly ms: number;
  readonly easing?: string | undefined;
  readonly effect?: string | undefined;
};

/**
 * 动效的样张：按下按钮，小方块按这一项写的时长和缓动动一次，一次就是写的那些毫秒，往返也算在里面。
 * 系统开了「减少动态效果」时不位移、不缩放，只变透明度（规范的动效一节）。
 */
function MotionSpecimen({ values }: { values: readonly MotionValue[] }) {
  const play = (target: HTMLElement, value: MotionValue) => {
    const frames =
      prefersReducedMotion() || value.effect === "淡入"
        ? [{ opacity: 0.15 }, { opacity: 1 }]
        : value.effect === "放大"
          ? [{ transform: "scale(0.4)" }, { transform: "scale(1)" }]
          : [
              { transform: "translateX(0)" },
              { transform: "translateX(64px)" },
              { transform: "translateX(0)" },
            ];
    target.animate(frames, { duration: value.ms, easing: value.easing ?? "ease" });
  };
  return (
    <div className="flex flex-col gap-2">
      {values.map((value) => (
        <button
          key={value.name}
          type="button"
          onClick={(event) => {
            const dot = event.currentTarget.querySelector("i");
            if (dot !== null) play(dot, value);
          }}
          className="flex items-center gap-3 rounded-lg px-3 py-2 text-left ring-1 ring-secondary hover:bg-secondary"
        >
          <span className="w-24 shrink-0">
            <i className="block size-4 rounded-sm bg-fg-brand-primary" />
          </span>
          <span className="shrink-0 text-ui whitespace-nowrap">{value.name}</span>
          <span className="ml-auto text-right text-label text-tertiary">
            {value.ms} 毫秒　{value.easing ?? "ease"}
          </span>
        </button>
      ))}
    </div>
  );
}
