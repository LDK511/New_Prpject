import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import type IORedis from 'ioredis';
import { intEnv, requireEnv } from '../config';
import { createRedis } from '../redis';
import { ORDER_NOTIFICATION_QUEUE, ORDER_PAID_JOB, OrderPaidJobData } from './queue';

const PING_TIMEOUT_MS = 2000;

@Injectable()
export class NotificationProducer implements OnModuleDestroy {
  private readonly logger = new Logger(NotificationProducer.name);
  private readonly redis: IORedis;
  private readonly queue: Queue<OrderPaidJobData>;
  private readonly attempts: number;
  private readonly backoffMs: number;

  constructor() {
    const url = requireEnv('REDIS_URL');
    this.attempts = intEnv('NOTIFY_ATTEMPTS', 5);
    this.backoffMs = intEnv('NOTIFY_BACKOFF_MS', 1000);
    this.redis = createRedis(url);
    this.queue = new Queue<OrderPaidJobData>(ORDER_NOTIFICATION_QUEUE, {
      connection: this.redis,
    });
    this.queue.on('error', (err: Error) => {
      this.logger.error(`Notification queue error: ${err.message}`);
    });
  }

  async enqueueOrderPaid(data: OrderPaidJobData): Promise<void> {
    // jobId 로 같은 주문의 알림 중복 등록을 막습니다(':' 사용 금지).
    await this.queue.add(ORDER_PAID_JOB, data, {
      jobId: `order-paid-${data.orderId}`,
      attempts: this.attempts,
      backoff: { type: 'exponential', delay: this.backoffMs },
      removeOnComplete: { count: 1000 },
      removeOnFail: false,
    });
    this.logger.log(
      JSON.stringify({ event: 'order_notification_enqueued', orderId: data.orderId }),
    );
  }

  async ping(): Promise<boolean> {
    if (this.redis.status !== 'ready') {
      return false;
    }
    let timer: NodeJS.Timeout | undefined;
    try {
      const timeout = new Promise<string>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('Redis ping timeout')), PING_TIMEOUT_MS);
      });
      const result = await Promise.race([this.redis.ping(), timeout]);
      return result === 'PONG';
    } catch {
      return false;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async onModuleDestroy(): Promise<void> {
    try {
      await this.queue.close();
    } catch (err) {
      this.logger.error(`Failed to close queue: ${(err as Error).message}`);
    }
    try {
      await this.redis.quit();
    } catch {
      this.redis.disconnect();
    }
  }
}
