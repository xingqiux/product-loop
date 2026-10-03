// 主线的解析：十样、场景、设计规范的十二样和写作规范一节，以及给新场景补编号。
// 后端收进主线的新版本时用，体检迁移旧主线时也用。见「03 数据模型」第二节和「08 版本与迁移」第四节。

export { assignSceneIds, type SceneIdAssignment, type SceneIdsAssigned } from "./assign.ts";
export type { DesignSpecEntry } from "./design-spec.ts";
export type { MainlineHeading } from "./lines.ts";
export { type MainlineMissing, missingOfParse } from "./missing.ts";
export { type MainlineParse, type MainlinePartEntry, parseMainline } from "./parse.ts";
export { type DesignSpecItem, designSpecItem, type MainlinePart, mainlinePart } from "./parts.ts";
export {
  describeMainlineProblem,
  describeMainlineProblems,
  type MainlineProblem,
  type MainlineProblemKind,
} from "./problems.ts";
export type { MainlineScene, MainlineStep } from "./scenes.ts";
export { mainlineTemplate } from "./template.ts";
