// 包 B 只从包 A 拿类型。必须写成 `import type {…}`：写成 `import { type AppType }` 时，
// 类型剥离后会留下 `import {} from '@spike/backend'`，运行时仍会加载后端的代码。
import type { AppType } from '@spike/backend';
import { hc } from 'hono/client';

export const createClient = (baseUrl: string) =>
  hc<AppType>(baseUrl, { headers: { 'X-Ploop-Client': 'cli/spike' } });

export type Client = ReturnType<typeof createClient>;
