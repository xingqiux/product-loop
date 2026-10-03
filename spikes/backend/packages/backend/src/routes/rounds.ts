import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';
import { fail, ok } from '../envelope.ts';

export const STAGES = ['构思', '使用', '检查', '落地', '提升'] as const;

// 开始一轮的请求体，对应 `ploop round start <阶段> --take Q12,Q15`。
const StartRoundBody = z.object({
  stage: z.enum(STAGES),
  take: z.array(z.string().regex(/^Q\d+$/, '编号写成 Q 加数字，例如 Q12')).optional(),
});

export const rounds = new Hono()
  .post(
    '/projects/:pid/rounds',
    zValidator('json', StartRoundBody, (result, c) => {
      if (!result.success) {
        const issues = result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
        return c.json(fail('BAD_REQUEST', '请求的数据不合格式', issues), 400);
      }
    }),
    (c) => {
      const { pid } = c.req.param();
      const { stage, take = [] } = c.req.valid('json');
      return c.json(ok({ project: pid, round: `v1-${stage}-1`, stage, taken: take }, ['ploop page present']), 201);
    },
  )
  .get('/rounds/:rid', (c) => c.json(ok({ round: c.req.param('rid'), status: '进行中' as const }), 200));
