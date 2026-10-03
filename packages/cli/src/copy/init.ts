import { copy } from "@product-loop/model";

// ploop init 的文案：帮助、输出和报错，见「04 命令行」第二节和约定 0001 第 11 条。
// 暂时放在命令行里，以后并进共用定义的文案表。

const root = "/Users/me/proj/app";

export const initCopy = {
  help: {
    description: copy("在当前项目开工"),
    details: {
      register: copy("登记项目，建项目缓存。"),
      ignore: copy("按仓库是谁的写忽略规则。"),
      own: copy("自己的仓库写进 .gitignore。"),
      shared: copy("共用的仓库写进 .git/info/exclude。"),
      hook: copy("写「是」写入会话开始的钩子，写「否」撤掉。"),
      hookOnly: copy("撤掉时只删 ploop 写的那一条。"),
      hookAsk: copy("不写 --hook，第一次开工在终端里会问。"),
      hookNoTerminal: copy("不在终端里就不写，以后重跑不再问。"),
      hookPath: copy("写入的是 ploop 的绝对路径。"),
      hookRerun: copy("路径变了，要重跑 ploop init --hook 是。"),
    },
    repo: copy("仓库归谁，第一次必填"),
    hook: copy("会话开始的钩子：是=写入，否=撤掉"),
    blocks: {
      noRepo: {
        situation: copy("第一次开工没写 --repo"),
        fix: copy("问用户仓库是自己的还是共用的，带上 --repo 重跑"),
      },
      sharedWithoutGit: {
        situation: copy("共用的仓库不在 git 里"),
        fix: copy("改写 --repo 自己的"),
      },
      unregistered: {
        situation: copy("项目缓存还在，集中存储里没有登记这个目录"),
        fix: copy("不用写 --repo，按缓存里的忽略规则重新登记，主线.md 和各阶段的文件保留"),
      },
      home: { situation: copy("在家目录下运行"), fix: copy("到项目的根目录下运行") },
      oldLayout: { situation: copy("这里有旧 skill 的文件"), fix: copy("先运行 ploop doctor") },
    },
    reads: copy("项目缓存的 project.json"),
    writes: copy(
      "集中存储的项目和主线。项目缓存的 project.json、README.md、主线.md。忽略规则文件。用户同意时，另写 .claude/settings.local.json。",
    ),
    examples: {
      own: copy("ploop init --repo 自己的"),
      shared: copy("ploop init --repo 共用的"),
      hook: copy("ploop init --hook 是"),
      noHook: copy("ploop init --hook 否"),
    },
    after: copy("ploop round start 构思"),
  },
  /** 文字输出的各行。 */
  output: {
    created: copy("开工了：项目 {project}，第 {version} 版", { project: "app", version: 1 }),
    again: copy("已经开工过：项目 {project}", { project: "app" }),
    /** 项目缓存还在，集中存储里没有登记这个目录，按缓存重新登记了。 */
    registeredAgain: copy("重新登记了：项目 {project}，项目缓存原样保留", { project: "app" }),
    /** 重新登记以后集中存储里是空的，说明什么还在、什么没有了。 */
    registeredAgainNote: copy("集中存储里的队列、决定、回复和阶段记录没有了，项目缓存还在。"),
    mainlineRestored: copy("主线：项目缓存里的主线.md 已经交成第 1 版"),
    /** 项目缓存记着的项目名和集中存储里这个目录登记的不同，改成登记的那个。 */
    idRewritten: copy("项目缓存里的 {from} 改成了 {to}，这个目录登记给了它。", {
      from: "app-old",
      to: "app",
    }),
    root: copy("根目录：{root}", { root }),
    cache: copy("项目缓存：{dir}", { dir: `${root}/.product-loop/` }),
    ruleAdded: copy("仓库：{repo}，忽略规则写进了 {file}", {
      repo: "自己的",
      file: `${root}/.gitignore`,
    }),
    ruleKept: copy("仓库：{repo}，{file} 里已有忽略规则", {
      repo: "共用的",
      file: `${root}/.git/info/exclude`,
    }),
    /** 自己的仓库里 .gitignore 还没提交：落地阶段收尾要求没有没提交的文件。 */
    ignoreUncommitted: copy("提醒：{file} 还没有提交。落地阶段收尾前要先提交它，不然会被拦住。", {
      file: ".gitignore",
    }),
    repoChanged: copy("仓库由{from}改成了{to}", { from: "自己的", to: "共用的" }),
    mainlineTemplate: copy("主线：写好了模板 {file}，只有标题。", {
      file: ".product-loop/主线.md",
    }),
    /** 会话开始的钩子写好了。 */
    hookWritten: copy("会话开始钩子：写进了 {file}。以后每次会话开始运行 ploop prime。", {
      file: ".claude/settings.local.json",
    }),
    /** 设置文件只在本机用，忽略规则写进了同一个忽略文件，落地收尾才不会被它拦住。 */
    settingsRuleAdded: copy("会话开始钩子的设置文件 {file} 不进仓库，忽略规则写进了 {ignore}。", {
      file: ".claude/settings.local.json",
      ignore: ".gitignore",
    }),
    hookPresent: copy("会话开始钩子：{file} 里已有。", { file: ".claude/settings.local.json" }),
    /** 早先写的是 ploop prime，靠 PATH 找命令，重跑 --hook 是 时换成绝对路径。 */
    hookUpdated: copy("会话开始钩子：换成了绝对路径的命令。"),
    /** --hook 否：撤掉了 ploop 写的那一条。 */
    hookRemoved: copy("会话开始钩子：从 {file} 里删掉了。别的设置原样保留。", {
      file: ".claude/settings.local.json",
    }),
    /** 设置里有运行 ploop prime 的钩子，但不是 ploop init 写的样子。 */
    hookForeign: copy("会话开始钩子：设置里有一条别人写的。没有删，要删请自己改 {file}。", {
      file: ".claude/settings.local.json",
    }),
    /** 重跑时写了 --hook 否，可是没有 ploop 写的钩子。 */
    hookNothing: copy("会话开始钩子：不写，{file} 里也没有。", {
      file: ".claude/settings.local.json",
    }),
    /** 不在终端里又没写 --hook：不替用户答应，请 AI 去问。 */
    hookUndecided: copy(
      "会话开始钩子：没写。请先问用户，要不要在会话开始时自动运行 ploop prime。同意就运行 {command}。",
      { command: "ploop init --hook 是" },
    ),
    /** 重跑时的下一步。 */
    status: copy("ploop status"),
  },
  /** 项目缓存里的 README.md，见「03 数据模型」第五节。 */
  readme: copy(
    [
      "# 产品循环的项目缓存",
      "",
      "这个文件夹由 ploop 生成，放这个项目最近的、临时的东西。",
      "数据以集中存储为准，这里只是工作副本和暂存区。",
      "",
      "- project.json 记着对应的项目，只由命令写，不要手改。",
      "- 主线.md 是主线的工作副本，AI 在这里编辑。",
      "- 其余的文件由命令生成和清理。",
      "",
    ].join("\n"),
  ),
  /** 设置文件合不进去的原因，接在文件名后面。 */
  hookReasons: {
    notJson: copy("不是合法的 JSON"),
    notObject: copy("最外层不是对象"),
    hooksNotObject: copy("里的 hooks 不是对象"),
    sessionStartNotArray: copy("里的 hooks.SessionStart 不是数组"),
  },
  /** 在终端里问用户的话。 */
  prompt: {
    hook: copy("要不要在每次会话开始时，让 Claude Code 运行 ploop prime？会写进 {file}。（y/N）", {
      file: ".claude/settings.local.json",
    }),
  },
  errors: {
    /** 设置文件合不进去时的警告，不影响开工。 */
    hookUnusable: {
      message: copy("设置文件{reason}，没有写会话开始钩子。", { reason: "不是合法的 JSON" }),
      hint: copy("改好这个文件以后运行 ploop init --hook 是，或者自己把钩子加进去。"),
    },
    /** 第一次开工没写 --repo。AI 不能替用户答，所以打印要问的话和两条完整的命令。 */
    askRepo: {
      message: copy("第一次开工要写 --repo。请先问用户：这个仓库是自己的，还是和别人共用的？"),
      hint: copy("用户说自己的，运行 {own}。说共用的，运行 {shared}。", {
        own: "ploop init --repo 自己的",
        shared: "ploop init --repo 共用的",
      }),
    },
    /** --project 写的是项目名。开工要知道目录，所以只收路径。 */
    byId: {
      message: copy("ploop init 的 --project 要写路径，「{value}」是项目名。", {
        value: "sketch-board",
      }),
      hint: copy("到项目根目录下运行，或者写 --project ./app 这样的路径。"),
    },
    /** 共用的仓库要写 .git/info/exclude，这里却不在 git 仓库里。 */
    notGit: {
      message: copy("当前目录不在 git 仓库里，找不到 .git/info/exclude。"),
      hint: copy("不用 git 时改写 --repo 自己的，忽略规则写进 .gitignore。"),
    },
    /** 登记过的项目还在迁移，project.json 要等迁移完成才写。 */
    migrating: {
      message: copy("项目 {project} 的迁移还没完成，不能开工。", { project: "app" }),
      hint: copy("运行 ploop doctor，按报告做完迁移。"),
    },
  },
};
