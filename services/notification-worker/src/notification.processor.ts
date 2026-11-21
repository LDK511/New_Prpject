import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Job, Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { boolEnv, intEnv, requireEnv } from './config';
import { handleOrderPaid } from './notification-handler';
import {
  ORDER_NOTIFICATION_DLQ,
  ORDER_NOTIFICATION_QUEUE,
  ORDER_PAID_JOB,
  OrderPaidJobData,
} from './queue';

function log(obj: Record<string, unknown>): void {
  console.log(JSON.stringify(obj));
}

function logError(obj: Record<string, unknown>): void {
  console.error(JSON.stringify(obj));
}

function createConnection(url: string, name: string): IORedis {
  const conn = new IORedis(url, { maxRetriesPerRequest: null, enableReadyCheck: true });
  conn.on('error', (err: Error) => {
    logError({ event: 'redis_error', connection: name, message: err.message });
  });
  return conn;
}

@Injectable()
export class NotificationProcessor implements OnModuleInit, OnModuleDestroy {
  private worker: Worker<OrderPaidJobData, string> | null = null;
  private dlq: Queue | null = null;
  private workerConn: IORedis | null = null;
  private queueConn: IORedis | null = null;
  private closing: Promise<void> | null = null;
  private readonly onSigterm = (): void => {
    void this.shutdown().then(() => {
      if (process.listenerCount('SIGTERM') === 0) {
        process.exit(0);
      }
    });
  };

  onModuleInit(): void {
    const redisUrl = requireEnv('REDIS_URL');
    const forceFail = boolEnv('NOTIFY_FORCE_FAIL', false);
    const concurrency = intEnv('NOTIFY_CONCURRENCY', 5);

    this.workerConn = createConnection(redisUrl, 'worker');
    this.queueConn = createConnection(redisUrl, 'dlq');

    this.dlq = new Queue(ORDER_NOTIFICATION_DLQ, { connection: this.queueConn });
    this.dlq.on('error', (err: Error) => {
      logError({ event: 'dlq_queue_error', message: err.message });
    });

    this.worker = new Worker<OrderPaidJobData, string>(
      ORDER_NOTIFICATION_QUEUE,
      async (job: Job<OrderPaidJobData, string>) => {
        if (job.name !== ORDER_PAID_JOB) {
          log({ event: 'order_notification_skipped', jobId: job.id ?? null, name: job.name });
          return 'skipped';
        }
        return handleOrderPaid(job.data, {
          forceFail,
          jobId: job.id,
          attempt: job.attemptsMade + 1,
        });
      },
      { connection: this.workerConn, concurrency },
    );

    this.worker.on('completed', (job: Job<OrderPaidJobData, string>) => {
      log({ event: 'order_notification_completed', jobId: job.id ?? null, orderId: job.data?.orderId ?? null });
    });

    this.worker.on('failed', (job: Job<OrderPaidJobData, string> | undefined, err: Error) => {
      void this.handleFailed(job, err);
    });

    this.worker.on('error', (err: Error) => {
      logError({ event: 'worker_error', message: err.message });
    });

    process.once('SIGTERM', this.onSigterm);

    log({
      event: 'notification_worker_started',
      queue: ORDER_NOTIFICATION_QUEUE,
      concurrency,
      forceFail,
    });
  }

  private async handleFailed(job: Job<OrderPaidJobData, string> | undefined, err: Error): Promise<void> {
    try {
      if (!job) {
        logError({ event: 'order_notification_failed', orderId: null, reason: err?.message ?? 'unknown' });
        return;
      }
      const maxAttempts = job.opts.attempts ?? 1;
      const reason = err?.message ?? job.failedReason ?? 'unknown';
      if (job.attemptsMade < maxAttempts) {
        log({
          event: 'order_notification_retry',
          orderId: job.data?.orderId ?? null,
          jobId: job.id ?? null,
          attemptsMade: job.attemptsMade,
          maxAttempts,
          reason,
        });
        return;
      }
      logError({
        event: 'order_notification_failed',
        orderId: job.data?.orderId ?? null,
        jobId: job.id ?? null,
        attemptsMade: job.attemptsMade,
        reason,
      });
      if (this.dlq) {
        await this.dlq.add(
          ORDER_PAID_JOB,
          {
            ...job.data,
            originalJobId: job.id ?? null,
            attemptsMade: job.attemptsMade,
            failedReason: reason,
            failedAt: new Date().toISOString(),
          },
          { jobId: `dlq-${job.id ?? 'unknown'}`, removeOnComplete: false, removeOnFail: false },
        );
      }
    } catch (e) {
      logError({
        event: 'order_notification_dlq_error',
        jobId: job?.id ?? null,
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }

  private shutdown(): Promise<void> {
    if (!this.closing) {
      this.closing = (async () => {
        try {
          if (this.worker) await this.worker.close();
        } catch (e) {
          logError({ event: 'worker_close_error', message: e instanceof Error ? e.message : String(e) });
        }
        try {
          if (this.dlq) await this.dlq.close();
        } catch (e) {
          logError({ event: 'dlq_close_error', message: e instanceof Error ? e.message : String(e) });
        }
        for (const conn of [this.workerConn, this.queueConn]) {
          if (!conn) continue;
          try {
            await conn.quit();
          } catch {
            conn.disconnect();
          }
        }
        log({ event: 'notification_worker_stopped' });
      })();
    }
    return this.closing;
  }

  async onModuleDestroy(): Promise<void> {
    process.removeListener('SIGTERM', this.onSigterm);
    await this.shutdown();
  }
}
