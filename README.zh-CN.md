# 产品循环

[English → README.md](README.md)

这个仓库把产品循环做成软件：命令行 `ploop`、常驻在本机的后端，以及网页上的工作台。全部用 TypeScript。设计方案（文中的「01 架构」「06 工作台」等）不在这个仓库里。本文和它不一致时，以设计方案为准；命令的参数和帮助除外，以 `docs/命令参考.md` 为准，它由命令自己的帮助生成。

现在做完了第一期（命令行和后端）、第二期（工作台）和第三期（跨项目的部分），见 `docs/第一期计划.md`、`docs/第二期计划.md` 和 `docs/第三期计划.md`。第四期（MCP）不做（决定 201）。

命令行 `ploop` 怎么用，见第七节。怎么装命令和 skill，见第八节。

## 一、目录

```
product-loop/
  package.json            工作区的根，只放脚本和共用的开发依赖
  pnpm-workspace.yaml     工作区和依赖版本目录
  tsconfig.base.json      各包共用的 TypeScript 设置
  tsconfig.json           根目录下配置文件的类型检查
  biome.json              格式和代码检查
  knip.json               查没用到的文件、导出和依赖
  vitest.config.ts        测试，每个包是一个测试项目
  packages/
    model/                共用定义：数据定义、校验规则、写作校验、名称表。浏览器和 Node 都能用
    backend/              后端：执行全部业务规则，独占集中存储
    client/               接口的类型化客户端；另有一个只给 Node 用的入口，负责拉起后端
    cli/                  命令行 ploop
    web/                  工作台（React）
  scripts/
    build.ts              把后端、命令行和工作台打进运行目录
    use/                  这个软件自己的使用代码，场景清单在 design/主线.md
    perf/                 一个阶段的页面打开要多久
  docs/                   工程文档：分期计划、维护说明、命令参考、约定
  docs/依据/              写 skill 时的依据：各阶段方法的出处，只在维护时读
  skill/                  skill 的正文，流程由 ploop 执行
  spikes/                 开工前验证关键库的代码
  tools/legacy/           一次性的迁移和对照工具
  design/                 这个软件自己的主线，以及工作台外观的试验稿
```

各包内部的目录按「01 架构」第三节和「06 工作台」第九节建。
`.product-loop/` 是这个软件自己跑产品循环的项目缓存，不进版本库。

## 二、包之间的依赖

依赖只能朝一个方向：

- `model` 不依赖任何别的包。
- `backend` 和 `client` 只依赖 `model`。
- `cli` 和 `web` 依赖 `client` 和 `model`，不能依赖 `backend`。
- `backend` 内部，`core` 不引用 `http`。

前三条由各包 `package.json` 里声明的依赖保证。没声明的包引用时解析不到，类型检查会报错。最后一条由 Biome 的 `noRestrictedImports` 检查，写在 `biome.json` 的 `overrides` 里。

`model` 和 `client` 的 `exports` 直接指向 `src/index.ts`，不用先构建。类型检查、测试和 Node 都直接读源码。

`backend` 只给别的包类型，`exports` 指向 `dist/types/index.d.ts`。这份类型声明由 `pnpm types` 生成，不进版本库。`pnpm typecheck` 先生成它，再做类型检查，见「01 架构」第三节。

## 三、环境

- Node 24.12 以上，写在根目录 `package.json` 的 `engines` 里。版本不够时 `pnpm install` 直接失败。
- pnpm 11，版本写死在根目录 `package.json` 的 `packageManager` 字段里，现在是 11.27.1。在仓库里运行 `pnpm` 时，Corepack 或 pnpm 自己会按这个字段换成 11.27.1，不用另装。运行 `pnpm -v` 可以确认。

## 四、命令

