import 'reflect-metadata';
import * as http from 'http';
import { Logger, type INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

const logger = new Logger('NotificationWorker');

// 오류가 나도 프로세스를 끝내지 않고 기록만 남깁니다(재시도는 각 서비스/BullMQ가 담당).
process.on('unhandledRejection', (reason: unknown) => {
  const msg = reason instanceof Error ? reason.stack ?? reason.message : String(reason);
  logger.error(`unhandledRejection: ${msg}`);
});
process.on('uncaughtException', (err: Error) => {
  logger.error(`uncaughtException: ${err.stack ?? err.message}`);
});

function checkEnv(): void {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl || redisUrl.trim() === '') {
    logger.error('Missing required environment variable: REDIS_URL');
    process.exit(1);
  }
  if (!process.env.SMTP_HOST) {
    logger.warn('SMTP_HOST is not set; mail delivery will fail and jobs will be retried');
  }
  if (!process.env.MAIL_FROM) {
    logger.warn('MAIL_FROM is not set; the mailer default sender will be used');
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let app: INestApplicationContext | null = null;
let shuttingDown = false;
let ready = false;

// 헬스체크용 HTTP 서버: 0.0.0.0:PORT 에서 GET /health 를 제공합니다.
// Redis 연결(앱 컨텍스트 초기화)이 끝난 뒤에만 200을 반환합니다.
const port = Number(process.env.PORT) || 3000;
const healthServer = http.createServer((req, res) => {
  const url = (req.url ?? '').split('?')[0];
  if (req.method === 'GET' && url === '/health') {
    const body = JSON.stringify({ status: ready ? 'ok' : 'starting', service: 'notification-worker' });
    res.writeHead(ready ? 200 : 503, { 'Content-Type': 'application/json' });
    res.end(body);
    return;
  }
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ message: 'Not Found' }));
});

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.log(`Received ${signal}, shutting down notification worker...`);
  ready = false;
  healthServer.close();
  try {
    if (app) await app.close();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`Error during shutdown: ${msg}`);
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
  checkEnv();

  healthServer.listen(port, '0.0.0.0', () => {
    logger.log(`Health endpoint listening on 0.0.0.0:${port}/health`);
  });

  let attempt = 0;
  // 시작 실패(예: Redis 미준비) 시 종료하지 않고 지연 후 다시 시도합니다.
  while (!shuttingDown) {
    attempt += 1;
    try {
      app = await NestFactory.createApplicationContext(AppModule, {
        logger: ['log', 'error', 'warn'],
      });
      await app.init();
      ready = true;
      logger.log('Notification worker started (stream events:orders -> queue order-notifications)');
      break;
    } catch (err) {
      const msg = err instanceof Error ? err.stack ?? err.message : String(err);
      logger.error(`Worker bootstrap failed (attempt ${attempt}): ${msg}`);
      if (app) {
        try {
          await app.close();
        } catch {
          // 무시: 다음 시도에서 새로 만듭니다.
        }
        app = null;
      }
      const delay = Math.min(30000, 2000 * attempt);
      await sleep(delay);
    }
  }

  // 이벤트 루프를 유지해 HTTP 서버 없이도 프로세스가 계속 돌게 합니다.
  setInterval(() => {
    /* keep-alive */
  }, 60_000);
}

void bootstrap();
