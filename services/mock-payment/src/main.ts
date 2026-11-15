import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { loadConfig } from './config';

async function bootstrap(): Promise<void> {
  // 모듈을 만들기 전에 환경을 확인합니다(production·비 mock 모드·비밀값 누락이면 종료).
  const config = loadConfig();
  const app = await NestFactory.create(AppModule, { logger: ['log', 'warn', 'error'] });
  app.enableShutdownHooks();
  // NODE_ENV=test 여도 반드시 포트를 엽니다.
  await app.listen(config.port, '0.0.0.0');
  new Logger('Bootstrap').log(`mock-payment listening on :${config.port} (PAYMENT_MODE=mock, test only)`);
}

bootstrap().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error('[mock-payment] failed to start', err);
  process.exit(1);
});
