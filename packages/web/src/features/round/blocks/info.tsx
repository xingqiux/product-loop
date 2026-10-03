// 只给人看的几块：回复去处、取消的事、使用、工程证据、参考。
// 块的名字写成名字，不超过八个字，名字下面不加说明。
import { beijingMinute, landStepState, parseCoverage } from "@product-loop/model";
import { useQuery } from "@tanstack/react-query";
import { useId, useMemo, useState } from "react";
import { cx } from "@/lib/cx";
import { decisionsQuery, pageQuery } from "@/lib/queries";
import { roundNameOf } from "@/lib/rounds";
import { usePage, useQueueContents } from "../context";
import { ZoomImage } from "../evidence/figure";
import { Label, Paragraphs } from "../evidence/text";
import { LineFields } from "../line-fields";
import { cardTitlesOf, droppedField, lineFields, type PageSections } from "../model";
import { NoteField } from "../note-field";
import { Sheet } from "../sheet";

/** 块的名字。要写明的事实（哪个阶段、几点）写在名字旁边，不藏在悬停里。 */
function Title({ title, meta }: { title: string; meta?: string }) {
  return (
    <header className="flex flex-wrap items-baseline gap-x-3">
      <h2 className="text-title">{title}</h2>
      {meta !== undefined && <span className="text-meta text-tertiary">{meta}</span>}
    </header>
  );
}

type Destination =
  | { readonly to: "主线"; readonly revision: number; readonly part: string }
  | { readonly to: "决定"; readonly id: number }
  | { readonly to: "队列"; readonly id: string }
  | { readonly to: "当场做"; readonly round: string; readonly evidence: string }
  | { readonly to: "不处理"; readonly reason: string };

/** 去处写成内容：决定和队列事项写它们自己的内容，不写队列编号。 */
function destinationText(
  destination: Destination,
  contents: ReadonlyMap<string, string>,
  decisions: ReadonlyMap<number, string>,
): string {
  switch (destination.to) {
    case "主线":
      return `主线的「${destination.part}」`;
    case "决定":
      return `决定：${decisions.get(destination.id) ?? "已记入决定"}`;
    case "队列":
      return `队列：${contents.get(destination.id) ?? "已放进队列"}`;
    case "当场做":
      return `${roundNameOf(destination.round)}当场做了：${destination.evidence}`;
    case "不处理":
      return `不处理：${destination.reason}`;
  }
}

/** 去处的悬停提示：决定的编号。队列事项的编号不是用户的词，不写。 */
function destinationHint(destination: Destination): string | undefined {
  return destination.to === "决定" ? `决定 ${destination.id}` : undefined;
}

