import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { JobsOptions, Queue } from 'bullmq';
import * as os from 'os';

/** 주문 서비스가 발행하는 order.paid 이벤트(orders/src/events/event-publisher.ts 와 같은 모양) */
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
export const CONSUMER_GROUP = 'notification-worker';
export const NOTIFICATION_QUEUE = 'order-notifications';

type StreamEntry = [string, string[] | null];
type XReadGroupReply = [string, StreamEntry[]][] | null;

function positiveInt(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isOrderPaidEvent(v: unknown): v is OrderPaidEvent {
  if (!v || typeof v !== 'object') return false;
  const e = v as Record<string, unknown>;
  return (
    typeof e.orderId === 'string' &&
    e.orderId.length > 0 &&
    typeof e.userId === 'string' &&
    typeof e.email === 'string' &&
    e.email.includes('@') &&
    typeof e.totalAmount === 'number' &&
    Number.isInteger(e.totalAmount) &&
    typeof e.currency === 'string' &&
    Array.isArray(e.items) &&
    typeof e.paidAt === 'string'
  );
}

@Injectable()
export class StreamConsumerService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(StreamConsumerService.name);
  private readonly redisUrl: string;
  private readonly consumerName = `worker-${os.hostname()}-${process.pid}`;
  private readonly maxAttempts = positiveInt(process.env.NOTIFY_MAX_ATTEMPTS, 5);
  private readonly backoffMs = positiveInt(process.env.NOTIFY_BACKOFF_MS, 2000);

  private reader!: Redis;
  private queueConnection!: Redis;
  private queue!: Queue;
  private stopping = false;
  private loop: Promise<void> | null = null;

  constructor() {
    const url = process.env.REDIS_URL;
    if (!url) {
      throw new Error('REDIS_URL is required');
    }
    this.redisUrl = url;
  }

  onApplicationBootstrap(): void {
    // 스트림 읽기(BLOCK)용 연결과 BullMQ 큐용 연결을 분리합니다.
    this.reader = new Redis(this.redisUrl, { maxRetriesPerRequest: null });
    this.queueConnection = new Redis(this.redisUrl, { maxRetriesPerRequest: null });
    this.reader.on('error', (err: Error) => this.logger.warn(`redis(reader) error: ${err.message}`));
    this.queueConnection.on('error', (err: Error) => this.logger.warn(`redis(queue) error: ${err.message}`));

    this.queue = new Queue(NOTIFICATION_QUEUE, { connection: this.queueConnection });
    this.queue.on('error', (err: Error) => this.logger.warn(`queue error: ${err.message}`));

    this.loop = this.run().catch((err: unknown) => {
      this.logger.error(`stream consumer stopped unexpectedly: ${String(err)}`);
    });
    this.logger.log(`consuming ${ORDER_EVENTS_STREAM} as ${CONSUMER_GROUP}/${this.consumerName}`);
  }

  async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    try {
      this.reader?.disconnect();
    } catch {
      /* ignore */
    }
    if (this.loop) {
      await Promise.race([this.loop, sleep(6000)]);
    }
    try {
      await this.queue?.close();
    } catch {
      /* ignore */
    }
    try {
      await this.queueConnection?.quit();
    } catch {
      /* ignore */
    }
  }

  private async ensureGroup(): Promise<void> {
    try {
      await this.reader.call('XGROUP', 'CREATE', ORDER_EVENTS_STREAM, CONSUMER_GROUP, '0', 'MKSTREAM');
      this.logger.log(`consumer group ${CONSUMER_GROUP} created`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes('BUSYGROUP')) throw err;
    }
  }

  private async run(): Promise<void> {
    let groupReady = false;
    // 처음에는 이전에 받았지만 ACK 하지 못한 메시지("0")부터 처리하고, 비면 새 메시지(">")로 넘어갑니다.
    let lastId = '0';

    while (!this.stopping) {
      try {
        if (!groupReady) {
          await this.ensureGroup();
          groupReady = true;
        }

        const reply = (await this.reader.call(
          'XREADGROUP',
          'GROUP',
          CONSUMER_GROUP,
          this.consumerName,
          'COUNT',
          '20',
          'BLOCK',
          '5000',
          'STREAMS',
          ORDER_EVENTS_STREAM,
          lastId,
        )) as XReadGroupReply;

        if (!reply || reply.length === 0) continue;

        let hadFailure = false;
        let entryCount = 0;
        for (const [, entries] of reply) {
          entryCount += entries.length;
          for (const [id, fields] of entries) {
            const ok = await this.handleEntry(id, fields);
            if (!ok) hadFailure = true;
          }
        }

        if (lastId === '0' && entryCount === 0) {
          lastId = '>';
        }
        if (hadFailure) {
          // 실패한 메시지는 ACK 하지 않았으므로 잠시 뒤 대기 목록("0")부터 다시 처리합니다.
          lastId = '0';
          await sleep(2000);
        }
      } catch (err) {
        if (this.stopping) break;
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('NOGROUP')) groupReady = false;
        this.logger.warn(`stream read failed, retrying in 2s: ${msg}`);
        lastId = '0';
        await sleep(2000);
      }
    }
  }

  /** true: 처리 완료(ACK 함), false: 일시 실패(ACK 안 함, 나중에 재시도) */
  private async handleEntry(id: string, fields: string[] | null): Promise<boolean> {
    if (!fields) {
      // 스트림에서 이미 삭제된 대기 메시지 — 더 처리할 수 없으므로 ACK 합니다.
      await this.ack(id);
      return true;
    }

    const map: Record<string, string> = {};
    for (let i = 0; i + 1 < fields.length; i += 2) {
      map[fields[i]] = fields[i + 1];
    }

    if (map.type !== 'order.paid') {
      await this.ack(id);
      return true;
    }

    let event: unknown;
    try {
      event = JSON.parse(map.data ?? '');
    } catch {
      this.logger.error(`invalid JSON in stream entry ${id}; acknowledging and skipping`);
      await this.ack(id);
      return true;
    }
    if (!isOrderPaidEvent(event)) {
      this.logger.error(`malformed order.paid event in stream entry ${id}; acknowledging and skipping`);
      await this.ack(id);
      return true;
    }

    const opts: JobsOptions = {
      jobId: `order-paid-${event.orderId}`,
      attempts: this.maxAttempts,
      backoff: { type: 'exponential', delay: this.backoffMs },
      removeOnComplete: 1000,
      removeOnFail: false,
    };

    try {
      await this.queue.add('order-paid', event, opts);
      this.logger.log(`queued notification job order-paid-${event.orderId} (stream ${id})`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`failed to enqueue job for order ${event.orderId}: ${msg}`);
      return false;
    }

    try {
      await this.ack(id);
    } catch (err) {
      // jobId로 중복이 막히므로 다음 재처리에서 다시 ACK 하면 됩니다.
      this.logger.warn(`XACK failed for ${id}: ${String(err)}`);
      return false;
    }
    return true;
  }

  private async ack(id: string): Promise<void> {
    await this.reader.call('XACK', ORDER_EVENTS_STREAM, CONSUMER_GROUP, id);
  }
}
