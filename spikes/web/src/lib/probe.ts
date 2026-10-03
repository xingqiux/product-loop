// 给无头浏览器检查用的探针。
// bootId 在整页加载时生成一次：点链接以后它没变，说明是单页内跳转，不是整页刷新。
export interface ProbeEvent {
  kind: string
  detail?: unknown
  t: number
}

declare global {
  interface Window {
    __spike: { bootId: string; events: ProbeEvent[] }
  }
}

window.__spike ??= { bootId: Math.random().toString(36).slice(2), events: [] }

export function probe(kind: string, detail?: unknown): void {
  window.__spike.events.push({ kind, detail, t: Math.round(performance.now()) })
}
