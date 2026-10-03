// 动效的时长和缓动，见决定 190。取值和 styles/theme.css 的 --duration-*、--ease-* 相同，由测试核对。
// Motion 读这里的秒数和贝塞尔曲线，CSS 的过渡读主题变量。
import type { Transition } from "motion/react";

type Curve = [number, number, number, number];

const screenCurve: Curve = [0.22, 1, 0.36, 1];
const selectCurve: Curve = [0.2, 0, 0, 1];
const cardCurve: Curve = [0.32, 0.72, 0, 1];

/** 四处动效和几种短过渡各用哪一种。 */
export const motionTokens = {
  /** 换一屏、弹窗和侧滑面板进出 */
  screen: { duration: 0.22, ease: screenCurve },
  /** 点了选项、打勾的反馈，提示条 */
  select: { duration: 0.16, ease: selectCurve },
  /** 队列看板上卡片换列 */
  card: { duration: 0.36, ease: cardCurve },
  /** 阶段条上阶段推进 */
  stage: { duration: 0.42, ease: cardCurve },
  /** 淡入淡出，遮罩 */
  fade: { duration: 0.2, ease: "easeOut" },
  /** 悬停 */
  hover: { duration: 0.12, ease: "easeOut" },
  /** 提交以后的状态变化 */
  submit: { duration: 0.24, ease: screenCurve },
} satisfies Record<string, Transition>;

/** 系统开了「减少动态效果」。每次用时才读，用户在系统设置里改了以后不用刷新。 */
export function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * 滚动的方式：系统开了「减少动态效果」时不滚动，直接到位（规范：只保留透明度的变化）；否则平滑滚动。
 */
export function scrollBehavior(): ScrollBehavior {
  return prefersReducedMotion() ? "auto" : "smooth";
}

/**
 * 交给 motion.create 包起来的 React Aria 组件，去掉和 Motion 同名、类型不同的几项。
 * 事件是浏览器的 CSS 动画和拖动，组件里用不到。style 由 Motion 写，React Aria 会并上自己的定位。
 */
export type WithoutDomAnimation<P> = Omit<
  P,
  | "onAnimationStart"
  | "onAnimationEnd"
  | "onAnimationIteration"
  | "onDrag"
  | "onDragStart"
  | "onDragEnd"
  | "style"
>;
