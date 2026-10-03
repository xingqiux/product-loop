import type { ErrorCode, ExitName } from "../errors.ts";
import type { IdError, parseQueueIdList } from "../ids.ts";
import type { parseLegacyRoundId, RoundLabelError, RoundRefError } from "../round-label.ts";
import { type CopyEntry, copy } from "./define.ts";

// 报错的文案。报错写清什么不对、在哪里、怎么改，见「04 命令行」第六节：
// message 写什么不对，hint 写怎么改，在哪里由调用的地方写进 where。

/** 一条报错的文案。 */
export type ErrorCopy = { readonly message: CopyEntry; readonly hint: CopyEntry };

/**
 * 各错误码的默认说明，顺序和「05 接口」第九节相同。
 * 用例有更具体的说法时用自己的文案，这里的只在没有更具体的说法时用。
 */
export const errorCodeCopy = [
  {
    code: "RULE_BLOCKED",
    message: copy("数据或状态不合规矩，操作被拦截。"),
    hint: copy("按每条拦截的「怎么改」修改，再重跑这条命令。"),
  },
  {
    code: "BAD_REQUEST",
    message: copy("请求的格式不对。"),
    hint: copy("对照这条命令的 --help，检查参数和取值。"),
  },
  {
    code: "CONFLICT",
    message: copy("当前状态不允许这个操作，或者数据已被别处改过。"),
    hint: copy("运行 ploop status 查看当前状态，处理完冲突再重跑。"),
  },
  {
    code: "NOT_FOUND",
    message: copy("要找的对象不存在。"),
    hint: copy("检查编号和路径。"),
  },
  {
    code: "BUSY",
    message: copy("后端正在迁移或恢复数据，暂时不能写入。"),
    hint: copy("稍后重跑这条命令。"),
  },
  {
    code: "NEEDS_DOCTOR",
    message: copy("项目停在旧版本的 skill，要先做迁移检查。"),
    hint: copy("运行 ploop doctor。"),
  },
  {
    code: "PAGE_GONE",
    message: copy("在等的那一页已撤回，或已被新的一页代替。"),
    hint: copy("运行 ploop status 查看现在的状态。"),
  },
  {
    code: "CLIENT_TOO_OLD",
    message: copy("命令行的版本低于后端要求的最低版本。"),
    hint: copy("运行 ploop setup，让命令行和后端用同一个版本。"),
  },
  {
    code: "INTERNAL",
    message: copy("后端内部出错。"),
    hint: copy("出错的详情写在日志里：{logPath}。", {
      logPath: "~/.product-loop/logs/backend.log",
    }),
  },
] as const satisfies readonly (ErrorCopy & { readonly code: ErrorCode })[];

type ErrorCodeCopyRow = (typeof errorCodeCopy)[number];
export type ErrorCodeCopyOf<C extends ErrorCode> = Extract<ErrorCodeCopyRow, { readonly code: C }>;

const copyByCode: ReadonlyMap<ErrorCode, ErrorCodeCopyRow> = new Map(
  errorCodeCopy.map((row) => [row.code, row]),
);

/** 按错误码取默认说明。 */
export function errorCodeCopyOf<C extends ErrorCode>(code: C): ErrorCodeCopyOf<C> {
  // 每个错误码都有一条，测试逐个核对过，所以一定取得到。
  return copyByCode.get(code) as ErrorCodeCopyOf<C>;
}

/** 退出码的含义和 AI 通常怎么做。 */
export type ExitCodeCopy = { readonly meaning: CopyEntry; readonly action: CopyEntry };

/**
 * 「04 命令行」第七节的退出码表。和原表比有两处改动：去掉了命令两边的反引号；
 * 5 的做法去掉了「见「01 架构」第八节」，AI 看不到设计文档，要照做的步骤就在报错里。
 */
export const exitCodeCopy = {
  ok: { meaning: copy("成功"), action: copy("看「下一步」") },
  blocked: { meaning: copy("拦截：数据或状态不合规矩"), action: copy("按「怎么改」修改后重跑") },
  usage: { meaning: copy("用法错误：参数缺失或取值不对"), action: copy("看 --help") },
  conflict: {
    meaning: copy("冲突：状态不允许，例如另一页在等、别的会话改过主线"),
    action: copy("按报错里的命令先处理冲突"),
  },
  notFound: {
    meaning: copy("找不到：项目、阶段、事项、文件不存在"),
    action: copy("检查编号和路径"),
  },
  backendDown: { meaning: copy("后端连不上或起不来"), action: copy("按报错里的步骤排查") },
  needsDoctor: {
    meaning: copy("要先做迁移检查：项目停在旧版本的 skill"),
    action: copy("运行 ploop doctor"),
  },
  stillWaiting: {
    meaning: copy("还在等：到了时限，用户还没提交"),
    action: copy("再运行一次同样的命令"),
  },
  pageGone: {
    meaning: copy("等的那一页已撤回或已被新的一页代替"),
    action: copy("运行 ploop status"),
  },
  interrupted: { meaning: copy("被中断"), action: copy("无") },
} satisfies Record<ExitName, ExitCodeCopy>;

/**
 * 命令行连不上后端时报给 AI 的话，见「01 架构」第八节。这几种情况都以退出码 5 结束。
 * 后端没开时命令行自动拉起，成功就继续，不打印，所以那一行没有文案。
 */
