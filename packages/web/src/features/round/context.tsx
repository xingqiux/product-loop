// 一页的公共信息：项目、页面数据、能不能改。各区块从这里取，不一层层往下传。
import { useQuery } from "@tanstack/react-query";
import { createContext, useContext, useMemo } from "react";
import { type pageQuery, queueQuery } from "@/lib/queries";
import { type PageState, queueContentsOf } from "./model";

/** 接口返回的一页。 */
type RawPage = Awaited<ReturnType<NonNullable<ReturnType<typeof pageQuery>["queryFn"]>>>["data"];

type RawSections = RawPage["sections"];
type Ided<T> = T extends readonly (infer I)[] ? readonly (I & { readonly id: string })[] : T;

/** 后端给出的页面数据里，有编号的区块每一项都已填好编号，接口的类型里仍是可以不写。 */
export type Sections = {
  readonly [K in keyof RawSections]: K extends "refs" | "screens"
    ? RawSections[K]
    : Ided<RawSections[K]>;
};

export type FilledPage = Omit<RawPage, "sections"> & { readonly sections: Sections };
export type Fill = FilledPage["fill"];

export type PageContextValue = {
  readonly pid: string;
  readonly page: FilledPage;
  /** 这一页现在能做什么，见 model.ts 的 pageStateOf。 */
  readonly state: PageState;
  /** 只有还能提交的页能改，其余都只读：已提交、已回复、所在的阶段已收尾、已撤回、旧页面。 */
  readonly readOnly: boolean;
  /** 换到另一屏，item 是屏里的哪一项。 */
  readonly go: (screen: string, item?: string) => void;
};

export const PageContext = createContext<PageContextValue | null>(null);

export function usePage(): PageContextValue {
  const value = useContext(PageContext);
  if (value === null) throw new Error("usePage 要在 PageContext 里用。");
  return value;
}

/**
 * 队列里各件事的内容，按编号找。页面上写内容，不写编号。
 * 队列全表里有已完成和已取消的，这一页给出时的看板只有没做完的，两边合起来才认得全；
 * 同一件事以这一页给出时的内容为准。
 */
export function useQueueContents(): ReadonlyMap<string, string> {
  const { pid, page } = usePage();
  const all = useQuery(queueQuery(pid));
  return useMemo(
    () =>
      new Map([
        ...(all.data?.data ?? []).map((item) => [item.id, item.content] as const),
        ...queueContentsOf(page.fill.queue),
      ]),
    [all.data, page.fill.queue],
  );
}

/** 截图的地址：按路径找到哈希，从附件的接口取。找不到时为空。 */
export function useImageUrl(): (path: string | undefined) => string | undefined {
  const { page } = usePage();
  return (path) => {
    if (path === undefined) return undefined;
    const found = page.images.find((image) => image.path === path);
    return found === undefined ? undefined : `/api/v1/blobs/${found.hash}`;
  };
}
