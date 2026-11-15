import { Controller, Get, HttpException, HttpStatus } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/**
 * GET /health — products-db 연결이 정상이면 200 {"status":"ok"},
 * 아니면 503 {"status":"error"}를 돌려줍니다.
 */
@Controller()
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('health')
  async health(): Promise<{ status: string }> {
    let ok = false;
    try {
      ok = await this.prisma.isHealthy();
    } catch {
      ok = false;
    }
    if (!ok) {
      throw new HttpException({ status: 'error' }, HttpStatus.SERVICE_UNAVAILABLE);
    }
    return { status: 'ok' };
  }
}
