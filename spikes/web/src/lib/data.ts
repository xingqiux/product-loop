import { queryOptions } from '@tanstack/react-query'

// 假数据，假装是后端接口。真项目里这里换成 Hono 的类型化客户端，形状不变。
export interface Round {
  id: string
  stage: string
  items: readonly string[]
}

export interface Project {
  id: string
  name: string
  rounds: readonly Round[]
}

const PROJECTS: readonly Project[] = [
  {
    id: '产品循环',
    name: '产品循环',
    rounds: [
      { id: 'v2-落地-3', stage: '落地', items: ['疑问-1', '疑问-2', 'F-7'] },
      { id: 'v2-检查-1', stage: '检查', items: ['F-1', 'F-2'] },
      { id: 'v1-构思-12', stage: '构思', items: ['场景-3'] },
    ],
  },
  {
    id: 'quality-kit',
    name: '表单检查插件',
    rounds: [{ id: 'v1-使用-2', stage: '使用', items: ['S-1'] }],
  },
]

const latency = () => new Promise((resolve) => setTimeout(resolve, 40))

export const projectsQuery = queryOptions({
  queryKey: ['projects'],
  queryFn: async () => {
    await latency()
    return PROJECTS.map((p) => ({ id: p.id, name: p.name, roundCount: p.rounds.length }))
  },
})

export const projectQuery = (projectId: string) =>
  queryOptions({
    queryKey: ['project', projectId],
    queryFn: async (): Promise<Project | null> => {
      await latency()
      return PROJECTS.find((p) => p.id === projectId) ?? null
    },
  })
