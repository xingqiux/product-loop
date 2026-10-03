// 疑问、发现问题、提升三种卡，一张一屏。见「06 工作台」第四节和旧模板的 cards。
// 选项并排成列，行名在左边只写一遍，同一行对同一行。点了选项页面不自己走，换一屏用页面底下的「下一屏」。
import { ArrowRight, Check } from "@untitledui/icons";
import { motion } from "motion/react";
import { type RefObject, useLayoutEffect, useRef, useState } from "react";
import { Radio, RadioGroup } from "react-aria-components";
import { cx } from "@/lib/cx";
import { motionTokens } from "@/lib/motion";
import { type Sections, usePage, useQueueContents } from "../context";
import { useDraft } from "../draft-store";
import { DiagramView } from "../evidence/diagram";
import { EvidenceView } from "../evidence/evidence";
import { Figure } from "../evidence/figure";
import { SafeHtml } from "../evidence/safe-html";
import { Sources } from "../evidence/sources";
import { Label, Paragraphs } from "../evidence/text";
import { WhereMap } from "../evidence/where-map";
import { type CardSection, fieldOf, queueTitles, sectionLabels } from "../model";
import { NoteField } from "../note-field";

type Card = NonNullable<Sections["asks"]>[number];

const whyLabel: Record<CardSection, string> = {
  asks: "待决定",
  findings: "问题",
  improvements: "解决什么",
};

