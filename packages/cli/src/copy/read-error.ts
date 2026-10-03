import { copy } from "@product-loop/model";

// 读文件、运行程序失败的原因，写成给人看的一句话，不把系统的错误码（ENOENT、EACCES）原样露出来。
// 各命令的报错把它放进「读不出来：{reason}」这样的位置，见 project/read-error.ts。
// 暂时放在命令行里，以后并进共用定义的文案表。

export const readErrorCopy = {
  /** 读文件的原因。 */
  file: {
    missing: copy("文件不存在"),
    denied: copy("没有读它的权限"),
    directory: copy("这是一个文件夹，不是文件"),
    notDirectory: copy("路径里有一段不是文件夹"),
    other: copy("{detail}", { detail: "read failed" }),
  },
  /** 运行程序的原因：命令写在 -- 后面，找不到程序或不能执行。 */
  program: {
    missing: copy("找不到这个程序，确认名字写对了、已经装好"),
    denied: copy("没有运行它的权限"),
    other: copy("{detail}", { detail: "spawn failed" }),
  },
};
