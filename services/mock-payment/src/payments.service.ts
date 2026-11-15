import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { createHmac, randomUUID } from 'crypto';
import { loadConfig, MockPaymentConfig } from './config';

export type PaymentOutcome = 'succeeded' | 'failed';
export type PaymentStatus = 'requires_confirmation' | PaymentOutcome;

export interface MockPayment {
  id: string;
  orderId: string;
  amount: number;
  currency: string;
  status: PaymentStatus;
  createdAt: string;
  completedAt?: string;
  eventId?: string;
  eventType?: string;
}

export interface CreatePaymentInput {
  orderId: string;
  amount: number;
  currency: string;
  idempotencyKey?: string;
}

export interface CompletePaymentResult {
  payment: MockPayment;
  webhookStatus: number;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAYMENT_ID_RE = /^pay_[0-9a-f-]{36}$/i;
const MAX_PAYMENTS = 50_000;
const WEBHOOK_TIMEOUT_MS = 10_000;

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger('MockPayments');
  private readonly config: MockPaymentConfig = loadConfig();
  private readonly payments = new Map<string, MockPayment>();
  private readonly byIdempotencyKey = new Map<string, string>();

  validateCreate(body: unknown, headerKey: string | undefined): CreatePaymentInput {
    if (!body || typeof body !== 'object') throw new BadRequestException('invalid body');
    const b = body as Record<string, unknown>;
    const metadata = (b.metadata && typeof b.metadata === 'object' ? b.metadata : {}) as Record<string, unknown>;
    const orderId = typeof b.orderId === 'string' ? b.orderId : metadata.orderId;
    if (typeof orderId !== 'string' || !UUID_RE.test(orderId)) {
      throw new BadRequestException('orderId must be a UUID');
    }
    const amount = b.amount;
    if (typeof amount !== 'number' || !Number.isSafeInteger(amount) || amount <= 0) {
      throw new BadRequestException('amount must be a positive integer (minor units)');
    }
    const currencyRaw = b.currency === undefined ? 'KRW' : b.currency;
    if (typeof currencyRaw !== 'string' || !/^[A-Za-z]{3}$/.test(currencyRaw)) {
      throw new BadRequestException('currency must be a 3-letter code');
    }
    const keyRaw = headerKey ?? (typeof b.idempotencyKey === 'string' ? b.idempotencyKey : undefined);
    let idempotencyKey: string | undefined;
    if (keyRaw !== undefined) {
      if (keyRaw.length === 0 || keyRaw.length > 200) throw new BadRequestException('invalid idempotency key');
      idempotencyKey = keyRaw;
    }
    return { orderId, amount, currency: currencyRaw.toUpperCase(), idempotencyKey };
  }

  create(input: CreatePaymentInput): { payment: MockPayment; created: boolean } {
    if (input.idempotencyKey) {
      const existingId = this.byIdempotencyKey.get(input.idempotencyKey);
      const existing = existingId ? this.payments.get(existingId) : undefined;
      if (existing) {
        if (
          existing.orderId !== input.orderId ||
          existing.amount !== input.amount ||
          String(existing.currency).toLowerCase() !== String(input.currency).toLowerCase()
        ) {
          throw new ConflictException('idempotency key reused with different parameters');
        }
        return { payment: existing, created: false };
      }
    }

    this.evictIfNeeded();
    const payment: MockPayment = {
      id: `pay_${randomUUID()}`,
      orderId: input.orderId,
      amount: input.amount,
      currency: input.currency,
      status: 'requires_confirmation',
      createdAt: new Date().toISOString(),
    };
    this.payments.set(payment.id, payment);
    if (input.idempotencyKey) this.byIdempotencyKey.set(input.idempotencyKey, payment.id);
    this.logger.log(`created ${payment.id} order=${payment.orderId} amount=${payment.amount} ${payment.currency}`);
    return { payment, created: true };
  }

  get(id: string): MockPayment {
    if (!PAYMENT_ID_RE.test(id)) throw new NotFoundException('payment not found');
    const p = this.payments.get(id);
    if (!p) throw new NotFoundException('payment not found');
    return p;
  }

  parseOutcome(body: unknown): PaymentOutcome {
    const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
    const raw = b.outcome ?? b.simulate ?? b.result ?? b.status ?? 'succeeded';
    if (raw === 'succeeded' || raw === 'success') return 'succeeded';
    if (raw === 'failed' || raw === 'fail' || raw === 'failure') return 'failed';
    throw new BadRequestException('outcome must be succeeded or failed');
  }

  /**
   * 결제를 성공/실패로 마무리하고, 서명한 웹훅을 주문 서비스로 동기 전송합니다.
   * 이미 마무리된 결제에 같은 결과를 다시 요청하면 같은 이벤트 ID로 웹훅을 다시 보냅니다(주문 서비스가 중복을 막음).
   * 다른 결과를 요청하면 409 입니다.
   */
  async complete(id: string, outcome: PaymentOutcome): Promise<CompletePaymentResult> {
    const payment = this.get(id);
    if (payment.status !== 'requires_confirmation' && payment.status !== outcome) {
      throw new ConflictException(`payment already ${payment.status}`);
    }
    if (payment.status === 'requires_confirmation') {
      payment.status = outcome;
      payment.completedAt = new Date().toISOString();
      payment.eventId = `evt_${randomUUID()}`;
      payment.eventType = outcome === 'succeeded' ? 'payment.succeeded' : 'payment.failed';
    }

    const event = {
      id: payment.eventId as string,
      type: payment.eventType as string,
      created: Math.floor(new Date(payment.completedAt as string).getTime() / 1000),
      data: {
        paymentId: payment.id,
        orderId: payment.orderId,
        amount: payment.amount,
        currency: payment.currency,
        status: payment.status,
      },
    };
    const webhookStatus = await this.sendWebhook(JSON.stringify(event));
    return { payment, webhookStatus };
  }

  sign(rawBody: string, timestamp: number = Math.floor(Date.now() / 1000)): string {
    const v1 = createHmac('sha256', this.config.webhookSecret).update(`${timestamp}.${rawBody}`).digest('hex');
    return `t=${timestamp},v1=${v1}`;
  }

  private async sendWebhook(rawBody: string): Promise<number> {
    const url = `${this.config.ordersUrl}/webhooks/payment`;
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-mock-signature': this.sign(rawBody) },
        body: rawBody,
        redirect: 'manual',
        signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`webhook delivery failed: ${message}`);
      throw new BadGatewayException('webhook delivery failed');
    }
    // 응답 본문은 소비만 하고 내용은 돌려주지 않습니다.
    await res.text().catch(() => '');
    if (res.status < 200 || res.status >= 300) {
      this.logger.warn(`webhook rejected by orders service: HTTP ${res.status}`);
      throw new BadGatewayException(`webhook rejected (HTTP ${res.status})`);
    }
    this.logger.log(`webhook delivered: HTTP ${res.status}`);
    return res.status;
  }

  private evictIfNeeded(): void {
    while (this.payments.size >= MAX_PAYMENTS) {
      const first = this.payments.keys().next();
      if (first.done) break;
      this.payments.delete(first.value);
    }
    if (this.byIdempotencyKey.size >= MAX_PAYMENTS) {
      for (const [key, pid] of this.byIdempotencyKey) {
        if (!this.payments.has(pid)) this.byIdempotencyKey.delete(key);
      }
    }
  }
}
