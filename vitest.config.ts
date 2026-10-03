import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // 每个包是一个测试项目。skill/、spikes/、tools/legacy/、design/ 不在其中。
    // 要起子进程的测试文件名以 .use.test.ts 结尾，由 pnpm use 按 vitest.use.config.ts 跑。
    // pnpm test 用 --exclude 排除它们，只跑前三层，见「10 工程规范与流程」第五节。
    projects: ["packages/*"],
  },
});
