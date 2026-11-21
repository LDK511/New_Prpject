import { Controller, Get, Logger, OnModuleDestroy, Res } from '@nestjs/common';
import type { Response } from 'express';
import type IORedis from 'ioredis';
import { PrismaService } from './prisma.service';
import { createRedis } from './redis';
import { requireEnv } from './config';

const REDIS_PING_TIMEOUT_MS = 2000;

@Controller()
export class HealthController implements OnModuleDestroy {
  private readonly logger = new Logger(HealthController.name);
  private readonly redis: IORedis;

  constructor(private readonly prisma: PrismaService) {
    this.redis = createRedis(requireEnv('REDIS_URL'));
  }

  @Get('health')
  async health(@Res({ passthrough: true }) res: Response): Promise<{ status: 'ok' | 'error' }> {
    const [dbOk, redisOk] = await Promise.all([this.checkDb(), this.checkRedis()]);
    if (dbOk && redisOk) {
      res.status(200);
      return { status: 'ok' };
    }
    res.status(503);
    return { status: 'error' };
  }

  private async checkDb(): Promise<boolean> {
    try {
      return await this.prisma.isHealthy();
    } catch {
      return false;
    }
  }

  private async checkRedis(): Promise<boolean> {
    if (this.redis.status !== 'ready') {
      return false;
    }
    let timer: NodeJS.Timeout | undefined;
    try {
      const timeout = new Promise<string>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('Redis ping timeout')), REDIS_PING_TIMEOUT_MS);
      });
      const reply = await Promise.race([this.redis.ping(), timeout]);
      return reply === 'PONG';
    } catch (err) {
      this.logger.warn(`Redis health check failed: ${(err as Error).message}`);
      return false;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async onModuleDestroy(): Promise<void> {
    try {
      await this.redis.quit();
    } catch {
      this.redis.disconnect();
    }
  }
}
