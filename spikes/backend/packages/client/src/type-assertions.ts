// 编译期断言：包 A 的类型确实穿过了包边界，而且是精确的类型，不是 any。
// 任何一条不成立，tsc --noEmit 就会报错。
import type { InferRequestType, InferResponseType } from 'hono/client';
import type { Client } from './index.ts';

type Equal<X, Y> = (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2 ? true : false;
type Expect<T extends true> = T;
type IsAny<T> = 0 extends 1 & T ? true : false;

type StartRound = Client['api']['v1']['projects'][':pid']['rounds']['$post'];
type Health = Client['api']['v1']['health']['$get'];

export type Assertions = [
  // 请求：阶段只能是五个中文阶段名之一（来自包 A 的 Zod 定义）
  Expect<Equal<InferRequestType<StartRound>['json']['stage'], '构思' | '使用' | '检查' | '落地' | '提升'>>,
  Expect<Equal<InferRequestType<StartRound>['param'], { pid: string }>>,
  // 响应：201 的外壳和数据
  Expect<Equal<InferResponseType<StartRound, 201>['ok'], true>>,
  Expect<Equal<InferResponseType<StartRound, 201>['data']['taken'], string[]>>,
  // 响应：校验失败的 400 也有类型（来自 zValidator 的钩子）
  Expect<Equal<InferResponseType<StartRound, 400>['error']['code'], 'BAD_REQUEST'>>,
  // 子应用经 .route() 合进来以后仍有类型
  Expect<Equal<IsAny<InferResponseType<Health>>, false>>,
  Expect<Equal<InferResponseType<Health>['data']['status'], '正常'>>,
];
