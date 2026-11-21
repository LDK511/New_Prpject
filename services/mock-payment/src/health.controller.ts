import { Controller, Get, HttpCode } from '@nestjs/common';

@Controller()
export class HealthController {
  @Get('health')
  @HttpCode(200)
  health(): { status: 'ok'; test_payment_mode: boolean } {
    return { status: 'ok', test_payment_mode: true };
  }
}