| 命令 | 做什么 |
| --- | --- |
| `pnpm install` | 安装依赖 |
| `pnpm check` | 依次跑 Biome、类型检查、knip 和测试，一项失败就停下。提交前跑 |
| `pnpm lint` | 用 Biome 检查格式和代码 |
| `pnpm fix` | 用 Biome 改好格式、排好导入，并修掉能自动修的问题 |
| `pnpm types` | 生成后端的类型声明，放在 `packages/backend/dist/types/` |
| `pnpm typecheck` | 先生成后端的类型声明，再用 `tsc --noEmit` 检查根目录的配置文件，最后逐个检查五个包 |
| `pnpm knip` | 查没用到的文件、导出和依赖 |
| `pnpm test` | 用 Vitest 跑全部包的测试，不含要起子进程和浏览器的 `*.use.test.ts` |
| `pnpm use` | 先打出运行目录，再跑 `*.use.test.ts`，其中包括这个软件自己的使用代码 |
| `pnpm build` | 把后端、命令行和工作台打进 `dist/app/` |
| `pnpm ploop:setup` | 打包以后把这一版装到本机，步骤见第八节，版本规则见「08 版本与迁移」 |
| `pnpm perf` | 量一个阶段的页面打开要多久，超过一秒退出码 1 |

`pnpm use` 和 `pnpm perf` 的细节见 `docs/维护说明.md` 第三节。「10 工程规范与流程」里的 `pnpm release`，等有了发布脚本再加。

## 五、检查不管的目录

`skill/`、`spikes/`、`tools/legacy/`、`design/` 不在检查范围里。`skill/` 是 skill 的正文，不是代码；其余三个目录另有用途。各工具排除的办法如下：

| 工具 | 怎么排除 |
| --- | --- |
| Biome | `biome.json` 的 `files.includes` 用 `!!` 排除这四个目录 |
| TypeScript | 各包只包含自己的 `src/`，根目录只包含根目录下的 `.ts` 文件 |
| knip | `knip.json` 里根工作区的 `project` 和 `vitest.entry` 排除这四个目录 |
| Vitest | 只把 `packages/*` 当作测试项目 |

## 六、约定

- 代码里的标识符，包括文件名和目录名，一律用英文，只用 ASCII 字符。用户和 AI 看到的文字用中文。Biome 的 `useNamingConvention` 和 `useFilenamingConvention` 检查这一条。
- 不用枚举、命名空间和构造参数属性，因为 Node 的类型剥离不支持。TypeScript 的 `erasableSyntaxOnly` 检查这一条。
- 相对路径的引用写完整的扩展名，例如 `./index.ts`。
- 依赖的版本只写在 `pnpm-workspace.yaml` 的依赖版本目录里，各包写 `catalog:`。
- 格式：两个空格缩进，双引号，行宽 100。
- 提交说明的类型和范围用英文，描述用中文，例如 `feat(cli): ploop reply wait 在用户提交后退出`。范围是包名。
- 全仓库一个版本号，现在是 `0.0.1`，见「08 版本与迁移」第三节。

## 七、用命令行 ploop

`ploop` 是这个软件的命令行，AI 和人都用它。
在项目的根目录运行 `ploop init --repo 自己的` 开工，共用的仓库写 `--repo 共用的`。
以后随时运行 `ploop`，它等同 `ploop status`：写出现在在第几版的哪个阶段、哪一页在等用户、队列里还剩什么。
末尾的「下一步」是现在就能敲的命令。

`ploop --help` 把命令分成四组：

- 日常命令，每个阶段都会用：`init`、`status`、`round`、`page`、`reply`、`queue`、`mainline`、`land`、`use`。
- 按需命令，用到时才用：`prime`、`open`、`decision`、`lint`、`skill`、`version`。
- 维护命令，安装、查看、备份和导出：`backend`、`backup`、`export`、`storage`、`setup`，另有 `skill issues`，只有维护 skill 的人用。
- 过渡命令，只服务旧 skill 的迁移和退回，2026-12-31 删除：`doctor`、`reply ingest`、`use ingest`。另有两种过渡用法：`export --legacy`，和 `round show` 认迁移前的文件名。

怎么装命令行和 skill，见第八节。

