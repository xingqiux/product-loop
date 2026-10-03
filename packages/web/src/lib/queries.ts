// 查询的定义：键、取数据的函数。页面用 useQuery 或路由的加载函数取。
import type { Issue } from "@product-loop/model";
import { queryOptions } from "@tanstack/react-query";
import { load } from "./api.ts";
import { keys } from "./query-keys.ts";

/** 所有项目的状态，和 ploop status --all 相同。 */
export const projectsQuery = queryOptions({
  queryKey: keys.projects,
  queryFn: async ({ signal }) => {
    const reply = await load((api) => api.api.v1.projects.$get({ query: {} }), signal);
    // 同一个接口带 path 时返回一个项目，这里没带，返回的是列表。
    const { data } = reply;
    if (!isList(data)) throw new Error("所有项目的状态应当是列表。");
    return { ...reply, data };
  },
});

/** Array.isArray 对只读数组会收窄成 any[]，这里保留元素的类型。 */
function isList<T>(value: readonly T[] | object): value is readonly T[] {
  return Array.isArray(value);
}

type ProjectsReply = Awaited<ReturnType<NonNullable<typeof projectsQuery.queryFn>>>;

/**
 * 列表外壳里的备份警告。后端先放各项目要体检的警告，一个项目一条，再放备份的警告。
 * 所以跳过前面那几条，剩下的就是备份的。
 */
export function backupWarningsOf(reply: ProjectsReply): readonly Issue[] {
  const doctor = reply.data.filter((status) => status.skill.doctor !== null).length;
  return reply.warnings.slice(doctor);
}

/** 一个项目的状态，和 ploop status 相同。 */
export const statusQuery = (pid: string) =>
  queryOptions({
    queryKey: keys.status(pid),
    queryFn: ({ signal }) =>
      load((api) => api.api.v1.projects[":pid"].status.$get({ param: { pid } }), signal),
  });

/** 各版和每版下的阶段，从第 1 版排起。 */
export const versionsQuery = (pid: string) =>
  queryOptions({
    queryKey: keys.versions(pid),
    queryFn: ({ signal }) =>
      load((api) => api.api.v1.projects[":pid"].versions.$get({ param: { pid } }), signal),
  });

/** 一个阶段的详情：拿出的事、给出过的页。 */
export const roundQuery = (pid: string, round: string) =>
  queryOptions({
    queryKey: keys.round(pid, round),
    queryFn: ({ signal }) =>
      load(
        (api) => api.api.v1.projects[":pid"].rounds[":rid"].$get({ param: { pid, rid: round } }),
        signal,
      ),
  });

/** 队列里的全部事项，按编号排。 */
export const queueQuery = (pid: string) =>
  queryOptions({
    queryKey: keys.queue(pid),
    queryFn: ({ signal }) =>
      load((api) => api.api.v1.projects[":pid"].queue.$get({ param: { pid }, query: {} }), signal),
  });

/** 现在的队列看板：在等的放上面，其余按阶段分五列，停了七天的标出来。 */
export const queueBoardQuery = (pid: string) =>
  queryOptions({
    queryKey: [...keys.queue(pid), "board"],
    queryFn: ({ signal }) =>
      load((api) => api.api.v1.projects[":pid"].queue.board.$get({ param: { pid } }), signal),
  });

/** 一件事的全部字段、状态变化和出现在哪些阶段。 */
export const queueItemQuery = (pid: string, qid: string) =>
  queryOptions({
    queryKey: [...keys.queue(pid), "item", qid],
    queryFn: ({ signal }) =>
      load(
        (api) => api.api.v1.projects[":pid"].queue[":qid"].$get({ param: { pid, qid } }),
        signal,
      ),
  });

/** 决定，默认只有有效的。all 写 true 时连已作废的一起列。 */
export const decisionsQuery = (pid: string, all = false) =>
  queryOptions({
    queryKey: all ? [...keys.decisions(pid), "all"] : keys.decisions(pid),
    queryFn: ({ signal }) =>
      load(
        (api) =>
          api.api.v1.projects[":pid"].decisions.$get({
            param: { pid },
            query: all ? { includeVoided: "true" } : {},
          }),
        signal,
      ),
  });

