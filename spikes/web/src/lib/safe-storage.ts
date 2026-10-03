import type { StateStorage } from 'zustand/middleware'

// 浏览器本地存储随时可能用不了：无痕模式、禁用了网站数据、配额满了、被安全策略拦下。
// zustand 的 createJSONStorage 只在「取 storage 对象」那一步包了 try/catch；
// getItem / setItem 抛的错会一路抛到 set() 的调用方，也就是点按钮的事件里。
// 所以这里每次读写都自己兜住：存不进去就留在内存里，只影响「刷新后还记不记得」，不影响使用。
const memory = new Map<string, string>()

function localStorageOrNull(): Storage | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

export const safeLocalStorage: StateStorage = {
  getItem(name) {
    try {
      const value = localStorageOrNull()?.getItem(name)
      if (value != null) return value
    } catch {
      // 读不了就看内存里有没有
    }
    return memory.get(name) ?? null
  },
  setItem(name, value) {
    memory.set(name, value)
    try {
      localStorageOrNull()?.setItem(name, value)
    } catch {
      // 存不进去：留在内存里
    }
  },
  removeItem(name) {
    memory.delete(name)
    try {
      localStorageOrNull()?.removeItem(name)
    } catch {
      // 同上
    }
  },
}
