import { Hono } from 'hono';
import { z } from 'zod';
import { health } from './routes/health.ts';
import { rounds } from './routes/rounds.ts';

// 校验的报错用中文（Zod 4 自带 zh-CN 文案）。
z.config(z.locales.zhCN());

// 按资源拆成子应用再合到一起（「02 技术选型」第六节的做法），看类型能不能穿过 .route()。
export const app = new Hono().basePath('/api/v1').route('/health', health).route('/', rounds);

export type AppType = typeof app;
