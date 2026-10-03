import { type CopyItem, flattenCopy } from "@product-loop/model";
import { autostartCopy } from "./autostart.ts";
import { backendCopy } from "./backend.ts";
import { backupCmdCopy } from "./backup-cmd.ts";
import { decisionCopy } from "./decision.ts";
import { doctorCopy } from "./doctor.ts";
import { exportCopy } from "./export.ts";
import {
  helpEnvCopy,
  helpHeadingCopy,
  helpTextCopy,
  programCopy,
  roundStepCommandCopy,
} from "./help.ts";
import { initCopy } from "./init.ts";
import { landCopy } from "./land.ts";
import { lintCopy } from "./lint.ts";
import { mainlineCopy } from "./mainline.ts";
import { openCopy } from "./open.ts";
import { errorLineCopy, outputCopy } from "./output.ts";
import { pageCopy } from "./page.ts";
import { primeCopy } from "./prime.ts";
import { projectCopy } from "./project.ts";
import { queueCopy } from "./queue.ts";
import { readErrorCopy } from "./read-error.ts";
import { replyCopy } from "./reply.ts";
import { roundCopy } from "./round.ts";
import { setupCopy } from "./setup.ts";
import { skillCopy } from "./skill.ts";
import { statusCopy } from "./status.ts";
import { usageCopy } from "./usage.ts";
import { useCopy } from "./use.ts";
import { versionCopy } from "./version.ts";

// 命令行自己的文案。暂时放在这里，以后并进共用定义的文案表，由 allCopy() 一起跑写作校验。
// 并过去时，把下面这些键原样加进 allCopy()，键和共用定义的不重名。

/** 命令行的全部文案。键在这张表里唯一。 */
export function allCliCopy(): CopyItem[] {
  return [
    ...flattenCopy("cli.helpHeading", helpHeadingCopy),
    ...flattenCopy("cli.helpText", helpTextCopy),
    ...flattenCopy("cli.program", programCopy),
    ...flattenCopy(
      "cli.helpEnv",
      Object.fromEntries(helpEnvCopy.map(({ name, text }) => [name, text])),
    ),
    ...flattenCopy("cli.roundStepCommand", roundStepCommandCopy),
    ...flattenCopy("cli.output", outputCopy),
    ...errorLineCopy.flatMap(({ code, line }) => flattenCopy(`cli.errorLine.${code}`, line)),
    ...flattenCopy("cli.usage", usageCopy),
    ...flattenCopy("cli.project", projectCopy),
    ...flattenCopy("cli.readError", readErrorCopy),
    ...flattenCopy("cli.doctor", doctorCopy),
    ...flattenCopy("cli.init", initCopy),
    ...flattenCopy("cli.status", statusCopy),
    ...flattenCopy("cli.prime", primeCopy),
    ...flattenCopy("cli.reply", replyCopy),
    ...flattenCopy("cli.open", openCopy),
    ...flattenCopy("cli.round", roundCopy),
    ...flattenCopy("cli.page", pageCopy),
    ...flattenCopy("cli.queue", queueCopy),
    ...flattenCopy("cli.decision", decisionCopy),
    ...flattenCopy("cli.mainline", mainlineCopy),
    ...flattenCopy("cli.land", landCopy),
    ...flattenCopy("cli.use", useCopy),
    ...flattenCopy("cli.lint", lintCopy),
    ...flattenCopy("cli.skill", skillCopy),
    ...flattenCopy("cli.backup", backupCmdCopy),
    ...flattenCopy("cli.export", exportCopy),
    ...flattenCopy("cli.setup", setupCopy),
    ...flattenCopy("cli.backend", backendCopy),
    ...flattenCopy("cli.autostart", autostartCopy),
    ...flattenCopy("cli.version", versionCopy),
  ];
}
