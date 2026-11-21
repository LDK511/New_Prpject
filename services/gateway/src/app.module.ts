import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { GatewayController } from './proxy/gateway.controller';
import { ProxyService } from './proxy/proxy.service';
import { LoginRateLimiter } from './rate-limit/login-rate-limiter';
import { intEnv } from './config';

@Module({
  controllers: [HealthController, GatewayController],
  providers: [
    ProxyService,
    {
      provide: LoginRateLimiter,
      useFactory: (): LoginRateLimiter =>
        new LoginRateLimiter({
          maxPerKey: intEnv('LOGIN_MAX_ATTEMPTS', 5),
          maxPerIp: intEnv('LOGIN_MAX_ATTEMPTS_PER_IP', 20),
          windowSec: intEnv('LOGIN_WINDOW_SECONDS', 900),
        }),
    },
  ],
})
export class AppModule {}
