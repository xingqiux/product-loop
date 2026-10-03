// 决定页，见「06 工作台」第七节和场景 S10。
// 一张表，最近的在最上面，默认只列有效的，能切换成全部，能搜。作废的划掉，写被哪一条推翻。
// 点一条出展示卡片，写它来自哪个阶段的哪一条回复。
import { useQuery } from "@tanstack/react-query";
import { SearchLg } from "@untitledui/icons";
import { useState } from "react";
import { Notice } from "@/components/notice";
import { RowButton, rowClass } from "@/components/row-button";
import { Segmented } from "@/components/segmented";
import { Input } from "@/components/ui/base/input/input";
import { FromLine } from "@/features/round/from-line";
import { Sheet } from "@/features/round/sheet";
import { cx } from "@/lib/cx";
import { decisionsQuery } from "@/lib/queries";
import { matches } from "./matches";

type Scope = "active" | "all";

/** 表里写被哪一条决定推翻：写那一条的内容，太长的截断。 */
function short(text: string, max = 24): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

export function DecisionsPage({ pid }: { pid: string }) {
  const [scope, setScope] = useState<Scope>("active");
  const [at, setAt] = useState<number | undefined>();
  const [query, setQuery] = useState("");
  const decisions = useQuery(decisionsQuery(pid, scope === "all"));
  const total = decisions.data?.data.length ?? 0;
  // 最近的在最上面，用户最常要看的是最近定的。
  const list = [...(decisions.data?.data ?? [])]
    .sort((a, b) => b.id - a.id)
    .filter((d) => matches(d, query));
  // 被推翻的决定写推翻它的那一条的内容，不写第几条。
  const contentOf = new Map((decisions.data?.data ?? []).map((d) => [d.id, d.decision] as const));
  const voidedBy = (id: number | undefined) =>
    id === undefined ? "另一条决定" : `「${short(contentOf.get(id) ?? "另一条决定")}」`;
  const sheets = list.map((d) => ({
    title: d.decision,
    attrs: [
      ["编号", String(d.id)],
      ["种类", d.kind],
      ["状态", d.status],
      // 状态只写「已作废」，推翻它的决定另起一行。
      ...(d.status === "已作废"
        ? [["推翻它的决定", contentOf.get(d.voidedBy ?? 0) ?? "另一条决定"] as const]
        : []),
      ["日期", d.date],
      ["原因", d.reason],
      ...(d.case === "" ? [] : [["案例", d.case] as const]),
      ...(d.voidReason === undefined ? [] : [["作废的原因", d.voidReason] as const]),
    ] as const,
    foot:
      d.fromLine === undefined ? undefined : (
        <FromLine pid={pid} submission={d.fromLine.submission} line={d.fromLine.line} />
      ),
  }));
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <Segmented
          label="决定范围"
          value={scope}
          options={[
            ["active", "有效的"],
            ["all", "全部"],
          ]}
          onChange={(value) => {
            setAt(undefined);
            setScope(value);
          }}
        />
        <div className="w-64 max-w-full">
          <Input
            aria-label="搜索决定"
            placeholder="搜索决定"
            icon={SearchLg}
            size="sm"
            value={query}
            onChange={(value) => {
              setAt(undefined);
              setQuery(value);
            }}
          />
        </div>
        {decisions.data !== undefined && (
          <span className="text-meta text-tertiary">
            {query.trim() === "" ? `${total} 条` : `${list.length} / ${total} 条`}
          </span>
        )}
      </div>
      {decisions.isError ? (
        <Notice kind="error" error={decisions.error} onRetry={() => void decisions.refetch()}>
          读不到决定。
        </Notice>
      ) : decisions.data === undefined ? (
        <Notice kind="loading">正在读取</Notice>
      ) : total === 0 ? (
        <Notice kind="empty">没有决定</Notice>
      ) : (
        <div className="overflow-x-auto rounded-xl ring-1 ring-secondary">
          <table className="w-full text-left text-ui">
            <thead className="bg-secondary text-meta text-tertiary">
              <tr>
                <th className="w-16 px-4 py-2 font-normal whitespace-nowrap">编号</th>
                <th className="px-4 py-2 font-normal">决定</th>
                <th className="px-4 py-2 font-normal">原因</th>
                <th className="px-4 py-2 font-normal whitespace-nowrap">日期</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-secondary">
              {/* 搜不到时表头留着，写一句没有找到，不留一片空白。 */}
              {list.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-tertiary">
                    没有找到
                  </td>
                </tr>
              )}
              {list.map((d, index) => {
                const voided = d.status === "已作废";
                return (
                  <tr key={d.id} className={cx("align-top", rowClass)}>
                    <td className="px-4 py-3 text-tertiary tabular-nums">{d.id}</td>
                    <td className="px-4 py-3">
                      <RowButton onOpen={() => setAt(index)}>
                        <span className={cx(voided && "text-tertiary line-through")}>
                          {d.decision}
                        </span>
                      </RowButton>
                      {d.kind === "以后再说" && (
                        <span className="ml-2 rounded-md px-1.5 py-0.5 text-label whitespace-nowrap text-warning-primary ring-1 ring-secondary">
                          以后再说
                        </span>
                      )}
                      {voided && (
                        <span className="block text-meta text-error-primary">
                          被{voidedBy(d.voidedBy)}推翻
                        </span>
                      )}
                    </td>
                    <td
                      className={cx(
                        "px-4 py-3 text-secondary",
                        voided && "text-tertiary line-through",
                      )}
                    >
                      {d.reason}
                    </td>
                    <td className="px-4 py-3 text-meta whitespace-nowrap text-tertiary tabular-nums">
                      {d.date}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <Sheet items={sheets} at={at} onAt={setAt} />
    </div>
  );
}
