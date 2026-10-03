import { type ErrorBody, formatSceneId, ok, type Result } from "@product-loop/model";
import { and, asc, eq, lte } from "drizzle-orm";
import { screens } from "../../store/schema/index.ts";
import { findProject, type Reader } from "../projects.ts";
import { currentVersionRow } from "../versions.ts";
import { sceneNames } from "./runs.ts";

// 屏的查询：这一版新出现和变过的屏，和全部的屏，都按场景分组，见「03 数据模型」第二节。
// 开始一轮检查时列出变过的屏，加 --all-screens 列出全部，由第 53 步接上。
// 接口是 GET /projects/:pid/screens/changed?version=，见「05 接口」第四节。

/**
 * 一屏在某一版的情况。
 * - new：这一版第一次截到。
 * - changed：这一版的截图和上一版的比，变过。
 * - same：这一版没变，或者这一版还没截到。
 */
type ScreenStatus = "new" | "changed" | "same";

type ScreenView = {
  readonly step: number;
  readonly width: number;
  readonly status: ScreenStatus;
  /** 最近一次的截图的哈希。 */
  readonly shot: string;
  /** 最近一次截图是哪一版截的。比查的那一版早，说明那一版还没截到这一屏。 */
  readonly shotVersion: number;
  /** 上一版的截图，变过的屏拿它和最近一次的截图对照。这一屏在 shotVersion 才出现时为空。 */
  readonly baseShot: string | null;
  readonly firstVersion: number;
  /** 最近一次变化的版本。没变过的为空。 */
  readonly changedVersion: number | null;
};

/** 一个场景的屏，按步号和宽度排。名字取自场景表，场景不在场景表里时为空。 */
type SceneScreens = {
  readonly scene: string;
  readonly name: string | null;
  readonly screens: readonly ScreenView[];
};

export type ScreenList = {
  /** 按哪一版算的。 */
  readonly version: number;
  /** 按场景编号排。 */
  readonly scenes: readonly SceneScreens[];
};

export type ListScreensOptions = {
  /** 按哪一版算新出现和变过。不写就是当前的一版。 */
  readonly version?: number | undefined;
  /** 只列这一版新出现和变过的。 */
  readonly changedOnly?: boolean | undefined;
};

/**
 * 项目的屏，按场景分组，只列这一版以前出现过的。
 * 屏只记最近一次变化的版本，所以查更早的一版时，后来又变过的屏不算那一版变过。
 */
export function listScreens(
  db: Reader,
  projectId: string,
  options: ListScreensOptions = {},
): Result<ScreenList, ErrorBody<"NOT_FOUND">> {
  const project = findProject(db, projectId);
  if (!project.ok) return project;
  const version = options.version ?? currentVersionRow(db, projectId).version;
  const rows = db
    .select()
    .from(screens)
    .where(and(eq(screens.projectId, projectId), lte(screens.firstVersion, version)))
    .orderBy(asc(screens.scene), asc(screens.step), asc(screens.width))
    .all();
  const names = sceneNames(db, projectId);
  const groups: { scene: number; screens: ScreenView[] }[] = [];
  for (const row of rows) {
    const status: ScreenStatus =
      row.firstVersion === version ? "new" : row.changedVersion === version ? "changed" : "same";
    if (options.changedOnly === true && status === "same") continue;
    const view: ScreenView = {
      step: row.step,
      width: row.width,
      status,
      shot: row.shot,
      shotVersion: row.shotVersion,
      baseShot: row.baseShot,
      firstVersion: row.firstVersion,
      changedVersion: row.changedVersion,
    };
    const last = groups.at(-1);
    if (last?.scene === row.scene) last.screens.push(view);
    else groups.push({ scene: row.scene, screens: [view] });
  }
  return ok({
    version,
    scenes: groups.map((group) => ({
      scene: formatSceneId(group.scene),
      name: names.get(group.scene) ?? null,
      screens: group.screens,
    })),
  });
}

/** 这一版新出现和变过的屏，按场景分组。ploop use changed 和开始一轮检查用。 */
export function changedScreens(
  db: Reader,
  projectId: string,
  version?: number,
): Result<ScreenList, ErrorBody<"NOT_FOUND">> {
  return listScreens(db, projectId, { version, changedOnly: true });
}
