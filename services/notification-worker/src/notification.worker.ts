import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Job, JobsOptions, Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { MailerService, OrderPaidEvent } from './mailer.service';

export const NOTIFICATION_QUEUE = 'order-notifications';
export const NOTIFICATION_DLQ = 'order-notifications-dlq';

export function maxAttempts(): number {
  const n = Number(process.env.NOTIFY_MAX_ATTEMPTS || 5);
  return Number.isInteger(n) && n > 0 ? n : 5;
}

export function backoffDelayMs(): number {
  const n = Number(process.env.NOTIFY_BACKOFF_MS || 2000);
  return Number.isFinite(n) && n >= 0 ? n : 2000;
}

/** order-paid 잡 등록 옵션(스트림 소비자와 공유) */
export function notificationJobOptions(orderId: string): JobsOptions {
  return {
    jobId: `order-paid-${orderId}`,
    attempts: maxAttempts(),
    backoff: { type: 'exponential', delay: backoffDelayMs() },
    removeOnComplete: 1000,
    removeOnFail: false,
  };
}

export function createRedisConnection(): IORedis {
  const url = process.env.REDIS_URL;
  if (!url) {
    throw new Error('REDIS_URL is required');
  }
  const conn = new IORedis(url, { maxRetriesPerRequest: null, enableReadyCheck: true });
  conn.on('error', (err: Error) => {
    new Logger('Redis').error(`Redis 연결 오류: ${err.message}`);
  });
  return conn;
}

@Injectable()
export class NotificationWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NotificationWorker.name);
  private worker?: Worker<OrderPaidEvent>;
  private dlq?: Queue;
  private workerConn?: IORedis;
  private dlqConn?: IORedis;

  constructor(private readonly mailer: MailerService) {}

  onModuleInit(): void {
    this.workerConn = createRedisConnection();
    this.dlqConn = createRedisConnection();
    this.dlq = new Queue(NOTIFICATION_DLQ, { connection: this.dlqConn });

    this.worker = new Worker<OrderPaidEvent>(
      NOTIFICATION_QUEUE,
      async (job: Job<OrderPaidEvent>) => this.process(job),
      { connection: this.workerConn, concurrency: 5 },
    );

    this.worker.on('completed', (job: Job<OrderPaidEvent>) => {
      this.logger.log(`잡 완료: ${String(job.id)} (시도 ${job.attemptsMade}회)`);
    });

    this.worker.on('failed', (job: Job<OrderPaidEvent> | undefined, err: Error) => {
      void this.onFailed(job, err);
    });

    this.worker.on('error', (err: Error) => {
      this.logger.error(`워커 오류: ${err.message}`);
    });

    this.logger.log(
      `큐 "${NOTIFICATION_QUEUE}" 처리 시작 (최대 ${maxAttempts()}회, 지수 백오프 ${backoffDelayMs()}ms)`,
    );
  }

  private async process(job: Job<OrderPaidEvent>): Promise<void> {
    const attempt = job.attemptsMade + 1;
    const total = job.opts.attempts ?? 1;
    this.logger.log(`메일 발송 시도 ${attempt}/${total}: job=${String(job.id)} order=${job.data?.orderId}`);
    try {
      await this.mailer.sendOrderPaid(job.data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`메일 발송 실패 ${attempt}/${total}: job=${String(job.id)} 이유=${msg}`);
      throw err instanceof Error ? err : new Error(msg);
    }
  }

  private async onFailed(job: Job<OrderPaidEvent> | undefined, err: Error): Promise<void> {
    if (!job) {
      this.logger.error(`잡 실패(잡 정보 없음): ${err.message}`);
      return;
    }
    const total = job.opts.attempts ?? 1;
    if (job.attemptsMade < total) {
      this.logger.warn(`재시도 예정: job=${String(job.id)} (${job.attemptsMade}/${total})`);
      return;
    }
    // 최종 실패: 원래 잡은 failed 상태로 남기고(removeOnFail:false), DLQ에 사본을 보관합니다.
    // 주문 상태는 절대 바꾸지 않습니다.
    this.logger.error(
      `최종 실패: job=${String(job.id)} order=${job.data?.orderId} 시도 ${job.attemptsMade}회 이유=${err.message}`,
    );
    try {
      await this.dlq?.add(
        'dead',
        { ...job.data, failedReason: err.message, attemptsMade: job.attemptsMade },
        { jobId: `dead-${String(job.id)}`, removeOnComplete: false, removeOnFail: false },
      );
      this.logger.warn(`DLQ "${NOTIFICATION_DLQ}" 에 보관: job=${String(job.id)}`);
    } catch (dlqErr) {
      const msg = dlqErr instanceof Error ? dlqErr.message : String(dlqErr);
      this.logger.error(`DLQ 보관 실패: job=${String(job.id)} 이유=${msg}`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    try {
      await this.worker?.close();
      await this.dlq?.close();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`종료 중 오류: ${msg}`);
    }
    this.workerConn?.disconnect();
    this.dlqConn?.disconnect();
  }
}
