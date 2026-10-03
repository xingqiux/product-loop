// 和后端的连接状态，由事件流更新，顶上一行读它。
import { create } from "zustand";
import type { Connection } from "@/lib/events";

export const useConnection = create<{ status: Connection }>()(() => ({ status: "connecting" }));