每条命令的帮助，和一张写着命令、作用、分组的命令一览表，在 `docs/命令参考.md`。这份文件由程序生成，不要手改，改了命令以后运行 `pnpm --filter @product-loop/cli commands-doc` 重新生成。

## 八、怎么装

要装两样东西：命令 `ploop`，和 skill。命令执行流程，skill 教 AI 在什么时候敲哪条命令。
两样共用一个版本号。给别人用时，对方复制 skill 目录，自己装命令。

前提：

- 目前只在 macOS 上用过。Time Machine 检查和登录启动项只有 macOS 上有。
- Node 24.12 以上，版本不够时 `pnpm install` 直接失败。
- pnpm 不用另装，见第三节。
- 装了 Claude Code。

### 第一步：拿到仓库

拿到这个仓库的一份副本（`git clone`），放在固定的位置，例如 `~/proj/product-loop`。以后升级、重装都在这里做。
命令行报错里写「运行 pnpm ploop:setup」，都是指在这个仓库的根目录运行。

### 第二步：装命令

在仓库根目录运行：

```
pnpm install
pnpm ploop:setup
```

`pnpm ploop:setup` 先打包，再把这一版装到 `~/.product-loop/app/<版本>/`，在 `~/.local/bin/ploop` 写好命令。
`~/.local/bin` 不在 PATH 里时，命令会写一条警告。照它说的，把 `export PATH="$HOME/.local/bin:$PATH"` 加进登录配置。
新开一个终端，运行 `ploop --version`。写出版本号和构建号，就装好了。

### 第三步：装 skill

在仓库根目录运行：

```
mkdir -p ~/.claude/skills/product-loop
cp -R skill/. ~/.claude/skills/product-loop/
```

Claude Code 从 `~/.claude/skills/` 读个人 skill，目录名要和 `SKILL.md` 里的名字 `product-loop` 一致。
新开一个 Claude Code 会话，技能列表里有 `product-loop`，就装好了。

### 第四步：第一次开工

在要用产品循环的项目根目录，开一个 Claude Code 会话，说「用产品循环」。AI 会先问仓库是自己的还是共用的，再敲命令。
也可以自己敲：

```
ploop init --repo 自己的
ploop
```

共用的仓库写 `--repo 共用的`。
`ploop init` 建好项目缓存 `.product-loop/`，写好忽略规则。在终端里敲时，它还会问要不要装会话开始的钩子，同意就写 `--hook 是`。
`ploop` 写出现在在第几版的哪个阶段。末尾的「下一步」是 `ploop round start 构思`，由 AI 敲。
`ploop open` 在浏览器里打开工作台，第一次会拉起后端，不用自己开。

### 升级

在仓库里更新代码，再运行：

```
pnpm install
pnpm ploop:setup
cp -R skill/. ~/.claude/skills/product-loop/
```

数据在 `~/.product-loop/`，不会因为升级丢失。这一版改了数据库结构时，升级前会留一份快照，运行 `ploop backup list` 能看到。
新版装出问题时，运行 `ploop setup --version <旧版本号>`，切回装过的版本。
项目停在旧版本的 skill 时，命令会提示先运行 `ploop doctor`，见「08 版本与迁移」。

### 装好以后

- 命令找不到：检查 `~/.local/bin` 在不在 PATH 里，再新开一个终端。
- 后端由命令自己拉起，不用手动开。想登录时自动启动，运行 `ploop backend autostart on`。
- 数据坏了：运行 `ploop backup list` 看快照，再用 `ploop backup restore <快照>` 恢复。
- 第一次安装、升级和恢复的场景，见 `design/主线.md` 的 S26、S28 和 S30。

## 九、公开版说明

- 这个公开仓库从一份干净的快照开始，不带之前的提交历史。
- 对照数据和测试里来自非公开项目的内容已经删去，其余的项目名换成了别的词，见 `tools/legacy/README.md` 开头的说明。
- 界面、命令输出、skill 和文档都是中文。英文介绍见 `README.md`。
