import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { createServer, IncomingMessage, ServerResponse } from 'http';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { intEnv, requireEnv } from './config';

async function bootstrap(): Promise<void> {
  // 필수 환경 변수 확인 — 없으면 requireEnv 가 에러 로그 후 종료합니다(기본값 없음).
  requireEnv('JWT_SECRET');
  requireEnv('USERS_DB_URL');

  const port = intEnv('PORT', 3001);

  // 기본 JSON/urlencoded 파서를 사용합니다.
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.disable('x-powered-by');
  app.useBodyParser('json', { limit: '100kb' });
  app.useBodyParser('urlencoded', { limit: '100kb', extended: false });

  // Content-Type 이 아예 없는 요청 본문은 JSON 으로 해석합니다(최대 100kb).
  const MAX_BODY = 100 * 1024;
  type BodyReq = IncomingMessage & { body?: unknown };
  type BodyRes = ServerResponse;
  app.use((req: BodyReq, res: BodyRes, next: (err?: unknown) => void): void => {
    const method = (req.method ?? 'GET').toUpperCase();
    if (
      req.headers['content-type'] !== undefined ||
      method === 'GET' ||
      method === 'HEAD' ||
      req.body !== undefined
    ) {
      next();
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    let aborted = false;
    req.on('data', (chunk: Buffer) => {
      if (aborted) return;
      size += chunk.length;
      if (size > MAX_BODY) {
        aborted = true;
        res.statusCode = 413;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ statusCode: 413, message: 'Payload too large' }));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (aborted) return;
      const text = Buffer.concat(chunks).toString('utf8').trim();
      if (text === '') {
        next();
        return;
      }
      try {
        req.body = JSON.parse(text) as unknown;
        next();
      } catch {
        res.statusCode = 400;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ statusCode: 400, message: 'Invalid JSON body' }));
      }
    });
    req.on('error', (err: Error) => {
      if (!aborted) next(err);
    });
  });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.enableShutdownHooks();

  await app.listen(port, '0.0.0.0');
  Logger.log(`users service listening on 0.0.0.0:${port}`, 'Bootstrap');

  // Node 17+ 에서 'localhost' 가 ::1 로 먼저 풀리므로, 컨테이너 헬스 체크가
  // localhost 로 접속해도 응답하도록 IPv6 루프백에도 같은 앱을 연결합니다.
  // IPv6 가 없는 환경이면 경고만 남기고 IPv4 리스너로 계속 동작합니다.
  const loopback6 = createServer(app.getHttpAdapter().getInstance());
  loopback6.on('error', (err: Error) => {
    Logger.warn(`IPv6 loopback listener unavailable: ${err.message}`, 'Bootstrap');
  });
  loopback6.listen(port, '::1', () => {
    Logger.log(`users service also listening on [::1]:${port}`, 'Bootstrap');
  });
  const closeLoopback = (): void => {
    loopback6.close();
  };
  process.once('SIGTERM', closeLoopback);
  process.once('SIGINT', closeLoopback);
}

bootstrap().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`users service failed to start: ${message}`);
  process.exit(1);
});
