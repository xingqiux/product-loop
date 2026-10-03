import type { Client } from "../client.ts";

// 照搬验证代码的四处故意写错的调用，原样见 spikes/backend/packages/client/type-errors/。
// 每处前面的 @ts-expect-error 要求下一行有类型错误。哪一处不再报错，类型检查就报 TS2578。
// 运行时 hc 不查这些错误，请求照样发出，测试里用假的后端核对这一点。

/** 错误一：仓库类别写了英文键。接口上收发中文，见「05 接口」第一节。 */
export function wrongEnum(client: Client) {
  return client.call((api) =>
    api.api.v1.projects.$post({
      // @ts-expect-error 仓库类别只收「自己的」和「共用的」
      json: { root: "/work/app", repoKind: "shared" },
    }),
  );
}

/** 错误二：漏了路径参数 pid。 */
export function missingParam(client: Client) {
  return client.call((api) =>
    // @ts-expect-error 缺少 param
    api.api.v1.projects[":pid"].versions.next.$post({ json: { reason: "跳过提升" } }),
  );
}

/** 错误三：读了响应里没有的字段。登记的结果是 project 和 version，没有 projectId。 */
export async function missingField(client: Client) {
  const result = await client.call((api) =>
    api.api.v1.projects.$post({ json: { root: "/work/app", repoKind: "自己的" } }),
  );
  // @ts-expect-error data 里没有 projectId
  return result.ok ? result.value.data.projectId : undefined;
}

/** 错误四：调了后端没有的接口。项目不能删。 */
export function missingRoute(client: Client) {
  // @ts-expect-error 没有 DELETE /projects/:pid
  return client.call((api) => api.api.v1.projects[":pid"].$delete({ param: { pid: "app" } }));
}
