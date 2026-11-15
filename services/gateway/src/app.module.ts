import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { ProxyController } from './proxy.controller';
import { LoginRateLimiter } from './rate-limiter';

// 컨트롤러 순서가 중요합니다: /health 를 먼저 처리하고, 나머지 모든 경로는 ProxyController(@All('*path'))가 받습니다.
@Module({
  controllers: [HealthController, ProxyController],
  providers: [LoginRateLimiter],
})
export class AppModule {}
