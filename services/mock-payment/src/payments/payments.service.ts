import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { MOCK_PAYMENT_CONFIG, MockPaymentConfig } from '../config';
import {
  decideStatus,
  parsePaymentRequest,
  PaymentResult,
  PaymentValidationError,
  requestFingerprint,
  signPayment,
} from './payment-logic';

const MAX_STORED = 10000;

interface StoredPayment {
  owner: string;
  fingerprint: string;
  result: PaymentResult;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 메모리 기반 모의 결제. 실제 돈은 오가지 않으며 테스트 환경에서만 동작합니다.
 * 재시작하면 기록이 사라집니다(주문 서비스가 결제 결과를 자체 DB에 저장합니다).
 */
@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);
  private readonly byId = new Map<string, StoredPayment>();
  private readonly byKey = new Map<string, string>();

  constructor(@Inject(MOCK_PAYMENT_CONFIG) private readonly config: MockPaymentConfig) {}

  async create(owner: string, body: unknown, headerKey: string | undefined): Promise<PaymentResult> {
    let req;
    try {
      req = parsePaymentRequest(body, headerKey);
    } catch (err) {
      if (err instanceof PaymentValidationError) throw new BadRequestException(err.message);
      throw err;
    }
    const fingerprint = requestFingerprint(req);

    if (req.idempotencyKey !== null) {
      const existingId = this.byKey.get(`${owner}:${req.idempotencyKey}`);
      if (existingId !== undefined) {
        const existing = this.byId.get(existingId);
        if (existing) {
          if (existing.fingerprint !== fingerprint) {
            throw new ConflictException('Idempotency key reused with different parameters');
          }
          return existing.result;
        }
      }
    }

    if (this.config.delayMs > 0) {
      await sleep(this.config.delayMs);
    }

    const id = `mockpay_${randomUUID()}`;
    const { status, failureReason } = decideStatus(this.config.forceFail);
    const signature = signPayment(this.config.jwtSecret, {
      id,
      orderId: req.orderId,
      amount: req.amount,
      currency: req.currency,
      status,
    });
    const result: PaymentResult = {
      id,
      paymentId: id,
      orderId: req.orderId,
      amount: req.amount,
      currency: req.currency,
      status,
      succeeded: status === 'SUCCEEDED',
      failureReason,
      testMode: true,
      createdAt: new Date().toISOString(),
      signature,
    };

    this.store(owner, fingerprint, result, req.idempotencyKey);
    this.logger.log(`mock payment ${id} order=${req.orderId} amount=${req.amount} ${req.currency} status=${status}`);
    return result;
  }

  get(owner: string, id: string): PaymentResult {
    const stored = this.byId.get(id);
    if (!stored || stored.owner !== owner) throw new NotFoundException('Payment not found');
    return stored.result;
  }

  private store(owner: string, fingerprint: string, result: PaymentResult, key: string | null): void {
    if (this.byId.size >= MAX_STORED) {
      const oldest = this.byId.keys().next().value;
      if (oldest !== undefined) this.byId.delete(oldest);
      for (const [k, v] of this.byKey) {
        if (!this.byId.has(v)) this.byKey.delete(k);
      }
    }
    this.byId.set(result.id, { owner, fingerprint, result });
    if (key !== null) this.byKey.set(`${owner}:${key}`, result.id);
  }
}
