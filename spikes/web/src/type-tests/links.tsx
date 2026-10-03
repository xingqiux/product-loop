// 这个文件不被应用引用，只给 tsc 检查。
// 每个 @ts-expect-error 下面那一行必须真的是类型错误；不是的话 tsc 会报「多余的 @ts-expect-error」（TS2578）而失败。
import { AppLink } from '../components/AppLink'

export const typeCases = [
  // 对的写法：路径参数和查询参数都对得上
  <AppLink key="ok" to="/p/$project/r/$round" params={{ project: '产品循环', round: 'v2-落地-3' }} search={{ item: '疑问-2' }}>ok</AppLink>,
  // @ts-expect-error 参数名写错：rund 不是这个路由的参数
  <AppLink key="wrong-param" to="/p/$project/r/$round" params={{ project: '产品循环', rund: 'v2-落地-3' }}>x</AppLink>,
  // @ts-expect-error 少了 round 参数
  <AppLink key="missing-param" to="/p/$project/r/$round" params={{ project: '产品循环' }}>x</AppLink>,
  // @ts-expect-error 没有这个路由
  <AppLink key="no-route" to="/p/$project/queue" params={{ project: '产品循环' }}>x</AppLink>,
  // @ts-expect-error 查询参数的类型不对：item 要字符串
  <AppLink key="bad-search" to="/p/$project/r/$round" params={{ project: '产品循环', round: 'v2-落地-3' }} search={{ item: 3 }}>x</AppLink>,
]
