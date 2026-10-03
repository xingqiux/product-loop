import { copy } from "@product-loop/model";

// ploop setup 的文案，见「02 技术选型」第十五节。
// 暂时放在命令行里，以后并进共用定义的文案表。

const version = "0.0.1";
const home = "/Users/me/.product-loop";

export const setupCopy = {
  help: {
    description: copy("安装或升级命令行"),
    details: {
      copy: copy("把打包的运行目录复制到 app/<版本>/。"),
      current: copy("app/current 指向它。"),
      launcher: copy("写好 ~/.local/bin/ploop。"),
      old: copy("请旧后端退出，下一条命令拉起新的。"),
    },
    version: copy("切回已经装过的这份安装，写它的版本号，不复制"),
    blocks: {
      notBundle: {
        situation: copy("不是从打包的产物运行"),
        fix: copy("在代码仓库里运行 pnpm ploop:setup"),
      },
      missing: { situation: copy("--version 写的安装版本没装过"), fix: copy("写列出的版本之一") },
    },
    reads: copy("打包的运行目录和它的 build.json"),
    writes: copy("app/<版本>/、app/current 和 ~/.local/bin/ploop"),
    examples: { plain: copy("pnpm ploop:setup"), back: copy(`ploop setup --version ${version}`) },
    after: copy("ploop status"),
  },
  output: {
    installed: copy("装好了：{version}（构建号 {build}）", {
      version,
      build: "0.0.1+3f2a9c1.20260928T080500Z",
    }),
    switched: copy("切换到了：{version}（构建号 {build}）", {
      version,
      build: "0.0.1+3f2a9c1.20260928T080500Z",
    }),
    place: copy("位置：{dir}", { dir: `${home}/app/${version}/` }),
    launcher: copy("命令：{file}，Node 是 {node}", {
      file: "/Users/me/.local/bin/ploop",
      node: "/Users/me/.nvm/versions/node/v24.12.0/bin/node",
    }),
    stopped: copy("请旧后端退出了：进程 {pid}", { pid: 4312 }),
    notRunning: copy("后端没有在运行，下一条命令会拉起新的"),
  },
  errors: {
    notBundle: {
      message: copy("{dir} 里没有 build.json，不是打包的运行目录。", {
        dir: "/Users/me/proj/product-loop/packages/cli/src",
      }),
      hint: copy("在代码仓库里运行 pnpm ploop:setup，它先打包再安装。"),
    },
    missing: {
      message: copy("没有装过 {version}。装过的有：{installed}。", {
        version: "1.0.0",
        installed: version,
      }),
      hint: copy("写装过的版本之一，或者在代码仓库里运行 pnpm ploop:setup 装新的。"),
    },
    pathMissing: {
      message: copy("{dir} 不在 PATH 里，终端里敲 ploop 找不到命令。", {
        dir: "/Users/me/.local/bin",
      }),
      hint: copy('在登录配置里把它加进 PATH，例如 export PATH="$HOME/.local/bin:$PATH"。'),
    },
  },
};
