import {
  BadRequestException,
  Controller,
  HttpCode,
  Logger,
  Post,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { requireEnv } from '../auth/jwt-auth.guard';
import { OrdersService } from '../orders/orders.service';
import { verifySignature } from '../webhook-signature';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface PaymentWebhookEvent {
  id: string;
  type: 'payment.succeeded' | 'payment.failed';
  data: {
    paymentId: string;
    orderId: string;
    amount: number;
    currency: string;
  };
}

function parseEvent(raw: Buffer): PaymentWebhookEvent {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.toString('utf8'));
  } catch {
    throw new BadRequestException('Invalid JSON');
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new BadRequestException('Invalid event');
  }
  const evt = parsed as { id?: unknown; type?: unknown; data?: unknown };
  if (typeof evt.id !== 'string' || evt.id.length < 1 || evt.id.length > 200) {
    throw new BadRequestException('Invalid event id');
  }
  if (evt.type !== 'payment.succeeded' && evt.type !== 'payment.failed') {
    throw new BadRequestException('Unsupported event type');
  }
  if (!evt.data || typeof evt.data !== 'object') {
    throw new BadRequestException('Invalid event data');
  }
  const d = evt.data as { paymentId?: unknown; orderId?: unknown; amount?: unknown; currency?: unknown };
  if (typeof d.paymentId !== 'string' || d.paymentId.length < 1) {
    throw new BadRequestException('Invalid paymentId');
  }
  if (typeof d.orderId !== 'string' || !UUID_RE.test(d.orderId)) {
    throw new BadRequestException('Invalid orderId');
  }
  if (typeof d.amount !== 'number' || !Number.isInteger(d.amount) || d.amount < 0) {
    throw new BadRequestException('Invalid amount');
  }
  if (typeof d.currency !== 'string' || d.currency.length < 1) {
    throw new BadRequestException('Invalid currency');
  }
  return {
    id: evt.id,
    type: evt.type,
    data: {
      paymentId: d.paymentId,
      orderId: d.orderId.toLowerCase(),
      amount: d.amount,
      currency: d.currency,
    },
  };
}

/**
 * 모의 결제 서버의 웹훅 수신. main.ts 에서 이 경로에 express.raw 가 JSON 파서보다 먼저 등록되어
 * req.body 는 원본 Buffer 입니다. 서명(x-mock-signature)이 없거나 틀리면 400 이고 아무것도 바꾸지 않습니다.
 * 결제 확정(PAID_TEST)은 오직 이 경로에서만 일어납니다.
 */
@Controller('webhooks')
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);
  private readonly secret = requireEnv('PAYMENT_WEBHOOK_SECRET');

  constructor(private readonly orders: OrdersService) {}

  @Post('payment')
  @HttpCode(200)
  async payment(@Req() req: Request): Promise<{ received: true; duplicate?: true }> {
    const rawBody: Buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const headerValue = req.headers['x-mock-signature'];
    const header = Array.isArray(headerValue) ? headerValue[0] : headerValue;

    if (!header || rawBody.length === 0 || !verifySignature(rawBody, header, this.secret)) {
      this.logger.warn('Rejected payment webhook: missing or invalid signature');
      throw new BadRequestException('Invalid signature');
    }

    const evt = parseEvent(rawBody);
    const result = await this.orders.handlePaymentEvent(evt);
    if (result.duplicate) {
      this.logger.log(`Duplicate payment event ignored: ${evt.id}`);
      return { received: true, duplicate: true };
    }
    this.logger.log(`Processed payment event ${evt.id} (${evt.type}) for order ${evt.data.orderId}`);
    return { received: true };
  }
}
