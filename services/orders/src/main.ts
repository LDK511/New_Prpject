import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import express, { NextFunction, Request, Response } from 'express';
import { createHmac } from 'crypto';
import { requireEnv } from './auth/jwt-auth.guard';
import { runMigrations } from './migrate';

const logger = new Logger('OrdersMain');

const WEBHOOK_PATH = '/webhooks/payment';

function checkEnv(): void {
  // 필수 비밀값과 접속 주소는 기본값 없이 반드시 환경 변수로 받습니다.
  // requireEnv 는 값이 없으면 process.exit(1) 로 시작을 거부합니다.
  const required = [
    'ORDERS_DB_URL',
    'JWT_SECRET',
    'REDIS_URL',
    'PRODUCTS_URL',
    'MOCK_PAYMENT_URL',
  ];
  for (const name of required) {
    const value = process.env[name];
    if (!value || value.trim() === '') {
      // eslint-disable-next-line no-console
      console.error(`[orders] Missing required environment variable: ${name}`);
      process.exit(1);
    }
    requireEnv(name);
  }

  // 웹훅 서명 키가 따로 주어지지 않으면 JWT_SECRET 에서 용도 분리된 키를 파생합니다.
  // (고정 기본값이 아니라 필수 비밀값에서 HMAC 으로 파생하므로 비밀값 없이 시작되지 않습니다.)
  const webhookSecret = process.env.PAYMENT_WEBHOOK_SECRET;
  if (!webhookSecret || webhookSecret.trim() === '') {
    const jwtSecret = requireEnv('JWT_SECRET');
    process.env.PAYMENT_WEBHOOK_SECRET = createHmac('sha256', jwtSecret)
      .update('payment-webhook-signing-key')
      .digest('hex');
    logger.warn('PAYMENT_WEBHOOK_SECRET not set; derived webhook signing key from JWT_SECRET. Set it explicitly in production.');
  }

  if (process.env.NODE_ENV === 'production' && process.env.PAYMENT_MODE === 'mock') {
    logger.warn('PAYMENT_MODE=mock is ignored in production; POST /orders/:id/pay will return 503.');
  }
}

process.on('unhandledRejection', (reason) => {
  logger.error(`Unhandled rejection: ${reason instanceof Error ? reason.stack ?? reason.message : String(reason)}`);
});

async function bootstrap(): Promise<void> {
  checkEnv();

  // 서비스 전용 DB(orders-db)에 Prisma Migrate 적용. DB 준비 전이면 재시도합니다.
  await runMigrations();

  // 환경 변수 준비 후에 모듈을 불러옵니다(모듈 로드 시점에 환경 변수를 읽는 경우 대비).
  const { AppModule } = await import('./app.module');

  // 웹훅 서명 검증을 위해 raw body 가 필요하므로 기본 body parser 를 끕니다.
  const app = await NestFactory.create(AppModule, { bodyParser: false });

  // 1) 웹훅 경로: raw body(Buffer) 파서를 JSON 파서보다 먼저 등록
  app.use(WEBHOOK_PATH, express.raw({ type: '*/*', limit: '256kb' }));

  // 2) 나머지 경로: JSON 파서 (웹훅 경로는 건너뜀)
  const jsonParser = express.json({ limit: '100kb' });
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.path === WEBHOOK_PATH || req.originalUrl.split('?')[0] === WEBHOOK_PATH) {
      next();
      return;
    }
    jsonParser(req, res, next);
  });

  app.enableShutdownHooks();

  const port = Number(process.env.PORT || 3003);
  await app.listen(port, '0.0.0.0');
  logger.log(`orders service listening on 0.0.0.0:${port}`);
}

bootstrap().catch((err: unknown) => {
  logger.error(`Failed to start orders service: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
  process.exit(1);
});
