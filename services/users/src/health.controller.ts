import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import type { Response } from 'express';
import { PrismaService } from './prisma.service';

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async health(@Res({ passthrough: true }) res: Response): Promise<{ status: 'ok' | 'error' }> {
    let ok = false;
    try {
      ok = await this.prisma.isHealthy();
    } catch {
      ok = false;
    }
    if (!ok) {
      res.status(HttpStatus.SERVICE_UNAVAILABLE);
      return { status: 'error' };
    }
    res.status(HttpStatus.OK);
    return { status: 'ok' };
  }
}
