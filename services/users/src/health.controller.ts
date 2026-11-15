import { Controller, Get, HttpCode, HttpException, HttpStatus } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Controller()
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  // GET /health — users-db 연결이 정상이면 200 {"status":"ok"}, 아니면 503 {"status":"error"}
  @Get('health')
  @HttpCode(HttpStatus.OK)
  async health(): Promise<{ status: 'ok' }> {
    let healthy = false;
    try {
      healthy = await this.prisma.isHealthy();
    } catch {
      healthy = false;
    }
    if (!healthy) {
      throw new HttpException({ status: 'error' }, HttpStatus.SERVICE_UNAVAILABLE);
    }
    return { status: 'ok' };
  }
}
