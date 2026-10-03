// 反例：故意把参数名 round 写成 rund。verify 期望 tsc 在这一行报错。
import { AppLink } from '../../src/components/AppLink'

export const WrongParam = () => (
  <AppLink to="/p/$project/r/$round" params={{ project: '产品循环', rund: 'v2-落地-3' }}>
    错的参数
  </AppLink>
)
