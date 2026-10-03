// 展示卡片里的来源：一件事或一条决定来自哪个阶段的哪一条回复。读那一份回复，写阶段的名字和那一条的内容，
// 不写第几份回复、第几行，用户不用去数。
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { Notice } from "@/components/notice";
import { pageQuery, submissionQuery } from "@/lib/queries";
import { roundHref, roundNameOf } from "@/lib/rounds";
import { LineFields } from "./line-fields";
import { cardTitlesOf, lineFields, type PageSections } from "./model";

export function FromLine({
  pid,
  submission,
  line,
}: {
  pid: string;
  submission: number;
  line: number;
}) {
  const reply = useQuery(submissionQuery(pid, submission));
  const earlier = useQuery({
    ...pageQuery(pid, reply.data?.data.page ?? 0),
    enabled: reply.data !== undefined,
  });
  const titles = useMemo(
    () => cardTitlesOf(earlier.data?.data.sections as PageSections | undefined),
    [earlier.data],
  );
  if (reply.isError) {
    return (
      <Notice kind="error" size="inline" error={reply.error} onRetry={() => void reply.refetch()}>
        读不到它来自的回复。
      </Notice>
    );
  }
  if (reply.data === undefined) {
    return (
      <Notice kind="loading" size="inline">
        正在读取
      </Notice>
    );
  }
  const { round, lines } = reply.data.data;
  const found = lines.find((l) => l.line === line);
  const card = found?.card === undefined ? undefined : titles.get(found.card);
  const option = found?.option === undefined ? undefined : card?.options[found.option];
  return (
    <section className="flex flex-col gap-1.5 rounded-lg bg-secondary p-3">
      <p className="text-meta text-tertiary">
        来自{" "}
        <a href={roundHref(pid, round)} className="text-brand-secondary hover:underline">
          {roundNameOf(round)}
        </a>{" "}
        的回复
      </p>
      {found !== undefined && (
        <LineFields fields={lineFields(found, { title: card?.title, optionTitle: option })} />
      )}
    </section>
  );
}
