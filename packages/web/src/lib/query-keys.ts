// 查询的键按对象分，见「06 工作台」第九节。事件流收到事件时，按 keysOf 让对应的查询重取。
// 同一个项目的键都以 ["project", 项目] 开头，项目整个变了时一次重取。
import type { StreamEvent, StreamEventName } from "@product-loop/model";
import type { QueryKey } from "@tanstack/react-query";

export const keys = {
  /** 所有项目的状态，首页和顶上一行的备份警告用。 */
  projects: ["projects"],
  project: (pid: string) => ["project", pid],
  status: (pid: string) => ["project", pid, "status"],
  rounds: (pid: string) => ["project", pid, "rounds"],
  round: (pid: string, round: string) => ["project", pid, "rounds", round],
  pages: (pid: string) => ["project", pid, "pages"],
  page: (pid: string, page: number) => ["project", pid, "pages", page],
  draft: (pid: string, page: string) => ["project", pid, "drafts", page],
  queue: (pid: string) => ["project", pid, "queue"],
  decisions: (pid: string) => ["project", pid, "decisions"],
  mainline: (pid: string) => ["project", pid, "mainline"],
  versions: (pid: string) => ["project", pid, "versions"],
  land: (pid: string) => ["project", pid, "land"],
  use: (pid: string) => ["project", pid, "use"],
  /** skill 的问题不属于哪个项目。 */
  issues: ["issues"],
} as const satisfies Record<string, QueryKey | ((...args: never[]) => QueryKey)>;

/** 一条事件要让哪些查询重取。除了草稿，项目的状态和所有项目的列表都跟着重取。 */
export function keysOf(name: StreamEventName, event: StreamEvent): QueryKey[] {
  const pid = event.project;
  const summary = [keys.projects, keys.status(pid)];
  switch (name) {
    case "draft.saved":
      return [keys.draft(pid, event.objectId)];
    case "issue.changed":
      return [keys.issues];
    case "project.changed":
      return [keys.projects, keys.project(pid)];
    case "round.started":
    case "round.closed":
      return [...summary, keys.rounds(pid), keys.versions(pid)];
    case "page.presented":
    case "page.withdrawn":
    case "submission.created":
    case "reply.received":
    case "line.handled":
      // 这个阶段的状态跟着变，各版的进度和页头的阶段条都写着它。
      return [...summary, keys.rounds(pid), keys.pages(pid), keys.versions(pid)];
    case "queue.changed":
      return [...summary, keys.queue(pid)];
    case "decision.changed":
      return [...summary, keys.decisions(pid)];
    case "mainline.changed":
      return [...summary, keys.mainline(pid)];
    case "version.changed":
      return [...summary, keys.versions(pid), keys.rounds(pid)];
    case "land.changed":
      return [...summary, keys.land(pid)];
    case "use.changed":
      return [...summary, keys.use(pid)];
  }
}
