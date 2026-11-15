import { Controller, Get, Res } from '@nestjs/common';
import { Response } from 'express';
import { PrismaService } from './prisma.service';
import { EventPublisher } from './events/event-publisher';

const CHECK_TIMEOUT_MS = 3000;

function withTimeout(p: Promise<boolean>, ms: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const t = setTimeout(() => resolve(false), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v === true);
      },
      () => {
        clearTimeout(t);
        resolve(false);
      },
    );
  });
}

/**
 * GET /health — orders DB와 Redis가 모두 응답하면 200 {"status":"ok"},
 * 하나라도 실패하면 503 {"status":"error"}.
 */
@Controller()
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventPublisher,
  ) {}

  @Get('health')
  async health(@Res({ passthrough: true }) res: Response): Promise<{ status: 'ok' | 'error' }> {
    const [dbOk, redisOk] = await Promise.all([
      withTimeout(Promise.resolve().then(() => this.prisma.isHealthy()), CHECK_TIMEOUT_MS),
      withTimeout(Promise.resolve().then(() => this.events.ping()), CHECK_TIMEOUT_MS),
    ]);
    if (dbOk && redisOk) {
      res.status(200);
      return { status: 'ok' };
    }
    res.status(503);
    return { status: 'error' };
  }
}
