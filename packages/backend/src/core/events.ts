import { events } from "../store/schema/index.ts";
import type { JsonObject } from "../store/schema/json.ts";
import type { WriteScope } from "./tx.ts";

// 事件：每一次改动记一条，是工作台的事件流的来源，见「03 数据模型」第二节。
// 事件在写事务里写进事件表，事务提交以后才发给订阅者，见「05 接口」第五节。
// 这样订阅者收到事件时，数据已经能读到。回滚的事务不发事件。

/** 执行者：谁发起的这次改动。接口层从请求头取，见「05 接口」第三节。 */
export type Actor = {
  /** 客户端和版本，例如 cli/2.0.0、web/2.0.0。 */
  readonly client: string;
  /** AI 会话的标识。命令行取不到就不带，见约定第 22 条。 */
  readonly session?: string | undefined;
};

/** 用例记一条事件时写的内容。时间和执行者由写事务填。 */
export type EventInput = {
  readonly projectId: string;
  /** 种类，写成 round.started 这样，和事件流里的名字相同。 */
  readonly kind: string;
  /** 改的是哪一类对象，用术语对照表里的英文名，例如 round、queueItem。 */
  readonly objectType: string;
  readonly objectId: string;
  /** 改动内容。不写就是空对象。 */
  readonly detail?: JsonObject | undefined;
};

/** 已经写进事件表的一条事件。订阅者收到的就是它。 */
export type StoredEvent = typeof events.$inferSelect;

/**
 * 在写事务里记一条事件：先写进事件表，事务提交以后再发给订阅者。
 * 事务回滚时，这一行随之撤销，也不会发出。
 */
export function appendEvent(w: WriteScope, input: EventInput): StoredEvent {
  const event = w.tx
    .insert(events)
    .values({
      createdAt: w.now,
      projectId: input.projectId,
      client: w.actor.client,
      session: w.actor.session ?? null,
      kind: input.kind,
      objectType: input.objectType,
      objectId: input.objectId,
      detail: input.detail ?? {},
    })
    .returning()
    .get();
  w.pendingEvents.push(event);
  return event;
}

/** 提交以后的通知。后端里只有一份，事件流订阅它。 */
export type Notifier = {
  /** 订阅提交以后的事件，返回取消订阅的函数。 */
  subscribe(subscriber: (event: StoredEvent) => void): () => void;
  /** 写事务提交以后调用。事件按记下的顺序发给每个订阅者。 */
  publish(committed: readonly StoredEvent[]): void;
};

/**
 * 建一份提交以后的通知。事件按编号从小到大发出。
 * 订阅者在收到事件时又提交了新的事务，新事件排在后面发。
 * 订阅者抛出的错误交给 onSubscriberError，不影响别的订阅者。
 * 数据已经提交，所以这些错误也不影响写入的结果。
 */
export function createNotifier(onSubscriberError: (error: unknown) => void): Notifier {
  const subscribers = new Set<(event: StoredEvent) => void>();
  const queue: StoredEvent[] = [];
  let sending = false;
  return {
    subscribe(subscriber) {
      subscribers.add(subscriber);
      return () => {
        subscribers.delete(subscriber);
      };
    },
    publish(committed) {
      queue.push(...committed);
      if (sending) return;
      sending = true;
      try {
        for (let event = queue.shift(); event !== undefined; event = queue.shift()) {
          for (const subscriber of subscribers) {
            try {
              subscriber(event);
            } catch (error) {
              onSubscriberError(error);
            }
          }
        }
      } finally {
        sending = false;
      }
    },
  };
}
