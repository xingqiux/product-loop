// 后端读的环境变量，集中存储的位置由 store/home.ts 的 resolveHome 取。
// PLOOP_PORT 改后端的端口，和 PLOOP_HOME 一样主要给开发和测试用，见「04 命令行」第一节。
// 它的写法命令行也要认，所以放在共用定义里，见 model 的 process.ts 的 envPort。
// PLOOP_TIME_MACHINE=off 关掉每天的 Time Machine 检查，测试用它，不运行真的 tmutil。

type Env = Readonly<Record<string, string | undefined>>;

/** 每天检查 Time Machine。只有 PLOOP_TIME_MACHINE 写 off 时不查。 */
export function timeMachineEnabled(env: Env): boolean {
  return env.PLOOP_TIME_MACHINE !== "off";
}
