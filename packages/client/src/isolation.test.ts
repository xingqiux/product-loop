import { createRequire, registerHooks } from "node:module";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// 客户端运行时不加载后端的任何文件，见「01 架构」第三节。
// 做法照验证代码的 spikes/backend/scripts/rpc-guard.ts：模块钩子看每一次解析，解析到后端就报错。
// 客户端要用 Node 自己的加载器导入，因为 Vitest 会自己加载测试引用的文件，钩子看不到。
// createRequire 给出的 require 是 Node 自己的，ES 模块也能用它同步加载。

const packagesDir = new URL("../../", import.meta.url);
const clientDir = new URL("client/", packagesDir).href;
const modelDir = new URL("model/", packagesDir).href;
const backendDir = new URL("backend/", packagesDir).href;

/** 用 Node 自己的加载器导入。解析从客户端的源码目录出发。 */
const nativeRequire = createRequire(import.meta.url);
const nativeImport = async (specifier: string): Promise<unknown> => nativeRequire(specifier);

/** 一次解析：谁引的、写的什么、解析成哪个文件。 */
type Resolved = { readonly from: string; readonly specifier: string; readonly url: string };

/** 装上钩子导入 specifier，返回这期间的每一次解析。解析到后端时钩子抛错，导入随之失败。 */
async function importGuarded(specifier: string): Promise<Resolved[]> {
  const resolved: Resolved[] = [];
  const hooks = registerHooks({
    resolve(requested, context, nextResolve) {
      if (/^@product-loop\/backend(?:\/|$)/u.test(requested)) {
        throw new Error(`客户端在运行时引入了后端：${requested}`);
      }
      const result = nextResolve(requested, context);
      if (result.url.startsWith(backendDir)) {
        throw new Error(`客户端在运行时引入了后端的文件：${requested} -> ${result.url}`);
      }
      resolved.push({ from: context.parentURL ?? "", specifier: requested, url: result.url });
      return result;
    },
  });
  try {
    await nativeImport(specifier);
  } finally {
    hooks.deregister();
  }
  return resolved;
}

/** 写的是路径，不是包名。 */
function isPath(specifier: string): boolean {
  return /^(?:\.|\/|file:)/u.test(specifier);
}

/** 文件所在的 npm 包，取最后一个 node_modules 后面的包名。 */
function packageOf(url: string): string | undefined {
  const rest = url.split("/node_modules/").at(-1);
  if (rest === undefined || rest === url) return undefined;
  const [scope, name] = rest.split("/");
  return scope?.startsWith("@") ? `${scope}/${name}` : scope;
}

describe("客户端运行时不加载后端", () => {
  it("导入客户端时，没有一次解析落到后端", async () => {
    const resolved = await importGuarded(fileURLToPath(new URL("./index.ts", import.meta.url)));
    // 客户端的源码里，运行时引的包只有共用定义和 hono/client。import type 在运行时已经去掉。
    const fromClient = resolved
      .filter(({ from, specifier }) => from.startsWith(clientDir) && !isPath(specifier))
      .map(({ specifier }) => specifier);
    expect([...new Set(fromClient)].sort()).toEqual(["@product-loop/model", "hono/client"]);
    // 加载的文件只来自客户端、共用定义和两个 npm 包，没有 Node 自带的模块。
    const places = resolved.map(({ url }) => {
      if (url.startsWith(clientDir)) return "client";
      if (url.startsWith(modelDir)) return "model";
      return packageOf(url) ?? url;
    });
    expect([...new Set(places)].sort()).toEqual(["client", "hono", "model", "zod"]);
  });

  it("导入 Node 入口时，也没有一次解析落到后端", async () => {
    const entry = fileURLToPath(new URL("./node/index.ts", import.meta.url));
    const resolved = await importGuarded(entry);
    // 上一个测试已经加载过的文件，这次不再解析，所以只查有没有越界。
    // 运行时引的包只有共用定义、hono/client 和 Node 自带的模块。
    const fromClient = resolved
      .filter(({ from, specifier }) => from.startsWith(clientDir) && !isPath(specifier))
      .map(({ specifier }) => specifier);
    const allowed = ["@product-loop/model", "hono/client"];
    expect(fromClient.filter((x) => !x.startsWith("node:") && !allowed.includes(x))).toEqual([]);
    expect(fromClient).toContain("node:child_process");
    const places = resolved
      .filter(({ url }) => !url.startsWith("node:"))
      .map(({ url }) => {
        if (url.startsWith(clientDir)) return "client";
        if (url.startsWith(modelDir)) return "model";
        return packageOf(url) ?? url;
      });
    expect(places.filter((x) => !["client", "hono", "model", "zod"].includes(x))).toEqual([]);
  });

  it("对照：真的加载后端时，钩子会报错", async () => {
    const entry = fileURLToPath(new URL("backend/src/index.ts", packagesDir));
    await expect(importGuarded(entry)).rejects.toThrow("客户端在运行时引入了后端的文件");
    await expect(importGuarded("@product-loop/backend")).rejects.toThrow(
      "客户端在运行时引入了后端：@product-loop/backend",
    );
  });
});
