// 界面偏好，见「06 工作台」第九节。服务器数据不放这里，归 TanStack Query；当前看哪一条也不放这里，归地址。
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { safeLocalStorage } from "@/lib/safe-storage";

interface UiState {
  /** 每个阶段的页面左边一栏是否折叠 */
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  /** 用户关掉备份提示的时间，毫秒。没关过的为空，见 lib/backup-notice.ts。 */
  backupDismissedAt: number | undefined;
  dismissBackup: () => void;
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
      backupDismissedAt: undefined,
      dismissBackup: () => set({ backupDismissedAt: Date.now() }),
    }),
    {
      name: "ploop-ui",
      storage: createJSONStorage(() => safeLocalStorage),
      partialize: (state) => ({
        sidebarCollapsed: state.sidebarCollapsed,
        backupDismissedAt: state.backupDismissedAt,
      }),
    },
  ),
);