export function CardBlock({ section, index }: { section: CardSection; index: number }) {
  const { page, readOnly } = usePage();
  const contents = useQueueContents();
  const card = page.sections[section]?.[index] as Card | undefined;
  const field = fieldOf(section, card?.id ?? "");
  const pick = useDraft((state) => state.entries[field]?.pick);
  if (card === undefined) return null;
  const at = `${section}[${index}]`;
  const queued = queueTitles(card.queue ?? [], contents);
  return (
    <article className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <p className="flex flex-wrap items-center gap-2 text-meta text-tertiary">
          <span className="rounded-md px-1.5 py-0.5 text-label text-secondary ring-1 ring-secondary">
            {sectionLabels[section]}
          </span>
          {card.tag !== undefined && (
            <span className="rounded-md px-1.5 py-0.5 text-label ring-1 ring-secondary">
              {card.tag}
            </span>
          )}
          {"research" in card && card.research !== undefined && (
            <span>
              {card.research.tier}
              {card.research.reason !== undefined && `：${card.research.reason}`}
              {card.research.approved !== undefined && `：${card.research.approved}`}
            </span>
          )}
          {queued !== "" && <span>队列：{queued}</span>}
        </p>
        <h2 id={`title-${card.id}`} className="text-title">
          {card.title}
        </h2>
      </header>
      <section className="flex flex-col gap-2">
        <Label>{whyLabel[section]}</Label>
        <Paragraphs text={card.why} className="max-w-3xl text-body" />
      </section>
      <Sources sources={card.sources} at={at} />
      <EvidenceRow card={card} />
      {card.shared !== undefined && (
        <section className="flex flex-col gap-2">
          <Label>共同点</Label>
          <Paragraphs text={card.shared.text} className="text-body" />
          {(card.shared.diagrams ?? []).map((diagram) => (
            <DiagramView key={diagram.title} diagram={diagram} />
          ))}
        </section>
      )}
      {(card.options ?? []).length > 0 && (
        <Options card={card} field={field} pick={pick} readOnly={readOnly} />
      )}
      {card.dropped !== undefined && (
        <section className="flex flex-col gap-2">
          <Label>排除的方向</Label>
          <table className="text-ui">
            <tbody className="divide-y divide-secondary">
              {card.dropped.map((item) => (
                <tr key={item.name}>
                  <td className="w-48 py-2 pr-4 align-top font-medium">{item.name}</td>
                  <td className="py-2 text-secondary">{item.because}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
      <footer className="flex flex-col gap-3 border-t border-secondary pt-5">
        {card.stance !== undefined && (
          // 名字加值，和别的块一样：我的看法一个字段，理由一个字段，不拼成一句话。
          <dl className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-x-4 gap-y-1 text-ui">
            <dt className="text-tertiary">我的看法</dt>
            <dd className="font-medium">{stanceText(card)}</dd>
            <dt className="text-tertiary">理由</dt>
            <dd className="text-secondary">
              <Paragraphs text={card.stance.because.replace(/^因为[，,：:\s]*/u, "")} />
            </dd>
          </dl>
        )}
        <NoteField
          field={field}
          readOnly={readOnly}
          placeholder={(card.options ?? []).length > 0 ? "备注" : "回答"}
        />
      </footer>
    </article>
  );
}

/** 看法写选了哪个选项的标题，不写字母；只有一个方向的卡，看法可以是否决。 */
function stanceText(card: Card): string {
  const pick = card.stance?.pick;
  if (pick === undefined) return "";
  const title = (card.options ?? []).find((option) => option.key === pick)?.title;
  return title === undefined ? pick : `选「${title}」`;
}

/** 证据一排：画出来的证据、一张图、位置图、图表、中保真线稿、操作流程。一样一格。 */
function EvidenceRow({ card }: { card: Card }) {
  const cells: React.ReactNode[] = [];
  for (const [index, evidence] of (card.evidence ?? []).entries()) {
    cells.push(<EvidenceView key={`ev${index}`} evidence={evidence} />);
  }
  if (card.image !== undefined) {
    cells.push(<Figure key="image" img={card.image.img} caption={card.image.caption} />);
  }
  if (card.where !== undefined) cells.push(<WhereMap key="where" where={card.where} />);
  for (const diagram of card.diagrams ?? []) {
    cells.push(<DiagramView key={`dg${diagram.title}`} diagram={diagram} />);
  }
  if (card.mock !== undefined) {
    cells.push(
      <div key="mock" className="flex flex-col gap-2 rounded-lg p-3 ring-1 ring-secondary">
        <SafeHtml html={card.mock} />
        {card.mockCaption !== undefined && (
          <p className="text-meta text-tertiary">{card.mockCaption}</p>
        )}
      </div>,
    );
  }
  if (card.flow !== undefined) {
    cells.push(
      <div key="flow" className="flex flex-wrap items-center gap-2 text-ui">
        {card.flow.map((step, index) => (
          <span key={step} className="flex items-center gap-2">
            {index > 0 && <ArrowRight className="size-4 text-fg-quaternary" />}
            <span className="rounded-md px-2 py-1 ring-1 ring-secondary">{step}</span>
          </span>
        ))}
      </div>,
    );
  }
  if (cells.length === 0) return null;
  // 只有一格时占满整行，里面的表格才有宽度可排；一张图占半宽就够，点开再放大。
  const lone = cells.length === 1;
  const halfImage = lone && card.image !== undefined;
  return (
    <section className="flex flex-col gap-2">
      <Label>证据</Label>
      <div
        className={cx(
          "grid items-start gap-4",
          !lone && "lg:grid-cols-2",
          halfImage && "lg:max-w-[50%]",
        )}
      >
        {cells}
      </div>
    </section>
  );
}

/** 这一块的宽度够不够 min 像素。窗口窄或者左边一栏没收起时，能放下的宽度不一样，所以量这一块自己的宽度。 */
function useWidthAtLeast(min: number): [RefObject<HTMLDivElement | null>, boolean] {
  const ref = useRef<HTMLDivElement>(null);
  const [fits, setFits] = useState(true);
  useLayoutEffect(() => {
    const element = ref.current;
    if (element === null) return;
    const update = () => setFits(element.clientWidth >= min);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [min]);
  return [ref, fits];
}

/** 每个选项的最小宽度、行名一列的宽度和列间距，单位像素，和下面的栅格是同一套数。 */
const optionWidth = 192;
const namesWidth = 100;
const optionGap = 12;

/**
 * 选项：宽度够时一列一个，行名在左边只写一遍，同一行对同一行；
 * 放不下时（窗口窄，或者选项多）一个选项一张卡摞起来，每一行的名字写在自己前面，不出横向滚动条。
 * 只有一个方向的卡，另加一个「否决」。
 */
function Options({
  card,
  field,
  pick,
  readOnly,
}: {
  card: Card;
  field: string;
  pick: string | undefined;
  readOnly: boolean;
}) {
  const update = useDraft((state) => state.update);
  const options = card.options ?? [];
  const rows = card.rows ?? [];
  const names = [...rows, "理由", "代价", "适用场景"];
  const cellsOf = (option: (typeof options)[number]) => [
    ...rows.map((_, k) => option.diffs[k]),
    option.why,
    option.cost,
    option.when,
  ];
  const columns = options.length + (card.only ? 1 : 0);
  const [box, table] = useWidthAtLeast(namesWidth + columns * (optionWidth + optionGap));
  return (
    <section className="flex flex-col gap-2">
      <Label>{card.only ? "只有这一个方向" : "选项"}</Label>
      <div ref={box}>
        <RadioGroup
          aria-labelledby={`title-${card.id}`}
          value={pick ?? null}
          onChange={(value) => update(field, { pick: value })}
          isReadOnly={readOnly}
        >
          <div
            className={table ? "grid gap-x-3" : "flex flex-col gap-3"}
            style={
              table
                ? {
                    gridTemplateColumns: `minmax(5rem,auto) repeat(${columns}, minmax(0,1fr))`,
                    gridTemplateRows: `auto repeat(${names.length}, auto) auto`,
                  }
                : undefined
            }
          >
            {table && (
              <div className="row-span-full grid grid-rows-subgrid">
                <div />
                {names.map((name) => (
                  <div
                    key={name}
                    className="border-t border-secondary py-2 text-meta text-tertiary"
                  >
                    {name}
                  </div>
                ))}
                <div />
              </div>
            )}
            {options.map((option) => (
              <Radio
                key={option.key}
                value={option.key}
                className={({ isSelected, isFocusVisible, isHovered }) =>
                  cx(
                    "rounded-xl px-3 ring-1 transition-shadow",
                    // 只读时点不动：选中的照旧，没选的指针说不能点。
                    readOnly
                      ? isSelected
                        ? "cursor-default"
                        : "cursor-not-allowed"
                      : "cursor-pointer",
                    // 每一列的宽度由栅格定，里面放不下的内容自己滚，不撑开这一列，也不压到旁边的选项。
                    table
                      ? "row-span-full grid min-w-0 grid-cols-[minmax(0,1fr)] grid-rows-subgrid"
                      : "flex min-w-0 flex-col",
                    isSelected ? "bg-secondary ring-2 ring-fg-brand-primary" : "ring-secondary",
                    isHovered && !isSelected && !readOnly && "ring-fg-quaternary",
                    isFocusVisible && "outline-2 outline-offset-2 outline-focus-ring",
                  )
                }
              >
                {({ isSelected }) => (
                  <>
                    <div className="flex items-center gap-2 py-3">
                      <motion.span
                        animate={{ scale: isSelected ? [1, 1.2, 1] : 1 }}
                        transition={motionTokens.select}
                        className={cx(
                          "flex size-5 shrink-0 items-center justify-center rounded-full text-label",
                          isSelected
                            ? "bg-fg-brand-primary text-white"
                            : "ring-1 ring-fg-quaternary text-tertiary",
                        )}
                      >
                        {isSelected ? <Check className="size-3.5" /> : option.key}
                      </motion.span>
                      <span className="text-ui font-semibold">{option.title}</span>
                      {card.stance?.pick === option.key && (
                        <span className="ml-auto shrink-0 text-label text-brand-secondary">
                          我的看法
                        </span>
                      )}
                    </div>
                    {cellsOf(option).map((text, k) => (
                      <div
                        key={names[k]}
                        className={cx(
                          "min-w-0 border-t border-secondary py-2 text-ui text-secondary",
                          !table && "grid grid-cols-[5.5rem_minmax(0,1fr)] gap-x-3",
                        )}
                      >
                        {!table && <span className="text-meta text-tertiary">{names[k]}</span>}
                        <div className="min-w-0 wrap-anywhere">
                          {text === undefined ? null : <Paragraphs text={text} />}
                        </div>
                      </div>
                    ))}
                    <div className="min-w-0 overflow-x-auto pb-3">
                      {option.sketch !== undefined && (
                        <SafeHtml html={option.sketch} className="mt-2" />
                      )}
                    </div>
                  </>
                )}
              </Radio>
            ))}
            {card.only && (
              <Radio
                value="否决"
                className={({ isSelected, isFocusVisible }) =>
                  cx(
                    "flex cursor-pointer flex-col gap-2 rounded-xl px-3 py-3 ring-1",
                    table && "row-span-full",
                    isSelected ? "bg-secondary ring-2 ring-fg-brand-primary" : "ring-secondary",
                    isFocusVisible && "outline-2 outline-offset-2 outline-focus-ring",
                  )
                }
              >
                <span className="text-ui font-semibold">否决</span>
              </Radio>
            )}
          </div>
        </RadioGroup>
      </div>
    </section>
  );
}
