// 页面上的时间：最近的写成「多久以前」，远的写日期。日期按北京时间（决定 188）。
import { beijingDay, beijingMinute } from "@product-loop/model";

const minuteMs = 60_000;
const hourMs = 60 * minuteMs;
const dayMs = 24 * hourMs;

/** 离现在多久：刚才、12 分钟前、2 小时前、昨天 22:40、3 天前，一个月以上写日期。 */
export function sinceText(at: Date, now: Date): string {
  const passed = now.getTime() - at.getTime();
  if (passed < minuteMs) return "刚才";
  if (passed < hourMs) return `${Math.floor(passed / minuteMs)} 分钟前`;
  const today = beijingDay(now);
  if (beijingDay(at) === today) return `${Math.floor(passed / hourMs)} 小时前`;
  if (beijingDay(new Date(at.getTime() + dayMs)) === today) {
    return `昨天 ${beijingMinute(at).slice(11)}`;
  }
  const days = Math.max(2, Math.round(passed / dayMs));
  return days <= 30 ? `${days} 天前` : beijingDay(at);
}
