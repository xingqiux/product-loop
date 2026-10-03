import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { probe } from '../lib/probe'
import { safeLocalStorage } from '../lib/safe-storage'

// 界面偏好：左边一栏是否折叠。服务器数据不放这里（归 TanStack Query），当前看哪一条也不放这里（归地址）。
interface UiState {
  sidebarCollapsed: boolean
  toggleSidebar: () => void
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
    }),
    {
      name: 'ploop-ui',
      storage: createJSONStorage(() => safeLocalStorage),
      partialize: (state) => ({ sidebarCollapsed: state.sidebarCollapsed }),
      // 存的内容坏了（不是合法 JSON）时，persist 自己会接住错误、保持默认值；这里只记一笔给检查看。
      onRehydrateStorage: () => (_state, error) => {
        probe('ui:rehydrated', { error: error ? String(error) : null })
      },
    },
  ),
)
