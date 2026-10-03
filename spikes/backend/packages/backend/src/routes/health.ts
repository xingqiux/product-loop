import { Hono } from 'hono';
import { ok } from '../envelope.ts';

export const health = new Hono().get('/', (c) =>
  c.json(ok({ status: '正常' as const, apiVersion: 1, pid: process.pid }), 200),
);
