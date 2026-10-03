// 界面偏好存进浏览器本地。本地存储随时可能用不了：无痕模式、禁用了网站数据、配额满了。
// zustand 的 createJSONStorage 只兜住取存储对象这一步，读写抛的错会一路抛到点按钮的事件里。
// 所以每次读写都自己兜住：存不进去就留在内存里，只影响刷新以后还记不记得，不影响使用。
import type { StateStorage } from "zustand/middleware";

const memory = new Map<string, string>();

function localStorageOrNull(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export const safeLocalStorage: StateStorage = {
  getItem(name) {
    try {
      const value = localStorageOrNull()?.getItem(name);
      if (value != null) return value;
    } catch {
      // 读不了就看内存里有没有。
    }
    return memory.get(name) ?? null;
  },
  setItem(name, value) {
    memory.set(name, value);
    try {
      localStorageOrNull()?.setItem(name, value);
    } catch {
      // 存不进去，留在内存里。
    }
  },
  removeItem(name) {
    memory.delete(name);
    try {
      localStorageOrNull()?.removeItem(name);
    } catch {
      // 同上。
    }
  },
};
