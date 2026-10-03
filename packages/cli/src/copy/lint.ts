import { copy } from "@product-loop/model";

// ploop lint text|reply 的文案，见「04 命令行」第九节和第十一节。
// 暂时放在命令行里，以后并进共用定义的文案表。

export const lintCopy = {
  help: {
    description: copy("写作校验；会话回复发出前的自查"),
    file: copy("要查的文件；不写就读标准输入"),
    fileDetails: {
      stdin: copy("不写文件就读标准输入，要用管道或重定向传入。"),
      tty: copy("直接在终端里运行会报用法错误。"),
      idle: copy("管道 5 秒内没有内容也报错。"),
    },
    text: {
      description: copy("按写作规范查一段文字"),
      details: {
        project: copy("在项目里运行时，另用主线写作规范一节的停用说法和例外。"),
      },
      blocks: {
        writing: { situation: copy("文字有写作校验的拦截"), fix: copy("按报错改写，再查一次") },
      },
      reads: copy("文件或标准输入，集中存储的主线"),
      writes: copy("不写"),
      examples: {
        file: copy("ploop lint text 说明.md"),
        stdin: copy("pbpaste | ploop lint text"),
      },
      after: copy("没有拦截就可以用这段文字"),
    },
    reply: {
      description: copy("会话回复发出前的自查"),
      details: {
        first: copy("首行以当前的阶段开头。"),
        name: copy("不写文件名，链接放在最后。"),
      },
      blocks: {
        round: {
          situation: copy("首行不以当前的阶段开头"),
          fix: copy("首行写成「第 2 版的检查阶段：」加一句原因"),
        },
        writing: { situation: copy("回复有写作校验的拦截"), fix: copy("按报错改写，再查一次") },
      },
      reads: copy("文件或标准输入，集中存储的阶段和主线"),
      writes: copy("不写"),
      examples: { stdin: copy("ploop lint reply < 回复.txt") },
      after: copy("没有拦截就发出这份回复"),
    },
  },
  output: {
    passed: copy("查过了：没有拦截"),
    passedWithWarnings: copy("查过了：没有拦截，警告 {count} 条", { count: 2 }),
    blocked: copy("查过了：拦截 {count} 条", { count: 2 }),
  },
  errors: {
    fileMissing: {
      message: copy("{file} 读不出来：{reason}。", { file: "说明.md", reason: "文件不存在" }),
      hint: copy("写对文件的路径，或者不写文件，从标准输入读。"),
    },
    /** 没写文件，标准输入又是终端：没有东西可查，也不会有人来输入，马上报错。 */
    noInput: {
      message: copy("没有要查的文字：没写文件，标准输入也是终端。"),
      hint: copy("写文件的路径，或用管道传入，例如 pbpaste | ploop lint text。"),
    },
    /** 从标准输入读到的是空的，或者管道开着但 5 秒内没有传来任何内容。 */
    emptyInput: {
      message: copy("没有要查的文字：标准输入是空的，或者 5 秒内没有传来内容。"),
      hint: copy("写文件的路径，或用管道传入，例如 pbpaste | ploop lint text。"),
    },
  },
};
