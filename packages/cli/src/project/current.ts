import type { Api, DataOf } from "@product-loop/client";
import { type ErrorBody, err, ok, type ProjectIdentity, type Result } from "@product-loop/model";
import type { Backend, CommandEnv } from "../connect.ts";
import { discoverProject, noProjectError } from "./discover.ts";

// 要用到当前项目的命令先找到它，见「03 数据模型」第五节和「04 命令行」第二节。
// --project 写编号就用这个编号。否则往上找 project.json，再问后端这个目录登记过没有。

/** 按目录找到的项目：根目录和 project.json 的内容。--project 写编号时没有。 */
type LocalProject = { readonly root: string; readonly identity: ProjectIdentity };

/** 当前项目：编号，和按目录找到时的根目录、project.json。 */
export type CurrentProject = { readonly projectId: string; readonly local?: LocalProject };

type FoundResponse = Awaited<ReturnType<Api["api"]["v1"]["projects"]["$get"]>>;
/** 接口上的项目，枚举是中文。 */
export type ProjectView = Extract<DataOf<FoundResponse>, { readonly root: string }>["project"];

/** 这个根目录登记给了哪个项目。按路径找到的是它上级的根目录时，不算。 */
export async function registeredAt(
  backend: Backend,
  root: string,
): Promise<Result<ProjectView | undefined, ErrorBody>> {
  const found = await backend.call((api) => api.api.v1.projects.$get({ query: { path: root } }));
  if (found.ok) {
    const { data } = found.value;
    return ok("root" in data && data.root === root ? data.project : undefined);
  }
  return found.error.code === "NOT_FOUND" ? ok(undefined) : found;
}

/** 这个目录是不是这个项目登记过的根目录。 */
async function isRegisteredRoot(
  backend: Backend,
  root: string,
  projectId: string,
): Promise<Result<boolean, ErrorBody>> {
  const registered = await registeredAt(backend, root);
  return registered.ok ? ok(registered.value?.id === projectId) : registered;
}

/** 按 --project 或当前目录找到当前项目。找不到时提示运行 ploop init。 */
export async function currentProject(
  ctx: CommandEnv,
  backend: Backend,
  projectOption: string | undefined,
): Promise<Result<CurrentProject, ErrorBody>> {
  const found = await findCurrent(ctx, backend, projectOption);
  if (!found.ok) return found;
  return found.value.kind === "none" ? err(found.value.error) : ok(found.value.project);
}

/**
 * 当前项目，找不到时为 undefined。不在项目里也能用的命令用它，例如 ploop lint text。
 */
export async function optionalProject(
  ctx: CommandEnv,
  backend: Backend,
  projectOption: string | undefined,
): Promise<Result<CurrentProject | undefined, ErrorBody>> {
  const found = await findCurrent(ctx, backend, projectOption, true);
  if (!found.ok) return found;
  return ok(found.value.kind === "none" ? undefined : found.value.project);
}

type Found =
  | { readonly kind: "none"; readonly error: ErrorBody }
  | { readonly kind: "project"; readonly project: CurrentProject };

async function findCurrent(
  ctx: CommandEnv,
  backend: Backend,
  projectOption: string | undefined,
  optional = false,
): Promise<Result<Found, ErrorBody>> {
  const discovery = await discoverProject({
    cwd: ctx.cwd,
    home: ctx.userHome,
    ...(optional ? { homeIsNone: true } : {}),
    ...(projectOption === undefined ? {} : { projectOption }),
    isRegisteredRoot: (root, projectId) => isRegisteredRoot(backend, root, projectId),
  });
  if (!discovery.ok) return discovery;
  const found = discovery.value;
  switch (found.kind) {
    case "none":
      return ok({ kind: "none", error: noProjectError(found) });
    case "byId":
      return ok({ kind: "project", project: { projectId: found.projectId } });
    case "found":
      return ok({
        kind: "project",
        project: {
          projectId: found.identity.projectId,
          local: { root: found.root, identity: found.identity },
        },
      });
  }
}
