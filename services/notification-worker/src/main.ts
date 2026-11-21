import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { INestApplicationContext } from '@nestjs/common';
import { AppModule } from './app.module';
import { requireEnv } from './config';

const BOOTSTRAP_RETRY_MS = 5000;

process.on('unhandledRejection', (reason: unknown) => {
  console.error(
    JSON.stringify({
      event: 'unhandled_rejection',
      reason: reason instanceof Error ? reason.message : String(reason),
    }),
  );
});

process.on('uncaughtException', (err: Error) => {
  console.error(JSON.stringify({ event: 'uncaught_exception', reason: err.message }));
});

let app: INestApplicationContext | null = null;
let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(JSON.stringify({ event: 'worker_shutdown', signal }));
  try {
    // app.close() 가 NotificationProcessor.onModuleDestroy 를 호출해 worker.close() 를 수행합니다.
    if (app) await app.close();
  } catch (err) {
    console.error(
      JSON.stringify({
        event: 'worker_shutdown_error',
        reason: err instanceof Error ? err.message : String(err),
      }),
    );
  }
  process.exit(0);
}

process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});
process.on('SIGINT', () => {
  void shutdown('SIGINT');
});

async function bootstrap(): Promise<void> {
  // 필수 환경 변수 확인 — 없으면 requireEnv 가 에러 로그 후 exit 1
  requireEnv('REDIS_URL');

  try {
    app = await NestFactory.createApplicationContext(AppModule);
    console.log(JSON.stringify({ event: 'worker_started' }));
  } catch (err) {
    console.error(
      JSON.stringify({
        event: 'worker_bootstrap_failed',
        reason: err instanceof Error ? err.message : String(err),
        retryInMs: BOOTSTRAP_RETRY_MS,
      }),
    );
    if (!shuttingDown) {
      setTimeout(() => {
        void bootstrap();
      }, BOOTSTRAP_RETRY_MS);
    }
  }
}

void bootstrap();
