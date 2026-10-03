// 对着正在运行的包 A 调三次接口，打印带类型的结果（一行 JSON）。
// 用法：node src/demo.ts http://127.0.0.1:<端口>
import { createClient } from './index.ts';

const baseUrl = process.argv[2] ?? 'http://127.0.0.1:4731';
const client = createClient(baseUrl);

// 1. 健康检查：子应用 health 经 .route() 合进来
const healthRes = await client.api.v1.health.$get();
const health = await healthRes.json();
const status: '正常' = health.data.status;

// 2. 开始一轮：合法的请求，按状态码收窄到 201 的类型
const startedRes = await client.api.v1.projects[':pid'].rounds.$post({
  param: { pid: 'p1' },
  json: { stage: '检查', take: ['Q12', 'Q15'] },
});
if (startedRes.status !== 201) throw new Error(`开始一轮应当返回 201，实际是 ${startedRes.status}`);
const started = await startedRes.json();
const round: string = started.data.round;
const taken: string[] = started.data.taken;

// 3. 故意绕过类型发一个不合法的阶段，看运行时的 Zod 校验；400 的响应体同样有类型
const rejectedRes = await client.api.v1.projects[':pid'].rounds.$post({
  param: { pid: 'p1' },
  json: { stage: '评审', take: ['12'] } as never,
});
if (rejectedRes.status !== 400) throw new Error(`不合法的请求应当返回 400，实际是 ${rejectedRes.status}`);
const rejected = await rejectedRes.json();
const code: 'BAD_REQUEST' = rejected.error.code;

console.log(
  JSON.stringify({
    health: { status: healthRes.status, body: health, typed: { status } },
    started: { status: startedRes.status, body: started, typed: { round, taken } },
    rejected: { status: rejectedRes.status, body: rejected, typed: { code } },
  }),
);
