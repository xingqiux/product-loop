import { createApp } from "./http/app.ts";

// 后端给客户端的只有类型，见「01 架构」第三节。客户端只用 import type 引入，运行时不加载后端。
// pnpm typecheck 先用 tsconfig.types.json 从这个文件生成 dist/types/index.d.ts，再做类型检查。
// 下面的函数不会运行，只用来推出接口的类型。推出来的类型整个写进 d.ts。
// 所以 d.ts 只引用 Hono 的类型，不引用 AppDeps 背后的数据库和 Node 的类型。
// 浏览器的类型检查配置也能用它。

const typed = () => createApp(undefined as never);

/** 接口的类型，类型化客户端 hc<AppType> 用它，见「02 技术选型」第六节。 */
export type AppType = ReturnType<typeof typed>;
