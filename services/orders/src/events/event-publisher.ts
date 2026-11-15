import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { requireEnv } from '../auth/jwt-auth.guard';

export interface OrderPaidEvent {
  orderId: string;
  userId: string;
  email: string;
  totalAmount: number;
  currency: string;
  items: { productName: string; quantity: number; unitPrice: number; lineTotal: number }[];
  paidAt: string;
}

export const ORDER_EVENTS_STREAM = 'events:orders';

/**
 * Redis Stream(events:orders)에 주문 이벤트를 발행합니다.
 * 알림 워커가 consumer group 으로 읽어 BullMQ 큐에 잡을 등록합니다.
 */
@Injectable()
export class EventPublisher implements OnModuleDestroy {
  private readonly logger = new Logger(EventPublisher.name);
  private readonly redis: Redis;

  constructor() {
    const url = requireEnv('REDIS_URL');
    this.redis = new Redis(url, {
      maxRetriesPerRequest: 3,
      enableOfflineQueue: true,
      retryStrategy: (times: number) => Math.min(times * 500, 5000),
    });
    this.redis.on('error', (err: Error) => {
      this.logger.warn(`Redis error: ${err.message}`);
    });
  }

  async publishOrderPaid(e: OrderPaidEvent): Promise<void> {
    const data = JSON.stringify(e);
    await this.redis.call(
      'XADD',
      ORDER_EVENTS_STREAM,
      'MAXLEN',
      '~',
      '10000',
      '*',
      'type',
      'order.paid',
      'data',
      data,
    );
    this.logger.log(`order.paid published for order ${e.orderId}`);
  }

  async ping(): Promise<boolean> {
    let timer: NodeJS.Timeout | undefined;
    try {
      const timeout = new Promise<string>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('redis ping timeout')), 2000);
      });
      const res = await Promise.race([this.redis.ping(), timeout]);
      return res === 'PONG';
    } catch {
      return false;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async onModuleDestroy(): Promise<void> {
    try {
      await this.redis.quit();
    } catch {
      this.redis.disconnect();
    }
  }
}
