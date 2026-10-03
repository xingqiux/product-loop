// pnpm use 的全局准备，见第一期计划第 15 步：命令行的测试对着打包的产物跑。
// 先用 scripts/build.ts 打一份运行目录放进临时目录，经环境变量 PLOOP_TEST_APP 交给测试。
// 测试的沙盒据此运行 ploop.mjs，命令行再拉起旁边的 backend.mjs。全部测试跑完删掉。
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export default function setup(): () => void {
  const dir = mkdtempSync(join(tmpdir(), "ploop-app-"));
  const script = fileURLToPath(new URL("./build.ts", import.meta.url));
  execFileSync(process.execPath, [script, dir], { stdio: ["ignore", "ignore", "inherit"] });
  process.env.PLOOP_TEST_APP = dir;
  return () => rmSync(dir, { recursive: true, force: true });
}
