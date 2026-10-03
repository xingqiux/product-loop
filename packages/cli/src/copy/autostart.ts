import { copy } from "@product-loop/model";

// ploop backend autostart on|off|status 的文案，见「01 架构」第六节和决定 167、198。
// 暂时放在命令行里，以后并进共用定义的文案表。

const home = "/Users/me/.product-loop";
const file = "/Users/me/Library/LaunchAgents/com.product-loop.backend.plist";

export const autostartCopy = {
  help: {
    description: copy("登录时自动启动后端"),
    details: {
      what: copy("装上、卸掉或查看 launchd 登录启动项。"),
      mac: copy("只支持 macOS。"),
    },
    on: {
      description: copy("装上登录启动项"),
      details: {
        what: copy("装上并加载，以后登录就启动后端。"),
        crash: copy("后端崩溃了会自动重启。"),
        file: copy("启动项文件是 ~/Library/LaunchAgents/ 下的 plist。"),
        hash: copy("PLOOP_HOME 不是默认位置时，文件名带哈希。"),
      },
      blocks: {
        notSetup: {
          situation: copy("还没有运行过 ploop setup"),
          fix: copy("在代码仓库里运行 pnpm ploop:setup，再装启动项"),
        },
        notMac: {
          situation: copy("不是 macOS"),
          fix: copy("在登录脚本里运行 ploop backend start"),
        },
      },
      writes: copy("启动项文件，并用 launchctl 加载"),
      after: copy("ploop backend autostart status"),
    },
    off: {
      description: copy("卸掉登录启动项"),
      details: {
        what: copy("卸载并删除启动项文件。"),
        exit: copy("由它拉起的后端会随之退出。"),
      },
      writes: copy("删除启动项文件，并用 launchctl 卸载"),
      after: copy("下一条命令会自动拉起后端"),
    },
    status: {
      description: copy("查看登录启动项"),
      details: { what: copy("写装没装、加载没加载、指向哪个入口。") },
    },
    reads: copy("启动项文件和 launchctl 的状态"),
    examples: {
      on: copy("ploop backend autostart on"),
      off: copy("ploop backend autostart off"),
      status: copy("ploop backend autostart status"),
    },
  },
  output: {
    installed: copy("装好了：登录时自动启动后端"),
    removed: copy("卸掉了：登录时自动启动后端"),
    notInstalledYet: copy("本来就没有装，什么都没做"),
    file: copy("启动项：{file}", { file }),
    fileRemoved: copy("已删除启动项：{file}", { file }),
    command: copy("运行：{node} {entry}", {
      node: "/usr/local/bin/node",
      entry: `${home}/app/current/backend.mjs`,
    }),
    crash: copy("崩溃了会自动重启。"),
    stopNote: copy("ploop backend stop 停下后，启动项不再拉起它。"),
    stopNext: copy("下一条命令仍会拉起它。"),
    stoppedWithAgent: copy("由启动项拉起的后端已随之退出，下一条命令会重新拉起它"),
    on: copy("登录时自动启动后端：已装"),
    off: copy("登录时自动启动后端：没装"),
    loaded: copy("已加载：是"),
    notLoaded: copy("已加载：否，下次登录时才会启动"),
  },
  errors: {
    notMac: {
      message: copy("登录启动项用的是 macOS 的 launchd，这个系统不支持。"),
      hint: copy("在登录脚本里运行 ploop backend start。"),
    },
    notSetup: {
      message: copy("找不到装好的后端：{entry}。", { entry: `${home}/app/current/backend.mjs` }),
      hint: copy("在代码仓库运行 pnpm ploop:setup，再装启动项。"),
    },
    loadFailed: {
      message: copy("launchctl 没能加载启动项：{detail}", { detail: "Bootstrap failed: 5" }),
      hint: copy("启动项文件已写好，下次登录会加载。查原因运行 ploop backend logs。"),
    },
  },
};
