import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { runMigrations } from './migrate';

const logger = new Logger('UsersMain');

function checkRequiredEnv(): void {
  const required = ['JWT_SECRET', 'USERS_DB_URL'];
  const missing = required.filter((name) => {
    const value = process.env[name];
    return value === undefined || value.trim() === '';
  });
  if (missing.length > 0) {
    // 비밀값·DB 주소에 기본값을 두지 않습니다. 없으면 시작을 거부합니다.
    logger.error(`Missing required environment variables: ${missing.join(', ')}`);
    process.exit(1);
  }
}

async function bootstrap(): Promise<void> {
  checkRequiredEnv();

  // DB가 아직 준비되지 않았으면 runMigrations 내부에서 여러 번 기다렸다 다시 시도합니다.
  // 컨테이너 기동 순서상 users-db가 늦게 뜰 수 있으므로 충분히(약 3분) 재시도합니다.
  await runMigrations(90, 2000);

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: ['log', 'warn', 'error'],
  });
  app.disable('x-powered-by');
  app.enableShutdownHooks();

  const parsedPort = Number.parseInt(process.env.PORT ?? '', 10);
  const port = Number.isInteger(parsedPort) && parsedPort > 0 ? parsedPort : 3001;
  await app.listen(port, '0.0.0.0');
  logger.log(`users service listening on 0.0.0.0:${port}`);
}

bootstrap().catch((err: unknown) => {
  const message = err instanceof Error ? err.stack || err.message : String(err);
  logger.error(`users service failed to start: ${message}`);
  process.exit(1);
});
