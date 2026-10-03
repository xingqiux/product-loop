// 故意写错的用法。验证脚本要求 tsc 对这个文件报出下面四处错误，一处都不能少。
import { createClient } from '../src/index.ts';

const client = createClient('http://127.0.0.1:4731');

// 错误一：阶段写了不存在的值（后端的 Zod 定义只有五个阶段）
await client.api.v1.projects[':pid'].rounds.$post({ param: { pid: 'p1' }, json: { stage: '评审' } });

// 错误二：漏了路径参数 pid
await client.api.v1.projects[':pid'].rounds.$post({ json: { stage: '检查' } });

// 错误三：读了响应里不存在的字段（后端返回的是 round，不是 roundId）
const res = await client.api.v1.projects[':pid'].rounds.$post({ param: { pid: 'p1' }, json: { stage: '检查' } });
if (res.status === 201) {
  const body = await res.json();
  console.log(body.data.roundId);
}

// 错误四：调了后端没有的接口
await client.api.v1.rounds[':rid'].$delete({ param: { rid: 'v1-检查-1' } });
