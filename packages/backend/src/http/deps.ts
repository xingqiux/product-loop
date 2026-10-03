import type { Issue } from "@product-loop/model";
import type { Notifier } from "../core/events.ts";
import type { ReservedDirs } from "../core/projects.ts";
import type { WaitClock } from "../core/replies/wait.ts";
import type { BackupActions } from "../process/backup.ts";
import type { Db } from "../store/db.ts";
import type { HomePaths } from "../store/home.ts";

/**
 * 两类全局操作，见「01 架构」第七节：迁移数据，从快照恢复。
 * 迁移数据包括升级数据结构和导入旧数据。
 */
export type GlobalWork = "migrate" | "restore";

/** 正在做的全局操作，和它开始的时间。 */
export type Busy = { readonly work: GlobalWork; readonly since: Date };

/** 后端进程的状态。进程入口建一份，见 process/state.ts。 */
export type ProcessGate = {
  /** 正在做的全局操作。这期间写请求和 shutdown 返回 BUSY。 */
  readonly busy: () => Busy | undefined;
  /** 后端正在退出。这期间的响应带 Connection: close，连接用完就关。 */
  readonly stopping: () => boolean;
  /** 开始退出时叫一声。已经在退出时立即叫。长轮询据此提前返回，返回取消订阅。 */
  readonly onStopping: (listener: () => void) => () => void;
  /** 做一件全局操作。恢复快照的接口用它，同时只能做一件。 */
  readonly during: <T>(work: GlobalWork, task: () => Promise<T>) => Promise<T>;
};

/** 接口层的依赖。进程入口建一份，测试里换成临时数据库和假时钟。 */
export type AppDeps = {
  /** 内核的依赖：数据库、提交以后的通知、时钟。 */
  readonly db: Db;
  readonly notifier: Notifier;
  readonly now: () => Date;
  /** 等回复的长轮询用的计时器。测试里换成假的。 */
  readonly waitClock: WaitClock;
  /** 不能当项目根目录的地方：家目录和集中存储，由后端按自己的环境取。 */
  readonly reserved: ReservedDirs;
  /** 集中存储的各个目录。health 返回它的位置，退出前查快照做完没有。 */
  readonly paths: HomePaths;
  /** 后端监听的端口。端口写 0 时由系统分配，所以每次检查请求时再取。 */
  readonly port: () => number;
  /** 构建号，见「05 接口」第八节。 */
  readonly build: string;
  /** 工作台的静态文件所在的目录，见 routes/web.ts。 */
  readonly webDir: string;
  /** 数据结构版本：数据库里已执行的最后一个迁移的生成时间，毫秒数。 */
  readonly schemaVersion: number;
  /**
   * 请后端退出，POST /admin/shutdown 调用它。
   * 它只发起退出：不再接新请求，等手上的请求做完。
   * 所以这一次的响应照常发出，见「01 架构」第六节。
   */
  readonly shutdown: () => void;
  /** 日志。出错的详情写进去，INTERNAL 的报错写明日志在哪里。 */
  readonly log: {
    readonly file: string;
    /** 出错的详情写进日志，request 是出错的请求，例如 GET /api/v1/projects/app/queue/Q1。 */
    readonly error: (error: unknown, request?: string) => void;
  };
  readonly process: ProcessGate;
  /**
   * 写请求执行之前调用：当天第一次写入时先做每日快照，见「03 数据模型」第七节。
   * 快照期间来的写请求在这里等它做完（约定 0002 第 8 条）。它不抛出，快照失败时照常写入。
   */
  readonly dailySnapshot: () => Promise<void>;
  /**
   * 备份的警告：今天的快照没有做成，Time Machine 不满足两个条件。
   * 状态接口把它们放进外壳的 warnings，见「03 数据模型」第七节。
   * 命令行读状态时不带 Time Machine 的那几条（only.timeMachine 为 false），ploop backup list 的接口总是带。
   */
  readonly backupWarnings: (
    now: Date,
    only?: { readonly timeMachine?: boolean },
  ) => Promise<readonly Issue[]>;
  /** 手动快照和从快照恢复，ploop backup now 和 ploop backup restore 用。 */
  readonly backups: BackupActions;
};
