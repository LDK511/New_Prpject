import { Body, Controller, Get, Headers, HttpCode, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { ServiceAuthGuard } from '../auth/service-auth.guard';
import type { ServiceRequest } from '../auth/service-auth.guard';
import type { PaymentResult } from './payment-logic';
import { PaymentsService } from './payments.service';

@Controller('payments')
@UseGuards(ServiceAuthGuard)
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post()
  @HttpCode(201)
  async create(
    @Req() req: ServiceRequest,
    @Res({ passthrough: true }) res: Response,
    @Body() body: unknown,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
  ): Promise<PaymentResult> {
    const owner = req.service?.serviceId ?? 'unknown';
    const result = await this.payments.create(owner, body, idempotencyKey);
    res.setHeader('x-mock-signature', result.signature);
    return result;
  }

  @Get(':id')
  get(@Req() req: ServiceRequest, @Param('id') id: string): PaymentResult {
    const owner = req.service?.serviceId ?? 'unknown';
    return this.payments.get(owner, id);
  }
}
