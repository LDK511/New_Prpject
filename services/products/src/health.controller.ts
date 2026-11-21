import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import type { Response } from 'express';
import { PrismaService } from './prisma.service';

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async check(@Res({ passthrough: true }) res: Response): Promise<{ status: 'ok' | 'error' }> {
    let healthy = false;
    try {
      healthy = await this.prisma.isHealthy();
    } catch {
      healthy = false;
    }
    if (!healthy) {
      res.status(HttpStatus.SERVICE_UNAVAILABLE);
      return { status: 'error' };
    }
    res.status(HttpStatus.OK);
    return { status: 'ok' };
  }
}
