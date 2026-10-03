import { copy, type ErrorCopy } from "@product-loop/model";

// 接口层自己的报错：安全检查、请求的格式、没有的接口、后端忙，见「05 接口」第二、九节。
// 业务上的报错由内核给出，这里只有接口层在调用内核之前拦下的几种。
// 暂时放在后端。以后并进 model 的文案表，由 allCopy() 汇总，跑写作校验。

export const httpCopy = {
  /** 安全检查，见「05 接口」第二节。 */
  security: {
    /** 请求头 Host 不是后端的地址，防止 DNS 重绑定。 */
    host: {
      message: copy("请求头 Host 是「{host}」，不是后端的地址。", { host: "evil.example:4731" }),
      hint: copy("用 http://127.0.0.1:{port} 访问后端。", { port: 4731 }),
    },
    /** HTTP/1.0 的请求可以不带 Host。怎么改和 host 相同。 */
    hostMissing: copy("请求没有带请求头 Host。"),
    /** 带了 Origin，却不是后端自己的页面。 */
    origin: {
      message: copy("请求来自「{origin}」，只有后端自己的页面能调用接口。", {
        origin: "https://evil.example",
      }),
      hint: copy("从 http://127.0.0.1:{port} 打开工作台，在工作台里操作。", { port: 4731 }),
    },
    /** 会改数据的请求没带 X-Ploop-Client。 */
    client: {
      message: copy("会改数据的请求要带请求头 X-Ploop-Client。"),
      hint: copy("写上客户端和版本，例如 cli/2.0.0。"),
    },
    /** 带了 Idempotency-Key，值却是空的。 */
    idempotencyKey: {
      message: copy("请求头 Idempotency-Key 是空的。"),
      hint: copy("每次请求生成一个随机编号，重发同一个请求时沿用它。"),
    },
    /** 请求体超过上限。页面数据单份不超过五兆。 */
    bodyTooLarge: {
      message: copy("请求体超过了 {limit} 的上限。", { limit: "5 MB" }),
      hint: copy("截图先经附件的接口上传，页面数据里只写哈希。"),
    },
  },
  /** 请求体和查询参数的格式。 */
  request: {
    contentType: {
      message: copy("请求体要写成 JSON，Content-Type 要写 application/json。"),
      hint: copy("把请求头 Content-Type 改成 application/json。"),
    },
    notJson: {
      message: copy("请求体不是合法的 JSON。"),
      hint: copy("请求体要写成一个 JSON 对象。"),
    },
  } satisfies Record<string, ErrorCopy>,
  /** 修改队列事项要带 If-Match，写它现在的修改计数，见「05 接口」第三节。 */
  ifMatch: {
    missing: copy("修改 {id} 要带请求头 If-Match，写它现在的修改计数。", { id: "Q12" }),
    invalid: copy("请求头 If-Match 写的是「{value}」，要写修改计数，例如 3。", { value: "abc" }),
    hint: copy("运行 ploop queue show {id}，取 {id} 现在的修改计数。", { id: "Q12" }),
  },
  /** 路径和查询参数里的编号和版本号，要写从 1 起的整数。 */
  number: {
    decision: {
      message: copy("决定的编号要写从 1 起的整数，这里是「{text}」。", { text: "abc" }),
      hint: copy("运行 ploop decision list，查看这个项目的决定和编号。"),
    },
    revision: {
      message: copy("主线的修订要写从 1 起的整数，这里是「{text}」。", { text: "abc" }),
      hint: copy("运行 ploop mainline history，查看主线的历次修订。"),
    },
    page: {
      message: copy("页面的编号要写从 1 起的整数，这里是「{text}」。", { text: "abc" }),
      hint: copy("运行 ploop status，查看在等的是哪一页。"),
    },
    draftRevision: {
      message: copy("草稿旧版本的编号要写从 1 起的整数，这里是「{text}」。", { text: "abc" }),
      hint: copy("先列出这一页草稿的旧版本，按列出的编号写。"),
    },
    submission: {
      message: copy("回复的编号要写从 1 起的整数，这里是「{text}」。", { text: "abc" }),
      hint: copy("运行 ploop reply show，查看最近一份回复和它的编号。"),
    },
  } satisfies Record<string, ErrorCopy>,
  /** 附件的接口，见「05 接口」第七节。哈希写在路径里，报错的位置写哈希。 */
  blob: {
    hash: {
      message: copy("附件的哈希要写六十四位小写十六进制，这里是「{text}」。", { text: "abc" }),
      hint: copy("用文件内容的 SHA-256 作哈希，例如运行 shasum -a 256 <文件>。"),
    },
    notFound: {
      message: copy("附件库里没有这个附件。"),
      hint: copy("先用 PUT /api/v1/blobs/<哈希> 上传这个文件。"),
    },
    mismatch: {
      message: copy("上传的内容算出的哈希是 {actual}，和路径里的不同。", {
        actual: "3b1f".repeat(16),
      }),
      hint: copy("按文件的原始字节重新算 SHA-256，用算出的哈希上传。"),
    },
    contentType: {
      message: copy("请求头 Content-Type 是「{value}」，不是文件的类型。", { value: "png" }),
      hint: copy("写文件的类型，例如 image/png。不知道类型时不写这个请求头。"),
    },
    tooLarge: {
      message: copy("附件超过了 {limit} 的上限。", { limit: "50 MB" }),
      hint: copy("把截图压小一些再上传，例如改成 JPEG。"),
    },
  } satisfies Record<string, ErrorCopy>,
  /** 请求里某一项不合定义。位置写进 where，怎么改用 BAD_REQUEST 的默认说明。 */
  field: {
    bodyNotObject: copy("请求体要写成一个 JSON 对象。"),
    /** 接口收的是一组，例如处理回复的各行。 */
    bodyNotArray: copy("请求体要写成一个 JSON 数组。"),
    missing: copy("没有写 {field}。", { field: "repoKind" }),
    type: copy("{field} 要写成{type}。", { field: "root", type: "文字" }),
    value: copy("{field} 写的是「{value}」，可以写的有：{allowed}。", {
      field: "repoKind",
      value: "shared",
      allowed: "自己的、共用的",
    }),
    unknown: copy("不认识的字段：{keys}。", { keys: "stage" }),
    invalid: copy("{field} 的写法不对。", { field: "path" }),
    /** 枚举里的值写错时，输入已经不在问题里，不写出写的是什么，只写可以写的。 */
    oneOf: copy("{field} 的写法不对，可以写的有：{allowed}。", {
      field: "level",
      allowed: "阻塞、建议",
    }),
    /** 几种写法里一种都没对上，又看不出想写哪一种。 */
    union: copy("{fields} 里要写对一种。", { fields: "opinions、skip" }),
  },
  /** 填进 field.type 的类型名。 */
  typeName: {
    string: copy("文字"),
    number: copy("数字"),
    boolean: copy("true 或 false"),
    array: copy("数组"),
    object: copy("对象"),
  },
  /** 没有接住的错误：报错里写明是哪个请求、哪个字段，详情在日志里。 */
  internal: {
    request: copy("{method} {path}", { method: "GET", path: "/api/v1/projects/app/queue/Q1" }),
    field: copy("出错的字段：{field}。", { field: "events.0.to" }),
  },
  notFound: {
    message: copy("没有这个接口：{method} {path}。", {
      method: "DELETE",
      path: "/api/v1/projects/app",
    }),
    hint: copy("检查方法和路径。命令行和后端的版本不同时，运行 ploop setup。"),
  } satisfies ErrorCopy,
  /** 工作台的静态文件不在运行目录里：开发时没有构建，或者安装不完整。 */
  webMissing: {
    message: copy("工作台的文件不在 {dir}。", { dir: "~/.product-loop/app/0.0.1/web" }),
    hint: copy("运行 ploop setup 重新安装。开发时先在 packages/web 里运行 pnpm build。"),
  } satisfies ErrorCopy,
  /** 后端在做别的事，这时不能做这个请求。响应带 Retry-After。 */
  busy: {
    /** 正在做每日快照时请后端退出，见「01 架构」第六节。 */
    snapshot: {
      message: copy("后端正在做今天的数据库快照，现在不能退出。"),
      hint: copy("等快照做完再请后端退出，命令行会按 Retry-After 自动重试。"),
    },
  } satisfies Record<string, ErrorCopy>,
};