export function PreviousBlock() {
  const { pid, page } = usePage();
  const previous = page.fill.previousReplies;
  const earlier = useQuery({
    ...pageQuery(pid, previous?.page ?? 0),
    enabled: previous !== null,
  });
  const decisions = useQuery(decisionsQuery(pid, true));
  const contents = useQueueContents();
  const titles = useMemo(
    () => cardTitlesOf(earlier.data?.data.sections as PageSections | undefined),
    [earlier.data],
  );
  const decisionTexts = useMemo(
    () => new Map((decisions.data?.data ?? []).map((item) => [item.id, item.decision] as const)),
    [decisions.data],
  );
  if (previous === null) return null;
  const counts = new Map<string, number>();
  for (const line of previous.lines) {
    const key = line.handled?.destination.to ?? "还没处理";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return (
    <div className="flex flex-col gap-5">
      <Title
        title="回复去处"
        meta={`${roundNameOf(previous.round)}，${beijingMinute(new Date(previous.submittedAt))} 提交`}
      />
      <p className="flex flex-wrap gap-2">
        {[...counts].map(([key, count]) => (
          <span key={key} className="rounded-md px-1.5 py-0.5 text-label ring-1 ring-secondary">
            {key} {count}
          </span>
        ))}
      </p>
      <ol className="divide-y divide-secondary rounded-xl ring-1 ring-secondary">
        {previous.lines.map((line) => {
          const card = line.card === undefined ? undefined : titles.get(line.card);
          const option = line.option === undefined ? undefined : card?.options[line.option];
          const destination = line.handled?.destination as Destination | undefined;
          return (
            <li key={line.line} className="grid gap-1 px-4 py-3 md:grid-cols-[1fr_1fr] md:gap-4">
              <LineFields
                fields={lineFields(line, {
                  title:
                    line.queue === undefined
                      ? card?.title
                      : (contents.get(line.queue) ?? "队列事项"),
                  optionTitle: option,
                })}
              />
              <span
                title={destination === undefined ? undefined : destinationHint(destination)}
                className={cx("text-ui", line.handled ? "text-secondary" : "text-warning-primary")}
              >
                {destination === undefined
                  ? "还没处理"
                  : line.kind === "认可一条更改" && destination.to === "不处理"
                    ? "不处理"
                    : destinationText(destination, contents, decisionTexts)}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export function DroppedBlock() {
  const { page, readOnly } = usePage();
  const dropped = page.fill.droppedAtStart;
  return (
    <div className="flex flex-col gap-5">
      <Title title="取消的事" />
      <ul className="divide-y divide-secondary rounded-xl ring-1 ring-secondary">
        {dropped.map((item) => (
          <li key={item.id} className="flex flex-col gap-1 px-4 py-3">
            <span className="text-ui">{item.content}</span>
            <span className="text-meta text-tertiary">取消的原因：{item.reason}</span>
          </li>
        ))}
      </ul>
      <NoteField field={droppedField} readOnly={readOnly} placeholder="备注" />
    </div>
  );
}

const resultTone = new Map<string, string>([
  ["通过", "text-success-primary"],
  ["断了", "text-error-primary"],
  ["没走", "text-tertiary"],
  ["环境", "text-warning-primary"],
]);

export function UseBlock() {
  const { page } = usePage();
  const run = page.fill.use;
  if (run === null) return null;
  const gaps = run.coverage === null ? null : parseCoverage(run.coverage).gaps;
  return (
    <div className="flex flex-col gap-5">
      <Title title="使用" />
      {run.scenes.map((scene) => (
        <UseScene key={scene.scene} scene={scene} />
      ))}
      {gaps !== null && (
        <section className="flex flex-col gap-2">
          <Label>覆盖表的缺口 {gaps.length}</Label>
          <ul className="flex flex-col gap-1">
            {gaps.map((gap) => (
              <li key={gap.line} className="text-ui">
                {gap.item}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

type UseRun = NonNullable<ReturnType<typeof usePage>["page"]["fill"]["use"]>;

/**
 * 一个场景一块：写编号、名字和结果，下面是每一步。
 * 走通的折叠，点「展开」才看到步骤；断了和没有走的直接展开（S6 第 1 步）。
 */
function UseScene({ scene }: { scene: UseRun["scenes"][number] }) {
  const passed = scene.steps.every((step) => step.result === "通过");
  const [open, setOpen] = useState(false);
  const listId = useId();
  const count = new Set(scene.steps.map((step) => step.step)).size;
  return (
    <section className="flex flex-col gap-3 rounded-xl p-4 ring-1 ring-secondary">
      <h3 className="flex flex-wrap items-baseline gap-2 text-heading">
        <span className="text-meta text-tertiary">{scene.scene}</span>
        {scene.name ?? ""}
        <SceneResult steps={scene.steps} />
      </h3>
      {passed && (
        <button
          type="button"
          aria-expanded={open}
          aria-controls={listId}
          onClick={() => setOpen(!open)}
          className="inline-flex min-h-6 items-center self-start text-meta text-brand-secondary hover:underline"
        >
          {open ? "收起" : `展开 ${count} 步`}
        </button>
      )}
      {(!passed || open) && (
        <ol id={listId} className="grid gap-3 md:grid-cols-2">
          {scene.steps.map((step) => (
            <li
              key={`${step.step}-${step.width ?? 0}`}
              className="flex flex-col gap-1 rounded-lg bg-secondary p-3"
            >
              <span className={cx("text-label", resultTone.get(step.result))}>
                第 {step.step} 步 {step.result}
                {step.width !== null && <span className="ml-2 text-tertiary">{step.width} 宽</span>}
              </span>
              <span className="text-ui">{step.do}</span>
              <span className="text-meta text-tertiary">该看到：{step.expect}</span>
              {step.error !== null && (
                <span className="text-meta text-error-primary">{step.error}</span>
              )}
              {step.shot !== null && (
                <ZoomImage
                  src={`/api/v1/blobs/${step.shot}`}
                  alt={`${scene.scene} 第 ${step.step} 步`}
                />
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/** 一个场景的结果写成一句：走通、断在哪一步、没有走。 */
function SceneResult({ steps }: { steps: readonly { step: number; result: string }[] }) {
  const broken = steps.find((step) => step.result === "断了" || step.result === "环境");
  const text =
    broken !== undefined
      ? `断在第 ${broken.step} 步`
      : steps.every((step) => step.result === "没走")
        ? "没有走"
        : steps.every((step) => step.result === "通过")
          ? "走通"
          : "没走完";
  const tone =
    broken !== undefined
      ? resultTone.get(broken.result)
      : text === "走通"
        ? resultTone.get("通过")
        : resultTone.get("没走");
  return <span className={cx("text-ui", tone)}>{text}</span>;
}

export function LandBlock() {
  const { page } = usePage();
  const land = page.fill.landEvidence;
  if (land === null) return null;
  return (
    <div className="flex flex-col gap-5">
      <Title title="工程证据" />
      {/* 没记的、没有的不写，也不摆只有表头的空表。 */}
      {land.tidy.state !== landStepState.label("missing") && (
        <section className="flex flex-col gap-2">
          <Label>重构</Label>
          <p className="text-ui">
            {land.tidy.state === "跳过了"
              ? `不需要重构${land.tidy.reason === null || land.tidy.reason === undefined ? "" : `：${land.tidy.reason}`}`
              : land.tidy.run === null
                ? land.tidy.state
                : `重构以后运行 ${land.tidy.run.command.join(" ")}，${land.tidy.run.exitCode === 0 ? "通过" : "没通过"}`}
          </p>
        </section>
      )}
      {land.changes.length > 0 && (
        <section className="flex flex-col gap-2">
          <Label>先失败后通过</Label>
          <table className="text-left text-ui">
            <thead className="text-meta text-tertiary">
              <tr>
                <th className="py-1.5 pr-4 font-normal">改动</th>
                <th className="py-1.5 pr-4 font-normal">状态</th>
                <th className="py-1.5 font-normal">运行的内容</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-secondary">
              {land.changes.map((change) => (
                <tr key={change.name}>
                  <td className="py-2 pr-4 font-medium">{change.name}</td>
                  <td
                    className={cx(
                      "py-2 pr-4",
                      change.state === "先失败后通过"
                        ? "text-success-primary"
                        : "text-warning-primary",
                    )}
                  >
                    {change.state}
                  </td>
                  <td className="py-2 font-mono text-label text-tertiary">
                    {(change.green ?? change.red)?.command.join(" ") ?? ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
      {((land.review.opinions?.length ?? 0) > 0 || land.review.reason !== null) && (
        <section className="flex flex-col gap-2">
          <Label>评审的意见和处置</Label>
          {land.review.opinions !== null && land.review.opinions.length > 0 ? (
            <ul className="flex flex-col gap-2">
              {land.review.opinions.map((opinion) => (
                <li key={JSON.stringify(opinion)} className="rounded-lg bg-secondary p-3 text-ui">
                  <Paragraphs
                    text={Object.values(opinion)
                      .filter((v) => typeof v === "string" || typeof v === "number")
                      .join("　")}
                  />
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-ui">{land.review.reason}</p>
          )}
        </section>
      )}
      {land.plan !== null && land.plan.verdicts.length > 0 && (
        <section className="flex flex-col gap-2">
          <Label>AI 自己裁决的</Label>
          <table className="text-left text-ui">
            <tbody className="divide-y divide-secondary">
              {land.plan.verdicts.map((row) => (
                <tr key={row.join("|")}>
                  {row.map((cell, index) => (
                    <td key={cell} className={cx("py-2 pr-4", index === 0 && "font-medium")}>
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}

const refsShown = 8;

export function RefsBlock() {
  const { page } = usePage();
  const refs = page.sections.refs ?? [];
  const [all, setAll] = useState(false);
  const [at, setAt] = useState<number | undefined>();
  const shown = all ? refs : refs.slice(0, refsShown);
  return (
    <div className="flex flex-col gap-5">
      <Title title="参考" />
      <ul className="divide-y divide-secondary rounded-xl ring-1 ring-secondary">
        {shown.map((ref, index) => (
          <li key={ref.name}>
            <button
              type="button"
              onClick={() => setAt(index)}
              className="grid w-full grid-cols-[1fr_auto_auto] gap-4 px-4 py-3 text-left hover:bg-secondary"
            >
              <span className="text-ui font-medium">{ref.name}</span>
              <span className="text-meta text-tertiary">{ref.kind}</span>
              <span className="text-meta text-brand-secondary">{ref.advice}</span>
            </button>
          </li>
        ))}
      </ul>
      {!all && refs.length > refsShown && (
        <button
          type="button"
          onClick={() => setAll(true)}
          className="inline-flex min-h-6 items-center self-start text-meta text-brand-secondary hover:underline"
        >
          展开其余 {refs.length - refsShown} 条
        </button>
      )}
      <Sheet
        items={refs.map((ref) => ({
          title: ref.name,
          attrs: [
            ["类型", ref.kind],
            ["阅读深度", ref.depth],
            ["相关度", ref.relevance],
            ["证据强度", ref.strength],
            ["建议", ref.advice],
            ...(ref.where === undefined ? [] : [["用在", ref.where] as const]),
          ],
          body: ref.body,
        }))}
        at={at}
        onAt={setAt}
      />
    </div>
  );
}
