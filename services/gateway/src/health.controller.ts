import { Controller, Get, HttpCode } from '@nestjs/common';

/**
 * 게이트웨이는 DB를 쓰지 않으므로 프로세스가 살아 있으면 항상 200 {"status":"ok"} 를 돌려줍니다.
 * AppModule 의 controllers 순서상 ProxyController 보다 먼저 등록되어 /health 가 프록시되지 않습니다.
 */
@Controller()
export class HealthController {
  @Get('health')
  @HttpCode(200)
  health(): { status: string } {
    return { status: 'ok' };
  }
}
