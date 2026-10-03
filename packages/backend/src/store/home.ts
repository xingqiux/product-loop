import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { logDirName, runDirName } from "@product-loop/model";

// 集中存储的目录，默认是 ~/.product-loop，结构见「03 数据模型」第四节。
// 开发和测试用环境变量 PLOOP_HOME 指到临时目录，不碰真实数据。
// 按 PLOOP_HOME 算出目录的 resolveHome 在共用定义里，命令行也用它，见约定 0002 第 13 条。

export type HomePaths = {
  readonly home: string;
  /** 端口、缓存保留天数这类设置。 */
  readonly config: string;
  /** 数据库文件。运行时旁边另有 -wal 和 -shm 两个文件。 */
  readonly database: string;
  /** 集中存储下的各个目录，ensureHome 逐个建好。 */
  readonly dirs: {
    readonly data: string;
    /** 附件库，按内容的哈希分两级目录存放。 */
    readonly blobs: string;
    /** 每日快照和迁移前的快照。 */
    readonly backups: string;
    /** 迁移前各项目旧文件的归档包。 */
    readonly archives: string;
    readonly exports: string;
    /** 后端的进程号、端口、启动锁。 */
    readonly run: string;
    readonly logs: string;
    /** 安装的运行文件，app/<版本>/ 和 app/current。 */
    readonly app: string;
  };
};

export function homePaths(home: string): HomePaths {
  const data = join(home, "data");
  return {
    home,
    config: join(home, "config.json"),
    database: join(data, "ploop.db"),
    dirs: {
      data,
      blobs: join(home, "blobs"),
      backups: join(home, "backups"),
      archives: join(home, "archives"),
      exports: join(home, "exports"),
      run: join(home, runDirName),
      logs: join(home, logDirName),
      app: join(home, "app"),
    },
  };
}

/** 建好集中存储的各个目录，已有的不动。 */
export function ensureHome(paths: HomePaths): void {
  for (const dir of Object.values(paths.dirs)) {
    mkdirSync(dir, { recursive: true });
  }
}
