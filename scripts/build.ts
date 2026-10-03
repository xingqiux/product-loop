// 构建运行目录：node scripts/build.ts [输出目录]，见第一期计划第 15 步和「02 技术选型」第十五节。
// 先定构建号：命令行的版本、提交短号和构建时间，见约定 0001 第 22 条。
// 再用 tsdown 依次打后端和命令行，放进同一个目录。目录里有 ploop.mjs、backend.mjs、
// 原生文件、drizzle/ 和旧模板，复制到没有 node_modules 的地方也能运行。
// 工作台由 Vite 打成静态文件，放进 web/，连同字体，见第二期计划第 6 步。
// 最后写 build.json，记下构建号，ploop setup 按它的版本放进 app/<版本>/。
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const outDir = resolve(process.argv[2] ?? join(root, "dist", "app"));

const version = (
  JSON.parse(readFileSync(join(root, "packages", "cli", "package.json"), "utf8")) as {
    version: string;
  }
).version;
let commit = "unknown";
try {
  commit = execFileSync("git", ["-C", root, "rev-parse", "--short", "HEAD"], {
    encoding: "utf8",
  }).trim();
} catch {
  // 不在 git 仓库里时写 unknown。
}
const builtAt = new Date().toISOString().replace(/[-:]|\.\d{3}/gu, "");
const build = `${version}+${commit}.${builtAt}`;

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
const env = { ...process.env, PLOOP_BUILD: build, PLOOP_APP_DIR: outDir };
for (const name of ["backend", "cli"]) {
  const dir = join(root, "packages", name);
  execFileSync(join(dir, "node_modules", ".bin", "tsdown"), [], {
    cwd: dir,
    env,
    stdio: ["ignore", "ignore", "inherit"],
  });
}
// 从 vitest 里跑时环境里是 NODE_ENV=test，Vite 会把它当成开发构建，开发才有的页面（如 /proof）就打进去了。
// 这里一律按生产构建。
execFileSync(join(root, "packages", "web", "node_modules", ".bin", "vite"), ["build"], {
  cwd: join(root, "packages", "web"),
  env: { ...env, NODE_ENV: "production", PLOOP_WEB_OUT: join(outDir, "web") },
  stdio: ["ignore", "ignore", "inherit"],
});
writeFileSync(
  join(outDir, "build.json"),
  `${JSON.stringify({ build, version, commit, builtAt }, null, 2)}\n`,
);
process.stdout.write(`${outDir}\n${build}\n`);
