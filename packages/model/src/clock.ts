// 用户看得见的日期和时间一律按北京时间写，和本机的时区无关（决定 188）。
// 中国不用夏令时，北京时间固定比 UTC 早八小时。
// 每日快照、Time Machine 每天查一次也按北京时间分天。文件夹名和快照名里的时间是 UTC，以 Z 结尾。

const offsetMs = 8 * 60 * 60 * 1000;
const two = (n: number) => String(n).padStart(2, "0");

/** 北京时间的日期，写成 2026-09-28。 */
export function beijingDay(at: Date): string {
  const b = new Date(at.getTime() + offsetMs);
  return `${b.getUTCFullYear()}-${two(b.getUTCMonth() + 1)}-${two(b.getUTCDate())}`;
}

/** 北京时间写到分钟，例如 2026-09-28 16:05。 */
export function beijingMinute(at: Date): string {
  const b = new Date(at.getTime() + offsetMs);
  return `${beijingDay(at)} ${two(b.getUTCHours())}:${two(b.getUTCMinutes())}`;
}

/** 北京时间写到秒，例如 2026-09-28 16:05:01。 */
export function beijingSecond(at: Date): string {
  const b = new Date(at.getTime() + offsetMs);
  return `${beijingMinute(at)}:${two(b.getUTCSeconds())}`;
}

/**
 * 按时区写出的日期和分钟。不写 timeZone 就是本机的时区，
 * 命令行输出的时间用它；写了时区（例如 Asia/Shanghai）是给测试用的。
 */
function partsOf(at: Date, timeZone: string | undefined) {
  const parts = new Intl.DateTimeFormat("en-US", {
    ...(timeZone === undefined ? {} : { timeZone }),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return {
    day: `${value("year")}-${value("month")}-${value("day")}`,
    time: `${value("hour")}:${value("minute")}`,
  };
}

/** 本机时区的日期，写成 2026-09-28。 */
export function localDate(at: Date, timeZone?: string): string {
  return partsOf(at, timeZone).day;
}

/** 本机时区写到分钟，例如 2026-09-28 16:05。 */
export function localMinute(at: Date, timeZone?: string): string {
  const { day, time } = partsOf(at, timeZone);
  return `${day} ${time}`;
}
