import { defineConfig } from "vitest/config";

// pnpm use 跑的测试：要起子进程的测试一律归到这里，文件名以 .use.test.ts 结尾。
// 命令行测试和使用代码这两层属于这一组，pnpm check 不跑，见第一期计划的通用完成标准
// 和「10 工程规范与流程」第五节。pnpm test 用 --exclude 把这些文件排除在外。
export default defineConfig({
  test: {
    include: ["packages/*/src/**/*.use.test.ts"],
    // 先打好运行目录，命令行的测试对着产物跑，见 scripts/use-setup.ts。
    globalSetup: ["scripts/use-setup.ts"],
  },
});
