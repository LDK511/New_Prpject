import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { loadConfig } from './config';

async function bootstrap(): Promise<void> {
  // PORT, JWT_SECRET 만으로 시작합니다. PAYMENT_MODE 가 mock 이외 값이면 시작을 거절합니다.
  const config = loadConfig(process.env);

  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(config));
  app.disable('x-powered-by');
  app.useBodyParser('json', { limit: '32kb' });
  app.enableShutdownHooks();

  await app.listen(config.port, '0.0.0.0');
  console.log(
    `mock-payment listening on 0.0.0.0:${config.port} (test mode, forceFail=${config.forceFail}, delayMs=${config.delayMs})`,
  );
}

bootstrap().catch((err: unknown) => {
  console.error('mock-payment failed to start:', err instanceof Error ? err.message : err);
  process.exit(1);
});