export const backendCopy = {
  /** 拉起后八秒内没有就绪。 */
  startFailed: {
    message: copy("后端没有启动成功，拉起后八秒内没有就绪。日志的最后几行：\n{logTail}", {
      logTail: "SqliteError: database disk image is malformed",
    }),
    hint: copy("运行 ploop backend start --foreground，可以看到完整的报错。"),
  },
  /** 端口被别的程序占用。 */
  portTaken: {
    message: copy("端口 {port} 被别的程序占用，占用它的进程是 {owner}。", {
      port: 4731,
      owner: "python3，进程号 51234",
    }),
    hint: copy("用环境变量 PLOOP_PORT 换一个端口，再重跑这条命令。"),
  },
  /** 后端在迁移或恢复，重试满六十秒仍没有做完。 */
  busyTimeout: {
    message: copy("后端正在{task}，已持续 {seconds} 秒，等满六十秒仍未完成。", {
      task: "迁移数据结构",
      seconds: 95,
    }),
    hint: copy("等后端做完，再重跑这条命令。"),
  },
  /** 后端返回服务器错误。错误码和日志位置原样转述。 */
  serverError: {
    message: copy("后端返回了服务器错误，错误码是 {code}。", { code: "INTERNAL" }),
    hint: copy("日志在 {logPath}。运行 ploop doctor 检查一遍。", {
      logPath: "~/.product-loop/logs/backend.log",
    }),
  },
  /** 本机的 Node 版本不够。 */
  nodeTooOld: {
    message: copy("本机的 Node 版本是 {current}，低于需要的 {required}。", {
      current: "22.11.0",
      required: "24.12.0",
    }),
    hint: copy("运行 ploop setup，重新绑定 Node。"),
  },
} satisfies Record<string, ErrorCopy>;

type LegacyRoundIdError = Extract<ReturnType<typeof parseLegacyRoundId>, { ok: false }>["error"];
type QueueIdListError = keyof Extract<ReturnType<typeof parseQueueIdList>, { ok: false }>["error"];

/** 第 1 步各种解析失败的报错。键是解析函数返回的错误码。 */
export const parseCopy = {
  roundLabel: {
    shape: {
      message: copy("阶段「{text}」的写法不对。", { text: "第 2 版的落地" }),
      hint: copy(
        "写成「第 2 版的落地阶段」，同一版里第二次写成「第 2 版的落地阶段（第 2 次）」，数字前面不补 0。",
      ),
    },
    stage: {
      message: copy("阶段「{text}」里的阶段名不对。", { text: "第 2 版的落地中阶段" }),
      hint: copy("阶段名写构思、使用、检查、落地、提升之一，例如「第 2 版的落地阶段」。"),
    },
    renamedStage: {
      message: copy("阶段「{text}」用了改过名的阶段名「{old}」。", {
        text: "第 2 版的修复阶段",
        old: "修复",
      }),
      hint: copy("「{old}」现在叫「{now}」，按新名字写。", { old: "修复", now: "落地" }),
    },
    zero: {
      message: copy("阶段「{text}」里的版或次数写了 0。", { text: "第 0 版的构思阶段" }),
      hint: copy("版和次数都从 1 数，例如「第 1 版的构思阶段」。"),
    },
  } satisfies Record<RoundLabelError, ErrorCopy>,
  legacyRoundId: {
    shape: {
      message: copy("「{text}」不是迁移前的文件名。", { text: "gate-fix" }),
      hint: copy("迁移前的文件名是迁移前页面数据的文件名，例如 fix-13、land-15-plan。"),
    },
  } satisfies Record<LegacyRoundIdError, ErrorCopy>,
  /** 指一个阶段的参数，阶段的写法错了用 roundLabel 的文案，这里只有几种写法都不是的情况。 */
  roundRef: {
    unknown: {
      message: copy("「{text}」既不是阶段的写法，也不是迁移前的文件名。", { text: "落地第三次" }),
      hint: copy("阶段写成「第 2 版的落地阶段」，迁移前的文件名写成 fix-13 这样。"),
    },
  } satisfies Record<Exclude<RoundRefError, RoundLabelError>, ErrorCopy>,
  queueId: {
    shape: {
      message: copy("队列事项的编号「{text}」写法不对。", { text: "q12" }),
      hint: copy("写成 Q12 这样：大写的 Q 加数字，数字前面不补 0。"),
    },
    zero: {
      message: copy("队列事项的编号「{text}」写了 0。", { text: "Q0" }),
      hint: copy("队列事项从 Q1 起编号。"),
    },
  } satisfies Record<IdError, ErrorCopy>,
  sceneId: {
    shape: {
      message: copy("场景的编号「{text}」写法不对。", { text: "s3" }),
      hint: copy("写成 S3 这样：大写的 S 加数字，数字前面不补 0。"),
    },
    zero: {
      message: copy("场景的编号「{text}」写了 0。", { text: "S0" }),
      hint: copy("场景从 S1 起编号。"),
    },
  } satisfies Record<IdError, ErrorCopy>,
  queueIdList: {
    bad: {
      message: copy("有 {count} 个队列事项的编号写错了：{bad}。", { count: 2, bad: "q15、Q0" }),
      hint: copy("每个都写成 Q12 这样，多个之间用逗号隔开，例如 Q12,Q15。"),
    },
  } satisfies Record<QueueIdListError, ErrorCopy>,
};

/** 响应外壳自己的校验，见 envelope.ts。只在程序写错时出现。 */
export const envelopeCopy = {
  requires: copy("错误码 {code} 要写 {field}。", { code: "RULE_BLOCKED", field: "rule" }),
  issuesWithTotal: copy("issues 和 total 要一起写。"),
  total: copy("total 写的是 {total}，issues 实际有 {count} 条。", { total: 3, count: 2 }),
  firstIssue: copy("顶层的 {field} 要和 issues 的第一条相同。", { field: "message" }),
};
