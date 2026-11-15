import { Body, Controller, Get, Headers, HttpCode, Param, Post, Res } from '@nestjs/common';
import { MockPayment, PaymentsService } from './payments.service';

interface StatusSettable {
  status(code: number): unknown;
}

function toResponse(p: MockPayment) {
  return {
    id: p.id,
    paymentId: p.id,
    orderId: p.orderId,
    amount: p.amount,
    currency: p.currency,
    status: p.status,
    createdAt: p.createdAt,
    completedAt: p.completedAt ?? null,
  };
}

/**
 * 내부 전용 모의 결제 API(게이트웨이는 라우팅하지 않음).
 * - POST /payments            : 결제 ID 발급 (Idempotency-Key 지원)
 * - GET  /payments/:id        : 결제 조회
 * - POST /payments/:id/complete : {outcome:'succeeded'|'failed'} 로 서명된 웹훅을 orders 로 동기 전송
 */
@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post()
  create(
    @Body() body: unknown,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Res({ passthrough: true }) res: StatusSettable,
  ) {
    const input = this.payments.validateCreate(body, idempotencyKey);
    const { payment, created } = this.payments.create(input);
    res.status(created ? 201 : 200);
    return toResponse(payment);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return toResponse(this.payments.get(id));
  }

  @Post(':id/complete')
  @HttpCode(200)
  async complete(@Param('id') id: string, @Body() body: unknown) {
    const outcome = this.payments.parseOutcome(body);
    const { payment, webhookStatus } = await this.payments.complete(id, outcome);
    return { ...toResponse(payment), webhookDelivered: true, webhookStatus };
  }
}