/** 一份回复和它的每一行。决定的展示卡片据此写它来自哪个阶段的哪一行。 */
export const submissionQuery = (pid: string, sid: number) =>
  queryOptions({
    queryKey: [...keys.project(pid), "submissions", sid],
    queryFn: ({ signal }) =>
      load(
        (api) =>
          api.api.v1.projects[":pid"].submissions[":sid"].$get({
            param: { pid, sid: String(sid) },
          }),
        signal,
      ),
  });

/** 主线的历次版本，按版本号从小到大排。 */
export const mainlineRevisionsQuery = (pid: string) =>
  queryOptions({
    queryKey: [...keys.mainline(pid), "revisions"],
    queryFn: ({ signal }) =>
      load(
        (api) => api.api.v1.projects[":pid"].mainline.revisions.$get({ param: { pid } }),
        signal,
      ),
  });

/** 填好的一页。 */
export const pageQuery = (pid: string, page: number) =>
  queryOptions({
    queryKey: keys.page(pid, page),
    queryFn: ({ signal }) =>
      load(
        (api) =>
          api.api.v1.projects[":pid"].pages[":id"].$get({ param: { pid, id: String(page) } }),
        signal,
      ),
  });

/** 一页的草稿。 */
export const draftQuery = (pid: string, page: number) =>
  queryOptions({
    queryKey: keys.draft(pid, String(page)),
    queryFn: ({ signal }) =>
      load(
        (api) =>
          api.api.v1.projects[":pid"].pages[":id"].draft.$get({ param: { pid, id: String(page) } }),
        signal,
      ),
    // 草稿以工作台自己为准，别处改了由事件流通知。
    staleTime: Number.POSITIVE_INFINITY,
  });

/** 一版主线的全文和解析结果。 */
export const mainlineRevisionQuery = (pid: string, revision: number) =>
  queryOptions({
    queryKey: [...keys.mainline(pid), "revisions", revision],
    queryFn: ({ signal }) =>
      load(
        (api) =>
          api.api.v1.projects[":pid"].mainline.revisions[":rev"].$get({
            param: { pid, rev: String(revision) },
          }),
        signal,
      ),
  });

/** 两版主线的逐行比较。 */
export const mainlineDiffQuery = (pid: string, from: number, to: number) =>
  queryOptions({
    queryKey: [...keys.mainline(pid), "diff", from, to],
    queryFn: ({ signal }) =>
      load(
        (api) =>
          api.api.v1.projects[":pid"].mainline.diff.$get({
            param: { pid },
            query: { from: String(from), to: String(to) },
          }),
        signal,
      ),
  });

/** 主线的十个部分各是哪一版、哪个阶段最近改的。 */
export const mainlinePartsQuery = (pid: string) =>
  queryOptions({
    queryKey: [...keys.mainline(pid), "parts"],
    queryFn: ({ signal }) =>
      load((api) => api.api.v1.projects[":pid"].mainline.parts.$get({ param: { pid } }), signal),
  });

/** 项目的场景，按编号排，只有最新的主线里还在的。 */
export const scenesQuery = (pid: string) =>
  queryOptions({
    queryKey: [...keys.mainline(pid), "scenes"],
    queryFn: ({ signal }) =>
      load(
        (api) => api.api.v1.projects[":pid"].mainline.scenes.$get({ param: { pid }, query: {} }),
        signal,
      ),
  });

/** 各项目报上来的 skill 问题，按编号排。 */
export const skillIssuesQuery = queryOptions({
  queryKey: [...keys.issues, "list"],
  queryFn: ({ signal }) => load((api) => api.api.v1.skill.issues.$get({ query: {} }), signal),
});

/** skill 的三类信号：反复被拦截的规矩、停在旧版本的项目、停了很多天的事。 */
export const skillSignalsQuery = queryOptions({
  queryKey: [...keys.issues, "signals"],
  queryFn: ({ signal }) => load((api) => api.api.v1.skill.signals.$get(), signal),
});
