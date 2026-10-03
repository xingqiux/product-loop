// 响应的外壳，形状按「05 接口」第一节：成功 {ok, data, warnings, next}，失败 {ok, error}。

export type Issue = { path: string; message: string };

export const ok = <D>(data: D, next: string[] = []) => ({
  ok: true as const,
  data,
  warnings: [] as string[],
  next,
});

export const fail = <C extends string>(code: C, message: string, issues: Issue[] = []) => ({
  ok: false as const,
  error: { code, message, issues },
});
